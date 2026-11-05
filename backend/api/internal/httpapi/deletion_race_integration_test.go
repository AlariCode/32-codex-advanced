//go:build integration

package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"image"
	"image/png"
	"strings"
	"sync"
	"testing"
	"time"

	"linkbook/linkprocessing"
)

func deletionArchive() linkprocessing.Result {
	var data bytes.Buffer
	_ = png.Encode(&data, image.NewGray(image.Rect(0, 0, 2, 2)))
	id := strings.Repeat("a", 64)
	return linkprocessing.Result{Title: "Atomic archive", Document: &linkprocessing.Document{SchemaVersion: 2, Blocks: []linkprocessing.Block{{Kind: "paragraph", Text: "An archived article."}, {Kind: "image", AssetID: id}}}, Assets: []linkprocessing.Asset{{ID: id, MIME: "image/png", Data: data.Bytes()}}}
}

// Wait for a database lock dependency, rather than assuming a goroutine reached
// a statement after a sleep. Every wait is bounded and every gate is rolled back.
func deletionWaitBlocked(t *testing.T, db *sql.DB, blocker int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	for {
		var blocked bool
		if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))`, blocker).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("operation did not reach SQL barrier")
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func TestDeleteIntegrationPublishSerialization(t *testing.T) {
	for _, first := range []string{"delete", "publish"} {
		t.Run(first, func(t *testing.T) {
			f := newRegistrationFixture(t)
			token, _ := librarySession(t, f)
			other, _ := librarySession(t, f)
			url := "https://example.com/serialization"
			// Archive another owner's identical URL before opening either gate.
			foreign := decodeLibrary[libraryResult](t, libraryPost(f, other, url), 201).Link
			e, err := linkprocessing.Claim(t.Context(), f.db)
			if err != nil || e == nil {
				t.Fatal(err)
			}
			if ok, err := linkprocessing.Publish(t.Context(), f.db, *e, deletionArchive()); err != nil || !ok {
				t.Fatal(ok, err)
			}
			card := decodeLibrary[libraryResult](t, libraryPost(f, token, url), 201).Link
			e, err = linkprocessing.Claim(t.Context(), f.db)
			if err != nil || e == nil {
				t.Fatal(err)
			}
			gate, err := f.db.BeginTx(t.Context(), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = gate.Rollback() }()
			var pid int
			if err = gate.QueryRow(`SELECT pg_backend_pid()`).Scan(&pid); err != nil {
				t.Fatal(err)
			}
			type publication struct {
				ok  bool
				err error
			}
			published := make(chan publication, 1)
			publish := func() {
				ok, err := linkprocessing.Publish(t.Context(), f.db, *e, deletionArchive())
				published <- publication{ok, err}
			}
			deleted := make(chan int, 1)
			remove := func() {
				deleted <- libraryRequest(f, "DELETE", "/api/links/"+card.ID, token, "", "http://localhost:3000").Code
			}
			if first == "delete" {
				if _, err = gate.Exec(`DELETE FROM links WHERE id=$1`, card.ID); err != nil {
					t.Fatal(err)
				}
				go publish()
				deletionWaitBlocked(t, f.db, pid)
				if err = gate.Commit(); err != nil {
					t.Fatal(err)
				}
				result := <-published
				if result.ok || result.err != nil {
					t.Fatal(result)
				}
			} else {
				// Pause at deferred COMMIT with snapshot, media and ready state all written
				// but invisible. DELETE must wait for the publishing transaction.
				if _, err = f.db.Exec(`CREATE FUNCTION publication_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(190019,1); RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER publication_gate AFTER INSERT ON snapshots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION publication_gate()`); err != nil {
					t.Fatal(err)
				}
				if _, err = gate.Exec(`SELECT pg_advisory_xact_lock(190019,1)`); err != nil {
					t.Fatal(err)
				}
				go publish()
				deletionWaitBlocked(t, f.db, pid)
				var publisher int
				if err = f.db.QueryRow(`SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) LIMIT 1`, pid).Scan(&publisher); err != nil {
					t.Fatal(err)
				}
				var snapshots, assets int
				if err = f.db.QueryRow(`SELECT (SELECT count(*) FROM snapshots WHERE link_id=$1),(SELECT count(*) FROM assets WHERE link_id=$1)`, card.ID).Scan(&snapshots, &assets); err != nil || snapshots != 0 || assets != 0 {
					t.Fatalf("partial archive: %d %d %v", snapshots, assets, err)
				}
				go remove()
				deletionWaitBlocked(t, f.db, publisher)
				if err = gate.Commit(); err != nil {
					t.Fatal(err)
				}
				result := <-published
				if !result.ok || result.err != nil {
					t.Fatal(result)
				}
				if status := <-deleted; status != 204 {
					t.Fatal(status)
				}
			}
			for _, table := range []string{"processing_jobs", "snapshots", "assets"} {
				var count int
				if err = f.db.QueryRow(`SELECT count(*) FROM `+table+` WHERE link_id=$1`, card.ID).Scan(&count); err != nil || count != 0 {
					t.Fatalf("%s remains %d %v", table, count, err)
				}
			}
			decodeLibrary[map[string]any](t, libraryRequest(f, "GET", "/api/links/"+foreign.ID+"/document", other, "", ""), 200)
			replacement := decodeLibrary[libraryResult](t, libraryPost(f, token, url), 201).Link
			if replacement.ID == card.ID {
				t.Fatal("deleted ID reused")
			}
		})
	}
}

func TestDeleteIntegrationConcurrentRetryAddAndClaim(t *testing.T) {
	f := newRegistrationFixture(t)
	token, _ := librarySession(t, f)
	url := "https://example.com/retry-delete-race"
	card := decodeLibrary[libraryResult](t, libraryPost(f, token, url), 201).Link
	old, err := linkprocessing.Claim(t.Context(), f.db)
	if err != nil || old == nil {
		t.Fatal(err)
	}
	if _, err = f.db.Exec(`UPDATE links SET state='failed',reason='network_error' WHERE id=$1`, card.ID); err != nil {
		t.Fatal(err)
	}
	gate, err := f.db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = gate.Rollback() }()
	var pid int
	if err = gate.QueryRow(`SELECT pg_backend_pid() FROM links WHERE id=$1 FOR UPDATE`, card.ID).Scan(&pid); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Go(func() {
		<-start
		status := libraryRequest(f, "POST", "/api/links/"+card.ID+"/retry", token, `{"generation":1}`, "http://localhost:3000").Code
		if status != 200 && status != 404 {
			t.Errorf("retry: %d", status)
		}
	})
	wg.Go(func() {
		<-start
		if status := libraryRequest(f, "DELETE", "/api/links/"+card.ID, token, "", "http://localhost:3000").Code; status != 204 {
			t.Errorf("delete: %d", status)
		}
	})
	for range 4 {
		wg.Go(func() {
			<-start
			r := libraryPost(f, token, url)
			if r.Code != 200 && r.Code != 201 {
				t.Errorf("add: %d", r.Code)
			}
		})
	}
	for range 2 {
		wg.Go(func() {
			<-start
			if _, err := linkprocessing.Claim(t.Context(), f.db); err != nil {
				t.Error(err)
			}
		})
	}
	close(start)
	deletionWaitBlocked(t, f.db, pid)
	if err = gate.Commit(); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	response := libraryPost(f, token, url)
	if response.Code != 200 && response.Code != 201 {
		t.Fatal(response.Code)
	}
	replacement := decodeLibrary[libraryResult](t, response, response.Code).Link
	if replacement.ID == card.ID {
		t.Fatal("resurrected deleted card")
	}
	if ok, err := linkprocessing.Publish(t.Context(), f.db, *old, deletionArchive()); ok || err != nil {
		t.Fatal(ok, err)
	}
	var links, active, archives int
	if err = f.db.QueryRow(`SELECT (SELECT count(*) FROM links),(SELECT count(*) FROM processing_jobs WHERE state IN ('queued','running')),(SELECT count(*) FROM snapshots)+(SELECT count(*) FROM assets)`).Scan(&links, &active, &archives); err != nil || links != 1 || active != 1 || archives != 0 {
		t.Fatalf("links=%d active=%d archives=%d err=%v", links, active, archives, err)
	}
}

func TestDeleteIntegrationArchiveCommitRollback(t *testing.T) {
	f := newRegistrationFixture(t)
	token, _ := librarySession(t, f)
	card := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/atomic-media"), 201).Link
	e, err := linkprocessing.Claim(t.Context(), f.db)
	if err != nil || e == nil {
		t.Fatal(err)
	}
	if _, err = f.db.Exec(`CREATE FUNCTION reject_media_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'media commit rejected'; END $$; CREATE CONSTRAINT TRIGGER reject_media_commit AFTER INSERT ON assets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_media_commit()`); err != nil {
		t.Fatal(err)
	}
	if ok, err := linkprocessing.Publish(t.Context(), f.db, *e, deletionArchive()); ok || err == nil {
		t.Fatalf("commit failure accepted: %v %v", ok, err)
	}
	var state, job, tokenAfter string
	var snapshots, assets int
	if err = f.db.QueryRow(`SELECT l.state,j.state,j.execution_token::text,(SELECT count(*) FROM snapshots WHERE link_id=l.id),(SELECT count(*) FROM assets WHERE link_id=l.id) FROM links l JOIN processing_jobs j ON j.link_id=l.id WHERE l.id=$1`, card.ID).Scan(&state, &job, &tokenAfter, &snapshots, &assets); err != nil {
		t.Fatal(err)
	}
	if state != "processing" || job != "running" || tokenAfter != e.Token || snapshots != 0 || assets != 0 {
		t.Fatalf("non-atomic rollback: %s %s %d %d", state, job, snapshots, assets)
	}
	if _, err = f.db.Exec(`DROP TRIGGER reject_media_commit ON assets`); err != nil {
		t.Fatal(err)
	}
	if ok, err := linkprocessing.Publish(t.Context(), f.db, *e, deletionArchive()); !ok || err != nil {
		t.Fatal(ok, err)
	}
}

func TestDeleteIntegrationConcurrentPublicationsKeepCurrentGeneration(t *testing.T) {
	f := newRegistrationFixture(t)
	token, _ := librarySession(t, f)
	card := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/generation-race"), 201).Link
	old, err := linkprocessing.Claim(t.Context(), f.db)
	if err != nil || old == nil {
		t.Fatal(err)
	}
	if _, err = f.db.Exec(`UPDATE links SET state='failed',reason='network_error' WHERE id=$1`, card.ID); err != nil {
		t.Fatal(err)
	}
	decodeLibrary[retryLinkResponse](t, libraryRequest(f, "POST", "/api/links/"+card.ID+"/retry", token, `{"generation":1}`, "http://localhost:3000"), 200)
	current, err := linkprocessing.Claim(t.Context(), f.db)
	if err != nil || current == nil || current.Generation != 2 {
		t.Fatal(err)
	}
	start := make(chan struct{})
	type outcome struct {
		stale, ok bool
		err       error
	}
	results := make(chan outcome, 8)
	var wg sync.WaitGroup
	for i := range 8 {
		stale := i%2 == 0
		execution := *current
		if stale {
			execution = *old
		}
		wg.Go(func() {
			<-start
			result := deletionArchive()
			result.Title = "Current generation"
			if stale {
				result.Title = "Obsolete generation"
			}
			ok, err := linkprocessing.Publish(t.Context(), f.db, execution, result)
			results <- outcome{stale, ok, err}
		})
	}
	close(start)
	wg.Wait()
	close(results)
	winners := 0
	for r := range results {
		if r.err != nil || (r.stale && r.ok) {
			t.Fatalf("stale=%v published=%v err=%v", r.stale, r.ok, r.err)
		}
		if r.ok {
			winners++
		}
	}
	if winners != 1 {
		t.Fatalf("%d publishers won", winners)
	}
	var generation, snapshots, assets, active int
	var title string
	if err = f.db.QueryRow(`SELECT generation,title,(SELECT count(*) FROM snapshots WHERE link_id=$1),(SELECT count(*) FROM assets WHERE link_id=$1),(SELECT count(*) FROM processing_jobs WHERE link_id=$1 AND state IN ('queued','running')) FROM links WHERE id=$1`, card.ID).Scan(&generation, &title, &snapshots, &assets, &active); err != nil || generation != 2 || title != "Current generation" || snapshots != 1 || assets != 1 || active != 0 {
		t.Fatalf("generation=%d title=%s snapshots=%d assets=%d active=%d err=%v", generation, title, snapshots, assets, active, err)
	}
}
