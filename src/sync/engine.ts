import type { WebClient } from '@slack/web-api';
import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type { TaskMapping } from '../db/mappings.js';
import {
  getSyncedMessageKeys,
  logSyncEntry,
  createSyncRun,
  completeSyncRun,
} from '../db/sync-log.js';
import { fetchThreadMessages, resolveUserName } from '../slack/thread.js';
import type { SlackMessage } from '../slack/thread.js';
import { classifyMessage } from './classifier.js';
import { formatAsanaComment } from '../slack/formatters.js';
import { AsanaClient } from '../asana/client.js';

// Per-thread lock to prevent concurrent syncs producing duplicates
const threadLocks = new Map<string, Promise<SyncResult>>();

export interface SyncOptions {
  db: Database.Database;
  slackClient: WebClient;
  asanaClient: AsanaClient;
  slackBotToken: string;
  channelId: string;
  threadTs: string;
  triggeredBy: string;
  mappings: TaskMapping[];
  logger: Logger;
}

export interface SyncResult {
  messagesFound: number;
  messagesSynced: number;
  errors: number;
}

/**
 * Sync with per-thread concurrency control.
 * If a sync is already in progress for this thread, waits for it to complete
 * then runs a fresh sync (to pick up any messages added during the wait).
 */
export async function syncThread(options: SyncOptions): Promise<SyncResult> {
  const { threadTs } = options;

  // Wait for any in-flight sync on this thread to complete
  const existing = threadLocks.get(threadTs);
  if (existing) {
    await existing.catch(() => {});
  }

  const syncPromise = doSyncThread(options);
  threadLocks.set(threadTs, syncPromise);

  try {
    return await syncPromise;
  } finally {
    // Only clear if this is still the active lock
    if (threadLocks.get(threadTs) === syncPromise) {
      threadLocks.delete(threadTs);
    }
  }
}

async function doSyncThread(options: SyncOptions): Promise<SyncResult> {
  const {
    db,
    slackClient,
    asanaClient,
    slackBotToken,
    channelId,
    threadTs,
    triggeredBy,
    mappings,
    logger,
  } = options;

  const runId = createSyncRun(db, threadTs, triggeredBy);

  // Cache for resolved user names
  const userNameCache = new Map<string, string>();

  async function getUserName(userId: string): Promise<string> {
    if (userNameCache.has(userId)) return userNameCache.get(userId)!;
    const name = await resolveUserName(slackClient, userId);
    userNameCache.set(userId, name);
    return name;
  }

  try {
    // 1. Fetch thread messages
    const messages = await fetchThreadMessages(
      slackClient,
      channelId,
      threadTs,
      logger,
    );

    // 2. Filter out non-syncable messages:
    //    - Bot messages (from this bot or any other)
    //    - "sync" trigger commands
    //    - The parent/root message (ts === thread_ts) — it's the task itself in Asana
    const syncableMessages = messages.filter((msg) => {
      if (msg.bot_id || msg.subtype === 'bot_message') return false;
      if (/^sync$/i.test(msg.text.trim())) return false;
      if (msg.ts === threadTs) return false;
      return true;
    });

    // 3. Get already-synced keys
    const syncedKeys = getSyncedMessageKeys(db, threadTs);

    // 4. Filter to un-synced messages, sorted chronologically
    const taskGids = mappings.map((m) => m.asana_task_gid);
    const pendingWork: Array<{
      message: SlackMessage;
      taskGid: string;
    }> = [];

    for (const message of syncableMessages) {
      for (const taskGid of taskGids) {
        const key = `${message.ts}:${taskGid}`;
        if (!syncedKeys.has(key)) {
          pendingWork.push({ message, taskGid });
        }
      }
    }

    logger.info(
      {
        threadTs,
        totalMessages: messages.length,
        pendingSync: pendingWork.length,
        tasks: taskGids.length,
      },
      'Sync diff calculated',
    );

    // 4. Process each pending item sequentially (respect rate limits)
    let synced = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    for (const { message, taskGid } of pendingWork) {
      try {
        const contentType = classifyMessage(message);
        const userName = await getUserName(message.user);
        const timestamp = slackTsToDate(message.ts);

        const htmlBody = formatAsanaComment(
          userName,
          timestamp,
          message.text,
          contentType,
        );

        const storyGid = await asanaClient.addComment(taskGid, htmlBody);

        // Upload files if present
        if (message.files && message.files.length > 0) {
          for (const file of message.files) {
            if (!file.url_private_download) {
              logger.warn(
                { fileId: file.id, fileName: file.name },
                'File has no download URL, skipping',
              );
              continue;
            }

            try {
              await asanaClient.uploadAttachment(
                taskGid,
                file.url_private_download,
                file.name,
                slackBotToken,
              );
            } catch (fileErr) {
              logger.error(
                { err: fileErr, fileId: file.id, taskGid },
                'Failed to upload file',
              );
            }
          }
        }

        logSyncEntry(db, {
          slackThreadTs: threadTs,
          slackMessageTs: message.ts,
          asanaTaskGid: taskGid,
          asanaStoryGid: storyGid,
          contentType,
        });

        synced++;
      } catch (err) {
        errors++;
        const errMsg =
          err instanceof Error ? err.message : 'Unknown error';
        errorDetails.push(
          `msg=${message.ts} task=${taskGid}: ${errMsg}`,
        );
        logger.error(
          { err, messageTs: message.ts, taskGid },
          'Failed to sync message',
        );
      }
    }

    completeSyncRun(db, runId, {
      messagesFound: messages.length,
      messagesSynced: synced,
      errors,
      errorDetail:
        errorDetails.length > 0
          ? JSON.stringify(errorDetails)
          : undefined,
    });

    return { messagesFound: messages.length, messagesSynced: synced, errors };
  } catch (err) {
    completeSyncRun(db, runId, {
      messagesFound: 0,
      messagesSynced: 0,
      errors: 1,
      errorDetail: JSON.stringify([
        err instanceof Error ? err.message : 'Unknown error',
      ]),
    });
    throw err;
  }
}

function slackTsToDate(ts: string): Date {
  const seconds = parseFloat(ts);
  return new Date(seconds * 1000);
}
