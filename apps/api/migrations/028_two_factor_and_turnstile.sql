ALTER TABLE users
  ADD COLUMN totp_secret TEXT,
  ADD COLUMN totp_pending_secret TEXT,
  ADD COLUMN totp_pending_at TIMESTAMPTZ,
  ADD COLUMN totp_last_counter BIGINT NOT NULL DEFAULT -1;

INSERT INTO app_settings (setting_key, setting_value)
VALUES ('turnstile_config', '{"enabled":false,"siteKey":"","secretKey":""}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;
