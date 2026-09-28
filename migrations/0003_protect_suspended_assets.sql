DROP TRIGGER protect_asset_delete;
DROP TRIGGER protect_asset_state;
DROP TRIGGER schedule_asset_ready;
CREATE TRIGGER protect_asset_delete BEFORE DELETE ON assets WHEN
  EXISTS(SELECT 1 FROM schedule_items i JOIN schedules s ON s.id=i.schedule_id AND s.version=i.version WHERE i.asset_id=OLD.id AND s.reason IS NOT 'cancelled' AND i.position>=s.cursor)
  OR EXISTS(SELECT 1 FROM deliveries WHERE asset_id=OLD.id AND state IN ('pending','claimed','sending','retry_wait','unknown','blocked'))
BEGIN SELECT RAISE(ABORT,'asset_in_use'); END;
CREATE TRIGGER protect_asset_state BEFORE UPDATE OF state ON assets WHEN NEW.state='deleting' AND (
  EXISTS(SELECT 1 FROM schedule_items i JOIN schedules s ON s.id=i.schedule_id AND s.version=i.version WHERE i.asset_id=OLD.id AND s.reason IS NOT 'cancelled' AND i.position>=s.cursor)
  OR EXISTS(SELECT 1 FROM deliveries WHERE asset_id=OLD.id AND state IN ('pending','claimed','sending','retry_wait','unknown','blocked')))
BEGIN SELECT RAISE(ABORT,'asset_in_use'); END;
CREATE TRIGGER schedule_asset_ready BEFORE INSERT ON schedule_items WHEN NOT EXISTS(
 SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.state='ready' AND (
  EXISTS(SELECT 1 FROM cards c WHERE c.id=a.card_id AND c.status='ready' AND c.revision=a.revision AND c.asset_id=a.id)
  OR EXISTS(SELECT 1 FROM schedule_items previous WHERE previous.schedule_id=NEW.schedule_id AND previous.asset_id=NEW.asset_id AND previous.payload=NEW.payload)
 )
) BEGIN SELECT RAISE(ABORT,'asset_not_ready'); END;
