import type { SlackMessage } from '../slack/thread.js';

export type ContentType = 'message' | 'file' | 'approval' | 'recommendation';

const APPROVAL_PATTERNS = [
  /\bapproved?\b/i,
  /\bcustomer\s+(has\s+)?approved?\b/i,
  /\bgot\s+(the\s+)?approval\b/i,
  /\bgo\s+ahead\b/i,
  /\bauthorized?\b/i,
  /\bconfirmed?\b/i,
  /\bcustomer\s+(has\s+)?agreed\b/i,
  /\bgave\s+(the\s+)?ok\b/i,
];

const RECOMMENDATION_PATTERNS = [
  /\brecommend(ation|ed|s)?\b/i,
  /\badditional\s+(work|item|repair|service)/i,
  /\balso\s+need/i,
  /\bnew\s+(item|finding|issue|repair)/i,
  /\bfound\s+(another|additional|more)/i,
  /\badd(ed|ing)?\s+to\s+(the\s+)?(list|order|ticket)/i,
];

/**
 * Classifies a Slack message into a content type for Asana formatting.
 *
 * Priority order:
 * 1. If the message has files → 'file' (always — files are the most actionable)
 * 2. If the text matches approval patterns → 'approval'
 * 3. If the text matches recommendation patterns → 'recommendation'
 * 4. Default → 'message'
 */
export function classifyMessage(message: SlackMessage): ContentType {
  if (message.files && message.files.length > 0) {
    return 'file';
  }

  const text = message.text;

  for (const pattern of APPROVAL_PATTERNS) {
    if (pattern.test(text)) {
      return 'approval';
    }
  }

  for (const pattern of RECOMMENDATION_PATTERNS) {
    if (pattern.test(text)) {
      return 'recommendation';
    }
  }

  return 'message';
}
