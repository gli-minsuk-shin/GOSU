import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path';

import type { ModelCatalog, ModelInvocation } from '@gosu/contracts';

import {
  CodexCollaborationModeCatalogSchema,
  CodexCollaborationModeDescriptorSchema,
  type CodexCollaborationModeCatalog,
  type CodexCollaborationModeDescriptor,
  type ProjectChatPersonality,
  type ProjectChatResponseVerbosity,
} from '../shared/project-chat-contracts';
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
  supportsPersonality?: boolean;
  upgrade?: string | null;
};

export type CodexPersonality = Exclude<ProjectChatPersonality, 'auto'>;
export type CodexResponseVerbosity = Exclude<ProjectChatResponseVerbosity, 'auto'>;

export type CodexJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CodexJsonValue[]
  | { readonly [key: string]: CodexJsonValue };

export type CodexDynamicToolFunctionSpec = Readonly<{
  type: 'function';
  name: string;
  description: string;
  inputSchema: CodexJsonValue;
  deferLoading?: boolean;
}>;

export type CodexDynamicToolNamespaceSpec = Readonly<{
  type: 'namespace';
  name: string;
  description: string;
  tools: readonly CodexDynamicToolFunctionSpec[];
}>;

export type CodexDynamicToolSpec = CodexDynamicToolFunctionSpec | CodexDynamicToolNamespaceSpec;

export type CodexDynamicToolCall = Readonly<{
  threadId: string;
  turnId: string;
  callId: string;
  namespace: string | null;
  tool: string;
  arguments: CodexJsonValue;
}>;

export type CodexDynamicToolResult = Readonly<{
  contentItems: readonly Readonly<{ type: 'inputText'; text: string }>[];
  success: boolean;
}>;

export type CodexDynamicToolDeliveryOutcome = 'delivered' | 'discarded' | 'uncertain';

export type CodexDynamicToolDelivery = Readonly<{
  outcome: Promise<CodexDynamicToolDeliveryOutcome>;
}>;

export type CodexDynamicToolHandler = (
  call: CodexDynamicToolCall,
  delivery: CodexDynamicToolDelivery,
) => Promise<CodexDynamicToolResult>;

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

const CODEX_DYNAMIC_TOOL_MAX_TOOLS = 32;
const CODEX_DYNAMIC_TOOL_MAX_CALLS_PER_TURN = 24;
const CODEX_DYNAMIC_TOOL_MAX_CALLS_PER_THREAD = 48;
const CODEX_DYNAMIC_TOOL_MAX_IN_FLIGHT_PER_THREAD = 8;
const CODEX_DYNAMIC_TOOL_MAX_ARGUMENT_CHARACTERS = 32_000;
const CODEX_DYNAMIC_TOOL_MAX_RESULT_ITEMS = 8;
const CODEX_DYNAMIC_TOOL_MAX_RESULT_CHARACTERS = 64_000;
const CODEX_DYNAMIC_TOOL_TIMEOUT_MS = 10_000;
const CODEX_DYNAMIC_TOOL_RESPONSE_ACK_TIMEOUT_MS = 1_000;
const CODEX_COLLABORATION_MODE_MAX_ITEMS = 64;
const CODEX_COLLABORATION_MODE_MAX_ID_CHARACTERS = 128;
const CODEX_COLLABORATION_MODE_MAX_NAME_CHARACTERS = 256;
const CODEX_COLLABORATION_MODE_MAX_MODEL_CHARACTERS = 256;
const CODEX_COLLABORATION_MODE_MAX_REASONING_CHARACTERS = 128;

const CODEX_PERSONALITIES = new Set<CodexPersonality>(['none', 'friendly', 'pragmatic']);
const CODEX_RESPONSE_VERBOSITIES = new Set<CodexResponseVerbosity>(['low', 'medium', 'high']);

type DynamicToolRegistration = {
  readonly tools: ReadonlySet<string>;
  readonly handler: CodexDynamicToolHandler;
  readonly callsByTurn: Map<string, number>;
  readonly seenCalls: Set<string>;
  readonly deliveries: Set<DynamicToolDeliveryController>;
  boundTurnId: string | null;
  inFlight: number;
};

type DynamicToolDeliveryController = Readonly<{
  signal: CodexDynamicToolDelivery;
  markWriteStarted(): void;
  acknowledge(): void;
  discard(): void;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const allowed = new Set(expected);
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function nullableBoundedString(value: unknown, maximum: number): value is string | null {
  return value === null || boundedString(value, maximum);
}

function dynamicToolKey(namespace: string | null, tool: string) {
  return `${namespace ?? ''}\u0000${tool}`;
}

function createDynamicToolDelivery(): DynamicToolDeliveryController {
  let settled = false;
  let writeStarted = false;
  let resolveOutcome!: (outcome: CodexDynamicToolDeliveryOutcome) => void;
  const outcome = new Promise<CodexDynamicToolDeliveryOutcome>((resolve) => {
    resolveOutcome = resolve;
  });
  const settle = (next: CodexDynamicToolDeliveryOutcome) => {
    if (settled) return;
    settled = true;
    resolveOutcome(next);
  };
  return {
    signal: { outcome },
    markWriteStarted: () => {
      writeStarted = true;
    },
    acknowledge: () => settle('delivered'),
    discard: () => settle(writeStarted ? 'uncertain' : 'discarded'),
  };
}

function prepareDynamicToolRegistration(
  tools: readonly CodexDynamicToolSpec[],
  handler: CodexDynamicToolHandler | undefined,
) {
  if (tools.length === 0) {
    if (handler) throw new Error('codex_dynamic_tool_specs_required');
    return undefined;
  }
  if (!handler) throw new Error('codex_dynamic_tool_handler_required');

  const keys = new Set<string>();
  for (const spec of tools) {
    if (spec.type === 'function') {
      keys.add(dynamicToolKey(null, spec.name));
      continue;
    }
    for (const tool of spec.tools) keys.add(dynamicToolKey(spec.name, tool.name));
  }
  if (keys.size === 0) throw new Error('codex_dynamic_tool_specs_required');
  if (keys.size > CODEX_DYNAMIC_TOOL_MAX_TOOLS) throw new Error('codex_dynamic_tool_limit');
  if (
    keys.size !==
    tools.reduce((count, spec) => count + (spec.type === 'function' ? 1 : spec.tools.length), 0)
  ) {
    throw new Error('codex_dynamic_tool_duplicate');
  }
  return {
    tools: keys,
    handler,
    callsByTurn: new Map<string, number>(),
    seenCalls: new Set<string>(),
    deliveries: new Set<DynamicToolDeliveryController>(),
    boundTurnId: null,
    inFlight: 0,
  } satisfies DynamicToolRegistration;
}

function parseDynamicToolCall(value: unknown): CodexDynamicToolCall | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['threadId', 'turnId', 'callId', 'namespace', 'tool', 'arguments']) ||
    !Object.hasOwn(value, 'arguments') ||
    !boundedString(value.threadId, 256) ||
    !boundedString(value.turnId, 256) ||
    !boundedString(value.callId, 256) ||
    !boundedString(value.tool, 128) ||
    !(
      value.namespace === null ||
      value.namespace === undefined ||
      boundedString(value.namespace, 64)
    )
  ) {
    return null;
  }
  let serializedArguments: string | undefined;
  try {
    serializedArguments = JSON.stringify(value.arguments);
  } catch {
    return null;
  }
  if (
    serializedArguments === undefined ||
    serializedArguments.length > CODEX_DYNAMIC_TOOL_MAX_ARGUMENT_CHARACTERS
  ) {
    return null;
  }
  return {
    threadId: value.threadId,
    turnId: value.turnId,
    callId: value.callId,
    namespace: typeof value.namespace === 'string' ? value.namespace : null,
    tool: value.tool,
    arguments: value.arguments as CodexJsonValue,
  };
}

function failureDynamicToolResult(message: string): CodexDynamicToolResult {
  return { contentItems: [{ type: 'inputText', text: message }], success: false };
}

function parseDynamicToolResult(value: unknown): CodexDynamicToolResult | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['contentItems', 'success']) ||
    typeof value.success !== 'boolean' ||
    !Array.isArray(value.contentItems) ||
    value.contentItems.length > CODEX_DYNAMIC_TOOL_MAX_RESULT_ITEMS
  ) {
    return null;
  }
  let characters = 0;
  const contentItems: Array<{ type: 'inputText'; text: string }> = [];
  for (const item of value.contentItems) {
    if (
      !isRecord(item) ||
      !hasOnlyKeys(item, ['type', 'text']) ||
      item.type !== 'inputText' ||
      typeof item.text !== 'string'
    ) {
      return null;
    }
    characters += item.text.length;
    if (characters > CODEX_DYNAMIC_TOOL_MAX_RESULT_CHARACTERS) return null;
    contentItems.push({ type: 'inputText', text: item.text });
  }
  return { contentItems, success: value.success };
}

export function parseCodexThreadStartResponse(value: unknown) {
  if (!isRecord(value) || !isRecord(value.thread) || typeof value.thread.id !== 'string') {
    throw new Error('codex_thread_id_missing');
  }
  return { threadId: value.thread.id } as const;
}

export function parseCodexCollaborationModeCatalog(
  value: unknown,
): CodexCollaborationModeDescriptor[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error('codex_collaboration_mode_catalog_invalid');
  }
  if (value.data.length > CODEX_COLLABORATION_MODE_MAX_ITEMS) {
    throw new Error('codex_collaboration_mode_catalog_limit');
  }

  const modes = new Map<string, CodexCollaborationModeDescriptor>();
  for (const entry of value.data) {
    if (
      !isRecord(entry) ||
      !boundedString(entry.name, CODEX_COLLABORATION_MODE_MAX_NAME_CHARACTERS) ||
      !(
        entry.mode === null || boundedString(entry.mode, CODEX_COLLABORATION_MODE_MAX_ID_CHARACTERS)
      ) ||
      !nullableBoundedString(entry.model, CODEX_COLLABORATION_MODE_MAX_MODEL_CHARACTERS) ||
      !nullableBoundedString(
        entry.reasoning_effort,
        CODEX_COLLABORATION_MODE_MAX_REASONING_CHARACTERS,
      )
    ) {
      throw new Error('codex_collaboration_mode_catalog_invalid');
    }
    // A null mode is provider metadata, not a selectable collaboration preset.
    if (entry.mode === null) continue;
    if (modes.has(entry.mode)) throw new Error('codex_collaboration_mode_catalog_duplicate');
    const descriptor = CodexCollaborationModeDescriptorSchema.safeParse({
      id: entry.mode,
      displayName: entry.name,
      recommendedModelId: entry.model,
      recommendedReasoningOptionId: entry.reasoning_effort,
    });
    if (!descriptor.success) throw new Error('codex_collaboration_mode_catalog_invalid');
    modes.set(entry.mode, descriptor.data);
  }
  return [...modes.values()];
}

export function toCodexCollaborationModeCatalog(
  modes: readonly CodexCollaborationModeDescriptor[],
): CodexCollaborationModeCatalog {
  const canonicalModes = [...modes].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const catalogVersion = createHash('sha256').update(JSON.stringify(canonicalModes)).digest('hex');
  const parsed = CodexCollaborationModeCatalogSchema.safeParse({
    catalogVersion,
    modes,
  });
  if (!parsed.success) throw new Error('codex_collaboration_mode_catalog_invalid');
  return parsed.data;
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
  dynamicTools?: readonly CodexDynamicToolSpec[];
  responseVerbosity?: CodexResponseVerbosity | null;
}) {
  if (input.responseVerbosity && !CODEX_RESPONSE_VERBOSITIES.has(input.responseVerbosity)) {
    throw new Error('codex_response_verbosity_invalid');
  }
  return {
    cwd: input.cwd,
    serviceName: 'gosu_desktop',
    approvalPolicy: 'never',
    sandbox: 'read-only',
    config: input.responseVerbosity
      ? { ...SAFE_PROJECT_CONFIG, model_verbosity: input.responseVerbosity }
      : SAFE_PROJECT_CONFIG,
    ephemeral: true,
    environments: [],
    dynamicTools: input.dynamicTools ?? [],
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
  collaborationMode?: CodexCollaborationModeDescriptor | null;
  personality?: CodexPersonality | null;
}) {
  if (input.personality && !CODEX_PERSONALITIES.has(input.personality)) {
    throw new Error('codex_personality_invalid');
  }
  if (
    input.collaborationMode &&
    !boundedString(input.collaborationMode.id, CODEX_COLLABORATION_MODE_MAX_ID_CHARACTERS)
  ) {
    throw new Error('codex_collaboration_mode_invalid');
  }
  if (input.collaborationMode && !input.requestedModelId) {
    throw new Error('codex_collaboration_mode_model_required');
  }
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
    ...(input.collaborationMode
      ? {
          collaborationMode: {
            mode: input.collaborationMode.id,
            settings: {
              model: input.requestedModelId,
              reasoning_effort: input.reasoningOptionId,
              developer_instructions: null,
            },
          },
        }
      : {}),
    ...(input.personality ? { personality: input.personality } : {}),
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
  private readonly dynamicToolRegistrations = new Map<string, DynamicToolRegistration>();
  private readonly ownedThreadIds = new Set<string>();

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

  async listCollaborationModes(): Promise<CodexCollaborationModeDescriptor[]> {
    await this.start();
    return parseCodexCollaborationModeCatalog(await this.request('collaborationMode/list', {}));
  }

  async listCollaborationModeCatalog(): Promise<CodexCollaborationModeCatalog> {
    return toCodexCollaborationModeCatalog(await this.listCollaborationModes());
  }

  async startThread(input: {
    cwd: string;
    modelId: string | null;
    developerInstructions?: string;
    dynamicTools?: readonly CodexDynamicToolSpec[];
    dynamicToolHandler?: CodexDynamicToolHandler;
    responseVerbosity?: CodexResponseVerbosity | null;
  }) {
    await this.start();
    const dynamicTools = input.dynamicTools ?? [];
    const registration = prepareDynamicToolRegistration(dynamicTools, input.dynamicToolHandler);
    const result = await this.request(
      'thread/start',
      buildCodexThreadParameters({ ...input, dynamicTools }),
    );
    const started = parseCodexThreadStartResponse(result);
    if (this.ownedThreadIds.has(started.threadId)) {
      throw new Error('codex_thread_id_collision');
    }
    this.ownedThreadIds.add(started.threadId);
    try {
      await this.assertThreadHasNoMcpServers(started.threadId);
    } catch (error) {
      this.ownedThreadIds.delete(started.threadId);
      await this.request('thread/unsubscribe', { threadId: started.threadId }).catch(
        () => undefined,
      );
      throw error;
    }
    if (registration) this.dynamicToolRegistrations.set(started.threadId, registration);
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
    collaborationModeId?: string | null;
    expectedCollaborationModeCatalogVersion?: string | null;
    personality?: CodexPersonality | null;
  }) {
    await this.start();
    const catalog = this.catalog ?? (await this.listModelCatalog());
    let collaborationMode: CodexCollaborationModeDescriptor | null = null;
    let collaborationModeCatalogVersion: string | null = null;
    if (input.collaborationModeId) {
      const modeCatalog = await this.listCollaborationModeCatalog();
      collaborationModeCatalogVersion = modeCatalog.catalogVersion;
      if (
        input.expectedCollaborationModeCatalogVersion &&
        input.expectedCollaborationModeCatalogVersion !== modeCatalog.catalogVersion
      ) {
        throw new Error('codex_collaboration_mode_catalog_changed');
      }
      collaborationMode =
        modeCatalog.modes.find((mode) => mode.id === input.collaborationModeId) ?? null;
      if (!collaborationMode) throw new Error('codex_collaboration_mode_unavailable');
    }
    const effectiveReasoningOptionId =
      input.reasoningOptionId ?? collaborationMode?.recommendedReasoningOptionId ?? null;
    const effectiveRequestedModelId =
      input.requestedModelId ?? collaborationMode?.recommendedModelId ?? null;
    if (
      !input.requestedModelId &&
      collaborationMode?.recommendedModelId &&
      !catalog.models.some((model) => model.modelId === collaborationMode.recommendedModelId)
    ) {
      throw new Error('codex_collaboration_mode_model_unavailable');
    }
    let invocation = createInvocation({
      catalog,
      requestedModelId: effectiveRequestedModelId,
      reasoningOptionId: effectiveReasoningOptionId,
    });
    const resolvedModel = catalog.models.find(
      (model) => model.modelId === invocation.resolvedModelId,
    );
    if (
      effectiveReasoningOptionId &&
      !resolvedModel?.reasoningOptions.some((option) => option.id === effectiveReasoningOptionId)
    ) {
      throw new Error('codex_model_reasoning_unsupported');
    }
    if (input.personality && resolvedModel?.metadata?.supportsPersonality !== true) {
      throw new Error('codex_model_personality_unsupported');
    }
    const result = (await this.request(
      'turn/start',
      buildCodexTurnParameters({
        ...input,
        requestedModelId: invocation.resolvedModelId,
        reasoningOptionId: effectiveReasoningOptionId,
        collaborationMode,
      }),
    )) as {
      turn?: { id?: string };
    };
    const turnId = result.turn?.id;
    if (!turnId) throw new Error('codex_turn_id_missing');
    this.bindDynamicToolTurn(input.threadId, turnId);
    const earlyReroute = this.earlyReroutes.get(turnId);
    this.earlyReroutes.delete(turnId);
    if (earlyReroute?.threadId === input.threadId) {
      invocation = recordModelReroute(invocation, earlyReroute.toModel);
    }
    this.invocations.set(turnId, { threadId: input.threadId, invocation });
    this.emitBoundaryEvent('invocation', { threadId: input.threadId, turnId, invocation });
    return {
      turnId,
      invocation,
      collaborationMode,
      collaborationModeCatalogVersion,
      effectiveReasoningOptionId,
      personality: input.personality ?? null,
    };
  }

  async interruptTurn(threadId: string, turnId: string) {
    await this.request('turn/interrupt', { threadId, turnId });
  }

  async releaseThread(threadId: string) {
    this.revokeDynamicTools(threadId);
    this.ownedThreadIds.delete(threadId);
    try {
      await this.request('thread/unsubscribe', { threadId });
    } finally {
      for (const [turnId, entry] of this.invocations) {
        if (entry.threadId === threadId) this.invocations.delete(turnId);
      }
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
        clientInfo: { name: 'gosu_desktop', title: 'GOSU', version: '0.8.1' },
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
    if (message.method === 'item/tool/call') {
      void this.handleDynamicToolCall(child, message.id, message.params);
      return;
    }
    const response = codexServerRequestResponse(message.method);
    if ('result' in response) this.respond(child, message.id, response.result);
    else this.respond(child, message.id, undefined, response.error);
  }

  private async handleDynamicToolCall(
    child: ChildProcessWithoutNullStreams,
    requestId: string | number,
    params: unknown,
  ) {
    const call = parseDynamicToolCall(params);
    const registration = call ? this.dynamicToolRegistrations.get(call.threadId) : undefined;
    if (
      !call ||
      !registration ||
      !registration.tools.has(dynamicToolKey(call.namespace, call.tool))
    ) {
      this.respond(child, requestId, undefined, {
        code: -32602,
        message: 'Invalid GOSU dynamic tool call.',
      });
      return;
    }

    try {
      this.bindDynamicToolTurn(call.threadId, call.turnId);
    } catch {
      this.respond(child, requestId, undefined, {
        code: -32602,
        message: 'Invalid GOSU dynamic tool call.',
      });
      return;
    }

    const callKey = `${call.turnId}\u0000${call.callId}`;
    const turnCalls = registration.callsByTurn.get(call.turnId) ?? 0;
    if (
      registration.seenCalls.has(callKey) ||
      turnCalls >= CODEX_DYNAMIC_TOOL_MAX_CALLS_PER_TURN ||
      registration.seenCalls.size >= CODEX_DYNAMIC_TOOL_MAX_CALLS_PER_THREAD ||
      registration.inFlight >= CODEX_DYNAMIC_TOOL_MAX_IN_FLIGHT_PER_THREAD
    ) {
      this.respond(child, requestId, failureDynamicToolResult('GOSU dynamic tool limit exceeded.'));
      return;
    }
    registration.seenCalls.add(callKey);
    registration.callsByTurn.set(call.turnId, turnCalls + 1);
    registration.inFlight += 1;
    const delivery = createDynamicToolDelivery();
    registration.deliveries.add(delivery);

    let timeout: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => registration.handler(call, delivery.signal)),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('codex_dynamic_tool_timeout')),
            CODEX_DYNAMIC_TOOL_TIMEOUT_MS,
          );
        }),
      ]);
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      if (this.dynamicToolRegistrations.get(call.threadId) !== registration) {
        delivery.discard();
        this.respond(child, requestId, undefined, {
          code: -32000,
          message: 'GOSU dynamic tool call is no longer active.',
        });
        return;
      }
      const parsedResult = parseDynamicToolResult(result);
      if (!parsedResult) {
        delivery.discard();
        this.respond(
          child,
          requestId,
          failureDynamicToolResult('GOSU dynamic tool returned an invalid result.'),
        );
        return;
      }
      const writeAcknowledged = await this.writeDynamicToolResponse(
        child,
        requestId,
        parsedResult,
        delivery,
      );
      if (
        writeAcknowledged &&
        this.dynamicToolRegistrations.get(call.threadId) === registration &&
        registration.deliveries.has(delivery)
      ) {
        delivery.acknowledge();
      } else {
        delivery.discard();
      }
    } catch {
      delivery.discard();
      if (this.dynamicToolRegistrations.get(call.threadId) !== registration) {
        this.respond(child, requestId, undefined, {
          code: -32000,
          message: 'GOSU dynamic tool call is no longer active.',
        });
        return;
      }
      this.respond(child, requestId, failureDynamicToolResult('GOSU dynamic tool failed.'));
    } finally {
      if (timeout) clearTimeout(timeout);
      delivery.discard();
      registration.deliveries.delete(delivery);
      registration.inFlight -= 1;
    }
  }

  private bindDynamicToolTurn(threadId: string, turnId: string) {
    const registration = this.dynamicToolRegistrations.get(threadId);
    if (!registration) return;
    if (registration.boundTurnId === null) {
      registration.boundTurnId = turnId;
      return;
    }
    if (registration.boundTurnId !== turnId) {
      throw new Error('codex_dynamic_tool_turn_mismatch');
    }
  }

  revokeDynamicTools(threadId: string) {
    this.removeDynamicToolRegistration(threadId);
  }

  private removeDynamicToolRegistration(threadId: string) {
    const registration = this.dynamicToolRegistrations.get(threadId);
    this.dynamicToolRegistrations.delete(threadId);
    if (!registration) return;
    for (const delivery of registration.deliveries) delivery.discard();
    registration.deliveries.clear();
  }

  private clearDynamicToolRegistrations() {
    for (const threadId of this.dynamicToolRegistrations.keys()) {
      this.removeDynamicToolRegistration(threadId);
    }
  }

  private writeDynamicToolResponse(
    child: ChildProcessWithoutNullStreams,
    id: string | number,
    result: CodexDynamicToolResult,
    delivery: DynamicToolDeliveryController,
  ) {
    if (this.process !== child) return Promise.resolve(false);
    const payload = `${JSON.stringify({ id, result })}\n`;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (acknowledged: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(acknowledged);
      };
      const timeout = setTimeout(() => {
        if (this.process === child) {
          this.emitBoundaryEvent('diagnostic', 'Codex response acknowledgement timed out');
        }
        finish(false);
      }, CODEX_DYNAMIC_TOOL_RESPONSE_ACK_TIMEOUT_MS);
      try {
        child.stdin.write(payload, (writeError) => {
          if (writeError && this.process === child) {
            this.emitBoundaryEvent('diagnostic', 'Codex response failed');
          }
          finish(!writeError && this.process === child);
        });
        delivery.markWriteStarted();
      } catch {
        if (this.process === child) this.emitBoundaryEvent('diagnostic', 'Codex response failed');
        finish(false);
      }
    });
  }

  private respond(
    child: ChildProcessWithoutNullStreams,
    id: string | number,
    result?: unknown,
    error?: { code: number; message: string },
  ) {
    if (this.process !== child) return false;
    const payload = `${JSON.stringify(error ? { id, error } : { id, result })}\n`;
    try {
      child.stdin.write(payload, (writeError) => {
        if (writeError && this.process === child)
          this.emitBoundaryEvent('diagnostic', 'Codex response failed');
      });
      return true;
    } catch {
      if (this.process === child) this.emitBoundaryEvent('diagnostic', 'Codex response failed');
      return false;
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
    this.clearDynamicToolRegistrations();
    this.ownedThreadIds.clear();
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
