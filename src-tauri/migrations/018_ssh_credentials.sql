CREATE TABLE IF NOT EXISTS ssh_credentials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL CHECK (auth_type IN ('password', 'privateKey')),
    secret_ref TEXT,
    key_data TEXT,
    key_name TEXT,
    passphrase_ref TEXT,
    revision INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE ssh_profiles ADD COLUMN credential_id TEXT REFERENCES ssh_credentials(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_ssh_profiles_credential ON ssh_profiles(credential_id);
