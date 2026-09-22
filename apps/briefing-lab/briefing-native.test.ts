import { EventEmitter } from 'node:events';
import { access, readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createCodexModelCatalog } from '@gosu/contracts';
import {
  routineModels,
  runRoutineAgent,
  ROUTINE_FINAL_SCHEMA,
  routineTools,
  type RoutineTransport,
} from './briefing-native';
import { ClaudeCodeMcpBridge } from '../desktop/src/main/claude-code-mcp-bridge';
import type { CodexDynamicToolHandler } from '../desktop/src/main/codex-app-server';
import { initialWorkspace } from './src/fixtures';
import type { RoutineRequest } from './src/routine-builder';
import { ASSISTANT_TOOL_TIMEOUTS, briefingToolFailure } from './briefing-tool-policy';
import { configureNativeUsageObserver, withNativeUsageScope } from './native-usage-observer';
import { briefingClientContext, briefingClientHash } from './briefing-client-context';

const now = '2026-09-08T01:00:00.000Z';
it('records the actually resolved model and reported counters at native completion with its owning workload', async () => {
  const observe = vi.fn(async () => undefined);
  configureNativeUsageObserver(observe);
  try {
    const engine = fake(async (emitter) => {
      emitter.emit('notification', {
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: 'thread',
          turnId: 'turn',
          tokenUsage: {
            total: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 80 },
            last: { totalTokens: 120 },
          },
        },
      });
      complete(emitter);
    });
    await withNativeUsageScope({ workloadKind: 'briefing_assistant', projectId: null }, () =>
      runRoutineAgent(request, new AbortController().signal, () => undefined, {
        factory: () => engine,
        now,
      }),
    );
    expect(observe).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        workloadKind: 'briefing_assistant',
        projectId: null,
        invocation: expect.objectContaining({ resolvedModelId: 'actual-model' }),
        usage: expect.objectContaining({
          inputTokens: 100,
          outputTokens: 20,
          cachedInputTokens: 80,
        }),
        successful: true,
      }),
    );
  } finally {
    configureNativeUsageObserver(undefined);
  }
});
const source = initialWorkspace(now).routines[0]!;
const proposal = {
  name: '논문 브리핑',
  kind: 'personal',
  schedule: source.schedule,
  interest: source.interest,
  sourceIds: [],
  countries: ['KR'],
};
const catalog = createCodexModelCatalog([
  {
    id: 'live-model',
    model: 'live-model',
    displayName: 'Provider discovered',
    isDefault: true,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [{ reasoningEffort: 'high' }, { reasoningEffort: 'xhigh' }],
  },
]);
const request: RoutineRequest = {
  prompt: '서울 시간으로 논문 브리핑',
  modelId: 'live-model',
  providerId: 'codex',
  reasoning: 'high',
  history: [],
  previousProposal: null,
};
const receipt = {
  turnId: 'turn',
  invocation: {
    schemaVersion: 1 as const,
    invocationId: 'i',
    providerId: 'codex',
    requestedModelId: 'live-model',
    resolvedModelId: 'actual-model',
    catalogVersion: catalog.catalogVersion,
    reasoningOptionId: 'high',
    startedAt: now,
  },
  effectiveReasoningOptionId: 'high',
};
function fake(
  action: (emitter: EventEmitter, handler: CodexDynamicToolHandler) => Promise<void> = async (
    emitter,
  ) => complete(emitter),
) {
  const emitter = new EventEmitter();
  let handler!: CodexDynamicToolHandler;
  return Object.assign(emitter, {
    catalog: vi.fn(async () => catalog),
    startThread: vi.fn(async (input: Parameters<RoutineTransport['startThread']>[0]) => {
      handler = input.dynamicToolHandler!;
      return { threadId: 'thread' };
    }),
    runTurn: vi.fn(async () => {
      await action(emitter, handler);
      return receipt;
    }),
    interruptTurn: vi.fn(async () => undefined),
    releaseThread: vi.fn(async () => undefined),
    revokeDynamicTools: vi.fn(),
    dispose: vi.fn(),
  });
}
function complete(
  emitter: EventEmitter,
  value: unknown = { answer: '검토 후 루틴을 저장하고 실제 소스를 연결하세요.', proposal },
) {
  emitter.emit('notification', {
    method: 'item/completed',
    params: {
      threadId: 'thread',
      turnId: 'turn',
      item: { type: 'agentMessage', phase: 'final', text: JSON.stringify(value) },
    },
  });
  emitter.emit('notification', {
    method: 'turn/completed',
    params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } },
  });
}
const delivery = {
  abortSignal: new AbortController().signal,
  outcome: Promise.resolve('delivered' as const),
};
const call = (tool: string, args: Parameters<CodexDynamicToolHandler>[0]['arguments'] = {}) => ({
  threadId: 'thread',
  turnId: 'turn',
  callId: tool,
  namespace: null,
  tool,
  arguments: args,
});

describe('Briefing Lab GOSU native engine', () => {
  it('runs a provider tool call as the client that started the chat, even when the call arrives outside its async context', async () => {
    // Claude Code delivers MCP tool calls from its bridge, outside the chat request's async context.
    // Without the client, workspace.owns() failed and read_calendar reported assistant_settings_changed.
    const token = 'a'.repeat(64);
    const seen: (string | null)[] = [];
    const executeTool = vi.fn(async () => {
      seen.push(briefingClientHash());
      return { events: [] };
    });
    const transport = fake(async (emitter, handler) => {
      await briefingClientContext.exit(() => handler(call('read_calendar'), delivery));
      complete(emitter, { answer: 'done' });
    });
    await briefingClientContext.run(token, () =>
      runRoutineAgent(request, new AbortController().signal, vi.fn(), {
        factory: () => transport,
        structuredJob: {
          instructions: 'Read the calendar',
          prompt: 'fixture',
          schema: { type: 'object' },
          tools: [
            {
              type: 'function',
              name: 'read_calendar',
              description: 'Fixture only',
              inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            },
          ],
          executeTool,
        },
      }),
    );
    expect(executeTool).toHaveBeenCalledOnce();
    expect(seen[0]).toMatch(/^[a-f0-9]{64}$/);
    // A run started without a client does not gain one.
    seen.length = 0;
    await runRoutineAgent(request, new AbortController().signal, vi.fn(), {
      factory: () =>
        fake(async (emitter, handler) => {
          await handler(call('read_calendar'), delivery);
          complete(emitter, { answer: 'done' });
        }),
      structuredJob: {
        instructions: 'Read the calendar',
        prompt: 'fixture',
        schema: { type: 'object' },
        tools: [
          {
            type: 'function',
            name: 'read_calendar',
            description: 'Fixture only',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          },
        ],
        executeTool,
      },
    });
    expect(seen).toEqual([null]);
  });
  it('allows a bounded larger tool budget for a long-context assistant without opening unrelated tools', async () => {
    const replies: unknown[] = [];
    const executeTool = vi.fn(async () => ({ evidence: 'fixture' }));
    const transport = fake(async (emitter, handler) => {
      for (let i = 0; i < 50; i++) replies.push(await handler(call('read_fixture'), delivery));
      complete(emitter, { answer: 'done' });
    });
    transport.catalog.mockResolvedValue({
      ...catalog,
      models: catalog.models.map((model) => ({ ...model, contextWindowTokens: 1000000 })),
    });
    await runRoutineAgent(request, new AbortController().signal, vi.fn(), {
      factory: () => transport,
      structuredJob: {
        instructions: 'Read bounded fixture evidence',
        prompt: 'fixture',
        schema: { type: 'object' },
        tools: [
          {
            type: 'function',
            name: 'read_fixture',
            description: 'Fixture only',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          },
        ],
        executeTool,
      },
    });
    expect(executeTool).toHaveBeenCalledTimes(48);
    expect(replies[48]).toMatchObject({ success: false });
    expect(replies[49]).toMatchObject({ success: false });
  });
  it('forwards scoped native token counters, distinguishes last context from totals, and invalidates compacted context', async () => {
    const tokenUsage = {
      total: {
        inputTokens: 200000,
        outputTokens: 5000,
        cachedInputTokens: 100000,
        totalTokens: 205000,
      },
      last: { totalTokens: 12000 },
      modelContextWindow: 1050000,
    };
    const transport = fake(async (emitter) => {
      emitter.emit('notification', {
        method: 'thread/tokenUsage/updated',
        params: { threadId: 'foreign', turnId: 'turn', tokenUsage },
      });
      emitter.emit('notification', {
        method: 'thread/tokenUsage/updated',
        params: { threadId: 'thread', turnId: 'turn', tokenUsage },
      });
      emitter.emit('notification', {
        method: 'thread/tokenUsage/updated',
        params: { threadId: 'thread', turnId: 'turn', tokenUsage },
      });
      emitter.emit('notification', {
        method: 'thread/compacted',
        params: { threadId: 'thread', turnId: 'turn' },
      });
      complete(emitter);
    });
    const onUsage = vi.fn();
    const result = await runRoutineAgent(request, new AbortController().signal, vi.fn(), {
      factory: () => transport,
      onUsage,
      now,
    });
    expect(onUsage).toHaveBeenCalledTimes(3);
    expect(onUsage.mock.calls[0]![0]).toMatchObject({ inputTokens: 200000, contextTokens: 12000 });
    expect(result.nativeUsage).toMatchObject({
      inputTokens: 200000,
      contextTokens: null,
      contextStale: true,
    });
  });
  it.each(['codex', 'claude-code'] as const)(
    'registers %s source-specific deadlines in the actual provider namespace',
    async (providerId) => {
      const transport = fake((emitter) => {
        complete(emitter, { answer: 'done', events: [], tasks: [] });
        return Promise.resolve();
      });
      transport.catalog.mockResolvedValue({
        ...catalog,
        providerId,
        models: catalog.models.map((m) => ({ ...m, providerId })),
      });
      await runRoutineAgent({ ...request, providerId }, new AbortController().signal, vi.fn(), {
        factory: () => transport,
        structuredJob: {
          instructions: 'Read only',
          prompt: 'synthetic',
          schema: { type: 'object' },
          tools: ['search_email', 'read_calendar'].map((name) => ({
            type: 'function',
            name,
            description: 'Read',
            inputSchema: { type: 'object' },
          })),
          toolTimeouts: ASSISTANT_TOOL_TIMEOUTS,
          executeTool: vi.fn(),
        },
      });
      expect(transport.startThread.mock.calls[0]![0].dynamicToolTimeouts).toEqual(
        ['search_email', 'read_calendar'].map((tool) => ({
          namespace: providerId === 'claude-code' ? 'gosu_project' : null,
          tool,
          timeoutMs: ASSISTANT_TOOL_TIMEOUTS[tool as 'search_email' | 'read_calendar'],
        })),
      );
    },
  );
  it('cancels the actual read when tool delivery expires and never returns late private content', async () => {
    const expired = new AbortController();
    const execute = vi.fn(async (_name: string, _args: unknown, sig: AbortSignal) => {
      expired.abort();
      expect(sig.aborted).toBe(true);
      return { private: 'late private content' };
    });
    const transport = fake(async (emitter, handler) => {
      const result = await handler(call('search_email'), {
        ...delivery,
        abortSignal: expired.signal,
      });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).not.toContain('late private content');
      complete(emitter, { answer: 'cancelled read', events: [], tasks: [] });
    });
    await runRoutineAgent(request, new AbortController().signal, vi.fn(), {
      factory: () => transport,
      structuredJob: {
        instructions: 'Read',
        prompt: 'fixture',
        schema: { type: 'object' },
        tools: [
          {
            type: 'function',
            name: 'search_email',
            description: 'Read',
            inputSchema: { type: 'object' },
          },
        ],
        executeTool: execute,
      },
    });
    expect(execute).toHaveBeenCalledOnce();
  });
  it('does not repeat a failed slow source or misclassify its timeout as a missing permission', async () => {
    const execute = vi.fn(async () => {
      throw new Error('mail_timeout_metadata');
    });
    const transport = fake(async (emitter, handler) => {
      for (let i = 0; i < 2; i++) {
        const result = await handler({ ...call('search_email'), callId: String(i) }, delivery);
        expect(JSON.parse(result.contentItems[0]!.text)).toMatchObject({
          error: 'mail_timeout_metadata',
          category: 'timeout',
          retryable: false,
        });
      }
      complete(emitter, { answer: 'Mail timed out', events: [], tasks: [] });
    });
    await runRoutineAgent(request, new AbortController().signal, vi.fn(), {
      factory: () => transport,
      structuredJob: {
        instructions: 'Read',
        prompt: 'fixture',
        schema: { type: 'object' },
        tools: [
          {
            type: 'function',
            name: 'search_email',
            description: 'Read',
            inputSchema: { type: 'object' },
          },
        ],
        executeTool: execute,
      },
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(briefingToolFailure(new Error('assistant_mail_permission_required')).category).toBe(
      'permission',
    );
    expect(briefingToolFailure(new Error('mail_permission_denied')).category).toBe('permission');
    expect(briefingToolFailure(new Error('mail_private_secret')).error).toBe(
      'assistant_tool_failed',
    );
    expect(JSON.stringify(briefingToolFailure(new Error('private subject/body')))).not.toContain(
      'private subject/body',
    );
  });
  it('aborts source work at the overall native deadline, not just the waiting UI', async () => {
    let sourceAborted = false;
    const transport = fake(async (_emitter, handler) => {
      await handler(call('read_calendar'), delivery);
    });
    await expect(
      runRoutineAgent(request, new AbortController().signal, vi.fn(), {
        factory: () => transport,
        timeoutMs: 40,
        structuredJob: {
          instructions: 'Read',
          prompt: 'fixture',
          schema: { type: 'object' },
          tools: [
            {
              type: 'function',
              name: 'read_calendar',
              description: 'Read',
              inputSchema: { type: 'object' },
            },
          ],
          executeTool: async (_n, _a, sig) =>
            new Promise((_resolve, reject) =>
              sig.addEventListener(
                'abort',
                () => {
                  sourceAborted = true;
                  reject(new Error('source_cancelled'));
                },
                { once: true },
              ),
            ),
        },
      }),
    ).rejects.toThrow('routine_timeout');
    expect(sourceAborted).toBe(true);
  });
  it('runs multiple scoped assistant read tools in one native turn, rejecting unknown writes and hiding raw errors', async () => {
    const execute = vi.fn(async (name: string) => {
      if (name === 'search_email') throw new Error('private raw subject: secret');
      return { items: [{ id: 'p', title: 'paper' }] };
    });
    const transport = fake(async (emitter, handler) => {
      const first = await handler(call('search_papers', { query: 'optimization' }), delivery);
      expect(first.success).toBe(true);
      const denied = await handler(call('delete_calendar_event', { id: 'event' }), delivery);
      expect(denied.success).toBe(false);
      const failed = await handler(call('search_email', { query: 'review' }), delivery);
      expect(JSON.stringify(failed)).not.toContain('secret');
      complete(emitter, { answer: 'Sources checked', events: [], tasks: [] });
    });
    await runRoutineAgent(request, new AbortController().signal, vi.fn(), {
      factory: () => transport,
      structuredJob: {
        instructions: 'Read tools only',
        webSearchMode: 'live',
        prompt: 'Read public sources',
        schema: { type: 'object' },
        tools: ['search_papers', 'search_email'].map((name) => ({
          type: 'function' as const,
          name,
          description: 'Read only',
          inputSchema: { type: 'object' },
        })),
        executeTool: execute,
      },
    });
    expect(execute.mock.calls.map((c) => c[0])).toEqual(['search_papers', 'search_email']);
    expect(transport.startThread.mock.calls[0]![0].webSearchMode).toBe('live');
    expect(transport.dispose).toHaveBeenCalledOnce();
  });
  it('ships the same pinned Codex fallback as Desktop so native discovery works outside Electron', async () => {
    const read = async (url: URL) =>
      JSON.parse(await readFile(url, 'utf8')) as { dependencies: Record<string, string> };
    const own = await read(new URL('./package.json', import.meta.url));
    const desktop = await read(new URL('../desktop/package.json', import.meta.url));
    expect(own.dependencies['@openai/codex']).toBe(desktop.dependencies['@openai/codex']);
    expect(own.dependencies['@openai/codex']).toBeTruthy();
  });
  it('runs evidence summaries with their own schema and no routine, mail, shell or web tools', async () => {
    const output = { overview: 'Public summary', items: [] };
    const transport = fake(async (emitter) => complete(emitter, output));
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: { overview: { type: 'string' } },
    };
    const result = await runRoutineAgent(request, new AbortController().signal, vi.fn(), {
      factory: () => transport,
      structuredJob: {
        instructions: 'Evidence-only policy',
        prompt: 'Bounded source excerpts',
        schema,
      },
    });
    const thread = transport.startThread.mock.calls[0]![0];
    expect(thread.dynamicTools).toEqual([]);
    expect(thread.dynamicToolHandler).toBeUndefined();
    expect(thread.webSearchMode).toBe('disabled');
    expect(thread.developerInstructions).toContain('Evidence-only policy');
    expect(JSON.stringify(transport.runTurn.mock.calls)).toContain('Bounded source excerpts');
    expect(JSON.stringify(transport.runTurn.mock.calls)).toContain(JSON.stringify(schema));
    expect(JSON.parse(result.answer)).toEqual(output);
    expect(transport.dispose).toHaveBeenCalledOnce();
    // Only a job that asks for it runs without extended thinking.
    expect(JSON.stringify(transport.runTurn.mock.calls)).not.toContain('"thinking"');
    const quick = fake(async (emitter) => complete(emitter, output));
    await runRoutineAgent(request, new AbortController().signal, vi.fn(), {
      factory: () => quick,
      structuredJob: { instructions: 'Quick', prompt: 'Metadata', schema, thinking: 'disabled' },
    });
    expect(JSON.stringify(quick.runTurn.mock.calls)).toContain('"thinking":"disabled"');
  });
  it.each([
    ['claude_code_auth_required', 'claude_code_auth_required'],
    ['claude_code_timeout', 'claude_code_timeout'],
    ['claude_code_network_unavailable', 'claude_code_network_unavailable'],
    [
      "Invalid schema for response_format: Missing 'researchQuestion'. private diagnostic must not leak",
      'routine_output_schema_invalid',
    ],
    ['raw provider output with sensitive content', 'routine_native_failed'],
  ])('preserves actionable safe error codes, not raw output: %s', async (message, expected) => {
    const transport = fake(async (emitter) => {
      emitter.emit('notification', {
        method: 'turn/completed',
        params: { threadId: 'thread', turn: { id: 'turn', status: 'failed', error: { message } } },
      });
    });
    await expect(
      runRoutineAgent(request, new AbortController().signal, vi.fn(), { factory: () => transport }),
    ).rejects.toThrow(expected);
    expect(transport.dispose).toHaveBeenCalled();
  });
  it.each(['codex', 'claude-code'] as const)(
    '%s iterates source/validation tools with GOSU policy, native schema and resolved receipt',
    async (providerId) => {
      const providerCall = (
        tool: string,
        args: Parameters<CodexDynamicToolHandler>[0]['arguments'] = {},
      ) => ({
        ...call(tool, args),
        namespace: providerId === 'claude-code' ? 'gosu_project' : null,
      });
      const transport = fake(async (emitter, handler) => {
        expect((await handler(providerCall('list_briefing_sources'), delivery)).success).toBe(true);
        const validation = await handler(
          providerCall('validate_routine_proposal', proposal),
          delivery,
        );
        expect(validation.success).toBe(true);
        expect(validation.contentItems[0]!.text).toContain('"scheduled":false');
        expect(
          (await handler({ ...call('list_briefing_sources'), threadId: 'another' }, delivery))
            .success,
        ).toBe(false);
        expect((await handler(call('run_shell'), delivery)).success).toBe(false);
        complete(emitter);
      });
      transport.catalog.mockResolvedValue({
        ...catalog,
        providerId,
        models: catalog.models.map((model) => ({ ...model, providerId })),
      });
      const progress = vi.fn();
      const result = await runRoutineAgent(
        { ...request, providerId },
        new AbortController().signal,
        progress,
        { factory: () => transport, now },
      );
      expect(result.nextDates).toHaveLength(5);
      expect(result.model).toBe('actual-model');
      expect(result.reasoning).toBe('high');
      expect(transport.startThread.mock.calls[0]![0].developerInstructions).toContain(
        'gosu.research-agent.policy',
      );
      expect(transport.startThread.mock.calls[0]![0].webSearchMode).toBe('disabled');
      expect(transport.runTurn.mock.calls[0]).toBeDefined();
      expect(progress.mock.calls.some(([event]) => event.stage === 'validated')).toBe(true);
      // The model that actually runs is named, so a summary following the Settings role is
      // distinguishable from the model picked in the Briefing chat.
      const connecting = progress.mock.calls
        .map(([event]) => event)
        .find((event) => event.stage === 'connecting');
      expect(connecting.detail).toContain(request.modelId);
      expect(connecting.detail).toContain(providerId);
      expect(transport.dispose).toHaveBeenCalledOnce();
      expect(transport.releaseThread).toHaveBeenCalledWith('thread');
      await expect(access(transport.startThread.mock.calls[0]![0].cwd)).rejects.toThrow();
      expect(ROUTINE_FINAL_SCHEMA).toHaveProperty('additionalProperties', false);
    },
  );
  it('registers routine tools with the real GOSU Claude MCP bridge namespace', async () => {
    const bridge = await ClaudeCodeMcpBridge.create({
      threadId: 'routine-test',
      dynamicTools: routineTools('claude-code'),
      dynamicToolHandler: async () => ({
        success: true,
        contentItems: [{ type: 'inputText', text: '{}' }],
      }),
    });
    try {
      expect(bridge.serverName).toBe('gosu_project');
      await expect(access(bridge.socketPath)).resolves.toBeUndefined();
    } finally {
      await bridge.dispose();
    }
  });
  it('revalidates final output even if no tool was used; never saves a rejected proposal', async () => {
    const transport = fake(async (emitter) =>
      complete(emitter, {
        answer: 'done',
        proposal: { ...proposal, sourceIds: ['invented-source'] },
      }),
    );
    await expect(
      runRoutineAgent(request, new AbortController().signal, vi.fn(), {
        factory: () => transport,
        now,
      }),
    ).rejects.toThrow('routine_source_unknown');
    expect(transport.dispose).toHaveBeenCalled();
  });
  it('can ask clarification without pretending to create a routine', async () => {
    const transport = fake(async (emitter) =>
      complete(emitter, { answer: '격주인가요, 일주일에 두 번인가요?', proposal: null }),
    );
    const result = await runRoutineAgent(request, new AbortController().signal, vi.fn(), {
      factory: () => transport,
    });
    expect(result.proposal).toBeNull();
    expect(result.nextDates).toEqual([]);
  });
  it.each([{ modelId: 'invented' }, { reasoning: 'unsupported' }])(
    'rejects stale model or unsupported reasoning before turn %j',
    async (patch) => {
      const transport = fake();
      await expect(
        runRoutineAgent({ ...request, ...patch }, new AbortController().signal, vi.fn(), {
          factory: () => transport,
        }),
      ).rejects.toThrow(/unavailable/);
      expect(transport.startThread).not.toHaveBeenCalled();
      expect(transport.dispose).toHaveBeenCalled();
    },
  );
  it('cancels an active native turn and revokes its tools', async () => {
    const controller = new AbortController();
    const transport = fake(async () => {
      setTimeout(() => controller.abort(), 10);
    });
    await expect(
      runRoutineAgent(request, controller.signal, vi.fn(), { factory: () => transport }),
    ).rejects.toThrow('routine_aborted');
    expect(transport.interruptTurn).toHaveBeenCalledWith('thread', 'turn');
    expect(transport.revokeDynamicTools).toHaveBeenCalledWith('thread');
  });
  it('bounds stalled turns and cleans them up', async () => {
    const transport = fake(async () => undefined);
    await expect(
      runRoutineAgent(request, new AbortController().signal, vi.fn(), {
        factory: () => transport,
        timeoutMs: 30,
      }),
    ).rejects.toThrow('routine_timeout');
    expect(transport.dispose).toHaveBeenCalled();
  });
  it('returns individual connection errors without fabricated catalogs or fallback', async () => {
    const broken = fake();
    broken.catalog.mockRejectedValue(new Error('auth required'));
    const healthy = fake();
    const result = await routineModels((provider) => (provider === 'codex' ? broken : healthy));
    expect(result[0]!.catalog).toBeNull();
    expect(result[1]!.catalog?.models).toHaveLength(1);
    expect(broken.dispose).toHaveBeenCalled();
    expect(healthy.runTurn).not.toHaveBeenCalled();
  });
});
