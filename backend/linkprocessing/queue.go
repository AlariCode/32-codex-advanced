// Package linkprocessing defines the durable queue boundary shared by API and worker.
package linkprocessing

import (
	"context"
	"database/sql"
	"time"
)

const AttemptBudget = 120 * time.Second

// EnqueueInitial participates in the caller's transaction. No session or URL is
// copied to a job: the worker will resolve the link and its generation from SQL.
func EnqueueInitial(ctx context.Context, tx *sql.Tx, linkID string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO processing_jobs(link_id,generation,deadline_at) SELECT id,generation,deadline_at FROM links WHERE id=$1`, linkID)
	return err
}

// StartInitialBudget runs after enqueue, immediately before commit, so time spent
// waiting for locks or inserting a job does not consume the processing budget.
func StartInitialBudget(ctx context.Context, tx *sql.Tx, linkID string) error {
	_, err := tx.ExecContext(ctx, `WITH started AS MATERIALIZED (SELECT clock_timestamp() AS requested_at), timed AS (
 UPDATE links l SET requested_at=s.requested_at,updated_at=s.requested_at,
 deadline_at=s.requested_at + ($2 * interval '1 second') FROM started s WHERE l.id=$1
 RETURNING l.id,l.requested_at,l.deadline_at
 ) UPDATE processing_jobs j SET available_at=t.requested_at,deadline_at=t.deadline_at FROM timed t WHERE j.link_id=t.id AND j.generation=1`, linkID, int(AttemptBudget/time.Second))
	return err
}
