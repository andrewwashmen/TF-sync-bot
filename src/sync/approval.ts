/**
 * Determines the approval status of an Asana task based on
 * the synced comment text.
 *
 * - "Rejected" → any rejection keyword
 * - "Partially Approved" → approval keyword + condition/restriction
 * - "Approved" → approval keyword with no conditions
 * - null → no approval-related content detected
 */

export type ApprovalStatus = 'approved' | 'partially_approved' | 'rejected';

const REJECTION_PATTERNS = [
  /\breject(ed|ion)?\b/i,
  /\bnot\s+approved?\b/i,
  /\bdeclined?\b/i,
  /\bdenied?\b/i,
];

const APPROVAL_PATTERNS = [
  /\bapproved?\b/i,
  /\bgot\s+(the\s+)?approval\b/i,
  /\bgo\s+ahead\b/i,
  /\bauthorized?\b/i,
  /\bconfirmed?\b/i,
  /\bagreed?\b/i,
  /\bgave\s+(the\s+)?ok\b/i,
];

const PARTIAL_CONDITION_PATTERNS = [
  /\bonly\b/i,
  /\bexcept\b/i,
  /\bexcluding\b/i,
  /\bnot\s+for\b/i,
  /\bno\s+(color|restoration|repair|sole|heel)/i,
  /\bwithout\b/i,
  /\bcleaning\s+only\b/i,
  /\bpartial(ly)?\b/i,
  /\bapproved\s+for\s+\w+\s+only\b/i,
  /\bas\s+per\s+recommendation\s+except\b/i,
];

export function classifyApproval(commentText: string): ApprovalStatus | null {
  const text = commentText;

  // Check rejection first — takes priority
  for (const pattern of REJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return 'rejected';
    }
  }

  // Check for approval
  let isApproval = false;
  for (const pattern of APPROVAL_PATTERNS) {
    if (pattern.test(text)) {
      isApproval = true;
      break;
    }
  }

  if (!isApproval) {
    return null; // Not an approval-related comment
  }

  // Check for partial conditions
  for (const pattern of PARTIAL_CONDITION_PATTERNS) {
    if (pattern.test(text)) {
      return 'partially_approved';
    }
  }

  return 'approved';
}
