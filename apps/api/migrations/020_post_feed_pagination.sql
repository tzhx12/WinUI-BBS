UPDATE app_settings
SET setting_value = jsonb_set(setting_value, '{postsPerPage}', '20'::jsonb)
WHERE setting_key = 'content_limits' AND NOT (setting_value ? 'postsPerPage');
