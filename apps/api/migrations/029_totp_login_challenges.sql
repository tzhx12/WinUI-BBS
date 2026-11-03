CREATE TABLE totp_login_challenges (
  user_uid BIGINT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL UNIQUE,
  session_version INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL
);
