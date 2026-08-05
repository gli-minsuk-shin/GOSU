import { z } from 'zod';

export const SSH_CONNECTION_LABEL_MAX_LENGTH = 120;
export const SSH_HOST_ALIAS_MAX_LENGTH = 255;
export const SSH_IMPORT_COMMAND_MAX_LENGTH = 4_096;
export const SSH_MAX_LOCAL_FORWARDINGS = 8;
export const SSH_COMMAND_MAX_ARGUMENTS = 32;
export const SSH_COMMAND_MAX_OUTPUT_CHARACTERS = 64_000;
export const SSH_AGENT_TOOL_MAX_OUTPUT_CHARACTERS = 48_000;
export const SSH_COMMAND_MAX_TIMEOUT_SECONDS = 120;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const hostAliasSchema = z
  .string()
  .trim()
  .min(1)
  .max(SSH_HOST_ALIAS_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, 'Use a concrete OpenSSH host alias');
const labelSchema = z.string().trim().min(1).max(SSH_CONNECTION_LABEL_MAX_LENGTH);
const sshPortSchema = z.number().int().min(1).max(65_535);
const directHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^(?:[A-Za-z0-9][A-Za-z0-9.-]*|[A-Fa-f0-9]*:[A-Fa-f0-9:]+)$/u,
    'Use a concrete host name or IP address',
  )
  .refine((value) => !value.includes('..'), 'Invalid host name');
const directUserSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/u, 'Invalid SSH user');
const opaqueInvocationIdSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !hasControlCharacter(value), 'Control characters are not allowed');

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

export const SshLocalForwardSchema = z
  .object({
    bindAddress: z.enum(['127.0.0.1', 'localhost', '::1']),
    localPort: z.number().int().min(1_024).max(65_535),
    destinationHost: z.enum(['127.0.0.1', 'localhost', '::1']),
    destinationPort: sshPortSchema,
  })
  .strict();

export type SshLocalForward = z.infer<typeof SshLocalForwardSchema>;

export const SshDirectTargetSchema = z
  .object({
    host: directHostSchema,
    user: directUserSchema.optional(),
    port: sshPortSchema.optional(),
    localForwards: z.array(SshLocalForwardSchema).max(SSH_MAX_LOCAL_FORWARDINGS).default([]),
  })
  .strict();

export type SshDirectTarget = z.infer<typeof SshDirectTargetSchema>;

export const SshConnectionProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    label: labelSchema,
    hostAlias: hostAliasSchema,
    directTarget: SshDirectTargetSchema.nullable().optional(),
    version: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export type SshConnectionProfile = z.infer<typeof SshConnectionProfileSchema>;

export const CreateSshConnectionInputSchema = z
  .object({
    label: labelSchema,
    hostAlias: hostAliasSchema,
  })
  .strict();

export const ImportSshCommandInputSchema = z
  .object({
    label: labelSchema.optional(),
    command: z
      .string()
      .trim()
      .min(1)
      .max(SSH_IMPORT_COMMAND_MAX_LENGTH)
      .refine((value) => !hasControlCharacter(value), 'Control characters are not allowed'),
  })
  .strict();

export const UpdateSshConnectionInputSchema = z
  .object({
    connectionId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    label: labelSchema,
    hostAlias: hostAliasSchema,
  })
  .strict();

export const RemoveSshConnectionInputSchema = z
  .object({
    connectionId: uuidSchema,
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const TestSshConnectionInputSchema = z.object({ connectionId: uuidSchema }).strict();

export const SshConnectionTestResultSchema = z
  .object({
    connectionId: uuidSchema,
    reachable: z.boolean(),
    code: z
      .enum([
        'ready',
        'unknown_host_key',
        'authentication_failed',
        'connection_failed',
        'timed_out',
      ])
      .optional(),
  })
  .strict();

export type SshConnectionTestResult = z.infer<typeof SshConnectionTestResultSchema>;

export const ReadSshResourceSnapshotInputSchema = z
  .object({
    connectionId: uuidSchema,
    force: z.boolean().optional(),
  })
  .strict();

export type ReadSshResourceSnapshotInput = z.infer<typeof ReadSshResourceSnapshotInputSchema>;

export const ListProjectSshResourceSnapshotsInputSchema = z
  .object({
    projectId: uuidSchema,
    force: z.boolean().optional(),
  })
  .strict();

export type ListProjectSshResourceSnapshotsInput = z.infer<
  typeof ListProjectSshResourceSnapshotsInputSchema
>;

export const ReadProjectSshResourceSnapshotInputSchema = z
  .object({
    projectId: uuidSchema,
    connectionId: uuidSchema,
    force: z.boolean().optional(),
  })
  .strict();

export type ReadProjectSshResourceSnapshotInput = z.infer<
  typeof ReadProjectSshResourceSnapshotInputSchema
>;

const resourceUtilizationSchema = z.number().finite().min(0).max(100);
const resourceBytesSchema = z.number().int().nonnegative().safe();

export const SshServerResourceIssueSchema = z.enum([
  'connection_unavailable',
  'cpu_unavailable',
  'memory_unavailable',
  'gpu_not_detected',
  'gpu_unavailable',
  'probe_output_invalid',
]);

export type SshServerResourceIssue = z.infer<typeof SshServerResourceIssueSchema>;

const SshCpuResourceSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('available'),
      utilizationPercent: resourceUtilizationSchema,
      logicalProcessorCount: z.number().int().positive().max(1_048_576),
    })
    .strict(),
  z.object({ state: z.literal('unavailable') }).strict(),
]);

const SshMemoryResourceSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('available'),
      usedBytes: resourceBytesSchema,
      totalBytes: resourceBytesSchema.positive(),
      utilizationPercent: resourceUtilizationSchema,
    })
    .strict(),
  z.object({ state: z.literal('unavailable') }).strict(),
]);

const SshGpuDeviceResourceSchema = z
  .object({
    index: z.number().int().nonnegative().max(65_535),
    name: z.string().trim().min(1).max(256),
    utilizationPercent: resourceUtilizationSchema.nullable(),
    memoryUsedBytes: resourceBytesSchema,
    memoryTotalBytes: resourceBytesSchema.positive(),
    temperatureC: z.number().finite().min(-273.15).max(1_000).nullable(),
  })
  .strict();

const SshGpuResourceSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('available'),
      devices: z.array(SshGpuDeviceResourceSchema).min(1).max(64),
    })
    .strict(),
  z.object({ state: z.literal('not_detected') }).strict(),
  z.object({ state: z.literal('unavailable') }).strict(),
]);

export const SshServerResourceSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    connectionId: uuidSchema,
    capturedAt: timestampSchema,
    status: z.enum(['ready', 'partial', 'unavailable']),
    cpu: SshCpuResourceSchema,
    memory: SshMemoryResourceSchema,
    gpu: SshGpuResourceSchema,
    issues: z.array(SshServerResourceIssueSchema).max(6),
  })
  .strict()
  .refine((value) => new Set(value.issues).size === value.issues.length, 'Duplicate issues');

export type SshServerResourceSnapshot = z.infer<typeof SshServerResourceSnapshotSchema>;

const safeCommandTokenSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^(?!-)[A-Za-z0-9_./+:-]+$/u, 'Command must be one executable token');
const safeArgumentSchema = z
  .string()
  .max(1_024)
  .refine((value) => !hasControlCharacter(value), 'Control characters are not allowed');
const remoteWorkingDirectorySchema = z
  .string()
  .min(1)
  .max(1_024)
  .startsWith('/')
  .refine((value) => !hasControlCharacter(value), 'Control characters are not allowed');

export const SshAgentCommandSchema = z
  .object({
    projectId: uuidSchema,
    sessionId: uuidSchema,
    attemptId: uuidSchema,
    turnId: opaqueInvocationIdSchema,
    toolCallId: opaqueInvocationIdSchema,
    connectionId: uuidSchema,
    command: safeCommandTokenSchema,
    args: z.array(safeArgumentSchema).max(SSH_COMMAND_MAX_ARGUMENTS).default([]),
    workingDirectory: remoteWorkingDirectorySchema.optional(),
    timeoutSeconds: z.number().int().min(5).max(SSH_COMMAND_MAX_TIMEOUT_SECONDS).default(30),
  })
  .strict();

export type SshAgentCommand = z.infer<typeof SshAgentCommandSchema>;

export const SshCommandResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    trust: z.literal('untrusted_remote_output'),
    connectionLabel: labelSchema,
    commandSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    exitCode: z.number().int().nullable(),
    stdout: z.string().max(SSH_COMMAND_MAX_OUTPUT_CHARACTERS),
    stderr: z.string().max(SSH_COMMAND_MAX_OUTPUT_CHARACTERS),
    truncated: z.boolean(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (value) => value.stdout.length + value.stderr.length <= SSH_AGENT_TOOL_MAX_OUTPUT_CHARACTERS,
    'Combined SSH output exceeds the agent tool boundary',
  );

export type SshCommandResult = z.infer<typeof SshCommandResultSchema>;

export const SshApprovalRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    sessionId: uuidSchema,
    attemptId: uuidSchema,
    turnId: opaqueInvocationIdSchema,
    toolCallId: opaqueInvocationIdSchema,
    connectionId: uuidSchema,
    connectionLabel: labelSchema,
    hostAlias: hostAliasSchema,
    targetDisplay: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => !hasControlCharacter(value), 'Control characters are not allowed')
      .optional(),
    rootLogin: z.boolean().optional(),
    privilegeClass: z.enum(['standard', 'root', 'unknown']).optional(),
    executionMode: z.enum(['diagnostic', 'remote_workspace']).optional(),
    connectionVersion: z.number().int().positive().optional(),
    workspaceGrantId: uuidSchema.optional(),
    workspaceGrantVersion: z.number().int().positive().optional(),
    workspaceRoot: remoteWorkingDirectorySchema.optional(),
    workspaceWorkingDirectory: remoteWorkingDirectorySchema.optional(),
    workspaceOperation: z.enum(['inspect', 'test', 'build', 'experiment']).optional(),
    commandSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .optional(),
    commandPreview: z.string().min(1).max(4_096),
    requestedAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict();

export type SshApprovalRequest = z.infer<typeof SshApprovalRequestSchema>;

export const ResolveSshApprovalInputSchema = z
  .object({
    approvalId: uuidSchema,
    decision: z.enum(['allow_once', 'deny']),
  })
  .strict();

export type ResolveSshApprovalInput = z.infer<typeof ResolveSshApprovalInputSchema>;

export const CancelSshScopeInputSchema = z
  .object({
    projectId: uuidSchema,
    sessionId: uuidSchema.optional(),
  })
  .strict();

export type CancelSshScopeInput = z.infer<typeof CancelSshScopeInputSchema>;

export const SshEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('approval.requested'),
      request: SshApprovalRequestSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('approval.resolved'),
      approvalId: uuidSchema,
      outcome: z.enum(['allowed', 'denied', 'expired', 'cancelled']),
    })
    .strict(),
]);

export type SshEvent = z.infer<typeof SshEventSchema>;

export type CreateSshConnectionInput = z.infer<typeof CreateSshConnectionInputSchema>;
export type ImportSshCommandInput = z.infer<typeof ImportSshCommandInputSchema>;
export type UpdateSshConnectionInput = z.infer<typeof UpdateSshConnectionInputSchema>;
export type RemoveSshConnectionInput = z.infer<typeof RemoveSshConnectionInputSchema>;
export type TestSshConnectionInput = z.infer<typeof TestSshConnectionInputSchema>;

export const SSH_IPC_ERROR_CODES = [
  'invalid_ssh_input',
  'ssh_import_invalid_command',
  'ssh_connection_not_found',
  'ssh_connection_version_conflict',
  'ssh_connection_limit_reached',
  'ssh_workspace_grant_not_found',
  'ssh_workspace_grant_conflict',
  'ssh_workspace_grant_limit_reached',
  'ssh_workspace_project_unavailable',
  'ssh_workspace_command_not_allowed',
  'ssh_approval_not_found',
  'ssh_approval_denied',
  'ssh_approval_expired',
  'ssh_approval_cancelled',
  'ssh_command_not_allowed',
  'ssh_unknown_host_key',
  'ssh_authentication_failed',
  'ssh_connection_failed',
  'ssh_timed_out',
  'ssh_output_too_large',
  'ssh_cancelled',
  'ssh_capacity_exceeded',
  'ssh_unavailable',
] as const;

export type SshIpcErrorCode = (typeof SSH_IPC_ERROR_CODES)[number];

export type SshIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: SshIpcErrorCode }> }>;
