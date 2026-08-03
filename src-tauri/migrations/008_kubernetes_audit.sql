CREATE TABLE IF NOT EXISTS kubernetes_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL,
    source TEXT NOT NULL,
    context TEXT NOT NULL,
    identity TEXT,
    resource TEXT,
    namespace TEXT,
    names_json TEXT NOT NULL DEFAULT '[]',
    action TEXT NOT NULL,
    result TEXT NOT NULL,
    error_code TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kubernetes_audit_profile_created
    ON kubernetes_audit (profile_id, created_at DESC);
