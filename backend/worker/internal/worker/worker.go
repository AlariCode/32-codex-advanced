package worker

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/url"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"linkbook/linkprocessing"
	"linkbook/worker/internal/extract"
	"linkbook/worker/internal/safehttp"
)

type Fetcher interface {
	Fetch(context.Context, string) (safehttp.Page, error)
}

func Run(ctx context.Context) error { return RunWith(ctx, os.Getenv("DATABASE_URL"), safehttp.New()) }

// RunWith is also the integration harness composition root. The production
// command always constructs safehttp.New(), without network-policy overrides.
func RunWith(ctx context.Context, dsn string, client Fetcher) error {
	if dsn == "" {
		return errors.New("DATABASE_URL is required")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		return errors.New("invalid DATABASE_URL")
	}
	db := stdlib.OpenDB(*config)
	defer func() { _ = db.Close() }()
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	if err = waitSchema(ctx, db); err != nil {
		return err
	}
	slog.Info("Worker started")
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	idle := false
	for {
		if ctx.Err() != nil {
			return nil
		}
		exec, err := linkprocessing.Claim(ctx, db)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			slog.Error("Worker claim failed")
			select {
			case <-ctx.Done():
				return nil
			case <-ticker.C:
			}
			continue
		}
		if exec == nil {
			if !idle {
				slog.Info("archive_idle")
				idle = true
			}
			select {
			case <-ctx.Done():
				return nil
			case <-ticker.C:
			}
			continue
		}
		idle = false
		_ = process(ctx, db, client, *exec)
	}
}
func process(parent context.Context, db *sql.DB, client Fetcher, e linkprocessing.Execution) (processErr error) {
	started := time.Now()
	outcome := "error"
	defer func() {
		if processErr != nil {
			outcome = linkprocessing.ErrorOutcome(processErr)
		}
		e.Stage("attempt", outcome, started)
	}()

	ctx, cancel := context.WithDeadline(parent, e.Deadline)
	defer cancel()
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				renewCtx, stop := context.WithTimeout(ctx, 5*time.Second)
				ok, err := linkprocessing.Renew(renewCtx, db, e)
				stop()
				if err != nil || !ok {
					status := linkprocessing.ErrorOutcome(err)
					if err == nil {
						status = "rejected"
					}
					e.Log("archive_renewal", "outcome", status)
					cancel()
					return
				}
			}
		}
	}()
	defer func() { cancel(); <-heartbeatDone }()
	stageStart := time.Now()
	page, err := client.Fetch(ctx, e.FetchURL)
	stageErr := err
	if ctx.Err() != nil {
		stageErr = ctx.Err()
	}
	e.Stage("html", linkprocessing.ErrorOutcome(stageErr), stageStart)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	stageStart = time.Now()
	result := pageResult(page, err)
	extractionOutcome := "skipped"
	if err == nil {
		extractionOutcome = "failed"
		if result.Document != nil {
			extractionOutcome = "ready"
		} else if result.Reason == "article_unavailable" {
			extractionOutcome = "unavailable"
		}
	}
	if ctx.Err() != nil {
		extractionOutcome = linkprocessing.ErrorOutcome(ctx.Err())
	}
	e.Stage("extraction", extractionOutcome, stageStart)
	if result.Title == "" {
		if u, err := url.Parse(e.FetchURL); err == nil {
			result.Title = u.Hostname()
		}
	}
	images, _ := client.(ImageFetcher)
	stageStart = time.Now()
	archiveImages(ctx, images, &result)
	mediaOutcome := "skipped"
	if result.Document != nil {
		mediaOutcome = "ok"
		for _, warning := range result.Warnings {
			if warning == "images_omitted" {
				mediaOutcome = "partial"
			}
		}
	}
	if ctx.Err() != nil {
		mediaOutcome = linkprocessing.ErrorOutcome(ctx.Err())
	}
	e.Stage("media", mediaOutcome, stageStart)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	// Keep the original attempt deadline and heartbeat cancellation through COMMIT,
	// including time spent waiting for SQL locks. SQL fences remain authoritative.
	commitCtx, cancelCommit := context.WithTimeout(ctx, 5*time.Second)
	defer cancelCommit()
	published, err := linkprocessing.Publish(commitCtx, db, e, result)
	outcome = "rejected"
	if published {
		outcome = "failed"
		if result.Document != nil {
			outcome = "ready"
		} else if result.Reason == "article_unavailable" {
			outcome = "unavailable"
		}
	}
	return err
}
func waitSchema(ctx context.Context, db *sql.DB) error {
	deadline := time.NewTimer(60 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	warned := false
	for {
		probe, cancel := context.WithTimeout(ctx, 2*time.Second)
		var compatible bool
		err := db.QueryRowContext(probe, `SELECT to_regclass('links') IS NOT NULL AND to_regclass('processing_jobs') IS NOT NULL AND to_regclass('snapshots') IS NOT NULL AND to_regclass('assets') IS NOT NULL`).Scan(&compatible)
		if err == nil && compatible {
			// Parse all required fields; an older/incompatible shape is not accepted.
			_, err = db.ExecContext(probe, `SELECT l.fetch_url,l.generation,l.deadline_at,j.execution_token,j.lease_expires_at,s.schema_version,s.document FROM links l LEFT JOIN processing_jobs j ON j.link_id=l.id LEFT JOIN snapshots s ON s.link_id=l.id LIMIT 0`)
			if err == nil {
				cancel()
				return nil
			}
		}
		cancel()
		if !warned {
			slog.Warn("Waiting for PostgreSQL and compatible migrations 001–006; start the API to apply migrations")
			warned = true
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return errors.New("PostgreSQL schema unavailable or incompatible; API must apply migrations 001–006")
		case <-ticker.C:
		}
	}
}

// A bounded HTML prefix is useful only if extraction found article text.
// Transport/parser failures retain their technical classification.
func pageResult(page safehttp.Page, fetchErr error) linkprocessing.Result {
	if fetchErr != nil {
		return linkprocessing.Result{Reason: safehttp.Code(fetchErr)}
	}
	r, err := extract.Article(page.HTML, page.FinalURL)
	if err != nil {
		return linkprocessing.Result{Reason: "processing_error"}
	}
	if page.Truncated && r.Document != nil {
		r.Warnings = append(r.Warnings, "html_truncated")
	}
	return r
}
