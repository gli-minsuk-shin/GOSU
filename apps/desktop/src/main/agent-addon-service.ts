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

type DetectionCandidate = Readonly<{
  path: string;
  evidence: Exclude<AgentAddOnStatus['evidence'], null>;
}>;

export interface AgentAddOnAdapter {
  readonly descriptor: AgentAddOnDescriptor;
  detectLocalInstallation(): Promise<AgentAddOnStatus>;
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
        };
      }
    }
    return {
      id: this.descriptor.id,
      state: 'not_detected',
      evidence: null,
      connected: false,
    };
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
}

export function createAgentAddOnRegistry(
  input: Partial<AgentAddOnDetectionPlatform> = {},
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
    AGENT_ADD_ON_DESCRIPTORS.map(
      (descriptor) => new LocalCliAgentAddOnAdapter(descriptor, platform),
    ),
  );
}
