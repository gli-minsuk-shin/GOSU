import { describe, expect, it, vi } from 'vitest';
import { createGlobalAssistantProjects } from '../src/main/global-assistant-projects';
import { createGlobalAssistantWorkspace } from '../src/main/global-assistant-workspace';

vi.mock('electron', () => ({ app: {}, safeStorage: {} }));

const P = '11111111-1111-4111-8111-111111111111';
const M = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const I = '44444444-4444-4444-8444-444444444444';
const project = { id: P, name: 'Lambda' };
const signal = new AbortController().signal;

function services() {
  const notes = {
    descriptor: vi.fn((_projectId: string): { id: string; name: string } | null => ({
      id: 'binding-1',
      name: 'Research Notes',
    })),
    listForAgent: vi.fn(async () => ({
      notes: [{ noteId: 'a'.repeat(64), title: 'Plan' }],
      truncated: false,
    })),
    readForAgent: vi.fn(async () => ({
      noteId: 'a'.repeat(64),
      title: 'Plan',
      content: '# Plan',
      contentSha256: 'b'.repeat(64),
      offset: 0,
      nextOffset: null,
      totalCharacters: 6,
      truncated: false,
    })),
    saveMarkdownForAgent: vi.fn(async () => ({
      schemaVersion: 1 as const,
      projectId: P,
      category: 'experiments' as const,
      path: 'Experiments/ABCD--0123456789abcdef.md',
      created: true,
      contentSha256: 'c'.repeat(64),
      artifactId: '0123456789abcdef',
    })),
  };
  const record = (title: string, authors: string[]) => ({
    id: M,
    title,
    authors,
    publishedYear: 2024,
    containerTitle: 'ICML',
    doi: null,
    sourceUrl: 'https://arxiv.org/abs/2401.00001',
    reviewStatus: 'included',
    manualAnnotations: { topics: [], summary: 'x'.repeat(700), relevance: '' },
    aiAnnotations: null,
  });
  const literature = {
    list: vi.fn(async () => ({
      records: [record('Learned LASSO', ['Kim']), record('Axial attention', ['Lee'])],
      total: 2,
    })),
    addFromAssistant: vi.fn(async () => ({
      projectId: P,
      importedCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
    })),
  };
  const manuscripts = {
    list: vi.fn(async () => ({
      manuscripts: [
        {
          manuscript: { id: M, title: 'Paper draft' },
          connection: {
            binding: { enabled: true, bindingId: 'b1' },
            lastCheckpoint: { bindingId: 'b1', checkpointId: C },
            providerDisplayName: 'Overleaf',
            lastObservedAt: '2026-09-19T00:00:00Z',
          },
        },
      ],
    })),
    listCheckpointFiles: vi.fn(async () => ({
      manuscriptId: M,
      checkpointId: C,
      files: ['main.tex', 'sections/method.tex'],
    })),
    readCheckpointFile: vi.fn(async () => ({
      manuscriptId: M,
      checkpointId: C,
      relativePath: 'main.tex',
      offset: 0,
      nextOffset: 10,
      truncated: false,
      content: '\\section{A}',
    })),
  };
  const experiments = {
    list: vi.fn(async () => ({
      ideas: [
        {
          id: I,
          parentIdeaId: null,
          title: 'Axial off',
          hypothesis: 'h',
          phase: '',
          outcome: 'planned',
          resultSummary: '',
          updatedAt: '2026-09-19T00:00:00Z',
        },
      ],
      metricPoints: [],
      runs: [],
    })),
    createIdea: vi.fn(async (input: { title: string }) => ({
      id: I,
      title: input.title,
      outcome: 'planned',
    })),
    recordMetric: vi.fn(async (input: { ideaId: string; value: number }) => ({
      id: 'point-1',
      ideaId: input.ideaId,
      metricDisplayName: 'val loss',
      value: input.value,
      unit: '',
      recordedAt: '2026-09-19T00:00:00Z',
    })),
  };
  return { notes, literature, manuscripts, experiments };
}

function workspace(deps = services()) {
  return {
    deps,
    run: createGlobalAssistantWorkspace({
      ...(deps as unknown as Parameters<typeof createGlobalAssistantWorkspace>[0]),
      now: () => new Date('2026-09-19T12:00:00Z'),
    }),
  };
}

describe('global assistant research workspace', () => {
  it('lists and reads research notes only through the project binding', async () => {
    const { deps, run } = workspace();
    expect(await run('notes', project, JSON.stringify({ query: 'plan' }), signal)).toMatchObject({
      projectName: 'Lambda',
      notes: [{ title: 'Plan' }],
    });
    expect(deps.notes.listForAgent).toHaveBeenCalledWith(P, 'binding-1', 'plan', 50);
    expect(
      await run('notes', project, JSON.stringify({ noteId: 'a'.repeat(64) }), signal),
    ).toMatchObject({ content: '# Plan', trust: 'untrusted_note_content' });
    deps.notes.descriptor.mockReturnValueOnce(null);
    await expect(run('notes', project, '{}', signal)).rejects.toThrow(
      'assistant_research_notes_not_connected',
    );
    await expect(run('notes', project, JSON.stringify({ path: '/etc' }), signal)).rejects.toThrow(
      'assistant_workspace_input_invalid',
    );
  });

  it('creates a note after the permission recheck, labelled as the AI assistant', async () => {
    const { deps, run } = workspace();
    const recheck = vi.fn(async () => undefined);
    const receipt = await run(
      'note-save',
      project,
      JSON.stringify({
        category: 'experiments',
        title: 'ABCD',
        content: '# 결과',
        idempotencyKey: 'assistant:turn:1',
      }),
      signal,
      recheck,
    );
    expect(receipt).toMatchObject({ saved: true, created: true, category: 'experiments' });
    expect(recheck.mock.invocationCallOrder[0]).toBeLessThan(
      deps.notes.saveMarkdownForAgent.mock.invocationCallOrder[0]!,
    );
    expect(deps.notes.saveMarkdownForAgent).toHaveBeenCalledWith(P, 'binding-1', {
      category: 'experiments',
      title: 'ABCD',
      content: '# 결과',
      idempotencyKey: 'assistant:turn:1',
      origin: {
        createdAt: '2026-09-19T12:00:00.000Z',
        sessionId: null,
        sessionName: null,
        creatorId: 'gosu-ai-assistant',
        creatorName: 'GOSU AI 비서',
      },
    });
    // A lecture category or a revoked permission writes nothing.
    await expect(
      run(
        'note-save',
        project,
        JSON.stringify({ category: 'lectures', title: 'x', content: 'y', idempotencyKey: 'k' }),
        signal,
      ),
    ).rejects.toThrow('assistant_workspace_input_invalid');
    await expect(
      run(
        'note-save',
        project,
        JSON.stringify({ category: 'papers', title: 'x', content: 'y', idempotencyKey: 'k2' }),
        signal,
        async () => {
          throw new Error('assistant_settings_changed');
        },
      ),
    ).rejects.toThrow('assistant_settings_changed');
    expect(deps.notes.saveMarkdownForAgent).toHaveBeenCalledOnce();
  });

  it('reads and adds Literature, reads manuscripts, and reads and adds experiments', async () => {
    const { deps, run } = workspace();
    const library = (await run(
      'literature',
      project,
      JSON.stringify({ query: 'lasso' }),
      signal,
    )) as {
      matching: number;
      records: { title: string; manualSummary: string }[];
    };
    expect(library.matching).toBe(1);
    expect(library.records[0]!.title).toBe('Learned LASSO');
    expect(library.records[0]!.manualSummary).toHaveLength(601);
    const papers = [{ title: 'P' }];
    expect(await run('literature-add', project, JSON.stringify({ papers }), signal)).toMatchObject({
      added: true,
      importedCount: 1,
      projectName: 'Lambda',
    });
    expect(deps.literature.addFromAssistant).toHaveBeenCalledWith({ projectId: P, papers });

    expect(await run('manuscripts', project, '{}', signal)).toMatchObject({
      manuscripts: [{ manuscriptId: M, linked: true, checkpointId: C }],
    });
    expect(
      await run(
        'manuscripts',
        project,
        JSON.stringify({ manuscriptId: M, checkpointId: C }),
        signal,
      ),
    ).toMatchObject({ files: ['main.tex', 'sections/method.tex'], totalFileCount: 2 });
    expect(
      await run(
        'manuscripts',
        project,
        JSON.stringify({ manuscriptId: M, checkpointId: C, path: 'main.tex' }),
        signal,
      ),
    ).toMatchObject({ content: '\\section{A}', trust: 'untrusted_manuscript_content' });
    expect(deps.manuscripts.readCheckpointFile).toHaveBeenCalledWith({
      projectId: P,
      manuscriptId: M,
      checkpointId: C,
      relativePath: 'main.tex',
      maxCharacters: 24_000,
    });

    expect(await run('experiments', project, '{}', signal)).toMatchObject({
      ideas: [{ ideaId: I, title: 'Axial off' }],
      totals: { ideas: 1, metricPoints: 0, runs: 0 },
    });
    expect(
      await run('experiment-idea-add', project, JSON.stringify({ title: 'Axial on' }), signal),
    ).toMatchObject({ added: true, ideaId: I, title: 'Axial on' });
    expect(deps.experiments.createIdea).toHaveBeenCalledWith({ projectId: P, title: 'Axial on' });
    expect(
      await run(
        'experiment-metric-record',
        project,
        JSON.stringify({ ideaId: I, value: 0.42 }),
        signal,
      ),
    ).toMatchObject({ recorded: true, value: 0.42, metric: 'val loss' });
    await expect(
      run('experiment-metric-record', project, JSON.stringify({ ideaId: I, value: 'NaN' }), signal),
    ).rejects.toThrow('assistant_workspace_input_invalid');
  });
});

describe('project bridge delegation', () => {
  it('passes workspace actions for an active project only, with its name', async () => {
    const workspaceActions = vi.fn(async () => ({ ok: true }));
    const bridge = createGlobalAssistantProjects({
      projects: async () => [project, { id: M, name: 'Old', archivedAt: '2026-01-01' }],
      sessions: async () => [],
      read: async () => ({ messages: [] }),
      memory: () => null,
      remember: () => true,
      send: async () => ({}),
      confirm: async () => undefined,
      workspace: workspaceActions,
    });
    const recheck = vi.fn(async () => undefined);
    expect(await bridge('experiments', P, '{}', signal, recheck)).toEqual({ ok: true });
    expect(workspaceActions).toHaveBeenCalledWith('experiments', project, '{}', signal, recheck);
    await expect(bridge('experiments', M, '{}', signal)).rejects.toThrow(
      'assistant_project_unavailable',
    );
    const withoutWorkspace = createGlobalAssistantProjects({
      projects: async () => [project],
      sessions: async () => [],
      read: async () => ({ messages: [] }),
      memory: () => null,
      remember: () => true,
      send: async () => ({}),
      confirm: async () => undefined,
    });
    await expect(withoutWorkspace('notes', P, '{}', signal)).rejects.toThrow(
      'assistant_workspace_unavailable',
    );
  });
});
