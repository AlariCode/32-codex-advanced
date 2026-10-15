//go:build integration

package httpapi

import (
	"linkbook/linkprocessing"
	"sync"
	"testing"
)

func TestRecoveryIntegrationExpiredReads(t *testing.T) {
	for _, route := range []string{"list", "get", "statuses", "active", "duplicate", "document"} {
		t.Run(route, func(t *testing.T) {
			f := newRegistrationFixture(t)
			token, _ := librarySession(t, f)
			saved := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/timeout"), 201).Link
			if _, err := f.db.ExecContext(t.Context(), `UPDATE links SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=$1`, saved.ID); err != nil {
				t.Fatal(err)
			}
			path := map[string]string{"list": "/api/links", "get": "/api/links/" + saved.ID, "statuses": "/api/links/statuses?ids=" + saved.ID, "active": "/api/links/statuses", "document": "/api/links/" + saved.ID + "/document"}[route]
			if route == "duplicate" {
				decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/timeout"), 200)
			} else {
				expected := 200
				if route == "document" {
					expected = 409
				}
				response := libraryRequest(f, "GET", path, token, "", "")
				if response.Code != expected {
					t.Fatalf("status %d: %s", response.Code, response.Body.String())
				}
			}
			var state, reason, job string
			if err := f.db.QueryRowContext(t.Context(), `SELECT l.state,COALESCE(l.reason,''),j.state FROM links l JOIN processing_jobs j ON j.link_id=l.id WHERE l.id=$1`, saved.ID).Scan(&state, &reason, &job); err != nil {
				t.Fatal(err)
			}
			if state != "failed" || reason != "timeout" || job != "failed" {
				t.Fatalf("expired attempt: %s %s %s", state, reason, job)
			}
			if e, err := linkprocessing.Claim(t.Context(), f.db); err != nil || e != nil {
				t.Fatalf("late claim %v %v", e, err)
			}
		})
	}
}

func TestRecoveryIntegrationConcurrentReclaimAndStalePublication(t *testing.T) {
	f := newRegistrationFixture(t)
	token, _ := librarySession(t, f)
	saved := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/reclaim"), 201).Link
	old, err := linkprocessing.Claim(t.Context(), f.db)
	if err != nil || old == nil {
		t.Fatalf("claim %v", err)
	}
	if _, err = f.db.ExecContext(t.Context(), `UPDATE processing_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE link_id=$1`, saved.ID); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan *linkprocessing.Execution, 2)
	for range 2 {
		wg.Go(func() {
			e, err := linkprocessing.Claim(t.Context(), f.db)
			if err != nil {
				t.Error(err)
			}
			results <- e
		})
	}
	wg.Wait()
	close(results)
	var current *linkprocessing.Execution
	for e := range results {
		if e != nil {
			if current != nil {
				t.Fatal("two current executions")
			}
			current = e
		}
	}
	if current == nil {
		t.Fatal("expired lease not recovered")
	}
	if current.Token == old.Token || current.Generation != old.Generation || !current.Deadline.Equal(old.Deadline) {
		t.Fatal("reclaim changed attempt or retained token")
	}
	doc := linkprocessing.Document{SchemaVersion: 1, Blocks: []linkprocessing.Block{{Kind: "paragraph", Text: "Recovered article"}}}
	if ok, err := linkprocessing.Publish(t.Context(), f.db, *old, linkprocessing.Result{Document: &doc}); ok || err != nil {
		t.Fatalf("stale publication %v %v", ok, err)
	}
	if ok, err := linkprocessing.Publish(t.Context(), f.db, *current, linkprocessing.Result{Document: &doc}); !ok || err != nil {
		t.Fatalf("current publication %v %v", ok, err)
	}
	var count int
	if err := f.db.QueryRowContext(t.Context(), `SELECT count(*) FROM snapshots WHERE link_id=$1`, saved.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("snapshots %d %v", count, err)
	}
}
