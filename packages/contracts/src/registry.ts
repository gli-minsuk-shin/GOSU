import { z } from 'zod';

import { ModelDescriptorSchema } from './ai.js';
import {
  AutopilotPolicySchema,
  CampaignStateSchema,
  JobManifestV1Schema,
  JobPolicyV1Schema,
  RunnerEventMessageV1Schema,
  RunnerEventV1Schema,
  TrialStateSchema,
} from './experiment.js';
import { LabRoleSchema } from './identity.js';
import { ConnectorCapabilitiesSchema } from './integration.js';
import {
  ManuscriptCheckpointV1Schema,
  ManuscriptSyncAnchorV1Schema,
  ManuscriptSyncAttemptV1Schema,
  ManuscriptSyncStateSchema,
  ManuscriptWorkspaceBindingV1Schema,
  ManuscriptWorkspaceCapabilitiesV1Schema,
  ManuscriptWorkspaceDescriptorV1Schema,
} from './manuscript.js';
import { BudgetUsageSchema, ExperimentBudgetSchema, ObjectiveVersionSchema } from './objective.js';
import { SyncEventV1Schema } from './sync.js';

export const CONTRACT_SCHEMA_REGISTRY = {
  ModelDescriptor: ModelDescriptorSchema,
  ConnectorCapabilities: ConnectorCapabilitiesSchema,
  ManuscriptWorkspaceCapabilitiesV1: ManuscriptWorkspaceCapabilitiesV1Schema,
  ManuscriptWorkspaceDescriptorV1: ManuscriptWorkspaceDescriptorV1Schema,
  ManuscriptWorkspaceBindingV1: ManuscriptWorkspaceBindingV1Schema,
  ManuscriptCheckpointV1: ManuscriptCheckpointV1Schema,
  ManuscriptSyncAnchorV1: ManuscriptSyncAnchorV1Schema,
  ManuscriptSyncAttemptV1: ManuscriptSyncAttemptV1Schema,
  ManuscriptSyncState: ManuscriptSyncStateSchema,
  LabRole: LabRoleSchema,
  CampaignState: CampaignStateSchema,
  TrialState: TrialStateSchema,
  ExperimentBudget: ExperimentBudgetSchema,
  BudgetUsage: BudgetUsageSchema,
  AutopilotPolicy: AutopilotPolicySchema,
  JobPolicyV1: JobPolicyV1Schema,
  ObjectiveVersion: ObjectiveVersionSchema,
  JobManifestV1: JobManifestV1Schema,
  RunnerEventV1: RunnerEventV1Schema,
  RunnerEventMessageV1: RunnerEventMessageV1Schema,
  SyncEventV1: SyncEventV1Schema,
} as const satisfies Record<string, z.ZodTypeAny>;

export type ContractSchemaName = keyof typeof CONTRACT_SCHEMA_REGISTRY;

export function contractJsonSchema(name: ContractSchemaName) {
  return {
    $id: `urn:gosu:contract:v1:${name}`,
    ...z.toJSONSchema(CONTRACT_SCHEMA_REGISTRY[name], { target: 'draft-07' }),
  };
}
