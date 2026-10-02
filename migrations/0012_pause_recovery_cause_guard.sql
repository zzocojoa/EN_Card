DROP VIEW pause_recovery_candidates;
CREATE VIEW pause_recovery_candidates AS SELECT r.*,d.schedule_id,d.asset_id,d.payload,d.state,d.due_at_utc,d.schedule_version,d.position,
 (d.state='cancelled' AND d.resolution IS NULL AND d.confirmed_by_user=0 AND (r.decision IS NOT NULL OR d.cancellation_reason IS 'paused') AND d.attempts=(SELECT count(*) FROM delivery_attempts a WHERE a.delivery_id=d.id) AND NOT EXISTS(SELECT 1 FROM delivery_attempts a WHERE a.delivery_id=d.id AND a.outcome NOT IN ('cancelled','retry_wait','failed','blocked')) AND NOT EXISTS(SELECT 1 FROM manual_decisions m WHERE m.delivery_id=d.id AND m.action='confirm_sent')) AS safe
 FROM pause_recoveries r JOIN deliveries d ON d.id=r.delivery_id;
