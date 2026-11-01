CREATE TABLE IF NOT EXISTS rdp_profiles (
    id TEXT PRIMARY KEY,
    profile_json TEXT NOT NULL,
    secret_ref TEXT
);
