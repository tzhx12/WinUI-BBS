ALTER TABLE posts ADD COLUMN reply_floor_counter integer NOT NULL DEFAULT 0;
ALTER TABLE replies ADD COLUMN parent_reply_id uuid REFERENCES replies(id) ON DELETE CASCADE;
ALTER TABLE replies ADD COLUMN reply_to_id uuid REFERENCES replies(id) ON DELETE SET NULL;
ALTER TABLE replies ADD COLUMN floor_number integer;
ALTER TABLE replies ADD COLUMN child_number integer;
ALTER TABLE replies ADD COLUMN child_floor_counter integer NOT NULL DEFAULT 0;
ALTER TABLE replies ADD COLUMN deleted_at timestamptz;
ALTER TABLE replies ADD COLUMN deletion_source text CHECK(deletion_source IN ('author','admin'));
ALTER TABLE replies ALTER COLUMN author_uid DROP NOT NULL;

WITH numbered AS (
  SELECT id, row_number() OVER(PARTITION BY post_id ORDER BY created_at,id)::integer AS floor FROM replies
) UPDATE replies r SET floor_number=n.floor FROM numbered n WHERE r.id=n.id;
UPDATE posts p SET reply_floor_counter=COALESCE((SELECT MAX(floor_number) FROM replies WHERE post_id=p.id),0);
ALTER TABLE replies ALTER COLUMN floor_number SET NOT NULL;
ALTER TABLE replies ADD CONSTRAINT reply_floor_positive CHECK(floor_number>0 AND (child_number IS NULL OR child_number>0));
ALTER TABLE replies ADD CONSTRAINT reply_parent_shape CHECK((parent_reply_id IS NULL)=(child_number IS NULL) AND parent_reply_id IS DISTINCT FROM id);
CREATE UNIQUE INDEX replies_root_floor ON replies(post_id,floor_number) WHERE parent_reply_id IS NULL;
CREATE UNIQUE INDEX replies_child_floor ON replies(parent_reply_id,child_number) WHERE parent_reply_id IS NOT NULL;

CREATE FUNCTION assign_reply_floor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent replies%ROWTYPE;
BEGIN
  -- Serialize allocation with deletion and post moderation. Numbers are never recycled.
  PERFORM id FROM posts WHERE id=NEW.post_id FOR UPDATE;
  IF NEW.parent_reply_id IS NULL THEN
    UPDATE posts SET reply_floor_counter=reply_floor_counter+1 WHERE id=NEW.post_id RETURNING reply_floor_counter INTO NEW.floor_number;
    NEW.child_number := NULL;
    NEW.reply_to_id := NULL;
  ELSE
    SELECT * INTO parent FROM replies WHERE id=NEW.parent_reply_id FOR UPDATE;
    IF NOT FOUND OR parent.parent_reply_id IS NOT NULL OR parent.post_id<>NEW.post_id THEN
      RAISE EXCEPTION 'invalid reply parent' USING ERRCODE='23514';
    END IF;
    IF NEW.reply_to_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM replies WHERE id=NEW.reply_to_id AND post_id=NEW.post_id AND deleted_at IS NULL
        AND (id=parent.id OR parent_reply_id=parent.id)
    ) THEN RAISE EXCEPTION 'invalid reply target' USING ERRCODE='23514'; END IF;
    UPDATE replies SET child_floor_counter=child_floor_counter+1 WHERE id=parent.id RETURNING child_floor_counter INTO NEW.child_number;
    NEW.floor_number := parent.floor_number;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER replies_allocate_floor BEFORE INSERT ON replies FOR EACH ROW EXECUTE FUNCTION assign_reply_floor();

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK(kind IN ('announcement','review','moderation'));
