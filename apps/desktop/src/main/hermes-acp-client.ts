import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { isAbsolute } from 'node:path';

const ACP_PROTOCOL_VERSION = 1;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_PERMISSION_TIMEOUT_MS = 60_000;
const DEFAULT_CLOSE_GRACE_MS = 1_500;
const DEFAULT_KILL_CONFIRM_MS = 2_000;
const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;
const DEFAULT_MAX_PENDING_REQUESTS = 64;
const DEFAULT_MAX_STDERR_BYTES = 32 * 1024;
const DEFAULT_MAX_EVENT_TEXT_CHARACTERS = 32 * 1024;
const MAX_IDENTIFIER_CHARACTERS = 256;
const MAX_PERMISSION_OPTIONS = 32;
const MAX_PLAN_ENTRIES = 256;
const MAX_AVAILABLE_COMMANDS = 256;

type JsonRpcId = string | number;

type JsonRecord = Record<string, unknown>;

export type HermesAcpClientState =
  'idle' | 'initializing' | 'ready' | 'closing' | 'closed' | 'failed';

export type HermesAcpSpawnInput = Readonly<{
  executable: string;
  args: readonly string[];
  cwd?: string;
  environment: NodeJS.ProcessEnv;
}>;

export interface HermesAcpManagedProcess {
  readonly pid: number | null;
  onStdout(listener: (chunk: Buffer | string) => void): void;
  onStderr(listener: (chunk: Buffer | string) => void): void;
  onError(listener: () => void): void;
  onExit(listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): void;
  write(line: string): Promise<void>;
  endInput(): void;
  kill(signal: NodeJS.Signals): boolean;
}

export interface HermesAcpPlatform {
  spawn(input: HermesAcpSpawnInput): HermesAcpManagedProcess;
  terminateProcessGroup(process: HermesAcpManagedProcess, signal: NodeJS.Signals): void;
}

export type HermesAcpPermissionOption = Readonly<{
  optionId: string;
  name: string;
  kind: string;
}>;

export type HermesAcpPermissionRequest = Readonly<{
  sessionId: string;
  toolCall: Readonly<{
    toolCallId: string;
    title: string;
    kind: string;
    status: string;
    displayText: string | null;
    displayTextTruncated: boolean;
    displayTextUnsafe: boolean;
    editPreview: Readonly<{
      path: string;
      pathTruncated: boolean;
      pathUnsafe: boolean;
      oldText: string | null;
      newText: string;
      oldTextTruncated: boolean;
      newTextTruncated: boolean;
      oldTextUnsafe: boolean;
      newTextUnsafe: boolean;
    }> | null;
  }>;
  options: readonly HermesAcpPermissionOption[];
}>;

export type HermesAcpPermissionDecision =
  Readonly<{ outcome: 'selected'; optionId: string }> | Readonly<{ outcome: 'cancelled' }>;

export type HermesAcpSanitizedContent = Readonly<{
  type: string;
  text?: string;
}>;

export type HermesAcpSanitizedSessionUpdate = Readonly<{
  sessionId: string;
  update: Readonly<{
    sessionUpdate: string;
    content?: HermesAcpSanitizedContent;
    toolCallId?: string;
    title?: string;
    kind?: string;
    status?: string;
    contentBlockCount?: number;
    locationCount?: number;
    entries?: readonly Readonly<{
      content: string;
      status: string;
      priority?: string;
    }>[];
    availableCommands?: readonly Readonly<{
      name: string;
      description: string;
    }>[];
    currentModeId?: string;
    sessionTitle?: string;
    updatedAt?: string;
    usage?: Readonly<Record<string, number>>;
  }>;
}>;

export type HermesAcpInitializeResult = Readonly<{
  protocolVersion: 1;
  agentName: string | null;
  agentVersion: string | null;
}>;

export type HermesAcpSession = Readonly<{ sessionId: string }>;

export type HermesAcpPromptUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedReadTokens: number | null;
  cachedWriteTokens: number | null;
  reasoningOutputTokens: number | null;
}>;

export type HermesAcpPromptResult = Readonly<{
  stopReason: string;
  usage?: HermesAcpPromptUsage;
}>;

export type HermesAcpClientOptions = Readonly<{
  permissionHandler: (request: HermesAcpPermissionRequest) => Promise<HermesAcpPermissionDecision>;
  platform?: HermesAcpPlatform;
  executable?: string;
  args?: readonly string[];
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  clientVersion?: string;
  requestTimeoutMs?: number;
  promptTimeoutMs?: number;
  permissionTimeoutMs?: number;
  closeGraceMs?: number;
  killConfirmMs?: number;
  maxLineBytes?: number;
  maxPendingRequests?: number;
  maxStderrBytes?: number;
  maxEventTextCharacters?: number;
}>;

export class HermesAcpClientError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'HermesAcpClientError';
  }
}

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: HermesAcpClientError) => void;
  timer: ReturnType<typeof setTimeout>;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && value !== undefined && value > 0 ? value : fallback;
}

function boundedString(value: unknown, maximum: number) {
  if (typeof value !== 'string') return '';
  let sanitized = '';
  for (const character of value) {
    if (sanitized.length >= maximum) break;
    const codePoint = character.codePointAt(0) ?? 0;
    const unsafeControl =
      codePoint <= 0x08 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      codePoint === 0x7f;
    sanitized += unsafeControl ? '\ufffd' : character;
  }
  return sanitized.slice(0, maximum);
}

function sanitizePromptUsage(value: unknown): HermesAcpPromptUsage | null {
  if (!isRecord(value)) return null;
  const required = ['inputTokens', 'outputTokens', 'totalTokens'] as const;
  if (required.some((key) => !Number.isSafeInteger(value[key]) || (value[key] as number) < 0)) {
    return null;
  }
  const optional = (key: string) => {
    const count = value[key];
    return Number.isSafeInteger(count) && (count as number) >= 0 ? (count as number) : null;
  };
  const usage: HermesAcpPromptUsage = {
    inputTokens: value.inputTokens as number,
    outputTokens: value.outputTokens as number,
    totalTokens: value.totalTokens as number,
    cachedReadTokens: optional('cachedReadTokens'),
    cachedWriteTokens: optional('cachedWriteTokens'),
    reasoningOutputTokens: optional('thoughtTokens'),
  };
  if (
    !Number.isSafeInteger(usage.inputTokens + usage.outputTokens) ||
    usage.totalTokens !== usage.inputTokens + usage.outputTokens ||
    (usage.cachedReadTokens !== null && usage.cachedReadTokens > usage.inputTokens) ||
    (usage.cachedWriteTokens !== null && usage.cachedWriteTokens > usage.inputTokens) ||
    (usage.cachedReadTokens !== null &&
      usage.cachedWriteTokens !== null &&
      (!Number.isSafeInteger(usage.cachedReadTokens + usage.cachedWriteTokens) ||
        usage.cachedReadTokens + usage.cachedWriteTokens > usage.inputTokens)) ||
    (usage.reasoningOutputTokens !== null && usage.reasoningOutputTokens > usage.outputTokens)
  ) {
    return null;
  }
  return usage;
}

function boundedIdentifier(value: unknown) {
  return boundedString(value, MAX_IDENTIFIER_CHARACTERS);
}

function containsUnsafePermissionDisplayCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x08 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      codePoint === 0x7f ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function sanitizeContent(value: unknown, maximumTextCharacters: number): HermesAcpSanitizedContent {
  if (!isRecord(value)) return { type: 'unknown' };
  const type = boundedIdentifier(value.type) || 'unknown';
  if (type !== 'text') return { type };
  return {
    type,
    text: boundedString(value.text, maximumTextCharacters),
  };
}

function sanitizePlanEntries(value: unknown, maximumTextCharacters: number) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_PLAN_ENTRIES).flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const content = boundedString(candidate.content, maximumTextCharacters);
    const status = boundedIdentifier(candidate.status);
    if (!content || !status) return [];
    const priority = boundedIdentifier(candidate.priority);
    return [
      {
        content,
        status,
        ...(priority ? { priority } : {}),
      },
    ];
  });
}

function sanitizeAvailableCommands(value: unknown, maximumTextCharacters: number) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_AVAILABLE_COMMANDS).flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const name = boundedIdentifier(candidate.name);
    if (!name) return [];
    return [
      {
        name,
        description: boundedString(candidate.description, maximumTextCharacters),
      },
    ];
  });
}

function sanitizeUsage(update: JsonRecord) {
  const usage: Record<string, number> = {};
  for (const key of [
    'inputTokens',
    'outputTokens',
    'cachedReadTokens',
    'cachedWriteTokens',
    'totalTokens',
    'cost',
  ]) {
    const value = update[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) usage[key] = value;
  }
  return usage;
}

export function sanitizeHermesAcpSessionUpdate(
  params: unknown,
  maximumTextCharacters = DEFAULT_MAX_EVENT_TEXT_CHARACTERS,
): HermesAcpSanitizedSessionUpdate | null {
  if (!isRecord(params) || !isRecord(params.update)) return null;
  const sessionId = boundedIdentifier(params.sessionId);
  const sessionUpdate = boundedIdentifier(params.update.sessionUpdate);
  if (!sessionId || !sessionUpdate) return null;

  const update = params.update;
  if (
    sessionUpdate === 'agent_message_chunk' ||
    sessionUpdate === 'agent_thought_chunk' ||
    sessionUpdate === 'user_message_chunk'
  ) {
    return {
      sessionId,
      update: {
        sessionUpdate,
        content: sanitizeContent(update.content, maximumTextCharacters),
      },
    };
  }

  if (sessionUpdate === 'tool_call' || sessionUpdate === 'tool_call_update') {
    const toolCallId = boundedIdentifier(update.toolCallId);
    const title = boundedString(update.title, maximumTextCharacters);
    const kind = boundedIdentifier(update.kind);
    const status = boundedIdentifier(update.status);
    return {
      sessionId,
      update: {
        sessionUpdate,
        ...(toolCallId ? { toolCallId } : {}),
        ...(title ? { title } : {}),
        ...(kind ? { kind } : {}),
        ...(status ? { status } : {}),
        contentBlockCount: arrayLength(update.content),
        locationCount: arrayLength(update.locations),
      },
    };
  }

  if (sessionUpdate === 'plan') {
    return {
      sessionId,
      update: {
        sessionUpdate,
        entries: sanitizePlanEntries(update.entries, maximumTextCharacters),
      },
    };
  }

  if (sessionUpdate === 'available_commands_update') {
    return {
      sessionId,
      update: {
        sessionUpdate,
        availableCommands: sanitizeAvailableCommands(
          update.availableCommands,
          maximumTextCharacters,
        ),
      },
    };
  }

  if (sessionUpdate === 'current_mode_update') {
    const currentModeId = boundedIdentifier(update.currentModeId);
    return {
      sessionId,
      update: { sessionUpdate, ...(currentModeId ? { currentModeId } : {}) },
    };
  }

  if (sessionUpdate === 'session_info_update') {
    const sessionTitle = boundedString(update.title, maximumTextCharacters);
    const updatedAt = boundedIdentifier(update.updatedAt);
    return {
      sessionId,
      update: {
        sessionUpdate,
        ...(sessionTitle ? { sessionTitle } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      },
    };
  }

  if (sessionUpdate === 'usage_update') {
    return {
      sessionId,
      update: { sessionUpdate, usage: sanitizeUsage(update) },
    };
  }

  return { sessionId, update: { sessionUpdate } };
}

function nestedPermissionDisplayText(value: unknown, maximumTextCharacters: number) {
  if (!Array.isArray(value)) return { text: null, truncated: false, unsafe: false };
  for (const block of value.slice(0, 16)) {
    if (!isRecord(block) || !isRecord(block.content) || block.content.type !== 'text') continue;
    if (typeof block.content.text !== 'string') continue;
    const source = block.content.text;
    const text = boundedString(source, maximumTextCharacters);
    if (text) {
      return {
        text,
        truncated: source.length > maximumTextCharacters,
        unsafe: containsUnsafePermissionDisplayCharacter(source),
      };
    }
  }
  return { text: null, truncated: false, unsafe: false };
}

function nestedPermissionEditPreview(value: unknown, maximumTextCharacters: number) {
  if (!Array.isArray(value)) return null;
  for (const block of value.slice(0, 16)) {
    if (!isRecord(block) || block.type !== 'diff') continue;
    if (typeof block.path !== 'string' || typeof block.newText !== 'string') return null;
    const pathSource = block.path;
    const pathMaximum = Math.min(maximumTextCharacters, 1_024);
    const path = boundedString(pathSource, pathMaximum);
    if (!path) return null;
    const pathUnsafe = [...pathSource].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint <= 0x1f ||
        codePoint === 0x7f ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069)
      );
    });
    const oldSource = typeof block.oldText === 'string' ? block.oldText : null;
    const newSource = block.newText;
    return {
      path,
      pathTruncated: pathSource.length > pathMaximum,
      pathUnsafe,
      oldText: oldSource === null ? null : boundedString(oldSource, maximumTextCharacters),
      newText: boundedString(newSource, maximumTextCharacters),
      oldTextTruncated: oldSource !== null && oldSource.length > maximumTextCharacters,
      newTextTruncated: newSource.length > maximumTextCharacters,
      oldTextUnsafe: oldSource !== null && containsUnsafePermissionDisplayCharacter(oldSource),
      newTextUnsafe: containsUnsafePermissionDisplayCharacter(newSource),
    };
  }
  return null;
}

function sanitizePermissionRequest(
  params: unknown,
  maximumTextCharacters: number,
): HermesAcpPermissionRequest | null {
  if (!isRecord(params) || !isRecord(params.toolCall) || !Array.isArray(params.options)) {
    return null;
  }
  const sessionId = boundedIdentifier(params.sessionId);
  const toolCallId = boundedIdentifier(params.toolCall.toolCallId);
  if (!sessionId || !toolCallId) return null;
  const options = params.options.slice(0, MAX_PERMISSION_OPTIONS).flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const optionId = boundedIdentifier(candidate.optionId);
    const name = boundedString(candidate.name, maximumTextCharacters);
    const kind = boundedIdentifier(candidate.kind);
    if (!optionId || !name || !kind) return [];
    return [{ optionId, name, kind }];
  });
  if (options.length === 0) return null;
  const display = nestedPermissionDisplayText(params.toolCall.content, maximumTextCharacters);
  return {
    sessionId,
    toolCall: {
      toolCallId,
      title: boundedString(params.toolCall.title, maximumTextCharacters),
      kind: boundedIdentifier(params.toolCall.kind),
      status: boundedIdentifier(params.toolCall.status),
      displayText: display.text,
      displayTextTruncated: display.truncated,
      displayTextUnsafe: display.unsafe,
      editPreview: nestedPermissionEditPreview(params.toolCall.content, maximumTextCharacters),
    },
    options,
  };
}

class NodeHermesAcpProcess implements HermesAcpManagedProcess {
  readonly pid: number | null;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.pid = child.pid ?? null;
  }

  onStdout(listener: (chunk: Buffer | string) => void) {
    this.child.stdout.on('data', listener);
  }

  onStderr(listener: (chunk: Buffer | string) => void) {
    this.child.stderr.on('data', listener);
  }

  onError(listener: () => void) {
    this.child.once('error', listener);
    this.child.stdout.once('error', listener);
    this.child.stderr.once('error', listener);
    this.child.stdin.once('error', listener);
  }

  onExit(listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void) {
    this.child.once('close', listener);
  }

  write(line: string) {
    return new Promise<void>((resolve, reject) => {
      if (this.child.stdin.destroyed) {
        reject(new HermesAcpClientError('hermes_acp_stdin_closed'));
        return;
      }
      this.child.stdin.write(line, (error) => {
        if (error) reject(new HermesAcpClientError('hermes_acp_write_failed'));
        else resolve();
      });
    });
  }

  endInput() {
    if (!this.child.stdin.destroyed) this.child.stdin.end();
  }

  kill(signal: NodeJS.Signals) {
    return this.child.kill(signal);
  }
}

export function createNodeHermesAcpPlatform(): HermesAcpPlatform {
  return {
    spawn(input) {
      const child = spawn(input.executable, [...input.args], {
        ...(input.cwd ? { cwd: input.cwd } : {}),
        detached: process.platform !== 'win32',
        env: input.environment,
        shell: false,
        stdio: 'pipe',
        windowsHide: true,
      });
      return new NodeHermesAcpProcess(child);
    },
    terminateProcessGroup(managedProcess, signal) {
      if (process.platform !== 'win32' && managedProcess.pid !== null) {
        try {
          process.kill(-managedProcess.pid, signal);
          return;
        } catch {
          // The group can disappear between the liveness check and signal delivery.
        }
      }
      try {
        managedProcess.kill(signal);
      } catch {
        // Termination is best-effort; close still has a bounded confirmation wait.
      }
    },
  };
}

export class HermesAcpClient extends EventEmitter {
  private readonly platform: HermesAcpPlatform;
  private readonly executable: string;
  private readonly args: readonly string[];
  private readonly cwd: string | undefined;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly clientVersion: string;
  private readonly requestTimeoutMs: number;
  private readonly promptTimeoutMs: number;
  private readonly permissionTimeoutMs: number;
  private readonly closeGraceMs: number;
  private readonly killConfirmMs: number;
  private readonly maxLineBytes: number;
  private readonly maxPendingRequests: number;
  private readonly maxStderrBytes: number;
  private readonly maxEventTextCharacters: number;
  private readonly permissionHandler: HermesAcpClientOptions['permissionHandler'];
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly sessions = new Set<string>();
  private readonly exitWaiters = new Set<() => void>();
  private managedProcess: HermesAcpManagedProcess | null = null;
  private initializePromise: Promise<HermesAcpInitializeResult> | null = null;
  private closePromise: Promise<void> | null = null;
  private initialization: HermesAcpInitializeResult | null = null;
  private stdoutBuffer = Buffer.alloc(0);
  private stderrBytes = 0;
  private stderrDiagnosticBuffer = '';
  private processFailureCode: string | null = null;
  private nextRequestId = 0;
  private inboundPermissionRequests = 0;
  private exited = false;
  private currentState: HermesAcpClientState = 'idle';

  constructor(options: HermesAcpClientOptions) {
    super();
    this.platform = options.platform ?? createNodeHermesAcpPlatform();
    this.executable = options.executable ?? 'hermes';
    this.args = options.args ?? ['acp'];
    this.cwd = options.cwd;
    this.environment = {
      ...(options.environment ?? process.env),
      HERMES_ACP_SKIP_CONFIGURED_MCP: '1',
    };
    this.clientVersion = boundedIdentifier(options.clientVersion) || '0.1.0';
    this.requestTimeoutMs = positiveInteger(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    this.promptTimeoutMs = positiveInteger(options.promptTimeoutMs, DEFAULT_PROMPT_TIMEOUT_MS);
    this.permissionTimeoutMs = positiveInteger(
      options.permissionTimeoutMs,
      DEFAULT_PERMISSION_TIMEOUT_MS,
    );
    this.closeGraceMs = positiveInteger(options.closeGraceMs, DEFAULT_CLOSE_GRACE_MS);
    this.killConfirmMs = positiveInteger(options.killConfirmMs, DEFAULT_KILL_CONFIRM_MS);
    this.maxLineBytes = positiveInteger(options.maxLineBytes, DEFAULT_MAX_LINE_BYTES);
    this.maxPendingRequests = positiveInteger(
      options.maxPendingRequests,
      DEFAULT_MAX_PENDING_REQUESTS,
    );
    this.maxStderrBytes = positiveInteger(options.maxStderrBytes, DEFAULT_MAX_STDERR_BYTES);
    this.maxEventTextCharacters = positiveInteger(
      options.maxEventTextCharacters,
      DEFAULT_MAX_EVENT_TEXT_CHARACTERS,
    );
    this.permissionHandler = options.permissionHandler;
  }

  get state() {
    return this.currentState;
  }

  get pendingRequestCount() {
    return this.pendingRequests.size;
  }

  initialize(): Promise<HermesAcpInitializeResult> {
    if (this.initialization) return Promise.resolve(this.initialization);
    if (this.initializePromise) return this.initializePromise;
    if (this.currentState !== 'idle') {
      return Promise.reject(new HermesAcpClientError('hermes_acp_client_not_startable'));
    }
    this.currentState = 'initializing';
    try {
      this.managedProcess = this.platform.spawn({
        executable: this.executable,
        args: this.args,
        ...(this.cwd ? { cwd: this.cwd } : {}),
        environment: this.environment,
      });
    } catch {
      this.currentState = 'failed';
      return Promise.reject(new HermesAcpClientError('hermes_acp_spawn_failed'));
    }
    this.bindProcess(this.managedProcess);
    this.initializePromise = this.performInitialize().finally(() => {
      this.initializePromise = null;
    });
    return this.initializePromise;
  }

  async createSession(cwd: string): Promise<HermesAcpSession> {
    if (!isAbsolute(cwd)) throw new HermesAcpClientError('hermes_acp_session_cwd_not_absolute');
    await this.initialize();
    const result = await this.request(
      'session/new',
      { cwd, mcpServers: [] },
      this.requestTimeoutMs,
    );
    if (!isRecord(result)) throw new HermesAcpClientError('hermes_acp_session_invalid');
    const sessionId = boundedIdentifier(result.sessionId);
    if (!sessionId) throw new HermesAcpClientError('hermes_acp_session_invalid');
    this.sessions.add(sessionId);
    return { sessionId };
  }

  async prompt(
    sessionId: string,
    text: string | readonly string[],
  ): Promise<HermesAcpPromptResult> {
    this.requireSession(sessionId);
    const values = typeof text === 'string' ? [text] : text;
    const prompt = values.map((value) => ({ type: 'text', text: value }));
    if (prompt.length === 0 || prompt.some((block) => !block.text.trim())) {
      throw new HermesAcpClientError('hermes_acp_prompt_empty');
    }
    const result = await this.request(
      'session/prompt',
      { sessionId, prompt },
      this.promptTimeoutMs,
    );
    if (!isRecord(result)) throw new HermesAcpClientError('hermes_acp_prompt_result_invalid');
    const usage = sanitizePromptUsage(result.usage);
    return {
      stopReason: boundedIdentifier(result.stopReason) || 'unknown',
      ...(usage ? { usage } : {}),
    };
  }

  async cancel(sessionId: string) {
    this.requireSession(sessionId);
    await this.notification('session/cancel', { sessionId });
  }

  close(): Promise<void> {
    if (this.currentState === 'closed') return Promise.resolve();
    if (this.closePromise) return this.closePromise;
    const operation = this.performClose();
    this.closePromise = operation;
    void operation
      .finally(() => {
        if (this.closePromise === operation) this.closePromise = null;
      })
      .catch(() => undefined);
    return operation;
  }

  private async performClose() {
    const alreadyClosing = this.currentState === 'closing';
    this.currentState = 'closing';
    this.rejectPending('hermes_acp_client_closed');
    const managedProcess = this.managedProcess;
    if (!managedProcess || this.exited) {
      this.currentState = 'closed';
      return;
    }
    if (!alreadyClosing) {
      managedProcess.endInput();
      this.platform.terminateProcessGroup(managedProcess, 'SIGTERM');
    }
    if ((alreadyClosing || !(await this.waitForExit(this.closeGraceMs))) && !this.exited) {
      this.platform.terminateProcessGroup(managedProcess, 'SIGKILL');
      if (!(await this.waitForExit(this.killConfirmMs))) {
        this.currentState = 'failed';
        throw new HermesAcpClientError('hermes_acp_kill_unconfirmed');
      }
    }
    this.currentState = 'closed';
  }

  terminateImmediately() {
    if (this.currentState === 'closed') return;
    this.currentState = 'closing';
    this.rejectPending('hermes_acp_client_closed');
    const managedProcess = this.managedProcess;
    if (managedProcess && !this.exited) {
      managedProcess.endInput();
      this.platform.terminateProcessGroup(managedProcess, 'SIGKILL');
    }
  }

  private async performInitialize() {
    try {
      const result = await this.request(
        'initialize',
        {
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientCapabilities: {
            auth: { terminal: false },
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: {
            name: 'gosu',
            title: 'GOSU',
            version: this.clientVersion,
          },
        },
        this.requestTimeoutMs,
      );
      if (!isRecord(result) || result.protocolVersion !== ACP_PROTOCOL_VERSION) {
        throw new HermesAcpClientError('hermes_acp_protocol_version_unsupported');
      }
      const agentInfo = isRecord(result.agentInfo) ? result.agentInfo : {};
      this.initialization = {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentName: boundedIdentifier(agentInfo.name) || null,
        agentVersion: boundedIdentifier(agentInfo.version) || null,
      };
      this.currentState = 'ready';
      return this.initialization;
    } catch (error) {
      const sanitized =
        error instanceof HermesAcpClientError
          ? error
          : new HermesAcpClientError('hermes_acp_initialize_failed');
      this.fail(sanitized.code);
      throw sanitized;
    }
  }

  private bindProcess(managedProcess: HermesAcpManagedProcess) {
    managedProcess.onStdout((chunk) => this.receiveStdout(chunk));
    managedProcess.onStderr((chunk) => this.receiveStderr(chunk));
    managedProcess.onError(() => this.fail('hermes_acp_process_error'));
    managedProcess.onExit(() => this.handleExit());
  }

  private receiveStdout(chunk: Buffer | string) {
    if (this.currentState === 'failed' || this.currentState === 'closed') return;
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (offset < incoming.length) {
      const newline = incoming.indexOf(0x0a, offset);
      const end = newline < 0 ? incoming.length : newline;
      const segment = incoming.subarray(offset, end);
      if (this.stdoutBuffer.length + segment.length > this.maxLineBytes) {
        this.fail('hermes_acp_stdout_line_limit_exceeded');
        return;
      }
      if (segment.length > 0) this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, segment]);
      if (newline < 0) return;
      const line = this.stdoutBuffer;
      this.stdoutBuffer = Buffer.alloc(0);
      offset = newline + 1;
      if (line.length === 0) continue;
      const normalized = line.at(-1) === 0x0d ? line.subarray(0, -1) : line;
      this.receiveLine(normalized.toString('utf8'));
      if (this.inputStopped()) return;
    }
  }

  private receiveStderr(chunk: Buffer | string) {
    if (this.currentState === 'failed' || this.currentState === 'closed') return;
    this.stderrBytes += Buffer.byteLength(chunk);
    if (this.stderrBytes > this.maxStderrBytes) {
      this.fail('hermes_acp_stderr_limit_exceeded');
      return;
    }
    // The sealed GOSU launcher emits one bounded, credential-free diagnostic sentinel before it
    // exits. Retain only enough stderr to recognize that sentinel; never log or expose arbitrary
    // upstream stderr, which can contain provider details or secrets.
    this.stderrDiagnosticBuffer = `${this.stderrDiagnosticBuffer}${String(chunk)}`.slice(-512);
    const diagnostic =
      /(?:^|\n)gosu_hermes_acp_failed:([a-zA-Z][a-zA-Z0-9_]{0,127})(?:\r?\n|$)/u.exec(
        this.stderrDiagnosticBuffer,
      );
    if (diagnostic?.[1]) {
      this.processFailureCode = `hermes_acp_runtime_${diagnostic[1]}`;
    }
  }

  private inputStopped() {
    return this.currentState === 'failed' || this.currentState === 'closed';
  }

  private receiveLine(line: string) {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      this.fail('hermes_acp_invalid_json');
      return;
    }
    if (!isRecord(message) || message.jsonrpc !== '2.0') {
      this.fail('hermes_acp_invalid_message');
      return;
    }
    if (typeof message.method === 'string') {
      if ('id' in message && (typeof message.id === 'string' || typeof message.id === 'number')) {
        this.receiveServerRequest(message.id, message.method, message.params);
      } else {
        this.receiveNotification(message.method, message.params);
      }
      return;
    }
    this.receiveResponse(message);
  }

  private receiveResponse(message: JsonRecord) {
    if (typeof message.id !== 'number' || !Number.isSafeInteger(message.id)) return;
    const pending = this.pendingRequests.get(message.id);
    if (!pending) return;
    this.pendingRequests.delete(message.id);
    clearTimeout(pending.timer);
    if ('error' in message) {
      pending.reject(new HermesAcpClientError('hermes_acp_rpc_error'));
      return;
    }
    pending.resolve(message.result);
  }

  private receiveNotification(method: string, params: unknown) {
    if (method !== 'session/update') return;
    const event = sanitizeHermesAcpSessionUpdate(params, this.maxEventTextCharacters);
    if (event) this.emit('sessionUpdate', event);
  }

  private receiveServerRequest(id: JsonRpcId, method: string, params: unknown) {
    if (method !== 'session/request_permission') {
      void this.writeFrame({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'Method not supported' },
      }).catch(() => undefined);
      return;
    }
    if (this.inboundPermissionRequests >= this.maxPendingRequests) {
      void this.writePermissionDecision(id, { outcome: 'cancelled' });
      return;
    }
    const request = sanitizePermissionRequest(params, this.maxEventTextCharacters);
    if (!request || !this.sessions.has(request.sessionId)) {
      void this.writePermissionDecision(id, { outcome: 'cancelled' });
      return;
    }
    this.inboundPermissionRequests += 1;
    void this.resolvePermission(request)
      .then((decision) => this.writePermissionDecision(id, decision))
      .catch(() => this.writePermissionDecision(id, { outcome: 'cancelled' }))
      .finally(() => {
        this.inboundPermissionRequests -= 1;
      });
  }

  private async resolvePermission(request: HermesAcpPermissionRequest) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<HermesAcpPermissionDecision>((resolve) => {
      timer = setTimeout(() => resolve({ outcome: 'cancelled' }), this.permissionTimeoutMs);
    });
    const handled = Promise.resolve()
      .then(() => this.permissionHandler(request))
      .catch((): HermesAcpPermissionDecision => ({ outcome: 'cancelled' }));
    const decision = await Promise.race([handled, timeout]);
    if (timer) clearTimeout(timer);
    if (decision.outcome !== 'selected') return { outcome: 'cancelled' } as const;
    if (!request.options.some((option) => option.optionId === decision.optionId)) {
      return { outcome: 'cancelled' } as const;
    }
    return { outcome: 'selected', optionId: decision.optionId } as const;
  }

  private async writePermissionDecision(id: JsonRpcId, decision: HermesAcpPermissionDecision) {
    await this.writeFrame({ jsonrpc: '2.0', id, result: { outcome: decision } }).catch(
      () => undefined,
    );
  }

  private request(method: string, params: JsonRecord, timeoutMs: number) {
    if (this.pendingRequests.size >= this.maxPendingRequests) {
      return Promise.reject(new HermesAcpClientError('hermes_acp_pending_limit_exceeded'));
    }
    if (!this.managedProcess || this.currentState === 'closing' || this.currentState === 'closed') {
      return Promise.reject(new HermesAcpClientError('hermes_acp_client_not_running'));
    }
    this.nextRequestId += 1;
    const id = this.nextRequestId;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pendingRequests.delete(id)) return;
        reject(new HermesAcpClientError('hermes_acp_request_timeout'));
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timer });
      void this.writeFrame({ jsonrpc: '2.0', id, method, params }).catch(() => {
        const pending = this.pendingRequests.get(id);
        if (!pending) return;
        this.pendingRequests.delete(id);
        clearTimeout(pending.timer);
        pending.reject(new HermesAcpClientError('hermes_acp_write_failed'));
        this.fail('hermes_acp_write_failed');
      });
    });
  }

  private notification(method: string, params: JsonRecord) {
    if (!this.managedProcess || this.currentState !== 'ready') {
      return Promise.reject(new HermesAcpClientError('hermes_acp_client_not_ready'));
    }
    return this.writeFrame({ jsonrpc: '2.0', method, params });
  }

  private writeFrame(frame: JsonRecord) {
    const managedProcess = this.managedProcess;
    if (!managedProcess || this.currentState === 'closed' || this.currentState === 'failed') {
      return Promise.reject(new HermesAcpClientError('hermes_acp_client_not_running'));
    }
    const serialized = JSON.stringify(frame);
    if (Buffer.byteLength(serialized) > this.maxLineBytes) {
      return Promise.reject(new HermesAcpClientError('hermes_acp_outbound_line_limit_exceeded'));
    }
    return managedProcess.write(`${serialized}\n`);
  }

  private requireSession(sessionId: string) {
    if (!this.sessions.has(sessionId)) {
      throw new HermesAcpClientError('hermes_acp_session_not_found');
    }
  }

  private fail(code: string) {
    if (this.currentState === 'failed' || this.currentState === 'closed') return;
    this.currentState = 'failed';
    this.rejectPending(code);
    const managedProcess = this.managedProcess;
    if (managedProcess && !this.exited) {
      this.platform.terminateProcessGroup(managedProcess, 'SIGKILL');
    }
    this.emit('clientError', new HermesAcpClientError(code));
  }

  private rejectPending(code: string) {
    const error = new HermesAcpClientError(code);
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private handleExit() {
    this.exited = true;
    for (const resolve of this.exitWaiters) resolve();
    this.exitWaiters.clear();
    if (this.currentState === 'closing') {
      this.currentState = 'closed';
      return;
    }
    if (this.currentState === 'closed') return;
    this.fail(this.processFailureCode ?? 'hermes_acp_process_exited');
  }

  private waitForExit(timeoutMs: number) {
    if (this.exited) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (exited: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.exitWaiters.delete(onExit);
        resolve(exited);
      };
      const onExit = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.exitWaiters.add(onExit);
    });
  }
}
