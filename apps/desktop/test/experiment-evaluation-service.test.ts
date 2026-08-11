import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  ExperimentEvaluationService,
  type ExperimentEvaluationServiceError,
  type ExperimentEvaluationStorage,
} from '../src/main/experiment-evaluation-service';
import type { ExperimentWorkspaceService } from '../src/main/experiment-workspace-service';
import type { WorkspaceService } from '../src/main/workspace-service';
import type {
  ExperimentEvaluationGenerationOutputSchema,
  ExperimentEvaluationMessage,
  ExperimentEvaluationProfile,
  ExperimentEvaluationRevision,
  ExperimentEvaluationSession,
  ExperimentEvaluationSessionDetail,
} from '../src/shared/experiment-evaluation-contracts';
import { EXPERIMENT_LOGGING_SYSTEM_FIELDS } from '../src/shared/experiment-workspace-contracts';

type GenerationOutput = ReturnType<typeof ExperimentEvaluationGenerationOutputSchema.parse>;

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function invocation(requestedModelId: string | null): ModelInvocation {
  return {
    schemaVersion: 1,
    invocationId: randomUUID(),
    providerId: 'codex',
    requestedModelId,
    resolvedModelId: requestedModelId ?? 'provider-default',
    catalogVersion: 'fixture-catalog',
    reasoningOptionId: 'high',
    startedAt: new Date().toISOString(),
  };
}

function generationOutput(referenceCode = 'import json\nprint(json.dumps({"score": 0.5}))') {
  return {
    reply: 'Drafted an exploratory evaluation. Review it before approval.',
    sessionTitle: 'Exploratory validation',
    draft: {
      title: 'Exploratory validation',
      purpose: 'Inspect model behavior without requiring a target metric.',
      cadence: { unit: 'epoch' as const, interval: 2, startAt: 0, stopAfter: null },
      metrics: [
        {
          key: 'validation_score',
          displayName: 'Validation score',
          direction: 'observe' as const,
          unit: null,
          aggregation: 'mean' as const,
          primary: false,
        },
      ],
      evaluationPolicy: 'Use the held-out fixture and report missing values explicitly.',
      experimentRules: ['Do not treat synthetic preview values as evidence.'],
      loggingFields: [
        {
          key: 'validation_score',
          label: 'Validation score',
          type: 'number' as const,
          category: 'metric' as const,
          requiredAt: ['summary' as const],
          unit: null,
        },
      ],
      outputs: [
        {
          kind: 'number' as const,
          title: 'Validation score',
          metricKey: 'validation_score',
          description: 'One illustrative score.',
        },
      ],
      referenceCode: {
        language: 'python' as const,
        fileName: 'evaluate_validation.py',
        content: referenceCode,
      },
      promptTemplate: 'Evaluate the supplied structured predictions and return JSON.',
      preview: {
        dataKind: 'synthetic-preview' as const,
        evidence: false as const,
        notice: 'Illustrative values only; no experiment was executed.',
        numbers: [{ label: 'Validation score', value: 0.5, unit: null }],
        table: null,
        plot: null,
        reportMarkdown: '# Synthetic preview\n\nNo real evaluation was executed.',
      },
    },
  } satisfies GenerationOutput;
}

class MemoryStorage implements ExperimentEvaluationStorage {
  readonly sessions: ExperimentEvaluationSession[] = [];
  readonly messages: ExperimentEvaluationMessage[] = [];
  readonly revisions: ExperimentEvaluationRevision[] = [];
  readonly profiles: ExperimentEvaluationProfile[] = [];

  listExperimentEvaluationSessions(projectId: string) {
    return this.sessions.filter((session) => session.projectId === projectId);
  }

  listExperimentEvaluationProfiles(projectId: string) {
    return this.profiles.filter((profile) => profile.projectId === projectId);
  }

  getExperimentEvaluationSession(projectId: string, sessionId: string) {
    return (
      this.sessions.find(
        (session) => session.projectId === projectId && session.id === sessionId,
      ) ?? null
    );
  }

  getExperimentEvaluationSessionDetail(
    projectId: string,
    sessionId: string,
  ): ExperimentEvaluationSessionDetail | null {
    const session = this.getExperimentEvaluationSession(projectId, sessionId);
    if (!session) return null;
    return {
      schemaVersion: 1,
      session,
      messages: this.messages.filter((message) => message.sessionId === sessionId),
      currentRevision:
        this.revisions
          .filter((revision) => revision.sessionId === sessionId)
          .sort((left, right) => right.revision - left.revision)[0] ?? null,
    };
  }

  getExperimentEvaluationRevision(projectId: string, sessionId: string, revision: number) {
    if (!this.getExperimentEvaluationSession(projectId, sessionId)) return null;
    return (
      this.revisions.find(
        (candidate) => candidate.sessionId === sessionId && candidate.revision === revision,
      ) ?? null
    );
  }

  getExperimentEvaluationProfile(projectId: string, profileId: string) {
    return (
      this.profiles.find(
        (profile) => profile.projectId === projectId && profile.id === profileId,
      ) ?? null
    );
  }

  createExperimentEvaluationSession(session: ExperimentEvaluationSession) {
    this.sessions.push(session);
    return true;
  }

  beginExperimentEvaluationTurn(input: {
    projectId: string;
    sessionId: string;
    expectedVersion: number;
    attemptId: string;
    userMessage: ExperimentEvaluationMessage;
    updatedAt: string;
  }) {
    const index = this.sessions.findIndex(
      (session) =>
        session.projectId === input.projectId &&
        session.id === input.sessionId &&
        session.version === input.expectedVersion,
    );
    if (index < 0) return null;
    const current = this.sessions[index]!;
    const generating: ExperimentEvaluationSession = {
      ...current,
      status: 'generating',
      activeAttemptId: input.attemptId,
      version: current.version + 1,
      updatedAt: input.updatedAt,
    };
    this.sessions[index] = generating;
    this.messages.push(input.userMessage);
    return generating;
  }

  completeExperimentEvaluationTurn(input: {
    session: ExperimentEvaluationSession;
    revision: ExperimentEvaluationRevision;
    assistantMessage: ExperimentEvaluationMessage;
  }) {
    const index = this.sessions.findIndex(
      (session) =>
        session.id === input.session.id &&
        session.activeAttemptId === input.revision.attemptId &&
        session.version + 1 === input.session.version,
    );
    if (index < 0) return null;
    this.sessions[index] = input.session;
    this.revisions.push(input.revision);
    this.messages.push(input.assistantMessage);
    return input.session;
  }

  failExperimentEvaluationTurn(input: {
    projectId: string;
    sessionId: string;
    attemptId: string;
    errorCode: string;
    updatedAt: string;
  }) {
    const index = this.sessions.findIndex(
      (session) =>
        session.projectId === input.projectId &&
        session.id === input.sessionId &&
        session.activeAttemptId === input.attemptId,
    );
    if (index < 0) return null;
    const current = this.sessions[index]!;
    const failed: ExperimentEvaluationSession = {
      ...current,
      status: 'failed',
      activeAttemptId: null,
      lastErrorCode: input.errorCode,
      version: current.version + 1,
      updatedAt: input.updatedAt,
    };
    this.sessions[index] = failed;
    return failed;
  }

  approveExperimentEvaluation(input: {
    projectId: string;
    sessionId: string;
    expectedVersion: number;
    revision: number;
    profile: ExperimentEvaluationProfile;
    updatedAt: string;
  }) {
    const index = this.sessions.findIndex(
      (session) =>
        session.projectId === input.projectId &&
        session.id === input.sessionId &&
        session.version === input.expectedVersion &&
        session.currentRevision === input.revision,
    );
    if (index < 0) return null;
    const current = this.sessions[index]!;
    const approved: ExperimentEvaluationSession = {
      ...current,
      acceptedProfileId: input.profile.id,
      version: current.version + 1,
      updatedAt: input.updatedAt,
    };
    this.sessions[index] = approved;
    this.profiles.push(input.profile);
    return approved;
  }

  createExperimentEvaluationSessionFromProfile(input: {
    session: ExperimentEvaluationSession;
    revision: ExperimentEvaluationRevision;
    profileId: string;
    usedAt: string;
  }) {
    const profileIndex = this.profiles.findIndex((profile) => profile.id === input.profileId);
    if (profileIndex < 0) return null;
    this.sessions.push(input.session);
    this.revisions.push(input.revision);
    const profile = this.profiles[profileIndex]!;
    this.profiles[profileIndex] = {
      ...profile,
      useCount: profile.useCount + 1,
      lastUsedAt: input.usedAt,
    };
    return input.session;
  }
}

class FakeCodex extends EventEmitter {
  response: GenerationOutput = generationOutput();
  autoComplete = true;
  prompt = '';
  readonly turns = new Map<string, { turnId: string; response: GenerationOutput }>();
  readonly startInputs: Record<string, unknown>[] = [];

  async startThread(input: Record<string, unknown>) {
    this.startInputs.push(input);
    return { threadId: randomUUID() };
  }

  async runTurn(input: { threadId: string; prompt: string; requestedModelId: string | null }) {
    this.prompt = input.prompt;
    const turnId = randomUUID();
    this.turns.set(input.threadId, { turnId, response: structuredClone(this.response) });
    if (this.autoComplete) queueMicrotask(() => this.complete(input.threadId));
    return { turnId, invocation: invocation(input.requestedModelId) };
  }

  complete(threadId: string) {
    const turn = this.turns.get(threadId);
    if (!turn) return;
    this.emit('notification', {
      method: 'item/completed',
      params: {
        threadId,
        turnId: turn.turnId,
        item: {
          type: 'agentMessage',
          phase: 'final_answer',
          text: JSON.stringify(turn.response),
        },
      },
    });
    this.emit('notification', {
      method: 'turn/completed',
      params: { threadId, turn: { id: turn.turnId, status: 'completed' } },
    });
  }

  completeTerminalFirst(threadId: string) {
    const turn = this.turns.get(threadId);
    if (!turn) return;
    this.emit('notification', {
      method: 'turn/completed',
      params: { threadId, turn: { id: turn.turnId, status: 'completed' } },
    });
    this.emit('notification', {
      method: 'item/completed',
      params: {
        threadId,
        turnId: turn.turnId,
        item: {
          type: 'agentMessage',
          phase: 'final_answer',
          text: JSON.stringify(turn.response),
        },
      },
    });
  }

  async interruptTurn() {}
  async releaseThread() {}
}

function fixture() {
  const projectId = randomUUID();
  const now = '2026-08-12T00:00:00.000Z';
  const storage = new MemoryStorage();
  const codex = new FakeCodex();
  const saveProfile = vi.fn(async ({ profileId }: { profileId: string }) => ({
    codePath: `evaluation-profiles/${profileId}/evaluate_validation.py`,
    promptPath: `evaluation-profiles/${profileId}/evaluation-prompt.txt`,
  }));
  const finalizeProfile = vi.fn(async () => undefined);
  const verifyProfile = vi.fn(async () => true);
  const rollbackProfile = vi.fn(async () => undefined);
  const workspace = {
    snapshot: async () => ({
      schemaVersion: 1 as const,
      revision: 1,
      projects: [
        {
          id: projectId,
          name: 'Fixture project',
          slug: 'fixture-project',
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
      tasks: [],
      objectives: [],
    }),
  } as unknown as WorkspaceService;
  const loggingTemplate = {
    schemaVersion: 1 as const,
    id: randomUUID(),
    projectId,
    version: 1,
    previousRevisionId: null,
    systemFields: EXPERIMENT_LOGGING_SYSTEM_FIELDS,
    customFields: [],
    templateHash: hash([]),
    createdAt: now,
  };
  const experiments = {
    list: async () => ({
      schemaVersion: 1 as const,
      projectId,
      loggingTemplate,
      ideas: [],
      metricPoints: [],
      runs: [],
    }),
  } as unknown as ExperimentWorkspaceService;
  const service = new ExperimentEvaluationService({
    storage,
    workspace,
    experiments,
    codex,
    artifacts: { saveProfile, finalizeProfile, verifyProfile, rollbackProfile },
    prepareDirectory: async () => '/tmp/gosu-evaluation-fixture',
    now: () => new Date(now),
    timeoutMs: 5_000,
  });
  return {
    service,
    storage,
    codex,
    saveProfile,
    finalizeProfile,
    verifyProfile,
    rollbackProfile,
    projectId,
  };
}

async function draftOneEvaluation() {
  const context = fixture();
  const session = await context.service.createSession({
    projectId: context.projectId,
    title: 'Evaluation session',
  });
  const receipt = await context.service.send({
    projectId: context.projectId,
    sessionId: session.id,
    expectedVersion: session.version,
    message: 'Set up an exploratory evaluation every two epochs.',
    requestedModelId: null,
    reasoningOptionId: null,
  });
  return { ...context, session, receipt };
}

describe('ExperimentEvaluationService', () => {
  it('creates an exploratory draft without a target and does not save artifacts before approval', async () => {
    const { receipt, codex, saveProfile, storage } = await draftOneEvaluation();

    expect(receipt.session).toMatchObject({ status: 'ready', currentRevision: 1, version: 3 });
    expect(receipt.revision.draft.metrics).toEqual([
      expect.objectContaining({ direction: 'observe', primary: false }),
    ]);
    expect(receipt.revision.draft.preview).toMatchObject({
      dataKind: 'synthetic-preview',
      evidence: false,
    });
    expect(saveProfile).not.toHaveBeenCalled();
    expect(storage.profiles).toEqual([]);
    expect(codex.prompt).toContain('"objective":null');
    expect(codex.prompt).toContain('"targetOptional":true');
    expect(codex.startInputs[0]).toMatchObject({ dynamicTools: [], webSearchMode: 'disabled' });
  });

  it('persists code and prompt only after explicit approval and reuses the immutable recipe as a clone', async () => {
    const { service, receipt, saveProfile, finalizeProfile, verifyProfile, storage, projectId } =
      await draftOneEvaluation();
    const approved = await service.approve({
      projectId,
      sessionId: receipt.session.id,
      expectedVersion: receipt.session.version,
      revision: receipt.revision.revision,
      profileName: 'Every two epochs',
    });

    expect(saveProfile).toHaveBeenCalledOnce();
    expect(finalizeProfile).toHaveBeenCalledWith({
      projectId,
      profileId: approved.profile.id,
    });
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        fileName: 'evaluate_validation.py',
        code: receipt.revision.draft.referenceCode.content,
        prompt: receipt.revision.draft.promptTemplate,
      }),
    );
    expect(approved.session).toMatchObject({
      acceptedProfileId: approved.profile.id,
      version: 4,
    });
    expect(storage.profiles).toHaveLength(1);
    expect(approved.profile.useCount).toBe(0);
    expect(storage.profiles[0]?.useCount).toBe(0);

    const cloned = await service.reuseProfile({ projectId, profileId: approved.profile.id });
    expect(verifyProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        profileId: approved.profile.id,
        code: receipt.revision.draft.referenceCode.content,
        prompt: receipt.revision.draft.promptTemplate,
      }),
    );
    expect(cloned.session.id).not.toBe(receipt.session.id);
    expect(cloned.session).toMatchObject({
      title: 'Every two epochs copy',
      status: 'ready',
      currentRevision: 1,
      acceptedProfileId: approved.profile.id,
    });
    expect(cloned.currentRevision?.draft).toEqual(receipt.revision.draft);
    expect(storage.profiles[0]?.useCount).toBe(1);
  });

  it('refuses to reuse a recipe when its derived local artifacts changed or disappeared', async () => {
    const { service, receipt, verifyProfile, storage, projectId } = await draftOneEvaluation();
    const approved = await service.approve({
      projectId,
      sessionId: receipt.session.id,
      expectedVersion: receipt.session.version,
      revision: receipt.revision.revision,
      profileName: 'Protected evaluator',
    });
    verifyProfile.mockResolvedValueOnce(false);

    await expect(
      service.reuseProfile({ projectId, profileId: approved.profile.id }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ExperimentEvaluationServiceError>>({
        code: 'experiment_evaluation_artifact_failed',
      }),
    );
    expect(storage.sessions).toHaveLength(1);
    expect(storage.profiles[0]?.useCount).toBe(0);
  });

  it('accepts a final answer delivered after the terminal Codex notification', async () => {
    const { service, codex, projectId } = fixture();
    codex.autoComplete = false;
    const session = await service.createSession({
      projectId,
      title: 'Out-of-order notification evaluation',
    });

    const turn = service.send({
      projectId,
      sessionId: session.id,
      expectedVersion: session.version,
      message: 'Draft an evaluation despite notification reordering.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    await vi.waitFor(() => expect(codex.turns.size).toBe(1));
    const [threadId] = codex.turns.keys();
    expect(threadId).toBeDefined();
    codex.completeTerminalFirst(threadId!);

    await expect(turn).resolves.toMatchObject({
      session: { id: session.id, status: 'ready' },
      revision: { revision: 1 },
    });
  });

  it('does not let a throwing event subscriber abort persisted evaluation work', async () => {
    const { service, projectId, storage } = fixture();
    service.onEvent(() => {
      throw new Error('renderer listener failed');
    });

    const session = await service.createSession({
      projectId,
      title: 'Subscriber isolation evaluation',
    });
    const receipt = await service.send({
      projectId,
      sessionId: session.id,
      expectedVersion: session.version,
      message: 'Draft an evaluation while a renderer subscriber is broken.',
      requestedModelId: null,
      reasoningOptionId: null,
    });

    expect(receipt.session.status).toBe('ready');
    expect(storage.revisions).toHaveLength(1);
  });

  it('allows independent sessions to generate concurrently', async () => {
    const { service, codex, projectId } = fixture();
    codex.autoComplete = false;
    const first = await service.createSession({ projectId, title: 'First evaluation' });
    const second = await service.createSession({ projectId, title: 'Second evaluation' });

    const firstTurn = service.send({
      projectId,
      sessionId: first.id,
      expectedVersion: first.version,
      message: 'Draft the first evaluation.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    const secondTurn = service.send({
      projectId,
      sessionId: second.id,
      expectedVersion: second.version,
      message: 'Draft the second evaluation.',
      requestedModelId: null,
      reasoningOptionId: null,
    });

    await vi.waitFor(() => expect(codex.turns.size).toBe(2));
    for (const threadId of codex.turns.keys()) codex.complete(threadId);
    const [firstReceipt, secondReceipt] = await Promise.all([firstTurn, secondTurn]);
    expect(firstReceipt.session.id).toBe(first.id);
    expect(secondReceipt.session.id).toBe(second.id);
    expect(firstReceipt.session.status).toBe('ready');
    expect(secondReceipt.session.status).toBe('ready');
  });

  it('fails closed on unsafe generated reference code and never saves it', async () => {
    const { service, codex, storage, saveProfile, projectId } = fixture();
    codex.response = generationOutput(
      'import subprocess\nsubprocess.run(["sh", "-c", "echo unsafe"])',
    );
    const session = await service.createSession({ projectId, title: 'Unsafe draft' });

    await expect(
      service.send({
        projectId,
        sessionId: session.id,
        expectedVersion: session.version,
        message: 'Write an evaluator.',
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ExperimentEvaluationServiceError>>({
        code: 'experiment_evaluation_invalid_response',
      }),
    );
    expect(storage.revisions).toEqual([]);
    expect(storage.profiles).toEqual([]);
    expect(saveProfile).not.toHaveBeenCalled();
    expect(storage.sessions[0]).toMatchObject({
      status: 'failed',
      lastErrorCode: 'experiment_evaluation_invalid_response',
    });
  });

  it('preserves the typed turn error when synchronous failure reconciliation also throws', async () => {
    const { service, codex, storage, projectId } = fixture();
    codex.response = generationOutput('import subprocess\nsubprocess.run(["unsafe"])');
    vi.spyOn(storage, 'failExperimentEvaluationTurn').mockImplementation(() => {
      throw new Error('synchronous storage failure');
    });
    const session = await service.createSession({ projectId, title: 'Reconciliation failure' });

    await expect(
      service.send({
        projectId,
        sessionId: session.id,
        expectedVersion: session.version,
        message: 'Generate an unsafe evaluator fixture.',
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ExperimentEvaluationServiceError>>({
        code: 'experiment_evaluation_invalid_response',
      }),
    );
  });
});
