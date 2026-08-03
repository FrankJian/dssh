CREATE TABLE IF NOT EXISTS kubernetes_imports (
  secret_ref TEXT PRIMARY KEY,
  content_fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
