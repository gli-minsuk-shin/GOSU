import { expect, it } from 'vitest';
import { observedMailUnread } from './mail-read-state';
it('prefers the typed native boolean, including false, over legacy metadata', () => {
  expect(
    observedMailUnread({ kind: 'email', mailUnread: false, details: ['Sender', '읽지 않음'] }),
  ).toBe(false);
  expect(observedMailUnread({ kind: 'email', mailUnread: true, details: ['Sender', '읽음'] })).toBe(
    true,
  );
});
it('uses only the exact legacy status slot and leaves missing/ambiguous values unknown', () => {
  expect(observedMailUnread({ kind: 'email', details: ['Sender', '읽음'] })).toBe(false);
  expect(observedMailUnread({ kind: 'email', details: ['Sender', '읽지 않음'] })).toBe(true);
  expect(
    observedMailUnread({ kind: 'email', details: ['읽음', 'Forwarded text says 읽지 않음'] }),
  ).toBeUndefined();
  expect(observedMailUnread({ kind: 'email' })).toBeUndefined();
  expect(observedMailUnread({ kind: 'papers', mailUnread: true })).toBeUndefined();
});
