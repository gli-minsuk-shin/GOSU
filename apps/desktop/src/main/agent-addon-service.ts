import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import {
  AGENT_ADD_ON_DESCRIPTORS,
  type AgentAddOnDescriptor,
  type AgentAddOnId,
  type AgentAddOnStatus,
} from '../shared/agent-addon-contracts';
import type { HermesProjectChatConnection } from './project-chat-provider-router';

type DetectionCandidate = Readonly<{
  path: string;
  evidence: Exclude<AgentAddOnStatus['evidence'], null>;
}>;

export interface AgentAddOnAdapter {
  readonly descriptor: AgentAddOnDescriptor;
  detectLocalInstallation(): Promise<AgentAddOnStatus>;
  connectLocal?(): Promise<AgentAddOnStatus>;
  disconnectLocal?(): Promise<AgentAddOnStatus>;
}

export type AgentAddOnDetectionPlatform = Readonly<{
  pathEnvironment: string | undefined;
  homeDirectory: string;
  isExecutable(path: string): Promise<boolean>;
}>;

function knownInstallCandidates(
  descriptor: AgentAddOnDescriptor,
  homeDirectory: string,
): readonly DetectionCandidate[] {
  if (descriptor.id === 'openclaw') {
    return [
      {
        path: join(homeDirectory, '.openclaw', 'bin', descriptor.executableName),
        evidence: 'known_install_location',
      },
    ];
  }
  return [
    {
      path: join(homeDirectory, '.local', 'bin', descriptor.executableName),
      evidence: 'known_install_location',
    },
  ];
}

export function localAgentAddOnCandidates(
  descriptor: AgentAddOnDescriptor,
  platform: Pick<AgentAddOnDetectionPlatform, 'pathEnvironment' | 'homeDirectory'>,
): readonly DetectionCandidate[] {
  const candidates = new Map<string, DetectionCandidate>();
  for (const entry of platform.pathEnvironment?.split(delimiter) ?? []) {
    if (!entry.trim()) continue;
    const candidate = {
      path: resolve(entry, descriptor.executableName),
      evidence: 'path' as const,
    };
    candidates.set(candidate.path, candidate);
  }
  for (const candidate of knownInstallCandidates(descriptor, platform.homeDirectory)) {
    if (!candidates.has(candidate.path)) candidates.set(candidate.path, candidate);
  }
  return [...candidates.values()];
}

export class LocalCliAgentAddOnAdapter implements AgentAddOnAdapter {
  constructor(
    readonly descriptor: AgentAddOnDescriptor,
    private readonly platform: AgentAddOnDetectionPlatform,
  ) {}

  async detectLocalInstallation(): Promise<AgentAddOnStatus> {
    for (const candidate of localAgentAddOnCandidates(this.descriptor, this.platform)) {
      if (await this.platform.isExecutable(candidate.path)) {
        return {
          id: this.descriptor.id,
          state: 'detected_local_cli',
          evidence: candidate.evidence,
          connected: false,
          connectionMode: null,
          version: null,
          projectChatModel: null,
        };
      }
    }
    return {
      id: this.descriptor.id,
      state: 'not_detected',
      evidence: null,
      connected: false,
      connectionMode: null,
      version: null,
      projectChatModel: null,
    };
  }
}

export class HermesAgentAddOnAdapter implements AgentAddOnAdapter {
  private connectedStatus: AgentAddOnStatus | null = null;

  constructor(
    readonly descriptor: AgentAddOnDescriptor,
    private readonly detector: LocalCliAgentAddOnAdapter,
    private readonly projectChat: HermesProjectChatConnection,
  ) {}

  async detectLocalInstallation(): Promise<AgentAddOnStatus> {
    if (this.connectedStatus && this.projectChat.isHermesConnected()) {
      return this.connectedStatus;
    }
    this.connectedStatus = null;
    return this.detector.detectLocalInstallation();
  }

  async connectLocal(): Promise<AgentAddOnStatus> {
    const { catalog } = await this.projectChat.connectHermes();
    const model = catalog.models.find((candidate) => candidate.providerId === 'hermes');
    if (!model) throw new Error('hermes_project_chat_model_missing');
    const bundled = model.metadata?.runtime === 'gosu-bundled-hermes-sealed-shim';
    const detected = bundled
      ? ({
          id: 'hermes',
          state: 'bundled_runtime',
          evidence: 'bundled_resource',
          connected: false,
          connectionMode: null,
          version: null,
          projectChatModel: null,
        } as const)
      : await this.detector.detectLocalInstallation();
    if (!bundled && detected.state !== 'detected_local_cli') {
      throw new Error('hermes_not_detected');
    }
    this.connectedStatus = {
      ...detected,
      connected: true,
      connectionMode: bundled ? 'bundled-acp-agent' : 'byo-local-acp-agent',
      version:
        typeof model.metadata?.hermesVersion === 'string'
          ? model.metadata.hermesVersion.slice(0, 64)
          : null,
      projectChatModel: {
        providerId: model.providerId,
        modelId: model.modelId,
        displayName: model.displayName,
        isDefault: false,
        modalities: model.modalities,
        reasoningOptions: model.reasoningOptions,
        supportsPersonality: model.metadata?.supportsPersonality === true,
      },
    };
    return this.connectedStatus;
  }

  async disconnectLocal(): Promise<AgentAddOnStatus> {
    await this.projectChat.disconnectHermes();
    this.connectedStatus = null;
    return this.detector.detectLocalInstallation();
  }
}

export class AgentAddOnRegistry {
  private readonly adapters: ReadonlyMap<AgentAddOnId, AgentAddOnAdapter>;

  constructor(adapters: readonly AgentAddOnAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.descriptor.id, adapter]));
  }

  descriptors(): readonly AgentAddOnDescriptor[] {
    return [...this.adapters.values()].map((adapter) => adapter.descriptor);
  }

  async statuses(ids: readonly AgentAddOnId[]): Promise<readonly AgentAddOnStatus[]> {
    const requestedAdapters = ids.map((id) => {
      const adapter = this.adapters.get(id);
      if (!adapter) throw new Error('unknown_agent_add_on_adapter');
      return adapter;
    });
    return Promise.all(requestedAdapters.map((adapter) => adapter.detectLocalInstallation()));
  }

  async connect(id: AgentAddOnId): Promise<AgentAddOnStatus> {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error('unknown_agent_add_on_adapter');
    if (!adapter.connectLocal) throw new Error('agent_add_on_connection_not_supported');
    return adapter.connectLocal();
  }

  async disconnect(id: AgentAddOnId): Promise<AgentAddOnStatus> {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error('unknown_agent_add_on_adapter');
    if (!adapter.disconnectLocal) throw new Error('agent_add_on_disconnection_not_supported');
    return adapter.disconnectLocal();
  }
}

export function createAgentAddOnRegistry(
  input: Partial<AgentAddOnDetectionPlatform> = {},
  integrations: Readonly<{ hermesProjectChat?: HermesProjectChatConnection }> = {},
): AgentAddOnRegistry {
  const platform: AgentAddOnDetectionPlatform = {
    pathEnvironment: input.pathEnvironment ?? process.env.PATH,
    homeDirectory: input.homeDirectory ?? homedir(),
    isExecutable:
      input.isExecutable ??
      (async (path) => {
        try {
          await access(path, constants.X_OK);
          return (await stat(path)).isFile();
        } catch {
          return false;
        }
      }),
  };
  return new AgentAddOnRegistry(
    AGENT_ADD_ON_DESCRIPTORS.map((descriptor) => {
      const detector = new LocalCliAgentAddOnAdapter(descriptor, platform);
      return descriptor.id === 'hermes' && integrations.hermesProjectChat
        ? new HermesAgentAddOnAdapter(descriptor, detector, integrations.hermesProjectChat)
        : detector;
    }),
  );
}
