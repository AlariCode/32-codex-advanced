//go:build integration

package worker

import (
	"context"
	"linkbook/linkprocessing"
	"linkbook/worker/internal/safehttp"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"sync/atomic"
	"testing"
	"time"
)

// A separate OS process runs the same worker loop as production, with only the
// exact fixture origin allowed. Killing it cannot cancel the durable SQL job.
func TestRecoveryWorkerProcess(t *testing.T) {
	dsn := os.Getenv("LINKBOOK_WORKER_CHILD_DSN")
	if dsn == "" {
		return
	}
	client, err := safehttp.ForFixture(os.Getenv("LINKBOOK_WORKER_CHILD_ORIGIN"))
	if err != nil {
		t.Fatal(err)
	}
	if err = RunWith(context.Background(), dsn, client); err != nil {
		t.Fatal(err)
	}
}
func TestRecoveryIntegrationKilledWorker(t *testing.T) {
	db := recoveryDB(t)
	var owner, id, schema string
	if err := db.QueryRowContext(t.Context(), `INSERT INTO users(id,email,password_hash) VALUES(gen_random_uuid(),'process@example.com','hash') RETURNING id::text`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	html, err := os.ReadFile("../../../../web/tests/fixtures/article.html")
	if err != nil {
		t.Fatal(err)
	}
	entered := make(chan struct{})
	var hits atomic.Int32
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hits.Add(1) == 1 {
			close(entered)
			<-r.Context().Done()
			return
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write(html)
	}))
	defer fixture.Close()
	if err = db.QueryRowContext(t.Context(), `INSERT INTO links(user_id,submitted_url,fetch_url,dedup_key,dedup_digest,dedup_slot) VALUES($1,$2,$2,'process',decode(repeat('aa',32),'hex'),0) RETURNING id::text`, owner, fixture.URL).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(t.Context(), `INSERT INTO processing_jobs(link_id,generation,deadline_at) SELECT id,generation,deadline_at FROM links WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRowContext(t.Context(), `SELECT current_schema()`).Scan(&schema); err != nil {
		t.Fatal(err)
	}
	dsn, _ := url.Parse(os.Getenv("TEST_DATABASE_URL"))
	q := dsn.Query()
	q.Set("search_path", schema)
	dsn.RawQuery = q.Encode()
	start := func() *exec.Cmd {
		child := exec.Command(os.Args[0], "-test.run=^TestRecoveryWorkerProcess$")
		child.Env = append(os.Environ(), "LINKBOOK_WORKER_CHILD_DSN="+dsn.String(), "LINKBOOK_WORKER_CHILD_ORIGIN="+fixture.URL)
		if err := child.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = child.Process.Kill(); _ = child.Wait() })
		return child
	}
	first := start()
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("worker did not claim")
	}
	var old linkprocessing.Execution
	if err = db.QueryRowContext(t.Context(), `SELECT id::text,link_id::text,generation,execution_token::text,deadline_at FROM processing_jobs WHERE link_id=$1`, id).Scan(&old.JobID, &old.LinkID, &old.Generation, &old.Token, &old.Deadline); err != nil {
		t.Fatal(err)
	}
	if err = first.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = first.Wait()
	// Real time, without editing the stored lease/deadline.
	timer := time.NewTimer(linkprocessing.LeaseDuration + time.Second)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-t.Context().Done():
		t.Fatal(t.Context().Err())
	}
	second := start()
	_ = second
	until := time.Now().Add(10 * time.Second)
	for {
		var state string
		if err = db.QueryRowContext(t.Context(), `SELECT state FROM links WHERE id=$1`, id).Scan(&state); err != nil {
			t.Fatal(err)
		}
		if state == "ready" {
			break
		}
		if time.Now().After(until) {
			t.Fatalf("restart state %s", state)
		}
		time.Sleep(100 * time.Millisecond)
	}
	var executions, snapshots int
	if err = db.QueryRowContext(t.Context(), `SELECT executions,(SELECT count(*) FROM snapshots WHERE link_id=$1) FROM processing_jobs WHERE link_id=$1`, id).Scan(&executions, &snapshots); err != nil {
		t.Fatal(err)
	}
	if executions != 2 || snapshots != 1 {
		t.Fatalf("executions=%d snapshots=%d", executions, snapshots)
	}
	if ok, err := linkprocessing.Renew(t.Context(), db, old); ok || err != nil {
		t.Fatalf("old token renewed: %v %v", ok, err)
	}
	doc := linkprocessing.Document{SchemaVersion: 1, Blocks: []linkprocessing.Block{{Kind: "paragraph", Text: "Stale article"}}}
	if ok, err := linkprocessing.Publish(t.Context(), db, old, linkprocessing.Result{Document: &doc}); ok || err != nil {
		t.Fatalf("late publication: %v %v", ok, err)
	}
}
