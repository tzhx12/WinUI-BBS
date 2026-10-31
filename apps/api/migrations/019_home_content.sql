INSERT INTO app_settings(setting_key, setting_value) VALUES
('home_content', '{"homeTitle":"社区首页","homeDescription":"浏览社区中的新话题，参与感兴趣的讨论。","popularTitle":"热门讨论","popularDescription":"浏览社区中的新话题，参与感兴趣的讨论。"}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;
