import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  LiteratureAiService,
  type LiteratureAiServiceError,
  type LiteratureAiStorage,
} from '../src/main/literature-ai-service';
import type {
  LiteratureAiAnnotationUpdate,
  LiteratureAiProvenance,
  LiteratureRecord,
} from '../src/shared/literature-contracts';

function invocation(requestedModelId: string | null): ModelInvocation {
  return {
    schemaVersion: 1,
    invocationId: randomUUID(),
    providerId: 'codex',
    requestedModelId,
    resolvedModelId: requestedModelId ?? 'fixture-default',
    catalogVersion: 'fixture-catalog',
    reasoningOptionId: 'high',
    startedAt: new Date().toISOString(),
  };
}

function record(projectId: string, title = 'Metadata-only research'): LiteratureRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: randomUUID(),
    projectId,
    provider: 'crossref',
    providerRecordId: '10.1000/fixture',
    doi: '10.1000/fixture',
    fingerprint: 'a'.repeat(64),
    title,
    authors: ['Ada Researcher'],
    containerTitle: 'Journal of Fixtures',
    publishedYear: 2026,
    sourceTopics: ['evaluation'],
    workType: 'journal-article',
    citationCount: 7,
    sourceUrl: 'https://doi.org/10.1000/fixture',
    citationKey: 'researcher2026metadata',
    reviewStatus: 'unreviewed',
    manualAnnotations: {
      topics: ['PRIVATE MANUAL TOPIC'],
      summary: 'PRIVATE MANUAL SUMMARY',
      relevance: 'PRIVATE MANUAL RELEVANCE',
    },
    aiAnnotations: null,
    annotationVersion: 3,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

class MemoryStorage implements LiteratureAiStorage {
  applied:
    | {
        projectId: string;
        updates: readonly LiteratureAiAnnotationUpdate[];
        provenance: LiteratureAiProvenance;
      }
    | undefined;

  constructor(readonly records: LiteratureRecord[]) {}

  getRecordsForAi(projectId: string, recordIds: readonly string[]) {
    return recordIds
      .map((id) => this.records.find((candidate) => candidate.id === id))
      .filter(
        (candidate): candidate is LiteratureRecord =>
          candidate !== undefined && candidate.projectId === projectId,
      );
  }

  applyAiAnnotations(
    projectId: string,
    updates: readonly LiteratureAiAnnotationUpdate[],
    provenance: LiteratureAiProvenance,
  ) {
    this.applied = { projectId, updates, provenance };
    return { updatedCount: updates.length, skippedCount: 0 };
  }
}

class FakeCodex extends EventEmitter {
  readonly prompts: string[] = [];
  readonly settings: Array<{ requestedModelId: string | null; reasoningOptionId: string | null }> =
    [];
  readonly released: string[] = [];
  readonly interrupted: Array<{ threadId: string; turnId: string }> = [];
  response: unknown = { updates: [] };
  early = false;
  autoComplete = true;
  reroutedModelId: string | null = null;
  turnStatus = 'completed';
  failStart = false;
  readonly instructions: Array<string | undefined> = [];
  private threadCount = 0;
  private turnCount = 0;

  async startThread(input?: { developerInstructions?: string }) {
    if (this.failStart) throw new Error('codex_not_connected');
    this.instructions.push(input?.developerInstructions);
    this.threadCount += 1;
    return { threadId: `literature-thread-${this.threadCount}` };
  }

  async runTurn(input: {
    threadId: string;
    prompt: string;
    requestedModelId: string | null;
    reasoningOptionId: string | null;
  }) {
    this.turnCount += 1;
    const turnId = `literature-turn-${this.turnCount}`;
    this.prompts.push(input.prompt);
    this.settings.push({
      requestedModelId: input.requestedModelId,
      reasoningOptionId: input.reasoningOptionId,
    });
    const initialInvocation = invocation(input.requestedModelId);
    if (this.reroutedModelId) {
      this.emit('invocation', {
        threadId: input.threadId,
        turnId,
        invocation: { ...initialInvocation, resolvedModelId: this.reroutedModelId },
      });
    }
    const complete = () => {
      this.emit('notification', {
        method: 'item/completed',
        params: {
          threadId: input.threadId,
          turnId,
          item: {
            type: 'agentMessage',
            phase: 'final_answer',
            text: JSON.stringify(this.response),
          },
        },
      });
      this.emit('notification', {
        method: 'turn/completed',
        params: { threadId: input.threadId, turn: { id: turnId, status: this.turnStatus } },
      });
    };
    if (this.autoComplete) {
      if (this.early) complete();
      else queueMicrotask(complete);
    }
    return { turnId, invocation: initialInvocation };
  }

  async interruptTurn(threadId: string, turnId: string) {
    this.interrupted.push({ threadId, turnId });
  }

  async releaseThread(threadId: string) {
    this.released.push(threadId);
  }
}

function responseFor(item: LiteratureRecord) {
  return {
    updates: [
      {
        recordId: item.id,
        expectedVersion: item.version,
        expectedAnnotationVersion: item.annotationVersion,
        topics: ['evaluation', 'metadata'],
        keywords: ['research evaluation', 'benchmark methodology', 'metadata quality'],
        summary: 'A metadata record about research evaluation.',
        relevance: 'high',
        studyType: 'Not assessable from metadata alone',
        limitations: ['Not assessable from metadata alone'],
      },
    ],
  };
}

describe('LiteratureAiService', () => {
  it('organizes exact project records with dynamic model provenance and excludes manual notes', async () => {
    const projectId = randomUUID();
    const item = record(projectId);
    const storage = new MemoryStorage([item]);
    const codex = new FakeCodex();
    const usage = { bindThread: vi.fn(), releaseThread: vi.fn() };
    codex.response = responseFor(item);
    const service = new LiteratureAiService({
      storage,
      codex,
      usage,
      prepareDirectory: async () => '/tmp/gosu-literature-fixture',
      timeoutMs: 5_000,
    });

    const receipt = await service.organize({
      projectId,
      recordIds: [item.id],
      requestedModelId: 'opaque-model-id',
      reasoningOptionId: 'high',
    });

    expect(receipt).toMatchObject({
      projectId,
      requestedCount: 1,
      updatedCount: 1,
      skippedCount: 0,
      invocation: { resolvedModelId: 'opaque-model-id' },
    });
    expect(codex.settings).toEqual([
      { requestedModelId: 'opaque-model-id', reasoningOptionId: 'high' },
    ]);
    expect(codex.prompts[0]).toContain(item.title);
    expect(codex.prompts[0]).not.toContain('PRIVATE MANUAL');
    expect(storage.applied?.provenance).toMatchObject({
      inputSha256: receipt.inputSha256,
      metadataOnly: true,
    });
    expect(usage.bindThread).toHaveBeenCalledWith('literature-thread-1', {
      workloadKind: 'literature_organize',
      projectId,
    });
    expect(usage.releaseThread).toHaveBeenCalledWith('literature-thread-1');
    expect(codex.released).toEqual(['literature-thread-1']);
  });

  it('includes provider abstracts and persists detailed AI keywords when available', async () => {
    const projectId = randomUUID();
    const item = record(projectId, 'Abstract-aware research');
    item.abstractText =
      'We evaluate retrieval-augmented generation with citation precision, answer faithfulness, and adversarial evidence ablations.';
    const storage = new MemoryStorage([item]);
    const codex = new FakeCodex();
    codex.response = responseFor(item);
    const service = new LiteratureAiService({
      storage,
      codex,
      prepareDirectory: async () => '/tmp/gosu-literature-fixture',
      timeoutMs: 5_000,
    });

    await service.organize({ projectId, recordIds: [item.id] });

    expect(codex.prompts[0]).toContain(item.abstractText);
    expect(codex.prompts[0]).toContain('detailed keywords');
    expect(storage.applied?.updates[0]?.keywords).toEqual([
      'research evaluation',
      'benchmark methodology',
      'metadata quality',
    ]);
    expect(storage.applied?.provenance).toMatchObject({
      metadataOnly: false,
      abstractIncluded: true,
    });
  });

  it('buffers valid completion notifications that arrive before turn registration', async () => {
    const projectId = randomUUID();
    const item = record(projectId);
    const storage = new MemoryStorage([item]);
    const codex = new FakeCodex();
    codex.early = true;
    codex.response = responseFor(item);
    const service = new LiteratureAiService({
      storage,
      codex,
      prepareDirectory: async () => '/tmp/gosu-literature-fixture',
    });

    await expect(service.organize({ projectId, recordIds: [item.id] })).resolves.toMatchObject({
      updatedCount: 1,
    });
  });

  it('records the provider-rerouted model as the actual invocation', async () => {
    const projectId = randomUUID();
    const item = record(projectId);
    const storage = new MemoryStorage([item]);
    const codex = new FakeCodex();
    codex.response = responseFor(item);
    codex.reroutedModelId = 'provider-rerouted-model';
    const service = new LiteratureAiService({
      storage,
      codex,
      prepareDirectory: async () => '/tmp/gosu-literature-fixture',
    });

    const receipt = await service.organize({
      projectId,
      recordIds: [item.id],
      requestedModelId: 'requested-model',
      reasoningOptionId: 'xhigh',
    });

    expect(receipt.invocation.resolvedModelId).toBe('provider-rerouted-model');
    expect(storage.applied?.provenance.invocation.resolvedModelId).toBe('provider-rerouted-model');
  });

  it('rejects hallucinated or stale record identities without applying annotations', async () => {
    const projectId = randomUUID();
    const item = record(projectId);
    const storage = new MemoryStorage([item]);
    const codex = new FakeCodex();
    codex.response = {
      updates: [
        {
          ...responseFor(item).updates[0],
          recordId: randomUUID(),
        },
      ],
    };
    const service = new LiteratureAiService({
      storage,
      codex,
      prepareDirectory: async () => '/tmp/gosu-literature-fixture',
    });

    await expect(service.organize({ projectId, recordIds: [item.id] })).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureAiServiceError>>({
        code: 'literature_ai_invalid_response',
      }),
    );
    expect(storage.applied).toBeUndefined();
  });

  it('fails closed when a requested record belongs to another project', async () => {
    const projectId = randomUUID();
    const otherProjectId = randomUUID();
    const item = record(otherProjectId);
    const storage = new MemoryStorage([item]);
    const codex = new FakeCodex();
    const service = new LiteratureAiService({
      storage,
      codex,
      prepareDirectory: async () => '/tmp/gosu-literature-fixture',
    });

    await expect(service.organize({ projectId, recordIds: [item.id] })).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureAiServiceError>>({
        code: 'literature_ai_conflict',
      }),
    );
    expect(codex.prompts).toEqual([]);
  });

  it('interrupts AI organization before applying any annotations', async () => {
    const projectId = randomUUID();
    const item = record(projectId);
    const storage = new MemoryStorage([item]);
    const codex = new FakeCodex();
    codex.autoComplete = false;
    codex.response = responseFor(item);
    const service = new LiteratureAiService({
      storage,
      codex,
      prepareDirectory: async () => '/tmp/gosu-literature-fixture',
      timeoutMs: 5_000,
    });

    const turn = service.organize({ projectId, recordIds: [item.id] });
    await vi.waitFor(() => expect(codex.prompts).toHaveLength(1));
    const cancelled = await service.cancel({ projectId });

    expect(cancelled).toEqual({ projectId, cancelRequested: true });
    await expect(turn).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureAiServiceError>>({
        code: 'literature_ai_interrupted',
      }),
    );
    expect(codex.interrupted).toEqual([
      { threadId: 'literature-thread-1', turnId: 'literature-turn-1' },
    ]);
    expect(storage.applied).toBeUndefined();
  });
  describe('concrete failure reasons', () => {
    function fixture(configure: (codex: FakeCodex) => void) {
      const projectId = randomUUID();
      const item = record(projectId);
      const storage = new MemoryStorage([item]);
      const codex = new FakeCodex();
      codex.response = responseFor(item);
      configure(codex);
      const service = new LiteratureAiService({
        storage,
        codex,
        prepareDirectory: async () => '/tmp/gosu-literature-fixture',
        timeoutMs: 5_000,
      });
      return { projectId, item, storage, codex, service };
    }

    it('says the model ran out of time instead of calling AI unavailable', async () => {
      vi.useFakeTimers();
      try {
        const { projectId, item, storage, codex, service } = fixture((fake) => {
          fake.autoComplete = false;
        });
        const turn = service.organize({ projectId, recordIds: [item.id] });
        const outcome = expect(turn).rejects.toMatchObject({ code: 'literature_ai_timeout' });
        await vi.advanceTimersByTimeAsync(5_001);
        await outcome;
        expect(codex.interrupted).toHaveLength(1);
        expect(codex.released).toEqual(['literature-thread-1']);
        expect(storage.applied).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('reports a turn the provider ended without completing as a model failure', async () => {
      const { projectId, item, storage, service } = fixture((fake) => {
        fake.turnStatus = 'failed';
      });

      await expect(service.organize({ projectId, recordIds: [item.id] })).rejects.toMatchObject({
        code: 'literature_ai_turn_failed',
      });
      expect(storage.applied).toBeUndefined();
    });

    it('reports a provider that cannot start a thread', async () => {
      const { projectId, item, service } = fixture((fake) => {
        fake.failStart = true;
      });

      await expect(service.organize({ projectId, recordIds: [item.id] })).rejects.toMatchObject({
        code: 'literature_ai_start_failed',
      });
    });
  });

  describe('search planning', () => {
    function planner(response: unknown) {
      const projectId = randomUUID();
      const codex = new FakeCodex();
      codex.response = response;
      const bindThread = vi.fn();
      const releaseThread = vi.fn();
      const service = new LiteratureAiService({
        storage: new MemoryStorage([]),
        codex,
        usage: { bindThread, releaseThread },
        prepareDirectory: async () => '/tmp/gosu-literature-fixture',
        timeoutMs: 5_000,
      });
      return { projectId, codex, service, bindThread, releaseThread };
    }
    const question =
      'TabPFN 클래스 확장과 관련된 논문 찾아줘. 라벨 임베딩 확장, Graphical Lasso를 중심으로 정리해줘.';

    it('turns a Korean request into bounded English keyword queries with provenance tags', async () => {
      const { projectId, codex, service, bindThread, releaseThread } = planner({
        queries: [
          {
            query: '  TabPFN many-class classification  ',
            topics: ['tabular foundation models'],
            keywords: ['TabPFN', 'class expansion'],
          },
          {
            query: 'graphical lasso high-dimensional covariance estimation',
            topics: ['covariance estimation'],
            keywords: ['graphical lasso'],
          },
        ],
      });

      const plan = await service.planSearch({
        projectId,
        question,
        requestedModelId: 'fixture-model',
        reasoningOptionId: 'low',
      });

      expect(plan.queries).toEqual([
        {
          query: 'TabPFN many-class classification',
          topics: ['tabular foundation models'],
          keywords: ['TabPFN', 'class expansion'],
        },
        {
          query: 'graphical lasso high-dimensional covariance estimation',
          topics: ['covariance estimation'],
          keywords: ['graphical lasso'],
        },
      ]);
      expect(plan.invocation.requestedModelId).toBe('fixture-model');
      expect(codex.prompts[0]).toContain(question);
      expect(codex.instructions[0]).toContain('untrusted');
      expect(codex.settings[0]).toEqual({
        requestedModelId: 'fixture-model',
        reasoningOptionId: 'low',
      });
      expect(bindThread).toHaveBeenCalledWith('literature-thread-1', {
        workloadKind: 'literature_organize',
        projectId,
      });
      expect(releaseThread).toHaveBeenCalledWith('literature-thread-1');
      expect(codex.released).toEqual(['literature-thread-1']);
    });

    it('rejects a plan that is still not provider-ready', async () => {
      for (const queries of [
        [{ query: '라벨 임베딩 확장', topics: [], keywords: [] }],
        [{ query: 'find papers', topics: [], keywords: [] }],
        [],
        Array.from({ length: 4 }, (_, index) => ({
          query: `tabular model ${index}`,
          topics: [],
          keywords: [],
        })),
      ]) {
        const { projectId, service } = planner({ queries });
        await expect(service.planSearch({ projectId, question })).rejects.toMatchObject({
          code: 'literature_ai_invalid_response',
        });
      }
    });

    it('drops duplicate queries and keeps the first three words-only differences apart', async () => {
      const { projectId, service } = planner({
        queries: [
          { query: 'TabPFN class expansion', topics: [], keywords: [] },
          { query: 'tabpfn  class expansion', topics: [], keywords: [] },
          { query: 'label embedding expansion', topics: [], keywords: [] },
        ],
      });

      const plan = await service.planSearch({ projectId, question });

      expect(plan.queries.map(({ query }) => query)).toEqual([
        'TabPFN class expansion',
        'label embedding expansion',
      ]);
    });

    it('does not plan while another literature AI turn runs for the project', async () => {
      const projectId = randomUUID();
      const item = record(projectId);
      const codex = new FakeCodex();
      codex.autoComplete = false;
      const service = new LiteratureAiService({
        storage: new MemoryStorage([item]),
        codex,
        prepareDirectory: async () => '/tmp/gosu-literature-fixture',
        timeoutMs: 5_000,
      });
      const running = service.organize({ projectId, recordIds: [item.id] });
      await vi.waitFor(() => expect(codex.prompts).toHaveLength(1));

      await expect(service.planSearch({ projectId, question })).rejects.toMatchObject({
        code: 'literature_ai_busy',
      });

      await service.cancel({ projectId });
      await expect(running).rejects.toMatchObject({ code: 'literature_ai_interrupted' });
    });
  });
});
