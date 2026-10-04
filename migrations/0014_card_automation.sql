CREATE TABLE automation_settings (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), settings TEXT NOT NULL CHECK(json_valid(settings)),
  version INTEGER NOT NULL CHECK(version>0), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  reason TEXT, next_due_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE automation_runs (
  id TEXT PRIMARY KEY, day TEXT NOT NULL UNIQUE, config_version INTEGER NOT NULL,
  settings TEXT NOT NULL CHECK(json_valid(settings)), due_at INTEGER NOT NULL, deadline INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','review','revise','render','schedule','scheduled','skipped','cancelled')),
  writer TEXT NOT NULL CHECK(writer IN ('google','groq')), reviewer TEXT NOT NULL CHECK(reviewer IN ('google','groq') AND reviewer!=writer),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision IN (1,2)), content TEXT CHECK(content IS NULL OR json_valid(content)),
  content_hash TEXT, review TEXT CHECK(review IS NULL OR json_valid(review)), review_hash TEXT,
  card_id TEXT NOT NULL UNIQUE, asset_id TEXT NOT NULL UNIQUE, public_id TEXT NOT NULL UNIQUE, schedule_id TEXT NOT NULL UNIQUE,
  claim_owner TEXT, claim_until INTEGER, retry_at INTEGER, error TEXT, updated_at INTEGER NOT NULL,
  render_attempts INTEGER NOT NULL DEFAULT 0 CHECK(render_attempts BETWEEN 0 AND 3),
  CHECK(status NOT IN ('render','schedule','scheduled') OR (content_hash IS NOT NULL AND review_hash IS NOT NULL AND review_hash=content_hash))
);
CREATE INDEX automation_runs_pending ON automation_runs(status,retry_at,due_at);
CREATE TRIGGER automation_schedule_managed BEFORE UPDATE OF version ON schedules WHEN NEW.version!=OLD.version AND EXISTS(SELECT 1 FROM automation_runs WHERE schedule_id=OLD.id) BEGIN SELECT RAISE(ABORT,'automation_schedule_managed'); END;
CREATE TABLE automation_attempts (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES automation_runs(id), stage TEXT NOT NULL,
  revision INTEGER NOT NULL, provider TEXT NOT NULL, started_at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('started','ok','auth','quota','unavailable','invalid','config')),
  http_status INTEGER
);
CREATE INDEX automation_attempt_run ON automation_attempts(run_id,stage,revision,provider);
CREATE TABLE automation_expressions (expression_key TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES automation_runs(id));
ALTER TABLE cards ADD COLUMN review_source TEXT CHECK(review_source IS NULL OR review_source IN ('human','ai'));
UPDATE cards SET review_source='human' WHERE status='ready';
CREATE TRIGGER automation_card_draft AFTER UPDATE OF content ON cards WHEN NEW.revision!=OLD.revision BEGIN UPDATE cards SET review_source=NULL WHERE id=NEW.id; END;
CREATE TRIGGER automation_card_human AFTER UPDATE OF status,asset_id ON cards WHEN NEW.status='ready' AND NEW.review_source IS NULL BEGIN UPDATE cards SET review_source='human' WHERE id=NEW.id; END;
CREATE TRIGGER automation_asset_delete BEFORE DELETE ON assets WHEN EXISTS(SELECT 1 FROM automation_runs WHERE asset_id=OLD.id AND status IN ('render','schedule')) BEGIN SELECT RAISE(ABORT,'asset_in_use'); END;
CREATE TRIGGER automation_asset_deleting BEFORE UPDATE OF state ON assets WHEN NEW.state='deleting' AND EXISTS(SELECT 1 FROM automation_runs WHERE asset_id=OLD.id AND status IN ('render','schedule')) BEGIN SELECT RAISE(ABORT,'asset_in_use'); END;
CREATE TRIGGER automation_send_guard BEFORE INSERT ON delivery_attempts WHEN EXISTS(SELECT 1 FROM automation_runs r JOIN deliveries d ON d.schedule_id=r.schedule_id WHERE d.id=NEW.delivery_id) AND (
 NOT EXISTS(SELECT 1 FROM automation_runs r JOIN deliveries d ON d.schedule_id=r.schedule_id JOIN automation_settings c ON c.singleton=1 AND c.version=r.config_version AND c.enabled=1 WHERE d.id=NEW.delivery_id AND r.status='scheduled')
 OR EXISTS(SELECT 1 FROM deliveries d JOIN automation_runs r ON r.schedule_id=d.schedule_id WHERE d.id!=NEW.delivery_id AND (d.state='sending' OR (d.state='unknown' AND d.resolution IS NULL)))
) BEGIN SELECT RAISE(ABORT,'automation_send_blocked'); END;
