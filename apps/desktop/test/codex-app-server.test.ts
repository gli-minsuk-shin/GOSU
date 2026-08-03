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
      baseInstructions: expect.stringContaining('text-only research project assistant'),
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
