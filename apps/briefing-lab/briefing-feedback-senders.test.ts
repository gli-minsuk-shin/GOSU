import { expect, it } from 'vitest';
import { feedbackSenderLookup } from './briefing-feedback-senders';

it('finds the sender of a rated email in the saved briefings or the current collection', () => {
  const senderOf = feedbackSenderLookup(
    [
      {
        items: [
          {
            id: 'a',
            kind: 'email',
            readScope: 'mail-preview',
            mailSender: 'Kim <kim@yonsei.ac.kr>',
          },
          { id: 'p', kind: 'papers', readScope: 'abstract', mailSender: undefined },
          // Stored before `kind` existed: a mail read scope still marks an email.
          { id: 'b', readScope: 'mail-metadata', mailSender: 'Office <office@nrf.re.kr>' },
        ],
      },
    ],
    [{ id: 'live', kind: 'email', details: ['Live <live@example.org>', '읽지 않음'] }],
  );
  expect(senderOf('a')).toBe('Kim <kim@yonsei.ac.kr>');
  expect(senderOf('b')).toBe('Office <office@nrf.re.kr>');
  expect(senderOf('live')).toBe('Live <live@example.org>');
  expect(senderOf('p')).toBeUndefined();
  expect(senderOf('missing')).toBeUndefined();
});
