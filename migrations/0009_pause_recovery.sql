CREATE TABLE pause_recoveries (delivery_id TEXT PRIMARY KEY REFERENCES deliveries(id), decision TEXT CHECK(decision IN ('reschedule','exclude')), target_schedule_id TEXT REFERENCES schedules(id), target_position INTEGER, decided_at INTEGER, CHECK((decision IS NULL AND target_schedule_id IS NULL AND target_position IS NULL AND decided_at IS NULL) OR (decision='exclude' AND target_schedule_id IS NULL AND target_position IS NULL AND decided_at IS NOT NULL) OR (decision='reschedule' AND target_schedule_id IS NOT NULL AND target_position>=0 AND decided_at IS NOT NULL)));
INSERT INTO pause_recoveries(delivery_id) SELECT d.id FROM deliveries d JOIN schedules s ON s.id=d.schedule_id WHERE d.state='cancelled' AND (d.error='paused' OR s.reason='paused');
CREATE TRIGGER record_paused_delivery AFTER UPDATE OF state ON deliveries WHEN NEW.state='cancelled' AND OLD.state!='cancelled' AND EXISTS(SELECT 1 FROM schedules s WHERE s.id=NEW.schedule_id AND s.reason='paused') BEGIN INSERT INTO pause_recoveries(delivery_id) VALUES(NEW.id) ON CONFLICT DO NOTHING; END;
CREATE VIEW pause_recovery_candidates AS SELECT r.*,d.schedule_id,d.asset_id,d.payload,d.state,d.due_at_utc,d.schedule_version,d.position,
 (d.state='cancelled' AND d.resolution IS NULL AND d.confirmed_by_user=0 AND d.attempts=(SELECT count(*) FROM delivery_attempts a WHERE a.delivery_id=d.id) AND NOT EXISTS(SELECT 1 FROM delivery_attempts a WHERE a.delivery_id=d.id AND a.outcome NOT IN ('cancelled','retry_wait','failed','blocked')) AND NOT EXISTS(SELECT 1 FROM manual_decisions m WHERE m.delivery_id=d.id AND m.action='confirm_sent')) AS safe
 FROM pause_recoveries r JOIN deliveries d ON d.id=r.delivery_id;
CREATE TRIGGER pause_decision_required BEFORE UPDATE OF version,enabled ON schedules WHEN (NEW.version!=OLD.version OR (OLD.enabled=0 AND NEW.enabled=1)) AND EXISTS(SELECT 1 FROM pause_recovery_candidates p WHERE p.schedule_id=OLD.id AND p.decision IS NULL) BEGIN SELECT RAISE(ABORT,'pause_recovery_decision_required'); END;
CREATE TRIGGER pause_decision_immutable BEFORE UPDATE ON pause_recoveries WHEN OLD.decision IS NOT NULL BEGIN SELECT RAISE(ABORT,'pause_recovery_already_decided'); END;
CREATE TRIGGER pause_recovery_safe BEFORE UPDATE OF decision ON pause_recoveries WHEN NEW.decision='reschedule' AND NOT EXISTS(SELECT 1 FROM pause_recovery_candidates p JOIN assets a ON a.id=p.asset_id WHERE p.delivery_id=OLD.delivery_id AND p.safe=1 AND a.state='ready') BEGIN SELECT RAISE(ABORT,'pause_recovery_unsafe'); END;
DROP TRIGGER schedule_asset_ready;
CREATE TRIGGER schedule_asset_ready BEFORE INSERT ON schedule_items WHEN NOT EXISTS(
 SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.state='ready' AND (
  EXISTS(SELECT 1 FROM cards c WHERE c.id=a.card_id AND c.status='ready' AND c.revision=a.revision AND c.asset_id=a.id)
  OR EXISTS(SELECT 1 FROM schedule_items previous WHERE previous.schedule_id=NEW.schedule_id AND previous.asset_id=NEW.asset_id AND previous.payload=NEW.payload)
  OR EXISTS(SELECT 1 FROM pause_recovery_candidates p WHERE p.target_schedule_id=NEW.schedule_id AND NEW.version=1 AND p.target_position=NEW.position AND p.decision='reschedule' AND p.asset_id=NEW.asset_id AND p.payload=NEW.payload AND p.safe=1)
 )) BEGIN SELECT RAISE(ABORT,'asset_not_ready'); END;
DROP TRIGGER protect_asset_delete;
DROP TRIGGER protect_asset_state;
CREATE TRIGGER protect_asset_delete BEFORE DELETE ON assets WHEN
 EXISTS(SELECT 1 FROM schedule_items i JOIN schedules s ON s.id=i.schedule_id AND s.version=i.version WHERE i.asset_id=OLD.id AND s.reason IS NOT 'cancelled' AND i.position>=s.cursor)
 OR EXISTS(SELECT 1 FROM deliveries WHERE asset_id=OLD.id AND (state IN ('pending','claimed','sending','retry_wait','blocked') OR (state='unknown' AND resolution IS NULL)))
 OR EXISTS(SELECT 1 FROM pause_recovery_candidates p WHERE p.asset_id=OLD.id AND p.decision IS NULL)
 BEGIN SELECT RAISE(ABORT,'asset_in_use'); END;
CREATE TRIGGER protect_asset_state BEFORE UPDATE OF state ON assets WHEN NEW.state='deleting' AND (
 EXISTS(SELECT 1 FROM schedule_items i JOIN schedules s ON s.id=i.schedule_id AND s.version=i.version WHERE i.asset_id=OLD.id AND s.reason IS NOT 'cancelled' AND i.position>=s.cursor)
 OR EXISTS(SELECT 1 FROM deliveries WHERE asset_id=OLD.id AND (state IN ('pending','claimed','sending','retry_wait','blocked') OR (state='unknown' AND resolution IS NULL)))
 OR EXISTS(SELECT 1 FROM pause_recovery_candidates p WHERE p.asset_id=OLD.id AND p.decision IS NULL))
 BEGIN SELECT RAISE(ABORT,'asset_in_use'); END;
