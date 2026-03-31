/**
 * Strips Slack mrkdwn formatting to produce clean plain text for Asana.
 */
export function slackMrkdwnToPlainText(text: string): string {
  let plain = text;

  // Slack links: <url|text> → text
  plain = plain.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2');

  // Bare Slack links: <url> → url
  plain = plain.replace(/<(https?:\/\/[^>]+)>/g, '$1');

  // Slack user mentions: <@U12345> → @U12345 (resolved later by caller if needed)
  plain = plain.replace(/<@([A-Z0-9]+)>/g, '@$1');

  // Slack channel mentions: <#C12345|channel-name> → #channel-name
  plain = plain.replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1');

  // Slack subteam mentions: <!subteam^S12345|@handle> → @handle
  plain = plain.replace(/<!subteam\^[A-Z0-9]+\|([^>]+)>/g, '$1');
  // Bare subteam: <!subteam^S12345> → (remove)
  plain = plain.replace(/<!subteam\^[A-Z0-9]+>/g, '');

  // Slack special commands: <!here>, <!channel>, <!everyone>
  plain = plain.replace(/<!here>/g, '@here');
  plain = plain.replace(/<!channel>/g, '@channel');
  plain = plain.replace(/<!everyone>/g, '@everyone');

  // Remove Slack bold/italic/strike markers for clean text
  plain = plain.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');
  plain = plain.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1');
  plain = plain.replace(/~([^~\n]+)~/g, '$1');

  return plain.trim();
}

/**
 * Formats a synced message as a plain text Asana comment.
 */
export function formatAsanaComment(
  userName: string,
  timestamp: Date,
  text: string,
  contentType: string,
): string {
  const timeStr = timestamp.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const bodyText = slackMrkdwnToPlainText(text);

  switch (contentType) {
    case 'approval':
      return `APPROVAL — ${userName} (${timeStr}):\n${bodyText}`;
    case 'recommendation':
      return `NEW RECOMMENDATION — ${userName} (${timeStr}):\n${bodyText}`;
    case 'file':
      return `${userName} (${timeStr}) attached file(s):\n${bodyText}`;
    default:
      return `${userName} (${timeStr}):\n${bodyText}`;
  }
}
