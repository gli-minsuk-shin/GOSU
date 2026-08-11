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
const sha256DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
export const MANUSCRIPT_CHECKPOINT_MAX_FILE_METADATA_ENTRIES = 10_000;
export const MANUSCRIPT_CHECKPOINT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const hasNoControlCharacters = (value: string) =>
  [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0x20 && codePoint !== 0x7f;
  });
const manuscriptRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .regex(
    /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\).+$/u,
    'Expected a safe relative manuscript path',
  )
  .refine(hasNoControlCharacters, 'Expected a safe relative manuscript path');
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

export const ManuscriptCheckpointFileSchema = z
  .object({
    relativePath: manuscriptRelativePathSchema,
    sizeBytes: z.number().int().nonnegative().max(MANUSCRIPT_CHECKPOINT_MAX_FILE_BYTES),
    textReadable: z.boolean(),
  })
  .strict();
export type ManuscriptCheckpointFile = z.infer<typeof ManuscriptCheckpointFileSchema>;

export const ListManuscriptCheckpointFilesInputSchema = z
  .object({
    projectId: uuidSchema,
    manuscriptId: uuidSchema,
    checkpointId: uuidSchema,
  })
  .strict();
export type ListManuscriptCheckpointFilesInput = z.infer<
  typeof ListManuscriptCheckpointFilesInputSchema
>;

export const ManuscriptCheckpointFileListSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: uuidSchema,
    manuscriptId: uuidSchema,
    checkpointId: uuidSchema,
    providerRevision: z.string().trim().min(1).max(512),
    files: z
      .array(ManuscriptCheckpointFileSchema)
      .max(MANUSCRIPT_CHECKPOINT_MAX_FILE_METADATA_ENTRIES),
  })
  .strict();
export type ManuscriptCheckpointFileList = z.infer<typeof ManuscriptCheckpointFileListSchema>;

export const ReadManuscriptCheckpointFileInputSchema = z
  .object({
    projectId: uuidSchema,
    manuscriptId: uuidSchema,
    checkpointId: uuidSchema,
    relativePath: manuscriptRelativePathSchema,
    offset: z
      .number()
      .int()
      .nonnegative()
      .max(16 * 1024 * 1024)
      .optional(),
    maxCharacters: z.number().int().min(1).max(24_000).optional(),
  })
  .strict();
export type ReadManuscriptCheckpointFileInput = z.infer<
  typeof ReadManuscriptCheckpointFileInputSchema
>;

export const ManuscriptCheckpointFileChunkSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: uuidSchema,
    manuscriptId: uuidSchema,
    checkpointId: uuidSchema,
    providerRevision: z.string().trim().min(1).max(512),
    relativePath: manuscriptRelativePathSchema,
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative(),
    truncated: z.boolean(),
    content: z.string().max(24_000),
  })
  .strict();
export type ManuscriptCheckpointFileChunk = z.infer<typeof ManuscriptCheckpointFileChunkSchema>;

export const ManuscriptLatexEngineSchema = z.enum(['pdflatex', 'xelatex', 'lualatex']);
export type ManuscriptLatexEngine = z.infer<typeof ManuscriptLatexEngineSchema>;
export const MANUSCRIPT_LATEX_ENGINE_DISPLAY_NAMES = {
  pdflatex: 'pdfLaTeX',
  xelatex: 'XeLaTeX',
  lualatex: 'LuaLaTeX',
} as const satisfies Record<ManuscriptLatexEngine, string>;

export const CompileManuscriptPdfInputSchema = z
  .object({
    projectId: uuidSchema,
    manuscriptId: uuidSchema,
    checkpointId: uuidSchema,
    engine: ManuscriptLatexEngineSchema,
  })
  .strict();
export type CompileManuscriptPdfInput = z.infer<typeof CompileManuscriptPdfInputSchema>;

export const ManuscriptPdfPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    artifactId: uuidSchema,
    projectId: uuidSchema,
    manuscriptId: uuidSchema,
    checkpointId: uuidSchema,
    providerRevision: z.string().trim().min(1).max(512),
    rootDocument: ManuscriptRootDocumentSchema,
    providerAhead: z.boolean(),
    compiler: z
      .object({
        kind: z.literal('latexmk'),
        displayName: z.string().trim().min(1).max(128),
        version: z.string().trim().min(1).max(128),
        engine: ManuscriptLatexEngineSchema,
        engineDisplayName: z.string().trim().min(1).max(128),
      })
      .strict(),
    pdfSha256: sha256DigestSchema,
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(32 * 1024 * 1024),
    compiledAt: isoDateTimeSchema,
    pdfBase64: z
      .string()
      .min(8)
      .max(45 * 1024 * 1024),
  })
  .strict();
export type ManuscriptPdfPreview = z.infer<typeof ManuscriptPdfPreviewSchema>;

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
