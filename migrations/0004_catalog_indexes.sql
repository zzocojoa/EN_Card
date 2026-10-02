CREATE INDEX cards_listing ON cards(created_at DESC,id DESC);
CREATE INDEX assets_listing ON assets(created_at DESC,id DESC);
CREATE INDEX deliveries_listing ON deliveries(due_at_utc DESC,id DESC);
CREATE INDEX schedules_listing ON schedules(enabled DESC,id DESC);
CREATE INDEX attempts_delivery_time ON delivery_attempts(delivery_id,started_at DESC);
