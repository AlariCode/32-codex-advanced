//go:build integration

package httpapi

import (
	"bytes"
	"image"
	"image/png"
	"linkbook/linkprocessing"
	"strings"
	"testing"
)

func TestAssetsIntegrationPublicationAndAccess(t *testing.T) {
	for _, mutation := range []string{"none", "token", "deadline", "lease", "generation", "commit"} {
		t.Run(mutation, func(t *testing.T) {
			f := newRegistrationFixture(t)
			token, _ := librarySession(t, f)
			other, _ := librarySession(t, f)
			saved := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/images"), 201).Link
			e, err := linkprocessing.Claim(t.Context(), f.db)
			if err != nil || e == nil {
				t.Fatal(err)
			}
			var b bytes.Buffer
			_ = png.Encode(&b, image.NewGray(image.Rect(0, 0, 2, 2)))
			id := strings.Repeat("a", 64)
			path := "/api/links/" + saved.ID + "/assets/" + id
			for _, auth := range []string{token, other, ""} {
				want := 404
				if auth == "" {
					want = 401
				}
				if r := libraryRequest(f, "GET", path, auth, "", ""); r.Code != want {
					t.Fatalf("unpublished %d", r.Code)
				}
			}
			q := map[string]string{"token": `UPDATE processing_jobs SET execution_token=gen_random_uuid() WHERE link_id=$1`, "deadline": `UPDATE links SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=$1`, "lease": `UPDATE processing_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE link_id=$1`, "generation": `UPDATE links SET generation=generation+1 WHERE id=$1`}[mutation]
			if q != "" {
				if _, err = f.db.ExecContext(t.Context(), q, saved.ID); err != nil {
					t.Fatal(err)
				}
			}
			if mutation == "commit" {
				if _, err = f.db.ExecContext(t.Context(), `CREATE FUNCTION reject_assets() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'rollback'; END $$; CREATE CONSTRAINT TRIGGER reject_assets AFTER INSERT ON assets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_assets()`); err != nil {
					t.Fatal(err)
				}
			}
			d := linkprocessing.Document{SchemaVersion: 2, Blocks: []linkprocessing.Block{{Kind: "image", AssetID: id, Alt: "Photo"}}}
			result := linkprocessing.Result{Document: &d, Assets: []linkprocessing.Asset{{ID: id, MIME: "image/png", Data: b.Bytes()}}}
			ok, err := linkprocessing.Publish(t.Context(), f.db, *e, result)
			if mutation == "none" {
				if !ok || err != nil {
					t.Fatalf("publish %v %v", ok, err)
				}
				r := libraryRequest(f, "GET", path, token, "", "")
				if r.Code != 200 || !bytes.Equal(r.Body.Bytes(), b.Bytes()) || r.Header().Get("Content-Type") != "image/png" || r.Header().Get("X-Content-Type-Options") != "nosniff" || r.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("asset %d %v", r.Code, r.Header())
				}
				if r := libraryRequest(f, "GET", path, other, "", ""); r.Code != 404 {
					t.Fatal("foreign asset exposed")
				}
				// A stored row alone is insufficient: only references in the published document grant access.
				if _, err = f.db.ExecContext(t.Context(), `UPDATE snapshots SET document='{"schema_version":2,"blocks":[{"kind":"text","text":"no images"}]}' WHERE link_id=$1`, saved.ID); err != nil {
					t.Fatal(err)
				}
				if r := libraryRequest(f, "GET", path, token, "", ""); r.Code != 404 {
					t.Fatal("unreferenced asset exposed")
				}
			} else {
				if ok {
					t.Fatal("stale result published")
				}
				if mutation == "commit" && err == nil {
					t.Fatal("commit error ignored")
				}
				var count int
				if err = f.db.QueryRowContext(t.Context(), `SELECT (SELECT count(*) FROM assets)+(SELECT count(*) FROM snapshots)`).Scan(&count); err != nil || count != 0 {
					t.Fatalf("partial archive %d %v", count, err)
				}
			}
		})
	}
}
