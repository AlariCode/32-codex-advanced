//go:build integration

package worker

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"linkbook/linkprocessing"
	"linkbook/worker/internal/safehttp"
)

// Deliberately returns a valid response after cancellation. Local cooperation
// saves work, but is never an authorization to write the deleted archive.
type deletionFetcher struct {
	page                        safehttp.Page
	media                       bool
	entered, cancelled, release chan struct{}
}

func (f *deletionFetcher) wait(ctx context.Context) {
	close(f.entered)
	<-ctx.Done()
	close(f.cancelled)
	<-f.release
}
func (f *deletionFetcher) Fetch(ctx context.Context, _ string) (safehttp.Page, error) {
	if !f.media {
		f.wait(ctx)
	}
	return f.page, nil
}
func (f *deletionFetcher) FetchImage(ctx context.Context, _ string) ([]byte, error) {
	f.wait(ctx)
	return nil, errors.New("external request finished after cancellation")
}

func TestRecoveryIntegrationDeletionCancelsHTMLAndMedia(t *testing.T) {
	for _, media := range []bool{false, true} {
		t.Run(map[bool]string{false: "html", true: "media"}[media], func(t *testing.T) {
			db := recoveryDB(t)
			var owner, id string
			if err := db.QueryRow(`INSERT INTO users(id,email,password_hash) VALUES(gen_random_uuid(),'delete-worker@example.com','hash') RETURNING id::text`).Scan(&owner); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow(`INSERT INTO links(user_id,submitted_url,fetch_url,dedup_key,dedup_digest,dedup_slot) VALUES($1,'https://example.com','https://example.com','delete-worker',decode(repeat('aa',32),'hex'),0) RETURNING id::text`, owner).Scan(&id); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO processing_jobs(link_id,generation,deadline_at) SELECT id,generation,deadline_at FROM links WHERE id=$1`, id); err != nil {
				t.Fatal(err)
			}
			e, err := linkprocessing.Claim(t.Context(), db)
			if err != nil || e == nil {
				t.Fatal(err)
			}
			html, err := os.ReadFile("../../../../web/tests/fixtures/images.html")
			if err != nil {
				t.Fatal(err)
			}
			html = []byte(strings.ReplaceAll(string(html), "@@IMAGES@@", `<figure><img src="https://example.com/image.png" alt="Controlled image"></figure>`))
			f := &deletionFetcher{safehttp.Page{HTML: html, FinalURL: "https://example.com"}, media, make(chan struct{}), make(chan struct{}), make(chan struct{})}
			defer close(f.release)
			parent, cancel := context.WithCancel(t.Context())
			defer cancel()
			done := make(chan error, 1)
			go func() { done <- process(parent, db, f, *e) }()
			select {
			case <-f.entered:
			case <-time.After(5 * time.Second):
				t.Fatal("worker did not reach stage")
			}
			// Claim holds no transaction through either external request.
			if _, err = db.Exec(`DELETE FROM links WHERE id=$1`, id); err != nil {
				t.Fatal(err)
			}
			select {
			case <-f.cancelled:
			case <-time.After(15 * time.Second):
				t.Fatal("deleted task did not cancel context on heartbeat")
			}
			// Return from an uncooperative external request after cancellation.
			f.release <- struct{}{}
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("expected cancellation, got %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("cancelled worker did not return")
			}
			var remaining int
			if err = db.QueryRow(`SELECT (SELECT count(*) FROM links)+(SELECT count(*) FROM processing_jobs)+(SELECT count(*) FROM snapshots)+(SELECT count(*) FROM assets)`).Scan(&remaining); err != nil || remaining != 0 {
				t.Fatalf("deleted archive remains: %d %v", remaining, err)
			}
			var exists string
			if err = db.QueryRow(`SELECT id::text FROM links WHERE id=$1`, id).Scan(&exists); !errors.Is(err, sql.ErrNoRows) {
				t.Fatalf("deleted ID exists: %v", err)
			}
		})
	}
}

type publicationDeadlineFetcher struct{ entered chan struct{} }

func (f publicationDeadlineFetcher) Fetch(context.Context, string) (safehttp.Page, error) {
	close(f.entered)
	return safehttp.Page{}, errors.New("controlled network failure")
}

func TestRecoveryIntegrationDeadlineCancelsBlockedPublication(t *testing.T) {
	db := recoveryDB(t)
	var owner, id string
	if err := db.QueryRow(`INSERT INTO users(id,email,password_hash) VALUES(gen_random_uuid(),'publication-deadline@example.com','hash') RETURNING id::text`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`INSERT INTO links(user_id,submitted_url,fetch_url,dedup_key,dedup_digest,dedup_slot) VALUES($1,'https://example.com','https://example.com','deadline',decode(repeat('aa',32),'hex'),0) RETURNING id::text`, owner).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO processing_jobs(link_id,generation,deadline_at) SELECT id,generation,deadline_at FROM links WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	e, err := linkprocessing.Claim(t.Context(), db)
	if err != nil || e == nil {
		t.Fatal(err)
	}
	// Shorten only this isolated test's durable budget. The real 120 second
	// outage is covered by the process harness without changing SQL clocks.
	if err = db.QueryRow(`WITH timed AS (UPDATE links SET deadline_at=clock_timestamp()+interval '2 seconds' WHERE id=$1 RETURNING deadline_at) UPDATE processing_jobs SET deadline_at=timed.deadline_at FROM timed WHERE link_id=$1 RETURNING processing_jobs.deadline_at`, id).Scan(&e.Deadline); err != nil {
		t.Fatal(err)
	}
	gate, err := db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = gate.Rollback() }()
	if _, err = gate.Exec(`SELECT id FROM links WHERE id=$1 FOR UPDATE`, id); err != nil {
		t.Fatal(err)
	}
	f := publicationDeadlineFetcher{make(chan struct{})}
	done := make(chan error, 1)
	go func() { done <- process(t.Context(), db, f, *e) }()
	<-f.entered
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("blocked publication ignored attempt cancellation")
		}
	case <-time.After(time.Until(e.Deadline) + time.Second):
		t.Fatal("publication extended original deadline")
	}
	if err = gate.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err = linkprocessing.Expire(t.Context(), db, owner); err != nil {
		t.Fatal(err)
	}
	var state, reason, job string
	var archives int
	if err = db.QueryRow(`SELECT l.state,l.reason,j.state,(SELECT count(*) FROM snapshots)+(SELECT count(*) FROM assets) FROM links l JOIN processing_jobs j ON j.link_id=l.id WHERE l.id=$1`, id).Scan(&state, &reason, &job, &archives); err != nil || state != "failed" || reason != "timeout" || job != "failed" || archives != 0 {
		t.Fatalf("late result: %s %s %s archives=%d err=%v", state, reason, job, archives, err)
	}
}
