import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MailScope } from '@gosu/briefing-core';
import {
  AppleMailConnection,
  APPLE_MAIL_READER,
  runAppleMailBodies,
  type runAppleMail,
} from './live-mail';
import { scholarCandidates } from './briefing-scholar-alerts';
import type { LiveItem } from './src/live-types';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

const html =
  '<h3><a href="https://scholar.google.com/scholar_url?url=https://arxiv.org/abs/2609.12345&amp;scisig=SECRET">Robust tensor quantile estimation</a></h3>' +
  '<div>A Author, B Author - arXiv preprint arXiv:2609.12345, 2026</div>' +
  '<a href="https://arxiv.org/pdf/2609.12345">[PDF] arxiv.org</a>';
const source = `From: Google Scholar Alerts <scholaralerts-noreply@google.com>\nContent-Type: text/html; charset=utf-8\n\n${html}`;

describe('Scholar alert links from the raw HTML source', () => {
  it('asks Mail for the raw source only of messages flagged for links', () => {
    const frames: Record<string, unknown>[] = [];
    const message = (id: number) => ({
      id: () => id,
      content: () => 'Robust tensor quantile estimation',
      messageSize: () => 20_000,
      mailAttachments: () => [],
      source: vi.fn(() => source),
    });
    const messages = { byId: vi.fn((id: number) => message(id)) };
    const box = { name: () => 'All Mail', mailboxes: () => [], messages };
    const run = runInNewContext(`${APPLE_MAIL_READER}; run`, {
      Application: () => ({ accounts: () => [{ id: () => 'a', mailboxes: () => [box] }] }),
      ObjC: { import: () => undefined },
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
        path: ['All Mail'],
        items: [{ id: '7', html: true }, { id: '8' }],
      }),
    ]);
    const sources = frames.filter((frame) => frame.type === 'mail-source');
    expect(sources).toEqual([{ type: 'mail-source', id: '7', source }]);
  });

  it('turns a streamed raw source into links in the body result', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
      stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
      kill: vi.fn(),
    });
    vi.mocked(spawn).mockReturnValue(child as never);
    const pending = runAppleMailBodies(
      { accountId: 'a', path: ['All Mail'], items: [{ id: '7', html: true }] },
      new AbortController().signal,
    );
    const send = (value: unknown) => child.stdout.emit('data', JSON.stringify(value) + '\n');
    send({ type: 'body-start', id: '7' });
    send({
      type: 'body',
      id: '7',
      preview: 'Robust tensor quantile estimation',
      bodyUnavailable: false,
    });
    send({ type: 'mail-source', id: '7', source });
    child.emit('close', 0);
    const result = await pending;
    expect(result.links?.['7']?.[0]).toEqual({
      text: 'Robust tensor quantile estimation',
      href: 'https://scholar.google.com/scholar_url?url=https://arxiv.org/abs/2609.12345&scisig=SECRET',
    });
  });

  it('flags only Scholar alerts for the source and puts their links on the mail item', async () => {
    const read = vi.fn<typeof runAppleMail>(async (input) =>
      input.action === 'accounts'
        ? { accounts: [{ id: 'raw', name: 'Gmail' }] }
        : input.action === 'mailboxes'
          ? { mailboxes: [{ path: ['All Mail'], name: 'All Mail' }] }
          : {
              messages: [
                {
                  id: '7',
                  title: 'New articles in your alert',
                  sender: 'Google Scholar Alerts <scholaralerts-noreply@google.com>',
                  date: '2026-09-08T00:00:00Z',
                  unread: true,
                  preview: '',
                  bodyUnavailable: true,
                },
                {
                  id: '8',
                  title: 'Lunch',
                  sender: 'Colleague <c@example.test>',
                  date: '2026-09-08T00:00:00Z',
                  unread: true,
                  preview: '',
                  bodyUnavailable: true,
                },
              ],
              scanned: 2,
              capped: false,
              bodiesDeferred: true,
            },
    );
    const readBodies = vi.fn(async () => ({
      bodies: {
        '7': { preview: 'Robust tensor quantile estimation', bodyUnavailable: false },
        '8': { preview: 'See you', bodyUnavailable: false },
      },
      proofs: {},
      links: {
        '7': [
          { text: 'Robust tensor quantile estimation', href: 'https://arxiv.org/abs/2609.12345' },
        ],
      },
      checked: [],
      stalled: [],
    }));
    const now = Date.parse('2026-09-09T00:00:00Z');
    const mail = new AppleMailConnection(read, () => now, readBodies);
    const signal = new AbortController().signal;
    const account = (await mail.listAccounts(signal))[0]!;
    const box = (await mail.listMailboxes(account.id, signal))[0]!;
    const scope: MailScope = {
      accountId: account.id,
      mailboxId: box.id,
      days: 3,
      limit: 10,
      subject: '',
      sender: '',
      unreadOnly: false,
      bodyPreview: true,
    };
    mail.authorize('r', scope);
    const result = await mail.collect('r', scope, signal);
    expect((readBodies.mock.calls[0] as unknown as [{ items: unknown[] }])[0].items).toEqual([
      { id: '7', html: true },
      { id: '8' },
    ]);
    const alert = result.items.find((item) => item.title === 'New articles in your alert');
    expect(alert?.mailLinks).toEqual([
      { text: 'Robust tensor quantile estimation', href: 'https://arxiv.org/abs/2609.12345' },
    ]);
    expect(result.items.find((item) => item.title === 'Lunch')).not.toHaveProperty('mailLinks');
  });
});

describe('Scholar candidates with HTML title links', () => {
  const alert: LiveItem = {
    id: 'mail',
    kind: 'email',
    title: 'Google Scholar alert',
    source: 'Mail',
    readScope: 'mail-preview',
    details: ['Scholar Alerts <scholaralerts-noreply@google.com>'],
    // Mail's plain text: titles and citation lines survive, every href is gone.
    text: 'Robust tensor quantile estimation\nA Author, B Author - arXiv preprint arXiv:2609.12345, 2026\nWe estimate quantiles of tensors.',
    publishedAt: '2026-09-10T00:00:00Z',
  };

  it('links a citation-only paper through its title anchor, never a [PDF] or unlisted link', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      const plain = scholarCandidates([alert]);
      expect(plain).toHaveLength(1);
      expect(plain[0]).not.toHaveProperty('sourceUrl');
      const linked = scholarCandidates([
        {
          ...alert,
          mailLinks: [
            {
              text: 'Robust tensor quantile estimation',
              href: 'https://scholar.google.com/scholar_url?url=https://arxiv.org/abs/2609.12345&scisig=SECRET',
            },
            { text: '[PDF] arxiv.org', href: 'https://arxiv.org/pdf/2609.99999' },
            { text: 'An unlisted host paper title', href: 'https://example.test/paper' },
            { text: 'A plain http paper title', href: 'http://www.nature.com/articles/plain' },
          ],
        },
      ]);
      expect(linked).toHaveLength(1);
      expect(linked[0]).toMatchObject({
        id: '2609.12345',
        title: 'Robust tensor quantile estimation',
        sourceUrl: 'https://arxiv.org/abs/2609.12345',
        bibliography: { authors: ['A Author, B Author'] },
      });
      expect(linked[0]!.text).toContain('We estimate quantiles');
      expect(JSON.stringify(linked)).not.toContain('SECRET');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('adds a linked paper that the cut-off plain-text preview did not reach', () => {
    const candidates = scholarCandidates([
      {
        ...alert,
        mailLinks: [
          { text: 'Robust tensor quantile estimation', href: 'https://arxiv.org/abs/2609.12345' },
          { text: 'A second paper beyond the preview', href: 'https://doi.org/10.1234/second' },
        ],
      },
    ]);
    expect(candidates.map((item) => [item.title, item.sourceUrl])).toEqual([
      ['Robust tensor quantile estimation', 'https://arxiv.org/abs/2609.12345'],
      ['A second paper beyond the preview', 'https://doi.org/10.1234/second'],
    ]);
  });
});
