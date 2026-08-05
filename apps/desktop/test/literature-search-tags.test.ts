import { describe, expect, it } from 'vitest';

import {
  literatureSearchTagKey,
  mergeLiteratureSearchTags,
  parseLiteratureSearchTagText,
  resolveLiteratureSearchTags,
} from '../src/shared/literature-search-tags';

describe('literature search tags', () => {
  it('uses the normalized query as a topic when no explicit tags are provided', () => {
    expect(resolveLiteratureSearchTags('  Tabular   foundation models  ')).toEqual({
      topics: ['Tabular foundation models'],
      keywords: [],
    });
  });

  it('normalizes and de-duplicates labels without losing their first display spelling', () => {
    expect(
      resolveLiteratureSearchTags('unused', {
        topics: ['#ＲＡＧ', 'rag', ' Retrieval   augmented generation '],
        keywords: ['LLM', 'ｌｌｍ', '#agents'],
      }),
    ).toEqual({
      topics: ['RAG', 'Retrieval augmented generation'],
      keywords: ['LLM', 'agents'],
    });
  });

  it('accumulates repeated searches case-insensitively while keeping topic and keyword kinds distinct', () => {
    expect(
      mergeLiteratureSearchTags(
        { topics: ['Tabular foundation models'], keywords: ['TabPFN'] },
        {
          topics: ['tabular foundation models', 'In-context learning'],
          keywords: ['tabpfn', 'RAG'],
        },
      ),
    ).toEqual({
      topics: ['Tabular foundation models', 'In-context learning'],
      keywords: ['TabPFN', 'RAG'],
    });
    expect(literatureSearchTagKey('topics', 'RAG')).not.toBe(
      literatureSearchTagKey('keywords', 'RAG'),
    );
  });

  it('parses comma, semicolon, and newline separated editor input', () => {
    expect(
      parseLiteratureSearchTagText(
        `tabular; in-context learning\nbenchmarks,  TabPFN, TABULAR, ${'x'.repeat(121)}`,
      ),
    ).toEqual(['tabular', 'in-context learning', 'benchmarks', 'TabPFN']);
  });
});
