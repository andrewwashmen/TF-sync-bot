/**
 * Extracts task names from the Slack parent message posted by Zapier.
 *
 * The Zapier bot posts messages in this format (one or more items separated by dividers):
 *
 *   *Assessor:* John
 *
 *   *Task Names:*
 *   ITEM-001 - Blue Handbag Cleaning
 *
 *   *Brand:* Gucci
 *   ...
 *
 *   ——————————————————————————
 *
 *   *Task Names:*
 *   ITEM-002 - Red Shoe Repair
 *   ...
 */
export function extractTaskNames(messageText: string): string[] {
  const taskNames: string[] = [];

  // Match the pattern: *Task Names:*\n<task name>
  // The task name is on the line(s) immediately following *Task Names:*
  // until the next *Field:* or divider line
  const regex = /\*Task Names:\*\n([^\n*—]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(messageText)) !== null) {
    const name = match[1].trim();
    if (name.length > 0) {
      taskNames.push(name);
    }
  }

  return taskNames;
}

/**
 * Represents a single item's assessment fields parsed from a Slack or Asana message.
 */
export interface AssessmentItem {
  taskName: string;
  brand: string;
  outerMaterial: string;
  innerLining: string;
  stainDamage: string;
  recommendation: string;
  disclaimer: string;
  price: string;
  turnaround: string;
  level: string;
}

/**
 * Parses the Slack parent message into individual assessment items.
 * Splits by the divider (——————) and extracts fields from each block.
 */
export function parseAssessmentItems(messageText: string): AssessmentItem[] {
  // Split by the divider line
  const blocks = messageText.split(/—{5,}/);
  const items: AssessmentItem[] = [];

  for (const block of blocks) {
    const taskName = extractField(block, 'Task Names');
    if (!taskName) continue; // Skip blocks without a task name (e.g. the header)

    items.push({
      taskName,
      brand: extractField(block, 'Brand'),
      outerMaterial: extractMultilineField(block, 'Outer Material'),
      innerLining: extractMultilineField(block, 'Inner Lining'),
      stainDamage: extractMultilineField(block, 'Stain/Damage'),
      recommendation: extractMultilineField(block, 'Recommendation'),
      disclaimer: extractMultilineField(block, 'Disclaimer'),
      price: extractField(block, 'Price'),
      turnaround: extractField(block, 'Turnaround'),
      level: extractField(block, 'Level'),
    });
  }

  return items;
}

/**
 * Extracts a single-line field value: *Label:* value
 */
function extractField(block: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\*${escaped}:\\*\\s*(.*)`, 'm');
  const match = regex.exec(block);
  if (!match) return '';
  return match[1].trim();
}

/**
 * Extracts a field that may span multiple lines (e.g. bullet lists).
 * Captures everything from *Label:* until the next *AnotherLabel:* or end of block.
 */
function extractMultilineField(block: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `\\*${escaped}:\\*\\s*([\\s\\S]*?)(?=\\n\\*[^*]+:\\*|$)`,
    'm',
  );
  const match = regex.exec(block);
  if (!match) return '';
  return match[1].trim();
}

/**
 * Parses an Asana comment (posted by Zapier Step 7) into an AssessmentItem.
 * The Asana comment format:
 *   ASSESSOR NAME: ...
 *   ORDER ID: ...
 *
 *   *Task Names:*
 *   ...
 */
export function parseAsanaComment(commentText: string): AssessmentItem | null {
  const taskName = extractField(commentText, 'Task Names');
  if (!taskName) return null;

  return {
    taskName,
    brand: extractField(commentText, 'Brand'),
    outerMaterial: extractMultilineField(commentText, 'Outer Material'),
    innerLining: extractMultilineField(commentText, 'Inner Lining'),
    stainDamage: extractMultilineField(commentText, 'Stain/Damage'),
    recommendation: extractMultilineField(commentText, 'Recommendation'),
    disclaimer: extractMultilineField(commentText, 'Disclaimer'),
    price: extractField(commentText, 'Price'),
    turnaround: extractField(commentText, 'Turnaround'),
    level: extractField(commentText, 'Level'),
  };
}
