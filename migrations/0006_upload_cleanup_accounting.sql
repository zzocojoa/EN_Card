ALTER TABLE assets ADD COLUMN cleanup_owner TEXT;
DROP TRIGGER assets_quota;
DROP TRIGGER assets_release;
DROP TRIGGER attempts_quota;
CREATE TABLE usage_counters_next (day TEXT PRIMARY KEY, uploads INTEGER NOT NULL DEFAULT 0 CHECK(uploads BETWEEN 0 AND 100), sends INTEGER NOT NULL DEFAULT 0 CHECK(sends BETWEEN 0 AND 20), bytes INTEGER NOT NULL DEFAULT 0 CHECK(bytes>=0));
INSERT INTO usage_counters_next(day,uploads,sends,bytes) SELECT day,uploads,sends,bytes FROM usage_counters;
DROP TABLE usage_counters;
ALTER TABLE usage_counters_next RENAME TO usage_counters;
CREATE TRIGGER assets_quota AFTER INSERT ON assets BEGIN
  SELECT CASE WHEN (SELECT bytes FROM usage_counters WHERE day='storage')+NEW.bytes>200000000 THEN RAISE(ABORT,'image_storage_limit') END;
  INSERT INTO usage_counters(day,uploads) VALUES(NEW.usage_day,1) ON CONFLICT(day) DO UPDATE SET uploads=uploads+1;
  UPDATE usage_counters SET bytes=bytes+NEW.bytes WHERE day='storage';
END;
CREATE TRIGGER assets_restore_quota AFTER UPDATE OF state ON assets WHEN OLD.state='deleted' AND NEW.state!='deleted' BEGIN
  UPDATE usage_counters SET bytes=bytes+NEW.bytes WHERE day='storage';
END;
CREATE TRIGGER assets_release AFTER UPDATE OF state ON assets WHEN NEW.state='deleted' AND OLD.state!='deleted' BEGIN
  UPDATE usage_counters SET bytes=bytes-OLD.bytes WHERE day='storage';
  UPDATE cards SET status='draft',asset_id=NULL WHERE asset_id=OLD.id;
END;
CREATE TRIGGER attempts_quota AFTER INSERT ON delivery_attempts BEGIN
  INSERT INTO tick_limits(tick,sends) VALUES(CAST(NEW.started_at / 60000 AS INTEGER),1) ON CONFLICT(tick) DO UPDATE SET sends=sends+1;
  INSERT INTO usage_counters(day,sends) VALUES(NEW.usage_day,1) ON CONFLICT(day) DO UPDATE SET sends=sends+1;
  UPDATE deliveries SET state='sending',attempts=attempts+1,updated_at=NEW.started_at WHERE id=NEW.delivery_id AND state='claimed' AND claim_owner=NEW.claim_owner;
END;
