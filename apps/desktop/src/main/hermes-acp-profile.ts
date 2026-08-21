import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { HermesValidatedAcpRuntime } from './hermes-project-chat-adapter';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MAX_DOTENV_BYTES = 256 * 1_024;
const HERMES_ACP_PROFILE_SCHEMA_VERSION = 2;

// Reviewed against every bundled `plugins/model-providers/*/__init__.py` in pinned Hermes 0.19.1
// plus the pinned runtime's built-in OpenAI/custom/Vertex/Azure route resolvers. This is static on
// purpose: a newly installed/user provider cannot smuggle an arbitrary environment name across
// the GOSU boundary. The sealed launchers remove every credential before importing run_agent or a
// tool module and pass only the selected, verified route's resolved token to AIAgent.
export const HERMES_PROVIDER_CREDENTIAL_ENVIRONMENT_NAME_LIST = [
  'AI_GATEWAY_API_KEY',
  'ALIBABA_CODING_PLAN_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_TOKEN',
  'ARCEEAI_API_KEY',
  'AZURE_ANTHROPIC_KEY',
  'AZURE_AUTHORITY_HOST',
  'AZURE_CLIENT_CERTIFICATE_PATH',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_FEDERATED_TOKEN_FILE',
  'AZURE_FOUNDRY_API_KEY',
  'AZURE_TENANT_ID',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'COPILOT_GITHUB_TOKEN',
  'CUSTOM_API_KEY',
  'DASHSCOPE_API_KEY',
  'DEEPINFRA_API_KEY',
  'DEEPSEEK_API_KEY',
  'FIREWORKS_API_KEY',
  'GEMINI_API_KEY',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GLM_API_KEY',
  'GMI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'HF_TOKEN',
  'IDENTITY_ENDPOINT',
  'KILOCODE_API_KEY',
  'KIMI_API_KEY',
  'KIMI_CN_API_KEY',
  'KIMI_CODING_API_KEY',
  'LM_API_KEY',
  'MINIMAX_API_KEY',
  'MINIMAX_CN_API_KEY',
  'MSI_ENDPOINT',
  'NOUS_API_KEY',
  'NOVITA_API_KEY',
  'NVIDIA_API_KEY',
  'OLLAMA_API_KEY',
  'OPENCODE_GO_API_KEY',
  'OPENCODE_ZEN_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'QWEN_API_KEY',
  'STEPFUN_API_KEY',
  'TOKENHUB_API_KEY',
  'UPSTAGE_API_KEY',
  'VERTEX_CREDENTIALS_PATH',
  'XAI_API_KEY',
  'XIAOMI_API_KEY',
  'ZAI_API_KEY',
  'Z_AI_API_KEY',
] as const;

// Explicit route overrides from the same pinned provider registry. Fixed-endpoint plugins such as
// Fireworks intentionally have no corresponding environment override.
export const HERMES_PROVIDER_ROUTE_ENVIRONMENT_NAME_LIST = [
  'AI_GATEWAY_BASE_URL',
  'ALIBABA_CODING_PLAN_BASE_URL',
  'ANTHROPIC_BASE_URL',
  'ARCEE_BASE_URL',
  'AZURE_FOUNDRY_BASE_URL',
  'COPILOT_API_BASE_URL',
  'CUSTOM_BASE_URL',
  'DASHSCOPE_BASE_URL',
  'DEEPINFRA_BASE_URL',
  'DEEPSEEK_BASE_URL',
  'GEMINI_BASE_URL',
  'GLM_BASE_URL',
  'GMI_BASE_URL',
  'HERMES_CODEX_BASE_URL',
  'HERMES_PORTAL_BASE_URL',
  'HERMES_QWEN_BASE_URL',
  'HERMES_XAI_BASE_URL',
  'HF_BASE_URL',
  'KILOCODE_BASE_URL',
  'KIMI_BASE_URL',
  'LM_BASE_URL',
  'MINIMAX_BASE_URL',
  'MINIMAX_CN_BASE_URL',
  'MINIMAX_PORTAL_BASE_URL',
  'NOUS_BASE_URL',
  'NOUS_INFERENCE_BASE_URL',
  'NOUS_PORTAL_BASE_URL',
  'NOVITA_BASE_URL',
  'NVIDIA_BASE_URL',
  'OLLAMA_BASE_URL',
  'OPENCODE_GO_BASE_URL',
  'OPENCODE_ZEN_BASE_URL',
  'OPENAI_BASE_URL',
  'OPENROUTER_BASE_URL',
  'STEPFUN_BASE_URL',
  'TOKENHUB_BASE_URL',
  'UPSTAGE_BASE_URL',
  'VERTEX_PROJECT_ID',
  'VERTEX_REGION',
  'XAI_BASE_URL',
  'XIAOMI_BASE_URL',
] as const;

const HERMES_PROVIDER_AUTH_CONTROL_ENVIRONMENT_NAME_LIST = [
  'HERMES_NOUS_MIN_KEY_TTL_SECONDS',
  'HERMES_NOUS_TIMEOUT_SECONDS',
  'HERMES_SHARED_AUTH_DIR',
] as const;

export const HERMES_PROVIDER_ENVIRONMENT_NAME_LIST = [
  ...HERMES_PROVIDER_CREDENTIAL_ENVIRONMENT_NAME_LIST,
  ...HERMES_PROVIDER_ROUTE_ENVIRONMENT_NAME_LIST,
  ...HERMES_PROVIDER_AUTH_CONTROL_ENVIRONMENT_NAME_LIST,
] as const;

const HERMES_PROFILE_ENVIRONMENT_NAMES = new Set<string>([
  ...HERMES_PROVIDER_ENVIRONMENT_NAME_LIST,
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

export type HermesAcpProfileInput = Readonly<{
  runtime: HermesValidatedAcpRuntime;
  projectId: string;
  sessionId: string;
}>;

export type HermesAcpPreparedProfile = Readonly<{
  homeDirectory: string;
  environment: NodeJS.ProcessEnv;
  retention: 'persistent-project-session-local';
}>;

export interface HermesAcpProfileFactory {
  prepare(input: HermesAcpProfileInput): HermesAcpPreparedProfile;
}

export type NodeHermesAcpProfileFactoryOptions = Readonly<{
  sourceHome?: (runtime: HermesValidatedAcpRuntime) => string;
}>;

function requireAbsoluteDirectory(path: string, code: string) {
  if (!isAbsolute(path)) throw new Error(code);
  const resolved = realpathSync(path);
  const metadata = lstatSync(resolved);
  if (!metadata.isDirectory()) throw new Error(code);
  return resolved;
}

function sourceHermesHome(runtime: HermesValidatedAcpRuntime) {
  const explicit = runtime.environment.HERMES_HOME?.trim();
  if (explicit) return requireAbsoluteDirectory(explicit, 'hermes_profile_source_invalid');
  const userHome = runtime.environment.HOME?.trim() || homedir();
  if (!isAbsolute(userHome)) throw new Error('hermes_profile_source_invalid');
  return requireAbsoluteDirectory(resolve(userHome, '.hermes'), 'hermes_profile_source_invalid');
}

function sourceHermesRoot(sourceHome: string) {
  return basename(dirname(sourceHome)) === 'profiles' ? dirname(dirname(sourceHome)) : sourceHome;
}

function assertPrivateDirectory(path: string, code: string) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error(code);
  chmodSync(path, PRIVATE_DIRECTORY_MODE);
}

function ensurePrivateDirectory(path: string, code: string) {
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  assertPrivateDirectory(path, code);
  return realpathSync(path);
}

function assertContained(parent: string, child: string) {
  const childRelative = relative(parent, child);
  if (!childRelative || childRelative === '..' || childRelative.startsWith(`..${sep}`)) {
    throw new Error('hermes_profile_path_invalid');
  }
}

function profileName(projectId: string, sessionId: string) {
  const digest = createHash('sha256')
    .update(`v${HERMES_ACP_PROFILE_SCHEMA_VERSION}:${projectId}:${sessionId}`, 'utf8')
    .digest('hex');
  return `gosu-${digest.slice(0, 40)}`;
}

function yamlString(value: string) {
  return JSON.stringify(value.normalize('NFC'));
}

function isolatedConfig(runtime: HermesValidatedAcpRuntime) {
  return [
    '# Managed by GOSU. This profile contains no copied API keys or OAuth tokens.',
    'model:',
    `  default: ${yamlString(runtime.configuredModelId)}`,
    `  provider: ${yamlString(runtime.configuredProviderId)}`,
    'memory:',
    '  memory_enabled: false',
    '  user_profile_enabled: false',
    'context:',
    '  engine: compressor',
    'approvals:',
    '  mode: manual',
    '  cron_mode: deny',
    '  smart_policy: ""',
    'command_allowlist: []',
    'mcp_servers: {}',
    'compression:',
    '  enabled: false',
    'sessions:',
    '  auto_title: false',
    'telemetry:',
    '  shared_metrics:',
    '    enabled: false',
    '',
  ].join('\n');
}

function entryMetadata(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function assertSafeProfileEntry(profileHome: string, name: string, kind: 'file' | 'directory') {
  const path = join(profileHome, name);
  const metadata = entryMetadata(path);
  if (!metadata) return;
  const valid =
    !metadata.isSymbolicLink() && (kind === 'file' ? metadata.isFile() : metadata.isDirectory());
  if (!valid) throw new Error('hermes_profile_entry_invalid');
}

function removeTransientCredentialFile(profileHome: string, name: string) {
  assertSafeProfileEntry(profileHome, name, 'file');
  const path = join(profileHome, name);
  if (entryMetadata(path)) unlinkSync(path);
}

function writePrivateConfig(profileHome: string, value: string) {
  const configPath = join(profileHome, 'config.yaml');
  assertSafeProfileEntry(profileHome, 'config.yaml', 'file');
  const temporaryPath = join(profileHome, `.config.${randomUUID()}.tmp`);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, 'wx', PRIVATE_FILE_MODE);
    writeFileSync(descriptor, value, { encoding: 'utf8' });
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, configPath);
    chmodSync(configPath, PRIVATE_FILE_MODE);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function dotenvValue(rawValue: string) {
  const value = rawValue.trim();
  if (!value) return '';
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) throw new Error('hermes_profile_dotenv_invalid');
    return value.slice(1, -1);
  }
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) throw new Error('hermes_profile_dotenv_invalid');
    try {
      return JSON.parse(value) as string;
    } catch {
      throw new Error('hermes_profile_dotenv_invalid');
    }
  }
  const comment = value.search(/\s#/u);
  return (comment >= 0 ? value.slice(0, comment) : value).trim();
}

function providerEnvironmentFromDotenv(sourceHome: string) {
  const path = join(sourceHome, '.env');
  const metadata = entryMetadata(path);
  if (!metadata) return {};
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_DOTENV_BYTES) {
    throw new Error('hermes_profile_dotenv_invalid');
  }
  const values: NodeJS.ProcessEnv = {};
  const text = readFileSync(path, 'utf8');
  for (const originalLine of text.split(/\r?\n/u)) {
    const line = originalLine.trim();
    if (!line || line.startsWith('#')) continue;
    const assignment = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = assignment.indexOf('=');
    if (separator <= 0) continue;
    const name = assignment.slice(0, separator).trim();
    if (!HERMES_PROFILE_ENVIRONMENT_NAMES.has(name)) continue;
    values[name] = dotenvValue(assignment.slice(separator + 1));
  }
  return values;
}

function filteredRuntimeEnvironment(source: NodeJS.ProcessEnv) {
  const values: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && HERMES_PROFILE_ENVIRONMENT_NAMES.has(name)) {
      values[name] = value;
    }
  }
  return values;
}

export function createNodeHermesAcpProfileFactory(
  options: NodeHermesAcpProfileFactoryOptions = {},
): HermesAcpProfileFactory {
  return {
    prepare(input) {
      const sourceHome = requireAbsoluteDirectory(
        options.sourceHome?.(input.runtime) ?? sourceHermesHome(input.runtime),
        'hermes_profile_source_invalid',
      );
      const root = requireAbsoluteDirectory(
        sourceHermesRoot(sourceHome),
        'hermes_profile_source_invalid',
      );
      const profilesRoot = ensurePrivateDirectory(
        join(root, 'profiles'),
        'hermes_profiles_directory_invalid',
      );
      const name = profileName(input.projectId, input.sessionId);
      const homeDirectory = ensurePrivateDirectory(
        join(profilesRoot, name),
        'hermes_profile_directory_invalid',
      );
      assertContained(profilesRoot, homeDirectory);

      // These are the only persistent entries Hermes ACP may legitimately create in a GOSU
      // profile. Reject link substitution before launch; never follow a profile-controlled link
      // into another project's state or the user's global Hermes home.
      for (const file of ['state.db', 'state.db-shm', 'state.db-wal', 'auth.json']) {
        assertSafeProfileEntry(homeDirectory, file, 'file');
      }
      for (const directory of ['memories', 'sessions', 'cache']) {
        assertSafeProfileEntry(homeDirectory, directory, 'directory');
      }
      if (entryMetadata(join(homeDirectory, '.env'))) {
        throw new Error('hermes_profile_dotenv_forbidden');
      }
      // Hermes may cache a refreshed provider credential in its isolated profile even though the
      // authoritative account remains in the user's selected global Hermes profile. Reusing that
      // cache after the account refreshes makes the sealed route proof fail on the next GOSU
      // launch. Remove only GOSU-managed transient auth files so every connection binds to the
      // current global account/environment again; project/session data remains isolated.
      removeTransientCredentialFile(homeDirectory, 'auth.json');
      removeTransientCredentialFile(homeDirectory, 'auth.lock');
      writePrivateConfig(homeDirectory, isolatedConfig(input.runtime));

      const environment = {
        ...filteredRuntimeEnvironment(input.runtime.environment),
        ...providerEnvironmentFromDotenv(sourceHome),
        HERMES_HOME: homeDirectory,
        HERMES_PROFILE: name,
        HERMES_INFERENCE_MODEL: input.runtime.configuredModelId,
        HERMES_INFERENCE_PROVIDER: input.runtime.configuredProviderId,
        HERMES_SAFE_MODE: '1',
        HERMES_IGNORE_RULES: '1',
        HERMES_YOLO_MODE: '',
        HERMES_ACP_AUTO_APPROVE: '',
        HERMES_ACP_SKIP_CONFIGURED_MCP: '1',
        HERMES_SESSION_SOURCE: 'gosu',
      } satisfies NodeJS.ProcessEnv;
      return { homeDirectory, environment, retention: 'persistent-project-session-local' };
    },
  };
}
