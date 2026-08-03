import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path';

import type { ModelCatalog, ModelInvocation } from '@gosu/contracts';

import type { CodexAvailability } from '../shared/runtime-contracts';
import { createInvocation, recordModelReroute, toModelCatalog } from './model-catalog';

export type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description: string }>;
  inputModalities?: string[];
  upgrade?: string | null;
};

type JsonRpcMessage = {
  id?: string | number;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string };
  params?: unknown;
};

const SAFE_PROJECT_CONFIG = {
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
} as const;

export const SAFE_CODEX_PROCESS_DISABLED_FEATURES = [
  'apps',
  'auth_elicitation',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'code_mode',
  'code_mode_host',
  'computer_use',
  'enable_mcp_apps',
  'goals',
  'hooks',
  'image_generation',
  'in_app_browser',
  'in_app_updates',
  'memories',
  'multi_agent',
  'plugin_sharing',
  'plugins',
  'remote_plugin',
  'shell_snapshot',
  'shell_tool',
  'skill_mcp_dependency_install',
  'skill_search',
  'tool_call_mcp_elicitation',
  'tool_suggest',
  'unified_exec',
  'workspace_dependencies',
] as const;

export const SAFE_CODEX_PROCESS_CONFIG_OVERRIDES = [
  'analytics.enabled=false',
  'history.persistence="none"',
  'otel.exporter="none"',
  'otel.log_user_prompt=false',
] as const;

export function buildCodexAppServerArguments(prefixArguments: readonly string[]) {
  return [
    ...prefixArguments,
    'app-server',
    '--strict-config',
    ...SAFE_CODEX_PROCESS_DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
    ...SAFE_CODEX_PROCESS_CONFIG_OVERRIDES.flatMap((override) => ['--config', override]),
    '--listen',
    'stdio://',
  ];
}

const PROJECT_CHAT_BASE_INSTRUCTIONS = `You are a text-only research project assistant inside GOSU.
You have no tools and must not attempt to access files, commands, networks, apps, plugins, or other
projects. Use only the project context and user message supplied in the current turn. Return only the
structured response requested by the client.`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseCodexThreadStartResponse(value: unknown) {
  if (!isRecord(value) || !isRecord(value.thread) || typeof value.thread.id !== 'string') {
    throw new Error('codex_thread_id_missing');
  }
  return { threadId: value.thread.id } as const;
}

export function assertNoProjectMcpServers(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error('codex_mcp_inventory_invalid');
  }
  if (value.data.length > 0) throw new Error('codex_project_tools_not_isolated');
}

export function buildCodexThreadParameters(input: {
  cwd: string;
  modelId: string | null;
  developerInstructions?: string;
}) {
  return {
    cwd: input.cwd,
    serviceName: 'gosu_desktop',
    approvalPolicy: 'never',
    sandbox: 'read-only',
    config: SAFE_PROJECT_CONFIG,
    baseInstructions: PROJECT_CHAT_BASE_INSTRUCTIONS,
    ephemeral: true,
    environments: [],
    dynamicTools: [],
    runtimeWorkspaceRoots: [],
    selectedCapabilityRoots: [],
    ...(input.developerInstructions ? { developerInstructions: input.developerInstructions } : {}),
    ...(input.modelId ? { model: input.modelId } : {}),
  } as const;
}

export function buildCodexTurnParameters(input: {
  threadId: string;
  prompt: string;
  requestedModelId: string | null;
  reasoningOptionId: string | null;
  cwd: string;
  clientUserMessageId?: string;
  outputSchema?: Readonly<Record<string, unknown>>;
}) {
  return {
    threadId: input.threadId,
    ...(input.clientUserMessageId ? { clientUserMessageId: input.clientUserMessageId } : {}),
    input: [{ type: 'text', text: input.prompt, text_elements: [] }],
    cwd: input.cwd,
    environments: [],
    runtimeWorkspaceRoots: [],
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
    ...(input.requestedModelId ? { model: input.requestedModelId } : {}),
    ...(input.reasoningOptionId ? { effort: input.reasoningOptionId } : {}),
    ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
  } as const;
}

export function codexServerRequestResponse(method: string) {
  return method === 'item/commandExecution/requestApproval' ||
    method === 'item/fileChange/requestApproval'
    ? ({ result: { decision: 'decline' } } as const)
    : ({
        error: { code: -32601, message: 'GOSU does not expose this Codex request.' },
      } as const);
}

const require = createRequire(import.meta.url);

export function resolveUnpackedAsarPath(filePath: string) {
  const asarSegment = `${sep}app.asar${sep}`;
  return filePath.replace(asarSegment, `${sep}app.asar.unpacked${sep}`);
}

const CODEX_CHILD_ENVIRONMENT_KEYS = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'GIT_SSL_CAINFO',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
] as const;

const CODEX_LOG_LEVELS = new Set(['off', 'error', 'warn', 'info', 'debug', 'trace']);

export function buildCodexChildEnvironment(
  source: NodeJS.ProcessEnv,
  runAsNode: boolean,
  requestedLogLevel?: string,
  isolatedCodexHome?: string,
  volatileSqliteHome?: string,
) {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of CODEX_CHILD_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }

  const normalizedLogLevel = requestedLogLevel?.trim().toLowerCase();
  environment.RUST_LOG =
    normalizedLogLevel && CODEX_LOG_LEVELS.has(normalizedLogLevel) ? normalizedLogLevel : 'warn';
  if (isolatedCodexHome) environment.CODEX_HOME = isolatedCodexHome;
  if (volatileSqliteHome) environment.CODEX_SQLITE_HOME = volatileSqliteHome;
  if (runAsNode) environment.ELECTRON_RUN_AS_NODE = '1';
  return environment;
}

export async function prepareIsolatedCodexHome(isolatedCodexHome: string, sharedAuthFile?: string) {
  if (!isAbsolute(isolatedCodexHome)) throw new Error('codex_home_must_be_absolute');
  await mkdir(isolatedCodexHome, { recursive: true, mode: 0o700 });
  await chmod(isolatedCodexHome, 0o700);
  if (!sharedAuthFile) return isolatedCodexHome;

  const isolatedAuthFile = join(isolatedCodexHome, 'auth.json');
  const importMarker = join(isolatedCodexHome, '.shared-auth-imported-v1');
  if (resolve(sharedAuthFile) === resolve(isolatedAuthFile)) return isolatedCodexHome;
  try {
    await access(importMarker, constants.F_OK);
    return isolatedCodexHome;
  } catch {
    // Continue only when the one-time import has never completed.
  }

  let isolatedAuthReady = false;
  try {
    await access(isolatedAuthFile, constants.F_OK);
    isolatedAuthReady = true;
  } catch {
    try {
      await copyFile(sharedAuthFile, isolatedAuthFile, constants.COPYFILE_EXCL);
      await chmod(isolatedAuthFile, 0o600);
      isolatedAuthReady = true;
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
      if (code === 'EEXIST') isolatedAuthReady = true;
      else if (code !== 'ENOENT') throw error;
    }
  }
  if (isolatedAuthReady) {
    try {
      await writeFile(importMarker, 'imported\n', { flag: 'wx', mode: 0o600 });
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
      if (code !== 'EEXIST') throw error;
    }
  }
  return isolatedCodexHome;
}

function codexCommand() {
  const override = process.env.GOSU_CODEX_BIN?.trim();
  if (override) return { executable: override, prefixArgs: [] as string[], runAsNode: false };

  const packagePath = resolveUnpackedAsarPath(require.resolve('@openai/codex/package.json'));
  return {
    executable: process.execPath,
    prefixArgs: [join(dirname(packagePath), 'bin', 'codex.js')],
    runAsNode: true,
  };
}

async function executableIsAvailable(executable: string, pathEnvironment = '') {
  const hasPath = isAbsolute(executable) || executable.includes(sep);
  const candidates = hasPath
    ? [executable]
    : pathEnvironment
        .split(delimiter)
        .filter(Boolean)
        .map((entry) => resolve(entry, executable));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Continue through the bounded PATH candidates.
    }
  }
  return false;
}

export class CodexAppServer extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private readonly pending = new Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }
  >();

  constructor(
    private readonly options: {
      isolatedCodexHome?: () => string;
      sharedAuthFile?: () => string | undefined;
    } = {},
  ) {
    super();
  }

  async availability(): Promise<CodexAvailability> {
    try {
      const command = codexCommand();
      const executableReady = await executableIsAvailable(command.executable, process.env.PATH);
      const entryReady =
        command.prefixArgs.length === 0 ||
        (await access(command.prefixArgs[0]!, constants.R_OK).then(
          () => true,
          () => false,
        ));
      if (!executableReady || !entryReady) throw new Error('codex_executable_unavailable');
      return {
        ready: true,
        detail: command.runAsNode ? 'bundled_codex_ready' : 'configured_codex_ready',
      };
    } catch {
      return { ready: false, detail: 'codex_executable_unavailable' };
    }
  }
  private starting: Promise<void> | undefined;
  private catalog: ModelCatalog | undefined;
  private readonly invocations = new Map<
    string,
    { threadId: string; invocation: ModelInvocation }
  >();
  private readonly earlyReroutes = new Map<string, { threadId: string; toModel: string }>();
  private readonly volatileStateHomes = new Map<ChildProcessWithoutNullStreams, string>();

  async start() {
    if (this.starting) return this.starting;
    if (this.process) return;

    const attempt = this.startInternal();
    this.starting = attempt;
    try {
      await attempt;
    } finally {
      if (this.starting === attempt) this.starting = undefined;
    }
  }

  async status() {
    try {
      await this.start();
      return await this.request('account/read', { refreshToken: false });
    } catch (error) {
      return {
        account: null,
        unavailable: true,
        error: error instanceof Error ? error.message : 'codex_unavailable',
      };
    }
  }

  async listModels(): Promise<CodexModel[]> {
    await this.start();
    const models = new Map<string, CodexModel>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const result = (await this.request('model/list', {
        limit: 100,
        includeHidden: false,
        ...(cursor ? { cursor } : {}),
      })) as {
        data?: CodexModel[];
        nextCursor?: string | null;
      };
      for (const model of result.data ?? []) {
        if (models.has(model.id)) throw new Error('codex_model_catalog_duplicate_model');
        if (!model.hidden) models.set(model.id, model);
      }
      const nextCursor = result.nextCursor;
      if (!nextCursor) return [...models.values()];
      if (seenCursors.has(nextCursor)) throw new Error('codex_model_catalog_pagination_loop');
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new Error('codex_model_catalog_page_limit');
  }

  async listModelCatalog() {
    this.catalog = toModelCatalog(await this.listModels());
    this.emitBoundaryEvent('catalog', this.catalog);
    return this.catalog;
  }

  async startThread(input: {
    cwd: string;
    modelId: string | null;
    developerInstructions?: string;
  }) {
    await this.start();
    const result = await this.request('thread/start', buildCodexThreadParameters(input));
    const started = parseCodexThreadStartResponse(result);
    try {
      await this.assertThreadHasNoMcpServers(started.threadId);
    } catch (error) {
      await this.request('thread/unsubscribe', { threadId: started.threadId }).catch(
        () => undefined,
      );
      throw error;
    }
    return started;
  }

  async runTurn(input: {
    threadId: string;
    prompt: string;
    requestedModelId: string | null;
    reasoningOptionId: string | null;
    cwd: string;
    clientUserMessageId?: string;
    outputSchema?: Readonly<Record<string, unknown>>;
  }) {
    await this.start();
    const catalog = this.catalog ?? (await this.listModelCatalog());
    let invocation = createInvocation({
      catalog,
      requestedModelId: input.requestedModelId,
      reasoningOptionId: input.reasoningOptionId,
    });
    const result = (await this.request(
      'turn/start',
      buildCodexTurnParameters({
        ...input,
        requestedModelId: invocation.resolvedModelId,
      }),
    )) as {
      turn?: { id?: string };
    };
    const turnId = result.turn?.id;
    if (!turnId) throw new Error('codex_turn_id_missing');
    const earlyReroute = this.earlyReroutes.get(turnId);
    this.earlyReroutes.delete(turnId);
    if (earlyReroute?.threadId === input.threadId) {
      invocation = recordModelReroute(invocation, earlyReroute.toModel);
    }
    this.invocations.set(turnId, { threadId: input.threadId, invocation });
    this.emitBoundaryEvent('invocation', { threadId: input.threadId, turnId, invocation });
    return { turnId, invocation };
  }

  async interruptTurn(threadId: string, turnId: string) {
    await this.request('turn/interrupt', { threadId, turnId });
  }

  async releaseThread(threadId: string) {
    await this.request('thread/unsubscribe', { threadId });
    for (const [turnId, entry] of this.invocations) {
      if (entry.threadId === threadId) this.invocations.delete(turnId);
    }
  }

  async loginChatGpt() {
    await this.start();
    return this.request('account/login/start', {
      type: 'chatgpt',
      useHostedLoginSuccessPage: true,
      appBrand: 'codex',
    });
  }

  async loginApiKey(apiKey: string) {
    if (!apiKey.trim()) throw new Error('api_key_required');
    await this.start();
    return this.request('account/login/start', { type: 'apiKey', apiKey });
  }

  async logout() {
    await this.start();
    return this.request('account/logout', {});
  }

  stop() {
    const child = this.process;
    if (child) this.disconnect(child, new Error('codex_app_server_stopped'), true);
  }

  private async startInternal() {
    const command = codexCommand();
    const isolatedCodexHome = this.options.isolatedCodexHome
      ? await prepareIsolatedCodexHome(
          this.options.isolatedCodexHome(),
          this.options.sharedAuthFile?.(),
        )
      : undefined;
    const volatileSqliteHome = await mkdtemp(join(tmpdir(), 'gosu-codex-runtime-'));
    await chmod(volatileSqliteHome, 0o700);
    const child = spawn(command.executable, buildCodexAppServerArguments(command.prefixArgs), {
      env: buildCodexChildEnvironment(
        process.env,
        command.runAsNode,
        process.env.GOSU_CODEX_LOG,
        isolatedCodexHome,
        volatileSqliteHome,
      ),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.volatileStateHomes.set(child, volatileSqliteHome);
    this.process = child;
    child.once('error', (error) =>
      this.disconnect(child, new Error(`Unable to start Codex: ${error.message}`)),
    );
    child.once('exit', (code, signal) =>
      this.disconnect(child, new Error(`Codex exited (${code ?? signal ?? 'unknown'})`)),
    );
    createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(child, line));
    createInterface({ input: child.stderr }).on('line', (line) => {
      if (this.process === child)
        this.emitBoundaryEvent('diagnostic', line.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]'));
    });

    try {
      await this.request('initialize', {
        clientInfo: { name: 'gosu_desktop', title: 'GOSU', version: '0.3.1' },
        capabilities: { experimentalApi: true },
      });
      if (this.process !== child) throw new Error('codex_app_server_initialization_interrupted');
      this.notify('initialized', {});
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('codex_initialize_failed');
      this.disconnect(child, failure, true);
      throw failure;
    }
  }

  private request(method: string, params: unknown) {
    const child = this.process;
    if (!child) return Promise.reject(new Error('codex_app_server_not_started'));
    const id = this.nextId++;
    const payload = `${JSON.stringify({ method, id, params })}\n`;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        child.stdin.write(payload, (error) => {
          if (!error) return;
          const entry = this.pending.get(id);
          if (!entry) return;
          clearTimeout(entry.timeout);
          this.pending.delete(id);
          entry.reject(error);
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error('codex_request_write_failed'));
      }
    });
  }

  private async assertThreadHasNoMcpServers(threadId: string) {
    const inventory = await this.request('mcpServerStatus/list', {
      threadId,
      limit: 100,
      detail: 'toolsAndAuthOnly',
    });
    assertNoProjectMcpServers(inventory);
  }

  private notify(method: string, params: unknown) {
    const child = this.process;
    if (!child) return;
    try {
      child.stdin.write(`${JSON.stringify({ method, params })}\n`, (error) => {
        if (error && this.process === child)
          this.emitBoundaryEvent('diagnostic', 'Codex notification failed');
      });
    } catch {
      if (this.process === child) this.emitBoundaryEvent('diagnostic', 'Codex notification failed');
    }
  }

  private handleLine(child: ChildProcessWithoutNullStreams, line: string) {
    if (this.process !== child) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.emitBoundaryEvent('diagnostic', 'Ignored non-JSON Codex output');
      return;
    }
    if (message.id !== undefined && !message.method) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timeout);
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else entry.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.handleServerRequest(child, message);
      return;
    }
    if (message.method === 'model/rerouted') {
      const reroute = message.params as { threadId?: string; turnId?: string; toModel?: string };
      const current = reroute.turnId ? this.invocations.get(reroute.turnId) : undefined;
      if (current && current.threadId === reroute.threadId && reroute.toModel) {
        const invocation = recordModelReroute(current.invocation, reroute.toModel);
        this.invocations.set(reroute.turnId!, { ...current, invocation });
        this.emitBoundaryEvent('invocation', {
          threadId: current.threadId,
          turnId: reroute.turnId,
          invocation,
        });
      } else if (!current && reroute.threadId && reroute.turnId && reroute.toModel) {
        if (this.earlyReroutes.size >= 256) {
          const oldestTurnId = this.earlyReroutes.keys().next().value as string | undefined;
          if (oldestTurnId) this.earlyReroutes.delete(oldestTurnId);
        }
        this.earlyReroutes.set(reroute.turnId, {
          threadId: reroute.threadId,
          toModel: reroute.toModel,
        });
      }
    }
    if (message.method) {
      this.emitBoundaryEvent('notification', { method: message.method, params: message.params });
      if (message.method === 'turn/completed') {
        const turn = isRecord(message.params) ? message.params.turn : undefined;
        const threadId = isRecord(message.params) ? message.params.threadId : undefined;
        const turnId = isRecord(turn) && typeof turn.id === 'string' ? turn.id : undefined;
        if (turnId) {
          const current = this.invocations.get(turnId);
          if (current?.threadId === threadId) this.invocations.delete(turnId);
          const earlyReroute = this.earlyReroutes.get(turnId);
          if (earlyReroute?.threadId === threadId) this.earlyReroutes.delete(turnId);
        }
      }
    }
  }

  private handleServerRequest(child: ChildProcessWithoutNullStreams, message: JsonRpcMessage) {
    if (message.id === undefined || !message.method) return;
    const response = codexServerRequestResponse(message.method);
    if ('result' in response) this.respond(child, message.id, response.result);
    else this.respond(child, message.id, undefined, response.error);
  }

  private respond(
    child: ChildProcessWithoutNullStreams,
    id: string | number,
    result?: unknown,
    error?: { code: number; message: string },
  ) {
    if (this.process !== child) return;
    const payload = `${JSON.stringify(error ? { id, error } : { id, result })}\n`;
    try {
      child.stdin.write(payload, (writeError) => {
        if (writeError && this.process === child)
          this.emitBoundaryEvent('diagnostic', 'Codex response failed');
      });
    } catch {
      if (this.process === child) this.emitBoundaryEvent('diagnostic', 'Codex response failed');
    }
  }

  private disconnect(child: ChildProcessWithoutNullStreams, error: Error, terminate = false) {
    if (this.process !== child) return;
    this.process = undefined;
    if (terminate && child.exitCode === null && !child.killed) child.kill('SIGTERM');
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
    this.pending.clear();
    this.catalog = undefined;
    this.invocations.clear();
    this.earlyReroutes.clear();
    const volatileStateHome = this.volatileStateHomes.get(child);
    this.volatileStateHomes.delete(child);
    if (volatileStateHome) {
      const cleanup = () => void rm(volatileStateHome, { recursive: true, force: true });
      if (child.exitCode === null) child.once('close', cleanup);
      else cleanup();
    }
    this.emitBoundaryEvent('diagnostic', error.message);
    this.emitBoundaryEvent('disconnected');
  }

  private emitBoundaryEvent(eventName: string, ...arguments_: unknown[]) {
    try {
      this.emit(eventName, ...arguments_);
    } catch {
      // Observability and renderer listeners must never break the Codex protocol state machine.
    }
  }
}
