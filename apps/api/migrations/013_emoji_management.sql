ALTER TABLE emoji_packs ADD COLUMN is_community BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX emoji_single_community ON emoji_packs(is_community) WHERE is_community;

-- Preserve an existing populated shared pack; the initial empty placeholder stays hidden.
UPDATE emoji_packs SET is_community=TRUE WHERE id=(
  SELECT p.id FROM emoji_packs p WHERE p.created_by IS NULL AND p.remote_source IS NULL
    AND EXISTS(SELECT 1 FROM media_assets m WHERE m.emoji_pack_id=p.id)
  ORDER BY p.sort_order,p.id LIMIT 1
);

CREATE TABLE user_emoji_pack_order (
  user_uid BIGINT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  pack_id BIGINT NOT NULL REFERENCES emoji_packs(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (user_uid, pack_id)
);

UPDATE app_settings SET setting_value = setting_value || '{"countTowardPackLimit":true}'::jsonb
WHERE setting_key = 'remote_emoji';
