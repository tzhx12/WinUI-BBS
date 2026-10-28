ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_case_insensitive ON users (lower(username));
