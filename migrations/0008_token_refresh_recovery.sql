ALTER TABLE credentials ADD COLUMN refresh_attempts INTEGER NOT NULL DEFAULT 0 CHECK(refresh_attempts BETWEEN 0 AND 3);
ALTER TABLE credentials ADD COLUMN refresh_retry_at INTEGER;
ALTER TABLE credentials ADD COLUMN refresh_failure TEXT CHECK(refresh_failure IN ('invalid','transient','uncertain','configuration','exhausted'));
ALTER TABLE credentials ADD COLUMN refresh_http_status INTEGER;
ALTER TABLE credentials ADD COLUMN refresh_provider_error TEXT;
ALTER TABLE credentials ADD COLUMN refresh_provider_code TEXT;
