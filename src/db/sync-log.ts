import type Database from 'better-sqlite3';

export interface SyncLogEntry {
  id: number;
  slack_thread_ts: string;
  slack_message_ts: string;
  asana_task_gid: string;
  asana_story_gid: string | null;
  content_type: string;
  synced_at: string;
}

export interface SyncRunRecord {
  id: number;
  slack_thread_ts: string;
  triggered_by: string;
  messages_found: number | null;
  messages_synced: number;
  errors: number;
  error_detail: string | null;
  started_at: string;
  completed_at: string | null;
}

export function getSyncedMessageKeys(
  db: Database.Database,
  threadTs: string,
): Set<string> {
  const rows = db
    .prepare(
      'SELECT slack_message_ts, asana_task_gid FROM sync_log WHERE slack_thread_ts = ?',
    )
    .all(threadTs) as Array<{
    slack_message_ts: string;
    asana_task_gid: string;
  }>;

  return new Set(rows.map((r) => `${r.slack_message_ts}:${r.asana_task_gid}`));
}

export function logSyncEntry(
  db: Database.Database,
  entry: {
    slackThreadTs: string;
    slackMessageTs: string;
    asanaTaskGid: string;
    asanaStoryGid: string | null;
    contentType: string;
  },
): void {
  db.prepare(
    `
    INSERT OR IGNORE INTO sync_log
      (slack_thread_ts, slack_message_ts, asana_task_gid, asana_story_gid, content_type)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(
    entry.slackThreadTs,
    entry.slackMessageTs,
    entry.asanaTaskGid,
    entry.asanaStoryGid,
    entry.contentType,
  );
}

export function createSyncRun(
  db: Database.Database,
  threadTs: string,
  triggeredBy: string,
): number {
  const result = db
    .prepare(
      `
    INSERT INTO sync_runs (slack_thread_ts, triggered_by)
    VALUES (?, ?)
  `,
    )
    .run(threadTs, triggeredBy);

  return Number(result.lastInsertRowid);
}

export function completeSyncRun(
  db: Database.Database,
  runId: number,
  update: {
    messagesFound: number;
    messagesSynced: number;
    errors: number;
    errorDetail?: string;
  },
): void {
  db.prepare(
    `
    UPDATE sync_runs
    SET messages_found = ?,
        messages_synced = ?,
        errors = ?,
        error_detail = ?,
        completed_at = datetime('now')
    WHERE id = ?
  `,
  ).run(
    update.messagesFound,
    update.messagesSynced,
    update.errors,
    update.errorDetail ?? null,
    runId,
  );
}
