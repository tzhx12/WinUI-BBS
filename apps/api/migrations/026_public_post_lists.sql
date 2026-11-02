CREATE INDEX posts_author_published_idx ON posts(author_uid, created_at DESC, id DESC)
WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX posts_public_feed_idx ON posts(is_pinned DESC, created_at DESC, id DESC)
WHERE status = 'published' AND deleted_at IS NULL;
