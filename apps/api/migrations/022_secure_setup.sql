-- Kept outside public app_settings; only installation logs expose the entry.
CREATE TABLE installation_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  setup_token TEXT
);
INSERT INTO installation_state (setup_token)
SELECT CASE WHEN EXISTS (SELECT 1 FROM users) THEN NULL ELSE encode(gen_random_bytes(32), 'hex') END;
