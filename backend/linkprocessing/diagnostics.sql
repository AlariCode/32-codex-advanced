-- Read-only, one MVCC snapshot; safe to run with API and worker stopped.
WITH observed AS MATERIALIZED (SELECT clock_timestamp() AS at),
current_jobs AS MATERIALIZED (
 SELECT j.*,l.state AS link_state,LEAST(l.deadline_at,j.deadline_at) AS effective_deadline
 FROM processing_jobs j JOIN links l ON l.id=j.link_id AND l.generation=j.generation
),
storage AS (
 SELECT COALESCE((SELECT sum(octet_length(document::text)) FROM snapshots),0)::bigint AS document_bytes,
        COALESCE((SELECT sum(octet_length(data)) FROM assets),0)::bigint AS media_bytes
)
SELECT jsonb_build_object(
 'observed_at',o.at,
 'processing',(SELECT count(*) FROM links WHERE state='processing'),
 'queued',(SELECT count(*) FROM current_jobs WHERE state='queued' AND link_state='processing'),
 'running',(SELECT count(*) FROM current_jobs WHERE state='running' AND link_state='processing'),
 'queue_age_seconds',(SELECT max(GREATEST(0,EXTRACT(EPOCH FROM (o.at-available_at)))) FROM current_jobs WHERE state='queued' AND link_state='processing'),
 'deadline_overdue',(SELECT count(*) FROM current_jobs WHERE link_state='processing' AND state IN ('queued','running') AND effective_deadline<=o.at),
 'failed',(SELECT count(*) FROM links WHERE state='failed'),
 'timeout',(SELECT count(*) FROM links WHERE state='failed' AND reason='timeout'),
 'reclaimable',(SELECT count(*) FROM current_jobs WHERE link_state='processing' AND state='running' AND lease_expires_at<=o.at AND effective_deadline>o.at AND available_at<=o.at),
 'reclaimed_executions',(SELECT COALESCE(sum(GREATEST(executions-1,0)),0) FROM processing_jobs),
 'document_bytes',s.document_bytes,'media_bytes',s.media_bytes,'stored_bytes',s.document_bytes+s.media_bytes,
 'jobs',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'job_id',j.id,'link_id',j.link_id,'generation',j.generation,'execution',j.executions,
   'state',j.state,'link_state',j.link_state,'available_at',j.available_at,
   'age_seconds',GREATEST(0,EXTRACT(EPOCH FROM (o.at-j.available_at))),
   'deadline_at',j.effective_deadline,'deadline_remaining_seconds',EXTRACT(EPOCH FROM (j.effective_deadline-o.at)),
   'lease_expires_at',j.lease_expires_at
 ) ORDER BY j.available_at,j.id) FROM current_jobs j WHERE j.state IN ('queued','running','failed')), '[]'::jsonb)
) AS archive_diagnostics
FROM observed o CROSS JOIN storage s;
