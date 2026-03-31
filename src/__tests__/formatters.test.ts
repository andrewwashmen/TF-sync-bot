import { describe, it, expect } from 'vitest';
import {
  slackMrkdwnToPlainText,
  formatAsanaComment,
} from '../slack/formatters.js';

describe('slackMrkdwnToPlainText', () => {
  it('should strip bold markers', () => {
    expect(slackMrkdwnToPlainText('*hello*')).toBe('hello');
  });

  it('should strip italic markers', () => {
    expect(slackMrkdwnToPlainText('_hello_')).toBe('hello');
  });

  it('should strip strikethrough markers', () => {
    expect(slackMrkdwnToPlainText('~hello~')).toBe('hello');
  });

  it('should convert Slack links with display text', () => {
    expect(slackMrkdwnToPlainText('<https://example.com|Click here>')).toBe(
      'Click here',
    );
  });

  it('should convert bare Slack links', () => {
    expect(slackMrkdwnToPlainText('<https://example.com>')).toBe(
      'https://example.com',
    );
  });

  it('should convert user mentions', () => {
    expect(slackMrkdwnToPlainText('<@U12345>')).toBe('@U12345');
  });

  it('should convert channel mentions', () => {
    expect(slackMrkdwnToPlainText('<#C12345|general>')).toBe('#general');
  });

  it('should convert subteam mentions with handle', () => {
    expect(slackMrkdwnToPlainText('<!subteam^S05GLSNAP63|@tf-sc>')).toBe(
      '@tf-sc',
    );
  });

  it('should remove bare subteam mentions', () => {
    expect(slackMrkdwnToPlainText('<!subteam^S05GLSNAP63>')).toBe('');
  });

  it('should convert special commands', () => {
    expect(slackMrkdwnToPlainText('<!here>')).toBe('@here');
    expect(slackMrkdwnToPlainText('<!channel>')).toBe('@channel');
  });

  it('should handle combined formatting', () => {
    const result = slackMrkdwnToPlainText('*bold* and _italic_');
    expect(result).toBe('bold and italic');
  });

  it('should handle empty string', () => {
    expect(slackMrkdwnToPlainText('')).toBe('');
  });
});

describe('formatAsanaComment', () => {
  const timestamp = new Date('2026-03-15T14:30:00Z');
  const userName = 'Ahmad';

  it('should format a regular message', () => {
    const result = formatAsanaComment(userName, timestamp, 'Hello', 'message');
    expect(result).toContain('Ahmad');
    expect(result).toContain('Hello');
  });

  it('should format an approval with header', () => {
    const result = formatAsanaComment(
      userName,
      timestamp,
      'Customer approved',
      'approval',
    );
    expect(result).toContain('APPROVAL');
    expect(result).toContain('Ahmad');
    expect(result).toContain('Customer approved');
  });

  it('should format a recommendation with header', () => {
    const result = formatAsanaComment(
      userName,
      timestamp,
      'Needs sole replacement',
      'recommendation',
    );
    expect(result).toContain('NEW RECOMMENDATION');
    expect(result).toContain('Needs sole replacement');
  });

  it('should format a file message', () => {
    const result = formatAsanaComment(
      userName,
      timestamp,
      'See attached photos',
      'file',
    );
    expect(result).toContain('attached file(s)');
    expect(result).toContain('See attached photos');
  });

  it('should strip mrkdwn within the message body', () => {
    const result = formatAsanaComment(
      userName,
      timestamp,
      '*Important:* check the _damage_',
      'message',
    );
    expect(result).toContain('Important:');
    expect(result).toContain('damage');
    expect(result).not.toContain('*');
    expect(result).not.toContain('_damage_');
  });
});
