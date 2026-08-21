import { z } from 'zod';

import { SshAgentCommandSchema, SshConnectionProfileSchema } from './ssh-contracts';

export const SSH_WORKSPACE_ROOT_MAX_LENGTH = 1_024;
export const SSH_WORKSPACE_SUBDIRECTORY_MAX_LENGTH = 512;
export const SSH_WORKSPACE_MAX_ARGUMENTS = 20;
export const SSH_WORKSPACE_FILE_PATH_MAX_LENGTH = 512;
export const SSH_WORKSPACE_FILE_MAX_CHARACTERS = 24_000;
export const SSH_WORKSPACE_FILE_READ_MAX_CHARACTERS = 16_000;
export const SSH_WORKSPACE_FILE_LIST_MAX_ENTRIES = 200;
export const SSH_TRUSTED_WORKSPACE_POLICY_VERSION = 2;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function hasUnicodeFormatCharacter(value: string) {
  return /\p{Cf}/u.test(value);
}

function hasUnicodeSurrogateCharacter(value: string) {
  return /\p{Cs}/u.test(value);
}

function hasUnsafeWorkspaceFileContentCharacter(value: string) {
  if (hasUnicodeFormatCharacter(value) || hasUnicodeSurrogateCharacter(value)) return true;
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (code <= 31 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159);
  });
}

const blockedWorkspacePrefixes = new Set([
  'bin',
  'boot',
  'dev',
  'etc',
  'lib',
  'lib32',
  'lib64',
  'proc',
  'run',
  'sbin',
  'sys',
  'usr',
  'var',
]);

/**
 * This is a lexical policy boundary, not a remote filesystem sandbox. The UI and approval copy
 * must preserve that distinction. A dedicated Runner/container is required for hard confinement.
 */
export function isAllowedRemoteWorkspaceRoot(value: string) {
  if (!value.startsWith('/') || value === '/' || value.endsWith('/')) return false;
  if (
    hasControlCharacter(value) ||
    hasUnicodeFormatCharacter(value) ||
    hasUnicodeSurrogateCharacter(value) ||
    value.includes('\\')
  )
    return false;
  const segments = value.slice(1).split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return false;
  }
  if (blockedWorkspacePrefixes.has(segments[0]!)) return false;
  if (segments.length === 1 && segments[0] !== 'workspace' && segments[0] !== 'app') return false;
  return true;
}

export const RemoteWorkspaceRootSchema = z
  .string()
  .trim()
  .min(1)
  .max(SSH_WORKSPACE_ROOT_MAX_LENGTH)
  .refine(isAllowedRemoteWorkspaceRoot, 'Use a bounded absolute remote workspace path');

export const RemoteWorkspacePermissionModeSchema = z.enum(['diagnostics', 'workspace']);
export type RemoteWorkspacePermissionMode = z.infer<typeof RemoteWorkspacePermissionModeSchema>;

export const TrustedRemoteWorkspaceAccessSchema = z
  .object({
    schemaVersion: z.literal(1),
    policyVersion: z.number().int().positive(),
    projectId: uuidSchema,
    grantId: uuidSchema,
    grantVersion: z.number().int().positive(),
    connectionId: uuidSchema,
    connectionVersion: z.number().int().positive(),
    canonicalRoot: RemoteWorkspaceRootSchema,
    enabledAt: timestampSchema,
  })
  .strict();

export type TrustedRemoteWorkspaceAccess = z.infer<typeof TrustedRemoteWorkspaceAccessSchema>;

export const RemoteWorkspaceGrantSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    connectionId: uuidSchema,
    canonicalRoot: RemoteWorkspaceRootSchema,
    permissionMode: RemoteWorkspacePermissionModeSchema,
    trustedAccess: TrustedRemoteWorkspaceAccessSchema.nullable().optional(),
    version: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export type RemoteWorkspaceGrant = z.infer<typeof RemoteWorkspaceGrantSchema>;

export const CreateRemoteWorkspaceGrantInputSchema = z
  .object({
    projectId: uuidSchema,
    connectionId: uuidSchema,
    canonicalRoot: RemoteWorkspaceRootSchema,
    permissionMode: RemoteWorkspacePermissionModeSchema,
    confirmWorkspaceRisk: z.literal(true),
  })
  .strict();

export const UpdateRemoteWorkspaceGrantInputSchema = z
  .object({
    grantId: uuidSchema,
    projectId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    canonicalRoot: RemoteWorkspaceRootSchema,
    permissionMode: RemoteWorkspacePermissionModeSchema,
    confirmWorkspaceRisk: z.literal(true),
  })
  .strict();

export const RemoveRemoteWorkspaceGrantInputSchema = z
  .object({
    grantId: uuidSchema,
    projectId: uuidSchema,
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const ListRemoteWorkspaceGrantsInputSchema = z.object({ projectId: uuidSchema }).strict();

export const EnableTrustedRemoteWorkspaceInputSchema = z
  .object({
    projectId: uuidSchema,
    grantId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    confirmTrustedWorkspaceRisk: z.literal(true),
    confirmNoRemoteSandbox: z.literal(true),
    confirmRootTrustedWorkspaceRisk: z.literal(true).optional(),
  })
  .strict();

export const RevokeTrustedRemoteWorkspaceInputSchema = z
  .object({
    projectId: uuidSchema,
    grantId: uuidSchema,
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const RemoteWorkspaceSubdirectorySchema = z
  .string()
  .trim()
  .max(SSH_WORKSPACE_SUBDIRECTORY_MAX_LENGTH)
  .refine((value) => {
    if (value === '') return true;
    if (value.startsWith('/') || value.endsWith('/') || value.includes('\\')) return false;
    if (
      hasControlCharacter(value) ||
      hasUnicodeFormatCharacter(value) ||
      hasUnicodeSurrogateCharacter(value)
    )
      return false;
    return value
      .split('/')
      .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  }, 'Use a relative workspace subdirectory without traversal');

const workspaceArgumentSchema = z
  .string()
  .max(1_024)
  .refine(
    (value) =>
      !hasControlCharacter(value) &&
      !hasUnicodeFormatCharacter(value) &&
      !hasUnicodeSurrogateCharacter(value),
    'Control, Unicode format, and surrogate characters are not allowed',
  );

export const SshWorkspaceAgentCommandSchema = SshAgentCommandSchema.omit({
  workingDirectory: true,
})
  .extend({
    grantId: uuidSchema,
    // Keep room for the hardening flags that Main injects before approval and execution.
    args: z.array(workspaceArgumentSchema).max(SSH_WORKSPACE_MAX_ARGUMENTS).default([]),
    workspaceSubdirectory: RemoteWorkspaceSubdirectorySchema.optional(),
  })
  .strict();

export type SshWorkspaceAgentCommand = z.infer<typeof SshWorkspaceAgentCommandSchema>;

const blockedWorkspaceFileSegments = new Set(['.git', '.ssh', '.gnupg', '.aws']);
const blockedWorkspaceFileNames = new Set([
  '.netrc',
  '.npmrc',
  '.pypirc',
  'authorized_keys',
  'credentials',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'known_hosts',
]);

function isAllowedWorkspaceFilePath(value: string) {
  const segments = value.split('/');
  const normalizedSegments = segments.map((segment) => segment.toLowerCase());
  const basename = normalizedSegments.at(-1) ?? '';
  if (normalizedSegments.some((segment) => blockedWorkspaceFileSegments.has(segment))) return false;
  if (blockedWorkspaceFileNames.has(basename)) return false;
  if (basename === '.env' || basename.startsWith('.env.')) return false;
  if (basename.startsWith('.gosu-write-')) return false;
  return !['.key', '.p12', '.pem', '.pfx', '.ppk'].some((suffix) => basename.endsWith(suffix));
}

export const RemoteWorkspaceFilePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(SSH_WORKSPACE_FILE_PATH_MAX_LENGTH)
  .refine((value) => {
    if (value.startsWith('/') || value.endsWith('/') || value.includes('\\')) return false;
    if (
      hasControlCharacter(value) ||
      hasUnicodeFormatCharacter(value) ||
      hasUnicodeSurrogateCharacter(value)
    )
      return false;
    return value
      .split('/')
      .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  }, 'Use a relative workspace file path without traversal')
  .refine(isAllowedWorkspaceFilePath, 'Sensitive workspace paths are not available');

const workspaceInvocationSchema = SshAgentCommandSchema.pick({
  projectId: true,
  sessionId: true,
  attemptId: true,
  turnId: true,
  toolCallId: true,
  connectionId: true,
}).extend({
  grantId: uuidSchema,
  workspaceSubdirectory: RemoteWorkspaceSubdirectorySchema.optional(),
});

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

export const SshWorkspaceFileOperationSchema = z.discriminatedUnion('action', [
  workspaceInvocationSchema
    .extend({
      action: z.literal('list'),
      maxEntries: z.number().int().min(1).max(SSH_WORKSPACE_FILE_LIST_MAX_ENTRIES).default(100),
    })
    .strict(),
  workspaceInvocationSchema
    .extend({
      action: z.literal('read'),
      relativePath: RemoteWorkspaceFilePathSchema,
      offset: z.number().int().nonnegative().default(0),
      maxCharacters: z
        .number()
        .int()
        .min(1)
        .max(SSH_WORKSPACE_FILE_READ_MAX_CHARACTERS)
        .default(SSH_WORKSPACE_FILE_READ_MAX_CHARACTERS),
    })
    .strict(),
  workspaceInvocationSchema
    .extend({
      action: z.literal('write'),
      relativePath: RemoteWorkspaceFilePathSchema,
      content: z
        .string()
        .refine(
          (value) => [...value].length <= SSH_WORKSPACE_FILE_MAX_CHARACTERS,
          'Workspace file content is too long',
        )
        .refine(
          (value) => !hasUnsafeWorkspaceFileContentCharacter(value),
          'Unsafe control, Unicode format, or surrogate characters are not allowed',
        ),
      expectedSha256: sha256Schema.nullable(),
    })
    .strict(),
]);

export type SshWorkspaceFileOperation = z.infer<typeof SshWorkspaceFileOperationSchema>;

export const SshWorkspaceOperationClassSchema = z.enum([
  'inspect',
  'edit',
  'test',
  'build',
  'experiment',
]);
export type SshWorkspaceOperationClass = z.infer<typeof SshWorkspaceOperationClassSchema>;

export const SshTrustedWorkspaceAuditRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    grantId: uuidSchema,
    grantVersion: z.number().int().positive(),
    connectionId: uuidSchema,
    connectionVersion: z.number().int().positive(),
    policyVersion: z.number().int().positive(),
    sessionId: uuidSchema,
    attemptId: uuidSchema,
    turnId: z.string().min(1).max(256),
    toolCallId: z.string().min(1).max(256),
    operation: SshWorkspaceOperationClassSchema,
    commandSha256: sha256Schema,
    autoApprovedAt: timestampSchema,
  })
  .strict();

export type SshTrustedWorkspaceAuditRecord = z.infer<typeof SshTrustedWorkspaceAuditRecordSchema>;

export const GrantedRemoteWorkspaceSchema = z
  .object({
    grant: RemoteWorkspaceGrantSchema,
    connection: SshConnectionProfileSchema,
  })
  .strict();

export type GrantedRemoteWorkspace = z.infer<typeof GrantedRemoteWorkspaceSchema>;
export type CreateRemoteWorkspaceGrantInput = z.infer<typeof CreateRemoteWorkspaceGrantInputSchema>;
export type UpdateRemoteWorkspaceGrantInput = z.infer<typeof UpdateRemoteWorkspaceGrantInputSchema>;
export type RemoveRemoteWorkspaceGrantInput = z.infer<typeof RemoveRemoteWorkspaceGrantInputSchema>;
export type ListRemoteWorkspaceGrantsInput = z.infer<typeof ListRemoteWorkspaceGrantsInputSchema>;
export type EnableTrustedRemoteWorkspaceInput = z.infer<
  typeof EnableTrustedRemoteWorkspaceInputSchema
>;
export type RevokeTrustedRemoteWorkspaceInput = z.infer<
  typeof RevokeTrustedRemoteWorkspaceInputSchema
>;
