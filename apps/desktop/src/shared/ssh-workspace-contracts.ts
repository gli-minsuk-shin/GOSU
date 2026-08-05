import { z } from 'zod';

import { SshAgentCommandSchema, SshConnectionProfileSchema } from './ssh-contracts';

export const SSH_WORKSPACE_ROOT_MAX_LENGTH = 1_024;
export const SSH_WORKSPACE_SUBDIRECTORY_MAX_LENGTH = 512;
export const SSH_WORKSPACE_MAX_ARGUMENTS = 20;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
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
  if (hasControlCharacter(value) || value.includes('\\')) return false;
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

export const RemoteWorkspaceGrantSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    connectionId: uuidSchema,
    canonicalRoot: RemoteWorkspaceRootSchema,
    permissionMode: RemoteWorkspacePermissionModeSchema,
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

const workspaceSubdirectorySchema = z
  .string()
  .trim()
  .max(SSH_WORKSPACE_SUBDIRECTORY_MAX_LENGTH)
  .refine((value) => {
    if (value === '') return true;
    if (value.startsWith('/') || value.endsWith('/') || value.includes('\\')) return false;
    if (hasControlCharacter(value)) return false;
    return value
      .split('/')
      .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  }, 'Use a relative workspace subdirectory without traversal');

const workspaceArgumentSchema = z
  .string()
  .max(1_024)
  .refine((value) => !hasControlCharacter(value), 'Control characters are not allowed');

export const SshWorkspaceAgentCommandSchema = SshAgentCommandSchema.omit({
  workingDirectory: true,
})
  .extend({
    grantId: uuidSchema,
    // Keep room for the hardening flags that Main injects before approval and execution.
    args: z.array(workspaceArgumentSchema).max(SSH_WORKSPACE_MAX_ARGUMENTS).default([]),
    workspaceSubdirectory: workspaceSubdirectorySchema.optional(),
  })
  .strict();

export type SshWorkspaceAgentCommand = z.infer<typeof SshWorkspaceAgentCommandSchema>;

export const SshWorkspaceOperationClassSchema = z.enum(['inspect', 'test', 'build']);
export type SshWorkspaceOperationClass = z.infer<typeof SshWorkspaceOperationClassSchema>;

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
