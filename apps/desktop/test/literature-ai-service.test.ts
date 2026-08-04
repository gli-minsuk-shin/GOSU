import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';
import { describe, expect, it } from 'vitest';

import {
  LiteratureAiService,
  LiteratureAiServiceError,
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
  reroutedModelId: string | null = null;
  private threadCount = 0;
  private turnCount = 0;

  async startThread() {
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
        params: { threadId: input.threadId, turn: { id: turnId, status: 'completed' } },
      });
    };
    if (this.early) complete();
    else queueMicrotask(complete);
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
    codex.response = responseFor(item);
    const service = new LiteratureAiService({
      storage,
      codex,
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
    expect(codex.released).toEqual(['literature-thread-1']);
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
});
