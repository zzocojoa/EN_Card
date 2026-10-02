ALTER TABLE deliveries ADD COLUMN manual_retry_until INTEGER;
CREATE INDEX IF NOT EXISTS deliveries_schedule_state ON deliveries(schedule_id,state);
CREATE INDEX occurrences_due ON occurrences(due_at_utc);
CREATE VIEW occurrence_results AS
SELECT o.id,o.schedule_id,o.due_at_utc,o.mode,count(d.id) AS total,
 sum(CASE WHEN d.state IN ('sent','mock_sent') THEN 1 ELSE 0 END) AS accepted,
 CASE
 WHEN sum(CASE WHEN d.state='unknown' THEN 1 ELSE 0 END)>0 THEN 'unknown'
 WHEN sum(CASE WHEN d.state IN ('pending','claimed','sending','retry_wait') THEN 1 ELSE 0 END)>0 THEN 'pending'
 WHEN sum(CASE WHEN d.state IN ('failed','blocked') THEN 1 ELSE 0 END)>0 THEN 'failed'
 WHEN sum(CASE WHEN d.state='missed' THEN 1 ELSE 0 END)=count(d.id) THEN 'missed'
 WHEN sum(CASE WHEN d.state='cancelled' THEN 1 ELSE 0 END)=count(d.id) THEN 'cancelled'
 ELSE 'completed' END AS state
FROM occurrences o JOIN deliveries d ON d.occurrence_id=o.id GROUP BY o.id;
