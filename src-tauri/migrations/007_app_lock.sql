CREATE TABLE IF NOT EXISTS app_lock_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0,
    auto_lock_enabled INTEGER NOT NULL DEFAULT 0,
    timeout_minutes INTEGER NOT NULL DEFAULT 15,
    password_hash TEXT,
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO app_lock_settings (
    id, enabled, auto_lock_enabled, timeout_minutes, password_hash, updated_at
) VALUES (1, 0, 0, 15, NULL, CURRENT_TIMESTAMP);
