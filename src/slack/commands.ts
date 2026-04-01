import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type { AsanaClient } from '../asana/client.js';
import { getMappingsByThread, createMapping } from '../db/mappings.js';
import type { TaskMapping } from '../db/mappings.js';
import { syncThread } from '../sync/engine.js';
import { extractTaskNames } from './parser.js';
import { verifyAssessment, formatVerifyReport } from '../verify/engine.js';
import { slackMrkdwnToPlainText } from './formatters.js';
import { config } from '../config.js';

interface SyncCommandDeps {
  db: Database.Database;
  asanaClient: AsanaClient;
  slackBotToken: string;
  asanaWorkspaceGid: string;
  asanaProjectGid: string;
  logger: Logger;
}

export function registerSyncCommand(app: App, deps: SyncCommandDeps): void {
  const {
    db,
    asanaClient,
    slackBotToken,
    asanaWorkspaceGid,
    asanaProjectGid,
    logger,
  } = deps;

  // Listen for "sync" messages in threads
  app.message(/^sync$/i, async ({ message, client, say }) => {
    // Only respond to messages in threads
    if (!('thread_ts' in message) || !message.thread_ts) {
      return;
    }

    // Ignore bot messages to avoid loops
    if ('bot_id' in message && message.bot_id) {
      return;
    }

    const threadTs = message.thread_ts;
    const channelId = message.channel;
    const userId = 'user' in message ? message.user ?? 'unknown' : 'unknown';

    const replyInThread = async (text: string) => {
      await say({ text, thread_ts: threadTs });
    };

    // Check for existing mappings
    let mappings = getMappingsByThread(db, threadTs);

    // Auto-discover: if no mappings, parse the parent message and search Asana
    if (mappings.length === 0) {
      mappings = await discoverMappings({
        client,
        channelId,
        threadTs,
        db,
        asanaClient,
        asanaWorkspaceGid,
        asanaProjectGid,
        logger,
      });

      if (mappings.length === 0) {
        await replyInThread(
          'Could not find any matching Asana tasks. Make sure the task names in Asana match the assessment report.',
        );
        return;
      }
    }

    try {
      const result = await syncThread({
        db,
        slackClient: client,
        asanaClient,
        slackBotToken,
        channelId,
        threadTs,
        triggeredBy: userId,
        mappings,
        logger,
      });

      const taskNames = mappings
        .map((m) => m.item_name ?? m.asana_task_gid)
        .join(', ');

      let summary: string;
      if (result.messagesSynced === 0 && result.errors === 0) {
        summary = `Linked to ${mappings.length} task(s): ${taskNames}\nAll synced — no new messages to push.`;
      } else {
        summary = `Synced ${result.messagesSynced} new message(s) to ${mappings.length} Asana task(s): ${taskNames}`;
        if (result.errors > 0) {
          summary += `\n(${result.errors} error(s) — check logs for details)`;
        }
      }

      await replyInThread(summary);
    } catch (err) {
      logger.error({ err, threadTs }, 'Sync failed');
      await replyInThread(
        'Sync failed — an unexpected error occurred. Please try again or contact support.',
      );
    }
  });
}

export function registerVerifyCommand(app: App, deps: SyncCommandDeps): void {
  const {
    db,
    asanaClient,
    asanaWorkspaceGid,
    asanaProjectGid,
    logger,
  } = deps;

  // Listen for "verify" messages in threads
  app.message(/^verify$/i, async ({ message, client, say }) => {
    if (!('thread_ts' in message) || !message.thread_ts) {
      return;
    }
    if ('bot_id' in message && message.bot_id) {
      return;
    }

    const threadTs = message.thread_ts;
    const channelId = message.channel;

    const replyInThread = async (text: string) => {
      await say({ text, thread_ts: threadTs });
    };

    await runVerify({ client, channelId, threadTs, replyInThread, db, asanaClient, asanaWorkspaceGid, asanaProjectGid, logger });
  });
}

export function registerAutoVerify(app: App, deps: SyncCommandDeps): void {
  const {
    db,
    asanaClient,
    asanaWorkspaceGid,
    asanaProjectGid,
    logger,
  } = deps;

  const channelIds = config.autoVerify.channelIds;
  const delaySec = config.autoVerify.delaySec;

  if (channelIds.length === 0) {
    logger.info('Auto-verify disabled — no AUTO_VERIFY_CHANNELS configured');
    return;
  }

  logger.info({ channelIds, delaySec }, 'Auto-verify enabled');

  // Listen for new parent messages (not thread replies) that contain "Assessment Report"
  app.message(/Assessment Report/i, async ({ message, client, say }) => {
    // Only trigger on parent messages (not thread replies)
    if ('thread_ts' in message && message.thread_ts && message.thread_ts !== message.ts) {
      return;
    }

    // Ignore bot's own messages to avoid loops
    if ('bot_id' in message && message.bot_id) {
      // Still allow Zapier posts — Zapier uses bot_id but we want to verify those
      // Check if it's our own bot by looking at the app_id or bot name
      // For safety, allow all bot messages through since Zapier posts as a bot
    }

    const channelId = message.channel;
    if (!channelIds.includes(channelId)) {
      return;
    }

    // The parent message ts is the thread ts
    const threadTs = message.ts!;

    logger.info(
      { channelId, threadTs, delaySec },
      'Assessment report detected — scheduling auto-verify',
    );

    // Wait for Zapier to finish posting the Asana comment
    setTimeout(async () => {
      try {
        const replyInThread = async (text: string) => {
          await client.chat.postMessage({
            channel: channelId,
            text,
            thread_ts: threadTs,
          });
        };

        await runVerify({
          client,
          channelId,
          threadTs,
          replyInThread,
          db,
          asanaClient,
          asanaWorkspaceGid,
          asanaProjectGid,
          logger,
        });
      } catch (err) {
        logger.error({ err, threadTs }, 'Auto-verify failed');
      }
    }, delaySec * 1000);
  });
}

const MISMATCH_ALERT_CHANNEL = 'C0AQ4HSDCRK';

/**
 * Core verify logic — used by both manual "verify" command and auto-verify.
 * Posts exactly ONE message in the thread with the result.
 * On mismatch: auto-corrects on Asana and sends alert to the alert channel.
 */
async function runVerify(opts: {
  client: WebClient;
  channelId: string;
  threadTs: string;
  replyInThread: (text: string) => Promise<void>;
  db: Database.Database;
  asanaClient: AsanaClient;
  asanaWorkspaceGid: string;
  asanaProjectGid: string;
  logger: Logger;
}): Promise<void> {
  const {
    client,
    channelId,
    threadTs,
    replyInThread,
    db,
    asanaClient,
    asanaWorkspaceGid,
    asanaProjectGid,
    logger,
  } = opts;

  // Get or discover mappings (silently — no intermediate messages)
  let mappings = getMappingsByThread(db, threadTs);
  if (mappings.length === 0) {
    mappings = await discoverMappings({
      client,
      channelId,
      threadTs,
      db,
      asanaClient,
      asanaWorkspaceGid,
      asanaProjectGid,
      logger,
    });
    if (mappings.length === 0) {
      await replyInThread(
        'Could not find any matching Asana tasks. Cannot verify.',
      );
      return;
    }
  }

  try {
    const parentText = await fetchParentMessageText(client, channelId, threadTs);
    if (!parentText) {
      await replyInThread('Could not read the parent message.');
      return;
    }

    const result = await verifyAssessment({
      parentMessageText: parentText,
      mappings,
      asanaClient,
      logger,
    });

    if (result.allMatch) {
      // Single message — all good
      await replyInThread('All assessment reports match between Slack and Asana.');
      return;
    }

    // Mismatch found — auto-correct and send single summary
    const fixable = result.tasks.filter(
      (t) => t.status === 'mismatch' || t.status === 'missing_on_asana',
    );

    const { parseAssessmentItems } = await import('./parser.js');
    const slackItems = parseAssessmentItems(parentText);
    const correctedNames: string[] = [];

    for (const task of fixable) {
      const slackItem = slackItems.find(
        (item) =>
          item.taskName.trim().toLowerCase() ===
          task.taskName.trim().toLowerCase(),
      );
      if (!slackItem) continue;

      const commentBody = [
        `*Task Names:*\n${slackItem.taskName}`,
        `*Brand:* ${slackItem.brand}`,
        `*Outer Material:* ${slackItem.outerMaterial}`,
        `*Inner Lining:* ${slackItem.innerLining}`,
        `*Stain/Damage:*\n${slackItem.stainDamage}`,
        `*Recommendation:*\n${slackItem.recommendation}`,
        `*Disclaimer:* ${slackItem.disclaimer}`,
        `*Price:* ${slackItem.price}`,
        `*Turnaround:* ${slackItem.turnaround}`,
        `*Level:* ${slackItem.level}`,
      ].join('\n\n');

      const plainComment = slackMrkdwnToPlainText(commentBody);

      try {
        await asanaClient.addComment(
          task.asanaTaskGid,
          `[CORRECTED ASSESSMENT]\n\n${plainComment}`,
        );
        correctedNames.push(task.taskName);
      } catch (err) {
        logger.error(
          { err, taskGid: task.asanaTaskGid },
          'Failed to post corrected comment',
        );
      }
    }

    // Single message in thread
    await replyInThread(
      `Assessment mismatch detected. Corrected ${correctedNames.length} task(s) on Asana.`,
    );

    // Build thread link
    const threadLink = `https://washmen.slack.com/archives/${channelId}/p${threadTs.replace('.', '')}`;

    // Alert to the mismatch channel
    const alertLines = [
      `*Assessment Mismatch Detected*`,
      `*Assessment Report:* <${threadLink}|View on Slack>`,
      `*Tasks affected:*`,
      ...correctedNames.map((name) => `• ${name}`),
      `\nAuto-corrected on Asana.`,
    ];

    await client.chat.postMessage({
      channel: MISMATCH_ALERT_CHANNEL,
      text: alertLines.join('\n'),
    });
  } catch (err) {
    logger.error({ err, threadTs }, 'Verify failed');
    await replyInThread(
      'Verification failed — an unexpected error occurred.',
    );
  }
}

/**
 * Fetches the parent (first) message text of a Slack thread.
 */
async function fetchParentMessageText(
  client: WebClient,
  channelId: string,
  threadTs: string,
): Promise<string | null> {
  const response = await client.conversations.replies({
    channel: channelId,
    ts: threadTs,
    limit: 1,
    inclusive: true,
  });

  type RepliesResponse = { messages?: Array<{ text?: string }> };
  const replies = response as RepliesResponse;
  return replies.messages?.[0]?.text ?? null;
}

/**
 * Reads the parent message of a thread, extracts task names,
 * searches Asana for each, and creates mappings in the DB.
 */
async function discoverMappings(opts: {
  client: WebClient;
  channelId: string;
  threadTs: string;
  db: Database.Database;
  asanaClient: AsanaClient;
  asanaWorkspaceGid: string;
  asanaProjectGid: string;
  logger: Logger;
}): Promise<TaskMapping[]> {
  const {
    client,
    channelId,
    threadTs,
    db,
    asanaClient,
    asanaWorkspaceGid,
    asanaProjectGid,
    logger,
  } = opts;

  // Fetch the parent message (first message in the thread)
  const response = await client.conversations.replies({
    channel: channelId,
    ts: threadTs,
    limit: 1,
    inclusive: true,
  });

  type RepliesResponse = { messages?: Array<{ text?: string }> };
  const replies = response as RepliesResponse;

  const parentMessage = replies.messages?.[0];
  if (!parentMessage?.text) {
    logger.warn({ threadTs }, 'Could not fetch parent message');
    return [];
  }

  // Extract task names from the Zapier-formatted message
  const taskNames = extractTaskNames(parentMessage.text);
  if (taskNames.length === 0) {
    logger.warn({ threadTs }, 'No task names found in parent message');
    return [];
  }

  logger.info({ threadTs, taskNames }, 'Extracted task names from parent message');

  // Search Asana for each task name and create mappings
  const mappings: TaskMapping[] = [];

  for (const taskName of taskNames) {
    try {
      const asanaTask = await asanaClient.findTaskByName(
        asanaWorkspaceGid,
        asanaProjectGid,
        taskName,
      );

      if (asanaTask) {
        const mapping = createMapping(db, {
          slackChannelId: channelId,
          slackThreadTs: threadTs,
          asanaTaskGid: asanaTask.gid,
          itemName: asanaTask.name,
        });

        if (mapping) {
          mappings.push(mapping);
          logger.info(
            { taskName, asanaGid: asanaTask.gid },
            'Auto-discovered and linked Asana task',
          );
        }
      } else {
        logger.warn({ taskName }, 'Asana task not found for name');
      }
    } catch (err) {
      logger.error({ err, taskName }, 'Failed to search Asana for task');
    }
  }

  return mappings;
}
