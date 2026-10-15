package linkprocessing

import (
	"context"
	"database/sql"
	"time"
)

// Renew never revives an expired lease, nor an execution replaced by reclaim.
// SQL clocks and the original durable deadlines remain authoritative.
func Renew(ctx context.Context, db *sql.DB, e Execution) (bool, error) {
	result, err := db.ExecContext(ctx, `UPDATE processing_jobs j SET lease_expires_at=LEAST(j.deadline_at,l.deadline_at,clock_timestamp()+($5*interval '1 second'))
 FROM links l WHERE j.link_id=l.id AND l.id=$1 AND j.id=$2 AND l.generation=$3 AND j.generation=$3 AND j.execution_token=$4
 AND l.state='processing' AND j.state='running' AND j.lease_expires_at>clock_timestamp()
 AND l.deadline_at>clock_timestamp() AND j.deadline_at>clock_timestamp()`, e.LinkID, e.JobID, e.Generation, e.Token, int(LeaseDuration/time.Second))
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count == 1, err
}

// Expire atomically terminates cards and jobs, including queued work. An empty
// owner is used by the API's background sweep, independently of any worker.
func Expire(ctx context.Context, db *sql.DB, owner string) error {
	_, err := db.ExecContext(ctx, `WITH expired AS (
 UPDATE links l SET state='failed',reason='timeout',updated_at=clock_timestamp()
 WHERE l.state='processing' AND ($1='' OR l.user_id::text=$1)
 AND (l.deadline_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM processing_jobs j WHERE j.link_id=l.id AND j.generation=l.generation AND j.deadline_at<=clock_timestamp()))
 RETURNING l.id,l.generation
 ) UPDATE processing_jobs j SET state='failed',last_error='timeout',execution_token=NULL,lease_expires_at=NULL
 FROM expired e WHERE j.link_id=e.id AND j.generation=e.generation AND j.state IN ('queued','running')`, owner)
	return err
}
