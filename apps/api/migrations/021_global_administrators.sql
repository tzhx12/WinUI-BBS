ALTER TABLE user_groups DROP CONSTRAINT user_groups_group_type_check;
ALTER TABLE user_groups ADD CONSTRAINT user_groups_group_type_check
  CHECK (group_type IN ('global', 'management', 'public', 'normal', 'temporary', 'special'));

CREATE UNIQUE INDEX one_global_administrator_group ON user_groups (group_type) WHERE group_type = 'global';

-- Keep existing management roles and members; only UID 1 receives the new role.
UPDATE user_groups SET is_protected = FALSE WHERE group_type = 'management' AND name = '站点管理';
INSERT INTO user_groups (name, group_type, description, is_protected)
SELECT CASE WHEN EXISTS (SELECT 1 FROM user_groups WHERE name = '全局管理员')
  THEN '全局管理员 ' || gen_random_uuid()::text ELSE '全局管理员' END,
  'global', '拥有全部权限；UID 1 为永久成员，其他成员由 UID 1 移除。', TRUE;

INSERT INTO group_permissions (group_id, permission_key)
SELECT id, permission_key FROM user_groups
CROSS JOIN (VALUES
  ('users.manage'), ('groups.manage'), ('levels.manage'), ('posts.manage'), ('posts.review'),
  ('categories.manage'), ('media.manage'), ('settings.manage'), ('posts.create'), ('replies.create'),
  ('media.use'), ('posts.set_reader_level'), ('posts.hide_content'), ('posts.bypass_review'), ('posts.require_review')
) AS permissions(permission_key) WHERE group_type = 'global';

INSERT INTO group_memberships (user_uid, group_id)
SELECT u.uid, g.id FROM users u CROSS JOIN user_groups g WHERE u.uid = 1 AND g.group_type = 'global';

CREATE FUNCTION protect_global_group() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.group_type = 'global' AND (TG_OP = 'DELETE' OR NEW.group_type <> 'global'
      OR NOT NEW.is_protected OR NEW.is_default OR NEW.is_joinable) THEN
    RAISE EXCEPTION '全局管理员组不可删除或改变类型' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.group_type <> 'global' AND NEW.group_type = 'global' THEN
    RAISE EXCEPTION '不可创建全局管理员组' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER protect_global_group BEFORE UPDATE OR DELETE ON user_groups
FOR EACH ROW EXECUTE FUNCTION protect_global_group();

CREATE FUNCTION protect_global_permissions() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target_id BIGINT;
BEGIN
  FOREACH target_id IN ARRAY ARRAY[OLD.group_id, NEW.group_id] LOOP
    IF EXISTS (SELECT 1 FROM user_groups WHERE id = target_id AND group_type = 'global') AND
       NOT (SELECT COALESCE(array_agg(permission_key), ARRAY[]::TEXT[]) FROM group_permissions WHERE group_id = target_id)
       @> ARRAY['users.manage','groups.manage','levels.manage','posts.manage','posts.review',
          'categories.manage','media.manage','settings.manage','posts.create','replies.create',
          'media.use','posts.set_reader_level','posts.hide_content','posts.bypass_review','posts.require_review'] THEN
      RAISE EXCEPTION '全局管理员组必须保留全部权限' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER protect_global_permissions AFTER UPDATE OR DELETE ON group_permissions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION protect_global_permissions();

CREATE FUNCTION protect_owner_membership() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.user_uid = 1 AND
     EXISTS (SELECT 1 FROM user_groups WHERE id = OLD.group_id AND group_type = 'global') AND
     (TG_OP = 'DELETE' OR NEW.user_uid <> 1 OR NEW.group_id <> OLD.group_id OR NEW.expires_at IS NOT NULL) THEN
    RAISE EXCEPTION 'UID 1 不可移出全局管理员组或设置到期时间' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.user_uid = 1 AND NEW.expires_at IS NOT NULL AND
     EXISTS (SELECT 1 FROM user_groups WHERE id = NEW.group_id AND group_type = 'global') THEN
    RAISE EXCEPTION 'UID 1 必须为永久成员' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER protect_owner_membership BEFORE INSERT OR UPDATE OR DELETE ON group_memberships
FOR EACH ROW EXECUTE FUNCTION protect_owner_membership();
