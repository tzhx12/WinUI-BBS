ALTER TABLE categories ADD COLUMN header_background_height SMALLINT NOT NULL DEFAULT 50
  CHECK (header_background_height IN (50, 75));

INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('popular_background_url', '""'::jsonb),
  ('popular_background_height', '50'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;
