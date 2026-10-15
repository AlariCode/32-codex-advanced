//go:build integration

package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"linkbook/linkprocessing"
)

func TestProcessingIntegrationStatusesAndDocumentAccess(t *testing.T) {
	f := newRegistrationFixture(t)
	token, _ := librarySession(t, f)
	other, _ := librarySession(t, f)
	a := decodeLibrary[libraryResult](t, libraryPost(f, token, "http://example.com/article"), 201).Link
	foreign := decodeLibrary[libraryResult](t, libraryPost(f, other, "https://example.com/secret"), 201).Link
	for _, path := range []string{"/api/links/statuses", "/api/links/" + a.ID + "/document"} {
		decodeLibrary[errorResponse](t, libraryRequest(f, "GET", path, "", "", ""), 401)
	}
	for _, id := range []string{a.ID, "12345678-1234-4234-8234-123456789abc"} {
		assertRegistrationError(t, libraryRequest(f, "GET", "/api/links/"+id+"/document", other, "", ""), 404, "not_found")
	}
	assertRegistrationError(t, libraryRequest(f, "GET", "/api/links/"+a.ID+"/document", token, "", ""), 409, "article_not_ready")
	for _, q := range []string{"ids=bad", "ids=" + strings.Repeat(a.ID+",", 101) + a.ID, "limit=101"} {
		assertRegistrationError(t, libraryRequest(f, "GET", "/api/links/statuses?"+q, token, "", ""), 400, "invalid_request")
	}
	page := decodeLibrary[struct {
		Links      []libraryCard `json:"links"`
		ServerTime time.Time     `json:"server_time"`
	}](t, libraryRequest(f, "GET", "/api/links/statuses?ids="+a.ID+","+foreign.ID, token, "", ""), 200)
	if len(page.Links) != 1 || page.Links[0].ID != a.ID || page.ServerTime.IsZero() {
		t.Fatalf("unscoped statuses: %+v", page)
	}
	// Active cards are discovered independently of the library page, using a cursor.
	for i := 0; i < 3; i++ {
		decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/active/"+string(rune('a'+i))), 201)
	}
	first := decodeLibrary[libraryList](t, libraryRequest(f, "GET", "/api/links/statuses?limit=2", token, "", ""), 200)
	second := decodeLibrary[libraryList](t, libraryRequest(f, "GET", "/api/links/statuses?limit=2&cursor="+first.NextCursor, token, "", ""), 200)
	if len(first.Links) != 2 || len(second.Links) != 2 || first.NextCursor == "" {
		t.Fatal("active discovery omitted cards")
	}
	exec, err := linkprocessing.Claim(t.Context(), f.db)
	if err != nil || exec == nil {
		t.Fatalf("claim: %v", err)
	}
	doc := linkprocessing.Document{SchemaVersion: 1, Blocks: []linkprocessing.Block{{Kind: "paragraph", Text: "Archived text survives the original."}}}
	ok, err := linkprocessing.Publish(t.Context(), f.db, *exec, linkprocessing.Result{Document: &doc, Title: "Saved article", FinalURL: exec.FetchURL})
	if err != nil || !ok {
		t.Fatalf("publish %v %v", ok, err)
	}
	response := libraryRequest(f, "GET", "/api/links/"+exec.LinkID+"/document", token, "", "")
	archived := decodeLibrary[struct {
		Document linkprocessing.Document `json:"document"`
		Title    string                  `json:"title"`
	}](t, response, 200)
	if archived.Title != "Saved article" || archived.Document.Blocks[0].Text != doc.Blocks[0].Text {
		t.Fatal("snapshot missing")
	}
	if strings.Contains(response.Body.String(), exec.Token) {
		t.Fatal("execution token leaked")
	}
	if _, err = f.db.ExecContext(t.Context(), `UPDATE snapshots SET schema_version=99 WHERE link_id=$1`, exec.LinkID); err != nil {
		t.Fatal(err)
	}
	assertRegistrationError(t, libraryRequest(f, "GET", "/api/links/"+exec.LinkID+"/document", token, "", ""), 409, "unsupported_document")
	if _, err = f.db.ExecContext(t.Context(), `UPDATE links SET state='unavailable' WHERE id=$1`, a.ID); err != nil {
		t.Fatal(err)
	}
	assertRegistrationError(t, libraryRequest(f, "GET", "/api/links/"+a.ID+"/document", token, "", ""), 409, "article_unavailable")
}

func TestProcessingIntegrationClaimPublishFencesAndRollback(t *testing.T) {
	for _, mutation := range []string{"none", "generation", "token", "deadline", "job_deadline", "state", "lease", "deleted", "commit"} {
		t.Run(mutation, func(t *testing.T) {
			f := newRegistrationFixture(t)
			token, _ := librarySession(t, f)
			saved := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/a"), 201).Link
			exec, err := linkprocessing.Claim(t.Context(), f.db)
			if err != nil || exec == nil {
				t.Fatalf("claim %v", err)
			}
			if exec.LinkID != saved.ID || exec.Token == "" || exec.Generation != 1 || exec.FetchURL != "https://example.com/a" {
				t.Fatalf("execution: %+v", exec)
			}
			next, err := linkprocessing.Claim(t.Context(), f.db)
			if err != nil || next != nil {
				t.Fatalf("duplicate claim %v", err)
			}
			// Acquiring a row lock while the execution is active proves claim released its transaction.
			tx, err := f.db.BeginTx(t.Context(), nil)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = tx.ExecContext(t.Context(), `SELECT id FROM processing_jobs WHERE link_id=$1 FOR UPDATE NOWAIT`, saved.ID); err != nil {
				t.Fatal("claim retained SQL lock", err)
			}
			_ = tx.Rollback()
			query := map[string]string{
				"generation":   `UPDATE links SET generation=2 WHERE id=$1`,
				"token":        `UPDATE processing_jobs SET execution_token=gen_random_uuid() WHERE link_id=$1`,
				"deadline":     `UPDATE links SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=$1`,
				"job_deadline": `UPDATE processing_jobs SET deadline_at=clock_timestamp()-interval '1 second' WHERE link_id=$1`,
				"state":        `UPDATE links SET state='failed' WHERE id=$1`,
				"lease":        `UPDATE processing_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE link_id=$1`,
				"deleted":      `DELETE FROM links WHERE id=$1`,
			}[mutation]
			if query != "" {
				if _, err = f.db.ExecContext(t.Context(), query, saved.ID); err != nil {
					t.Fatal(err)
				}
			}
			if mutation == "commit" {
				if _, err = f.db.ExecContext(t.Context(), `CREATE FUNCTION reject_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'publication unavailable'; END $$; CREATE CONSTRAINT TRIGGER reject_publication AFTER INSERT ON snapshots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_publication()`); err != nil {
					t.Fatal(err)
				}
			}
			doc := linkprocessing.Document{SchemaVersion: 1, Blocks: []linkprocessing.Block{{Kind: "paragraph", Text: "Safe archived text"}}}
			ok, err := linkprocessing.Publish(t.Context(), f.db, *exec, linkprocessing.Result{Document: &doc, Title: "Title", FinalURL: exec.FetchURL})
			if mutation == "none" {
				if !ok || err != nil {
					t.Fatalf("valid publication %v %v", ok, err)
				}
			} else if ok {
				t.Fatal("invalid execution published")
			}
			if mutation == "commit" && err == nil {
				t.Fatal("commit failure ignored")
			}
			var snapshots int
			if err = f.db.QueryRowContext(t.Context(), `SELECT count(*) FROM snapshots`).Scan(&snapshots); err != nil {
				t.Fatal(err)
			}
			if mutation != "none" && snapshots != 0 {
				t.Fatal("partial snapshot visible")
			}
			if mutation == "commit" {
				var state string
				if err = f.db.QueryRowContext(t.Context(), `SELECT state FROM links WHERE id=$1`, saved.ID).Scan(&state); err != nil || state != "processing" {
					t.Fatal("partial ready visible", err)
				}
			}
		})
	}
}

func TestProcessingIntegrationRejectInvalidSnapshotAndExpiredClaim(t *testing.T) {
	f := newRegistrationFixture(t)
	token, _ := librarySession(t, f)
	saved := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/a"), 201).Link
	exec, err := linkprocessing.Claim(t.Context(), f.db)
	if err != nil || exec == nil {
		t.Fatal(err)
	}
	for _, raw := range []string{`{"schema_version":99,"blocks":[{"kind":"paragraph","text":"x"}]}`, `{"schema_version":1,"blocks":[{"kind":"script","text":"alert(1)"}]}`, `{"schema_version":1,"blocks":[]}`} {
		var doc linkprocessing.Document
		if err = json.Unmarshal([]byte(raw), &doc); err != nil {
			t.Fatal(err)
		}
		if ok, err := linkprocessing.Publish(t.Context(), f.db, *exec, linkprocessing.Result{Document: &doc}); ok || err == nil {
			t.Fatal("invalid snapshot accepted")
		}
	}
	if _, err = f.db.ExecContext(t.Context(), `UPDATE links SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=$1;`, saved.ID); err != nil {
		t.Fatal(err)
	}
	if ok, err := linkprocessing.Publish(t.Context(), f.db, *exec, linkprocessing.Result{Reason: "network_error"}); ok || err != nil {
		t.Fatal("late error published", err)
	}
	active, err := linkprocessing.Claim(t.Context(), f.db)
	if err != nil || active != nil {
		t.Fatal("expired execution claimed")
	}
}
