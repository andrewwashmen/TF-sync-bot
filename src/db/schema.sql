-- Registered link between a Slack thread and its Asana task(s)
CREATE TABLE IF NOT EXISTS thread_task_mappings (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    slack_channel_id TEXT NOT NULL,
    slack_thread_ts  TEXT NOT NULL,
    asana_task_gid   TEXT NOT NULL,
    order_id         TEXT,
    item_name        TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(slack_thread_ts, asana_task_gid)
);

CREATE INDEX IF NOT EXISTS idx_mappings_thread ON thread_task_mappings(slack_thread_ts);
CREATE INDEX IF NOT EXISTS idx_mappings_task ON thread_task_mappings(asana_task_gid);

-- Record of every message successfully synced to every task
CREATE TABLE IF NOT EXISTS sync_log (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    slack_thread_ts  TEXT NOT NULL,
    slack_message_ts TEXT NOT NULL,
    asana_task_gid   TEXT NOT NULL,
    asana_story_gid  TEXT,
    content_type     TEXT NOT NULL,
    synced_at        TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(slack_message_ts, asana_task_gid)
);

CREATE INDEX IF NOT EXISTS idx_sync_thread ON sync_log(slack_thread_ts);

-- Operational log for debugging and audit
CREATE TABLE IF NOT EXISTS sync_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    slack_thread_ts  TEXT NOT NULL,
    triggered_by     TEXT NOT NULL,
    messages_found   INTEGER,
    messages_synced  INTEGER DEFAULT 0,
    errors           INTEGER DEFAULT 0,
    error_detail     TEXT,
    started_at       TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at     TEXT
);
