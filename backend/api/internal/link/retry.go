package link

import (
	"context"
	"errors"

	"linkbook/linkprocessing"
)

var ErrRetryConflict = errors.New("retry_conflict")

// Retry uses the observed generation as an idempotency fence, including when
// the first response was lost and its job has already completed.
func (s *Service) Retry(ctx context.Context, owner, id string, generation int) (Card, error) {
	if err := linkprocessing.Expire(ctx, s.db, owner); err != nil {
		return Card{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Card{}, err
	}
	defer func() { _ = tx.Rollback() }()
	card, err := scanCard(tx.QueryRowContext(ctx, `SELECT `+columns+` FROM links WHERE user_id=$1 AND id=$2 FOR UPDATE`, owner, id))
	if err != nil {
		return Card{}, err
	}
	if generation < card.Generation {
		return card, tx.Commit()
	}
	if generation != card.Generation || (card.State != "failed" && card.State != "unavailable") {
		return Card{}, ErrRetryConflict
	}
	// Revoke any remaining execution before inserting the new job. Everything
	// below rolls back together on enqueue or commit failure.
	_, err = tx.ExecContext(ctx, `UPDATE processing_jobs SET state='failed',execution_token=NULL,lease_expires_at=NULL WHERE link_id=$1 AND state IN ('queued','running')`, id)
	if err != nil {
		return Card{}, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE links SET generation=generation+1,state='processing',reason=NULL,warnings='[]'::jsonb,title=NULL,final_url=NULL WHERE id=$1`, id)
	if err != nil {
		return Card{}, err
	}
	if err = linkprocessing.EnqueueInitial(ctx, tx, id); err != nil {
		return Card{}, err
	}
	// Set the authoritative clock after row locks and enqueue, just before commit.
	_, err = tx.ExecContext(ctx, `WITH started AS MATERIALIZED (SELECT clock_timestamp() AS requested_at), timed AS (
 UPDATE links l SET requested_at=s.requested_at,updated_at=s.requested_at,deadline_at=s.requested_at+($2*interval '1 second') FROM started s WHERE l.id=$1 RETURNING l.id,l.generation,l.requested_at,l.deadline_at
 ) UPDATE processing_jobs j SET available_at=t.requested_at,deadline_at=t.deadline_at FROM timed t WHERE j.link_id=t.id AND j.generation=t.generation`, id, int(linkprocessing.AttemptBudget.Seconds()))
	if err != nil {
		return Card{}, err
	}
	card, err = scanCard(tx.QueryRowContext(ctx, `SELECT `+columns+` FROM links WHERE id=$1`, id))
	if err != nil {
		return Card{}, err
	}
	return card, tx.Commit()
}
