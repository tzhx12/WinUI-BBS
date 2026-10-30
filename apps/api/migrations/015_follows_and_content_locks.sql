CREATE TABLE user_follows (
  follower_uid BIGINT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  followed_uid BIGINT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_uid, followed_uid),
  CHECK (follower_uid <> followed_uid)
);
CREATE INDEX user_follows_followed_idx ON user_follows(followed_uid);

INSERT INTO group_permissions(group_id, permission_key)
SELECT id, 'posts.hide_content' FROM user_groups WHERE group_type IN ('normal', 'management')
ON CONFLICT DO NOTHING;
