ALTER TABLE media_assets DROP CONSTRAINT media_assets_collection_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_collection_check
  CHECK (collection IN ('library', 'emoji', 'site_icon', 'avatar'));
ALTER TABLE media_assets ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'local'
  CHECK (storage_backend IN ('local', 's3'));
ALTER TABLE media_assets ADD COLUMN storage_location JSONB;
CREATE TABLE storage_locations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  config JSONB NOT NULL
);
CREATE TABLE storage_deletions (
  storage_key TEXT PRIMARY KEY,
  byte_size BIGINT NOT NULL,
  storage_backend TEXT NOT NULL,
  storage_location JSONB
);
ALTER TABLE media_assets ADD COLUMN recycle_protected BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE media_assets SET recycle_protected=TRUE WHERE collection <> 'library';
UPDATE media_assets SET collection='avatar',recycle_protected=TRUE
  WHERE EXISTS (SELECT 1 FROM users WHERE avatar_url='/uploads/' || storage_key);
CREATE INDEX media_storage_oldest ON media_assets(storage_backend,created_at,id)
  WHERE collection='library' AND NOT recycle_protected;

INSERT INTO app_settings(setting_key,setting_value) VALUES
  ('media_storage','{"localMaxBytes":0,"preference":"local","recycleBytes":524288000,"s3":{"enabled":false,"endpoint":"","region":"auto","bucket":"","prefix":"forum/","accessKeyId":"","secretAccessKey":"","capacityBytes":0,"forcePathStyle":true}}');

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('announcement','review','moderation','storage'));
CREATE TABLE storage_alerts (
  backend TEXT PRIMARY KEY,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
