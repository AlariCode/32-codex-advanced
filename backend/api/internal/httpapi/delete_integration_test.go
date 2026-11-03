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

func TestDeleteIntegrationOwnershipAndCascade(t *testing.T) {
	for _, state := range []string{"processing", "ready", "unavailable", "failed"} {
		t.Run(state, func(t *testing.T) {
			f := newRegistrationFixture(t)
			token, _ := librarySession(t, f)
			other, _ := librarySession(t, f)
			card := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/delete"), 201).Link
			if state == "ready" {
				e, err := linkprocessing.Claim(t.Context(), f.db)
				if err != nil || e == nil {
					t.Fatal(err)
				}
				var imageBytes bytes.Buffer
				_ = png.Encode(&imageBytes, image.NewGray(image.Rect(0, 0, 2, 2)))
				d := linkprocessing.Document{SchemaVersion: 2, Blocks: []linkprocessing.Block{{Kind: "image", AssetID: strings.Repeat("a", 64), Alt: "Archived image"}}}
				if ok, err := linkprocessing.Publish(t.Context(), f.db, *e, linkprocessing.Result{Document: &d, Assets: []linkprocessing.Asset{{ID: strings.Repeat("a", 64), MIME: "image/png", Data: imageBytes.Bytes()}}}); err != nil || !ok {
					t.Fatalf("publish %v %v", ok, err)
				}
			} else if _, err := f.db.Exec(`UPDATE links SET state=$2 WHERE id=$1`, card.ID, state); err != nil {
				t.Fatal(err)
			}
			path := "/api/links/" + card.ID
			if state == "ready" {
				for _, suffix := range []string{"/document", "/assets/" + strings.Repeat("a", 64)} {
					if r := libraryRequest(f, "GET", path+suffix, token, "", ""); r.Code != 200 {
						t.Fatalf("fixture URL %s: %d", suffix, r.Code)
					}
				}
			}
			if state == "ready" {
				if _, err := f.db.Exec(`CREATE FUNCTION reject_archive_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'archive commit unavailable'; END $$; CREATE CONSTRAINT TRIGGER reject_archive_delete AFTER DELETE ON assets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_archive_delete()`); err != nil {
					t.Fatal(err)
				}
				if r := libraryRequest(f, "DELETE", path, token, "", "http://localhost:3000"); r.Code != 500 {
					t.Fatal(r.Code)
				}
				libraryCounts(t, f, 1, 1)
				for _, suffix := range []string{"/document", "/assets/" + strings.Repeat("a", 64)} {
					if r := libraryRequest(f, "GET", path+suffix, token, "", ""); r.Code != 200 {
						t.Fatalf("rollback lost %s", suffix)
					}
				}
				if _, err := f.db.Exec(`DROP TRIGGER reject_archive_delete ON assets`); err != nil {
					t.Fatal(err)
				}
			}
			foreign := libraryRequest(f, "DELETE", path, other, "", "http://localhost:3000")
			missing := libraryRequest(f, "DELETE", "/api/links/00000000-0000-4000-8000-000000000001", token, "", "http://localhost:3000")
			if foreign.Code != missing.Code || foreign.Body.String() != missing.Body.String() {
				t.Fatal("foreign and missing differ")
			}
			if r := libraryRequest(f, "DELETE", "/api/links/invalid", token, "", "http://localhost:3000"); r.Code != 400 {
				t.Fatal(r.Code)
			}
			for _, tc := range []struct {
				token, origin string
				status        int
			}{{"", "http://localhost:3000", 401}, {token, "https://evil.example", 403}, {other, "http://localhost:3000", 404}, {token, "http://localhost:3000", 204}} {
				r := libraryRequest(f, "DELETE", path, tc.token, "", tc.origin)
				if r.Code != tc.status {
					t.Fatalf("DELETE got %d want %d: %s", r.Code, tc.status, r.Body)
				}
				if r.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("missing no-store")
				}
			}
			libraryCounts(t, f, 0, 0)
			var archiveCount int
			if err := f.db.QueryRow(`SELECT (SELECT count(*) FROM snapshots)+(SELECT count(*) FROM assets)`).Scan(&archiveCount); err != nil || archiveCount != 0 {
				t.Fatalf("archive remains %d %v", archiveCount, err)
			}
			for _, suffix := range []string{"", "/document", "/assets/" + strings.Repeat("a", 64)} {
				if r := libraryRequest(f, "GET", path+suffix, token, "", ""); r.Code != 404 {
					t.Fatalf("old URL %s: %d", suffix, r.Code)
				}
			}
			if r := libraryRequest(f, "DELETE", path, token, "", "http://localhost:3000"); r.Code != 404 {
				t.Fatal(r.Code)
			}
		})
	}
}

func TestDeleteIntegrationRollbackAndExecutionFence(t *testing.T) {
	f := newRegistrationFixture(t)
	token, _ := librarySession(t, f)
	card := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/fenced-delete"), 201).Link
	execution, err := linkprocessing.Claim(t.Context(), f.db)
	if err != nil || execution == nil {
		t.Fatal(err)
	}
	path := "/api/links/" + card.ID
	if _, err = f.db.Exec(`CREATE FUNCTION reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'commit unavailable'; END $$; CREATE CONSTRAINT TRIGGER reject_delete AFTER DELETE ON links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_delete()`); err != nil {
		t.Fatal(err)
	}
	if r := libraryRequest(f, "DELETE", path, token, "", "http://localhost:3000"); r.Code != 500 {
		t.Fatal(r.Code)
	}
	libraryCounts(t, f, 1, 1)
	if _, err = f.db.Exec(`DROP TRIGGER reject_delete ON links`); err != nil {
		t.Fatal(err)
	}
	if r := libraryRequest(f, "DELETE", path, token, "", "http://localhost:3000"); r.Code != 204 {
		t.Fatal(r.Code)
	}
	if ok, err := linkprocessing.Publish(t.Context(), f.db, *execution, linkprocessing.Result{Reason: "article_unavailable"}); err != nil || ok {
		t.Fatalf("deleted execution published: %v %v", ok, err)
	}
	libraryCounts(t, f, 0, 0)
	replacement := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/fenced-delete"), 201).Link
	if replacement.ID == card.ID {
		t.Fatal("deleted ID reused")
	}
}
