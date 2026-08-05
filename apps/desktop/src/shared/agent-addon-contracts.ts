export const AGENT_ADD_ON_IDS = ['openclaw', 'hermes'] as const;

export type AgentAddOnId = (typeof AGENT_ADD_ON_IDS)[number];
export type AgentAddOnPreference = 'disabled' | 'detect-local';
export type AgentAddOnDetectionState = 'detected_local_cli' | 'not_detected';
export type AgentAddOnDetectionEvidence = 'path' | 'known_install_location' | null;

export type AgentAddOnIntegrationCapabilities = Readonly<{
  localInstallationDetection: 'available';
  setupGuidance: 'available';
  projectChatProvider: 'not_implemented';
  automaticInstaller: 'not_implemented';
  credentialManagement: 'not_implemented';
}>;

export type AgentAddOnDescriptor = Readonly<{
  id: AgentAddOnId;
  displayName: string;
  publisher: string;
  executableName: string;
  officialRepositoryUrl: string;
  officialSetupUrl: string;
  capabilities: AgentAddOnIntegrationCapabilities;
}>;

export type AgentAddOnStatus = Readonly<{
  id: AgentAddOnId;
  state: AgentAddOnDetectionState;
  evidence: AgentAddOnDetectionEvidence;
  connected: false;
}>;

export type AgentAddOnStatusRequest = Readonly<{
  ids: readonly AgentAddOnId[];
}>;

const DETECTION_ONLY_CAPABILITIES: AgentAddOnIntegrationCapabilities = {
  localInstallationDetection: 'available',
  setupGuidance: 'available',
  projectChatProvider: 'not_implemented',
  automaticInstaller: 'not_implemented',
  credentialManagement: 'not_implemented',
};

export const AGENT_ADD_ON_DESCRIPTORS: readonly AgentAddOnDescriptor[] = [
  {
    id: 'openclaw',
    displayName: 'OpenClaw',
    publisher: 'OpenClaw Foundation',
    executableName: 'openclaw',
    officialRepositoryUrl: 'https://github.com/openclaw/openclaw',
    officialSetupUrl: 'https://docs.openclaw.ai/install',
    capabilities: DETECTION_ONLY_CAPABILITIES,
  },
  {
    id: 'hermes',
    displayName: 'Hermes Agent',
    publisher: 'Nous Research',
    executableName: 'hermes',
    officialRepositoryUrl: 'https://github.com/NousResearch/hermes-agent',
    officialSetupUrl: 'https://hermes-agent.nousresearch.com/docs/',
    capabilities: DETECTION_ONLY_CAPABILITIES,
  },
] as const;

export function isAgentAddOnPreference(value: unknown): value is AgentAddOnPreference {
  return value === 'disabled' || value === 'detect-local';
}

export function isAgentAddOnId(value: unknown): value is AgentAddOnId {
  return AGENT_ADD_ON_IDS.some((id) => id === value);
}

export function parseAgentAddOnStatusRequest(value: unknown): AgentAddOnStatusRequest {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('ids' in value) ||
    !Array.isArray(value.ids) ||
    value.ids.length > AGENT_ADD_ON_IDS.length ||
    value.ids.some((id) => !isAgentAddOnId(id)) ||
    new Set(value.ids).size !== value.ids.length
  ) {
    throw new Error('invalid_agent_add_on_status_request');
  }

  return { ids: [...value.ids] as AgentAddOnId[] };
}
