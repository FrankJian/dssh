CREATE TABLE IF NOT EXISTS s3_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT,
    port INTEGER NOT NULL DEFAULT 443,
    use_tls INTEGER NOT NULL DEFAULT 1,
    endpoint TEXT,
    region TEXT NOT NULL DEFAULT 'us-east-1',
    access_key_id TEXT NOT NULL,
    secret_access_key_ref TEXT NOT NULL,
    session_token_ref TEXT,
    force_path_style INTEGER NOT NULL DEFAULT 0,
    default_bucket TEXT,
    default_acl TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_s3_profiles_favorite_name
    ON s3_profiles (favorite DESC, name COLLATE NOCASE);
