import { describe, expect, it } from 'vitest';

import {
  SEARCH_CATEGORIES,
  SearchInputSchema,
  SearchResponseSchema,
} from '../src/shared/search-contracts';

describe('search contracts', () => {
  it('defaults to a bounded category limit without inventing a project scope', () => {
    expect(SearchInputSchema.parse({ query: '표 기반 모델', scope: { kind: 'global' } })).toEqual({
      query: '표 기반 모델',
      scope: { kind: 'global' },
      limitPerCategory: 20,
    });
  });

  it('rejects absolute local paths in navigation targets', () => {
    expect(() =>
      SearchResponseSchema.parse({
        schemaVersion: 1,
        query: 'paper',
        scope: { kind: 'global' },
        groups: [
          {
            category: 'research-notes',
            items: [
              {
                id: 'note:1',
                category: 'research-notes',
                projectId: '00000000-0000-4000-8000-000000000001',
                projectName: 'Research project',
                title: 'Paper note',
                snippet: 'paper',
                updatedAt: null,
                matchedFields: ['content'],
                target: { kind: 'research-note', path: '/Users/example/private.md' },
              },
            ],
            truncated: false,
            unavailableReason: null,
          },
        ],
        searchedAt: '2026-08-10T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('keeps the public category catalog stable and duplicate-free', () => {
    expect(new Set(SEARCH_CATEGORIES).size).toBe(SEARCH_CATEGORIES.length);
  });
});
