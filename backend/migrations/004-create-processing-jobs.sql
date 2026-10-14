CREATE TABLE processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id UUID NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL CHECK (generation > 0),
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','failed')),
    available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    lease_expires_at TIMESTAMPTZ,
    execution_token UUID,
    deadline_at TIMESTAMPTZ NOT NULL,
    executions INTEGER NOT NULL DEFAULT 0 CHECK (executions >= 0),
    last_error TEXT,
    UNIQUE (link_id,generation),
    CHECK ((state = 'running') = (execution_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX processing_jobs_available_idx ON processing_jobs(available_at,id) WHERE state = 'queued';
CREATE INDEX processing_jobs_lease_idx ON processing_jobs(lease_expires_at) WHERE state = 'running';
CREATE INDEX processing_jobs_deadline_idx ON processing_jobs(deadline_at) WHERE state IN ('queued','running');
