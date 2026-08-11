import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

import { ModelCatalogSchema, ModelInvocationSchema, type ModelCatalog } from '@gosu/contracts';

import {
  CodexCollaborationModeCatalogSchema,
  PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH,
  type CodexCollaborationModeCatalog,
  type CodexCollaborationModeDescriptor,
} from '../shared/project-chat-contracts';
import type { ProjectChatCodex } from './project-chat-service';

export const HERMES_PROVIDER_ID = 'hermes';
export const HERMES_CONFIGURED_MODEL_ID = 'hermes-configured-model';
export const HERMES_VERSION_UNSUPPORTED_ERROR =
  'hermes_version_unsupported_adapter_update_required';
// Hermes delegates reasoning support to its configured downstream provider/model. Until its
// runtime exposes a verified capability catalog, GOSU must not advertise guessed effort values.
export const HERMES_NATIVE_REASONING_OPTION_IDS = [] as const;
const HERMES_DISALLOWED_RUNTIME_PROVIDER_IDS = new Set(['moa', 'copilot-acp']);

const HERMES_CHECK_TIMEOUT_MS = 30_000;
const HERMES_TURN_TIMEOUT_MS = 5 * 60_000;
const HERMES_CHECK_STDOUT_BYTES = 16 * 1_024;
const HERMES_TURN_STDOUT_BYTES = 128 * 1_024;
const HERMES_STDERR_BYTES = 32 * 1_024;
const HERMES_MAX_PROMPT_BYTES = 96 * 1_024;
const HERMES_MAX_LAUNCHER_BYTES = 8 * 1_024;
const HERMES_KILL_GRACE_MS = 1_500;
const HERMES_KILL_CONFIRM_MS = 2_000;
const HERMES_SHIM_CHECK_PROTOCOL = 1;

const HERMES_COLLABORATION_MODES: readonly CodexCollaborationModeDescriptor[] = [
  {
    id: 'default',
    displayName: 'Default',
    recommendedModelId: null,
    recommendedReasoningOptionId: null,
  },
  {
    id: 'plan',
    displayName: 'Plan',
    recommendedModelId: null,
    recommendedReasoningOptionId: null,
  },
];

const HERMES_COLLABORATION_CATALOG_VERSION = createHash('sha256')
  .update(JSON.stringify(HERMES_COLLABORATION_MODES))
  .digest('hex');

/**
 * GOSU deliberately does not invoke `hermes --oneshot`: that entrypoint enables unattended
 * approvals and can discover configured tools/plugins. This sealed shim resolves only the user's
 * configured inference runtime, then constructs a text-only AIAgent with no tools, project rules,
 * memory, persistence, hooks, MCP discovery, or plugin context engine.
 */
export const HERMES_SEALED_SHIM_SOURCE = String.raw`
import contextlib
import copy
import inspect
import json
import os
import sys
import tomllib

MAX_STDIN_BYTES = ${HERMES_MAX_PROMPT_BYTES}
CHECK_PROTOCOL = ${HERMES_SHIM_CHECK_PROTOCOL}
SUPPORTED_HERMES_VERSION = "0.19.1"
ALLOWED_RUNTIME_API_MODES = {
    "chat_completions",
    "codex_responses",
    "anthropic_messages",
    "bedrock_converse",
}
DENIED_RUNTIME_PROVIDERS = {
    "moa",
    "copilot-acp",
    "github-copilot-acp",
    "copilot-acp-agent",
}

def _assert_supported_hermes_version(root):
    with open(os.path.join(root, "pyproject.toml"), "rb") as project_file:
        metadata = tomllib.load(project_file)
    version = str((metadata.get("project") or {}).get("version") or "").strip()
    if version != SUPPORTED_HERMES_VERSION:
        raise RuntimeError("unsupported_hermes_version")

    import hermes_cli
    if str(getattr(hermes_cli, "__version__", "")).strip() != SUPPORTED_HERMES_VERSION:
        raise RuntimeError("hermes_version_mismatch")

def _seal_model_provider_plugins():
    if os.environ.get("HERMES_SAFE_MODE") != "1":
        raise RuntimeError("hermes_safe_mode_required")
    import providers as provider_profiles
    if getattr(provider_profiles, "_discovered", True):
        raise RuntimeError("provider_discovery_already_started")
    user_plugins_dir = getattr(provider_profiles, "_user_plugins_dir", None)
    import_plugin_dir = getattr(provider_profiles, "_import_plugin_dir", None)
    if not callable(user_plugins_dir) or not callable(import_plugin_dir):
        raise RuntimeError("unsupported_hermes_provider_registry")

    def sealed_import_plugin_dir(plugin_dir, source):
        if source != "bundled":
            raise RuntimeError("user_provider_plugin_blocked")
        return import_plugin_dir(plugin_dir, source)

    provider_profiles._user_plugins_dir = lambda: None
    provider_profiles._import_plugin_dir = sealed_import_plugin_dir

def _assert_no_user_provider_plugins():
    if any(name.startswith("_hermes_user_provider_") for name in sys.modules):
        raise RuntimeError("user_provider_plugin_loaded")

def _validate_runtime(runtime):
    if not isinstance(runtime, dict):
        raise RuntimeError("configured_runtime_invalid")
    provider = str(runtime.get("provider") or "").strip()
    requested_provider = str(runtime.get("requested_provider") or "").strip()
    provider_ids = {provider.lower(), requested_provider.lower()}
    if not provider or provider_ids.intersection(DENIED_RUNTIME_PROVIDERS):
        raise RuntimeError("configured_provider_not_allowed")
    api_mode = str(runtime.get("api_mode") or "").strip().lower()
    if api_mode not in ALLOWED_RUNTIME_API_MODES:
        raise RuntimeError("configured_api_mode_not_allowed")
    if any(runtime.get(field) for field in ("command", "args", "acp_command", "acp_args")):
        raise RuntimeError("external_process_runtime_not_allowed")

def _model_config(cfg):
    value = cfg.get("model") or {}
    if isinstance(value, str):
        return {"default": value}
    return value if isinstance(value, dict) else {}

def _safe_config(original, model, provider):
    original_model = _model_config(original)
    safe_model = {"default": model, "provider": provider}
    context_length = original_model.get("context_length")
    if isinstance(context_length, int) and not isinstance(context_length, bool) and context_length > 0:
        safe_model["context_length"] = context_length
    return {
        "model": safe_model,
        "context": {"engine": "compressor"},
        "memory": {"memory_enabled": False, "user_profile_enabled": False},
        "skills": {"creation_nudge_interval": 1000000},
        "agent": {
            "environment_probe": False,
            "tool_use_enforcement": False,
            "task_completion_guidance": False,
            "parallel_tool_call_guidance": False,
            "api_max_retries": 2,
        },
        "compression": {"enabled": False},
        "display": {"show_commentary": False},
        "sessions": {"auto_title": False},
    }

def _resolve_runtime(config_module, cfg):
    model_cfg = _model_config(cfg)
    model = str(os.environ.get("HERMES_INFERENCE_MODEL") or model_cfg.get("default") or model_cfg.get("model") or "").strip()
    provider = str(os.environ.get("HERMES_INFERENCE_PROVIDER") or model_cfg.get("provider") or "").strip()
    if not model:
        raise RuntimeError("configured_model_missing")
    if provider.lower() in DENIED_RUNTIME_PROVIDERS:
        raise RuntimeError("configured_provider_not_allowed")
    config_module.load_config = lambda: copy.deepcopy(cfg)
    config_module.load_config_readonly = lambda: copy.deepcopy(cfg)
    import hermes_cli.auth as auth_module
    if not callable(getattr(auth_module, "resolve_external_process_provider_credentials", None)):
        raise RuntimeError("unsupported_hermes_auth_runtime")

    def reject_external_process_provider(_provider_id):
        raise RuntimeError("external_process_runtime_not_allowed")

    auth_module.resolve_external_process_provider_credentials = reject_external_process_provider
    from hermes_cli.runtime_provider import resolve_runtime_provider
    runtime = resolve_runtime_provider(requested=provider or None, target_model=model)
    _assert_no_user_provider_plugins()
    _validate_runtime(runtime)
    return model, runtime

def _assert_compatible(agent_class):
    parameters = inspect.signature(agent_class).parameters
    required = {
        "enabled_toolsets",
        "skip_context_files",
        "skip_memory",
        "session_db",
        "quiet_mode",
        "platform",
    }
    if not required.issubset(parameters):
        raise RuntimeError("unsupported_hermes_runtime")

def _main():
    if len(sys.argv) < 3:
        raise RuntimeError("invalid_shim_arguments")
    mode = sys.argv[1]
    root = os.path.abspath(sys.argv[2])
    if not os.path.isdir(root):
        raise RuntimeError("invalid_hermes_root")
    sys.path.insert(0, root)
    _assert_supported_hermes_version(root)
    _seal_model_provider_plugins()

    if mode == "check":
        with contextlib.redirect_stdout(sys.stderr):
            import hermes_cli.config as config_module
            loader = getattr(config_module, "load_config_readonly", config_module.load_config)
            original_config = loader()
            model, runtime = _resolve_runtime(config_module, original_config)
            from run_agent import AIAgent
            _assert_compatible(AIAgent)
        provider = str(runtime.get("provider") or "").strip()
        if not provider:
            raise RuntimeError("configured_provider_missing")
        sys.__stdout__.write(json.dumps({
            "protocol": CHECK_PROTOCOL,
            "model": model,
            "provider": provider,
        }, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.__stdout__.flush()
        return

    if mode != "run":
        raise RuntimeError("invalid_shim_mode")
    reasoning = sys.argv[3] if len(sys.argv) > 3 else ""
    expected_model = sys.argv[4] if len(sys.argv) > 4 else ""
    expected_provider = sys.argv[5] if len(sys.argv) > 5 else ""
    prompt_bytes = sys.stdin.buffer.read(MAX_STDIN_BYTES + 1)
    if len(prompt_bytes) > MAX_STDIN_BYTES:
        raise RuntimeError("prompt_limit_exceeded")
    prompt = prompt_bytes.decode("utf-8", errors="strict")
    if not prompt.strip():
        raise RuntimeError("prompt_empty")

    real_stdout = sys.__stdout__
    agent = None
    with contextlib.redirect_stdout(sys.stderr):
        import hermes_cli.config as config_module
        loader = getattr(config_module, "load_config_readonly", config_module.load_config)
        original_config = loader()
        model, runtime = _resolve_runtime(config_module, original_config)
        runtime_provider = str(runtime.get("provider") or "").strip()
        if model != expected_model or runtime_provider != expected_provider:
            raise RuntimeError("configured_runtime_changed")
        sanitized = _safe_config(original_config, model, runtime_provider)
        config_module.load_config = lambda: copy.deepcopy(sanitized)
        config_module.load_config_readonly = lambda: copy.deepcopy(sanitized)

        from run_agent import AIAgent
        _assert_compatible(AIAgent)
        reasoning_config = None
        if reasoning:
            reasoning_config = ({"enabled": False} if reasoning == "none" else {"enabled": True, "effort": reasoning})
        try:
            agent = AIAgent(
                api_key=runtime.get("api_key"),
                base_url=runtime.get("base_url"),
                provider=runtime.get("provider"),
                requested_provider=runtime.get("requested_provider"),
                api_mode=runtime.get("api_mode"),
                model=model,
                max_iterations=1,
                enabled_toolsets=[],
                quiet_mode=True,
                ephemeral_system_prompt=(
                    "GOSU text-only provider: no tools, files, shell, memory, plugins, or MCP "
                    "are available. Answer only from the supplied text and never claim execution."
                ),
                platform="gosu",
                skip_context_files=True,
                load_soul_identity=False,
                skip_memory=True,
                session_db=None,
                fallback_model=None,
                credential_pool=runtime.get("credential_pool"),
                reasoning_config=reasoning_config,
                checkpoints_enabled=False,
            )
            if getattr(agent, "tools", None):
                raise RuntimeError("sealed_tool_boundary_failed")
            agent._persist_disabled = True
            agent._skip_mcp_refresh = True
            if getattr(agent, "valid_tool_names", set()):
                raise RuntimeError("sealed_tool_name_boundary_failed")
            agent.suppress_status_output = True
            agent.stream_delta_callback = None
            agent.tool_gen_callback = None
            result = agent.run_conversation(prompt)
            response = str(result.get("final_response") or "").strip()
            if not response:
                raise RuntimeError("empty_response")
        finally:
            if agent is not None:
                try:
                    agent.shutdown_memory_provider()
                except Exception:
                    pass
                try:
                    agent.close()
                except Exception:
                    pass
    real_stdout.write(response + ("" if response.endswith("\n") else "\n"))
    real_stdout.flush()

try:
    _main()
except Exception as exc:
    failure = str(exc)
    if failure in {"unsupported_hermes_version", "hermes_version_mismatch"}:
        failure = "hermes_version_unsupported_adapter_update_required"
    else:
        failure = type(exc).__name__
    sys.stderr.write("gosu_hermes_shim_failed:" + failure + "\n")
    sys.stderr.flush()
    raise SystemExit(1)
`;

export type HermesInstallation = Readonly<{
  launcherPath: string;
  pythonPath: string;
  rootPath: string;
}>;

export type HermesProcessRequest = Readonly<{
  executable: string;
  args: readonly string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}>;

export type HermesProcessResult = Readonly<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}>;

export interface HermesRunningProcess {
  readonly result: Promise<HermesProcessResult>;
  terminate(): Promise<void>;
  terminateImmediately(): void;
}

export interface HermesProjectChatPlatform {
  findHermesInstallation(): Promise<HermesInstallation | null>;
  createIsolatedWorkingDirectory(): Promise<string>;
  removeIsolatedWorkingDirectory(path: string): Promise<void>;
  startProcess(input: HermesProcessRequest): HermesRunningProcess;
}

export interface RefreshableHermesProjectChat extends ProjectChatCodex {
  refreshConnectionCatalogs(): Promise<
    Readonly<{
      catalog: ModelCatalog;
      collaborationModes: CodexCollaborationModeCatalog;
    }>
  >;
}

type HermesThread = {
  cwd: string;
  developerInstructions: string;
  activeTurnIds: Set<string>;
};

type HermesTurn = {
  threadId: string;
  process: HermesRunningProcess;
  isolatedCwd: string;
  cancelled: boolean;
  terminal: boolean;
};

type HermesReadyRuntime = Readonly<{
  installation: HermesInstallation;
  configuredModelId: string;
  configuredProviderId: string;
  catalogVersion: string;
}>;

type HermesNotification = Readonly<{ method: string; params: Readonly<Record<string, unknown>> }>;

function launcherCandidates(pathEnvironment: string | undefined, homeDirectory: string) {
  const candidates = new Set<string>();
  for (const entry of pathEnvironment?.split(delimiter) ?? []) {
    if (entry.trim()) candidates.add(resolve(entry, 'hermes'));
  }
  candidates.add(join(homeDirectory, '.local', 'bin', 'hermes'));
  return [...candidates];
}

async function executableFile(path: string) {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function readableFile(path: string) {
  try {
    await access(path, constants.R_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function parseHermesLauncher(
  value: string,
  launcherPath: string,
): HermesInstallation | null {
  const normalized = value.replace(/\r\n?/gu, '\n');
  const match = normalized.match(
    /^#!\/usr\/bin\/env bash\nunset PYTHONPATH\nunset PYTHONHOME\nexec "([^"\n]+)" "([^"\n]+)" "\$@"\n?$/u,
  );
  if (!match) return null;
  const pythonPath = match[1]!;
  const entryPath = match[2]!;
  if (!isAbsolute(pythonPath) || !isAbsolute(entryPath) || basename(entryPath) !== 'hermes') {
    return null;
  }
  const rootPath = dirname(entryPath);
  if (resolve(rootPath, 'venv', 'bin', 'python') !== pythonPath) return null;
  return { launcherPath, pythonPath, rootPath };
}

function byteLength(value: string | Buffer) {
  return typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength;
}

const HERMES_PROVIDER_ENVIRONMENT_NAMES = new Set([
  'AI_GATEWAY_API_KEY',
  'AI_GATEWAY_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_REGION',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AZURE_ANTHROPIC_KEY',
  'AZURE_FOUNDRY_API_KEY',
  'AZURE_FOUNDRY_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CUSTOM_API_KEY',
  'CUSTOM_BASE_URL',
  'DEEPINFRA_API_KEY',
  'DEEPINFRA_BASE_URL',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'HERMES_CODEX_BASE_URL',
  'HERMES_HOME',
  'HERMES_INFERENCE_MODEL',
  'HERMES_INFERENCE_PROVIDER',
  'HERMES_NOUS_MIN_KEY_TTL_SECONDS',
  'HERMES_NOUS_TIMEOUT_SECONDS',
  'HERMES_PORTAL_BASE_URL',
  'HERMES_PROFILE',
  'HERMES_QWEN_BASE_URL',
  'HERMES_XAI_BASE_URL',
  'MINIMAX_PORTAL_BASE_URL',
  'NOUS_INFERENCE_BASE_URL',
  'NOUS_PORTAL_BASE_URL',
  'NOVITA_API_KEY',
  'NOVITA_BASE_URL',
  'OLLAMA_API_KEY',
  'OLLAMA_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'VERTEX_CREDENTIALS_PATH',
  'XAI_BASE_URL',
]);

export function hermesSubprocessEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const explicitNames = new Set([
    'ALL_PROXY',
    'CURL_CA_BUNDLE',
    'HOME',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'NO_PROXY',
    'PATH',
    'REQUESTS_CA_BUNDLE',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
    'TMPDIR',
  ]);
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (
      value !== undefined &&
      (explicitNames.has(name) || HERMES_PROVIDER_ENVIRONMENT_NAMES.has(name)) &&
      !name.startsWith('HERMES_KANBAN_')
    ) {
      environment[name] = value;
    }
  }
  environment.HERMES_SAFE_MODE = '1';
  environment.HERMES_SESSION_SOURCE = 'gosu';
  return environment;
}

class NodeHermesRunningProcess implements HermesRunningProcess {
  readonly result: Promise<HermesProcessResult>;
  private settled = false;
  private termination: Promise<void> | null = null;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    request: Pick<
      HermesProcessRequest,
      'stdin' | 'timeoutMs' | 'maxStdoutBytes' | 'maxStderrBytes'
    >,
  ) {
    this.result = new Promise<HermesProcessResult>((resolveResult, rejectResult) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let terminalError: Error | null = null;

      const failAndTerminate = (error: Error) => {
        if (terminalError || this.settled) return;
        terminalError = error;
        void this.terminate().catch(() => undefined);
      };
      const append = (
        target: Buffer[],
        chunk: Buffer,
        limit: number,
        currentBytes: number,
        errorCode: string,
      ) => {
        const nextBytes = currentBytes + byteLength(chunk);
        if (nextBytes > limit) {
          failAndTerminate(new Error(errorCode));
          return currentBytes;
        }
        target.push(chunk);
        return nextBytes;
      };

      this.child.stdout.on('data', (chunk: Buffer | string) => {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stdoutBytes = append(
          stdout,
          value,
          request.maxStdoutBytes,
          stdoutBytes,
          'hermes_stdout_limit_exceeded',
        );
      });
      this.child.stderr.on('data', (chunk: Buffer | string) => {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stderrBytes = append(
          stderr,
          value,
          request.maxStderrBytes,
          stderrBytes,
          'hermes_stderr_limit_exceeded',
        );
      });
      this.child.once('error', (error) => {
        terminalError ??= error;
      });
      this.child.once('close', (exitCode, signal) => {
        if (timeout) clearTimeout(timeout);
        this.settled = true;
        if (terminalError) {
          rejectResult(terminalError);
          return;
        }
        resolveResult({
          exitCode,
          signal,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
      });
      const timeout = setTimeout(
        () => failAndTerminate(new Error('hermes_process_timeout')),
        request.timeoutMs,
      );
      this.child.stdin.on('error', () => undefined);
      this.child.stdin.end(request.stdin, 'utf8');
    });
    void this.result.catch(() => undefined);
  }

  terminate(): Promise<void> {
    if (this.settled) return Promise.resolve();
    if (this.termination) return this.termination;
    this.termination = new Promise<void>((resolveTermination, rejectTermination) => {
      let confirmation: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        if (escalation) clearTimeout(escalation);
        if (confirmation) clearTimeout(confirmation);
        if (error) rejectTermination(error);
        else resolveTermination();
      };
      this.child.once('close', () => finish());
      this.child.once('error', (error) => finish(error));
      try {
        this.kill('SIGTERM');
      } catch (error) {
        finish(error instanceof Error ? error : new Error('hermes_process_terminate_failed'));
        return;
      }
      const escalation = setTimeout(() => {
        if (this.settled) return;
        try {
          this.kill('SIGKILL');
        } catch (error) {
          finish(error instanceof Error ? error : new Error('hermes_process_kill_failed'));
          return;
        }
        confirmation = setTimeout(
          () => finish(new Error('hermes_process_kill_unconfirmed')),
          HERMES_KILL_CONFIRM_MS,
        );
      }, HERMES_KILL_GRACE_MS);
    });
    return this.termination;
  }

  terminateImmediately() {
    if (this.settled) return;
    try {
      this.kill('SIGKILL');
    } catch {
      // Electron cannot await shutdown. Best-effort force termination must not block app quit.
    }
  }

  private kill(signal: NodeJS.Signals) {
    if (process.platform !== 'win32' && this.child.pid) {
      process.kill(-this.child.pid, signal);
      return;
    }
    this.child.kill(signal);
  }
}

export function createNodeHermesProjectChatPlatform(input?: {
  pathEnvironment?: string;
  homeDirectory?: string;
}): HermesProjectChatPlatform {
  const pathEnvironment = input?.pathEnvironment ?? process.env.PATH;
  const homeDirectory = input?.homeDirectory ?? homedir();
  return {
    async findHermesInstallation() {
      for (const candidate of launcherCandidates(pathEnvironment, homeDirectory)) {
        if (!(await executableFile(candidate))) continue;
        const launcherPath = await realpath(candidate).catch(() => candidate);
        const launcherStat = await stat(launcherPath).catch(() => null);
        if (!launcherStat?.isFile() || launcherStat.size > HERMES_MAX_LAUNCHER_BYTES) continue;
        const parsed = parseHermesLauncher(await readFile(launcherPath, 'utf8'), launcherPath);
        if (
          parsed &&
          (await executableFile(parsed.pythonPath)) &&
          (await readableFile(join(parsed.rootPath, 'run_agent.py')))
        ) {
          return parsed;
        }
      }
      return null;
    },
    createIsolatedWorkingDirectory() {
      return mkdtemp(join(tmpdir(), 'gosu-hermes-'));
    },
    async removeIsolatedWorkingDirectory(path) {
      await rm(path, { recursive: true, force: true });
    },
    startProcess(request) {
      const child = spawn(request.executable, [...request.args], {
        cwd: request.cwd,
        detached: process.platform !== 'win32',
        env: hermesSubprocessEnvironment(),
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return new NodeHermesRunningProcess(child, request);
    },
  };
}

function modelCatalog(
  runtime: HermesReadyRuntime,
  fetchedAt = new Date().toISOString(),
): ModelCatalog {
  return ModelCatalogSchema.parse({
    schemaVersion: 1,
    providerId: HERMES_PROVIDER_ID,
    catalogVersion: runtime.catalogVersion,
    fetchedAt,
    models: [
      {
        schemaVersion: 1,
        providerId: HERMES_PROVIDER_ID,
        modelId: HERMES_CONFIGURED_MODEL_ID,
        displayName: `Hermes · ${runtime.configuredModelId}`.slice(0, 256),
        catalogVersion: runtime.catalogVersion,
        isDefault: false,
        modalities: ['text'],
        reasoningOptions: HERMES_NATIVE_REASONING_OPTION_IDS.map((id) => ({
          id,
          label: id,
          isDefault: false,
        })),
        metadata: {
          runtime: 'byo-hermes-sealed-shim',
          configuredModel: true,
          configuredModelId: runtime.configuredModelId,
          configuredProviderId: runtime.configuredProviderId,
        },
      },
    ],
  });
}

function collaborationModeCatalog(): CodexCollaborationModeCatalog {
  return CodexCollaborationModeCatalogSchema.parse({
    catalogVersion: HERMES_COLLABORATION_CATALOG_VERSION,
    modes: HERMES_COLLABORATION_MODES,
  });
}

function parseReadyRuntime(installation: HermesInstallation, output: string): HermesReadyRuntime {
  let value: unknown;
  try {
    value = JSON.parse(output.trim()) as unknown;
  } catch {
    throw new Error('hermes_runtime_check_invalid');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('hermes_runtime_check_invalid');
  }
  const record = value as Record<string, unknown>;
  const configuredModelId = typeof record.model === 'string' ? record.model.trim() : '';
  const configuredProviderId = typeof record.provider === 'string' ? record.provider.trim() : '';
  const containsControlCharacter = (candidate: string) =>
    [...candidate].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    });
  if (
    record.protocol !== HERMES_SHIM_CHECK_PROTOCOL ||
    Object.keys(record).sort().join(',') !== 'model,protocol,provider' ||
    !configuredModelId ||
    configuredModelId.length > 256 ||
    containsControlCharacter(configuredModelId) ||
    !configuredProviderId ||
    configuredProviderId.length > 128 ||
    containsControlCharacter(configuredProviderId)
  ) {
    throw new Error('hermes_runtime_check_invalid');
  }
  if (HERMES_DISALLOWED_RUNTIME_PROVIDER_IDS.has(configuredProviderId.toLowerCase())) {
    throw new Error('hermes_runtime_provider_not_allowed');
  }
  const catalogVersion = createHash('sha256')
    .update(
      JSON.stringify({
        adapter: 'gosu-byo-hermes-sealed-shim-v2',
        configuredModelId,
        configuredProviderId,
        reasoning: HERMES_NATIVE_REASONING_OPTION_IDS,
      }),
    )
    .digest('hex');
  return { installation, configuredModelId, configuredProviderId, catalogVersion };
}

function normalizedProjectResponse(output: string) {
  const trimmed = output.trim();
  if (!trimmed) throw new Error('hermes_empty_response');
  return JSON.stringify({
    reply: trimmed.slice(0, PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH),
    actions: [],
    researchNote: { disposition: 'none' },
  });
}

function buildHermesPrompt(developerInstructions: string, prompt: string) {
  const combined = [
    'GOSU is using Hermes as a sealed, text-only language-model provider.',
    'No shell, files, external tools, project mutations, memory, plugins, or MCP are available.',
    'Never claim that you executed a tool or changed project state.',
    '<gosu_developer_instructions>',
    developerInstructions,
    '</gosu_developer_instructions>',
    '<gosu_project_prompt>',
    prompt,
    '</gosu_project_prompt>',
    'Return only the natural-language reply. GOSU will add its own safe response envelope.',
  ].join('\n');
  if (Buffer.byteLength(combined, 'utf8') > HERMES_MAX_PROMPT_BYTES) {
    throw new Error('hermes_prompt_limit_exceeded');
  }
  return combined;
}

export class HermesProjectChatAdapter extends EventEmitter implements RefreshableHermesProjectChat {
  private readonly threads = new Map<string, HermesThread>();
  private readonly turns = new Map<string, HermesTurn>();
  private readonly activeProcesses = new Set<HermesRunningProcess>();
  private readyRuntime: HermesReadyRuntime | null = null;
  private readiness: Promise<HermesReadyRuntime> | null = null;
  private shuttingDown = false;

  constructor(
    private readonly platform: HermesProjectChatPlatform = createNodeHermesProjectChatPlatform(),
  ) {
    super();
  }

  async listModelCatalog() {
    return modelCatalog(await this.ensureReady());
  }

  async listCollaborationModeCatalog() {
    await this.ensureReady();
    return collaborationModeCatalog();
  }

  async refreshConnectionCatalogs() {
    const runtime = await this.ensureReady(true);
    return {
      catalog: modelCatalog(runtime),
      collaborationModes: collaborationModeCatalog(),
    };
  }

  async startThread(input: Parameters<ProjectChatCodex['startThread']>[0]) {
    await this.ensureReady();
    this.assertRunning();
    if (input.modelId !== null && input.modelId !== HERMES_CONFIGURED_MODEL_ID) {
      throw new Error('hermes_model_not_in_catalog');
    }
    const threadId = `hermes:thread:${randomUUID()}`;
    this.threads.set(threadId, {
      cwd: input.cwd,
      developerInstructions: input.developerInstructions ?? '',
      activeTurnIds: new Set(),
    });
    return { threadId };
  }

  async runTurn(input: Parameters<ProjectChatCodex['runTurn']>[0]) {
    const runtime = await this.ensureReady();
    const thread = this.threads.get(input.threadId);
    if (!thread) throw new Error('hermes_thread_not_found');
    if (thread.cwd !== input.cwd) throw new Error('hermes_thread_cwd_mismatch');
    if (input.requestedModelId !== null && input.requestedModelId !== HERMES_CONFIGURED_MODEL_ID) {
      throw new Error('hermes_model_not_in_catalog');
    }
    if (input.localImagePaths && input.localImagePaths.length > 0) {
      throw new Error('hermes_image_attachments_not_supported');
    }
    if (
      input.reasoningOptionId !== null &&
      !HERMES_NATIVE_REASONING_OPTION_IDS.includes(
        input.reasoningOptionId as (typeof HERMES_NATIVE_REASONING_OPTION_IDS)[number],
      )
    ) {
      throw new Error('hermes_reasoning_option_invalid');
    }

    const prompt = buildHermesPrompt(thread.developerInstructions, input.prompt);
    const isolatedCwd = await this.platform.createIsolatedWorkingDirectory();
    let process: HermesRunningProcess;
    try {
      process = this.startTrackedProcess({
        executable: runtime.installation.pythonPath,
        args: [
          '-I',
          '-c',
          HERMES_SEALED_SHIM_SOURCE,
          'run',
          runtime.installation.rootPath,
          input.reasoningOptionId ?? '',
          runtime.configuredModelId,
          runtime.configuredProviderId,
        ],
        cwd: isolatedCwd,
        stdin: prompt,
        timeoutMs: HERMES_TURN_TIMEOUT_MS,
        maxStdoutBytes: HERMES_TURN_STDOUT_BYTES,
        maxStderrBytes: HERMES_STDERR_BYTES,
      });
    } catch (error) {
      await this.platform.removeIsolatedWorkingDirectory(isolatedCwd).catch(() => undefined);
      throw error;
    }

    const turnId = `hermes:turn:${randomUUID()}`;
    const invocation = ModelInvocationSchema.parse({
      schemaVersion: 1,
      invocationId: randomUUID(),
      providerId: HERMES_PROVIDER_ID,
      requestedModelId: input.requestedModelId,
      resolvedModelId: runtime.configuredModelId,
      catalogVersion: runtime.catalogVersion,
      reasoningOptionId: input.reasoningOptionId,
      startedAt: new Date().toISOString(),
    });
    const turn: HermesTurn = {
      threadId: input.threadId,
      process,
      isolatedCwd,
      cancelled: false,
      terminal: false,
    };
    this.turns.set(turnId, turn);
    thread.activeTurnIds.add(turnId);
    this.emit('invocation', { threadId: input.threadId, turnId, invocation });
    void this.finishTurn(input.threadId, turnId, turn);
    return {
      turnId,
      invocation,
      collaborationMode:
        HERMES_COLLABORATION_MODES.find(
          (candidate) => candidate.id === input.collaborationModeId,
        ) ?? null,
      effectiveReasoningOptionId: input.reasoningOptionId,
      personality: input.personality ?? null,
    };
  }

  async interruptTurn(threadId: string, turnId: string) {
    const turn = this.turns.get(turnId);
    if (!turn || turn.threadId !== threadId) throw new Error('hermes_turn_not_found');
    if (turn.terminal) return;
    turn.cancelled = true;
    await turn.process.terminate();
  }

  revokeDynamicTools(_threadId: string) {
    // No GOSU dynamic tools cross this sealed text-only boundary.
  }

  async releaseThread(threadId: string) {
    const thread = this.threads.get(threadId);
    if (!thread) return;
    const turns = [...thread.activeTurnIds]
      .map((turnId) => this.turns.get(turnId))
      .filter((turn): turn is HermesTurn => turn !== undefined && !turn.terminal);
    for (const turn of turns) turn.cancelled = true;
    await Promise.all(turns.map((turn) => turn.process.terminate()));
    this.threads.delete(threadId);
  }

  shutdown() {
    if (this.shuttingDown) return 0;
    this.shuttingDown = true;
    this.readyRuntime = null;
    this.readiness = null;
    for (const turn of this.turns.values()) turn.cancelled = true;
    const processes = [...this.activeProcesses];
    this.activeProcesses.clear();
    for (const process of processes) process.terminateImmediately();
    this.turns.clear();
    this.threads.clear();
    return processes.length;
  }

  private async ensureReady(forceRefresh = false) {
    this.assertRunning();
    if (!forceRefresh && this.readyRuntime) return this.readyRuntime;
    if (this.readiness) return this.readiness;
    this.readiness = this.checkReady();
    try {
      this.readyRuntime = await this.readiness;
      return this.readyRuntime;
    } finally {
      this.readiness = null;
    }
  }

  private async checkReady() {
    const installation = await this.platform.findHermesInstallation();
    if (!installation) throw new Error('hermes_installation_not_supported');
    const configuration = await this.checkedProcess({
      executable: installation.pythonPath,
      args: ['-I', '-c', HERMES_SEALED_SHIM_SOURCE, 'check', installation.rootPath],
      stdin: '',
    });
    return parseReadyRuntime(installation, configuration);
  }

  private async checkedProcess(input: {
    executable: string;
    args: readonly string[];
    stdin: string;
  }) {
    const isolatedCwd = await this.platform.createIsolatedWorkingDirectory();
    try {
      const process = this.startTrackedProcess({
        ...input,
        cwd: isolatedCwd,
        timeoutMs: HERMES_CHECK_TIMEOUT_MS,
        maxStdoutBytes: HERMES_CHECK_STDOUT_BYTES,
        maxStderrBytes: HERMES_STDERR_BYTES,
      });
      const result = await process.result;
      if (result.exitCode !== 0 || result.signal !== null) {
        if (result.stderr.includes(`gosu_hermes_shim_failed:${HERMES_VERSION_UNSUPPORTED_ERROR}`)) {
          throw new Error(HERMES_VERSION_UNSUPPORTED_ERROR);
        }
        throw new Error('hermes_runtime_check_failed');
      }
      return result.stdout;
    } finally {
      await this.platform.removeIsolatedWorkingDirectory(isolatedCwd).catch(() => undefined);
    }
  }

  private async finishTurn(threadId: string, turnId: string, turn: HermesTurn) {
    let status: 'completed' | 'interrupted' | 'failed' = 'failed';
    try {
      const result = await turn.process.result;
      if (turn.cancelled) {
        status = 'interrupted';
      } else if (result.exitCode === 0 && result.signal === null) {
        const text = normalizedProjectResponse(result.stdout);
        this.emitNotification({
          method: 'item/completed',
          params: {
            threadId,
            turnId,
            item: { id: randomUUID(), type: 'agentMessage', phase: 'final', text },
          },
        });
        status = 'completed';
      }
    } catch {
      status = turn.cancelled ? 'interrupted' : 'failed';
    } finally {
      turn.terminal = true;
      this.turns.delete(turnId);
      this.threads.get(threadId)?.activeTurnIds.delete(turnId);
      await this.platform.removeIsolatedWorkingDirectory(turn.isolatedCwd).catch(() => undefined);
      if (!this.shuttingDown) {
        this.emitNotification({
          method: 'turn/completed',
          params: { threadId, turn: { id: turnId, status } },
        });
      }
    }
  }

  private assertRunning() {
    if (this.shuttingDown) throw new Error('hermes_adapter_shut_down');
  }

  private startTrackedProcess(request: HermesProcessRequest) {
    this.assertRunning();
    const process = this.platform.startProcess(request);
    this.activeProcesses.add(process);
    void process.result.finally(() => this.activeProcesses.delete(process)).catch(() => undefined);
    return process;
  }

  private emitNotification(notification: HermesNotification) {
    this.emit('notification', notification);
  }
}
