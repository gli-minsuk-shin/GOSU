import { describe, expect, it, vi } from 'vitest';

import {
  importPaperSummariesToLiterature,
  paperLibraryEntries,
} from '../src/main/paper-library-literature';
import type { PaperSummaryRecord } from '../../briefing-lab/src/paper-summary-contract';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const id = (seed: string) => seed.repeat(64).slice(0, 64);

function saved(overrides: Partial<PaperSummaryRecord> & { id: string }): PaperSummaryRecord {
  return {
    title: 'TabPFN: A Transformer That Solves Small Tabular Classification Problems',
    question: '논문 요약: TabPFN',
    markdown: '## 연구 질문\n…',
    sourceUrls: ['https://arxiv.org/abs/2207.01848'],
    savedAt: '2026-09-20T00:00:00.000Z',
    origin: 'GOSU',
    paper: {
      sourceId: 'arxiv:2207.01848',
      readScope: 'full-text',
      publishedAt: '2022-07-05T00:00:00.000Z',
      bibliography: { authors: ['Noah Hollmann', 'Frank Hutter'], venue: 'ICLR', source: 'arXiv' },
      summarizedAt: '2026-09-20T00:00:00.000Z',
      sourceDigest: 'a'.repeat(64),
      contextDigest: 'b'.repeat(64),
      insight: {
        id: 'arxiv:2207.01848',
        summary: 'A prior-fitted transformer that classifies small tables in one forward pass.',
        keywords: ['TabPFN', 'in-context learning'],
        tags: ['tabular'],
        importance: 'high',
        importanceReason: 'Foundation of the project.',
        relevance: 'Directly relevant.',
        action: 'Read.',
        evidenceQuote: 'We present TabPFN.',
        equationIds: [],
        figureIds: [],
        memorySuggestion: null,
      },
      equations: [],
      figures: [],
    },
    ...overrides,
  } as PaperSummaryRecord;
}

describe('paper summary library for the Literature view', () => {
  it('lists verified papers with their bibliography and counts the analyses it cannot import', () => {
    const list = paperLibraryEntries([
      saved({ id: id('a') }),
      saved({ id: id('b'), paper: undefined, sourceUrls: ['https://example.org/chat'] }),
      saved({
        id: id('c'),
        title: 'DOI paper',
        sourceUrls: ['https://doi.org/10.1093/biostatistics/kxm045'],
        paper: {
          ...saved({ id: id('c') }).paper!,
          publishedAt: undefined,
          bibliography: undefined,
        },
      }),
    ]);

    expect(list.unverifiedCount).toBe(1);
    expect(list.entries).toEqual([
      {
        id: id('a'),
        title: 'TabPFN: A Transformer That Solves Small Tabular Classification Problems',
        authors: ['Noah Hollmann', 'Frank Hutter'],
        venue: 'ICLR',
        year: 2022,
        sourceUrl: 'https://arxiv.org/abs/2207.01848',
        savedAt: '2026-09-20T00:00:00.000Z',
        summary: 'A prior-fitted transformer that classifies small tables in one forward pass.',
        keywords: ['TabPFN', 'in-context learning'],
        tags: ['tabular'],
      },
      {
        id: id('c'),
        title: 'DOI paper',
        authors: [],
        venue: null,
        year: null,
        sourceUrl: 'https://doi.org/10.1093/biostatistics/kxm045',
        savedAt: '2026-09-20T00:00:00.000Z',
        summary: 'A prior-fitted transformer that classifies small tables in one forward pass.',
        keywords: ['TabPFN', 'in-context learning'],
        tags: ['tabular'],
      },
    ]);
  });

  it('imports only the chosen papers and reports the ones that are no longer in the library', async () => {
    const addLibraryPapers = vi.fn(async () => ({
      projectId: PROJECT_ID,
      importedCount: 1,
      alreadySavedCount: 0,
    }));
    const receipt = await importPaperSummariesToLiterature(
      {
        library: { list: async () => [saved({ id: id('a') }), saved({ id: id('d') })] },
        literature: { addLibraryPapers },
      },
      { projectId: PROJECT_ID, paperIds: [id('a'), id('f')] },
    );

    expect(addLibraryPapers).toHaveBeenCalledExactlyOnceWith({
      projectId: PROJECT_ID,
      papers: [expect.objectContaining({ id: id('a'), year: 2022 })],
    });
    expect(receipt).toEqual({
      projectId: PROJECT_ID,
      importedCount: 1,
      alreadySavedCount: 0,
      missingCount: 1,
    });
  });

  it('does not touch the Literature table when none of the chosen papers can be read', async () => {
    const addLibraryPapers = vi.fn();
    const receipt = await importPaperSummariesToLiterature(
      { library: { list: async () => [] }, literature: { addLibraryPapers } },
      { projectId: PROJECT_ID, paperIds: [id('a')] },
    );

    expect(addLibraryPapers).not.toHaveBeenCalled();
    expect(receipt).toEqual({
      projectId: PROJECT_ID,
      importedCount: 0,
      alreadySavedCount: 0,
      missingCount: 1,
    });
  });
});
