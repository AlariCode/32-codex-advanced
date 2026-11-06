//go:build integration

package worker

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"linkbook/linkprocessing"
	"linkbook/worker/internal/safehttp"
)

func diagnosticSnapshot(t *testing.T, db *sql.DB) map[string]any {
	t.Helper()
	var raw []byte
	if err := db.QueryRowContext(t.Context(), linkprocessing.DiagnosticsSQL).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result
}
func observationJob(t *testing.T, db *sql.DB, source string) string {
	t.Helper()
	var id string
	if err := db.QueryRowContext(t.Context(), `WITH owner AS (INSERT INTO users(id,email,password_hash) VALUES(gen_random_uuid(),gen_random_uuid()::text || '@example.com','SECRET-password') RETURNING id)
 INSERT INTO links(user_id,submitted_url,fetch_url,dedup_key,dedup_digest,dedup_slot)
 SELECT id,$1,$1,$1,decode(repeat('aa',32),'hex'),0 FROM owner RETURNING id::text`, source).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(t.Context(), `INSERT INTO processing_jobs(link_id,generation,deadline_at) SELECT id,generation,deadline_at FROM links WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	return id
}
func observationClaim(t *testing.T, db *sql.DB) linkprocessing.Execution {
	t.Helper()
	e, err := linkprocessing.Claim(t.Context(), db)
	if err != nil || e == nil {
		t.Fatalf("claim: %v", err)
	}
	return *e
}

func TestObservationIntegrationQueueRecovery(t *testing.T) {
	db := recoveryDB(t)
	output := captureObservations(t)
	empty := diagnosticSnapshot(t, db)
	if empty["queue_age_seconds"] != nil || empty["processing"] != float64(0) {
		t.Fatalf("empty: %v", empty)
	}
	id := observationJob(t, db, "https://example.com/SECRET-path?token=SECRET-query")
	if _, err := db.ExecContext(t.Context(), `UPDATE processing_jobs SET available_at=clock_timestamp()-interval '20 seconds' WHERE link_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	queued := diagnosticSnapshot(t, db)
	if queued["queued"] != float64(1) || queued["queue_age_seconds"].(float64) < 20 {
		t.Fatalf("queue: %v", queued)
	}
	old := observationClaim(t, db)
	if old.Number != 1 {
		t.Fatal("initial execution", old.Number)
	}
	if _, err := db.ExecContext(t.Context(), `UPDATE processing_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE link_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if diagnosticSnapshot(t, db)["reclaimable"] != float64(1) {
		t.Fatal("missing reclaimable")
	}
	current := observationClaim(t, db)
	if current.Number != 2 || !current.Deadline.Equal(old.Deadline) {
		t.Fatal("bad reclaim")
	}
	r := linkprocessing.Result{Reason: "network_error", Title: "SECRET-title", FinalURL: "https://example.com/SECRET-final"}
	if ok, err := linkprocessing.Publish(t.Context(), db, old, r); ok || err != nil {
		t.Fatal("stale publication", ok, err)
	}
	if diagnosticSnapshot(t, db)["reclaimed_executions"] != float64(1) {
		t.Fatal("missing reclaimed")
	}
	if _, err := db.ExecContext(t.Context(), `UPDATE processing_jobs SET deadline_at=clock_timestamp()-interval '1 second' WHERE link_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	overdue := diagnosticSnapshot(t, db)
	if overdue["deadline_overdue"] != float64(1) || overdue["running"] != float64(1) {
		t.Fatalf("overdue without worker: %v", overdue)
	}
	if e, err := linkprocessing.Claim(t.Context(), db); e != nil || err != nil {
		t.Fatal("expired claim", err)
	}
	if err := linkprocessing.Expire(t.Context(), db, ""); err != nil {
		t.Fatal(err)
	}
	expired := diagnosticSnapshot(t, db)
	if expired["failed"] != float64(1) || expired["timeout"] != float64(1) || expired["deadline_overdue"] != float64(0) {
		t.Fatalf("expired: %v", expired)
	}
	if ok, err := linkprocessing.Publish(t.Context(), db, current, r); ok || err != nil {
		t.Fatal("deadline publication", ok, err)
	}
	events := observationEvents(t, output, old.Token, current.Token, "SECRET")
	var reclaimed, rejected bool
	for _, event := range events {
		if event["msg"] == "archive_claim" && event["execution"] == float64(2) && event["reclaimed"] == true {
			reclaimed = true
		}
		if event["msg"] == "archive_publication" {
			if event["outcome"] != "rejected" || event["stored_bytes"] != float64(0) {
				t.Fatalf("stale success: %v", event)
			}
			rejected = true
		}
	}
	if !reclaimed || !rejected {
		t.Fatalf("missing events: %v", events)
	}
	raw, _ := json.Marshal(expired)
	if strings.Contains(string(raw), "SECRET") || strings.Contains(string(raw), current.Token) {
		t.Fatal("sensitive diagnostics")
	}
}

func TestObservationIntegrationRealArchiveBytes(t *testing.T) {
	db := recoveryDB(t)
	output := captureObservations(t)
	html, err := os.ReadFile("../../../../web/tests/fixtures/images.html")
	if err != nil {
		t.Fatal(err)
	}
	body := strings.ReplaceAll(string(html), "@@IMAGES@@", `<figure><img src="/images/archive.png?token=SECRET-image"><figcaption>SECRET-caption</figcaption></figure>`)
	files := http.FileServer(http.Dir("../../../../web/tests/fixtures"))
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/images.html" {
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte(body))
			return
		}
		files.ServeHTTP(w, r)
	}))
	defer fixture.Close()
	source := fixture.URL + "/images.html?token=SECRET-query"
	observationJob(t, db, source)
	e := observationClaim(t, db)
	client, err := safehttp.ForFixture(fixture.URL)
	if err != nil {
		t.Fatal(err)
	}
	if err = process(t.Context(), db, client, e); err != nil {
		t.Fatal(err)
	}
	snapshot := diagnosticSnapshot(t, db)
	var documentBytes, mediaBytes int64
	if err = db.QueryRowContext(t.Context(), `SELECT (SELECT sum(octet_length(document::text)) FROM snapshots),(SELECT sum(octet_length(data)) FROM assets)`).Scan(&documentBytes, &mediaBytes); err != nil {
		t.Fatal(err)
	}
	if documentBytes <= 0 || mediaBytes <= 0 || snapshot["stored_bytes"] != float64(documentBytes+mediaBytes) {
		t.Fatalf("bytes: %v", snapshot)
	}
	stages := map[string]bool{}
	var published bool
	for _, event := range observationEvents(t, output, e.Token, "SECRET", "A private illustrated") {
		if event["msg"] == "archive_stage" {
			stages[event["stage"].(string)] = true
			if event["duration_ms"].(float64) < 0 {
				t.Fatal("negative duration")
			}
		}
		if event["msg"] == "archive_publication" {
			published = true
			if event["outcome"] != "ready" || event["document_bytes"] != float64(documentBytes) || event["media_bytes"] != float64(mediaBytes) {
				t.Fatalf("publication: %v", event)
			}
		}
	}
	if !published || !stages["html"] || !stages["extraction"] || !stages["media"] || !stages["attempt"] {
		t.Fatalf("missing stages: %v", stages)
	}

	// A deferred COMMIT failure rolls back the snapshot and media. The log
	// must not report the prepared bytes as saved.
	observationJob(t, db, source)
	second := observationClaim(t, db)
	if _, err = db.ExecContext(t.Context(), `CREATE FUNCTION reject_archive_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SECRET-commit-content'; END $$;
 CREATE CONSTRAINT TRIGGER reject_archive_commit AFTER UPDATE ON links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_archive_commit()`); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	if err = process(t.Context(), db, client, second); err == nil {
		t.Fatal("expected commit error")
	}
	var rollback bool
	for _, event := range observationEvents(t, output, second.Token, "SECRET") {
		if event["msg"] == "archive_publication" {
			rollback = true
			if event["outcome"] != "error" || event["stored_bytes"] != float64(0) {
				t.Fatalf("rollback reported bytes: %v", event)
			}
		}
	}
	if !rollback || diagnosticSnapshot(t, db)["stored_bytes"] != float64(documentBytes+mediaBytes) {
		t.Fatal("rollback storage mismatch")
	}
}

type observationErrorFetcher struct{ err error }

func (f observationErrorFetcher) Fetch(context.Context, string) (safehttp.Page, error) {
	return safehttp.Page{}, f.err
}

func TestObservationIntegrationFailureOutcomes(t *testing.T) {
	for _, outcome := range []string{"failed", "canceled", "deadline", "error"} {
		t.Run(outcome, func(t *testing.T) {
			db := recoveryDB(t)
			output := captureObservations(t)
			observationJob(t, db, "https://example.com/?SECRET-query")
			e := observationClaim(t, db)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			if outcome == "canceled" {
				cancel()
			}
			if outcome == "deadline" {
				e.Deadline = time.Now().Add(-time.Second)
			}
			if outcome == "error" {
				// A database error containing a secret must not enter the log.
				_, err := db.ExecContext(t.Context(), `CREATE FUNCTION reject_observation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SECRET-sql-content'; END $$;
 CREATE TRIGGER reject_observation BEFORE UPDATE ON links FOR EACH ROW EXECUTE FUNCTION reject_observation()`)
				if err != nil {
					t.Fatal(err)
				}
			}
			err := process(ctx, db, observationErrorFetcher{errors.New("SECRET-url-password-dsn-session")}, e)
			if (outcome == "failed") != (err == nil) {
				t.Fatalf("process error: %v", err)
			}
			var got bool
			for _, event := range observationEvents(t, output, e.Token, "SECRET") {
				if event["stage"] == "attempt" {
					got = true
					if event["outcome"] != outcome {
						t.Fatalf("attempt: %v", event)
					}
				}
				if event["msg"] == "archive_publication" && event["stored_bytes"] != float64(0) {
					t.Fatal("failed bytes")
				}
			}
			if !got {
				t.Fatal("missing attempt")
			}
			if outcome == "failed" && diagnosticSnapshot(t, db)["failed"] != float64(1) {
				t.Fatal("missing failed")
			}
		})
	}
}
