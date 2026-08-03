CREATE TABLE IF NOT EXISTS kubernetes_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_json TEXT NOT NULL,
    selected_contexts_json TEXT NOT NULL DEFAULT '[]',
    favorite INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kubernetes_profiles_favorite_name
    ON kubernetes_profiles (favorite DESC, name COLLATE NOCASE ASC);
