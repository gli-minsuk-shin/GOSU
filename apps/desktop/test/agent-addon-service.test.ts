import { describe, expect, it, vi } from 'vitest';

import { registerAgentAddOnIpc } from '../src/main/agent-addon-ipc';
import {
  AgentAddOnRegistry,
  LocalCliAgentAddOnAdapter,
  localAgentAddOnCandidates,
} from '../src/main/agent-addon-service';
import { enabledAgentAddOnIds } from '../src/renderer/src/agent-addons-section';
import {
  AGENT_ADD_ON_DESCRIPTORS,
  AGENT_ADD_ON_IDS,
  parseAgentAddOnStatusRequest,
} from '../src/shared/agent-addon-contracts';

const openClaw = AGENT_ADD_ON_DESCRIPTORS.find((descriptor) => descriptor.id === 'openclaw')!;
const hermes = AGENT_ADD_ON_DESCRIPTORS.find((descriptor) => descriptor.id === 'hermes')!;

describe('optional agent add-on detection boundary', () => {
  it('publishes only detection and official guidance as currently available capabilities', () => {
    expect(AGENT_ADD_ON_DESCRIPTORS).toEqual([
      expect.objectContaining({
        id: 'openclaw',
        executableName: 'openclaw',
        officialRepositoryUrl: 'https://github.com/openclaw/openclaw',
        officialSetupUrl: 'https://docs.openclaw.ai/install',
      }),
      expect.objectContaining({
        id: 'hermes',
        executableName: 'hermes',
        officialRepositoryUrl: 'https://github.com/NousResearch/hermes-agent',
        officialSetupUrl: 'https://hermes-agent.nousresearch.com/docs/',
      }),
    ]);
    for (const descriptor of AGENT_ADD_ON_DESCRIPTORS) {
      expect(descriptor.capabilities).toEqual({
        localInstallationDetection: 'available',
        setupGuidance: 'available',
        projectChatProvider: 'not_implemented',
        automaticInstaller: 'not_implemented',
        credentialManagement: 'not_implemented',
      });
    }
  });

  it('checks PATH and official installer locations without executing a CLI', () => {
    expect(
      localAgentAddOnCandidates(openClaw, {
        pathEnvironment: '/opt/local/bin:/usr/local/bin',
        homeDirectory: '/Users/researcher',
      }),
    ).toEqual([
      { path: '/opt/local/bin/openclaw', evidence: 'path' },
      { path: '/usr/local/bin/openclaw', evidence: 'path' },
      {
        path: '/Users/researcher/.openclaw/bin/openclaw',
        evidence: 'known_install_location',
      },
    ]);
  });

  it('reports an executable-name observation as detected but explicitly not connected', async () => {
    const isExecutable = vi.fn(async (path: string) => path.endsWith('/.local/bin/hermes'));
    const adapter = new LocalCliAgentAddOnAdapter(hermes, {
      pathEnvironment: '/usr/bin',
      homeDirectory: '/Users/researcher',
      isExecutable,
    });

    await expect(adapter.detectLocalInstallation()).resolves.toEqual({
      id: 'hermes',
      state: 'detected_local_cli',
      evidence: 'known_install_location',
      connected: false,
    });
    expect(isExecutable).toHaveBeenCalledTimes(2);
  });

  it('fails closed when no executable candidate can be verified', async () => {
    const adapter = new LocalCliAgentAddOnAdapter(openClaw, {
      pathEnvironment: '/usr/bin',
      homeDirectory: '/Users/researcher',
      isExecutable: vi.fn(async () => false),
    });

    await expect(adapter.detectLocalInstallation()).resolves.toEqual({
      id: 'openclaw',
      state: 'not_detected',
      evidence: null,
      connected: false,
    });
  });

  it('keeps provider-specific detection behind a replaceable typed adapter registry', async () => {
    const detectOpenClaw = vi.fn(async () => ({
      id: 'openclaw' as const,
      state: 'not_detected' as const,
      evidence: null,
      connected: false as const,
    }));
    const detectHermes = vi.fn(async () => ({
      id: 'hermes' as const,
      state: 'not_detected' as const,
      evidence: null,
      connected: false as const,
    }));
    const registry = new AgentAddOnRegistry([
      {
        descriptor: openClaw,
        detectLocalInstallation: detectOpenClaw,
      },
      {
        descriptor: hermes,
        detectLocalInstallation: detectHermes,
      },
    ]);

    expect(registry.descriptors()).toEqual([openClaw, hermes]);
    await expect(registry.statuses(['openclaw'])).resolves.toEqual([
      { id: 'openclaw', state: 'not_detected', evidence: null, connected: false },
    ]);
    expect(detectOpenClaw).toHaveBeenCalledOnce();
    expect(detectHermes).not.toHaveBeenCalled();
  });

  it('derives a status request from only the add-ons enabled in mixed preferences', () => {
    expect(enabledAgentAddOnIds({ openclaw: 'detect-local', hermes: 'disabled' })).toEqual([
      'openclaw',
    ]);
    expect(enabledAgentAddOnIds({ openclaw: 'disabled', hermes: 'disabled' })).toEqual([]);
  });

  it('validates status requests strictly and rejects unknown or duplicate add-on IDs', () => {
    expect(parseAgentAddOnStatusRequest({ ids: ['hermes'] })).toEqual({ ids: ['hermes'] });
    expect(() => parseAgentAddOnStatusRequest({ ids: ['unknown'] })).toThrow(
      'invalid_agent_add_on_status_request',
    );
    expect(() => parseAgentAddOnStatusRequest({ ids: ['openclaw', 'openclaw'] })).toThrow(
      'invalid_agent_add_on_status_request',
    );
    expect(() => parseAgentAddOnStatusRequest({ ids: AGENT_ADD_ON_IDS, extra: true })).toThrow(
      'invalid_agent_add_on_status_request',
    );
  });

  it('fails closed at the Main IPC boundary before an invalid ID reaches the registry', async () => {
    const statuses = vi.fn(async () => []);
    const handlers = new Map<string, (...arguments_: unknown[]) => unknown>();
    registerAgentAddOnIpc((channel, listener) => handlers.set(channel, listener), {
      statuses,
    } as unknown as AgentAddOnRegistry);
    const handler = handlers.get('gosu:agent-add-ons:status');

    expect(() => handler?.({ ids: ['unknown'] })).toThrow('invalid_agent_add_on_status_request');
    expect(statuses).not.toHaveBeenCalled();

    await expect(handler?.({ ids: ['openclaw'] })).resolves.toEqual([]);
    expect(statuses).toHaveBeenCalledWith(['openclaw']);
  });
});
