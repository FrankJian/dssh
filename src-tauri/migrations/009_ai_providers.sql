CREATE TABLE IF NOT EXISTS ai_providers (
    id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL
);
-- Remove credentials belonging to the retired device-login integration.
DELETE FROM app_secrets WHERE key = 'copilot.github_token';
