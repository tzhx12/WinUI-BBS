ALTER TABLE posts ADD COLUMN reply_count integer NOT NULL DEFAULT 0 CHECK (reply_count >= 0);

-- Keep the backfill and trigger installation consistent with concurrent writers.
LOCK TABLE replies IN SHARE ROW EXCLUSIVE MODE;
UPDATE posts p SET reply_count = counts.total
FROM (SELECT post_id, COUNT(*)::integer AS total FROM replies WHERE deleted_at IS NULL GROUP BY post_id) counts
WHERE p.id = counts.post_id;

CREATE FUNCTION maintain_post_reply_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.post_id = NEW.post_id
    AND (OLD.deleted_at IS NULL) = (NEW.deleted_at IS NULL) THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.deleted_at IS NULL THEN
    UPDATE posts SET reply_count = reply_count - 1 WHERE id = OLD.post_id;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.deleted_at IS NULL THEN
    UPDATE posts SET reply_count = reply_count + 1 WHERE id = NEW.post_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER replies_maintain_post_count AFTER INSERT OR DELETE OR UPDATE OF post_id, deleted_at ON replies
FOR EACH ROW EXECUTE FUNCTION maintain_post_reply_count();

CREATE INDEX posts_public_popular_idx ON posts(is_pinned DESC, reply_count DESC, created_at DESC, id DESC)
WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX posts_category_public_feed_idx ON posts(category_id, is_pinned DESC, created_at DESC, id DESC)
WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX posts_category_public_popular_idx ON posts(category_id, is_pinned DESC, reply_count DESC, created_at DESC, id DESC)
WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX replies_visible_children_idx ON replies(parent_reply_id, child_number)
WHERE parent_reply_id IS NOT NULL AND deleted_at IS NULL;
