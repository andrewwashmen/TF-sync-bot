import { describe, it, expect } from 'vitest';
import { classifyMessage } from '../sync/classifier.js';
import type { SlackMessage } from '../slack/thread.js';

function msg(text: string, files?: SlackMessage['files']): SlackMessage {
  return { ts: '1234.5678', user: 'U123', text, files };
}

describe('classifyMessage', () => {
  describe('file classification (highest priority)', () => {
    it('should classify messages with files as "file"', () => {
      expect(
        classifyMessage(
          msg('Here are the photos', [
            {
              id: 'F1',
              name: 'photo.jpg',
              mimetype: 'image/jpeg',
              size: 1024,
              url_private_download: 'https://files.slack.com/photo.jpg',
            },
          ]),
        ),
      ).toBe('file');
    });

    it('should classify as "file" even if text matches approval', () => {
      expect(
        classifyMessage(
          msg('Customer approved, see attached', [
            {
              id: 'F1',
              name: 'doc.pdf',
              mimetype: 'application/pdf',
              size: 2048,
              url_private_download: 'https://files.slack.com/doc.pdf',
            },
          ]),
        ),
      ).toBe('file');
    });
  });

  describe('approval classification', () => {
    it('should detect "approved"', () => {
      expect(classifyMessage(msg('Customer approved all items'))).toBe(
        'approval',
      );
    });

    it('should detect "customer has approved"', () => {
      expect(
        classifyMessage(msg('The customer has approved the recommendation')),
      ).toBe('approval');
    });

    it('should detect "got approval"', () => {
      expect(classifyMessage(msg('Got the approval from the client'))).toBe(
        'approval',
      );
    });

    it('should detect "go ahead"', () => {
      expect(classifyMessage(msg('Customer said go ahead with the repair'))).toBe(
        'approval',
      );
    });

    it('should detect "authorized"', () => {
      expect(classifyMessage(msg('Work has been authorized'))).toBe('approval');
    });

    it('should detect "confirmed"', () => {
      expect(classifyMessage(msg('Customer confirmed the price'))).toBe(
        'approval',
      );
    });

    it('should detect "gave ok"', () => {
      expect(classifyMessage(msg('Customer gave the ok'))).toBe('approval');
    });

    it('should be case insensitive', () => {
      expect(classifyMessage(msg('APPROVED by the customer'))).toBe('approval');
    });
  });

  describe('recommendation classification', () => {
    it('should detect "recommendation"', () => {
      expect(
        classifyMessage(msg('New recommendation: needs sole replacement')),
      ).toBe('recommendation');
    });

    it('should detect "additional work"', () => {
      expect(
        classifyMessage(msg('Found additional work needed on the heel')),
      ).toBe('recommendation');
    });

    it('should detect "also need"', () => {
      expect(classifyMessage(msg('We also need to fix the zipper'))).toBe(
        'recommendation',
      );
    });

    it('should detect "new item"', () => {
      expect(
        classifyMessage(msg('New item found during inspection')),
      ).toBe('recommendation');
    });

    it('should detect "found additional"', () => {
      expect(
        classifyMessage(msg('Found additional damage on the strap')),
      ).toBe('recommendation');
    });

    it('should detect "added to the list"', () => {
      expect(
        classifyMessage(msg('Added to the order: buckle replacement')),
      ).toBe('recommendation');
    });
  });

  describe('default message classification', () => {
    it('should classify regular messages as "message"', () => {
      expect(classifyMessage(msg('When will this be ready?'))).toBe('message');
    });

    it('should classify empty messages as "message"', () => {
      expect(classifyMessage(msg(''))).toBe('message');
    });

    it('should classify generic questions as "message"', () => {
      expect(
        classifyMessage(msg('Can you check the status of the order?')),
      ).toBe('message');
    });
  });

  describe('priority order', () => {
    it('should prioritize approval over recommendation when both match', () => {
      expect(
        classifyMessage(
          msg('Customer approved the recommendation for additional work'),
        ),
      ).toBe('approval');
    });
  });
});
