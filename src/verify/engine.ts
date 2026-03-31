import type { Logger } from 'pino';
import type { AsanaClient } from '../asana/client.js';
import type { AssessmentItem } from '../slack/parser.js';
import { parseAssessmentItems, parseAsanaComment } from '../slack/parser.js';

export interface FieldMismatch {
  field: string;
  slack: string;
  asana: string;
}

export interface TaskVerifyResult {
  taskName: string;
  asanaTaskGid: string;
  status: 'match' | 'mismatch' | 'missing_on_asana';
  mismatches: FieldMismatch[];
}

export interface VerifyResult {
  tasks: TaskVerifyResult[];
  allMatch: boolean;
}

/**
 * Compares the Slack parent message content with Asana task comments
 * to ensure assessment reports are in sync.
 */
export async function verifyAssessment(opts: {
  parentMessageText: string;
  mappings: Array<{ asana_task_gid: string; item_name: string | null }>;
  asanaClient: AsanaClient;
  logger: Logger;
}): Promise<VerifyResult> {
  const { parentMessageText, mappings, asanaClient, logger } = opts;

  // Parse the Slack message into per-item assessments
  const slackItems = parseAssessmentItems(parentMessageText);

  logger.info(
    { slackItemCount: slackItems.length, mappingCount: mappings.length },
    'Parsed Slack assessment items for verification',
  );

  const results: TaskVerifyResult[] = [];

  for (const mapping of mappings) {
    const taskGid = mapping.asana_task_gid;
    const taskName = mapping.item_name ?? taskGid;

    // Find the matching Slack item by task name
    const slackItem = slackItems.find(
      (item) =>
        item.taskName.trim().toLowerCase() ===
        taskName.trim().toLowerCase(),
    );

    if (!slackItem) {
      logger.warn({ taskName }, 'No matching Slack item found for task');
      results.push({
        taskName,
        asanaTaskGid: taskGid,
        status: 'match',
        mismatches: [],
      });
      continue;
    }

    // Fetch Asana comments for this task
    const comments = await asanaClient.getTaskComments(taskGid);

    if (comments.length === 0) {
      results.push({
        taskName,
        asanaTaskGid: taskGid,
        status: 'missing_on_asana',
        mismatches: [],
      });
      continue;
    }

    // Find the assessment comment — look for the one with ASSESSOR NAME or *Task Names:*
    const assessmentComment = findAssessmentComment(comments.map((c) => c.text));

    if (!assessmentComment) {
      results.push({
        taskName,
        asanaTaskGid: taskGid,
        status: 'missing_on_asana',
        mismatches: [],
      });
      continue;
    }

    // Parse the Asana comment
    const asanaItem = parseAsanaComment(assessmentComment);

    if (!asanaItem) {
      results.push({
        taskName,
        asanaTaskGid: taskGid,
        status: 'missing_on_asana',
        mismatches: [],
      });
      continue;
    }

    // Compare fields
    const mismatches = compareItems(slackItem, asanaItem);

    results.push({
      taskName,
      asanaTaskGid: taskGid,
      status: mismatches.length === 0 ? 'match' : 'mismatch',
      mismatches,
    });
  }

  return {
    tasks: results,
    allMatch: results.every((r) => r.status === 'match'),
  };
}

/**
 * Finds the original assessment comment among all Asana comments.
 * Looks for comments containing ASSESSOR NAME or *Task Names:* patterns.
 */
function findAssessmentComment(commentTexts: string[]): string | null {
  for (const text of commentTexts) {
    if (
      text.includes('ASSESSOR NAME:') ||
      text.includes('*Task Names:*') ||
      text.includes('Task Names:')
    ) {
      return text;
    }
  }
  return null;
}

const COMPARED_FIELDS: Array<{ key: keyof AssessmentItem; label: string }> = [
  { key: 'brand', label: 'Brand' },
  { key: 'outerMaterial', label: 'Outer Material' },
  { key: 'innerLining', label: 'Inner Lining' },
  { key: 'stainDamage', label: 'Stain/Damage' },
  { key: 'recommendation', label: 'Recommendation' },
  { key: 'disclaimer', label: 'Disclaimer' },
  { key: 'price', label: 'Price' },
  { key: 'turnaround', label: 'Turnaround' },
  { key: 'level', label: 'Level' },
];

/**
 * Compares two assessment items field by field.
 * Uses normalized comparison (trimmed, lowercase, collapsed whitespace).
 */
function compareItems(
  slack: AssessmentItem,
  asana: AssessmentItem,
): FieldMismatch[] {
  const mismatches: FieldMismatch[] = [];

  for (const { key, label } of COMPARED_FIELDS) {
    const slackVal = normalize(slack[key]);
    const asanaVal = normalize(asana[key]);

    if (slackVal !== asanaVal) {
      mismatches.push({
        field: label,
        slack: slack[key],
        asana: asana[key],
      });
    }
  }

  return mismatches;
}

/**
 * Normalizes a string for comparison: trim, lowercase, collapse whitespace,
 * strip bullet markers and Slack formatting.
 */
function normalize(value: string): string {
  return value
    .replace(/\*/g, '') // Strip Slack bold markers
    .replace(/^[-•]\s*/gm, '') // Strip bullet markers
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim()
    .toLowerCase();
}

/**
 * Formats the verify result as a Slack message.
 */
export function formatVerifyReport(result: VerifyResult): string {
  if (result.allMatch) {
    return 'All assessment reports match between Slack and Asana.';
  }

  const lines: string[] = ['*Verification Report*\n'];

  for (const task of result.tasks) {
    if (task.status === 'match') {
      lines.push(`*${task.taskName}* — Match`);
    } else if (task.status === 'missing_on_asana') {
      lines.push(
        `*${task.taskName}* — No assessment comment found on Asana`,
      );
    } else {
      lines.push(`*${task.taskName}* — Mismatch found:`);
      for (const m of task.mismatches) {
        lines.push(`  • *${m.field}*`);
        lines.push(`    Slack: ${m.slack || '(empty)'}`);
        lines.push(`    Asana: ${m.asana || '(empty)'}`);
      }
    }
  }

  return lines.join('\n');
}
