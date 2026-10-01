ALTER TABLE deliveries ADD COLUMN cancellation_reason TEXT CHECK(cancellation_reason IN ('paused','cancelled','schedule_changed','disconnected'));
UPDATE deliveries SET cancellation_reason=CASE error
 WHEN 'paused' THEN 'paused'
 WHEN 'cancelled' THEN 'cancelled'
 WHEN '예약 수정' THEN 'schedule_changed'
 WHEN '자동 발송 연결 해제' THEN 'disconnected'
 ELSE NULL END WHERE state='cancelled';
DELETE FROM pause_recoveries WHERE decision IS NULL AND EXISTS(
 SELECT 1 FROM deliveries d WHERE d.id=pause_recoveries.delivery_id AND d.cancellation_reason IN ('cancelled','schedule_changed','disconnected')
);
DROP TRIGGER record_paused_delivery;
CREATE TRIGGER record_paused_delivery AFTER UPDATE OF state ON deliveries
 WHEN NEW.state='cancelled' AND OLD.state!='cancelled' AND NEW.cancellation_reason='paused'
 AND EXISTS(SELECT 1 FROM schedules s WHERE s.id=NEW.schedule_id AND s.reason='paused')
 BEGIN INSERT INTO pause_recoveries(delivery_id) VALUES(NEW.id) ON CONFLICT DO NOTHING; END;
