CREATE TABLE snapshots (
    link_id UUID PRIMARY KEY REFERENCES links(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL CHECK (generation > 0),
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
    extracted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Deferred so snapshot and state can be written in either order in one commit.
CREATE FUNCTION require_ready_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM links l WHERE l.id = NEW.id AND l.state = 'ready'
        AND NOT EXISTS (SELECT 1 FROM snapshots s WHERE s.link_id=l.id AND s.generation=l.generation)) THEN
        RAISE EXCEPTION 'ready requires a current snapshot';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER links_ready_snapshot AFTER INSERT OR UPDATE ON links
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_ready_snapshot();

CREATE FUNCTION preserve_ready_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM links l WHERE l.id = OLD.link_id AND l.state = 'ready'
        AND NOT EXISTS (SELECT 1 FROM snapshots s WHERE s.link_id=l.id AND s.generation=l.generation)) THEN
        RAISE EXCEPTION 'ready requires a current snapshot';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER snapshots_ready_link AFTER UPDATE OR DELETE ON snapshots
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION preserve_ready_snapshot();
