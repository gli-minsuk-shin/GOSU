import { describe, expect, it, vi } from 'vitest';

import {
  RepositorySearchSource,
  type RepositorySearchReader,
} from '../src/main/repository-search-source';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_PROJECT_ID = '00000000-0000-4000-8000-000000000002';

describe('RepositorySearchSource', () => {
  it('uses the bounded filename index and creates opaque IDs even for long paths', async () => {
    const longPath = `src/${'long/'.repeat(190)}foundation-model.ts`;
    const searchFiles = vi.fn(async () => ({
      entries: [
        { path: longPath, kind: 'file' as const },
        { path: 'assets/foundation-link', kind: 'symlink' as const },
      ],
      scannedEntries: 2,
      truncated: false,
      incomplete: false,
    }));
    const source = new RepositorySearchSource({ searchFiles });

    const result = await source.search({
      query: 'foundation',
      projectIds: [PROJECT_ID],
      projectNames: new Map([[PROJECT_ID, 'Research']]),
      categories: ['repository'],
      limitPerCategory: 20,
    });

    expect(searchFiles).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      query: 'foundation',
      limit: 20,
    });
    expect(result.hits).toMatchObject([{ target: { kind: 'repository-file', path: longPath } }]);
    expect(result.hits[0]?.id).toMatch(/^repository:[0-9a-f]{64}$/u);
    expect(result.hits[0]?.id).not.toContain(longPath);
    expect(result.reports).toEqual([
      {
        category: 'repository',
        truncated: false,
        incomplete: false,
        unavailableReason: null,
      },
    ]);
  });

  it('keeps successful project hits and reports a bounded partial failure', async () => {
    const source = new RepositorySearchSource({
      searchFiles: async ({ projectId }) => {
        if (projectId === SECOND_PROJECT_ID) throw new Error('private filesystem details');
        return {
          entries: [{ path: 'src/foundation.ts', kind: 'file' }],
          scannedEntries: 1,
          truncated: true,
          incomplete: true,
        };
      },
    });

    const result = await source.search({
      query: 'foundation',
      projectIds: [PROJECT_ID, SECOND_PROJECT_ID],
      projectNames: new Map([
        [PROJECT_ID, 'Research'],
        [SECOND_PROJECT_ID, 'Archived Research'],
      ]),
      categories: ['repository'],
      limitPerCategory: 20,
    });

    expect(result.hits).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({
      truncated: true,
      incomplete: true,
      unavailableReason: expect.stringContaining('Some local repositories'),
    });
    expect(result.reports[0]?.unavailableReason).not.toContain('private filesystem details');
  });

  it('distinguishes an all-project failure without exposing an exception', async () => {
    const source = new RepositorySearchSource({
      searchFiles: async () => {
        throw new Error('/private/worktree');
      },
    });

    const result = await source.search({
      query: 'foundation',
      projectIds: [PROJECT_ID],
      projectNames: new Map([[PROJECT_ID, 'Research']]),
      categories: ['repository'],
      limitPerCategory: 20,
    });

    expect(result.hits).toEqual([]);
    expect(result.reports[0]).toMatchObject({
      truncated: false,
      incomplete: true,
      unavailableReason: expect.stringContaining('Local repositories could not be searched'),
    });
    expect(result.reports[0]?.unavailableReason).not.toContain('/private/worktree');
  });

  it('keeps earlier repository hits when a later project exceeds the deadline', async () => {
    let releaseHungSearch:
      ((value: Awaited<ReturnType<RepositorySearchReader['searchFiles']>>) => void) | undefined;
    let signalHungSearch: (() => void) | undefined;
    const hungSearchStarted = new Promise<void>((resolve) => {
      signalHungSearch = resolve;
    });
    let calls = 0;
    const source = new RepositorySearchSource({
      searchFiles: async ({ projectId }) => {
        calls += 1;
        if (projectId === PROJECT_ID) {
          return {
            entries: [{ path: 'src/foundation.ts', kind: 'file' }],
            scannedEntries: 1,
            truncated: false,
            incomplete: false,
          };
        }
        signalHungSearch?.();
        return new Promise((resolve) => {
          releaseHungSearch = resolve;
        });
      },
    });
    const controller = new AbortController();
    const input = {
      query: 'foundation',
      projectIds: [PROJECT_ID, SECOND_PROJECT_ID],
      projectNames: new Map([
        [PROJECT_ID, 'Healthy'],
        [SECOND_PROJECT_ID, 'Hung'],
      ]),
      categories: ['repository' as const],
      limitPerCategory: 20,
      signal: controller.signal,
      deadlineAt: Date.now() + 5_000,
    };

    const running = source.search(input);
    await hungSearchStarted;
    controller.abort();
    const result = await running;
    const repeated = await source.search({
      query: input.query,
      projectIds: input.projectIds,
      projectNames: input.projectNames,
      categories: input.categories,
      limitPerCategory: input.limitPerCategory,
    });

    expect(result.hits).toMatchObject([{ projectId: PROJECT_ID }]);
    expect(result.reports[0]).toMatchObject({
      truncated: true,
      incomplete: true,
      unavailableReason: expect.stringContaining('time limit'),
    });
    expect(repeated.hits).toEqual([]);
    expect(repeated.reports[0]?.unavailableReason).toContain('previous repository search');
    expect(calls).toBe(2);
    releaseHungSearch?.({
      entries: [],
      scannedEntries: 0,
      truncated: false,
      incomplete: false,
    });
  });
});
