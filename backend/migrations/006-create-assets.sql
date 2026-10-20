-- Additive: previously applied migration checksums remain unchanged.
ALTER TABLE snapshots ADD CONSTRAINT snapshots_link_generation UNIQUE(link_id,generation);
CREATE TABLE assets (
    link_id UUID NOT NULL,
    generation INTEGER NOT NULL CHECK (generation > 0),
    id TEXT NOT NULL CHECK (id ~ '^[a-f0-9]{64}$'),
    mime TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/gif')),
    data BYTEA NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 5242880),
    PRIMARY KEY (link_id,generation,id),
    FOREIGN KEY (link_id,generation) REFERENCES snapshots(link_id,generation) ON DELETE CASCADE
);
