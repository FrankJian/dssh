BEGIN;
CREATE TABLE IF NOT EXISTS ai_conversations (
    id TEXT PRIMARY KEY NOT NULL,
    owner TEXT NOT NULL,
    items_json TEXT NOT NULL DEFAULT '[]',
    draft TEXT NOT NULL DEFAULT '',
    selection_json TEXT
);
CREATE INDEX IF NOT EXISTS ai_conversations_owner ON ai_conversations(owner);
INSERT OR IGNORE INTO ai_conversations (id, owner, items_json)
SELECT 'legacy-ai-conversation', 'main', items_json FROM ai_chat_history WHERE id = 1;
DELETE FROM ai_chat_history WHERE id = 1;
COMMIT;
