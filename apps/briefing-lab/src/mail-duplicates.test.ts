import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  canonicalMailSource,
  deduplicateVerifiedMail,
  sameVerifiedMail,
  pendingMailRechecks,
} from './mail-duplicates';
import { summarySourceDigest } from '../briefing-summary-cache';
import type { LiveItem } from './live-types';
const raw = (delivery: string, body = 'Identical complete body') =>
  `Received: ${delivery}\nDelivered-To: ${delivery}\nFrom: sender@example.test\nTo: group@example.test\nSubject: Deadline\nDate: Fri, 11 Sep 2026 09:00:00 +0900\nMessage-ID: <same@example.test>\nContent-Type: text/plain\n\n${body}`;
const proof = {
  version: 1 as const,
  digest: createHash('sha256')
    .update(canonicalMailSource(raw('a'), 'same@example.test')!)
    .digest('hex'),
  previewDigest: 'b'.repeat(64),
  length: canonicalMailSource(raw('a'), 'same@example.test')!.length,
};
const mail = (account: string): LiveItem => ({
  id: account.repeat(64),
  kind: 'email',
  title: 'Deadline',
  text: 'Identical preview',
  source: 'Apple Mail',
  readScope: 'mail-preview',
  details: ['sender@example.test', '읽지 않음'],
  publishedAt: '2026-09-11T00:00:00Z',
  mailAccount: { id: account, name: account, addresses: [`${account}@example.test`] },
  mailContentProof: proof,
});
it('compares complete authored source while ignoring only delivery transport headers', () => {
  expect(canonicalMailSource(raw('a'), 'same@example.test')).toBe(
    canonicalMailSource(raw('b'), 'same@example.test'),
  );
  for (const changed of [
    raw('b', 'Different ending'),
    raw('b').replace('sender@', 'other@'),
    raw('b').replace('group@', 'different@'),
    raw('b').replace('09:00:00', '10:00:00'),
  ])
    expect(canonicalMailSource(changed, 'same@example.test')).not.toBe(
      canonicalMailSource(raw('a'), 'same@example.test'),
    );
});
it('does not verify partial, mismatched, oversized or multipart messages', () => {
  expect(canonicalMailSource(raw('a'), 'other@example.test')).toBeNull();
  expect(canonicalMailSource(raw('a', ''), 'same@example.test')).toBeNull();
  expect(canonicalMailSource(raw('a', 'x'.repeat(262144)), 'same@example.test')).toBeNull();
  expect(
    canonicalMailSource(
      raw('a').replace('text/plain', 'multipart/mixed; boundary=abc'),
      'same@example.test',
    ),
  ).toBeNull();
});
it('merges verified cross-account copies and retains each account identity for future exclusions', () => {
  const a = mail('a'),
    b = mail('b');
  const result = deduplicateVerifiedMail([a, b]);
  expect(result).toHaveLength(1);
  expect(result[0]!.mailCopies?.map((c) => c.account.id)).toEqual(['a', 'b']);
  expect(a.mailCopies).toBeUndefined();
  expect(summarySourceDigest(a)).toBe(summarySourceDigest(b));
});
it('never merges on title alone, across differing previews, or within one account', () => {
  expect(sameVerifiedMail(mail('a'), { ...mail('b'), mailContentProof: undefined })).toBe(false);
  expect(
    sameVerifiedMail(mail('a'), {
      ...mail('b'),
      mailContentProof: { ...proof, previewDigest: 'c'.repeat(64) },
    }),
  ).toBe(false);
  expect(
    sameVerifiedMail(mail('a'), {
      ...mail('b'),
      mailContentProof: { ...proof, digest: 'c'.repeat(64) },
    }),
  ).toBe(false);
  expect(deduplicateVerifiedMail([mail('a'), mail('a')])).toHaveLength(2);
});
it('rechecks legacy cross-account Message-ID candidates once, not every summary or every mailbox', () => {
  const legacy = ['a', 'b'].map((id) => ({
    ...mail(id),
    mailContentProof: undefined,
    mailMessageUrl: 'message://same',
  }));
  expect(pendingMailRechecks(legacy, ['a', 'b'])).toHaveLength(2);
  expect(pendingMailRechecks(legacy, ['a'])).toHaveLength(0);
  expect(
    pendingMailRechecks(
      [legacy[0]!, { ...legacy[1]!, mailMessageUrl: 'message://different' }],
      ['a', 'b'],
    ),
  ).toHaveLength(0);
  const checked = legacy.map((i) => ({ ...i, mailDuplicateCheckedAt: '2026-09-11T00:00:00Z' }));
  expect(pendingMailRechecks([...legacy, ...checked], ['a', 'b'])).toHaveLength(0);
});
it('hides a legacy row only when a verified group covers its exact stored delivery identity', () => {
  const group = deduplicateVerifiedMail([mail('a'), mail('b')])[0]!;
  const old = { ...mail('b'), mailContentProof: undefined };
  expect(deduplicateVerifiedMail([old, group])).toEqual([group]);
  expect(deduplicateVerifiedMail([{ ...old, title: 'Changed subject' }, group])).toHaveLength(2);
  expect(
    pendingMailRechecks(
      [
        { ...old, mailMessageUrl: 'message://same' },
        { ...group, mailMessageUrl: 'message://same' },
      ],
      ['a', 'b'],
    ),
  ).toHaveLength(0);
});
