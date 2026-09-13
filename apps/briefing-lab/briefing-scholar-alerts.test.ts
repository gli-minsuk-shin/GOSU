import { expect, it, vi } from 'vitest';
import { scholarCandidates } from './briefing-scholar-alerts';
import type { LiveItem } from './src/live-types';
const mail: LiveItem = {
  id: 'mail',
  kind: 'email',
  title: 'Google Scholar alert',
  source: 'Mail',
  readScope: 'mail-preview',
  details: ['Scholar Alerts <scholaralerts-noreply@google.com>'],
  text: '',
  publishedAt: '2026-09-10T00:00:00Z',
};
it('extracts separate paper titles and snippets from a Scholar digest without following redirects or leaking tracking tokens', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  try {
    const text =
      'First research paper\nhttps://scholar.google.com/scholar_url?url=https%3A%2F%2Farxiv.org%2Fabs%2F2609.12345v2&scisig=TRACKER_SECRET\nFirst authors - Journal 2026\nFirst result only.\n\nSecond research paper\nhttps://doi.org/10.1234/SECOND\nSecond result only.\n\nUnsubscribe\nhttps://scholar.google.com/alerts?email=private';
    const candidates = scholarCandidates([{ ...mail, text }]);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      id: '2609.12345',
      title: 'First research paper',
      sourceUrl: 'https://arxiv.org/abs/2609.12345v2',
      privateOrigin: 'mail',
      discoverySource: 'google-scholar-alert',
    });
    expect(candidates[0]?.text).toContain('First result only');
    expect(candidates[0]?.text).not.toContain('Second result');
    expect(candidates[1]?.sourceUrl).toBe('https://doi.org/10.1234/second');
    expect(JSON.stringify(candidates)).not.toContain('TRACKER_SECRET');
    expect(JSON.stringify(candidates)).not.toContain('email=private');
    expect(candidates[0]).not.toHaveProperty('publishedAt');
    expect(
      scholarCandidates([
        { ...mail, id: 'other-alert', text, publishedAt: '2026-09-11T00:00:00Z' },
      ]),
    ).toEqual(candidates);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
it('handles HTML anchor titles, duplicate arXiv links and DOI-backed publisher items as bounded private candidates', () => {
  const text =
    '<h3><a href="https://scholar.google.com/scholar_url?url=https%3A%2F%2Farxiv.org%2Fabs%2F2609.11111v1&amp;scisig=secret">An actual paper title</a></h3><p>Paper excerpt here.</p><a href="https://arxiv.org/pdf/2609.11111v1.pdf">PDF</a>';
  const result = scholarCandidates([{ ...mail, text }]);
  expect(result).toHaveLength(1);
  expect(result[0]?.title).toBe('An actual paper title');
  expect(result[0]?.text).toContain('Paper excerpt here');
  expect(result[0]?.privateOrigin).toBe('mail');
});
it('does not treat a whole unresolved alert, ordinary mail or metadata-only read as a research paper', () => {
  expect(scholarCandidates([{ ...mail, text: 'Nothing resolvable here' }])).toEqual([]);
  expect(
    scholarCandidates([
      { ...mail, readScope: 'mail-metadata', text: 'https://arxiv.org/abs/2609.11111' },
    ]),
  ).toEqual([]);
  expect(
    scholarCandidates([
      {
        ...mail,
        title: 'Ordinary message',
        details: ['person@example.test'],
        text: 'https://arxiv.org/abs/2609.11111',
      },
    ]),
  ).toEqual([]);
  expect(
    scholarCandidates([
      {
        ...mail,
        text: 'https://scholar.google.com/scholar_url?url=https%3A%2F%2Fuser%3Asecret%40127.0.0.1%2Ftest\nhttps://scholar.google.com/alerts?unsubscribe=secret',
      },
    ]),
  ).toEqual([]);
});
it('keeps adjacent plaintext entries separate even without blank lines', () => {
  const result = scholarCandidates([
    {
      ...mail,
      text: 'First paper title\nAuthors - Journal 2026\nhttps://arxiv.org/abs/2609.10001v1\nFirst abstract.\nSecond paper title\nAuthors - Journal 2026\nhttps://arxiv.org/abs/2609.10002v1\nSecond abstract.',
    },
  ]);
  expect(result.map((i) => i.title)).toEqual(['First paper title', 'Second paper title']);
  expect(result[0]?.text).not.toContain('Second');
  expect(result[1]?.text).not.toContain('First');
});
it('extracts visible citation entries when Apple Mail rich text omits hyperlink URLs, without inventing a URL', () => {
  const result = scholarCandidates([
    {
      ...mail,
      text: 'First paper title\nA Author, B Author - Statistics Journal, 2026\nFirst abstract.\n\nSecond paper title\nC Author - Research Journal, 2026\nSecond abstract.',
    },
  ]);
  expect(result.map((i) => i.title)).toEqual(['First paper title', 'Second paper title']);
  expect(result[0]?.text).not.toContain('Second');
  expect(result.every((i) => !i.sourceUrl && i.privateOrigin === 'mail')).toBe(true);
});
