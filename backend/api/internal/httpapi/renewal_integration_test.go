//go:build integration

package httpapi

import (
	"linkbook/linkprocessing"
	"testing"
	"time"
)

func TestRecoveryIntegrationRenewalFences(t *testing.T) {
	for _, mutation := range []string{"current", "token", "generation", "expired_lease", "deadline", "job_deadline", "state"} {
		t.Run(mutation, func(t *testing.T) {
			f := newRegistrationFixture(t)
			token, _ := librarySession(t, f)
			saved := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/renewal"), 201).Link
			e, err := linkprocessing.Claim(t.Context(), f.db)
			if err != nil || e == nil {
				t.Fatal(err)
			}
			query := map[string]string{
				"current":       `UPDATE processing_jobs SET deadline_at=clock_timestamp()+interval '20 seconds' WHERE link_id=$1`,
				"token":         `UPDATE processing_jobs SET execution_token=gen_random_uuid() WHERE link_id=$1`,
				"generation":    `UPDATE links SET generation=2 WHERE id=$1`,
				"expired_lease": `UPDATE processing_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE link_id=$1`,
				"deadline":      `UPDATE links SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=$1`,
				"job_deadline":  `UPDATE processing_jobs SET deadline_at=clock_timestamp()-interval '1 second' WHERE link_id=$1`,
				"state":         `UPDATE links SET state='failed' WHERE id=$1`,
			}[mutation]
			if _, err = f.db.ExecContext(t.Context(), query, saved.ID); err != nil {
				t.Fatal(err)
			}
			var lease, deadline time.Time
			if err = f.db.QueryRowContext(t.Context(), `SELECT lease_expires_at,deadline_at FROM processing_jobs WHERE link_id=$1`, saved.ID).Scan(&lease, &deadline); err != nil {
				t.Fatal(err)
			}
			ok, err := linkprocessing.Renew(t.Context(), f.db, *e)
			if err != nil || ok != (mutation == "current") {
				t.Fatalf("renew %v %v", ok, err)
			}
			var after, afterDeadline time.Time
			if err = f.db.QueryRowContext(t.Context(), `SELECT lease_expires_at,deadline_at FROM processing_jobs WHERE link_id=$1`, saved.ID).Scan(&after, &afterDeadline); err != nil {
				t.Fatal(err)
			}
			if !afterDeadline.Equal(deadline) || (mutation == "current" && after.After(deadline)) {
				t.Fatal("renew extended original budget")
			}
			if mutation != "current" && !after.Equal(lease) {
				t.Fatal("invalid execution changed lease")
			}
		})
	}
}

func TestRecoveryIntegrationRestoredAPISweepsAllOwners(t *testing.T) {
	f := newRegistrationFixture(t)
	for i := 0; i < 2; i++ {
		token, _ := librarySession(t, f)
		decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/outage"), 201)
	}
	// No API/worker executes maintenance during the outage. One job was running,
	// one queued; overdue persisted deadlines must both be handled on recovery.
	if e, err := linkprocessing.Claim(t.Context(), f.db); err != nil || e == nil {
		t.Fatal(err)
	}
	if _, err := f.db.ExecContext(t.Context(), `UPDATE links SET deadline_at=clock_timestamp()-interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	if err := linkprocessing.Expire(t.Context(), f.db, ""); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := f.db.QueryRowContext(t.Context(), `SELECT count(*) FROM links l JOIN processing_jobs j ON j.link_id=l.id WHERE l.state='failed' AND l.reason='timeout' AND j.state='failed' AND j.execution_token IS NULL AND j.lease_expires_at IS NULL`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("restored deadlines: %d %v", count, err)
	}
	if e, err := linkprocessing.Claim(t.Context(), f.db); err != nil || e != nil {
		t.Fatalf("expired job revived: %v %v", e, err)
	}
}
