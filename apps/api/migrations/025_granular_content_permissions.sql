-- Preserve all existing hidden-content capabilities while splitting their grants.
INSERT INTO group_permissions (group_id, permission_key)
SELECT group_id, condition.permission_key FROM group_permissions
CROSS JOIN (VALUES ('posts.hide_content.reply'), ('posts.hide_content.like'), ('posts.hide_content.follow')) AS condition(permission_key)
WHERE group_permissions.permission_key = 'posts.hide_content' ON CONFLICT DO NOTHING;

-- Reviewing now grants approve/reject only; banning is an explicit extra grant.
INSERT INTO group_permissions (group_id, permission_key)
SELECT id, 'posts.review.ban' FROM user_groups WHERE group_type = 'global' ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION protect_global_permissions() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target_id BIGINT;
BEGIN
  FOREACH target_id IN ARRAY ARRAY[OLD.group_id, NEW.group_id] LOOP
    IF EXISTS (SELECT 1 FROM user_groups WHERE id = target_id AND group_type = 'global') AND
       NOT (SELECT COALESCE(array_agg(permission_key), ARRAY[]::TEXT[]) FROM group_permissions WHERE group_id = target_id)
       @> ARRAY['users.manage','groups.manage','levels.manage','posts.manage','posts.review','posts.review.ban',
          'categories.manage','media.manage','settings.manage','posts.create','replies.create',
          'media.use','posts.set_reader_level','posts.hide_content.reply','posts.hide_content.like',
          'posts.hide_content.follow','posts.bypass_review','posts.require_review'] THEN
      RAISE EXCEPTION '全局管理员组必须保留全部权限' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DELETE FROM group_permissions WHERE permission_key = 'posts.hide_content';

CREATE FUNCTION enforce_review_ban_permission() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target_id BIGINT;
BEGIN
  FOREACH target_id IN ARRAY ARRAY[OLD.group_id, NEW.group_id] LOOP
    IF EXISTS (SELECT 1 FROM group_permissions WHERE group_id = target_id AND permission_key = 'posts.review.ban')
       AND NOT EXISTS (SELECT 1 FROM group_permissions WHERE group_id = target_id AND permission_key = 'posts.review') THEN
      RAISE EXCEPTION '审核封禁权限需要同时拥有发帖审核权限' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER review_ban_permission_dependency AFTER INSERT OR UPDATE OR DELETE ON group_permissions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_review_ban_permission();
