ALTER TABLE deliveries ADD COLUMN resolution TEXT CHECK(resolution IS NULL OR (resolution='abandoned' AND state='unknown' AND confirmed_by_user=0));
CREATE TABLE manual_decisions_next (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES deliveries(id), action TEXT NOT NULL CHECK(action IN ('confirm_sent','retry','abandon')), created_at INTEGER NOT NULL, warning_accepted INTEGER NOT NULL CHECK(warning_accepted=1));
INSERT INTO manual_decisions_next SELECT * FROM manual_decisions;
DROP TABLE manual_decisions;
ALTER TABLE manual_decisions_next RENAME TO manual_decisions;
CREATE INDEX manual_decisions_delivery ON manual_decisions(delivery_id,created_at);
CREATE TRIGGER schedule_unresolved_version BEFORE UPDATE OF version,enabled,reason ON schedules WHEN (NEW.version!=OLD.version OR (OLD.enabled=0 AND NEW.enabled=1) OR (OLD.reason IN ('needs_reconnect','daily_limit') AND (NEW.reason IS NULL OR NEW.reason IN ('completed','content_shortage')))) AND EXISTS(
  SELECT 1 FROM deliveries WHERE schedule_id=OLD.id AND (state='sending' OR (state='unknown' AND resolution IS NULL))
) BEGIN SELECT RAISE(ABORT,'schedule_unresolved_delivery'); END;
DROP TRIGGER protect_asset_delete;
DROP TRIGGER protect_asset_state;
CREATE TRIGGER protect_asset_delete BEFORE DELETE ON assets WHEN
  EXISTS(SELECT 1 FROM schedule_items i JOIN schedules s ON s.id=i.schedule_id AND s.version=i.version WHERE i.asset_id=OLD.id AND s.reason IS NOT 'cancelled' AND i.position>=s.cursor)
  OR EXISTS(SELECT 1 FROM deliveries WHERE asset_id=OLD.id AND (state IN ('pending','claimed','sending','retry_wait','blocked') OR (state='unknown' AND resolution IS NULL)))
BEGIN SELECT RAISE(ABORT,'asset_in_use'); END;
CREATE TRIGGER protect_asset_state BEFORE UPDATE OF state ON assets WHEN NEW.state='deleting' AND (
  EXISTS(SELECT 1 FROM schedule_items i JOIN schedules s ON s.id=i.schedule_id AND s.version=i.version WHERE i.asset_id=OLD.id AND s.reason IS NOT 'cancelled' AND i.position>=s.cursor)
  OR EXISTS(SELECT 1 FROM deliveries WHERE asset_id=OLD.id AND (state IN ('pending','claimed','sending','retry_wait','blocked') OR (state='unknown' AND resolution IS NULL))))
BEGIN SELECT RAISE(ABORT,'asset_in_use'); END;
DROP VIEW occurrence_results;
CREATE VIEW occurrence_results AS
SELECT o.id,o.schedule_id,o.due_at_utc,o.mode,count(d.id) AS total,
 sum(CASE WHEN d.state IN ('sent','mock_sent') AND d.confirmed_by_user=0 THEN 1 ELSE 0 END) AS accepted,
 sum(d.confirmed_by_user) AS confirmed,
 sum(CASE WHEN d.resolution='abandoned' THEN 1 ELSE 0 END) AS abandoned,
 CASE
 WHEN sum(CASE WHEN d.state='unknown' AND d.resolution IS NULL THEN 1 ELSE 0 END)>0 THEN 'unknown'
 WHEN sum(CASE WHEN d.state IN ('pending','claimed','sending','retry_wait') THEN 1 ELSE 0 END)>0 THEN 'pending'
 WHEN sum(CASE WHEN d.state IN ('failed','blocked') THEN 1 ELSE 0 END)>0 THEN 'failed'
 WHEN sum(CASE WHEN d.resolution='abandoned' THEN 1 ELSE 0 END)>0 THEN 'abandoned'
 WHEN sum(CASE WHEN d.state='missed' THEN 1 ELSE 0 END)=count(d.id) THEN 'missed'
 WHEN sum(CASE WHEN d.state='cancelled' THEN 1 ELSE 0 END)=count(d.id) THEN 'cancelled'
 ELSE 'completed' END AS state
FROM occurrences o JOIN deliveries d ON d.occurrence_id=o.id GROUP BY o.id;
