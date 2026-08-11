import {
  ManuscriptCheckpointV1Schema,
  ManuscriptRootDocumentSchema,
  ManuscriptSyncAnchorV1Schema,
  ManuscriptSyncStateSchema,
  ManuscriptWorkspaceBindingV1Schema,
  ManuscriptWorkspaceDescriptorV1Schema,
} from '@gosu/contracts';
import { z } from 'zod';

const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const workspacePresentationUrlSchema = z
  .url({ protocol: /^https$/u, hostname: z.regexes.hostname })
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return url.username === '' && url.password === '';
  }, 'Workspace presentation URLs cannot contain credentials');

export { ManuscriptRootDocumentSchema };

export const ManuscriptRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    title: z.string().trim().min(1).max(160),
    rootDocument: ManuscriptRootDocumentSchema,
    version: z.number().int().positive(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type ManuscriptRecord = z.infer<typeof ManuscriptRecordSchema>;

export const ManuscriptWorkspaceLifecycleSchema = z.enum([
  'ready',
  'checking',
  'blocked',
  'failed',
]);
export type ManuscriptWorkspaceLifecycle = z.infer<typeof ManuscriptWorkspaceLifecycleSchema>;

export const ManuscriptWorkspaceConnectionSchema = z
  .object({
    binding: ManuscriptWorkspaceBindingV1Schema,
    providerDisplayName: z.string().trim().min(1).max(128),
    workspaceUrl: workspacePresentationUrlSchema.nullable(),
    lifecycle: ManuscriptWorkspaceLifecycleSchema,
    syncState: ManuscriptSyncStateSchema,
    anchor: ManuscriptSyncAnchorV1Schema,
    lastObservedProviderRevision: z.string().trim().min(1).max(512).nullable(),
    lastObservedAt: isoDateTimeSchema.nullable(),
    lastFailureCode: z.string().trim().min(1).max(128).nullable(),
    lastCheckpoint: ManuscriptCheckpointV1Schema.nullable(),
  })
  .strict();
export type ManuscriptWorkspaceConnection = z.infer<typeof ManuscriptWorkspaceConnectionSchema>;

export const ManuscriptWorkspaceItemSchema = z
  .object({
    manuscript: ManuscriptRecordSchema,
    connection: ManuscriptWorkspaceConnectionSchema.nullable(),
  })
  .strict();
export type ManuscriptWorkspaceItem = z.infer<typeof ManuscriptWorkspaceItemSchema>;

export const ManuscriptWorkspaceSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: uuidSchema,
    providers: z.array(ManuscriptWorkspaceDescriptorV1Schema).max(16),
    manuscripts: z.array(ManuscriptWorkspaceItemSchema).max(32),
  })
  .strict();
export type ManuscriptWorkspaceSnapshot = z.infer<typeof ManuscriptWorkspaceSnapshotSchema>;

export const ManuscriptProjectInputSchema = z.object({ projectId: uuidSchema }).strict();

export const CreateManuscriptInputSchema = z
  .object({
    projectId: uuidSchema,
    title: z.string().trim().min(1).max(160),
    rootDocument: ManuscriptRootDocumentSchema,
  })
  .strict();
export type CreateManuscriptInput = z.infer<typeof CreateManuscriptInputSchema>;

export const UpdateManuscriptInputSchema = z
  .object({
    projectId: uuidSchema,
    manuscriptId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(160),
    rootDocument: ManuscriptRootDocumentSchema,
  })
  .strict();
export type UpdateManuscriptInput = z.infer<typeof UpdateManuscriptInputSchema>;

export const ConnectOverleafGitInputSchema = z
  .object({
    projectId: uuidSchema,
    manuscriptId: uuidSchema,
    expectedManuscriptVersion: z.number().int().positive(),
    providerId: z.literal('overleaf_git'),
    remoteUrl: z.string().trim().min(1).max(2_048),
    accessToken: z.string().min(1).max(2_048),
  })
  .strict();
export type ConnectOverleafGitInput = z.infer<typeof ConnectOverleafGitInputSchema>;

export const ManuscriptBindingCommandSchema = z
  .object({
    projectId: uuidSchema,
    manuscriptId: uuidSchema,
    bindingId: uuidSchema,
    expectedBindingVersion: z.number().int().positive(),
  })
  .strict();
export type ManuscriptBindingCommand = z.infer<typeof ManuscriptBindingCommandSchema>;

export const FetchManuscriptCheckpointInputSchema = ManuscriptBindingCommandSchema.extend({
  expectedProviderRevision: z.string().trim().min(1).max(512).nullable(),
}).strict();
export type FetchManuscriptCheckpointInput = z.infer<typeof FetchManuscriptCheckpointInputSchema>;

export const DisconnectManuscriptWorkspaceInputSchema = ManuscriptBindingCommandSchema;
export type DisconnectManuscriptWorkspaceInput = ManuscriptBindingCommand;

export type OverleafGitBindingConfiguration = Readonly<{
  bindingId: string;
  remoteUrl: string;
  workspaceId: string;
  webUrl: string;
  credentialRef: string;
}>;

export type StoredManuscriptWorkspaceConnection = Readonly<{
  binding: z.infer<typeof ManuscriptWorkspaceBindingV1Schema>;
  anchor: z.infer<typeof ManuscriptSyncAnchorV1Schema>;
  lifecycle: ManuscriptWorkspaceLifecycle;
  lastObservedProviderRevision: string | null;
  lastObservedAt: string | null;
  lastFailureCode: string | null;
}>;
