import { z } from 'zod';

import {
  ContentHashSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  Sha256DigestSchema,
} from './common.js';
import { ObjectiveSnapshotSchema } from './objective.js';

const secretLikeKeyPattern =
  /(?:^|[^a-z0-9])(?:api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|secret|token|password|passwd|credential|authorization|auth)(?:$|[^a-z0-9])/i;
const secretLikeValuePatterns = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /(?:^|\s)Bearer\s+\S+/i,
  /^(?:sk|rk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}$/,
  /^AKIA[A-Z0-9]{16}$/,
] as const;

function isSecretLikeValue(value: string): boolean {
  return secretLikeValuePatterns.some((pattern) => pattern.test(value.trim()));
}

function findSecretLikeParameter(value: unknown, path: PropertyKey[] = []): PropertyKey[] | null {
  if (typeof value === 'string') {
    return isSecretLikeValue(value) ? path : null;
  }
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const match = findSecretLikeParameter(child, [...path, index]);
      if (match !== null) return match;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (secretLikeKeyPattern.test(key)) return [...path, key];
      const match = findSecretLikeParameter(child, [...path, key]);
      if (match !== null) return match;
    }
  }
  return null;
}

export const CampaignStateSchema = z.enum([
  'draft',
  'awaiting_approval',
  'active',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);
export type CampaignState = z.infer<typeof CampaignStateSchema>;
export const CAMPAIGN_STATES = CampaignStateSchema.options;

export const TrialStateSchema = z.enum([
  'pending',
  'leased',
  'running',
  'succeeded',
  'failed',
  'pruned',
  'cancelled',
  'lost',
]);
export type TrialState = z.infer<typeof TrialStateSchema>;
export const TRIAL_STATES = TrialStateSchema.options;

export const AutopilotModeSchema = z.enum(['bounded', 'full']);
export type AutopilotMode = z.infer<typeof AutopilotModeSchema>;

export const AutopilotPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: AutopilotModeSchema,
    allowedCodePaths: z.array(z.string().trim().min(1)).min(1),
    allowOfflineContinuation: z.boolean(),
    allowDependencyChanges: z.boolean(),
    requireApprovalForNetworkChanges: z.literal(true),
    requireApprovalForMetricChanges: z.literal(true),
    requireApprovalForBudgetChanges: z.literal(true),
  })
  .strict();
export type AutopilotPolicy = z.infer<typeof AutopilotPolicySchema>;

export const ResourceLimitsSchema = z
  .object({
    cpuCores: z.number().finite().positive(),
    memoryMiB: z.number().int().positive(),
    gpuCount: z.number().int().nonnegative(),
    gpuMemoryMiB: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type ResourceLimits = z.infer<typeof ResourceLimitsSchema>;

export const NetworkPolicySchema = z
  .object({
    mode: z.enum(['none', 'allowlist']),
    allowedHosts: z.array(z.string().trim().min(1).max(253)),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.mode === 'none' && policy.allowedHosts.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'allowedHosts must be empty when network mode is none',
        path: ['allowedHosts'],
      });
    }
  });
export type NetworkPolicy = z.infer<typeof NetworkPolicySchema>;

export const MountSpecSchema = z
  .object({
    kind: z.enum(['workspace', 'dataset', 'scratch', 'host']),
    sourceRef: z.string().trim().min(1).max(512),
    containerPath: z.string().startsWith('/').max(512),
    readOnly: z.boolean(),
  })
  .strict();
export type MountSpec = z.infer<typeof MountSpecSchema>;

export const SecretRefSchema = z
  .object({
    ref: z.string().trim().min(1).max(256),
    environmentVariable: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/)
      .max(128),
  })
  .strict();
export type SecretRef = z.infer<typeof SecretRefSchema>;

export const ContainerExecutionSchema = z
  .object({
    privileged: z.boolean(),
    readOnlyRootFilesystem: z.boolean(),
    noNewPrivileges: z.boolean(),
    runAsUser: z.number().int().positive(),
    runAsGroup: z.number().int().positive(),
    capabilities: z
      .object({
        drop: z.array(z.string().trim().min(1).max(64)),
        add: z.array(z.string().trim().min(1).max(64)),
      })
      .strict(),
  })
  .strict();
export type ContainerExecution = z.infer<typeof ContainerExecutionSchema>;

export const JobSignatureSchema = z
  .object({
    algorithm: z.literal('ed25519'),
    keyId: EntityIdSchema,
    value: z.string().trim().min(32).max(512),
  })
  .strict();
export type JobSignature = z.infer<typeof JobSignatureSchema>;

export const JobManifestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: EntityIdSchema,
    campaignId: EntityIdSchema,
    trialId: EntityIdSchema,
    attemptId: EntityIdSchema,
    issuedAt: IsoDateTimeSchema,
    codeSha: ContentHashSchema,
    image: z
      .object({
        reference: z.string().trim().min(1).max(512),
        digest: Sha256DigestSchema,
      })
      .strict(),
    command: z
      .object({
        executable: z.string().trim().min(1).max(512),
        args: z.array(z.string().max(8_192)).max(512),
      })
      .strict(),
    parameters: z.record(z.string(), JsonValueSchema),
    seed: z.number().int().safe(),
    resources: ResourceLimitsSchema,
    network: NetworkPolicySchema,
    mounts: z.array(MountSpecSchema),
    secretRefs: z.array(SecretRefSchema),
    execution: ContainerExecutionSchema,
    timeoutSeconds: z.number().int().positive(),
    objective: ObjectiveSnapshotSchema,
    policyVersion: z.number().int().positive(),
    policyHash: ContentHashSchema,
    manifestHash: Sha256DigestSchema,
    signature: JobSignatureSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const secretParameterPath = findSecretLikeParameter(manifest.parameters);
    if (secretParameterPath !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Secrets must be supplied through secretRefs, not parameters',
        path: ['parameters', ...secretParameterPath],
      });
    }

    const secretArgumentIndex = manifest.command.args.findIndex(
      (argument) => secretLikeKeyPattern.test(argument) || isSecretLikeValue(argument),
    );
    if (secretArgumentIndex !== -1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Secrets must be supplied through secretRefs, not command arguments',
        path: ['command', 'args', secretArgumentIndex],
      });
    }
  });
export type JobManifestV1 = z.infer<typeof JobManifestV1Schema>;

export const JobPolicyV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    policyVersion: z.number().int().positive(),
    policyHash: ContentHashSchema,
    allowedSigningKeyIds: z.array(EntityIdSchema).min(1),
    allowedImageDigests: z.array(Sha256DigestSchema).min(1),
    allowedNetworkHosts: z.array(z.string().trim().min(1).max(253)),
    allowedSecretRefs: z.array(z.string().trim().min(1).max(256)),
    maxJobTimeoutSeconds: z.number().int().positive(),
  })
  .strict();
export type JobPolicyV1 = z.infer<typeof JobPolicyV1Schema>;

const RunnerEventBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: EntityIdSchema,
    runnerId: EntityIdSchema,
    campaignId: EntityIdSchema,
    trialId: EntityIdSchema,
    attemptId: EntityIdSchema,
    sequence: z.number().int().nonnegative(),
    occurredAt: IsoDateTimeSchema,
  })
  .strict();

export const RunnerStateEventSchema = RunnerEventBaseSchema.extend({
  kind: z.literal('state'),
  state: TrialStateSchema,
  previousState: TrialStateSchema.optional(),
  reason: z.string().trim().min(1).max(2_000).optional(),
}).strict();

export const RunnerMetricEventSchema = RunnerEventBaseSchema.extend({
  kind: z.literal('metric'),
  metricKey: z.string().trim().min(1).max(128),
  value: z.number().finite(),
  step: z.number().int().nonnegative().nullable(),
  isSummary: z.boolean(),
}).strict();

export const RunnerLogEventSchema = RunnerEventBaseSchema.extend({
  kind: z.literal('log'),
  stream: z.enum(['stdout', 'stderr']),
  chunk: z.string().max(64_000),
}).strict();

export const RunnerResourceEventSchema = RunnerEventBaseSchema.extend({
  kind: z.literal('resource'),
  cpuPercent: z.number().finite().nonnegative(),
  memoryMiB: z.number().finite().nonnegative(),
  gpuPercent: z.number().finite().nonnegative().nullable(),
  gpuMemoryMiB: z.number().finite().nonnegative().nullable(),
}).strict();

export const RunnerArtifactReferenceEventSchema = RunnerEventBaseSchema.extend({
  kind: z.literal('artifact_reference'),
  artifactId: EntityIdSchema,
  contentHash: ContentHashSchema,
  sizeBytes: z.number().int().nonnegative(),
  runnerPathRef: z.string().trim().min(1).max(1_024),
}).strict();

export const RunnerEventV1Schema = z.discriminatedUnion('kind', [
  RunnerStateEventSchema,
  RunnerMetricEventSchema,
  RunnerLogEventSchema,
  RunnerResourceEventSchema,
  RunnerArtifactReferenceEventSchema,
]);
export type RunnerEventV1 = z.infer<typeof RunnerEventV1Schema>;

export const RunnerEventMessageV1Schema = z
  .object({
    type: z.literal('runner.event'),
    projectId: EntityIdSchema,
    runnerId: EntityIdSchema,
    event: RunnerEventV1Schema,
  })
  .strict()
  .superRefine((message, context) => {
    if (message.runnerId !== message.event.runnerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Envelope and event runnerId values must match',
        path: ['event', 'runnerId'],
      });
    }
  });
export type RunnerEventMessageV1 = z.infer<typeof RunnerEventMessageV1Schema>;
