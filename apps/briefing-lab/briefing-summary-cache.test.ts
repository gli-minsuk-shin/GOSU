import { describe, expect, it } from 'vitest';
import { summarySourceDigest, summaryContextDigest } from './briefing-summary-cache';
import type { LiveItem } from './src/live-types';

const item: LiveItem = {
  id: 'mail:123',
  kind: 'email',
  title: 'Meeting',
  text: 'Tomorrow at 10.',
  source: 'Apple Mail',
  readScope: 'mail-preview',
  publishedAt: '2026-09-09T00:00:00Z',
  details: ['sender@example.test', 'Inbox'],
};
describe('exact summary input identity', () => {
  it('invalidates context when the approved mailbox or paper interests change', () => {
    const interest = { keywords: [], excluded: [] };
    const scope = {
      accountId: 'a',
      mailboxId: 'inbox',
      days: 3,
      limit: 10,
      subject: '',
      sender: '',
      unreadOnly: false,
      bodyPreview: true,
    };
    expect(summaryContextDigest(item, interest, scope)).not.toBe(
      summaryContextDigest(item, interest, { ...scope, mailboxId: 'other' }),
    );
    expect(summaryContextDigest({ ...item, kind: 'papers' }, interest)).not.toBe(
      summaryContextDigest({ ...item, kind: 'papers' }, { ...interest, excluded: ['changed'] }),
    );
  });
  it('requires exact text, identity, sender, date, URL, read scope and private origin', () => {
    const digest = summarySourceDigest(item);
    expect(summarySourceDigest(structuredClone(item))).toBe(digest);
    // A structured copy of the already observed details flag must not invalidate old digests.
    expect(summarySourceDigest({ ...item, mailUnread: true })).toBe(digest);
    // A navigation-only Message-ID link must not force another LLM summary of unchanged content.
    expect(
      summarySourceDigest({ ...item, mailMessageUrl: 'message://%3Cmail%40example.test%3E' }),
    ).toBe(digest);
    for (const change of [
      { text: 'Tomorrow at 11.' },
      { text: `${item.text} ` },
      { title: 'meeting' },
      { id: 'mail:124' },
      { details: ['other@example.test', 'Inbox'] },
      { publishedAt: '2026-09-08T00:00:00Z' },
      { readScope: 'mail-metadata' as const },
      { sourceUrl: 'https://example.test' },
      { privateOrigin: 'mail' as const },
    ])
      expect(summarySourceDigest({ ...item, ...change })).not.toBe(digest);
  });
  it('checks paper version, excerpt, equations and captions, ignoring downloaded image bytes', () => {
    const paper: LiveItem = {
      ...item,
      kind: 'papers',
      readScope: 'abstract',
      sourceUrl: 'https://arxiv.org/abs/2609.00001v1',
      paper: {
        readScope: 'html-excerpt',
        excerpt: 'First result.',
        sourceUrl: 'https://arxiv.org/html/2609.00001v1',
        note: '',
        equations: [{ id: 'eq1', latex: 'a=b' }],
        figures: [
          { id: 'f1', caption: 'Result', assetUrl: 'https://arxiv.org/html/2609.00001v1/x.png' },
        ],
      },
    };
    const digest = summarySourceDigest(paper);
    expect(
      summarySourceDigest({ ...paper, sourceUrl: 'https://arxiv.org/abs/2609.00001v2' }),
    ).not.toBe(digest);
    expect(
      summarySourceDigest({ ...paper, paper: { ...paper.paper!, excerpt: 'Changed result.' } }),
    ).not.toBe(digest);
    expect(
      summarySourceDigest({
        ...paper,
        paper: { ...paper.paper!, equations: [{ id: 'eq1', latex: 'a=c' }] },
      }),
    ).not.toBe(digest);
    expect(
      summarySourceDigest({
        ...paper,
        paper: { ...paper.paper!, figures: [{ ...paper.paper!.figures[0]!, caption: 'Changed' }] },
      }),
    ).not.toBe(digest);
    expect(
      summarySourceDigest({
        ...paper,
        paper: {
          ...paper.paper!,
          figures: [{ ...paper.paper!.figures[0]!, imageData: 'data:image/webp;base64,abc' }],
        },
      }),
    ).toBe(digest);
  });
});
