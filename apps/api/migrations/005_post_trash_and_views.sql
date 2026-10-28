ALTER TABLE posts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS posts_trash_expiry ON posts(purge_after) WHERE deleted_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS post_views (
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  viewer_key TEXT NOT NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, viewer_key)
);
INSERT INTO app_settings (setting_key, setting_value) VALUES ('trash_retention_days', '30')
ON CONFLICT (setting_key) DO NOTHING;
INSERT INTO group_permissions (group_id, permission_key)
SELECT id, 'posts.set_reader_level' FROM user_groups WHERE group_type = 'management'
ON CONFLICT DO NOTHING;
