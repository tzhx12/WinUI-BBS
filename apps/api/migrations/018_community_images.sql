ALTER TABLE categories ADD COLUMN icon_image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN header_background_url TEXT NOT NULL DEFAULT '';

INSERT INTO app_settings (setting_key, setting_value)
VALUES ('home_background_url', '""'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;
