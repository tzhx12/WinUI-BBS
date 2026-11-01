UPDATE app_settings
SET setting_value = jsonb_set(
  setting_value,
  '{s3}',
  '{"accessMode":"proxy","publicBaseUrl":""}'::jsonb || (setting_value->'s3')
)
WHERE setting_key = 'media_storage';

UPDATE storage_locations
SET config = '{"accessMode":"proxy","publicBaseUrl":""}'::jsonb || config;
