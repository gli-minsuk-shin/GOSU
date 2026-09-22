import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiteratureView, type LiteratureViewAdapter } from '../src/renderer/src/literature-view';
import type {
  LiteratureLibrary,
  LiteratureRecord,
  LiteratureSearchReceipt,
} from '../src/shared/literature-contracts';
import type { ProjectRecord } from '../src/shared/workspace-contracts';

const project: ProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Class expansion',
  slug: 'class-expansion',
  version: 1,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};
const RUN_A = '33333333-3333-4333-8333-333333333333';
const RUN_B = '44444444-4444-4444-8444-444444444444';
const COMPLETED_A = '2026-08-05T00:00:01.000Z';
const COMPLETED_B = '2026-08-05T00:00:09.000Z';

function record(id: string, overrides: Partial<LiteratureRecord>): LiteratureRecord {
  return {
    schemaVersion: 1,
    id,
    projectId: project.id,
    provider: 'semantic-scholar',
    providerRecordId: id,
    doi: null,
    fingerprint: 'a'.repeat(64),
    title: `Paper ${id}`,
    authors: ['Ada Researcher'],
    containerTitle: null,
    publishedYear: 2025,
    abstractText: 'An abstract about tabular foundation models.',
    sourceTopics: [],
    workType: null,
    citationCount: 1,
    sourceUrl: null,
    citationKey: '',
    reviewStatus: 'unreviewed',
    manualAnnotations: { topics: [], summary: '', relevance: '' },
    aiAnnotations: null,
    discovery: null,
    annotationVersion: 0,
    version: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function discovery(searchRunId: string, classifiedAt: string) {
  return {
    tier: 'broad' as const,
    matchedLayers: ['broad' as const],
    tierRank: 1,
    overallScore: 0.5,
    relevanceScore: 0.5,
    authorityScore: 0,
    momentumScore: 0,
    citationVelocityProxy: null,
    influentialCitationCount: null,
    maxAuthorHIndex: null,
    reasons: ['broad-recall' as const],
    signalSources: ['semantic-scholar' as const],
    searchRunId,
    query: 'fixture',
    policyId: 'balanced-three-layer' as const,
    policyVersion: 4,
    classifiedAt,
  };
}

function receipt(id: string, query: string, completedAt: string): LiteratureSearchReceipt {
  return {
    run: {
      schemaVersion: 1,
      id,
      projectId: project.id,
      provider: 'balanced',
      query,
      fromYear: null,
      toYear: null,
      requestedLimit: 50,
      status: 'complete',
      foundCount: 1,
      newCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      conflictCount: 0,
      conflicts: [],
      createdAt: '2026-08-05T00:00:00.000Z',
      completedAt,
    },
    foundCount: 1,
    newCount: 1,
    updatedCount: 0,
    unchangedCount: 0,
    conflictCount: 0,
    retrievedCount: 40,
    selectedCount: 1,
    tierCounts: { core: 0, rising: 0, broad: 1 },
  };
}

const oldPaper = record('old-paper', {});
const newA = record('new-a', { createdAt: COMPLETED_A, discovery: discovery(RUN_A, COMPLETED_A) });
const newB = record('new-b', { createdAt: COMPLETED_B, discovery: discovery(RUN_B, COMPLETED_B) });

function library(records: readonly LiteratureRecord[]): LiteratureLibrary {
  return {
    schemaVersion: 1,
    projectId: project.id,
    records: [...records],
    total: records.length,
    recentSearches: [],
  };
}

function text(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(text).join('');
}

async function mount(adapter: LiteratureViewAdapter) {
  let ui!: ReturnType<typeof create>;
  await act(async () => {
    ui = create(
      <LiteratureView
        project={project}
        adapter={adapter}
        aiAvailable
        requestedModelId="fixture-model"
        reasoningOptionId="low"
      />,
    );
  });
  const type = async (value: string) => {
    const input = ui.root.findByProps({
      placeholder: 'e.g. retrieval augmented generation evaluation',
    });
    await act(async () => {
      (input.props as { onChange: (event: unknown) => void }).onChange({ target: { value } });
    });
  };
  const submit = async () => {
    await act(async () => {
      (ui.root.findByType('form').props as { onSubmit: (event: unknown) => void }).onSubmit({
        preventDefault: () => undefined,
      });
    });
  };
  const notice = () => ui.root.findAllByProps({ className: 'notice' }).map(text).join(' ');
  return { ui, type, submit, notice };
}

describe('Literature search flow in the view', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', {
      localStorage: undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rewrites a Korean request into keyword searches, reads only the new abstracts, and can undo', async () => {
    const list = vi
      .fn<LiteratureViewAdapter['list']>()
      .mockResolvedValueOnce(library([oldPaper]))
      .mockResolvedValueOnce(library([oldPaper, newA, newB]))
      .mockResolvedValue(library([oldPaper, newA, newB]));
    const search = vi
      .fn<LiteratureViewAdapter['search']>()
      .mockResolvedValueOnce(receipt(RUN_A, 'TabPFN class expansion', COMPLETED_A))
      .mockResolvedValueOnce(receipt(RUN_B, 'graphical lasso covariance', COMPLETED_B));
    const planSearch = vi.fn<NonNullable<LiteratureViewAdapter['planSearch']>>().mockResolvedValue({
      projectId: project.id,
      queries: [
        { query: 'TabPFN class expansion', topics: ['tabular models'], keywords: ['TabPFN'] },
        { query: 'graphical lasso covariance', topics: [], keywords: ['graphical lasso'] },
      ],
      invocation: {
        schemaVersion: 1,
        invocationId: '55555555-5555-4555-8555-555555555555',
        providerId: 'codex',
        requestedModelId: 'fixture-model',
        resolvedModelId: 'fixture-model',
        catalogVersion: 'fixture',
        reasoningOptionId: 'low',
        startedAt: '2026-08-05T00:00:00.000Z',
      },
      completedAt: '2026-08-05T00:00:00.500Z',
    });
    const organize = vi.fn<NonNullable<LiteratureViewAdapter['organize']>>().mockResolvedValue({
      projectId: project.id,
      requestedCount: 2,
      updatedCount: 2,
      skippedCount: 0,
      invocation: {
        schemaVersion: 1,
        invocationId: '66666666-6666-4666-8666-666666666666',
        providerId: 'codex',
        requestedModelId: 'fixture-model',
        resolvedModelId: 'fixture-model',
        catalogVersion: 'fixture',
        reasoningOptionId: 'low',
        startedAt: '2026-08-05T00:00:10.000Z',
      },
      inputSha256: 'f'.repeat(64),
      completedAt: '2026-08-05T00:00:20.000Z',
    });
    const undoSearch = vi
      .fn<NonNullable<LiteratureViewAdapter['undoSearch']>>()
      .mockResolvedValue({ projectId: project.id, removedCount: 2, keptCount: 0 });
    const view = await mount({
      list,
      search,
      planSearch,
      organize,
      undoSearch,
      updateAnnotations: vi.fn(),
      deleteRecord: vi.fn(),
      importRecords: vi.fn(),
      exportRecords: vi.fn(),
      cancelOrganize: vi.fn(),
    });

    await view.type('TabPFN 클래스 확장과 Graphical Lasso 관련 논문 찾아줘');
    await view.submit();

    expect(planSearch).toHaveBeenCalledWith({
      projectId: project.id,
      question: 'TabPFN 클래스 확장과 Graphical Lasso 관련 논문 찾아줘',
      requestedModelId: 'fixture-model',
      reasoningOptionId: 'low',
    });
    expect(search.mock.calls.map(([input]) => input.query)).toEqual([
      'TabPFN class expansion',
      'graphical lasso covariance',
    ]);
    expect(search.mock.calls[0]?.[0].searchTags).toEqual({
      topics: ['tabular models'],
      keywords: ['TabPFN'],
    });
    expect(organize).toHaveBeenCalledTimes(1);
    expect(organize.mock.calls[0]?.[0].recordIds).toEqual(['new-a', 'new-b']);
    expect(view.notice()).toContain(
      'Searched as: “TabPFN class expansion”, “graphical lasso covariance”.',
    );
    expect(view.notice()).toContain('AI read 2 new abstracts');

    const undo = view.ui.root
      .findAllByType('button')
      .find((button) => text(button) === 'Undo 2 added');
    expect(undo).toBeDefined();
    await act(async () => {
      (undo!.props as { onClick: () => void }).onClick();
    });

    expect(undoSearch).toHaveBeenCalledWith({ projectId: project.id, runIds: [RUN_A, RUN_B] });
    expect(view.notice()).toContain('Removed 2 papers this search added.');
  });

  it('sends plain keywords straight to the provider without an AI call', async () => {
    const search = vi
      .fn<LiteratureViewAdapter['search']>()
      .mockResolvedValue(receipt(RUN_A, 'graphical lasso', COMPLETED_A));
    const planSearch = vi.fn<NonNullable<LiteratureViewAdapter['planSearch']>>();
    const view = await mount({
      list: vi.fn<LiteratureViewAdapter['list']>().mockResolvedValue(library([])),
      search,
      planSearch,
      updateAnnotations: vi.fn(),
      deleteRecord: vi.fn(),
      importRecords: vi.fn(),
      exportRecords: vi.fn(),
    });

    await view.type('graphical lasso');
    await view.submit();

    expect(planSearch).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0].query).toBe('graphical lasso');
  });

  it('searches the text as typed and says why when the AI rewrite fails', async () => {
    const search = vi
      .fn<LiteratureViewAdapter['search']>()
      .mockResolvedValue(receipt(RUN_A, 'fallback', COMPLETED_A));
    const view = await mount({
      list: vi.fn<LiteratureViewAdapter['list']>().mockResolvedValue(library([])),
      search,
      planSearch: vi
        .fn<NonNullable<LiteratureViewAdapter['planSearch']>>()
        .mockRejectedValue(new Error('literature_ai_timeout')),
      updateAnnotations: vi.fn(),
      deleteRecord: vi.fn(),
      importRecords: vi.fn(),
      exportRecords: vi.fn(),
    });

    await view.type('라벨 임베딩 확장 관련 논문 찾아줘');
    await view.submit();

    expect(search.mock.calls[0]?.[0].query).toBe('라벨 임베딩 확장 관련 논문 찾아줘');
    expect(view.notice()).toContain('AI could not turn the request into keywords');
    expect(view.notice()).toContain('did not finish within the time limit');
  });
});
