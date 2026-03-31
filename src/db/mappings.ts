import type Database from 'better-sqlite3';

export interface TaskMapping {
  id: number;
  slack_channel_id: string;
  slack_thread_ts: string;
  asana_task_gid: string;
  order_id: string | null;
  item_name: string | null;
  created_at: string;
}

export interface CreateMappingInput {
  slackChannelId: string;
  slackThreadTs: string;
  asanaTaskGid: string;
  orderId?: string;
  itemName?: string;
}

export function createMapping(
  db: Database.Database,
  input: CreateMappingInput,
): TaskMapping | null {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO thread_task_mappings
      (slack_channel_id, slack_thread_ts, asana_task_gid, order_id, item_name)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.slackChannelId,
    input.slackThreadTs,
    input.asanaTaskGid,
    input.orderId ?? null,
    input.itemName ?? null,
  );

  if (result.changes === 0) return null; // Already existed

  return db
    .prepare('SELECT * FROM thread_task_mappings WHERE id = ?')
    .get(result.lastInsertRowid) as TaskMapping;
}

export function createMappingsBatch(
  db: Database.Database,
  slackChannelId: string,
  slackThreadTs: string,
  orderId: string | undefined,
  tasks: Array<{ task_gid: string; item_name?: string }>,
): number {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO thread_task_mappings
      (slack_channel_id, slack_thread_ts, asana_task_gid, order_id, item_name)
    VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(
    (items: Array<{ task_gid: string; item_name?: string }>) => {
      let created = 0;
      for (const item of items) {
        const result = insert.run(
          slackChannelId,
          slackThreadTs,
          item.task_gid,
          orderId ?? null,
          item.item_name ?? null,
        );
        if (result.changes > 0) created++;
      }
      return created;
    },
  );

  return transaction(tasks);
}

export function getMappingsByThread(
  db: Database.Database,
  threadTs: string,
): TaskMapping[] {
  return db
    .prepare('SELECT * FROM thread_task_mappings WHERE slack_thread_ts = ?')
    .all(threadTs) as TaskMapping[];
}

export function getMappingsByTask(
  db: Database.Database,
  taskGid: string,
): TaskMapping[] {
  return db
    .prepare('SELECT * FROM thread_task_mappings WHERE asana_task_gid = ?')
    .all(taskGid) as TaskMapping[];
}
