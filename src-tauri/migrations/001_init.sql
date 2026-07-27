CREATE TABLE IF NOT EXISTS ssh_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL CHECK (auth_type IN ('password', 'privateKey')),
    secret_ref TEXT,
    key_path TEXT,
    key_data TEXT,
    key_name TEXT,
    passphrase_ref TEXT,
    description TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    tags TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ssh_profiles_favorite_name
    ON ssh_profiles (favorite DESC, name COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_ssh_profiles_host
    ON ssh_profiles (host COLLATE NOCASE);
