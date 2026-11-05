CREATE INDEX favorites_folder_order ON favorites(folder_id, created_at DESC, post_id DESC);
CREATE INDEX media_personal_order ON media_assets(created_by, created_at DESC, id DESC)
  WHERE collection <> 'avatar';
