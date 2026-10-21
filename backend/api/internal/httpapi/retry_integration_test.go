//go:build integration

package httpapi

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"linkbook/linkprocessing"
)

func TestRetryIntegrationAtomicConcurrentAndFenced(t *testing.T) {
	f := newRegistrationFixture(t)
	token, _ := librarySession(t, f)
	other, _ := librarySession(t, f)
	initial := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/retry"), 201).Link
	path := "/api/links/" + initial.ID + "/retry"
	post := func(tok, body, origin string) int { return libraryRequest(f, "POST", path, tok, body, origin).Code }
	for _, tc := range []struct {
		token, body, origin string
		status              int
	}{
		{"", `{"generation":1}`, "http://localhost:3000", 401},
		{token, `{"generation":1}`, "https://evil.example", 403},
		{token, `{"generation":1}`, "", 403},
		{other, `{"generation":1}`, "http://localhost:3000", 404},
		{token, `{"generation":1}`, "http://localhost:3000", 409},
		{token, `{"generation":0}`, "http://localhost:3000", 400},
	} {
		if got := post(tc.token, tc.body, tc.origin); got != tc.status {
			t.Fatalf("got %d want %d", got, tc.status)
		}
	}
	old, err := linkprocessing.Claim(t.Context(), f.db)
	if err != nil || old == nil {
		t.Fatalf("claim: %v", err)
	}
	if _, err = f.db.Exec(`UPDATE links SET state='failed',reason='network_error' WHERE id=$1`, initial.ID); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	codes := make(chan int, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); codes <- post(token, `{"generation":1}`, "http://localhost:3000") }()
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 200 {
			t.Fatalf("retry status %d", code)
		}
	}
	current := decodeLibrary[libraryCard](t, libraryRequest(f, "GET", "/api/links/"+initial.ID, token, "", ""), 200)
	if current.Generation != 2 || current.State != "processing" || !current.CreatedAt.Equal(initial.CreatedAt) || !current.RequestedAt.After(initial.RequestedAt) || current.DeadlineAt.Sub(current.RequestedAt) != 120*time.Second {
		t.Fatalf("bad retry %+v", current)
	}
	libraryCounts(t, f, 1, 2)
	var active int
	if err = f.db.QueryRow(`SELECT count(*) FROM processing_jobs WHERE state IN ('queued','running')`).Scan(&active); err != nil || active != 1 {
		t.Fatalf("active=%d %v", active, err)
	}
	if ok, err := linkprocessing.Publish(t.Context(), f.db, *old, linkprocessing.Result{Reason: "article_unavailable"}); err != nil || ok {
		t.Fatalf("old publish %v %v", ok, err)
	}
	next, err := linkprocessing.Claim(t.Context(), f.db)
	if err != nil || next == nil || next.Generation != 2 {
		t.Fatalf("next %v %v", next, err)
	}
	if ok, err := linkprocessing.Publish(t.Context(), f.db, *next, linkprocessing.Result{Reason: "article_unavailable", Title: "Unavailable"}); err != nil || !ok {
		t.Fatalf("publish %v %v", ok, err)
	}
	// A replay after a lost HTTP response must not retry the completed generation.
	if code := post(token, `{"generation":1}`, "http://localhost:3000"); code != 200 {
		t.Fatal(code)
	}
	libraryCounts(t, f, 1, 2)
	if code := post(token, `{"generation":2}`, "http://localhost:3000"); code != 200 {
		t.Fatal(code)
	}
	libraryCounts(t, f, 1, 3)
	// An enqueue failure must roll back the card transition as well.
	if _, err = f.db.Exec(`UPDATE links SET state='failed' WHERE id=$1`, initial.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = f.db.Exec(fmt.Sprintf(`CREATE FUNCTION reject_retry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'enqueue unavailable'; END $$; CREATE TRIGGER reject_retry BEFORE INSERT ON processing_jobs FOR EACH ROW EXECUTE FUNCTION reject_retry()`)); err != nil {
		t.Fatal(err)
	}
	if code := post(token, `{"generation":3}`, "http://localhost:3000"); code != 500 {
		t.Fatal(code)
	}
	final := decodeLibrary[libraryCard](t, libraryRequest(f, "GET", "/api/links/"+initial.ID, token, "", ""), 200)
	if final.Generation != 3 || final.State != "failed" {
		t.Fatalf("rollback %+v", final)
	}
}

func TestRetryIntegrationSameCardBecomesReady(t *testing.T) {
	for _, state := range []string{"failed", "unavailable"} {
		t.Run(state, func(t *testing.T) {
			f := newRegistrationFixture(t)
			token, _ := librarySession(t, f)
			saved := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/article"), 201).Link
			if _, err := f.db.Exec(`UPDATE links SET state=$2 WHERE id=$1`, saved.ID, state); err != nil {
				t.Fatal(err)
			}
			response := libraryRequest(f, "POST", "/api/links/"+saved.ID+"/retry", token, `{"generation":1}`, "http://localhost:3000")
			retried := decodeLibrary[retryLinkResponse](t, response, 200).Link
			if retried.Generation != 2 || retried.State != "processing" {
				t.Fatalf("%+v", retried)
			}
			e, err := linkprocessing.Claim(t.Context(), f.db)
			if err != nil || e == nil {
				t.Fatal(err)
			}
			doc := correctedRetryDocument()
			if ok, err := linkprocessing.Publish(t.Context(), f.db, *e, linkprocessing.Result{Document: &doc, Title: "Corrected article"}); err != nil || !ok {
				t.Fatalf("%v %v", ok, err)
			}
			current := decodeLibrary[libraryCard](t, libraryRequest(f, "GET", "/api/links/"+saved.ID, token, "", ""), 200)
			if current.ID != saved.ID || !current.CreatedAt.Equal(saved.CreatedAt) || current.State != "ready" {
				t.Fatalf("%+v", current)
			}
			decodeLibrary[map[string]any](t, libraryRequest(f, "GET", "/api/links/"+saved.ID+"/document", token, "", ""), 200)
			if code := libraryRequest(f, "POST", "/api/links/"+saved.ID+"/retry", token, `{"generation":2}`, "http://localhost:3000").Code; code != 409 {
				t.Fatal(code)
			}
			libraryCounts(t, f, 1, 2)
		})
	}
}

func TestRetryIntegrationBudgetIncludesQueueAndRejectsExpiredPublish(t *testing.T) {
	f := newRegistrationFixture(t)
	token, _ := librarySession(t, f)
	saved := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/queued-retry"), 201).Link
	if _, err := f.db.Exec(`UPDATE links SET state='failed' WHERE id=$1`, saved.ID); err != nil {
		t.Fatal(err)
	}
	result := decodeLibrary[retryLinkResponse](t, libraryRequest(f, "POST", "/api/links/"+saved.ID+"/retry", token, `{"generation":1}`, "http://localhost:3000"), 200).Link
	if result.DeadlineAt.Sub(result.RequestedAt) != 120*time.Second {
		t.Fatal("retry budget")
	}
	if _, err := f.db.Exec(`UPDATE links SET requested_at=clock_timestamp()-interval '31 seconds' WHERE id=$1`, saved.ID); err != nil {
		t.Fatal(err)
	}
	waiting := decodeLibrary[libraryCard](t, libraryRequest(f, "GET", "/api/links/"+saved.ID, token, "", ""), 200)
	if waiting.State != "processing" || time.Since(waiting.RequestedAt) < 30*time.Second {
		t.Fatalf("waiting %+v", waiting)
	}
	e, err := linkprocessing.Claim(t.Context(), f.db)
	if err != nil || e == nil {
		t.Fatal(err)
	}
	if _, err := f.db.Exec(`UPDATE links SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=$1`, saved.ID); err != nil {
		t.Fatal(err)
	}
	if ok, err := linkprocessing.Publish(t.Context(), f.db, *e, linkprocessing.Result{Reason: "article_unavailable"}); err != nil || ok {
		t.Fatalf("expired publish %v %v", ok, err)
	}
	failed := decodeLibrary[libraryCard](t, libraryRequest(f, "GET", "/api/links/"+saved.ID, token, "", ""), 200)
	if failed.State != "failed" {
		t.Fatalf("expiry %+v", failed)
	}
	if next, err := linkprocessing.Claim(t.Context(), f.db); err != nil || next != nil {
		t.Fatalf("expired claim %v %v", next, err)
	}
}
