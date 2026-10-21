package linkprocessing

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

const LeaseDuration = 45 * time.Second

type Execution struct {
	JobID, LinkID, FetchURL, Token string
	Generation                     int
	Deadline                       time.Time
}

// Claim commits before returning; neither the SQL transaction nor a connection
// is retained during HTTP or extraction. Reclaim preserves the attempt deadline.
func Claim(ctx context.Context, db *sql.DB) (*Execution, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var e Execution
	err = tx.QueryRowContext(ctx, `SELECT j.id::text,l.id::text,l.fetch_url,j.generation,LEAST(j.deadline_at,l.deadline_at)
 FROM processing_jobs j JOIN links l ON l.id=j.link_id
	WHERE (j.state='queued' OR (j.state='running' AND j.lease_expires_at<=clock_timestamp())) AND l.state='processing' AND j.generation=l.generation
 AND j.available_at<=clock_timestamp() AND j.deadline_at>clock_timestamp() AND l.deadline_at>clock_timestamp()
 ORDER BY j.available_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1`).Scan(&e.JobID, &e.LinkID, &e.FetchURL, &e.Generation, &e.Deadline)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	err = tx.QueryRowContext(ctx, `UPDATE processing_jobs SET state='running',execution_token=gen_random_uuid(),
 lease_expires_at=LEAST(deadline_at,$3,clock_timestamp()+($2*interval '1 second')),executions=executions+1 WHERE id=$1 RETURNING execution_token::text`, e.JobID, int(LeaseDuration/time.Second), e.Deadline).Scan(&e.Token)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return &e, nil
}

// Publish locks the card and execution in a short transaction and repeats the
// fences in the final UPDATE. A deferred-constraint/commit failure rolls back all
// changes, including the snapshot and job completion.
func Publish(ctx context.Context, db *sql.DB, e Execution, r Result) (bool, error) {
	var raw []byte
	var err error
	if r.Document != nil {
		if err = ValidateDocument(*r.Document); err != nil {
			return false, err
		}
		raw, err = json.Marshal(r.Document)
		if err != nil {
			return false, err
		}
	} else {
		switch r.Reason {
		case "article_unavailable", "destination_blocked", "network_error", "http_error", "html_too_large", "unsupported_content", "redirect_limit", "processing_error":
		default:
			return false, errors.New("invalid processing reason")
		}
	}
	if err := validateAssets(r); err != nil {
		return false, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	var id string
	err = tx.QueryRowContext(ctx, `SELECT l.id::text FROM links l JOIN processing_jobs j ON j.link_id=l.id
 WHERE l.id=$1 AND j.id=$2 AND l.generation=$3 AND j.generation=$3 AND j.execution_token=$4
 AND l.state='processing' AND j.state='running' AND l.deadline_at>clock_timestamp()
 AND j.deadline_at>clock_timestamp() AND j.lease_expires_at>clock_timestamp() FOR UPDATE OF l,j`, e.LinkID, e.JobID, e.Generation, e.Token).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	warnings := r.Warnings
	if warnings == nil {
		warnings = []string{}
	}
	warn, _ := json.Marshal(warnings)
	state, jobState := "failed", "failed"
	if r.Document == nil && r.Reason == "article_unavailable" {
		state, jobState = "unavailable", "completed"
	}
	if r.Document != nil {
		state, jobState = "ready", "completed"
		_, err = tx.ExecContext(ctx, `INSERT INTO snapshots(link_id,generation,schema_version,document) VALUES($1,$2,$3,$4)`, e.LinkID, e.Generation, r.Document.SchemaVersion, raw)
		if err != nil {
			return false, err
		}
	}
	for _, a := range r.Assets {
		if _, err = tx.ExecContext(ctx, `INSERT INTO assets(link_id,generation,id,mime,data) VALUES($1,$2,$3,$4,$5)`, e.LinkID, e.Generation, a.ID, a.MIME, a.Data); err != nil {
			return false, err
		}
	}
	result, err := tx.ExecContext(ctx, `UPDATE links l SET state=$5,title=NULLIF($6,''),final_url=NULLIF($7,''),reason=NULLIF($8,''),warnings=$9,updated_at=clock_timestamp()
 FROM processing_jobs j WHERE l.id=$1 AND j.id=$2 AND j.link_id=l.id AND l.generation=$3 AND j.generation=$3 AND j.execution_token=$4
 AND l.state='processing' AND j.state='running' AND l.deadline_at>clock_timestamp() AND j.deadline_at>clock_timestamp() AND j.lease_expires_at>clock_timestamp()`, e.LinkID, e.JobID, e.Generation, e.Token, state, r.Title, r.FinalURL, r.Reason, warn)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if count != 1 {
		return false, nil
	}
	_, err = tx.ExecContext(ctx, `UPDATE processing_jobs SET state=$2,execution_token=NULL,lease_expires_at=NULL,last_error=NULLIF($3,'') WHERE id=$1`, e.JobID, jobState, r.Reason)
	if err != nil {
		return false, err
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}
