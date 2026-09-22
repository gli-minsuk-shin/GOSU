import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import {
  APPLE_MAIL_METADATA_BUDGET_MS,
  APPLE_MAIL_READ_TIMEOUT_MS,
  APPLE_MAIL_READER,
} from './live-mail';
import {
  MAIL_COVERAGE_OVERLAP_MS,
  mailDeliveryKey,
  needsMailReread,
  nextMailCoverage,
  type MailTargetCoverage,
} from './briefing-mail-ingestion';

const digest = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const hour = 3_600_000;

/** Runs the real reader over newest-first synthetic messages, one per hour. */
function read(options: {
  count: number;
  limit?: number;
  stopAt?: number;
  days?: number;
  deliveries?: number[];
}) {
  const now = Date.now();
  const subject = vi.fn(() => 'Synthetic subject');
  const messages = Array.from({ length: options.count }, (_, id) => () => ({
    exists: () => true,
    dateReceived: () => new Date(now - (id + 1) * hour),
    readStatus: () => false,
    subject,
    sender: () => 'Sender',
    id: () => id,
    content: () => 'Synthetic preview',
    messageId: () => `m${id}@example.test`,
    source: () => '',
    mailAttachments: () => [],
    messageSize: () => 20_000,
  }));
  const account = {
    id: () => 'a',
    name: () => 'Synthetic',
    emailAddresses: () => ['a@example.test'],
    mailboxes: () => [
      {
        name: () => 'Inbox',
        mailboxes: () => [],
        messages: Object.assign(messages, {
          whose: (filter: { dateReceived: { _greaterThan: Date } }) => () =>
            messages
              .map((ref) => ref())
              .filter(
                (m) => m.dateReceived().getTime() > filter.dateReceived._greaterThan.getTime(),
              ),
        }),
      },
    ],
  };
  const deliveries = (options.deliveries ?? []).map((id) =>
    mailDeliveryKey(
      digest(['a', ['Inbox'], String(id)]),
      new Date(now - (id + 1) * hour).toISOString(),
    ),
  );
  const foundation = Object.assign((s: string) => ({ dataUsingEncoding: () => s }), {
    NSUTF8StringEncoding: 4,
    NSString: { alloc: { initWithDataEncoding: (s: string) => s } },
    NSFileHandle: {
      fileHandleWithStandardInput: {
        readDataToEndOfFile: JSON.stringify({ keys: [], deliveries }),
      },
      fileHandleWithStandardOutput: { writeData: () => undefined },
    },
  });
  const run = runInNewContext(`${APPLE_MAIL_READER}; run`, {
    Application: () => ({ accounts: () => [account] }),
    ObjC: { import: () => undefined, unwrap: (s: unknown) => s },
    $: foundation,
  });
  const result = JSON.parse(
    run([
      JSON.stringify({
        action: 'read',
        accountId: 'a',
        path: ['Inbox'],
        since: new Date(now - (options.days ?? 3) * 24 * hour).toISOString(),
        ...(options.stopAt !== undefined
          ? { stopAt: new Date(now - options.stopAt * hour).toISOString() }
          : {}),
        hasExclusions: deliveries.length > 0,
        scope: {
          days: options.days ?? 3,
          limit: options.limit ?? 100,
          subject: '',
          sender: '',
          unreadOnly: false,
          bodyPreview: false,
        },
      }),
    ]),
  );
  return { result, subject };
}

describe('Apple Mail reader coverage', () => {
  it('gives the metadata scan 100 seconds inside a longer process deadline', () => {
    expect(APPLE_MAIL_METADATA_BUDGET_MS).toBe(100_000);
    expect(APPLE_MAIL_READ_TIMEOUT_MS).toBeGreaterThan(APPLE_MAIL_METADATA_BUDGET_MS + 30_000);
  });

  it('stops at the previous coverage floor and reports that it reached it', () => {
    const { result } = read({ count: 40, stopAt: 10 });
    expect(result.messages).toHaveLength(9);
    expect(result.coverage).toMatchObject({
      ordered: true,
      floorReached: true,
      stoppedBy: 'floor',
    });
  });

  it('never reads below the approved days window even when coverage is older', () => {
    const { result } = read({ count: 100, stopAt: 90, days: 1 });
    expect(result.messages).toHaveLength(23);
    expect(Date.parse(result.coverage.floor)).toBeGreaterThan(Date.now() - 24 * hour - 1000);
  });

  it('reports a read cut short by the per-run limit with the oldest examined message', () => {
    const { result } = read({ count: 40, limit: 5 });
    expect(result.messages).toHaveLength(5);
    expect(result.coverage).toMatchObject({ floorReached: false, stoppedBy: 'limit' });
    expect(Date.parse(result.coverage.oldest)).toBeLessThan(Date.now() - 4.5 * hour);
  });

  it('skips already summarized deliveries before reading subject or sender', () => {
    const { result, subject } = read({ count: 12, stopAt: 7, deliveries: [0, 1, 2] });
    expect(result.messages.map((m: { id: string }) => m.id)).toEqual(['3', '4', '5']);
    expect(result.coverage).toMatchObject({ known: 3, floorReached: true });
    expect(subject).toHaveBeenCalledTimes(3);
  });
});

const at = (hoursAgo: number) =>
  new Date(Date.parse('2026-09-17T12:00:00Z') - hoursAgo * hour).toISOString();
function report(
  read: Partial<NonNullable<MailTargetCoverage['read']>> | null,
  items: MailTargetCoverage['items'] = [],
): MailTargetCoverage {
  return {
    accountId: 'gmail',
    mailboxId: 'all',
    accountName: 'Gmail',
    since: at(72),
    startedAt: at(0),
    read: read && {
      ordered: true,
      floorReached: true,
      stoppedBy: 'floor',
      newest: at(1),
      oldest: at(5),
      floor: at(6),
      examined: 10,
      known: 2,
      ...read,
    },
    items,
  };
}
const mail = (id: string, hoursAgo: number, bodyUnavailable = false) => ({
  id,
  receivedAt: at(hoursAgo),
  bodyUnavailable,
  copyIds: [],
});

describe('mail coverage advancement', () => {
  it('joins the previous coverage when the read reached its floor and everything was handled', () => {
    const previous = { coveredFrom: at(48), coveredTo: at(4), gapFrom: null };
    const next = nextMailCoverage(previous, report({}, [mail('x', 2)]), new Set(['x']));
    expect(next).toMatchObject({
      coveredFrom: at(48),
      coveredTo: at(0),
      gapFrom: null,
      agedOutFrom: null,
      reason: null,
    });
  });

  it('records the unexamined interval when the read stopped early', () => {
    const previous = { coveredFrom: at(48), coveredTo: at(20), gapFrom: null };
    const next = nextMailCoverage(
      previous,
      report({ floorReached: false, stoppedBy: 'budget', oldest: at(9) }),
      new Set(),
    );
    expect(next).toMatchObject({ coveredFrom: at(9), coveredTo: at(0), gapFrom: at(20) });
  });

  it('keeps an unsummarized or body-less message inside the gap so the next run reads it again', () => {
    const next = nextMailCoverage(
      null,
      report({}, [mail('summarized', 2), mail('failed', 3), mail('no-body', 1, true)]),
      new Set(['summarized', 'failed-other', 'no-body']),
    );
    expect(next).toMatchObject({ coveredFrom: at(1), gapFrom: at(72) });
  });

  it('treats a copy merged into a summarized row as handled', () => {
    const copy = { ...mail('yonsei-copy', 2), copyIds: ['gmail-row'] };
    const next = nextMailCoverage(null, report({ floor: at(72) }, [copy]), new Set(['gmail-row']));
    expect(next).toMatchObject({ gapFrom: null, coveredFrom: at(72) });
  });

  it('reports a gap that aged out of the days window once, then stops reporting it', () => {
    const previous = { coveredFrom: at(80), coveredTo: at(79), gapFrom: at(90) };
    const next = nextMailCoverage(previous, report({ floor: at(72) }), new Set())!;
    expect(next).toMatchObject({ gapFrom: null, agedOutFrom: at(90) });
    expect(
      nextMailCoverage({ ...next, gapFrom: null }, report({}), new Set())!.agedOutFrom,
    ).toBeNull();
  });

  it('does not claim coverage for an out-of-order mailbox or a failed read', () => {
    const previous = { coveredFrom: at(48), coveredTo: at(20), gapFrom: null };
    expect(
      nextMailCoverage(
        previous,
        report({ ordered: false, floorReached: false, stoppedBy: 'scan' }),
        new Set(),
      ),
    ).toMatchObject({ coveredFrom: at(0), gapFrom: at(20) });
    expect(nextMailCoverage(previous, report(null), new Set())).toBeNull();
  });

  it('overlaps the next floor and re-reads bodies only when previews are enabled', () => {
    expect(MAIL_COVERAGE_OVERLAP_MS).toBe(6 * hour);
    const metadata = { kind: 'email', readScope: 'mail-metadata' };
    expect(needsMailReread(metadata, { bodyPreview: true })).toBe(true);
    expect(needsMailReread(metadata, { bodyPreview: false })).toBe(false);
    expect(
      needsMailReread({ kind: 'email', readScope: 'mail-preview' }, { bodyPreview: true }),
    ).toBe(false);
  });
});

describe('supervised bodies action in the reader', () => {
  it('announces each message before its body and proves small sources', () => {
    const frames: Record<string, unknown>[] = [];
    const content = vi.fn(() => 'Body text');
    const byId = vi.fn((id: number) => ({
      id: () => id,
      content,
      messageSize: () => 1_000,
      mailAttachments: () => [],
      source: () =>
        'From: sender@example.test\nDate: Fri, 11 Sep 2026 09:00:00 +0900\nMessage-ID: <synthetic@example.test>\nContent-Type: text/plain\n\nBody text',
    }));
    const box = { name: () => 'Inbox', mailboxes: () => [], messages: { byId } };
    const account = { id: () => 'a', mailboxes: () => [box] };
    const run = runInNewContext(`${APPLE_MAIL_READER}; run`, {
      Application: () => ({ accounts: () => [account] }),
      ObjC: { import: () => undefined, unwrap: (s: unknown) => s },
      $: Object.assign((s: string) => ({ dataUsingEncoding: () => s }), {
        NSUTF8StringEncoding: 4,
        NSFileHandle: {
          fileHandleWithStandardOutput: { writeData: (s: string) => frames.push(JSON.parse(s)) },
        },
      }),
    });
    run([
      JSON.stringify({
        action: 'bodies',
        accountId: 'a',
        path: ['Inbox'],
        items: [{ id: '7', messageId: 'synthetic@example.test' }, { id: '8' }],
      }),
    ]);
    const types = frames.map((f) => `${f.type}:${f.id}`);
    expect(types.slice(0, 2)).toEqual(['body-start:7', 'body:7']);
    expect(types).toContain('content-proof:7');
    expect(types.indexOf('body-start:8')).toBeGreaterThan(types.indexOf('body:7'));
    expect(byId).toHaveBeenCalledWith(7);
  });
});

describe('gap reasons for user warnings', () => {
  it('distinguishes the per-run limit, body downloads and incomplete reads', () => {
    expect(
      nextMailCoverage(
        null,
        report({ floorReached: false, stoppedBy: 'limit', oldest: at(3), pending: 40 }),
        new Set(),
      ),
    ).toMatchObject({ reason: 'limit', pending: 40 });
    expect(
      nextMailCoverage(null, report({}, [mail('waiting', 2, true)]), new Set(['waiting'])),
    ).toMatchObject({ reason: 'body', bodyWaiting: 1 });
    expect(
      nextMailCoverage(null, report({ floorReached: false, stoppedBy: 'budget' }), new Set()),
    ).toMatchObject({ reason: 'incomplete' });
  });
});
