UPDATE app_settings SET setting_value = '"WinUI-BBS"'::jsonb
WHERE setting_key = 'site_title' AND setting_value = '"Forum"'::jsonb;
