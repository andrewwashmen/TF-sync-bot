import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  createMapping,
  createMappingsBatch,
  getMappingsByThread,
  getMappingsByTask,
} from '../db/mappings.js';
import {
  getSyncedMessageKeys,
  logSyncEntry,
  createSyncRun,
  completeSyncRun,
} from '../db/sync-log.js';

const schemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../db/schema.sql',
);

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
});

afterEach(() => {
  db.close();
});

describe('mappings', () => {
  it('should create a mapping', () => {
    const mapping = createMapping(db, {
      slackChannelId: 'C123',
      slackThreadTs: '1234.5678',
      asanaTaskGid: 'T999',
      itemName: 'Blue Shoe Cleaning',
    });

    expect(mapping).not.toBeNull();
    expect(mapping!.slack_channel_id).toBe('C123');
    expect(mapping!.asana_task_gid).toBe('T999');
    expect(mapping!.item_name).toBe('Blue Shoe Cleaning');
  });

  it('should return null for duplicate mapping', () => {
    createMapping(db, {
      slackChannelId: 'C123',
      slackThreadTs: '1234.5678',
      asanaTaskGid: 'T999',
    });

    const duplicate = createMapping(db, {
      slackChannelId: 'C123',
      slackThreadTs: '1234.5678',
      asanaTaskGid: 'T999',
    });

    expect(duplicate).toBeNull();
  });

  it('should create multiple mappings in batch', () => {
    const created = createMappingsBatch(db, 'C123', '1234.5678', undefined, [
      { task_gid: 'T1', item_name: 'Item 1' },
      { task_gid: 'T2', item_name: 'Item 2' },
      { task_gid: 'T3', item_name: 'Item 3' },
    ]);

    expect(created).toBe(3);
  });

  it('should skip duplicates in batch', () => {
    createMapping(db, {
      slackChannelId: 'C123',
      slackThreadTs: '1234.5678',
      asanaTaskGid: 'T1',
    });

    const created = createMappingsBatch(db, 'C123', '1234.5678', undefined, [
      { task_gid: 'T1' },
      { task_gid: 'T2' },
    ]);

    expect(created).toBe(1);
  });

  it('should get mappings by thread', () => {
    createMappingsBatch(db, 'C123', '1234.5678', undefined, [
      { task_gid: 'T1', item_name: 'Item 1' },
      { task_gid: 'T2', item_name: 'Item 2' },
    ]);

    const mappings = getMappingsByThread(db, '1234.5678');
    expect(mappings).toHaveLength(2);
    expect(mappings.map((m) => m.asana_task_gid).sort()).toEqual(['T1', 'T2']);
  });

  it('should get mappings by task', () => {
    createMapping(db, {
      slackChannelId: 'C123',
      slackThreadTs: '1234.5678',
      asanaTaskGid: 'T1',
    });

    const mappings = getMappingsByTask(db, 'T1');
    expect(mappings).toHaveLength(1);
    expect(mappings[0].slack_thread_ts).toBe('1234.5678');
  });

  it('should return empty array for non-existent thread', () => {
    expect(getMappingsByThread(db, 'nonexistent')).toEqual([]);
  });
});

describe('sync log', () => {
  it('should return empty set for fresh thread', () => {
    const keys = getSyncedMessageKeys(db, '1234.5678');
    expect(keys.size).toBe(0);
  });

  it('should track synced messages', () => {
    logSyncEntry(db, {
      slackThreadTs: '1234.5678',
      slackMessageTs: '1234.5679',
      asanaTaskGid: 'T1',
      asanaStoryGid: 'S1',
      contentType: 'message',
    });

    const keys = getSyncedMessageKeys(db, '1234.5678');
    expect(keys.has('1234.5679:T1')).toBe(true);
    expect(keys.has('1234.5679:T2')).toBe(false);
  });

  it('should not duplicate sync entries', () => {
    logSyncEntry(db, {
      slackThreadTs: '1234.5678',
      slackMessageTs: '1234.5679',
      asanaTaskGid: 'T1',
      asanaStoryGid: 'S1',
      contentType: 'message',
    });

    // Same entry again — should not throw
    logSyncEntry(db, {
      slackThreadTs: '1234.5678',
      slackMessageTs: '1234.5679',
      asanaTaskGid: 'T1',
      asanaStoryGid: 'S2',
      contentType: 'approval',
    });

    const count = db
      .prepare('SELECT COUNT(*) as count FROM sync_log')
      .get() as { count: number };
    expect(count.count).toBe(1);
  });

  it('should allow same message to different tasks', () => {
    logSyncEntry(db, {
      slackThreadTs: '1234.5678',
      slackMessageTs: '1234.5679',
      asanaTaskGid: 'T1',
      asanaStoryGid: 'S1',
      contentType: 'message',
    });

    logSyncEntry(db, {
      slackThreadTs: '1234.5678',
      slackMessageTs: '1234.5679',
      asanaTaskGid: 'T2',
      asanaStoryGid: 'S2',
      contentType: 'message',
    });

    const keys = getSyncedMessageKeys(db, '1234.5678');
    expect(keys.has('1234.5679:T1')).toBe(true);
    expect(keys.has('1234.5679:T2')).toBe(true);
  });
});

describe('sync runs', () => {
  it('should create and complete a sync run', () => {
    const runId = createSyncRun(db, '1234.5678', 'U123');

    expect(runId).toBeGreaterThan(0);

    completeSyncRun(db, runId, {
      messagesFound: 10,
      messagesSynced: 8,
      errors: 2,
      errorDetail: JSON.stringify(['error1', 'error2']),
    });

    const run = db
      .prepare('SELECT * FROM sync_runs WHERE id = ?')
      .get(runId) as Record<string, unknown>;

    expect(run.messages_found).toBe(10);
    expect(run.messages_synced).toBe(8);
    expect(run.errors).toBe(2);
    expect(run.completed_at).not.toBeNull();
  });
});
