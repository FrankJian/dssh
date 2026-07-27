CREATE TABLE IF NOT EXISTS s3_bookmarks (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    bucket TEXT NOT NULL,
    prefix TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_s3_bookmarks_profile_location
    ON s3_bookmarks (profile_id, bucket, prefix);

CREATE INDEX IF NOT EXISTS idx_s3_bookmarks_profile_name
    ON s3_bookmarks (profile_id, name COLLATE NOCASE ASC);
