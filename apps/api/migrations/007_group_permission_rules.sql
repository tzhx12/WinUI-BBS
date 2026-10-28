-- Preserve memberships and existing capabilities when an old management group has no management role.
WITH changed AS (
  UPDATE user_groups g SET group_type = 'special'
  WHERE group_type = 'management' AND NOT EXISTS (
    SELECT 1 FROM group_permissions p WHERE p.group_id = g.id AND p.permission_key IN (
      'users.manage', 'groups.manage', 'levels.manage', 'posts.manage', 'posts.review',
      'categories.manage', 'media.manage', 'settings.manage'
    )
  ) RETURNING id
)
INSERT INTO audit_events (action_key, target_type, target_id, details)
SELECT 'group.type.normalize', 'group', id::text, '{"from":"management","to":"special"}'::jsonb FROM changed;

WITH removed AS (
  DELETE FROM group_permissions p USING user_groups g
  WHERE p.group_id = g.id AND g.group_type IN ('normal', 'public') AND p.permission_key IN (
    'users.manage', 'groups.manage', 'levels.manage', 'posts.manage', 'posts.review',
    'categories.manage', 'media.manage', 'settings.manage'
  ) RETURNING p.group_id, p.permission_key
)
INSERT INTO audit_events (action_key, target_type, target_id, details)
SELECT 'group.permissions.restrict', 'group', group_id::text, jsonb_build_object('removed', jsonb_agg(permission_key))
FROM removed GROUP BY group_id;

INSERT INTO group_permissions (group_id, permission_key)
SELECT id, permission_key FROM user_groups
CROSS JOIN (VALUES ('posts.create'), ('replies.create'), ('media.use')) AS baseline(permission_key)
WHERE group_type = 'management' ON CONFLICT DO NOTHING;

CREATE FUNCTION enforce_group_permission_rules() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_ids BIGINT[];
  target_id BIGINT;
  target_type TEXT;
  keys TEXT[];
  has_management BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'user_groups' THEN
    target_ids := ARRAY[NEW.id];
  ELSE
    target_ids := ARRAY[OLD.group_id, NEW.group_id];
  END IF;
  FOREACH target_id IN ARRAY target_ids LOOP
    SELECT group_type INTO target_type FROM user_groups WHERE id = target_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT COALESCE(array_agg(permission_key), ARRAY[]::TEXT[]) INTO keys
    FROM group_permissions WHERE group_id = target_id;
    has_management := keys && ARRAY[
      'users.manage', 'groups.manage', 'levels.manage', 'posts.manage', 'posts.review',
      'categories.manage', 'media.manage', 'settings.manage'
    ];
    IF target_type IN ('normal', 'public') AND has_management THEN
      RAISE EXCEPTION '普通用户组和公开用户组不能拥有管理类权限' USING ERRCODE = '23514';
    END IF;
    IF target_type = 'management' THEN
      IF NOT has_management THEN
        RAISE EXCEPTION '管理用户组至少需要一个管理类权限' USING ERRCODE = '23514';
      END IF;
      IF NOT keys @> ARRAY['posts.create', 'replies.create', 'media.use'] THEN
        RAISE EXCEPTION '管理用户组必须保留发帖、回复和使用图床权限' USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER user_group_permission_rules AFTER INSERT OR UPDATE ON user_groups
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_group_permission_rules();
CREATE CONSTRAINT TRIGGER permission_group_type_rules AFTER INSERT OR UPDATE OR DELETE ON group_permissions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_group_permission_rules();
