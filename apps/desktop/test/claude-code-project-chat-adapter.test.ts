import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applicationLanguageContext } from '../src/main/application-language-service';

import {
  CLAUDE_CODE_OPUS_MODEL_ID,
  CLAUDE_CODE_OPUS_5_MODEL_ID,
  CLAUDE_CODE_OPUS_5_UPSTREAM_MODEL_ID,
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_CODE_SONNET_MODEL_ID,
  ClaudeCodeProjectChatAdapter,
  createNodeClaudeCodeProjectChatPlatform,
  claudeReportedContextWindow,
  type ClaudeCodeProjectChatPlatform,
} from '../src/main/claude-code-project-chat-adapter';

function deferredTurn() {
  let resolveTurn!: (value: Readonly<{ stdout: string; stderr: string }>) => void;
  let rejectTurn!: (reason?: unknown) => void;
  const turnPromise = new Promise<Readonly<{ stdout: string; stderr: string }>>(
    (resolve, reject) => {
      resolveTurn = resolve;
      rejectTurn = reject;
    },
  );
  return { promise: turnPromise, resolve: resolveTurn, reject: rejectTurn };
}

function fixture(authMethod = 'claude.ai') {
  const turn = deferredTurn();
  const turns: ReturnType<typeof deferredTurn>[] = [];
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
      const pending = turns.length ? deferredTurn() : turn;
      turns.push(pending);
      return pending.promise;
    }),
  };
  return {
    adapter: new ClaudeCodeProjectChatAdapter(platform),
    platform,
    requests,
    turn,
    turns,
  };
}

async function nextTask() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ClaudeCodeProjectChatAdapter', () => {
  it('reports only the matching native model context window, not another model or a made-up default', () => {
    expect(
      claudeReportedContextWindow(
        {
          opus: { canonicalModel: 'claude-opus-5', contextWindow: 1000000 },
          other: { contextWindow: 200000 },
        },
        'claude-opus-5',
      ),
    ).toBe(1000000);
    expect(
      claudeReportedContextWindow({ other: { contextWindow: 200000 } }, 'claude-opus-5'),
    ).toBeNull();
    expect(
      claudeReportedContextWindow({ 'claude-opus-5': { contextWindow: -1 } }, 'claude-opus-5'),
    ).toBeNull();
  });
  it('pins the explicit language at the trusted system boundary without changing user input', async () => {
    const { adapter, requests } = fixture();
    await adapter.refreshConnectionCatalogs();
    const thread = await applicationLanguageContext.run({ language: 'ko', configured: true }, () =>
      adapter.startThread({
        cwd: '/tmp/gosu-project',
        modelId: CLAUDE_CODE_SONNET_MODEL_ID,
        developerInstructions: 'Authorized project only.',
      }),
    );
    await applicationLanguageContext.run({ language: 'en', configured: true }, () =>
      adapter.runTurn({
        threadId: thread.threadId,
        cwd: '/tmp/gosu-project',
        requestedModelId: CLAUDE_CODE_SONNET_MODEL_ID,
        reasoningOptionId: null,
        prompt: 'Explain H3 = concat(H1, H2).',
      }),
    );
    const execution = requests.at(-1)!;
    expect(execution.args[execution.args.indexOf('--append-system-prompt') + 1]).toContain(
      'Korean (한국어)',
    );
    expect(execution.stdin).toBe('Explain H3 = concat(H1, H2).');
    await adapter.releaseThread(thread.threadId);
  });
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
    expect(connected.catalog.models.every((model) => model.contextWindowTokens === 1_000_000)).toBe(
      true,
    );
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
        '--session-id',
        '--json-schema',
      ]),
    );
    expect(execution?.args).not.toContain('--no-session-persistence');
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

  it('resumes only the successful owned native session and retains it across unchanged catalog refreshes', async () => {
    const { adapter, requests, turns } = fixture();
    await adapter.refreshConnectionCatalogs();
    const thread = await adapter.startThread({
      cwd: '/tmp/gosu-project',
      modelId: CLAUDE_CODE_SONNET_MODEL_ID,
      developerInstructions: 'Stable project instructions.',
    });
    const input = {
      threadId: thread.threadId,
      cwd: '/tmp/gosu-project',
      requestedModelId: CLAUDE_CODE_SONNET_MODEL_ID,
      prompt: 'Remember the first task.',
      reasoningOptionId: null,
    };
    await adapter.runTurn(input);
    const first = requests.at(-1)!;
    const ownedId = first.args[first.args.indexOf('--session-id') + 1];
    expect(ownedId).toMatch(/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/);
    expect(first.args).not.toContain('--resume');
    turns[0]!.resolve({
      stdout: JSON.stringify({ result: 'Remembered.', session_id: ownedId }),
      stderr: '',
    });
    await nextTask();
    await adapter.refreshConnectionCatalogs();
    await adapter.runTurn({ ...input, prompt: 'Continue it.' });
    const second = requests.at(-1)!;
    expect(second.args).toContain('--resume');
    expect(second.args[second.args.indexOf('--resume') + 1]).toBe(ownedId);
    expect(second.args).not.toContain('--session-id');
    expect(second.args).not.toContain('--continue');
    expect(second.stdin).toBe('Continue it.');
    expect(second.args[second.args.indexOf('--append-system-prompt') + 1]).toBe(
      first.args[first.args.indexOf('--append-system-prompt') + 1],
    );
    await adapter.releaseThread(thread.threadId);
  });

  it('isolates parallel threads and rejects changes to model or working directory', async () => {
    const { adapter, requests, turns } = fixture();
    await adapter.refreshConnectionCatalogs();
    const a = await adapter.startThread({
      cwd: '/tmp/gosu-project',
      modelId: CLAUDE_CODE_SONNET_MODEL_ID,
      developerInstructions: 'Scope A',
    });
    const b = await adapter.startThread({
      cwd: '/tmp/gosu-project',
      modelId: CLAUDE_CODE_SONNET_MODEL_ID,
      developerInstructions: 'Scope B',
    });
    const input = {
      cwd: '/tmp/gosu-project',
      requestedModelId: CLAUDE_CODE_SONNET_MODEL_ID,
      prompt: 'Investigate this project.',
      reasoningOptionId: null,
    };
    await adapter.runTurn({ ...input, threadId: a.threadId });
    const first = requests.at(-1)!;
    const firstId = first.args[first.args.indexOf('--session-id') + 1];
    await adapter.runTurn({ ...input, threadId: b.threadId });
    const second = requests.at(-1)!;
    const secondId = second.args[second.args.indexOf('--session-id') + 1];
    expect(secondId).not.toBe(firstId);
    for (const [index, id] of [firstId, secondId].entries()) {
      turns[index]!.resolve({
        stdout: JSON.stringify({ result: 'Done.', session_id: id }),
        stderr: '',
      });
    }
    await nextTask();
    await expect(
      adapter.runTurn({ ...input, threadId: a.threadId, cwd: '/tmp/other' }),
    ).rejects.toThrow('claude_code_thread_scope_mismatch');
    await expect(
      adapter.runTurn({
        ...input,
        threadId: a.threadId,
        requestedModelId: CLAUDE_CODE_OPUS_MODEL_ID,
      }),
    ).rejects.toThrow('claude_code_thread_scope_mismatch');
    await adapter.runTurn({ ...input, threadId: b.threadId });
    const resumed = requests.at(-1)!;
    expect(resumed.args[resumed.args.indexOf('--resume') + 1]).toBe(secondId);
    expect(resumed.args).not.toContain(firstId);
    expect(resumed.args[resumed.args.indexOf('--append-system-prompt') + 1]).toContain('Scope B');
    await adapter.releaseThread(a.threadId);
    await adapter.releaseThread(b.threadId);
  });

  it.each(['process failure', 'error result', 'missing session', 'foreign session'])(
    'starts fresh after a first turn with %s',
    async (outcome) => {
      const { adapter, requests, turns } = fixture();
      await adapter.refreshConnectionCatalogs();
      const thread = await adapter.startThread({
        cwd: '/tmp/gosu-project',
        modelId: CLAUDE_CODE_SONNET_MODEL_ID,
      });
      const input = {
        threadId: thread.threadId,
        cwd: '/tmp/gosu-project',
        requestedModelId: CLAUDE_CODE_SONNET_MODEL_ID,
        prompt: 'Start.',
        reasoningOptionId: null,
      };
      await adapter.runTurn(input);
      const first = requests.at(-1)!;
      const firstId = first.args[first.args.indexOf('--session-id') + 1];
      if (outcome === 'process failure') turns[0]!.reject(new Error('process failed'));
      else
        turns[0]!.resolve({
          stdout: JSON.stringify({
            result: 'Partial result.',
            is_error: outcome === 'error result',
            ...(outcome === 'error result' ? { session_id: firstId } : {}),
            ...(outcome === 'foreign session' ? { session_id: 'unowned-session' } : {}),
          }),
          stderr: '',
        });
      await nextTask();
      await adapter.runTurn(input);
      const second = requests.at(-1)!;
      expect(second.args).not.toContain('--resume');
      expect(second.args[second.args.indexOf('--session-id') + 1]).not.toBe(firstId);
      await adapter.releaseThread(thread.threadId);
    },
  );

  it('forgets an interrupted continuation even if its late process result reports success', async () => {
    const { adapter, requests, turns } = fixture();
    await adapter.refreshConnectionCatalogs();
    const thread = await adapter.startThread({
      cwd: '/tmp/gosu-project',
      modelId: CLAUDE_CODE_SONNET_MODEL_ID,
    });
    const input = {
      threadId: thread.threadId,
      cwd: '/tmp/gosu-project',
      requestedModelId: CLAUDE_CODE_SONNET_MODEL_ID,
      prompt: 'Work.',
      reasoningOptionId: null,
    };
    await adapter.runTurn(input);
    const first = requests.at(-1)!;
    const id = first.args[first.args.indexOf('--session-id') + 1];
    turns[0]!.resolve({ stdout: JSON.stringify({ result: 'Done.', session_id: id }), stderr: '' });
    await nextTask();
    const interrupted = await adapter.runTurn(input);
    await adapter.interruptTurn(thread.threadId, interrupted.turnId);
    turns[1]!.resolve({ stdout: JSON.stringify({ result: 'Late.', session_id: id }), stderr: '' });
    await nextTask();
    await adapter.runTurn(input);
    const third = requests.at(-1)!;
    expect(third.args).not.toContain('--resume');
    expect(third.args[third.args.indexOf('--session-id') + 1]).not.toBe(id);
    await adapter.releaseThread(thread.threadId);
  });

  it('returns the caller schema unchanged for Model Lab instead of coercing it into Project Chat actions', async () => {
    const { adapter, turn } = fixture();
    await adapter.refreshConnectionCatalogs();
    const notifications: unknown[] = [];
    adapter.on('notification', (event) => notifications.push(event));
    const thread = await adapter.startThread({
      cwd: '/tmp/gosu-project',
      modelId: CLAUDE_CODE_SONNET_MODEL_ID,
    });
    await adapter.runTurn({
      threadId: thread.threadId,
      cwd: '/tmp/gosu-project',
      requestedModelId: CLAUDE_CODE_SONNET_MODEL_ID,
      prompt: 'Describe the module.',
      reasoningOptionId: null,
      outputSchema: { type: 'object', properties: { answer: { type: 'string' } } },
    });
    const answer = { answer: 'The module applies FiLM.', editInstructions: null };
    turn.resolve({ stdout: JSON.stringify({ structured_output: answer }), stderr: '' });
    await nextTask();
    expect(notifications[0]).toMatchObject({
      method: 'item/completed',
      params: { item: { text: JSON.stringify(answer) } },
    });
    await adapter.releaseThread(thread.threadId);
  });

  it('attaches only explicitly supplied image bytes through native stream-json without enabling Read or Bash', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'gosu-claude-image-'));
    const image = join(folder, 'diagram.png');
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3X8AAAAASUVORK5CYII=',
      'base64',
    );
    await writeFile(image, bytes);
    const { adapter, requests } = fixture();
    try {
      await adapter.refreshConnectionCatalogs();
      const thread = await adapter.startThread({
        cwd: folder,
        modelId: CLAUDE_CODE_SONNET_MODEL_ID,
      });
      await adapter.runTurn({
        threadId: thread.threadId,
        cwd: folder,
        requestedModelId: CLAUDE_CODE_SONNET_MODEL_ID,
        prompt: 'Inspect this diagram.',
        reasoningOptionId: null,
        localImagePaths: [image],
      });
      const execution = requests.at(-1)!;
      expect(execution.args).toContain('--input-format');
      expect(execution.args[execution.args.indexOf('--input-format') + 1]).toBe('stream-json');
      expect(execution.args[execution.args.indexOf('--tools') + 1]).toBe('');
      expect(JSON.parse(execution.stdin!)).toEqual({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: bytes.toString('base64') },
            },
            { type: 'text', text: 'Inspect this diagram.' },
          ],
        },
      });
      await adapter.releaseThread(thread.threadId);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('rejects non-image file bytes before starting a provider invocation', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'gosu-claude-image-'));
    const image = join(folder, 'not-an-image.png');
    await writeFile(image, 'print("not an image")');
    const { adapter, requests } = fixture();
    try {
      await adapter.refreshConnectionCatalogs();
      const thread = await adapter.startThread({
        cwd: folder,
        modelId: CLAUDE_CODE_SONNET_MODEL_ID,
      });
      await expect(
        adapter.runTurn({
          threadId: thread.threadId,
          cwd: folder,
          requestedModelId: CLAUDE_CODE_SONNET_MODEL_ID,
          prompt: 'Inspect.',
          reasoningOptionId: null,
          localImagePaths: [image],
        }),
      ).rejects.toThrow('claude_code_image_format_unsupported');
      expect(requests.filter((request) => request.args[0] === '-p')).toHaveLength(0);
      await adapter.releaseThread(thread.threadId);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it.each([401, undefined])(
    'reports expired OAuth as a safe actionable code (status %s) and starts a new session',
    async (status) => {
      const { adapter, requests, turns } = fixture();
      await adapter.refreshConnectionCatalogs();
      const notifications: unknown[] = [];
      adapter.on('notification', (event) => notifications.push(event));
      const thread = await adapter.startThread({
        cwd: '/tmp/gosu-project',
        modelId: CLAUDE_CODE_SONNET_MODEL_ID,
      });
      const input = {
        threadId: thread.threadId,
        cwd: '/tmp/gosu-project',
        requestedModelId: CLAUDE_CODE_SONNET_MODEL_ID,
        reasoningOptionId: null,
        prompt: 'Read project status.',
      };
      await adapter.runTurn(input);
      const first = requests.at(-1)!;
      const sessionId = first.args[first.args.indexOf('--session-id') + 1];
      turns[0]!.resolve({
        stdout: JSON.stringify({
          is_error: true,
          api_error_status: status,
          session_id: sessionId,
          result:
            'OAuth access token has expired. Re-authenticate to continue. PRIVATE_PROVIDER_CONTENT',
        }),
        stderr: 'PRIVATE_STDERR',
      });
      await nextTask();
      expect(notifications).toEqual([
        {
          method: 'turn/completed',
          params: {
            threadId: thread.threadId,
            turn: {
              id: expect.any(String),
              status: 'failed',
              error: { message: 'claude_code_auth_required' },
            },
          },
        },
      ]);
      expect(JSON.stringify(notifications)).not.toContain('PRIVATE');
      await adapter.runTurn(input);
      const next = requests.at(-1)!;
      expect(next.args).not.toContain('--resume');
      expect(next.args[next.args.indexOf('--session-id') + 1]).not.toBe(sessionId);
      await adapter.releaseThread(thread.threadId);
    },
  );

  it('maps exit-one CLI authentication JSON without exposing stdout or stderr', async () => {
    const platform = createNodeClaudeCodeProjectChatPlatform();
    await expect(
      platform.run({
        executable: process.execPath,
        args: [
          '-e',
          'process.stdout.write(JSON.stringify({is_error:true,api_error_status:401,result:"PRIVATE_PROVIDER_CONTENT"}));process.stderr.write("PRIVATE_STDERR");process.exitCode=1;',
        ],
        stdin: null,
        cwd: tmpdir(),
        signal: new AbortController().signal,
        timeoutMs: 5_000,
        maxOutputBytes: 4096,
      }),
    ).rejects.toThrow(/^claude_code_auth_required$/);
  });

  it.each([
    ['claude_code_timeout', 'claude_code_timeout'],
    ['Untrusted provider failure with PRIVATE_CONTENT', 'claude_code_failed'],
  ])('reports safe failure code for %s', async (failure, expectedCode) => {
    const { adapter, turn } = fixture();
    await adapter.refreshConnectionCatalogs();
    const notifications: unknown[] = [];
    adapter.on('notification', (event) => notifications.push(event));
    const thread = await adapter.startThread({
      cwd: '/tmp/gosu-project',
      modelId: CLAUDE_CODE_SONNET_MODEL_ID,
    });
    await adapter.runTurn({
      threadId: thread.threadId,
      cwd: '/tmp/gosu-project',
      requestedModelId: CLAUDE_CODE_SONNET_MODEL_ID,
      reasoningOptionId: null,
      prompt: 'Work.',
    });
    turn.reject(new Error(failure));
    await nextTask();
    expect(notifications[0]).toMatchObject({
      method: 'turn/completed',
      params: { turn: { status: 'failed', error: { message: expectedCode } } },
    });
    expect(JSON.stringify(notifications)).not.toContain('PRIVATE');
    await adapter.releaseThread(thread.threadId);
  });
});
