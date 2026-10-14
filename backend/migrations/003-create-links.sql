CREATE TABLE links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    submitted_url TEXT NOT NULL,
    fetch_url TEXT NOT NULL,
    dedup_key TEXT NOT NULL,
    dedup_digest BYTEA NOT NULL CHECK (octet_length(dedup_digest) = 32),
    dedup_slot INTEGER NOT NULL CHECK (dedup_slot >= 0),
    final_url TEXT,
    title TEXT,
    reason TEXT,
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
    state TEXT NOT NULL DEFAULT 'processing' CHECK (state IN ('processing','ready','unavailable','failed')),
    generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    deadline_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + INTERVAL '120 seconds',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (user_id, dedup_digest, dedup_slot)
);

-- A digest bucket admits distinct full keys on collision without indexing long URLs.
CREATE INDEX links_library_idx ON links(user_id, created_at DESC, id DESC);
