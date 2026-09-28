PRAGMA foreign_keys = ON;
CREATE TABLE cards (id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0), content TEXT NOT NULL CHECK(json_valid(content)), status TEXT NOT NULL CHECK(status IN ('draft','ready')), asset_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE usage_counters (day TEXT PRIMARY KEY, uploads INTEGER NOT NULL DEFAULT 0 CHECK(uploads BETWEEN 0 AND 100), sends INTEGER NOT NULL DEFAULT 0 CHECK(sends BETWEEN 0 AND 20), bytes INTEGER NOT NULL DEFAULT 0 CHECK(bytes BETWEEN 0 AND 200000000));
INSERT INTO usage_counters(day) VALUES ('storage');
CREATE TABLE assets (id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), revision INTEGER NOT NULL, snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), kv_key TEXT NOT NULL UNIQUE, public_id TEXT NOT NULL UNIQUE, bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 1048576), state TEXT NOT NULL CHECK(state IN ('uploading','ready','cleanup_needed','deleting','deleted')), created_at INTEGER NOT NULL, usage_day TEXT NOT NULL);
CREATE INDEX assets_card ON assets(card_id, revision);
CREATE TRIGGER assets_quota AFTER INSERT ON assets BEGIN
  INSERT INTO usage_counters(day,uploads) VALUES(NEW.usage_day,1) ON CONFLICT(day) DO UPDATE SET uploads=uploads+1;
  UPDATE usage_counters SET bytes=bytes+NEW.bytes WHERE day='storage';
END;
CREATE TRIGGER assets_release AFTER UPDATE OF state ON assets WHEN NEW.state='deleted' AND OLD.state!='deleted' BEGIN
  UPDATE usage_counters SET bytes=bytes-OLD.bytes WHERE day='storage';
  UPDATE cards SET status='draft',asset_id=NULL WHERE asset_id=OLD.id;
END;
CREATE TABLE schedules (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('once','daily','weekly')), date TEXT NOT NULL, time TEXT NOT NULL, end_date TEXT, weekdays TEXT NOT NULL CHECK(json_valid(weekdays)), cards_per_occurrence INTEGER NOT NULL CHECK(cards_per_occurrence BETWEEN 1 AND 5), timezone TEXT NOT NULL CHECK(timezone='Asia/Seoul'), next_run_at_utc INTEGER, version INTEGER NOT NULL CHECK(version>0), cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor>=0), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), reason TEXT, mutation_id TEXT);
CREATE INDEX schedules_due ON schedules(enabled,next_run_at_utc);
CREATE TRIGGER schedules_insert_limit BEFORE INSERT ON schedules WHEN NEW.enabled=1 AND (SELECT count(*) FROM schedules WHERE enabled=1)>=10 BEGIN SELECT RAISE(ABORT,'active_schedule_limit'); END;
CREATE TRIGGER schedules_update_limit BEFORE UPDATE OF enabled ON schedules WHEN NEW.enabled=1 AND OLD.enabled=0 AND (SELECT count(*) FROM schedules WHERE enabled=1)>=10 BEGIN SELECT RAISE(ABORT,'active_schedule_limit'); END;
CREATE TABLE schedule_items (schedule_id TEXT NOT NULL REFERENCES schedules(id), version INTEGER NOT NULL, position INTEGER NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id), payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(schedule_id,version,position));
CREATE TABLE occurrences (id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES schedules(id), schedule_version INTEGER NOT NULL, due_at_utc INTEGER NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('live','mock')), created_at INTEGER NOT NULL, UNIQUE(schedule_id,schedule_version,due_at_utc));
CREATE TABLE deliveries (id TEXT PRIMARY KEY, occurrence_id TEXT NOT NULL REFERENCES occurrences(id), schedule_id TEXT NOT NULL REFERENCES schedules(id), schedule_version INTEGER NOT NULL, position INTEGER NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id), payload TEXT NOT NULL CHECK(json_valid(payload)), state TEXT NOT NULL CHECK(state IN ('pending','claimed','sending','sent','mock_sent','retry_wait','failed','unknown','cancelled','missed','blocked')), mode TEXT NOT NULL CHECK(mode IN ('mock','live')), due_at_utc INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), auth_retries INTEGER NOT NULL DEFAULT 0 CHECK(auth_retries BETWEEN 0 AND 1), claim_owner TEXT, claim_until INTEGER, retry_at INTEGER, error TEXT, updated_at INTEGER NOT NULL, UNIQUE(occurrence_id,position));
CREATE INDEX deliveries_due ON deliveries(state,retry_at,due_at_utc,position);
CREATE INDEX deliveries_occurrence ON deliveries(occurrence_id,state);
CREATE INDEX deliveries_schedule_state ON deliveries(schedule_id,state);
CREATE INDEX deliveries_asset ON deliveries(asset_id,state);
CREATE TABLE tick_limits (tick INTEGER PRIMARY KEY, sends INTEGER NOT NULL CHECK(sends BETWEEN 0 AND 3));
CREATE TABLE delivery_attempts (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES deliveries(id), claim_owner TEXT NOT NULL, started_at INTEGER NOT NULL, usage_day TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT, mode TEXT NOT NULL CHECK(mode IN ('mock','live')));
CREATE TRIGGER attempts_quota AFTER INSERT ON delivery_attempts BEGIN
  INSERT INTO tick_limits(tick,sends) VALUES(CAST(NEW.started_at / 60000 AS INTEGER),1) ON CONFLICT(tick) DO UPDATE SET sends=sends+1;
  INSERT INTO usage_counters(day,sends) VALUES(NEW.usage_day,1) ON CONFLICT(day) DO UPDATE SET sends=sends+1;
  UPDATE deliveries SET state='sending',attempts=attempts+1,updated_at=NEW.started_at WHERE id=NEW.delivery_id AND state='claimed' AND claim_owner=NEW.claim_owner;
END;
CREATE TABLE manual_decisions (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES deliveries(id), action TEXT NOT NULL CHECK(action IN ('confirm_sent','retry')), created_at INTEGER NOT NULL, warning_accepted INTEGER NOT NULL CHECK(warning_accepted=1));
CREATE TABLE credentials (singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner_id TEXT NOT NULL, access_token TEXT, refresh_token TEXT, expires_at INTEGER NOT NULL, refresh_expires_at INTEGER NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('connected','needs_reconnect','disconnected')), lock_owner TEXT, lock_until INTEGER);
CREATE TABLE auth_state (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('oauth','session')), browser_hash TEXT, csrf TEXT, expires_at INTEGER NOT NULL);
CREATE INDEX auth_expiry ON auth_state(expires_at);
CREATE TABLE dry_runs (id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES schedules(id), due_at_utc INTEGER NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(schedule_id,due_at_utc));
CREATE TRIGGER protect_asset_delete BEFORE DELETE ON assets WHEN
  EXISTS(SELECT 1 FROM schedule_items i JOIN schedules s ON s.id=i.schedule_id AND s.version=i.version WHERE i.asset_id=OLD.id AND (s.enabled=1 OR s.reason IN ('paused','content_shortage')))
  OR EXISTS(SELECT 1 FROM deliveries WHERE asset_id=OLD.id AND state IN ('pending','claimed','sending','retry_wait','unknown','blocked'))
BEGIN SELECT RAISE(ABORT,'asset_in_use'); END;
CREATE TRIGGER protect_asset_state BEFORE UPDATE OF state ON assets WHEN NEW.state='deleting' AND (
  EXISTS(SELECT 1 FROM schedule_items i JOIN schedules s ON s.id=i.schedule_id AND s.version=i.version WHERE i.asset_id=OLD.id AND (s.enabled=1 OR s.reason IN ('paused','content_shortage')))
  OR EXISTS(SELECT 1 FROM deliveries WHERE asset_id=OLD.id AND state IN ('pending','claimed','sending','retry_wait','unknown','blocked')))
BEGIN SELECT RAISE(ABORT,'asset_in_use'); END;

CREATE TRIGGER schedule_asset_ready BEFORE INSERT ON schedule_items WHEN NOT EXISTS(
 SELECT 1 FROM assets a JOIN cards c ON c.id=a.card_id WHERE a.id=NEW.asset_id AND a.state='ready' AND c.status='ready' AND c.revision=a.revision AND c.asset_id=a.id
) BEGIN SELECT RAISE(ABORT,'asset_not_ready'); END;
