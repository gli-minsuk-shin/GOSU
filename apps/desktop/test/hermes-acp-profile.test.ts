import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createNodeHermesAcpProfileFactory,
  HERMES_PROVIDER_CREDENTIAL_ENVIRONMENT_NAME_LIST,
  HERMES_PROVIDER_ENVIRONMENT_NAME_LIST,
  HERMES_PROVIDER_ROUTE_ENVIRONMENT_NAME_LIST,
} from '../src/main/hermes-acp-profile';
import { HERMES_SEALED_ACP_SOURCE } from '../src/main/hermes-acp-sealed-launcher';
import type { HermesValidatedAcpRuntime } from '../src/main/hermes-project-chat-adapter';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_SESSION_ID = '33333333-3333-4333-8333-333333333333';
const temporaryRoots: string[] = [];

function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), 'gosu-hermes-profile-'));
  temporaryRoots.push(path);
  return path;
}

function runtime(sourceHome: string): HermesValidatedAcpRuntime {
  return {
    pythonPath: join(sourceHome, 'hermes-agent', 'venv', 'bin', 'python'),
    rootPath: join(sourceHome, 'hermes-agent'),
    environment: {
      HOME: dirname(sourceHome),
      HERMES_HOME: sourceHome,
      OPENAI_API_KEY: 'shell-value',
      SSH_AUTH_SOCK: '/private/tmp/agent-must-not-cross',
      UNKNOWN_PROVIDER_TOKEN: 'unknown-runtime-secret',
      HERMES_YOLO_MODE: '1',
      HERMES_ACP_AUTO_APPROVE: 'yes',
    },
    configuredModelId: 'gpt-fixture',
    configuredProviderId: 'openai',
    routeFingerprint: 'c'.repeat(64),
    credentialBindingKey: 'b'.repeat(64),
    credentialProof: 'e'.repeat(64),
    sourceCatalogVersion: 'a'.repeat(64),
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Hermes ACP isolated profile factory', () => {
  it('pins the complete Hermes 0.19.1 bundled inference-provider environment surface', () => {
    // Static audit fixture from plugins/model-providers/*/__init__.py. Do not replace this with
    // plugin discovery: new/user plugins require a reviewed GOSU release before receiving a key.
    const bundledProviderEnvironmentNames = [
      'AI_GATEWAY_API_KEY',
      'ALIBABA_CODING_PLAN_API_KEY',
      'ALIBABA_CODING_PLAN_BASE_URL',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_TOKEN',
      'ARCEEAI_API_KEY',
      'AZURE_FOUNDRY_API_KEY',
      'AZURE_FOUNDRY_BASE_URL',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'COPILOT_GITHUB_TOKEN',
      'DASHSCOPE_API_KEY',
      'DEEPINFRA_API_KEY',
      'DEEPINFRA_BASE_URL',
      'DEEPSEEK_API_KEY',
      'FIREWORKS_API_KEY',
      'GEMINI_API_KEY',
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'GLM_API_KEY',
      'GMI_API_KEY',
      'GMI_BASE_URL',
      'GOOGLE_API_KEY',
      'HF_TOKEN',
      'KILOCODE_API_KEY',
      'KIMI_API_KEY',
      'KIMI_CN_API_KEY',
      'KIMI_CODING_API_KEY',
      'MINIMAX_API_KEY',
      'MINIMAX_CN_API_KEY',
      'NOUS_API_KEY',
      'NOVITA_API_KEY',
      'NOVITA_BASE_URL',
      'NVIDIA_API_KEY',
      'OLLAMA_API_KEY',
      'OPENCODE_GO_API_KEY',
      'OPENCODE_ZEN_API_KEY',
      'OPENROUTER_API_KEY',
      'QWEN_API_KEY',
      'STEPFUN_API_KEY',
      'UPSTAGE_API_KEY',
      'UPSTAGE_BASE_URL',
      'XAI_API_KEY',
      'XIAOMI_API_KEY',
      'ZAI_API_KEY',
      'Z_AI_API_KEY',
    ] as const;

    for (const name of bundledProviderEnvironmentNames) {
      expect(HERMES_PROVIDER_ENVIRONMENT_NAME_LIST).toContain(name);
    }
    expect(HERMES_PROVIDER_CREDENTIAL_ENVIRONMENT_NAME_LIST).toEqual(
      expect.arrayContaining([
        'GOOGLE_API_KEY',
        'XAI_API_KEY',
        'NOUS_API_KEY',
        'DEEPSEEK_API_KEY',
        'FIREWORKS_API_KEY',
        'NVIDIA_API_KEY',
        'HF_TOKEN',
        'GLM_API_KEY',
        'KIMI_API_KEY',
      ]),
    );
    expect(HERMES_PROVIDER_ROUTE_ENVIRONMENT_NAME_LIST).toEqual(
      expect.arrayContaining(['GEMINI_BASE_URL', 'NVIDIA_BASE_URL', 'HF_BASE_URL']),
    );
    expect(HERMES_PROVIDER_ENVIRONMENT_NAME_LIST).not.toEqual(
      expect.arrayContaining(['AWS_SECRET_ACCESS_KEY', 'SSH_AUTH_SOCK']),
    );
  });

  it('scrubs every allowlisted provider credential before any agent or tool import', () => {
    for (const name of HERMES_PROVIDER_ENVIRONMENT_NAME_LIST) {
      expect(HERMES_SEALED_ACP_SOURCE).toContain(JSON.stringify(name));
    }

    const scrub = HERMES_SEALED_ACP_SOURCE.indexOf(
      'for environment_name in GOSU_PROVIDER_ENVIRONMENT_NAMES:',
    );
    const agentImport = HERMES_SEALED_ACP_SOURCE.indexOf('import run_agent');
    const toolImport = HERMES_SEALED_ACP_SOURCE.indexOf('import toolsets as toolsets_module');

    expect(scrub).toBeGreaterThan(0);
    expect(agentImport).toBeGreaterThan(scrub);
    expect(toolImport).toBeGreaterThan(agentImport);
    expect(HERMES_SEALED_ACP_SOURCE).toContain(
      '_fail("tool_runtime_imported_before_credential_scrub")',
    );
    expect(HERMES_SEALED_ACP_SOURCE).toContain('os.environ.pop(environment_name, None)');
    expect(HERMES_SEALED_ACP_SOURCE).toContain('kwargs["api_key"] = sealed_runtime.get("api_key")');
    expect(HERMES_SEALED_ACP_SOURCE).toContain(
      'runtime_provider_module.resolve_runtime_provider = sealed_resolve_runtime_provider',
    );
  });

  it('creates stable project/session profiles with only non-secret fail-closed config', () => {
    const sourceHome = temporaryDirectory();
    writeFileSync(
      join(sourceHome, '.env'),
      [
        'OPENAI_API_KEY="dotenv-secret"',
        "OPENAI_BASE_URL='https://api.fixture.invalid/v1'",
        'GOOGLE_API_KEY=gemini-fixture',
        'XAI_API_KEY=xai-fixture',
        'NOUS_API_KEY=nous-fixture',
        'DEEPSEEK_API_KEY=deepseek-fixture',
        'FIREWORKS_API_KEY=fireworks-fixture',
        'NVIDIA_API_KEY=nvidia-fixture',
        'HF_TOKEN=hf-fixture',
        'GLM_API_KEY=zai-fixture',
        'KIMI_API_KEY=kimi-fixture',
        'UNKNOWN_PROVIDER_API_KEY=must-not-cross-the-profile',
        'BRAVE_SEARCH_API_KEY=must-not-cross-the-boundary',
        'TERMINAL_SSH_KEY=/must/not/cross/the/profile',
        'HERMES_YOLO_MODE=1',
      ].join('\n'),
      { mode: 0o600 },
    );
    writeFileSync(join(sourceHome, 'state.db'), 'global-history-must-not-be-used', {
      mode: 0o600,
    });
    const factory = createNodeHermesAcpProfileFactory();

    const first = factory.prepare({
      runtime: runtime(sourceHome),
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    const repeated = factory.prepare({
      runtime: runtime(sourceHome),
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    const second = factory.prepare({
      runtime: runtime(sourceHome),
      projectId: PROJECT_ID,
      sessionId: SECOND_SESSION_ID,
    });

    expect(first.homeDirectory).toBe(repeated.homeDirectory);
    expect(second.homeDirectory).not.toBe(first.homeDirectory);
    expect(dirname(first.homeDirectory)).toBe(join(realpathSync(sourceHome), 'profiles'));
    expect(lstatSync(first.homeDirectory).mode & 0o777).toBe(0o700);
    expect(first.environment).toMatchObject({
      HERMES_HOME: first.homeDirectory,
      HERMES_INFERENCE_MODEL: 'gpt-fixture',
      HERMES_INFERENCE_PROVIDER: 'openai',
      HERMES_SAFE_MODE: '1',
      HERMES_IGNORE_RULES: '1',
      HERMES_YOLO_MODE: '',
      HERMES_ACP_AUTO_APPROVE: '',
      HERMES_ACP_SKIP_CONFIGURED_MCP: '1',
      OPENAI_API_KEY: 'dotenv-secret',
      OPENAI_BASE_URL: 'https://api.fixture.invalid/v1',
      GOOGLE_API_KEY: 'gemini-fixture',
      XAI_API_KEY: 'xai-fixture',
      NOUS_API_KEY: 'nous-fixture',
      DEEPSEEK_API_KEY: 'deepseek-fixture',
      FIREWORKS_API_KEY: 'fireworks-fixture',
      NVIDIA_API_KEY: 'nvidia-fixture',
      HF_TOKEN: 'hf-fixture',
      GLM_API_KEY: 'zai-fixture',
      KIMI_API_KEY: 'kimi-fixture',
    });
    expect(first.environment.UNKNOWN_PROVIDER_API_KEY).toBeUndefined();
    expect(first.environment.UNKNOWN_PROVIDER_TOKEN).toBeUndefined();
    expect(first.environment.SSH_AUTH_SOCK).toBeUndefined();
    expect(first.environment.BRAVE_SEARCH_API_KEY).toBeUndefined();
    expect(first.environment.TERMINAL_SSH_KEY).toBeUndefined();
    expect(first.retention).toBe('persistent-project-session-local');

    const configPath = join(first.homeDirectory, 'config.yaml');
    const config = readFileSync(configPath, 'utf8');
    expect(lstatSync(configPath).mode & 0o777).toBe(0o600);
    expect(config).toContain('memory_enabled: false');
    expect(config).toContain('mode: manual');
    expect(config).toContain('mcp_servers: {}');
    expect(config).not.toContain('dotenv-secret');
    expect(config).not.toContain('global-history-must-not-be-used');
    expect(existsSync(join(first.homeDirectory, '.env'))).toBe(false);
    expect(existsSync(join(first.homeDirectory, 'state.db'))).toBe(false);
  });

  it('uses the official global profile root when BYO Hermes already has a selected profile', () => {
    const root = temporaryDirectory();
    const selectedProfile = join(root, 'profiles', 'researcher');
    mkdirSync(selectedProfile, { recursive: true, mode: 0o700 });
    const factory = createNodeHermesAcpProfileFactory({
      sourceHome: () => selectedProfile,
    });

    const prepared = factory.prepare({
      runtime: runtime(selectedProfile),
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });

    expect(dirname(prepared.homeDirectory)).toBe(join(realpathSync(root), 'profiles'));
    expect(prepared.homeDirectory).not.toContain(join('researcher', 'profiles'));
  });

  it('fails closed when a profile-controlled entry redirects outside its boundary', () => {
    const sourceHome = temporaryDirectory();
    const outside = temporaryDirectory();
    const factory = createNodeHermesAcpProfileFactory();
    const input = {
      runtime: runtime(sourceHome),
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    } as const;
    const prepared = factory.prepare(input);
    symlinkSync(join(outside, 'foreign.db'), join(prepared.homeDirectory, 'state.db'));

    expect(() => factory.prepare(input)).toThrow('hermes_profile_entry_invalid');
  });

  it('never loads a profile-local dotenv that a prior agent turn could have created', () => {
    const sourceHome = temporaryDirectory();
    const factory = createNodeHermesAcpProfileFactory();
    const input = {
      runtime: runtime(sourceHome),
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    } as const;
    const prepared = factory.prepare(input);
    writeFileSync(join(prepared.homeDirectory, '.env'), 'OPENAI_API_KEY=attacker-controlled');

    expect(() => factory.prepare(input)).toThrow('hermes_profile_dotenv_forbidden');
  });
});
