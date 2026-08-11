import { EventEmitter } from 'node:events';

import type { ModelCatalog, ModelInvocation } from '@gosu/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  HERMES_CONFIGURED_MODEL_ID,
  HERMES_PROVIDER_ID,
  type RefreshableHermesProjectChat,
} from '../src/main/hermes-project-chat-adapter';
import { ProjectChatProviderRouter } from '../src/main/project-chat-provider-router';
import type { ProjectChatCodex } from '../src/main/project-chat-service';
import type { CodexCollaborationModeCatalog } from '../src/shared/project-chat-contracts';

function catalog(providerId: string, modelId: string, isDefault: boolean): ModelCatalog {
  return {
    schemaVersion: 1,
    providerId,
    catalogVersion: `${providerId}-catalog-v1`,
    fetchedAt: '2026-08-11T00:00:00.000Z',
    models: [
      {
        schemaVersion: 1,
        providerId,
        modelId,
        displayName: `${providerId} model`,
        catalogVersion: `${providerId}-catalog-v1`,
        isDefault,
        modalities: ['text'],
        reasoningOptions: [{ id: 'medium', label: 'medium', isDefault: true }],
      },
    ],
  };
}

class FakeProvider extends EventEmitter implements ProjectChatCodex {
  readonly starts = vi.fn((_input: Parameters<ProjectChatCodex['startThread']>[0]) => undefined);
  readonly runs = vi.fn((_input: Parameters<ProjectChatCodex['runTurn']>[0]) => undefined);
  readonly interrupts = vi.fn(async (_threadId: string, _turnId: string) => undefined);
  readonly releases = vi.fn(async (_threadId: string) => undefined);
  readonly revocations = vi.fn((_threadId: string) => undefined);
  private nextThread = 0;
  private nextTurn = 0;

  constructor(
    readonly providerId: string,
    readonly modelCatalog: ModelCatalog,
    readonly collaborationCatalog: CodexCollaborationModeCatalog,
  ) {
    super();
  }

  async listModelCatalog() {
    return structuredClone(this.modelCatalog);
  }

  async listCollaborationModeCatalog() {
    return structuredClone(this.collaborationCatalog);
  }

  async startThread(input: Parameters<ProjectChatCodex['startThread']>[0]) {
    this.starts(input);
    this.nextThread += 1;
    return {
      threadId:
        this.providerId === HERMES_PROVIDER_ID
          ? `hermes:thread:${this.nextThread}`
          : `codex-thread-${this.nextThread}`,
    };
  }

  async runTurn(input: Parameters<ProjectChatCodex['runTurn']>[0]) {
    this.runs(input);
    this.nextTurn += 1;
    const invocation: ModelInvocation = {
      schemaVersion: 1,
      invocationId: `${this.providerId}-invocation-${this.nextTurn}`,
      providerId: this.providerId,
      requestedModelId: input.requestedModelId,
      resolvedModelId: this.modelCatalog.models[0]!.modelId,
      catalogVersion: this.modelCatalog.catalogVersion,
      reasoningOptionId: input.reasoningOptionId,
      startedAt: '2026-08-11T00:00:00.000Z',
    };
    return { turnId: `${this.providerId}-turn-${this.nextTurn}`, invocation };
  }

  interruptTurn(threadId: string, turnId: string) {
    return this.interrupts(threadId, turnId);
  }

  revokeDynamicTools(threadId: string) {
    this.revocations(threadId);
  }

  releaseThread(threadId: string) {
    return this.releases(threadId);
  }
}

class FakeHermesProvider extends FakeProvider implements RefreshableHermesProjectChat {
  readonly refreshes = vi.fn(async () => ({
    catalog: await this.listModelCatalog(),
    collaborationModes: await this.listCollaborationModeCatalog(),
  }));
  readonly resets = vi.fn(() => 0);

  refreshConnectionCatalogs() {
    return this.refreshes();
  }

  resetConnection() {
    return this.resets();
  }
}

function fixture() {
  const codex = new FakeProvider('codex', catalog('codex', 'codex-provider-default', true), {
    catalogVersion: 'c'.repeat(64),
    modes: [
      {
        id: 'codex-mode',
        displayName: 'Codex mode',
        recommendedModelId: null,
        recommendedReasoningOptionId: null,
      },
    ],
  });
  const hermes = new FakeHermesProvider(
    HERMES_PROVIDER_ID,
    catalog(HERMES_PROVIDER_ID, HERMES_CONFIGURED_MODEL_ID, true),
    {
      catalogVersion: 'h'.repeat(64),
      modes: [
        {
          id: 'hermes-mode',
          displayName: 'Hermes mode',
          recommendedModelId: null,
          recommendedReasoningOptionId: null,
        },
      ],
    },
  );
  const router = new ProjectChatProviderRouter(codex, hermes);
  return { codex, hermes, router };
}

const threadInput = {
  cwd: '/isolated/project',
  developerInstructions: 'Stay scoped.',
  responseVerbosity: null,
  webSearchMode: 'disabled' as const,
};

describe('ProjectChatProviderRouter', () => {
  it('keeps Hermes unavailable until explicit BYO connection and keeps Codex default', async () => {
    const { codex, hermes, router } = fixture();

    await expect(
      router.startThread({ ...threadInput, modelId: HERMES_CONFIGURED_MODEL_ID }),
    ).rejects.toThrow('hermes_not_connected');
    expect(hermes.starts).not.toHaveBeenCalled();
    expect((await router.listModelCatalog()).models.map((model) => model.modelId)).toEqual([
      'codex-provider-default',
    ]);

    const connection = await router.connectHermes();
    expect(hermes.refreshes).toHaveBeenCalledOnce();
    expect(connection.catalog.providerId).toBe(HERMES_PROVIDER_ID);
    const merged = await router.listModelCatalog();
    expect(merged.models.map((model) => [model.modelId, model.isDefault])).toEqual([
      ['codex-provider-default', true],
      [HERMES_CONFIGURED_MODEL_ID, false],
    ]);
    expect((await router.listBranchTitleModelCatalog()).providerId).toBe('codex');
    expect(codex.starts).not.toHaveBeenCalled();
  });

  it('forces a fresh Hermes preflight on check again and after reconnect', async () => {
    const { hermes, router } = fixture();

    await router.connectHermes();
    await router.connectHermes();
    await router.disconnectHermes();
    await router.connectHermes();

    expect(hermes.refreshes).toHaveBeenCalledTimes(3);
  });

  it('rejects a model ID collision before Hermes becomes routable', async () => {
    const { codex, hermes, router } = fixture();
    vi.spyOn(codex, 'listModelCatalog').mockResolvedValue(
      catalog('codex', HERMES_CONFIGURED_MODEL_ID, true),
    );

    await expect(router.connectHermes()).rejects.toThrow('project_chat_model_id_collision');
    expect(hermes.resets).toHaveBeenCalledOnce();
    expect(router.isHermesConnected()).toBe(false);
    await expect(
      router.startThread({ ...threadInput, modelId: HERMES_CONFIGURED_MODEL_ID }),
    ).rejects.toThrow('hermes_not_connected');
  });

  it('routes model, native collaboration catalog, turn, cancel, and release without fallback', async () => {
    const { codex, hermes, router } = fixture();
    await router.connectHermes();
    const modes = await router.listCollaborationModeCatalog(HERMES_CONFIGURED_MODEL_ID);
    expect(modes.modes.map((mode) => mode.id)).toEqual(['hermes-mode']);

    const started = await router.startThread({
      ...threadInput,
      modelId: HERMES_CONFIGURED_MODEL_ID,
    });
    expect(started).toMatchObject({ providerId: 'hermes' });
    const turn = await router.runTurn({
      threadId: started.threadId,
      prompt: 'Explain the result.',
      requestedModelId: HERMES_CONFIGURED_MODEL_ID,
      reasoningOptionId: 'medium',
      cwd: threadInput.cwd,
    });
    expect(turn.invocation.providerId).toBe('hermes');
    expect(hermes.runs).toHaveBeenCalledOnce();
    expect(codex.runs).not.toHaveBeenCalled();

    await expect(
      router.runTurn({
        threadId: started.threadId,
        prompt: 'Do not reroute this.',
        requestedModelId: 'codex-provider-default',
        reasoningOptionId: null,
        cwd: threadInput.cwd,
      }),
    ).rejects.toThrow('project_chat_thread_provider_mismatch');
    await router.interruptTurn(started.threadId, turn.turnId);
    router.revokeDynamicTools(started.threadId);
    await router.releaseThread(started.threadId);
    expect(hermes.interrupts).toHaveBeenCalledOnce();
    expect(hermes.revocations).toHaveBeenCalledOnce();
    expect(hermes.releases).toHaveBeenCalledOnce();
  });

  it('scopes disconnects and forwarded events to the owning provider', async () => {
    const { codex, hermes, router } = fixture();
    await router.connectHermes();
    const codexThread = await router.startThread({ ...threadInput, modelId: null });
    const hermesThread = await router.startThread({
      ...threadInput,
      modelId: HERMES_CONFIGURED_MODEL_ID,
    });
    const disconnects: unknown[] = [];
    const notifications: unknown[] = [];
    router.on('disconnected', (event) => disconnects.push(event));
    router.on('notification', (event) => notifications.push(event));

    codex.emit('notification', {
      method: 'turn/completed',
      params: { threadId: hermesThread.threadId, turn: { id: 'wrong', status: 'completed' } },
    });
    hermes.emit('notification', {
      method: 'turn/completed',
      params: { threadId: hermesThread.threadId, turn: { id: 'right', status: 'completed' } },
    });
    expect(notifications).toHaveLength(1);

    codex.emit('disconnected');
    expect(disconnects).toEqual([{ providerId: 'codex' }]);
    await expect(
      router.runTurn({
        threadId: codexThread.threadId,
        prompt: 'Unavailable',
        requestedModelId: null,
        reasoningOptionId: null,
        cwd: threadInput.cwd,
      }),
    ).rejects.toThrow('project_chat_thread_not_found');
    await expect(
      router.runTurn({
        threadId: hermesThread.threadId,
        prompt: 'Still available',
        requestedModelId: HERMES_CONFIGURED_MODEL_ID,
        reasoningOptionId: null,
        cwd: threadInput.cwd,
      }),
    ).resolves.toMatchObject({ invocation: { providerId: 'hermes' } });
  });

  it('keeps Codex threads available when Hermes disconnects', async () => {
    const { codex, hermes, router } = fixture();
    await router.connectHermes();
    const codexThread = await router.startThread({ ...threadInput, modelId: null });
    const hermesThread = await router.startThread({
      ...threadInput,
      modelId: HERMES_CONFIGURED_MODEL_ID,
    });

    hermes.emit('disconnected');
    expect(router.isHermesConnected()).toBe(false);
    await expect(
      router.runTurn({
        threadId: hermesThread.threadId,
        prompt: 'Unavailable',
        requestedModelId: HERMES_CONFIGURED_MODEL_ID,
        reasoningOptionId: null,
        cwd: threadInput.cwd,
      }),
    ).rejects.toThrow('project_chat_thread_not_found');
    await expect(
      router.runTurn({
        threadId: codexThread.threadId,
        prompt: 'Still available',
        requestedModelId: null,
        reasoningOptionId: null,
        cwd: threadInput.cwd,
      }),
    ).resolves.toMatchObject({ invocation: { providerId: 'codex' } });
    expect(codex.runs).toHaveBeenCalledOnce();
  });

  it('explicitly revokes Hermes without releasing Codex or allowing queued Hermes starts', async () => {
    const { codex, hermes, router } = fixture();
    await router.connectHermes();
    const codexThread = await router.startThread({ ...threadInput, modelId: null });
    const hermesThread = await router.startThread({
      ...threadInput,
      modelId: HERMES_CONFIGURED_MODEL_ID,
    });
    const disconnects: unknown[] = [];
    router.on('disconnected', (event) => disconnects.push(event));

    await router.disconnectHermes();

    expect(router.isHermesConnected()).toBe(false);
    expect(hermes.resets).toHaveBeenCalledOnce();
    expect(hermes.releases).not.toHaveBeenCalled();
    expect(codex.releases).not.toHaveBeenCalled();
    expect(disconnects).toEqual([{ providerId: HERMES_PROVIDER_ID }]);
    expect((await router.listModelCatalog()).models.map((model) => model.providerId)).toEqual([
      'codex',
    ]);
    await expect(
      router.startThread({ ...threadInput, modelId: HERMES_CONFIGURED_MODEL_ID }),
    ).rejects.toThrow('hermes_not_connected');
    await expect(
      router.runTurn({
        threadId: codexThread.threadId,
        prompt: 'Codex remains available.',
        requestedModelId: null,
        reasoningOptionId: null,
        cwd: threadInput.cwd,
      }),
    ).resolves.toMatchObject({ invocation: { providerId: 'codex' } });
  });
});
