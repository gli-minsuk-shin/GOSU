import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  canonicalMailSource,
  deduplicateVerifiedMail,
  mailRowRepresentatives,
  sameVerifiedMail,
  sameDeliveredMail,
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
it('shows one row for the same Message-ID delivered to two accounts even without a source proof', () => {
  const copy = (account: string) => ({
    ...mail(account),
    mailContentProof: undefined,
    mailMessageUrl: 'message://%3Csame%40example.test%3E',
  });
  const result = deduplicateVerifiedMail([copy('a'), copy('b')]);
  expect(result).toHaveLength(1);
  expect(result[0]!.mailCopies?.map((c) => c.account.id)).toEqual(['a', 'b']);
  // A proof on only one side does not block the match; differing verified sources do.
  expect(sameDeliveredMail(copy('a'), { ...copy('b'), mailContentProof: proof })).toBe(true);
  expect(
    sameDeliveredMail(
      { ...copy('a'), mailContentProof: proof },
      { ...copy('b'), mailContentProof: { ...proof, digest: 'c'.repeat(64) } },
    ),
  ).toBe(false);
  // Not merged: different Message-ID, different subject, missing link, or the same account.
  expect(
    sameDeliveredMail(copy('a'), { ...copy('b'), mailMessageUrl: 'message://%3Cother%40x%3E' }),
  ).toBe(false);
  expect(sameDeliveredMail(copy('a'), { ...copy('b'), title: 'Other' })).toBe(false);
  expect(sameDeliveredMail(copy('a'), { ...copy('b'), mailMessageUrl: undefined })).toBe(false);
  // A same-account pair is still not a *delivery* pair: this rule refuses it and `mailCopies`
  // still means one copy per account. What changed is what happens to it afterwards. Two rows for
  // one message in one account was the reported duplicate, so `sameMessageTwice` now collapses it
  // -- on stricter evidence, the received time included. The test below covers that path.
  expect(sameDeliveredMail(copy('a'), copy('a'))).toBe(false);
  expect(deduplicateVerifiedMail([copy('a'), copy('a')])).toHaveLength(1);
});
it('shows one row for a message that sits in two mailboxes of the same account', () => {
  // Reported alongside the across-runs duplicate: an identical mail appearing twice. The dedup
  // merged copies only across *different* accounts, so one message that is in both the inbox and
  // an archive of the same account was two rows. It carries the same Message-ID, subject and
  // received time, which is more agreement than two distinct mails can have.
  const inTwoMailboxes = (mailboxItemId: string) => ({
    ...mail('a'),
    id: mailboxItemId.repeat(64),
    mailContentProof: undefined,
    mailMessageUrl: 'message://%3Csame%40example.test%3E',
  });

  const result = deduplicateVerifiedMail([inTwoMailboxes('c'), inTwoMailboxes('d')]);
  expect(result).toHaveLength(1);
  // Dropped, not folded into mailCopies: that field means one copy per account and still does.
  expect(result[0]!.mailCopies).toBeUndefined();

  // The row that kept a body wins, whichever order they arrive in.
  const withBody = { ...inTwoMailboxes('d'), mailContentProof: proof };
  expect(deduplicateVerifiedMail([inTwoMailboxes('c'), withBody])[0]!.mailContentProof).toEqual(
    proof,
  );

  // Still refuses without enough agreement: a different subject, a different received time, or no
  // Message-ID at all. A sender that reuses a Message-ID across two real sends differs in time.
  for (const different of [
    { title: 'Other' },
    { publishedAt: '2026-09-11T05:00:00Z' },
    { mailMessageUrl: undefined },
  ])
    expect(
      deduplicateVerifiedMail([inTwoMailboxes('c'), { ...inTwoMailboxes('d'), ...different }]),
    ).toHaveLength(2);

  // And never across accounts by this rule -- that path keeps its own evidence and its copy list.
  const across = deduplicateVerifiedMail([
    inTwoMailboxes('c'),
    { ...inTwoMailboxes('d'), mailAccount: { id: 'b', name: 'b', addresses: [] } },
  ]);
  expect(across).toHaveLength(1);
  expect(across[0]!.mailCopies?.map((c) => c.account.id)).toEqual(['a', 'b']);
});

it('gives a collapsed twin a stand-in so the mailbox can be marked read past it', () => {
  // The collapsed row is not in the result and is deliberately not a mailCopy -- the card counts
  // mailCopies when it says "같은 메일 · n개 계정 수신", so a same-account twin in there would claim
  // two accounts where there is one. But nextMailCoverage calls any read row that is neither
  // summarized nor spoken for "unhandled", refuses to advance the mailbox past it and re-reads from
  // that message every run. The stand-in is what closes that.
  const inTwoMailboxes = (mailboxItemId: string) => ({
    ...mail('a'),
    id: mailboxItemId.repeat(64),
    mailContentProof: undefined,
    mailMessageUrl: 'message://%3Csame%40example.test%3E',
  });
  const read = [inTwoMailboxes('c'), inTwoMailboxes('d')];
  const kept = deduplicateVerifiedMail(read);

  const stand = mailRowRepresentatives(read, kept);
  expect(kept).toHaveLength(1);
  expect(stand.get('d'.repeat(64))).toBe(kept[0]!.id);
  // The survivor speaks for itself and needs no entry.
  expect(stand.has(kept[0]!.id)).toBe(false);

  // Cross-account copies keep the stand-in they always had.
  const copies = [
    inTwoMailboxes('c'),
    { ...inTwoMailboxes('d'), mailAccount: { id: 'b', name: 'b', addresses: [] } },
  ];
  const merged = deduplicateVerifiedMail(copies);
  expect(mailRowRepresentatives(copies, merged).get('d'.repeat(64))).toBe(merged[0]!.id);
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
