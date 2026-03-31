import type { WebClient } from '@slack/web-api';
import type { Logger } from 'pino';

export interface SlackMessage {
  ts: string;
  user: string;
  text: string;
  files?: SlackFile[];
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
}

export interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  url_private_download: string;
}

/**
 * Fetches all replies in a Slack thread, including the parent message.
 * Handles pagination for long threads.
 */
export async function fetchThreadMessages(
  client: WebClient,
  channelId: string,
  threadTs: string,
  logger: Logger,
): Promise<SlackMessage[]> {
  const allMessages: SlackMessage[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const response = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      cursor,
      limit: 200,
    });

    if (response.messages) {
      for (const msg of response.messages) {
        allMessages.push({
          ts: msg.ts!,
          user: msg.user ?? 'unknown',
          text: msg.text ?? '',
          files: msg.files?.map((f) => ({
            id: f.id!,
            name: f.name ?? 'unnamed',
            mimetype: f.mimetype ?? 'application/octet-stream',
            size: f.size ?? 0,
            url_private_download: (f as Record<string, unknown>)
              .url_private_download as string,
          })),
          thread_ts: msg.thread_ts,
          bot_id: (msg as Record<string, unknown>).bot_id as string | undefined,
          subtype: (msg as Record<string, unknown>).subtype as string | undefined,
        });
      }
    }

    cursor = response.response_metadata?.next_cursor;
    hasMore = !!cursor;
  }

  logger.debug(
    { threadTs, messageCount: allMessages.length },
    'Fetched thread messages',
  );

  return allMessages;
}

/**
 * Resolves a Slack user ID to a display name.
 */
export async function resolveUserName(
  client: WebClient,
  userId: string,
): Promise<string> {
  try {
    const result = await client.users.info({ user: userId });
    return (
      result.user?.real_name ?? result.user?.name ?? userId
    );
  } catch {
    return userId;
  }
}
