ALTER TABLE deliveries ADD COLUMN confirmed_by_user INTEGER NOT NULL DEFAULT 0 CHECK(confirmed_by_user IN (0,1));
UPDATE deliveries SET confirmed_by_user=1 WHERE state IN ('sent','mock_sent') AND EXISTS(SELECT 1 FROM manual_decisions m WHERE m.delivery_id=deliveries.id AND m.action='confirm_sent');
CREATE INDEX manual_decisions_delivery ON manual_decisions(delivery_id,created_at);
