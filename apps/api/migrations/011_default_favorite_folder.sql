ALTER TABLE favorite_folders ADD COLUMN is_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX favorite_folders_one_default ON favorite_folders(user_uid) WHERE is_default;
