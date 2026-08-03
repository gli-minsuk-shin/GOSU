import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { ModelCatalog, ModelInvocation } from '@gosu/contracts';

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
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string };
  params?: unknown;
};

const require = createRequire(import.meta.url);

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
) {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of CODEX_CHILD_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }

  const normalizedLogLevel = requestedLogLevel?.trim().toLowerCase();
  environment.RUST_LOG =
    normalizedLogLevel && CODEX_LOG_LEVELS.has(normalizedLogLevel) ? normalizedLogLevel : 'warn';
  if (runAsNode) environment.ELECTRON_RUN_AS_NODE = '1';
  return environment;
}

function codexCommand() {
  const override = process.env.GOSU_CODEX_BIN?.trim();
  if (override) return { executable: override, prefixArgs: [] as string[], runAsNode: false };

  const packagePath = require.resolve('@openai/codex/package.json');
  return {
    executable: process.execPath,
    prefixArgs: [join(dirname(packagePath), 'bin', 'codex.js')],
    runAsNode: true,
  };
}

export class CodexAppServer extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }
  >();
  private starting: Promise<void> | undefined;
  private catalog: ModelCatalog | undefined;
  private readonly invocations = new Map<
    string,
    { threadId: string; invocation: ModelInvocation }
  >();

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
    const result = (await this.request('model/list', { limit: 100, includeHidden: false })) as {
      data?: CodexModel[];
    };
    return (result.data ?? []).filter((model) => !model.hidden);
  }

  async listModelCatalog() {
    this.catalog = toModelCatalog(await this.listModels());
    return this.catalog;
  }

  async startThread(input: { cwd: string; modelId: string | null }) {
    await this.start();
    const result = (await this.request('thread/start', {
      cwd: input.cwd,
      serviceName: 'gosu_desktop',
      ...(input.modelId ? { model: input.modelId } : {}),
    })) as { thread?: { id?: string } };
    const threadId = result.thread?.id;
    if (!threadId) throw new Error('codex_thread_id_missing');
    return threadId;
  }

  async runTurn(input: {
    threadId: string;
    prompt: string;
    requestedModelId: string | null;
    reasoningOptionId: string | null;
    cwd: string;
  }) {
    const catalog = this.catalog ?? (await this.listModelCatalog());
    const invocation = createInvocation({
      catalog,
      requestedModelId: input.requestedModelId,
      reasoningOptionId: input.reasoningOptionId,
    });
    const result = (await this.request('turn/start', {
      threadId: input.threadId,
      input: [{ type: 'text', text: input.prompt }],
      cwd: input.cwd,
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [input.cwd],
        networkAccess: false,
      },
      ...(input.requestedModelId ? { model: input.requestedModelId } : {}),
      ...(input.reasoningOptionId ? { effort: input.reasoningOptionId } : {}),
    })) as { turn?: { id?: string } };
    const turnId = result.turn?.id;
    if (!turnId) throw new Error('codex_turn_id_missing');
    this.invocations.set(turnId, { threadId: input.threadId, invocation });
    this.emit('invocation', { threadId: input.threadId, turnId, invocation });
    return { turnId, invocation };
  }

  async interruptTurn(threadId: string, turnId: string) {
    await this.request('turn/interrupt', { threadId, turnId });
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
    const child = spawn(
      command.executable,
      [...command.prefixArgs, 'app-server', '--listen', 'stdio://'],
      {
        env: buildCodexChildEnvironment(process.env, command.runAsNode, process.env.GOSU_CODEX_LOG),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
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
        this.emit('diagnostic', line.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]'));
    });

    try {
      await this.request('initialize', {
        clientInfo: { name: 'gosu_desktop', title: 'GOSU', version: '0.1.0' },
        capabilities: { experimentalApi: false },
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

  private notify(method: string, params: unknown) {
    this.process?.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  private handleLine(child: ChildProcessWithoutNullStreams, line: string) {
    if (this.process !== child) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.emit('diagnostic', 'Ignored non-JSON Codex output');
      return;
    }
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timeout);
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === 'model/rerouted') {
      const reroute = message.params as { threadId?: string; turnId?: string; toModel?: string };
      const current = reroute.turnId ? this.invocations.get(reroute.turnId) : undefined;
      if (current && reroute.toModel) {
        const invocation = recordModelReroute(current.invocation, reroute.toModel);
        this.invocations.set(reroute.turnId!, { ...current, invocation });
        this.emit('invocation', {
          threadId: current.threadId,
          turnId: reroute.turnId,
          invocation,
        });
      }
    }
    if (message.method)
      this.emit('notification', { method: message.method, params: message.params });
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
    this.emit('diagnostic', error.message);
  }
}
