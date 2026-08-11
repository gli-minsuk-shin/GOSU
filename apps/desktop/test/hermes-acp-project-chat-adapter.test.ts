import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  HermesAcpProjectChatAdapter,
  type HermesAcpProjectChatClient,
} from '../src/main/hermes-acp-project-chat-adapter';
import type {
  HermesAcpClientOptions,
  HermesAcpPermissionRequest,
  HermesAcpSanitizedSessionUpdate,
} from '../src/main/hermes-acp-client';
import { HermesAcpApprovalService } from '../src/main/hermes-acp-approval-service';
import type { HermesAcpProfileInput } from '../src/main/hermes-acp-profile';
import {
  HERMES_CONFIGURED_MODEL_ID,
  HERMES_PROVIDER_ID,
  type HermesAcpRuntimeDiscovery,
  type HermesValidatedAcpRuntime,
} from '../src/main/hermes-project-chat-adapter';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const RUNTIME: HermesValidatedAcpRuntime = {
  pythonPath: '/Users/researcher/.hermes/hermes-agent/venv/bin/python',
  rootPath: '/Users/researcher/.hermes/hermes-agent',
  environment: { HOME: '/Users/researcher', OPENAI_API_KEY: 'fixture-secret' },
  configuredModelId: 'provider/hermes-model',
  configuredProviderId: 'fixture-provider',
  routeFingerprint: 'c'.repeat(64),
  credentialBindingKey: 'b'.repeat(64),
  credentialProof: 'e'.repeat(64),
  sourceCatalogVersion: 'a'.repeat(64),
};

class FakeRuntimeDiscovery implements HermesAcpRuntimeDiscovery {
  runtime = RUNTIME;
  readonly resolutions = vi.fn(async (_forceRefresh?: boolean, credentialBindingKey?: string) => ({
    ...this.runtime,
    credentialBindingKey: credentialBindingKey ?? this.runtime.credentialBindingKey,
  }));
  readonly shutdown = vi.fn(() => 1);

  resolveValidatedAcpRuntime(forceRefresh?: boolean, credentialBindingKey?: string) {
    return this.resolutions(forceRefresh, credentialBindingKey);
  }

  async listCollaborationModeCatalog() {
    return {
      catalogVersion: 'b'.repeat(64),
      modes: [
        {
          id: 'default',
          displayName: 'Default',
          recommendedModelId: null,
          recommendedReasoningOptionId: null,
        },
        {
          id: 'plan',
          displayName: 'Plan',
          recommendedModelId: null,
          recommendedReasoningOptionId: null,
        },
      ],
    };
  }
}

class FakeAcpClient extends EventEmitter implements HermesAcpProjectChatClient {
  readonly prompts: Array<{ sessionId: string; blocks: readonly string[] }> = [];
  readonly cancels = vi.fn(async (_sessionId: string) => undefined);
  closeFailure: Error | null = null;
  readonly close = vi.fn(async () => {
    if (this.closeFailure) throw this.closeFailure;
  });
  readonly terminateImmediately = vi.fn(() => {
    this.promptReject?.(new Error('fake_acp_terminated'));
  });
  private promptResolve: ((result: { stopReason: string }) => void) | null = null;
  private promptReject: ((error: Error) => void) | null = null;

  constructor(
    readonly options: HermesAcpClientOptions,
    readonly number: number,
    private readonly initializeError: string | null = null,
  ) {
    super();
  }

  async initialize() {
    if (this.initializeError) throw new Error(this.initializeError);
    return { protocolVersion: 1 as const, agentName: 'hermes-agent', agentVersion: '0.19.1' };
  }

  async createSession(_cwd: string) {
    return { sessionId: `acp-session-${this.number}` };
  }

  prompt(sessionId: string, text: string | readonly string[]) {
    const blocks = typeof text === 'string' ? [text] : text;
    this.prompts.push({ sessionId, blocks });
    return new Promise<{ stopReason: string }>((resolve, reject) => {
      this.promptResolve = resolve;
      this.promptReject = reject;
    });
  }

  finish(text: string, stopReason = 'end_turn') {
    this.emitUpdate({
      sessionId: `acp-session-${this.number}`,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text },
      },
    });
    this.promptResolve?.({ stopReason });
  }

  fail() {
    this.promptReject?.(new Error('fake_acp_failure'));
  }

  requestPermission(request: HermesAcpPermissionRequest) {
    return this.options.permissionHandler(request);
  }

  emitUpdate(update: HermesAcpSanitizedSessionUpdate) {
    this.emit('sessionUpdate', update);
  }

  async cancel(sessionId: string) {
    return this.cancels(sessionId);
  }
}

function fixture(fixtureOptions: { probeInitializeError?: string } = {}) {
  const runtimeDiscovery = new FakeRuntimeDiscovery();
  const approvals = new HermesAcpApprovalService();
  const clients: FakeAcpClient[] = [];
  const probeClients: FakeAcpClient[] = [];
  const profiles: HermesAcpProfileInput[] = [];
  const adapter = new HermesAcpProjectChatAdapter({
    runtimeDiscovery,
    approvals,
    clientVersion: () => '0.30.2',
    profileFactory: {
      prepare(input) {
        if (input.projectId !== '00000000-0000-4000-8000-000000000001') {
          profiles.push(input);
        }
        return {
          homeDirectory: `/isolated/${input.projectId}/${input.sessionId}`,
          environment: {
            ...input.runtime.environment,
            HERMES_HOME: `/isolated/${input.projectId}/${input.sessionId}`,
            HERMES_SAFE_MODE: '1',
          },
          retention: 'persistent-project-session-local',
        };
      },
    },
    clientFactory(clientOptions) {
      if (
        clientOptions.environment?.HERMES_HOME?.includes('00000000-0000-4000-8000-000000000001')
      ) {
        const client = new FakeAcpClient(
          clientOptions,
          0,
          fixtureOptions.probeInitializeError ?? null,
        );
        probeClients.push(client);
        return client;
      }
      const client = new FakeAcpClient(clientOptions, clients.length + 1);
      clients.push(client);
      return client;
    },
  });
  return { adapter, approvals, clients, probeClients, profiles, runtimeDiscovery };
}

const connectedAdapters = new WeakSet<HermesAcpProjectChatAdapter>();

async function start(adapter: HermesAcpProjectChatAdapter, overrides = {}) {
  if (!connectedAdapters.has(adapter)) {
    await adapter.refreshConnectionCatalogs();
    connectedAdapters.add(adapter);
  }
  return adapter.startThread({
    cwd: '/workspace/project',
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    modelId: HERMES_CONFIGURED_MODEL_ID,
    developerInstructions: 'Stay within the active project.',
    ...overrides,
  });
}

function notification(adapter: HermesAcpProjectChatAdapter, method: string) {
  return new Promise<Record<string, unknown>>((resolve) => {
    const listener = (event: { method?: string; params?: Record<string, unknown> }) => {
      if (event.method !== method || !event.params) return;
      adapter.off('notification', listener);
      resolve(event.params);
    };
    adapter.on('notification', listener);
  });
}

describe('Hermes ACP Project Chat adapter', () => {
  it('publishes Connected only after a real sealed ACP initialize and session handshake', async () => {
    const passing = fixture();
    await expect(passing.adapter.refreshConnectionCatalogs()).resolves.toMatchObject({
      catalog: { providerId: HERMES_PROVIDER_ID },
    });
    expect(passing.probeClients).toHaveLength(1);
    expect(passing.probeClients[0]!.close).toHaveBeenCalledOnce();

    const failing = fixture({ probeInitializeError: 'sealed_acp_startup_failed' });
    await expect(failing.adapter.refreshConnectionCatalogs()).rejects.toThrow(
      'sealed_acp_startup_failed',
    );
    expect(failing.probeClients).toHaveLength(1);
    expect(failing.probeClients[0]!.close).toHaveBeenCalledOnce();
    await expect(
      failing.adapter.startThread({
        cwd: '/workspace/project',
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        modelId: HERMES_CONFIGURED_MODEL_ID,
      }),
    ).rejects.toThrow('hermes_not_connected');
  });

  it('publishes only the validated ACP runtime and requires the real approval scope', async () => {
    const { adapter, clients, profiles, runtimeDiscovery } = fixture();
    const catalog = await adapter.listModelCatalog();

    expect(catalog.providerId).toBe(HERMES_PROVIDER_ID);
    expect(catalog.models).toEqual([
      expect.objectContaining({
        modelId: HERMES_CONFIGURED_MODEL_ID,
        displayName: `Hermes Agent · ${RUNTIME.configuredModelId}`,
        metadata: expect.objectContaining({
          runtime: 'byo-hermes-acp',
          agentTools: false,
          delegateTask: false,
        }),
      }),
    ]);
    await expect(
      adapter.startThread({ cwd: '/workspace/project', modelId: HERMES_CONFIGURED_MODEL_ID }),
    ).rejects.toThrow('hermes_approval_project_scope_required');
    expect(clients).toHaveLength(0);

    const started = await start(adapter);
    expect(started).toMatchObject({ providerId: HERMES_PROVIDER_ID });
    expect(started.threadId).toMatch(/^hermes:acp:thread:/u);
    expect(clients).toHaveLength(1);
    expect(clients[0]!.options).toMatchObject({
      executable: RUNTIME.pythonPath,
      args: [
        '-I',
        '-c',
        expect.any(String),
        RUNTIME.rootPath,
        RUNTIME.configuredModelId,
        RUNTIME.configuredProviderId,
        RUNTIME.routeFingerprint,
      ],
      environment: {
        HERMES_HOME: `/isolated/${PROJECT_ID}/${SESSION_ID}`,
        HERMES_SAFE_MODE: '1',
        GOSU_HERMES_CREDENTIAL_BINDING_KEY: expect.stringMatching(/^[a-f0-9]{64}$/u),
        GOSU_HERMES_EXPECTED_CREDENTIAL_PROOF: RUNTIME.credentialProof,
      },
      clientVersion: '0.30.2',
    });
    expect(profiles).toEqual([
      {
        runtime: expect.objectContaining({
          ...RUNTIME,
          credentialBindingKey: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      },
    ]);
    expect(runtimeDiscovery.resolutions).toHaveBeenCalledTimes(3);
  });

  it('runs a real ACP prompt, exposes sanitized invocation provenance, and never falls back', async () => {
    const { adapter, clients } = fixture();
    const { threadId } = await start(adapter);
    const itemCompleted = notification(adapter, 'item/completed');
    const turnCompleted = notification(adapter, 'turn/completed');
    const result = await adapter.runTurn({
      threadId,
      prompt: 'Analyze this project.',
      requestedModelId: HERMES_CONFIGURED_MODEL_ID,
      reasoningOptionId: null,
      cwd: '/workspace/project',
      collaborationModeId: 'plan',
      expectedCollaborationModeCatalogVersion: 'b'.repeat(64),
      outputSchema: { type: 'object' },
    });

    expect(result.invocation).toMatchObject({
      providerId: HERMES_PROVIDER_ID,
      requestedModelId: HERMES_CONFIGURED_MODEL_ID,
      resolvedModelId: RUNTIME.configuredModelId,
    });
    expect(clients[0]!.prompts[0]!.blocks.join('\n')).toContain('official Hermes ACP transport');
    expect(clients[0]!.prompts[0]!.blocks.join('\n')).toContain(
      'No native Hermes tools are available',
    );
    expect(clients[0]!.prompts[0]!.blocks.join('\n')).toContain('Analyze this project.');

    clients[0]!.finish(
      JSON.stringify({
        reply: 'Hermes completed the analysis.',
        actions: [],
        researchNote: { disposition: 'none' },
      }),
    );
    const item = (await itemCompleted).item as { text: string };
    expect(JSON.parse(item.text)).toEqual({
      reply: 'Hermes completed the analysis.',
      actions: [],
      researchNote: { disposition: 'none' },
    });
    expect((await turnCompleted).turn).toEqual({ id: result.turnId, status: 'completed' });
  });

  it('fails closed on every ACP tool permission request even during an active turn', async () => {
    const { adapter, approvals, clients } = fixture();
    const { threadId } = await start(adapter);
    const request = {
      sessionId: 'acp-session-1',
      toolCall: {
        toolCallId: 'tool-1',
        title: 'Delegate literature synthesis',
        kind: 'execute',
        status: 'pending',
        displayText: 'unexpected_native_tool --bounded',
        displayTextTruncated: false,
        displayTextUnsafe: false,
        editPreview: null,
      },
      options: [
        { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'session', name: 'Allow for session', kind: 'allow_session' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
    } as const;

    await expect(clients[0]!.requestPermission(request)).resolves.toEqual({
      outcome: 'cancelled',
    });
    expect(approvals.list(PROJECT_ID, SESSION_ID)).toEqual([]);

    const turnTerminal = notification(adapter, 'turn/completed');
    await adapter.runTurn({
      threadId,
      prompt: 'Delegate a bounded synthesis.',
      requestedModelId: HERMES_CONFIGURED_MODEL_ID,
      reasoningOptionId: null,
      cwd: '/workspace/project',
    });
    await expect(clients[0]!.requestPermission(request)).resolves.toEqual({
      outcome: 'cancelled',
    });
    expect(approvals.list(PROJECT_ID, SESSION_ID)).toEqual([]);

    clients[0]!.finish('Delegation complete.');
    await turnTerminal;
    await expect(clients[0]!.requestPermission(request)).resolves.toEqual({
      outcome: 'cancelled',
    });
    expect(approvals.list(PROJECT_ID, SESSION_ID)).toEqual([]);
  });

  it('retires a failed turn so late output and permission requests cannot contaminate another turn', async () => {
    const { adapter, approvals, clients } = fixture();
    const { threadId } = await start(adapter);
    const itemCompleted = vi.fn();
    adapter.on('notification', (event: { method?: string }) => {
      if (event.method === 'item/completed') itemCompleted();
    });
    const terminal = notification(adapter, 'turn/completed');
    await adapter.runTurn({
      threadId,
      prompt: 'This prompt will fail.',
      requestedModelId: HERMES_CONFIGURED_MODEL_ID,
      reasoningOptionId: null,
      cwd: '/workspace/project',
    });

    clients[0]!.fail();
    await expect(terminal).resolves.toMatchObject({ turn: { status: 'failed' } });
    expect(clients[0]!.terminateImmediately).toHaveBeenCalledOnce();
    clients[0]!.finish('Late text must be ignored.');
    expect(itemCompleted).not.toHaveBeenCalled();
    await expect(
      clients[0]!.requestPermission({
        sessionId: 'acp-session-1',
        toolCall: {
          toolCallId: 'late-tool',
          title: 'Late operation',
          kind: 'execute',
          status: 'pending',
          displayText: 'late-command',
          displayTextTruncated: false,
          displayTextUnsafe: false,
          editPreview: null,
        },
        options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }],
      }),
    ).resolves.toEqual({ outcome: 'cancelled' });
    expect(approvals.list(PROJECT_ID, SESSION_ID)).toEqual([]);
    await expect(
      adapter.runTurn({
        threadId,
        prompt: 'A retired process must not be reused.',
        requestedModelId: HERMES_CONFIGURED_MODEL_ID,
        reasoningOptionId: null,
        cwd: '/workspace/project',
      }),
    ).rejects.toThrow('hermes_acp_thread_not_found');
  });

  it('revalidates the configured runtime for every turn and fails without provider fallback', async () => {
    const { adapter, clients, runtimeDiscovery } = fixture();
    const { threadId } = await start(adapter);
    runtimeDiscovery.runtime = {
      ...RUNTIME,
      configuredModelId: 'provider/changed-outside-gosu',
      routeFingerprint: 'd'.repeat(64),
      sourceCatalogVersion: 'c'.repeat(64),
    };

    await expect(
      adapter.runTurn({
        threadId,
        prompt: 'This must never be routed elsewhere.',
        requestedModelId: HERMES_CONFIGURED_MODEL_ID,
        reasoningOptionId: null,
        cwd: '/workspace/project',
      }),
    ).rejects.toThrow('hermes_acp_runtime_changed');
    expect(clients[0]!.prompts).toHaveLength(0);
    expect(runtimeDiscovery.resolutions).toHaveBeenLastCalledWith(
      true,
      expect.stringMatching(/^[a-f0-9]{64}$/u),
    );
  });

  it('clears Connected state when fresh runtime resolution itself fails', async () => {
    const { adapter, clients, runtimeDiscovery } = fixture();
    const { threadId } = await start(adapter);
    const disconnected = vi.fn();
    adapter.on('disconnected', disconnected);
    runtimeDiscovery.resolutions.mockRejectedValueOnce(
      new Error('credential_pool_runtime_unavailable'),
    );

    await expect(
      adapter.runTurn({
        threadId,
        prompt: 'Never continue with stale credentials.',
        requestedModelId: HERMES_CONFIGURED_MODEL_ID,
        reasoningOptionId: null,
        cwd: '/workspace/project',
      }),
    ).rejects.toThrow('credential_pool_runtime_unavailable');

    expect(disconnected).toHaveBeenCalledOnce();
    expect(clients[0]!.terminateImmediately).toHaveBeenCalledOnce();
    await expect(adapter.listCollaborationModeCatalog(HERMES_CONFIGURED_MODEL_ID)).rejects.toThrow(
      'hermes_not_connected',
    );
  });

  it('keeps credential proofs out of catalogs and invocations while failing closed on rotation', async () => {
    const { adapter, clients, runtimeDiscovery } = fixture();
    const connected = await adapter.refreshConnectionCatalogs();
    const { threadId } = await adapter.startThread({
      cwd: '/workspace/project',
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      modelId: HERMES_CONFIGURED_MODEL_ID,
    });
    const firstTurn = await adapter.runTurn({
      threadId,
      prompt: 'Record the current route.',
      requestedModelId: HERMES_CONFIGURED_MODEL_ID,
      reasoningOptionId: null,
      cwd: '/workspace/project',
    });
    const firstTerminal = notification(adapter, 'turn/completed');
    clients[0]!.finish('Recorded.');
    await firstTerminal;

    const durableBefore = JSON.stringify({
      catalog: connected.catalog,
      invocation: firstTurn.invocation,
    });
    expect(durableBefore).not.toContain(RUNTIME.credentialProof);
    expect(durableBefore).not.toContain(RUNTIME.credentialBindingKey);
    expect(durableBefore).not.toContain('fixture-secret');

    runtimeDiscovery.runtime = { ...RUNTIME, credentialProof: 'f'.repeat(64) };
    await expect(
      adapter.runTurn({
        threadId,
        prompt: 'Must not continue under a rotated credential.',
        requestedModelId: HERMES_CONFIGURED_MODEL_ID,
        reasoningOptionId: null,
        cwd: '/workspace/project',
      }),
    ).rejects.toThrow('hermes_acp_runtime_changed');

    const after = await adapter.listModelCatalog();
    expect(after.catalogVersion).toBe(connected.catalog.catalogVersion);
    expect(JSON.stringify(after)).not.toContain('f'.repeat(64));
  });

  it('wraps an ordinary visible answer as advice-only and ignores non-message tool updates', async () => {
    const { adapter, clients } = fixture();
    const { threadId } = await start(adapter);
    const itemCompleted = notification(adapter, 'item/completed');
    await adapter.runTurn({
      threadId,
      prompt: 'Give concise advice.',
      requestedModelId: HERMES_CONFIGURED_MODEL_ID,
      reasoningOptionId: null,
      cwd: '/workspace/project',
    });
    clients[0]!.emitUpdate({
      sessionId: 'acp-session-1',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-private',
        title: 'Tool result',
        kind: 'execute',
        status: 'completed',
        contentBlockCount: 1,
        locationCount: 1,
      },
    });
    clients[0]!.finish('Visible Hermes advice.');

    const item = (await itemCompleted).item as { text: string };
    expect(JSON.parse(item.text)).toEqual({
      reply: 'Visible Hermes advice.',
      actions: [],
      researchNote: { disposition: 'none' },
    });
    expect(item.text).not.toContain('tool-private');
  });

  it('isolates concurrent sessions and performs bounded cancel, release, and shutdown', async () => {
    const { adapter, clients, runtimeDiscovery } = fixture();
    const first = await start(adapter);
    const second = await start(adapter, {
      projectId: '33333333-3333-4333-8333-333333333333',
      sessionId: '44444444-4444-4444-8444-444444444444',
      cwd: '/workspace/second',
    });
    const firstTerminal = notification(adapter, 'turn/completed');
    const firstTurn = await adapter.runTurn({
      threadId: first.threadId,
      prompt: 'First task',
      requestedModelId: HERMES_CONFIGURED_MODEL_ID,
      reasoningOptionId: null,
      cwd: '/workspace/project',
    });
    await adapter.runTurn({
      threadId: second.threadId,
      prompt: 'Second task',
      requestedModelId: HERMES_CONFIGURED_MODEL_ID,
      reasoningOptionId: null,
      cwd: '/workspace/second',
    });

    expect(clients).toHaveLength(2);
    await adapter.interruptTurn(first.threadId, firstTurn.turnId);
    expect(clients[0]!.cancels).toHaveBeenCalledWith('acp-session-1');
    expect((await firstTerminal).turn).toEqual({ id: firstTurn.turnId, status: 'interrupted' });
    expect(clients[0]!.terminateImmediately).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(clients[0]!.close).toHaveBeenCalledOnce());
    await adapter.releaseThread(first.threadId);
    expect(clients[0]!.close).toHaveBeenCalledOnce();
    expect(clients[1]!.close).not.toHaveBeenCalled();

    expect(adapter.shutdown()).toBe(2);
    expect(clients[1]!.terminateImmediately).toHaveBeenCalledOnce();
    expect(runtimeDiscovery.shutdown).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(clients[1]!.close).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(adapter.shutdown()).toBe(0));
  });

  it('retains an unconfirmed client so reset and shutdown can retry termination', async () => {
    const { adapter, clients, runtimeDiscovery } = fixture();
    const thread = await start(adapter);
    const client = clients[0]!;
    client.closeFailure = new Error('hermes_acp_kill_unconfirmed');

    await expect(adapter.releaseThread(thread.threadId)).rejects.toThrow(
      'hermes_acp_kill_unconfirmed',
    );
    expect(client.close).toHaveBeenCalledTimes(1);

    expect(adapter.shutdown()).toBe(2);
    await vi.waitFor(() => expect(client.close).toHaveBeenCalledTimes(2));
    expect(runtimeDiscovery.shutdown).toHaveBeenCalledOnce();
    expect(adapter.shutdown()).toBe(1);
    await vi.waitFor(() => expect(client.close).toHaveBeenCalledTimes(3));

    client.closeFailure = null;
    expect(adapter.shutdown()).toBe(1);
    await vi.waitFor(() => expect(client.close).toHaveBeenCalledTimes(4));
    await vi.waitFor(() => expect(adapter.shutdown()).toBe(0));
  });

  it('offers a bounded ephemeral delegation API with provenance and process cleanup', async () => {
    const { adapter, clients, runtimeDiscovery } = fixture();
    await adapter.refreshConnectionCatalogs();
    const delegated = adapter.delegate({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      cwd: '/workspace/project',
      task: 'Synthesize the experiment findings.',
      context: 'Only use the bounded supplied evidence.',
    });
    await vi.waitFor(() => expect(clients).toHaveLength(1));
    await vi.waitFor(() => expect(clients[0]!.prompts).toHaveLength(1));
    expect(runtimeDiscovery.resolutions).toHaveBeenLastCalledWith(
      true,
      expect.stringMatching(/^[a-f0-9]{64}$/u),
    );
    expect(clients[0]!.prompts[0]!.blocks.join('\n')).toContain('<gosu_delegated_goal>');
    expect(clients[0]!.prompts[0]!.blocks.join('\n')).toContain(
      'No native Hermes tools are available',
    );
    clients[0]!.finish('A bounded synthesis.');

    await expect(delegated).resolves.toEqual({
      reply: 'A bounded synthesis.',
      stopReason: 'end_turn',
      provenance: {
        invocationId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
        ),
        providerId: HERMES_PROVIDER_ID,
        transport: 'acp-v1',
        resolvedModelId: RUNTIME.configuredModelId,
        configuredProviderId: RUNTIME.configuredProviderId,
        catalogVersion: expect.stringMatching(/^[0-9a-f]{64}$/u),
        agentName: 'hermes-agent',
        agentVersion: '0.19.1',
        startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
      },
    });
    expect(clients[0]!.close).toHaveBeenCalledOnce();
  });

  it('cancels delegation during startup and force-terminates live delegation on shutdown', async () => {
    const abortedFixture = fixture();
    await abortedFixture.adapter.refreshConnectionCatalogs();
    const controller = new AbortController();
    const aborted = abortedFixture.adapter.delegate({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      cwd: '/workspace/project',
      task: 'Do not start after cancellation.',
      signal: controller.signal,
    });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ code: 'hermes_delegate_aborted' });

    const liveFixture = fixture();
    await liveFixture.adapter.refreshConnectionCatalogs();
    const live = liveFixture.adapter.delegate({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      cwd: '/workspace/project',
      task: 'Remain active until shutdown.',
    });
    await vi.waitFor(() => expect(liveFixture.clients).toHaveLength(1));
    await vi.waitFor(() => expect(liveFixture.clients[0]!.prompts).toHaveLength(1));
    expect(liveFixture.adapter.shutdown()).toBe(2);
    expect(liveFixture.clients[0]!.terminateImmediately).toHaveBeenCalledOnce();
    await expect(live).rejects.toThrow('fake_acp_terminated');
    expect(liveFixture.clients[0]!.close).toHaveBeenCalledTimes(2);
  });
});
