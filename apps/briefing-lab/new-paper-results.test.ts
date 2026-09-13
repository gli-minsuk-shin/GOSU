import { expect, it } from 'vitest';
import type { BriefingHistory } from './briefing-workspace-store';
import type { LiveSourceResult } from './src/live-types';
import { newPaperResults, summarizedPaperKeys } from './new-paper-results';
import { deduplicateHistoryPapers } from './src/deduplicate-history-papers';
import { auditPaperCandidates } from './paper-discovery-audit';
import { createPaperSearcher, parseArxiv } from './live-public-sources';
const paper = {
  id: '2609.12345',
  kind: 'papers' as const,
  title: 'Paper',
  summary: 'Saved',
  text: 'Abstract',
  source: 'arXiv',
  sourceUrl: 'https://arxiv.org/abs/2609.12345v1',
  readScope: 'abstract' as const,
  details: [],
  importance: 'high',
  relevance: '',
};
const history: BriefingHistory[] = [
  {
    id: 'old',
    routineId: 'r',
    createdAt: '2026-09-01T00:00:00Z',
    kind: 'briefing',
    answer: '',
    private: false,
    items: [paper],
  },
];
const result: LiveSourceResult = {
  kind: 'papers',
  status: 'ready',
  items: [paper],
  fetchedAt: '2026-09-11T00:00:00Z',
  note: 'Source range',
};
it('reproduces zero after early shortlist limiting even though the same arXiv response contains an unsummarized candidate', async () => {
  const now = '2026-09-12T00:00:00Z';
  const profile = {
    keywords: [{ term: 'neural networks', weight: 5, synonyms: [] }],
    excluded: [],
  };
  const options = { enabled: true, days: 30, limit: 10, author: '' };
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">${Array.from({ length: 11 }, (_, i) => `<entry><id>http://arxiv.org/abs/2609.${String(i + 1).padStart(5, '0')}v1</id><title>neural networks ${i}</title><summary>neural networks evidence</summary><published>2026-09-11T00:00:00Z</published><updated>2026-09-11T00:00:00Z</updated><author><name>Fixture</name></author></entry>`).join('')}</feed>`;
  let requests = 0;
  const search = createPaperSearcher(async (url) => {
    requests++;
    expect(url.searchParams.get('max_results')).toBe('30');
    return xml;
  });
  const shortlist = await search(profile, options, new AbortController().signal, now);
  const candidates = parseArxiv(xml, profile, { ...options, limit: 30 }, now);
  const saved = [
    { ...history[0]!, items: shortlist.map((i) => ({ ...paper, ...i, summary: 'Saved summary' })) },
  ];
  expect(auditPaperCandidates({ ...result, items: shortlist }, candidates, saved)).toMatchObject({
    status: 'shortlist_hides_new',
    returnedCount: 10,
    candidateCount: 11,
    newInShortlist: 0,
    newInCandidateWindow: 1,
    hiddenNewCount: 1,
    noNewConfirmedInWindow: false,
  });
  expect(requests).toBe(1);
  const corrected = await search(
    profile,
    options,
    new AbortController().signal,
    now,
    summarizedPaperKeys(saved),
  );
  expect(corrected).toHaveLength(1);
  expect(corrected[0]?.id).toBe('2609.00011');
  const cold = createPaperSearcher(async (url) => {
    expect(url.searchParams.get('max_results')).toBe('30');
    return xml;
  });
  expect(
    (
      await cold(profile, options, new AbortController().signal, now, summarizedPaperKeys(saved))
    ).map((i) => i.id),
  ).toEqual(['2609.00011']);
  expect(auditPaperCandidates({ ...result, items: corrected }, candidates, saved)).toMatchObject({
    status: 'checked_window',
    newInShortlist: 1,
  });
  const allSaved = [
    {
      ...saved[0]!,
      items: [
        ...saved[0]!.items,
        ...corrected.map((i) => ({ ...paper, ...i, summary: 'Saved next' })),
      ],
    },
  ];
  expect(
    await search(
      profile,
      options,
      new AbortController().signal,
      now,
      summarizedPaperKeys(allSaved),
    ),
  ).toEqual([]);
  expect(requests).toBe(1); // Re-filter raw cache locally, without extending the request window.
});
it('only confirms zero inside the checked candidate window when all candidates really have saved summaries', () => {
  expect(auditPaperCandidates(result, result.items, history)).toMatchObject({
    status: 'checked_window',
    newInCandidateWindow: 0,
    noNewConfirmedInWindow: true,
  });
  expect(auditPaperCandidates({ ...result, items: [] }, [], [])).toMatchObject({
    noNewConfirmedInWindow: true,
  });
});
it.each([undefined, 'source_rate_limited'])(
  'does not certify a failed response as genuine zero, including a missing error string (%s)',
  (error) => {
    const failed = { ...result, status: 'failed' as const, items: [], ...(error ? { error } : {}) };
    expect(newPaperResults([failed], history)[0]?.notice).toContain('조회 실패');
    expect(
      auditPaperCandidates(
        { ...result, status: 'failed', items: [], ...(error ? { error } : {}) },
        [],
        history,
      ),
    ).toMatchObject({ status: 'unverified', noNewConfirmedInWindow: false });
  },
);
it('retains new versions, same-title different identities and previously unsummarized records in diagnostic counts', () => {
  const items = [
    { ...paper, sourceUrl: 'https://arxiv.org/abs/2609.12345v2' },
    { ...paper, id: 'other', sourceUrl: 'https://doi.org/10.1234/other' },
    { ...paper, id: 'unfinished', sourceUrl: 'https://arxiv.org/abs/2609.54321v1' },
  ];
  const saved = [{ ...history[0]!, items: [...history[0]!.items, { ...items[2]!, summary: '' }] }];
  expect(auditPaperCandidates({ ...result, items }, items, saved)).toMatchObject({
    newInShortlist: 3,
    newInCandidateWindow: 3,
    hiddenNewCount: 0,
    noNewConfirmedInWindow: false,
  });
});
it('omits older summarized papers across days without deleting stored papers or touching email', () => {
  const email = {
    ...result,
    kind: 'email' as const,
    items: [{ ...paper, kind: 'email' as const }],
  };
  const filtered = newPaperResults([result, email], history);
  expect(filtered[0]?.items).toEqual([]);
  expect(filtered[0]?.status).toBe('empty');
  expect(filtered[0]?.note).toContain('새 논문이 없습니다');
  expect(filtered[1]).toBe(email);
  expect(history[0]?.items).toHaveLength(1);
  expect(result.items).toHaveLength(1);
});
it('keeps new versions and never identifies duplicates by title alone', () => {
  const items = [
    { ...paper, sourceUrl: 'https://arxiv.org/abs/2609.12345v2' },
    { ...paper, id: 'new', sourceUrl: 'https://doi.org/10.1234/new' },
  ];
  expect(newPaperResults([{ ...result, items }], history)[0]?.items).toEqual(items);
});
it('does not present failed source discovery as no new papers', () => {
  const filtered = newPaperResults(
    [{ ...result, status: 'failed', items: [], error: 'limited' }],
    history,
  )[0]!;
  expect(filtered.status).toBe('failed');
  expect(filtered.error).toBe('limited');
  expect(filtered.note).not.toContain('새 논문이 없습니다');
});
it('screens the same version from two discovery routes inside a new collection and displayed run', () => {
  const duplicate = {
    ...paper,
    id: 'scholar',
    sourceUrl: 'https://arxiv.org/pdf/2609.12345v1.pdf',
  };
  const next = { ...paper, id: 'next', sourceUrl: 'https://arxiv.org/abs/2609.12345v2' };
  const unknown = { ...paper, id: 'unknown', sourceUrl: 'https://arxiv.org/abs/2609.12345' };
  const items = [paper, duplicate, next, unknown];
  expect(newPaperResults([{ ...result, items }], [])[0]!.items).toEqual([paper, next, unknown]);
  expect(deduplicateHistoryPapers(items)).toEqual([paper, next, unknown]);
  expect(items).toHaveLength(4);
});
