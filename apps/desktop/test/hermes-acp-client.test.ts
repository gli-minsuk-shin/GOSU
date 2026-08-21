import { describe, expect, it, vi } from 'vitest';

import {
  HermesAcpClient,
  type HermesAcpManagedProcess,
  type HermesAcpPermissionDecision,
  type HermesAcpPermissionRequest,
  type HermesAcpPlatform,
  type HermesAcpSpawnInput,
} from '../src/main/hermes-acp-client';

type JsonRpcFrame = Record<string, unknown>;

class FakeManagedProcess implements HermesAcpManagedProcess {
  readonly pid = 4_242;
  readonly writes: string[] = [];
  private readonly stdoutListeners: ((chunk: Buffer | string) => void)[] = [];
  private readonly stderrListeners: ((chunk: Buffer | string) => void)[] = [];
  private readonly errorListeners: (() => void)[] = [];
  private readonly exitListeners: ((code: number | null, signal: NodeJS.Signals | null) => void)[] =
    [];
  private inputEnded = false;
  private exited = false;

  onStdout(listener: (chunk: Buffer | string) => void) {
    this.stdoutListeners.push(listener);
  }

  onStderr(listener: (chunk: Buffer | string) => void) {
    this.stderrListeners.push(listener);
  }

  onError(listener: () => void) {
    this.errorListeners.push(listener);
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void) {
    this.exitListeners.push(listener);
  }

  async write(line: string) {
    if (this.inputEnded) throw new Error('fake_stdin_closed');
    this.writes.push(line);
  }

  endInput() {
    this.inputEnded = true;
  }

  kill() {
    return true;
  }

  emitJson(frame: JsonRpcFrame) {
    this.emitStdout(`${JSON.stringify(frame)}\n`);
  }

  emitStdout(value: Buffer | string) {
    for (const listener of this.stdoutListeners) listener(value);
  }

  emitStderr(value: Buffer | string) {
    for (const listener of this.stderrListeners) listener(value);
  }

  emitError() {
    for (const listener of this.errorListeners) listener();
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null) {
    if (this.exited) return;
    this.exited = true;
    for (const listener of this.exitListeners) listener(code, signal);
  }

  frames() {
    return this.writes.map((line) => JSON.parse(line) as JsonRpcFrame);
  }

  request(method: string) {
    return this.frames().findLast((frame) => frame.method === method);
  }
}

class FakePlatform implements HermesAcpPlatform {
  readonly process = new FakeManagedProcess();
  readonly spawns: HermesAcpSpawnInput[] = [];
  readonly signals: NodeJS.Signals[] = [];
  exitOnTerminate = true;

  spawn(input: HermesAcpSpawnInput) {
    this.spawns.push(input);
    return this.process;
  }

  terminateProcessGroup(_process: HermesAcpManagedProcess, signal: NodeJS.Signals) {
    this.signals.push(signal);
    if (this.exitOnTerminate) queueMicrotask(() => this.process.emitExit(null, signal));
  }
}

function createClient(
  platform: FakePlatform,
  permissionHandler: (
    request: HermesAcpPermissionRequest,
  ) => Promise<HermesAcpPermissionDecision> = async () => ({ outcome: 'cancelled' }),
  overrides: Partial<ConstructorParameters<typeof HermesAcpClient>[0]> = {},
) {
  return new HermesAcpClient({
    platform,
    permissionHandler,
    environment: { HOME: '/Users/researcher', PATH: '/usr/bin:/bin' },
    ...overrides,
  });
}

async function initialize(client: HermesAcpClient, process: FakeManagedProcess) {
  const result = client.initialize();
  const request = process.request('initialize');
  expect(request).toBeDefined();
  process.emitJson({
    jsonrpc: '2.0',
    id: request!.id,
    result: {
      protocolVersion: 1,
      agentInfo: { name: 'hermes-agent', version: '0.19.1' },
      agentCapabilities: { secretFutureField: 'not returned by the client' },
    },
  });
  return result;
}

async function createSession(
  client: HermesAcpClient,
  process: FakeManagedProcess,
  sessionId = 'session-1',
) {
  const result = client.createSession('/workspace/research');
  await vi.waitFor(() => expect(process.request('session/new')).toBeDefined());
  const request = process.request('session/new')!;
  process.emitJson({ jsonrpc: '2.0', id: request.id, result: { sessionId } });
  return result;
}

describe('Hermes ACP client', () => {
  it('keeps one Hermes process, negotiates ACP v1, creates a bounded session, and prompts with text blocks', async () => {
    const platform = new FakePlatform();
    const client = createClient(platform);

    await expect(initialize(client, platform.process)).resolves.toEqual({
      protocolVersion: 1,
      agentName: 'hermes-agent',
      agentVersion: '0.19.1',
    });
    await expect(client.initialize()).resolves.toEqual({
      protocolVersion: 1,
      agentName: 'hermes-agent',
      agentVersion: '0.19.1',
    });
    expect(platform.spawns).toHaveLength(1);
    expect(platform.spawns[0]).toMatchObject({
      executable: 'hermes',
      args: ['acp'],
      environment: expect.objectContaining({
        HOME: '/Users/researcher',
        HERMES_ACP_SKIP_CONFIGURED_MCP: '1',
      }),
    });
    expect(platform.process.request('initialize')?.params).toEqual({
      protocolVersion: 1,
      clientCapabilities: {
        auth: { terminal: false },
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: 'gosu', title: 'GOSU', version: '0.1.0' },
    });

    await expect(createSession(client, platform.process)).resolves.toEqual({
      sessionId: 'session-1',
    });
    expect(platform.process.request('session/new')?.params).toEqual({
      cwd: '/workspace/research',
      mcpServers: [],
    });

    const prompt = client.prompt('session-1', ['First block', 'Second block']);
    await vi.waitFor(() => expect(platform.process.request('session/prompt')).toBeDefined());
    const promptRequest = platform.process.request('session/prompt')!;
    expect(promptRequest.params).toEqual({
      sessionId: 'session-1',
      prompt: [
        { type: 'text', text: 'First block' },
        { type: 'text', text: 'Second block' },
      ],
    });
    platform.process.emitJson({
      jsonrpc: '2.0',
      id: promptRequest.id,
      result: { stopReason: 'end_turn', privateResult: 'must-not-escape' },
    });
    await expect(prompt).resolves.toEqual({ stopReason: 'end_turn' });

    await client.cancel('session-1');
    expect(platform.process.frames()).toContainEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'session-1' },
    });
    await client.close();
    expect(platform.signals).toEqual(['SIGTERM']);
    expect(client.state).toBe('closed');
  });

  it('preserves only validated prompt-result usage and never reinterprets context usage updates', async () => {
    const platform = new FakePlatform();
    const client = createClient(platform);
    const updates: unknown[] = [];
    client.on('sessionUpdate', (update) => updates.push(update));
    await initialize(client, platform.process);
    await createSession(client, platform.process);

    platform.process.emitJson({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'session-1',
        update: { sessionUpdate: 'usage_update', used: 9_999, size: 10_000 },
      },
    });
    expect(updates).toEqual([
      { sessionId: 'session-1', update: { sessionUpdate: 'usage_update', usage: {} } },
    ]);

    const prompt = client.prompt('session-1', 'Count this prompt');
    await vi.waitFor(() => expect(platform.process.request('session/prompt')).toBeDefined());
    const request = platform.process.request('session/prompt')!;
    platform.process.emitJson({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        stopReason: 'end_turn',
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          cachedReadTokens: 40,
          thoughtTokens: 5,
          privateCost: 123,
        },
      },
    });
    await expect(prompt).resolves.toEqual({
      stopReason: 'end_turn',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cachedReadTokens: 40,
        cachedWriteTokens: null,
        reasoningOutputTokens: 5,
      },
    });

    const invalidPrompt = client.prompt('session-1', 'Reject overlapping cache totals');
    await vi.waitFor(() =>
      expect(
        platform.process.frames().filter((frame) => frame.method === 'session/prompt'),
      ).toHaveLength(2),
    );
    const invalidRequest = platform.process
      .frames()
      .filter((frame) => frame.method === 'session/prompt')[1]!;
    platform.process.emitJson({
      jsonrpc: '2.0',
      id: invalidRequest.id,
      result: {
        stopReason: 'end_turn',
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          cachedReadTokens: 70,
          cachedWriteTokens: 40,
        },
      },
    });
    await expect(invalidPrompt).resolves.toEqual({ stopReason: 'end_turn' });
    await client.close();
  });

  it('emits allowlisted session updates without raw tool payloads, metadata, paths, or output', async () => {
    const platform = new FakePlatform();
    const client = createClient(platform);
    const updates: unknown[] = [];
    client.on('sessionUpdate', (update) => updates.push(update));
    await initialize(client, platform.process);
    await createSession(client, platform.process);

    platform.process.emitJson({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'visible response', annotations: { private: true } },
          _meta: { token: 'sk-raw-secret' },
        },
      },
    });
    platform.process.emitJson({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-1',
          title: 'Run experiment',
          kind: 'execute',
          status: 'in_progress',
          content: [{ type: 'content', content: { type: 'text', text: 'sk-tool-output' } }],
          locations: [{ path: '/private/research/data.csv' }],
          rawInput: { command: 'echo sk-input-secret' },
          rawOutput: 'sk-output-secret',
        },
      },
    });

    expect(updates).toEqual([
      {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'visible response' },
        },
      },
      {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-1',
          title: 'Run experiment',
          kind: 'execute',
          status: 'in_progress',
          contentBlockCount: 1,
          locationCount: 1,
        },
      },
    ]);
    expect(JSON.stringify(updates)).not.toMatch(/sk-|private\/research|rawInput|rawOutput|_meta/u);
    await client.close();
  });

  it('routes permission requests through the injected callback and rejects unknown decisions safely', async () => {
    const platform = new FakePlatform();
    const permissionHandler = vi
      .fn<(request: HermesAcpPermissionRequest) => Promise<HermesAcpPermissionDecision>>()
      .mockResolvedValueOnce({ outcome: 'selected', optionId: 'allow_session' })
      .mockResolvedValueOnce({ outcome: 'selected', optionId: 'forged-option' });
    const client = createClient(platform, permissionHandler);
    await initialize(client, platform.process);
    await createSession(client, platform.process);

    const permissionParams = {
      sessionId: 'session-1',
      toolCall: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'perm-1',
        title: 'Run training command',
        kind: 'execute',
        status: 'pending',
        content: [{ type: 'content', content: { type: 'text', text: '$ python train.py' } }],
        rawInput: { command: 'python train.py', apiKey: 'sk-permission-secret' },
      },
      options: [
        { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
        { optionId: 'allow_session', kind: 'allow_session', name: 'Allow for session' },
        { optionId: 'deny', kind: 'reject_once', name: 'Deny' },
      ],
    };
    platform.process.emitJson({
      jsonrpc: '2.0',
      id: 'permission-1',
      method: 'session/request_permission',
      params: permissionParams,
    });
    await vi.waitFor(() =>
      expect(platform.process.frames()).toContainEqual({
        jsonrpc: '2.0',
        id: 'permission-1',
        result: { outcome: { outcome: 'selected', optionId: 'allow_session' } },
      }),
    );
    const callbackPayload = permissionHandler.mock.calls[0]![0];
    expect(callbackPayload).toEqual({
      sessionId: 'session-1',
      toolCall: {
        toolCallId: 'perm-1',
        title: 'Run training command',
        kind: 'execute',
        status: 'pending',
        displayText: '$ python train.py',
        displayTextTruncated: false,
        displayTextUnsafe: false,
        editPreview: null,
      },
      options: permissionParams.options,
    });
    expect(JSON.stringify(callbackPayload)).not.toContain('sk-permission-secret');

    const editPermission = {
      ...permissionParams,
      toolCall: {
        ...permissionParams.toolCall,
        toolCallId: 'edit-1',
        title: 'Approve edit: src/model.py',
        kind: 'edit',
        content: [
          {
            type: 'diff',
            path: 'src/model.py',
            oldText: 'score = 1\n',
            newText: 'score = 2\n',
            rawInput: 'must not cross the boundary',
          },
        ],
      },
    };
    platform.process.emitJson({
      jsonrpc: '2.0',
      id: 'permission-edit',
      method: 'session/request_permission',
      params: editPermission,
    });
    await vi.waitFor(() => expect(permissionHandler).toHaveBeenCalledTimes(2));
    expect(permissionHandler.mock.calls[1]![0]).toMatchObject({
      toolCall: {
        kind: 'edit',
        editPreview: {
          path: 'src/model.py',
          pathTruncated: false,
          pathUnsafe: false,
          oldText: 'score = 1\n',
          newText: 'score = 2\n',
          oldTextTruncated: false,
          newTextTruncated: false,
          oldTextUnsafe: false,
          newTextUnsafe: false,
        },
      },
    });
    expect(JSON.stringify(permissionHandler.mock.calls[1]![0])).not.toContain(
      'must not cross the boundary',
    );

    platform.process.emitJson({
      jsonrpc: '2.0',
      id: 'permission-2',
      method: 'session/request_permission',
      params: permissionParams,
    });
    await vi.waitFor(() =>
      expect(platform.process.frames()).toContainEqual({
        jsonrpc: '2.0',
        id: 'permission-2',
        result: { outcome: { outcome: 'cancelled' } },
      }),
    );
    await client.close();
  });

  it('marks an unsafe or truncated edit target before the approval boundary', async () => {
    const platform = new FakePlatform();
    const permissionHandler = vi
      .fn<(request: HermesAcpPermissionRequest) => Promise<HermesAcpPermissionDecision>>()
      .mockResolvedValue({ outcome: 'cancelled' });
    const client = createClient(platform, permissionHandler, { maxEventTextCharacters: 16 });
    await initialize(client, platform.process);
    await createSession(client, platform.process);

    platform.process.emitJson({
      jsonrpc: '2.0',
      id: 'unsafe-edit-permission',
      method: 'session/request_permission',
      params: {
        sessionId: 'session-1',
        toolCall: {
          toolCallId: 'unsafe-edit',
          title: 'Edit a project file',
          kind: 'edit',
          status: 'pending',
          content: [
            {
              type: 'diff',
              path: `safe.py\n${'hidden'.repeat(8)}.py`,
              oldText: 'before\u202ehidden',
              newText: 'after\u0000hidden',
            },
          ],
        },
        options: [
          { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
          { optionId: 'deny', kind: 'reject_once', name: 'Deny' },
        ],
      },
    });

    await vi.waitFor(() => expect(permissionHandler).toHaveBeenCalledOnce());
    expect(permissionHandler.mock.calls[0]![0].toolCall.editPreview).toMatchObject({
      pathTruncated: true,
      pathUnsafe: true,
      oldTextUnsafe: true,
      newTextUnsafe: true,
    });
    await vi.waitFor(() =>
      expect(platform.process.frames()).toContainEqual({
        jsonrpc: '2.0',
        id: 'unsafe-edit-permission',
        result: { outcome: { outcome: 'cancelled' } },
      }),
    );
    await client.close();
  });

  it('bounds pending requests and expires an unanswered prompt without exposing remote details', async () => {
    const platform = new FakePlatform();
    const client = createClient(platform, async () => ({ outcome: 'cancelled' }), {
      maxPendingRequests: 1,
      promptTimeoutMs: 20,
    });
    await initialize(client, platform.process);
    await createSession(client, platform.process);

    vi.useFakeTimers();
    try {
      const first = client.prompt('session-1', 'first');
      const second = client.prompt('session-1', 'second');
      await expect(second).rejects.toMatchObject({ code: 'hermes_acp_pending_limit_exceeded' });
      const timedOut = expect(first).rejects.toMatchObject({ code: 'hermes_acp_request_timeout' });
      await vi.advanceTimersByTimeAsync(20);
      await timedOut;
      expect(client.pendingRequestCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
    await client.close();
  });

  it('terminates on an oversized stdout line or stderr stream without logging raw secrets', async () => {
    const stdoutPlatform = new FakePlatform();
    const stdoutClient = createClient(stdoutPlatform, async () => ({ outcome: 'cancelled' }), {
      maxLineBytes: 512,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await initialize(stdoutClient, stdoutPlatform.process);
      await createSession(stdoutClient, stdoutPlatform.process);
      const pendingPrompt = stdoutClient.prompt('session-1', 'wait');
      const rejectedPrompt = expect(pendingPrompt).rejects.toMatchObject({
        code: 'hermes_acp_stdout_line_limit_exceeded',
      });
      stdoutPlatform.process.emitStdout(`sk-raw-${'x'.repeat(512)}`);
      await rejectedPrompt;
      expect(stdoutClient.state).toBe('failed');
      expect(stdoutPlatform.signals).toContain('SIGKILL');

      const stderrPlatform = new FakePlatform();
      const stderrClient = createClient(stderrPlatform, async () => ({ outcome: 'cancelled' }), {
        maxStderrBytes: 8,
      });
      await initialize(stderrClient, stderrPlatform.process);
      stderrPlatform.process.emitStderr('sk-secret-error');
      expect(stderrClient.state).toBe('failed');
      expect(stderrPlatform.signals).toContain('SIGKILL');
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleLog).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      consoleLog.mockRestore();
    }
  });

  it('reports only a bounded sealed-launcher diagnostic when the process exits', async () => {
    const platform = new FakePlatform();
    const client = createClient(platform, async () => ({ outcome: 'cancelled' }));
    const initializing = client.initialize();
    platform.process.emitStderr('provider traceback with sk-secret\n');
    platform.process.emitStderr('gosu_hermes_acp_failed:configured_runtime_changed\n');
    platform.process.emitExit(1, null);
    await expect(initializing).rejects.toMatchObject({
      code: 'hermes_acp_runtime_configured_runtime_changed',
    });
  });

  it('reports an unconfirmed SIGKILL and permits a later confirmed close', async () => {
    const platform = new FakePlatform();
    platform.exitOnTerminate = false;
    const client = createClient(platform, async () => ({ outcome: 'cancelled' }), {
      closeGraceMs: 10,
      killConfirmMs: 10,
    });
    await initialize(client, platform.process);

    vi.useFakeTimers();
    try {
      const closing = client.close();
      const rejected = expect(closing).rejects.toMatchObject({
        code: 'hermes_acp_kill_unconfirmed',
      });
      expect(platform.signals).toEqual(['SIGTERM']);
      await vi.advanceTimersByTimeAsync(10);
      expect(platform.signals).toEqual(['SIGTERM', 'SIGKILL']);
      await vi.advanceTimersByTimeAsync(10);
      await rejected;
      expect(client.state).toBe('failed');

      platform.process.emitExit(null, 'SIGKILL');
      await client.close();
      expect(client.state).toBe('closed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports immediate process-group termination for app shutdown', async () => {
    const platform = new FakePlatform();
    const client = createClient(platform);
    await initialize(client, platform.process);

    client.terminateImmediately();
    expect(platform.signals).toEqual(['SIGKILL']);
    await vi.waitFor(() => expect(client.state).toBe('closed'));
  });
});
