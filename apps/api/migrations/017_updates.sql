INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('update_settings', '{"automatic":false,"channel":"releases"}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;
