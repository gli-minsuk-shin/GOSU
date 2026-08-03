import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildCodexChildEnvironment,
  buildCodexThreadParameters,
  buildCodexTurnParameters,
  CodexAppServer,
  codexServerRequestResponse,
  assertNoProjectMcpServers,
  buildCodexAppServerArguments,
  parseCodexThreadStartResponse,
  prepareIsolatedCodexHome,
  resolveUnpackedAsarPath,
  type CodexDynamicToolHandler,
  type CodexDynamicToolSpec,
} from '../src/main/codex-app-server';
import { toModelCatalog } from '../src/main/model-catalog';

describe('Codex App Server process boundary', () => {
  it('passes only runtime, temporary-file, certificate, and proxy settings', () => {
    const environment = buildCodexChildEnvironment(
      {
        PATH: '/usr/bin',
        HOME: '/Users/researcher',
        TMPDIR: '/tmp/gosu',
        SSL_CERT_FILE: '/etc/certs.pem',
        HTTPS_PROXY: 'http://proxy.test',
        NO_PROXY: '127.0.0.1',
        GOSU_OIDC_CLIENT_SECRET: 'do-not-pass',
        OPENAI_API_KEY: 'do-not-pass',
        GITHUB_TOKEN: 'do-not-pass',
        DATABASE_URL: 'do-not-pass',
        CODEX_HOME: '/custom/codex',
      },
      true,
      'info',
    );

    expect(environment).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/researcher',
      TMPDIR: '/tmp/gosu',
      SSL_CERT_FILE: '/etc/certs.pem',
      HTTPS_PROXY: 'http://proxy.test',
      NO_PROXY: '127.0.0.1',
      RUST_LOG: 'info',
      ELECTRON_RUN_AS_NODE: '1',
    });
  });

  it('does not accept arbitrary Rust log directives from the parent environment', () => {
    expect(buildCodexChildEnvironment({}, false, 'trace,secret_module=debug')).toEqual({
      RUST_LOG: 'warn',
    });
  });

  it('routes Codex SQLite state to a separate volatile runtime directory', () => {
    expect(
      buildCodexChildEnvironment(
        {},
        false,
        undefined,
        '/private/gosu/codex-auth-home',
        '/private/tmp/gosu-codex-runtime',
      ),
    ).toEqual({
      RUST_LOG: 'warn',
      CODEX_HOME: '/private/gosu/codex-auth-home',
      CODEX_SQLITE_HOME: '/private/tmp/gosu-codex-runtime',
    });
  });

  it('launches packaged Codex from the real unpacked dependency path', () => {
    expect(
      resolveUnpackedAsarPath(
        '/Applications/GOSU.app/Contents/Resources/app.asar/node_modules/@openai/codex/package.json',
      ),
    ).toBe(
      '/Applications/GOSU.app/Contents/Resources/app.asar.unpacked/node_modules/@openai/codex/package.json',
    );
    expect(resolveUnpackedAsarPath('/workspace/node_modules/@openai/codex/package.json')).toBe(
      '/workspace/node_modules/@openai/codex/package.json',
    );
  });

  it('copies only fixture authentication into a private isolated Codex home', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'gosu-codex-home-test-'));
    const sharedHome = join(temporaryRoot, 'shared');
    const isolatedHome = join(temporaryRoot, 'isolated');
    const fixtureAuth = JSON.stringify({ authMode: 'fixture-only' });
    try {
      await mkdir(sharedHome, { mode: 0o700 });
      await writeFile(join(sharedHome, 'auth.json'), fixtureAuth, { mode: 0o600 });

      await prepareIsolatedCodexHome(isolatedHome, join(sharedHome, 'auth.json'));

      expect(await readFile(join(isolatedHome, 'auth.json'), 'utf8')).toBe(fixtureAuth);
      expect((await stat(isolatedHome)).mode & 0o777).toBe(0o700);
      expect((await stat(join(isolatedHome, 'auth.json'))).mode & 0o777).toBe(0o600);

      await rm(join(isolatedHome, 'auth.json'));
      await writeFile(join(sharedHome, 'auth.json'), JSON.stringify({ authMode: 'changed' }));
      await prepareIsolatedCodexHome(isolatedHome, join(sharedHome, 'auth.json'));
      await expect(readFile(join(isolatedHome, 'auth.json'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('emits every fetched dynamic model catalog for durable provenance storage', async () => {
    const server = new CodexAppServer();
    const catalogListener = vi.fn();
    server.on('catalog', catalogListener);
    vi.spyOn(server, 'listModels').mockResolvedValue([
      {
        id: 'future-model-id',
        model: 'future-model-id',
        displayName: 'Future Model',
        hidden: false,
        isDefault: true,
      },
    ]);

    const catalog = await server.listModelCatalog();
    expect(catalog.models[0]?.modelId).toBe('future-model-id');
    expect(catalogListener).toHaveBeenCalledOnce();
    expect(catalogListener).toHaveBeenCalledWith(catalog);
  });

  it('paginates the dynamic model catalog without hard-coded model names', async () => {
    const server = new CodexAppServer();
    vi.spyOn(server, 'start').mockResolvedValue();
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            id: 'model-page-1',
            model: 'model-page-1',
            displayName: 'Page One',
            hidden: false,
            isDefault: true,
          },
        ],
        nextCursor: 'page-2',
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'model-page-2',
            model: 'model-page-2',
            displayName: 'Page Two',
            hidden: false,
            isDefault: false,
          },
        ],
        nextCursor: null,
      });
    (server as unknown as { request: typeof request }).request = request;

    await expect(server.listModels()).resolves.toMatchObject([
      { id: 'model-page-1' },
      { id: 'model-page-2' },
    ]);
    expect(request).toHaveBeenNthCalledWith(1, 'model/list', {
      limit: 100,
      includeHidden: false,
    });
    expect(request).toHaveBeenNthCalledWith(2, 'model/list', {
      limit: 100,
      includeHidden: false,
      cursor: 'page-2',
    });
  });

  it('unsubscribes a newly started thread when the MCP fail-closed check rejects it', async () => {
    const server = new CodexAppServer();
    vi.spyOn(server, 'start').mockResolvedValue();
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/start') return { thread: { id: 'thread-with-mcp' }, model: 'model' };
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'unexpected' }] };
      if (method === 'thread/unsubscribe') return { status: 'unsubscribed' };
      throw new Error('unexpected_request');
    });
    (server as unknown as { request: typeof request }).request = request;

    await expect(server.startThread({ cwd: '/isolated/project', modelId: null })).rejects.toThrow(
      'codex_project_tools_not_isolated',
    );
    expect(request).toHaveBeenCalledWith('thread/unsubscribe', {
      threadId: 'thread-with-mcp',
    });
  });

  it('applies an early model reroute and survives a throwing provenance listener', async () => {
    const server = new CodexAppServer();
    const catalog = toModelCatalog(
      [
        {
          id: 'catalog-default',
          model: 'catalog-default',
          displayName: 'Catalog Default',
          hidden: false,
          isDefault: true,
        },
      ],
      '2026-08-04T00:00:00.000Z',
    );
    vi.spyOn(server, 'start').mockResolvedValue();
    vi.spyOn(server, 'listModelCatalog').mockResolvedValue(catalog);
    const internal = server as unknown as {
      earlyReroutes: Map<string, { threadId: string; toModel: string }>;
      request: (method: string) => Promise<unknown>;
      invocations: Map<string, { invocation: { resolvedModelId: string } }>;
      process: unknown;
      handleLine: (child: unknown, line: string) => void;
    };
    internal.earlyReroutes.set('turn-early', {
      threadId: 'thread-1',
      toModel: 'provider-rerouted',
    });
    internal.request = async (method) => {
      if (method === 'turn/start') return { turn: { id: 'turn-early' } };
      throw new Error('unexpected_request');
    };
    server.on('invocation', () => {
      throw new Error('fixture_persistence_failure');
    });

    const result = await server.runTurn({
      threadId: 'thread-1',
      prompt: 'Fixture prompt',
      requestedModelId: null,
      reasoningOptionId: null,
      cwd: '/isolated/project',
    });
    expect(result.invocation.resolvedModelId).toBe('provider-rerouted');
    expect(internal.invocations.size).toBe(1);

    const child = {};
    internal.process = child;
    internal.handleLine(
      child,
      JSON.stringify({
        method: 'model/rerouted',
        params: {
          threadId: 'thread-other',
          turnId: 'turn-early',
          toModel: 'spoofed-reroute',
        },
      }),
    );
    expect(internal.invocations.get('turn-early')?.invocation.resolvedModelId).toBe(
      'provider-rerouted',
    );
    internal.handleLine(
      child,
      JSON.stringify({
        method: 'turn/completed',
        params: { threadId: 'thread-other', turn: { id: 'turn-early', status: 'completed' } },
      }),
    );
    expect(internal.invocations.size).toBe(1);
    internal.handleLine(
      child,
      JSON.stringify({
        method: 'turn/completed',
        params: { threadId: 'thread-1', turn: { id: 'turn-early', status: 'completed' } },
      }),
    );
    expect(internal.invocations.size).toBe(0);
  });

  it('builds project chat turns without shell, write, approval, or network access', () => {
    expect(
      buildCodexThreadParameters({
        cwd: '/isolated/project',
        modelId: 'catalog-model',
        developerInstructions: 'Project chat only',
      }),
    ).toEqual({
      cwd: '/isolated/project',
      serviceName: 'gosu_desktop',
      approvalPolicy: 'never',
      sandbox: 'read-only',
      config: {
        agents: { enabled: false },
        apps: {
          _default: {
            enabled: false,
            destructive_enabled: false,
            open_world_enabled: false,
          },
        },
        features: {
          apps: false,
          auth_elicitation: false,
          browser_use: false,
          browser_use_external: false,
          browser_use_full_cdp_access: false,
          code_mode: { enabled: false },
          code_mode_host: false,
          computer_use: false,
          enable_mcp_apps: false,
          goals: false,
          hooks: false,
          image_generation: false,
          in_app_browser: false,
          memories: false,
          multi_agent: false,
          network_proxy: false,
          plugin_sharing: false,
          plugins: false,
          remote_plugin: false,
          shell_snapshot: false,
          shell_tool: false,
          skill_mcp_dependency_install: false,
          skill_search: false,
          tool_call_mcp_elicitation: false,
          tool_suggest: false,
          unified_exec: false,
          workspace_dependencies: false,
        },
        mcp_servers: {},
        tools: {
          experimental_request_user_input: { enabled: false },
          update_plan: { enabled: false },
        },
        web_search: 'disabled',
      },
      baseInstructions: expect.stringContaining('explicitly declared read-only GOSU dynamic tools'),
      ephemeral: true,
      environments: [],
      dynamicTools: [],
      runtimeWorkspaceRoots: [],
      selectedCapabilityRoots: [],
      developerInstructions: 'Project chat only',
      model: 'catalog-model',
    });
    expect(
      buildCodexTurnParameters({
        threadId: 'thread-1',
        prompt: 'Hello',
        requestedModelId: null,
        reasoningOptionId: null,
        cwd: '/isolated/project',
        clientUserMessageId: 'message-1',
        outputSchema: { type: 'object' },
      }),
    ).toEqual({
      threadId: 'thread-1',
      clientUserMessageId: 'message-1',
      input: [{ type: 'text', text: 'Hello', text_elements: [] }],
      cwd: '/isolated/project',
      environments: [],
      runtimeWorkspaceRoots: [],
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      outputSchema: { type: 'object' },
    });
  });

  it('routes only declared dynamic tools to the handler registered for that thread', async () => {
    const dynamicTools: readonly CodexDynamicToolSpec[] = [
      {
        type: 'namespace',
        name: 'gosu_project',
        description: 'Read-only project context',
        tools: [
          {
            type: 'function',
            name: 'read_note',
            description: 'Read one explicitly connected project note',
            inputSchema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
              additionalProperties: false,
            },
          },
        ],
      },
    ];
    expect(
      buildCodexThreadParameters({
        cwd: '/isolated/project',
        modelId: null,
        dynamicTools,
      }).dynamicTools,
    ).toEqual(dynamicTools);

    const deliveryOutcomes: Array<Promise<'delivered' | 'discarded' | 'uncertain'>> = [];
    const handler = vi.fn(async (_call, delivery) => {
      deliveryOutcomes.push(delivery.outcome);
      return {
        contentItems: [{ type: 'inputText' as const, text: '{"content":"fixture"}' }],
        success: true,
      };
    });
    const server = new CodexAppServer();
    vi.spyOn(server, 'start').mockResolvedValue();
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/start') return { thread: { id: 'thread-tools' } };
      if (method === 'mcpServerStatus/list') return { data: [] };
      throw new Error('unexpected_request');
    });
    const internal = server as unknown as {
      request: typeof request;
      process: unknown;
      handleLine: (child: unknown, line: string) => void;
    };
    internal.request = request;
    await server.startThread({
      cwd: '/isolated/project',
      modelId: null,
      dynamicTools,
      dynamicToolHandler: handler,
    });

    const writes: string[] = [];
    const writeCallbacks: Array<(error?: Error | null) => void> = [];
    const child = {
      stdin: {
        write(payload: string, callback?: (error?: Error | null) => void) {
          writes.push(payload);
          if (callback) writeCallbacks.push(callback);
          return true;
        },
      },
    };
    internal.process = child;
    internal.handleLine(
      child,
      JSON.stringify({
        id: 91,
        method: 'item/tool/call',
        params: {
          threadId: 'thread-tools',
          turnId: 'turn-tools',
          callId: 'call-tools',
          namespace: 'gosu_project',
          tool: 'read_note',
          arguments: { path: 'notes/result.md' },
        },
      }),
    );

    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(handler).toHaveBeenCalledWith(
      {
        threadId: 'thread-tools',
        turnId: 'turn-tools',
        callId: 'call-tools',
        namespace: 'gosu_project',
        tool: 'read_note',
        arguments: { path: 'notes/result.md' },
      },
      expect.objectContaining({ outcome: expect.any(Promise) }),
    );
    expect(JSON.parse(writes[0]!)).toEqual({
      id: 91,
      result: {
        contentItems: [{ type: 'inputText', text: '{"content":"fixture"}' }],
        success: true,
      },
    });
    let firstOutcome: string | undefined;
    void deliveryOutcomes[0]!.then((outcome) => {
      firstOutcome = outcome;
    });
    await Promise.resolve();
    expect(firstOutcome).toBeUndefined();
    writeCallbacks[0]!();
    await expect(deliveryOutcomes[0]).resolves.toBe('delivered');

    internal.handleLine(
      child,
      JSON.stringify({
        id: 92,
        method: 'item/tool/call',
        params: {
          threadId: 'thread-tools',
          turnId: 'turn-tools',
          callId: 'call-write-error',
          namespace: 'gosu_project',
          tool: 'read_note',
          arguments: { path: 'notes/error.md' },
        },
      }),
    );
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    writeCallbacks[1]!(new Error('asynchronous_write_failure'));
    await expect(deliveryOutcomes[1]).resolves.toBe('uncertain');

    internal.handleLine(
      child,
      JSON.stringify({
        id: 93,
        method: 'item/tool/call',
        params: {
          threadId: 'thread-tools',
          turnId: 'turn-tools',
          callId: 'call-revoked-during-write',
          namespace: 'gosu_project',
          tool: 'read_note',
          arguments: { path: 'notes/unconfirmed.md' },
        },
      }),
    );
    await vi.waitFor(() => expect(writes).toHaveLength(3));
    server.revokeDynamicTools('thread-tools');
    await expect(deliveryOutcomes[2]).resolves.toBe('uncertain');
    writeCallbacks[2]!();
    await expect(deliveryOutcomes[2]).resolves.toBe('uncertain');
  });

  it('binds a dynamic-tool registration to the first turn and rejects another turn', async () => {
    const dynamicTools: readonly CodexDynamicToolSpec[] = [
      {
        type: 'function',
        name: 'read_board',
        description: 'Read the current project board',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
    ];
    const handler = vi.fn(async () => ({
      contentItems: [{ type: 'inputText' as const, text: '{}' }],
      success: true,
    }));
    const server = new CodexAppServer();
    vi.spyOn(server, 'start').mockResolvedValue();
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/start') return { thread: { id: 'thread-bound' } };
      if (method === 'mcpServerStatus/list') return { data: [] };
      throw new Error('unexpected_request');
    });
    const internal = server as unknown as {
      request: typeof request;
      process: unknown;
      handleLine: (child: unknown, line: string) => void;
    };
    internal.request = request;
    await server.startThread({
      cwd: '/isolated/project',
      modelId: null,
      dynamicTools,
      dynamicToolHandler: handler,
    });

    const writes: string[] = [];
    const child = {
      stdin: {
        write(payload: string, callback?: (error?: Error | null) => void) {
          writes.push(payload);
          callback?.();
          return true;
        },
      },
    };
    internal.process = child;
    const send = (id: number, turnId: string, callId: string) =>
      internal.handleLine(
        child,
        JSON.stringify({
          id,
          method: 'item/tool/call',
          params: {
            threadId: 'thread-bound',
            turnId,
            callId,
            tool: 'read_board',
            arguments: {},
          },
        }),
      );

    send(92, 'turn-first', 'call-first');
    send(93, 'turn-other', 'call-other');
    await vi.waitFor(() => expect(writes).toHaveLength(2));

    const responses = new Map(
      writes.map((payload) => {
        const response = JSON.parse(payload) as { id: number };
        return [response.id, response] as const;
      }),
    );
    expect(responses.get(92)).toEqual({
      id: 92,
      result: {
        contentItems: [{ type: 'inputText', text: '{}' }],
        success: true,
      },
    });
    expect(responses.get(93)).toMatchObject({
      id: 93,
      error: { code: -32602, message: 'Invalid GOSU dynamic tool call.' },
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-bound', turnId: 'turn-first' }),
      expect.objectContaining({ outcome: expect.any(Promise) }),
    );
  });

  it.each([
    { name: 'accepts', returnedTurnId: 'turn-early', rejects: false },
    { name: 'rejects', returnedTurnId: 'turn-different', rejects: true },
  ])(
    '$name an early dynamic-tool call when turn/start returns its actual turn ID',
    async ({ returnedTurnId, rejects }) => {
      const dynamicTools: readonly CodexDynamicToolSpec[] = [
        {
          type: 'function',
          name: 'read_objective',
          description: 'Read the current project objective',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
      ];
      const handler = vi.fn(async () => ({
        contentItems: [{ type: 'inputText' as const, text: '{}' }],
        success: true,
      }));
      const server = new CodexAppServer();
      vi.spyOn(server, 'start').mockResolvedValue();
      vi.spyOn(server, 'listModelCatalog').mockResolvedValue(
        toModelCatalog(
          [
            {
              id: 'fixture-model',
              model: 'fixture-model',
              displayName: 'Fixture Model',
              hidden: false,
              isDefault: true,
            },
          ],
          '2026-08-04T00:00:00.000Z',
        ),
      );

      let deliverEarlyCall: () => void = () => undefined;
      const request = vi.fn(async (method: string) => {
        if (method === 'thread/start') return { thread: { id: 'thread-early' } };
        if (method === 'mcpServerStatus/list') return { data: [] };
        if (method === 'turn/start') {
          deliverEarlyCall();
          return { turn: { id: returnedTurnId } };
        }
        throw new Error('unexpected_request');
      });
      const internal = server as unknown as {
        request: typeof request;
        process: unknown;
        handleLine: (child: unknown, line: string) => void;
      };
      internal.request = request;
      await server.startThread({
        cwd: '/isolated/project',
        modelId: null,
        dynamicTools,
        dynamicToolHandler: handler,
      });

      const writes: string[] = [];
      const child = {
        stdin: {
          write(payload: string, callback?: (error?: Error | null) => void) {
            writes.push(payload);
            callback?.();
            return true;
          },
        },
      };
      internal.process = child;
      deliverEarlyCall = () =>
        internal.handleLine(
          child,
          JSON.stringify({
            id: 94,
            method: 'item/tool/call',
            params: {
              threadId: 'thread-early',
              turnId: 'turn-early',
              callId: 'call-early',
              namespace: null,
              tool: 'read_objective',
              arguments: {},
            },
          }),
        );

      const turn = server.runTurn({
        threadId: 'thread-early',
        prompt: 'Read the objective',
        requestedModelId: null,
        reasoningOptionId: null,
        cwd: '/isolated/project',
      });
      if (rejects) {
        await expect(turn).rejects.toThrow('codex_dynamic_tool_turn_mismatch');
      } else {
        await expect(turn).resolves.toMatchObject({ turnId: 'turn-early' });
      }
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      expect(handler).toHaveBeenCalledOnce();
    },
  );

  it('fails closed for undeclared, malformed, duplicate, and invalid-result dynamic calls', async () => {
    const dynamicTools: readonly CodexDynamicToolSpec[] = [
      {
        type: 'function',
        name: 'read_board',
        description: 'Read the current project board',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
    ];
    let invalidResultDelivery: Promise<'delivered' | 'discarded' | 'uncertain'> | undefined;
    const handler = vi.fn(async (_call, delivery) => {
      invalidResultDelivery = delivery.outcome;
      return {
        contentItems: [{ type: 'inputImage' as const, imageUrl: 'https://invalid.test/a.png' }],
        success: true,
      };
    });
    const server = new CodexAppServer();
    vi.spyOn(server, 'start').mockResolvedValue();
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/start') return { thread: { id: 'thread-strict' } };
      if (method === 'mcpServerStatus/list') return { data: [] };
      throw new Error('unexpected_request');
    });
    const internal = server as unknown as {
      request: typeof request;
      process: unknown;
      handleLine: (child: unknown, line: string) => void;
    };
    internal.request = request;
    await server.startThread({
      cwd: '/isolated/project',
      modelId: null,
      dynamicTools,
      dynamicToolHandler: handler as never,
    });

    const writes: string[] = [];
    const child = {
      stdin: {
        write(payload: string, callback?: (error?: Error | null) => void) {
          writes.push(payload);
          callback?.();
          return true;
        },
      },
    };
    internal.process = child;
    const send = (id: number, params: Record<string, unknown>) =>
      internal.handleLine(child, JSON.stringify({ id, method: 'item/tool/call', params }));
    const base = {
      threadId: 'thread-strict',
      turnId: 'turn-strict',
      tool: 'read_board',
      arguments: {},
    };
    send(101, { ...base, callId: 'unknown-route', tool: 'read_note' });
    send(102, { ...base, callId: 'extra-field', unexpected: true });
    send(103, { ...base, callId: 'invalid-result' });
    await vi.waitFor(() => expect(writes).toHaveLength(3));
    send(104, { ...base, callId: 'invalid-result' });
    await vi.waitFor(() => expect(writes).toHaveLength(4));

    expect(JSON.parse(writes[0]!)).toMatchObject({ id: 101, error: { code: -32602 } });
    expect(JSON.parse(writes[1]!)).toMatchObject({ id: 102, error: { code: -32602 } });
    expect(JSON.parse(writes[2]!)).toEqual({
      id: 103,
      result: {
        contentItems: [
          { type: 'inputText', text: 'GOSU dynamic tool returned an invalid result.' },
        ],
        success: false,
      },
    });
    expect(JSON.parse(writes[3]!)).toEqual({
      id: 104,
      result: {
        contentItems: [{ type: 'inputText', text: 'GOSU dynamic tool limit exceeded.' }],
        success: false,
      },
    });
    expect(handler).toHaveBeenCalledOnce();
    await expect(invalidResultDelivery).resolves.toBe('discarded');
  });

  it('discards a timed-out dynamic tool delivery and ignores its late result', async () => {
    const dynamicTools: readonly CodexDynamicToolSpec[] = [
      {
        type: 'function',
        name: 'read_note',
        description: 'Read one project note',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
    ];
    const server = new CodexAppServer();
    vi.spyOn(server, 'start').mockResolvedValue();
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/start') return { thread: { id: 'thread-timeout' } };
      if (method === 'mcpServerStatus/list') return { data: [] };
      throw new Error('unexpected_request');
    });
    const internal = server as unknown as {
      request: typeof request;
      process: unknown;
      handleLine: (child: unknown, line: string) => void;
    };
    internal.request = request;
    let resolveLateResult!: (result: {
      contentItems: Array<{ type: 'inputText'; text: string }>;
      success: boolean;
    }) => void;
    let deliveryOutcome: Promise<'delivered' | 'discarded' | 'uncertain'> | undefined;
    await server.startThread({
      cwd: '/isolated/project',
      modelId: null,
      dynamicTools,
      dynamicToolHandler: (_call, delivery) => {
        deliveryOutcome = delivery.outcome;
        return new Promise((resolve) => {
          resolveLateResult = resolve;
        });
      },
    });

    const writes: string[] = [];
    const child = {
      stdin: {
        write(payload: string, callback?: (error?: Error | null) => void) {
          writes.push(payload);
          callback?.();
          return true;
        },
      },
    };
    internal.process = child;
    vi.useFakeTimers();
    try {
      internal.handleLine(
        child,
        JSON.stringify({
          id: 111,
          method: 'item/tool/call',
          params: {
            threadId: 'thread-timeout',
            turnId: 'turn-timeout',
            callId: 'call-timeout',
            namespace: null,
            tool: 'read_note',
            arguments: {},
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(10_000);
      expect(writes).toHaveLength(1);
      expect(JSON.parse(writes[0]!)).toEqual({
        id: 111,
        result: {
          contentItems: [{ type: 'inputText', text: 'GOSU dynamic tool failed.' }],
          success: false,
        },
      });
      await expect(deliveryOutcome).resolves.toBe('discarded');
      resolveLateResult({
        contentItems: [{ type: 'inputText', text: '{"late":true}' }],
        success: true,
      });
      await Promise.resolve();
      expect(writes).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a duplicate provider thread ID without replacing or unsubscribing its owner', async () => {
    const dynamicTools: readonly CodexDynamicToolSpec[] = [
      {
        type: 'function',
        name: 'read_board',
        description: 'Read the current board',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
    ];
    const firstHandler = vi.fn(async () => ({
      contentItems: [{ type: 'inputText' as const, text: '{"owner":"first"}' }],
      success: true,
    }));
    const secondHandler = vi.fn(async () => ({
      contentItems: [{ type: 'inputText' as const, text: '{"owner":"second"}' }],
      success: true,
    }));
    const server = new CodexAppServer();
    vi.spyOn(server, 'start').mockResolvedValue();
    let releaseInventory!: () => void;
    let inventoryCalls = 0;
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/start') return { thread: { id: 'thread-collision' } };
      if (method === 'mcpServerStatus/list') {
        inventoryCalls += 1;
        await new Promise<void>((resolve) => {
          releaseInventory = resolve;
        });
        return { data: [] };
      }
      if (method === 'thread/unsubscribe') return {};
      throw new Error('unexpected_request');
    });
    const internal = server as unknown as {
      request: typeof request;
      dynamicToolRegistrations: Map<string, { handler: CodexDynamicToolHandler }>;
    };
    internal.request = request;

    const firstStart = server.startThread({
      cwd: '/isolated/first',
      modelId: null,
      dynamicTools,
      dynamicToolHandler: firstHandler,
    });
    await vi.waitFor(() => expect(inventoryCalls).toBe(1));
    await expect(
      server.startThread({
        cwd: '/isolated/second',
        modelId: null,
        dynamicTools,
        dynamicToolHandler: secondHandler,
      }),
    ).rejects.toThrow('codex_thread_id_collision');
    expect(inventoryCalls).toBe(1);
    releaseInventory();
    await expect(firstStart).resolves.toEqual({ threadId: 'thread-collision' });

    expect(internal.dynamicToolRegistrations.get('thread-collision')?.handler).toBe(firstHandler);
    expect(request).not.toHaveBeenCalledWith('thread/unsubscribe', {
      threadId: 'thread-collision',
    });
  });

  it('revokes a slow handler before it can return note text after terminal sealing', async () => {
    const dynamicTools: readonly CodexDynamicToolSpec[] = [
      {
        type: 'function',
        name: 'read_note',
        description: 'Read one note',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
    ];
    let resolveResult!: (result: {
      contentItems: Array<{ type: 'inputText'; text: string }>;
      success: boolean;
    }) => void;
    let outcome: Promise<'delivered' | 'discarded' | 'uncertain'> | undefined;
    const handler: CodexDynamicToolHandler = (_call, delivery) => {
      outcome = delivery.outcome;
      return new Promise((resolve) => {
        resolveResult = resolve;
      });
    };
    const server = new CodexAppServer();
    vi.spyOn(server, 'start').mockResolvedValue();
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/start') return { thread: { id: 'thread-revoke' } };
      if (method === 'mcpServerStatus/list') return { data: [] };
      throw new Error('unexpected_request');
    });
    const internal = server as unknown as {
      request: typeof request;
      process: unknown;
      handleLine: (child: unknown, line: string) => void;
    };
    internal.request = request;
    await server.startThread({
      cwd: '/isolated/project',
      modelId: null,
      dynamicTools,
      dynamicToolHandler: handler,
    });
    const writes: string[] = [];
    const child = {
      stdin: {
        write(payload: string, callback?: (error?: Error | null) => void) {
          writes.push(payload);
          callback?.();
          return true;
        },
      },
    };
    internal.process = child;
    internal.handleLine(
      child,
      JSON.stringify({
        id: 112,
        method: 'item/tool/call',
        params: {
          threadId: 'thread-revoke',
          turnId: 'turn-revoke',
          callId: 'call-revoke',
          namespace: null,
          tool: 'read_note',
          arguments: {},
        },
      }),
    );
    await vi.waitFor(() => expect(outcome).toBeDefined());

    server.revokeDynamicTools('thread-revoke');
    await expect(outcome).resolves.toBe('discarded');
    resolveResult({
      contentItems: [{ type: 'inputText', text: 'PRIVATE_LATE_NOTE_TEXT' }],
      success: true,
    });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).not.toContain('PRIVATE_LATE_NOTE_TEXT');
    expect(JSON.parse(writes[0]!)).toMatchObject({ id: 112, error: { code: -32000 } });
  });

  it('requires paired tool specs and handlers and removes registrations on release or disconnect', async () => {
    const dynamicTools: readonly CodexDynamicToolSpec[] = [
      {
        type: 'function',
        name: 'read_objective',
        description: 'Read the current objective',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
    ];
    const handler = vi.fn(async () => ({
      contentItems: [{ type: 'inputText' as const, text: '{}' }],
      success: true,
    }));
    const server = new CodexAppServer();
    vi.spyOn(server, 'start').mockResolvedValue();
    let nextThread = 1;
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/start') return { thread: { id: `thread-clean-${nextThread++}` } };
      if (method === 'mcpServerStatus/list') return { data: [] };
      if (method === 'thread/unsubscribe') return {};
      throw new Error('unexpected_request');
    });
    const internal = server as unknown as {
      request: typeof request;
      process: unknown;
      dynamicToolRegistrations: Map<string, unknown>;
    };
    internal.request = request;

    await expect(
      server.startThread({ cwd: '/isolated/project', modelId: null, dynamicTools }),
    ).rejects.toThrow('codex_dynamic_tool_handler_required');
    await expect(
      server.startThread({
        cwd: '/isolated/project',
        modelId: null,
        dynamicToolHandler: handler,
      }),
    ).rejects.toThrow('codex_dynamic_tool_specs_required');

    const first = await server.startThread({
      cwd: '/isolated/project',
      modelId: null,
      dynamicTools,
      dynamicToolHandler: handler,
    });
    expect(internal.dynamicToolRegistrations.has(first.threadId)).toBe(true);
    await server.releaseThread(first.threadId);
    expect(internal.dynamicToolRegistrations.has(first.threadId)).toBe(false);

    const second = await server.startThread({
      cwd: '/isolated/project',
      modelId: null,
      dynamicTools,
      dynamicToolHandler: handler,
    });
    expect(internal.dynamicToolRegistrations.has(second.threadId)).toBe(true);
    internal.process = { exitCode: 0, killed: false };
    server.stop();
    expect(internal.dynamicToolRegistrations.size).toBe(0);
  });

  it('disables external tool feature families for the entire isolated App Server process', () => {
    const arguments_ = buildCodexAppServerArguments(['/bundled/codex.js']);
    expect(arguments_.slice(0, 3)).toEqual(['/bundled/codex.js', 'app-server', '--strict-config']);
    for (const feature of [
      'apps',
      'browser_use',
      'computer_use',
      'image_generation',
      'plugins',
      'remote_plugin',
      'shell_tool',
      'unified_exec',
    ]) {
      expect(arguments_).toContain(feature);
      expect(arguments_[arguments_.indexOf(feature) - 1]).toBe('--disable');
    }
    expect(arguments_).toContain('history.persistence="none"');
    expect(arguments_).toContain('analytics.enabled=false');
  });

  it('parses the generated thread/start response shape without reading a model from Thread', () => {
    expect(
      parseCodexThreadStartResponse({
        thread: { id: '019c-thread' },
        model: 'provider-resolved-model',
        modelProvider: 'openai',
      }),
    ).toEqual({ threadId: '019c-thread' });
    expect(() => parseCodexThreadStartResponse({ thread: {}, model: 'model' })).toThrow(
      'codex_thread_id_missing',
    );
  });

  it('fails closed when a project thread exposes any configured MCP server', () => {
    expect(() => assertNoProjectMcpServers({ data: [] })).not.toThrow();
    expect(() =>
      assertNoProjectMcpServers({ data: [{ name: 'personal-filesystem-server' }] }),
    ).toThrow('codex_project_tools_not_isolated');
    expect(() => assertNoProjectMcpServers({})).toThrow('codex_mcp_inventory_invalid');
  });

  it('declines privileged server requests and rejects unsupported ones', () => {
    expect(codexServerRequestResponse('item/commandExecution/requestApproval')).toEqual({
      result: { decision: 'decline' },
    });
    expect(codexServerRequestResponse('item/fileChange/requestApproval')).toEqual({
      result: { decision: 'decline' },
    });
    expect(codexServerRequestResponse('item/tool/requestUserInput')).toEqual({
      error: {
        code: -32601,
        message: 'GOSU does not expose this Codex request.',
      },
    });
  });
});
