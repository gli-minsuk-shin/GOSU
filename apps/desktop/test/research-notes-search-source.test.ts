import { describe, expect, it } from 'vitest';

import { ResearchNotesSearchSource } from '../src/main/research-notes-search-source';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

describe('ResearchNotesSearchSource', () => {
  it('searches bounded Markdown content and returns only project-relative paths', async () => {
    const source = new ResearchNotesSearchSource({
      inspectReadyWorkspace: async () => ({
        schemaVersion: 1,
        projectId: PROJECT_ID,
        projectName: 'Research',
        bindingId: 'a'.repeat(64),
        vaultId: 'b'.repeat(64),
        vaultName: 'Vault',
        displayRoot: 'GOSU/Research',
        files: ['Papers/Baseline.md'],
        folders: [
          'Literature',
          'Papers',
          'Experiments',
          'Project Progress',
          'Idea Development',
          'Lecture Notes & Slides',
        ],
        status: 'ready',
        attentionCode: null,
        lastLiteratureSyncAt: null,
      }),
      readReadyMarkdown: async ({ path }) => ({
        path,
        content:
          '---\nmodified_at: "2026-08-10T00:00:00.000Z"\n---\n# Baseline\n\nTabular evaluation evidence.',
      }),
    });
    const result = await source.search({
      query: 'tabular evidence',
      projectIds: [PROJECT_ID],
      projectNames: new Map([[PROJECT_ID, 'Research']]),
      categories: ['research-notes'],
      limitPerCategory: 20,
    });
    expect(result.hits).toMatchObject([
      {
        updatedAt: '2026-08-10T00:00:00.000Z',
        target: { kind: 'research-note', path: 'Papers/Baseline.md' },
      },
    ]);
    expect(result.reports).toEqual([
      {
        category: 'research-notes',
        truncated: false,
        incomplete: false,
        unavailableReason: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('displayRoot');
  });

  it('round-robins projects so an early large project cannot starve a later match', async () => {
    const secondProjectId = '00000000-0000-4000-8000-000000000002';
    const firstFiles = Array.from({ length: 240 }, (_, index) => `Bulk/Note-${index}.md`);
    const source = new ResearchNotesSearchSource({
      inspectReadyWorkspace: async ({ projectId }) => ({
        schemaVersion: 1,
        projectId,
        projectName: projectId === PROJECT_ID ? 'Large' : 'Later',
        bindingId: (projectId === PROJECT_ID ? 'a' : 'c').repeat(64),
        vaultId: 'b'.repeat(64),
        vaultName: 'Vault',
        displayRoot: 'GOSU/Research',
        files: projectId === PROJECT_ID ? firstFiles : ['Papers/Exact.md'],
        folders: [],
        status: 'ready',
        attentionCode: null,
        lastLiteratureSyncAt: null,
      }),
      readReadyMarkdown: async ({ projectId, path }) => ({
        path,
        content: projectId === secondProjectId ? 'unique-later-match' : 'unrelated',
      }),
    });
    const result = await source.search({
      query: 'unique-later-match',
      projectIds: [PROJECT_ID, secondProjectId],
      projectNames: new Map([
        [PROJECT_ID, 'Large'],
        [secondProjectId, 'Later'],
      ]),
      categories: ['research-notes'],
      limitPerCategory: 20,
    });
    expect(result.hits).toMatchObject([
      { projectId: secondProjectId, target: { path: 'Papers/Exact.md' } },
    ]);
  });

  it('uses a bounded opaque id for a long project-relative path', async () => {
    const path = `${'nested/'.repeat(80)}Target.md`;
    const source = new ResearchNotesSearchSource({
      inspectReadyWorkspace: async () => ({
        schemaVersion: 1,
        projectId: PROJECT_ID,
        projectName: 'Research',
        bindingId: 'a'.repeat(64),
        vaultId: 'b'.repeat(64),
        vaultName: 'Vault',
        displayRoot: 'GOSU/Research',
        files: [path],
        folders: [],
        status: 'ready',
        attentionCode: null,
        lastLiteratureSyncAt: null,
      }),
      readReadyMarkdown: async () => ({ path, content: 'long-path-match' }),
    });
    const result = await source.search({
      query: 'long-path-match',
      projectIds: [PROJECT_ID],
      projectNames: new Map([[PROJECT_ID, 'Research']]),
      categories: ['research-notes'],
      limitPerCategory: 20,
    });
    expect(result.hits[0]?.id).toMatch(/^research-note:[0-9a-f]{64}$/u);
    expect(result.hits[0]?.target).toEqual({ kind: 'research-note', path });
  });

  it('reports a partial project failure without dropping healthy project matches', async () => {
    const secondProjectId = '00000000-0000-4000-8000-000000000002';
    const source = new ResearchNotesSearchSource({
      inspectReadyWorkspace: async ({ projectId }) => {
        if (projectId === PROJECT_ID) throw new Error('/private/path');
        return {
          schemaVersion: 1,
          projectId,
          projectName: 'Healthy',
          bindingId: 'a'.repeat(64),
          vaultId: 'b'.repeat(64),
          vaultName: 'Vault',
          displayRoot: 'GOSU/Healthy',
          files: ['Healthy.md'],
          folders: [],
          status: 'ready',
          attentionCode: null,
          lastLiteratureSyncAt: null,
        };
      },
      readReadyMarkdown: async ({ path }) => ({ path, content: 'healthy-match' }),
    });
    const result = await source.search({
      query: 'healthy-match',
      projectIds: [PROJECT_ID, secondProjectId],
      projectNames: new Map([
        [PROJECT_ID, 'Broken'],
        [secondProjectId, 'Healthy'],
      ]),
      categories: ['research-notes'],
      limitPerCategory: 20,
    });
    expect(result.hits).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({ incomplete: true });
    expect(JSON.stringify(result)).not.toContain('/private/path');
  });

  it('returns prior matches at the deadline and blocks a repeated scan while ignored I/O remains', async () => {
    const secondProjectId = '00000000-0000-4000-8000-000000000002';
    let releaseHungRead: ((value: { path: string; content: string }) => void) | undefined;
    let signalHungRead: (() => void) | undefined;
    const hungReadStarted = new Promise<void>((resolve) => {
      signalHungRead = resolve;
    });
    let readCalls = 0;
    const source = new ResearchNotesSearchSource({
      inspectReadyWorkspace: async ({ projectId }) => ({
        schemaVersion: 1,
        projectId,
        projectName: projectId === PROJECT_ID ? 'Healthy' : 'Hung',
        bindingId: (projectId === PROJECT_ID ? 'a' : 'c').repeat(64),
        vaultId: 'b'.repeat(64),
        vaultName: 'Vault',
        displayRoot: 'GOSU/Research',
        files: [projectId === PROJECT_ID ? 'Healthy.md' : 'Hung.md'],
        folders: [],
        status: 'ready',
        attentionCode: null,
        lastLiteratureSyncAt: null,
      }),
      readReadyMarkdown: async ({ path }) => {
        readCalls += 1;
        if (path === 'Healthy.md') return { path, content: 'deadline-match' };
        signalHungRead?.();
        return new Promise((resolve) => {
          releaseHungRead = resolve;
        });
      },
    });
    const controller = new AbortController();
    const input = {
      query: 'deadline-match',
      projectIds: [PROJECT_ID, secondProjectId],
      projectNames: new Map([
        [PROJECT_ID, 'Healthy'],
        [secondProjectId, 'Hung'],
      ]),
      categories: ['research-notes' as const],
      limitPerCategory: 20,
      signal: controller.signal,
      deadlineAt: Date.now() + 5_000,
    };

    const running = source.search(input);
    await hungReadStarted;
    controller.abort();
    const result = await running;
    const repeated = await source.search({
      query: input.query,
      projectIds: input.projectIds,
      projectNames: input.projectNames,
      categories: input.categories,
      limitPerCategory: input.limitPerCategory,
    });

    expect(result.hits).toMatchObject([{ title: 'Healthy' }]);
    expect(result.reports[0]).toMatchObject({
      truncated: true,
      incomplete: true,
      unavailableReason: expect.stringContaining('time limit'),
    });
    expect(repeated.hits).toEqual([]);
    expect(repeated.reports[0]?.unavailableReason).toContain('previous Research Notes search');
    expect(readCalls).toBe(2);
    releaseHungRead?.({ path: 'Hung.md', content: 'late private content' });
  });
});
