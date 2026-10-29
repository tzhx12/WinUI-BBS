INSERT INTO app_settings(setting_key,setting_value) VALUES
('content_limits','{"postCharacters":20000,"postImages":15,"replyCharacters":1000,"replyImages":5,"repliesPerPage":20,"directLibraryUploads":false}'::jsonb);

CREATE TABLE favorite_folders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_uid bigint NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  name varchar(64) NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(user_uid,name)
);
CREATE TABLE favorites (
  folder_id bigint NOT NULL REFERENCES favorite_folders(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY(folder_id,post_id)
);
CREATE INDEX favorite_folders_owner ON favorite_folders(user_uid);
