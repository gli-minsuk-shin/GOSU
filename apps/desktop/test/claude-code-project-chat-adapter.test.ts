import { describe, expect, it, vi } from 'vitest';

import {
  CLAUDE_CODE_OPUS_MODEL_ID,
  CLAUDE_CODE_OPUS_5_MODEL_ID,
  CLAUDE_CODE_OPUS_5_UPSTREAM_MODEL_ID,
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_CODE_SONNET_MODEL_ID,
  ClaudeCodeProjectChatAdapter,
  type ClaudeCodeProjectChatPlatform,
} from '../src/main/claude-code-project-chat-adapter';

function fixture(authMethod = 'claude.ai') {
  let resolveTurn!: (value: Readonly<{ stdout: string; stderr: string }>) => void;
  let rejectTurn!: (reason?: unknown) => void;
  const turnPromise = new Promise<Readonly<{ stdout: string; stderr: string }>>(
    (resolve, reject) => {
      resolveTurn = resolve;
      rejectTurn = reject;
    },
  );
  const requests: Parameters<ClaudeCodeProjectChatPlatform['run']>[0][] = [];
  const platform: ClaudeCodeProjectChatPlatform = {
    locateExecutable: vi.fn(async () => '/Users/test/.local/bin/claude'),
    run: vi.fn(async (request) => {
      requests.push(request);
      if (request.args[0] === '--version') {
        return { stdout: '2.1.169 (Claude Code)\n', stderr: '' };
      }
      if (request.args[0] === 'auth') {
        return {
          stdout: JSON.stringify({
            loggedIn: true,
            authMethod,
            apiProvider: 'firstParty',
            subscriptionType: 'pro',
          }),
          stderr: '',
        };
      }
      return turnPromise;
    }),
  };
  return {
    adapter: new ClaudeCodeProjectChatAdapter(platform),
    platform,
    requests,
    turn: { resolve: resolveTurn, reject: rejectTurn },
  };
}

async function nextTask() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ClaudeCodeProjectChatAdapter', () => {
  it('connects only a local claude.ai subscription and publishes pinned Sonnet, Opus 4.8, and Opus 5 models', async () => {
    const { adapter } = fixture();
    const connected = await adapter.refreshConnectionCatalogs();

    expect(connected.catalog.providerId).toBe(CLAUDE_CODE_PROVIDER_ID);
    expect(connected.catalog.models.map((model) => model.modelId)).toEqual([
      CLAUDE_CODE_SONNET_MODEL_ID,
      CLAUDE_CODE_OPUS_MODEL_ID,
      CLAUDE_CODE_OPUS_5_MODEL_ID,
    ]);
    expect(connected.catalog.models.map((model) => model.displayName)).toEqual([
      'Claude Code · Sonnet 4.6 (subscription)',
      'Claude Code · Opus 4.8 (subscription)',
      'Claude Code · Opus 5 (subscription)',
    ]);
    expect(connected.catalog.models.every((model) => model.isDefault === false)).toBe(true);
    expect(connected.catalog.models[0]?.metadata).toMatchObject({
      runtime: 'byo-local-subscription-cli',
      subscriptionType: 'pro',
      nativeTools: ['GOSU project-scoped MCP'],
    });
    expect(connected.collaborationModes.modes.map((mode) => mode.id)).toEqual(['default', 'plan']);
  });

  it('rejects API-key authentication instead of silently charging a metered provider', async () => {
    const { adapter } = fixture('apiKey');

    await expect(adapter.refreshConnectionCatalogs()).rejects.toThrow(
      'claude_code_subscription_required',
    );
    await expect(adapter.listModelCatalog()).rejects.toThrow('claude_code_not_connected');
  });

  it('runs a sealed MCP-enabled agent turn and emits the Project Chat response and usage protocol', async () => {
    const { adapter, requests, turn } = fixture();
    await adapter.refreshConnectionCatalogs();
    const notifications: unknown[] = [];
    const invocations: unknown[] = [];
    const usage: unknown[] = [];
    adapter.on('notification', (event) => notifications.push(event));
    adapter.on('invocation', (event) => invocations.push(event));
    adapter.on('usage', (event) => usage.push(event));
    const started = await adapter.startThread({
      cwd: '/tmp/gosu-project',
      modelId: CLAUDE_CODE_OPUS_5_MODEL_ID,
      developerInstructions: 'Keep project rules active.',
      dynamicTools: [
        {
          type: 'namespace',
          name: 'gosu_project',
          description: 'Bounded project tools',
          tools: [
            {
              type: 'function',
              name: 'read_workspace',
              description: 'Read bounded workspace state',
              inputSchema: { type: 'object' },
            },
          ],
        },
      ],
      dynamicToolHandler: vi.fn(async () => ({ contentItems: [], success: true })),
    });
    const running = await adapter.runTurn({
      threadId: started.threadId,
      prompt: 'Explain the evidence.',
      requestedModelId: CLAUDE_CODE_OPUS_5_MODEL_ID,
      reasoningOptionId: 'xhigh',
      cwd: '/tmp/gosu-project',
      outputSchema: { type: 'object' },
      collaborationModeId: 'default',
      expectedCollaborationModeCatalogVersion: (
        await adapter.listCollaborationModeCatalog(CLAUDE_CODE_OPUS_5_MODEL_ID)
      ).catalogVersion,
    });

    const execution = requests.at(-1);
    expect(execution?.args).toEqual(
      expect.arrayContaining([
        '-p',
        '--output-format',
        'json',
        '--model',
        CLAUDE_CODE_OPUS_5_UPSTREAM_MODEL_ID,
        '--effort',
        'xhigh',
        '--tools',
        'mcp__gosu_project__*',
        '--allowedTools',
        'mcp__gosu_project__*',
        '--max-turns',
        '12',
        '--setting-sources',
        '',
        '--no-session-persistence',
        '--json-schema',
      ]),
    );
    expect(execution?.stdin).toBe('Explain the evidence.');
    expect(invocations).toHaveLength(1);
    expect(running.invocation).toMatchObject({
      providerId: CLAUDE_CODE_PROVIDER_ID,
      resolvedModelId: CLAUDE_CODE_OPUS_5_UPSTREAM_MODEL_ID,
    });

    turn.resolve({
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        structured_output: {
          reply: 'Evidence explained.',
          actions: [],
          researchNote: { disposition: 'none' },
        },
        usage: { input_tokens: 12, output_tokens: 7 },
      }),
      stderr: '',
    });
    await nextTask();

    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toMatchObject({
      method: 'item/completed',
      params: { threadId: started.threadId, turnId: running.turnId },
    });
    expect(notifications[1]).toMatchObject({
      method: 'turn/completed',
      params: { turn: { id: running.turnId, status: 'completed' } },
    });
    expect(usage).toEqual([
      expect.objectContaining({
        providerId: CLAUDE_CODE_PROVIDER_ID,
        usage: expect.objectContaining({ inputTokens: 12, outputTokens: 7, totalTokens: 19 }),
      }),
    ]);
    await adapter.releaseThread(started.threadId);
  });

  it('aborts the exact active Claude process when Project Chat stops a turn', async () => {
    const { adapter, requests } = fixture();
    await adapter.refreshConnectionCatalogs();
    const notifications: unknown[] = [];
    adapter.on('notification', (event) => notifications.push(event));
    const started = await adapter.startThread({
      cwd: '/tmp/gosu-project',
      modelId: CLAUDE_CODE_SONNET_MODEL_ID,
    });
    const running = await adapter.runTurn({
      threadId: started.threadId,
      prompt: 'Long task',
      requestedModelId: CLAUDE_CODE_SONNET_MODEL_ID,
      reasoningOptionId: 'high',
      cwd: '/tmp/gosu-project',
    });

    await adapter.interruptTurn(started.threadId, running.turnId);

    expect(requests.at(-1)?.signal.aborted).toBe(true);
    expect(notifications).toEqual([
      expect.objectContaining({
        method: 'turn/completed',
        params: expect.objectContaining({ turn: { id: running.turnId, status: 'interrupted' } }),
      }),
    ]);
  });
});
