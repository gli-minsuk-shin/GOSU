export const AGENT_ADD_ON_IDS = ['openclaw', 'hermes'] as const;

export type AgentAddOnId = (typeof AGENT_ADD_ON_IDS)[number];
export type AgentAddOnPreference = 'disabled' | 'detect-local' | 'connect-local';
export type AgentAddOnDetectionState = 'detected_local_cli' | 'not_detected';
export type AgentAddOnDetectionEvidence = 'path' | 'known_install_location' | null;

export type AgentAddOnProjectChatModel = Readonly<{
  providerId: string;
  modelId: string;
  displayName: string;
  isDefault: boolean;
  modalities: readonly string[];
  reasoningOptions: readonly Readonly<{
    id: string;
    label: string;
    isDefault: boolean;
  }>[];
  supportsPersonality: boolean;
}>;

export type AgentAddOnIntegrationCapabilities = Readonly<{
  localInstallationDetection: 'available';
  setupGuidance: 'available';
  projectChatProvider: 'available' | 'not_implemented';
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
  connected: boolean;
  connectionMode: 'byo-local-acp-agent' | null;
  version: string | null;
  projectChatModel: AgentAddOnProjectChatModel | null;
}>;

export type AgentAddOnStatusRequest = Readonly<{
  ids: readonly AgentAddOnId[];
}>;

export type ConnectAgentAddOnRequest = Readonly<{
  id: AgentAddOnId;
}>;

export type DisconnectAgentAddOnRequest = Readonly<{
  id: AgentAddOnId;
}>;

const DETECTION_ONLY_CAPABILITIES: AgentAddOnIntegrationCapabilities = {
  localInstallationDetection: 'available',
  setupGuidance: 'available',
  projectChatProvider: 'not_implemented',
  automaticInstaller: 'not_implemented',
  credentialManagement: 'not_implemented',
};

const HERMES_BYO_CAPABILITIES: AgentAddOnIntegrationCapabilities = {
  ...DETECTION_ONLY_CAPABILITIES,
  projectChatProvider: 'available',
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
    capabilities: HERMES_BYO_CAPABILITIES,
  },
] as const;

export function isAgentAddOnPreference(value: unknown): value is AgentAddOnPreference {
  return value === 'disabled' || value === 'detect-local' || value === 'connect-local';
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

export function parseConnectAgentAddOnRequest(value: unknown): ConnectAgentAddOnRequest {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('id' in value) ||
    !isAgentAddOnId(value.id)
  ) {
    throw new Error('invalid_agent_add_on_connect_request');
  }
  return { id: value.id };
}

export function parseDisconnectAgentAddOnRequest(value: unknown): DisconnectAgentAddOnRequest {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('id' in value) ||
    !isAgentAddOnId(value.id)
  ) {
    throw new Error('invalid_agent_add_on_disconnect_request');
  }
  return { id: value.id };
}
