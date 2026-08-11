import { z } from 'zod';

import { EntityIdSchema, IsoDateTimeSchema, Sha256DigestSchema } from './common.js';

const OpaqueRevisionSchema = z.string().trim().min(1).max(512);
const NullableOpaqueRevisionSchema = OpaqueRevisionSchema.nullable();

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export const ManuscriptWorkspaceKindSchema = z.enum([
  'remote_git_checkpoint',
  'local_native',
  'cloud_native',
]);
export type ManuscriptWorkspaceKind = z.infer<typeof ManuscriptWorkspaceKindSchema>;

export const ManuscriptCollaborationModelSchema = z.enum(['checkpoint', 'realtime']);
export type ManuscriptCollaborationModel = z.infer<typeof ManuscriptCollaborationModelSchema>;

/**
 * Provider capability snapshot used for honest UI disclosure. Interaction modes are the only
 * operations currently exposed through the v1 GOSU adapter and are checked against its methods.
 * Presence, comment, Track Changes, compile, and review-metadata fields describe the provider;
 * they must not be treated as callable GOSU features until their own versioned ports exist. An
 * `external_realtime_editor` interaction mode is deliberately distinct from
 * embedded realtime support: a provider may offer live editing in its own UI
 * without exposing presence or review metadata to GOSU.
 */
export const ManuscriptWorkspaceCapabilitiesV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    interactionModes: z
      .array(
        z.enum([
          'bootstrap_export',
          'checkpoint_pull',
          'checkpoint_publish',
          'external_realtime_editor',
          'embedded_realtime_editor',
        ]),
      )
      .min(1)
      .max(5),
    revisionTopology: z.enum(['linear', 'multi_version', 'multi_branch']),
    conditionalPublish: z.boolean(),
    providerHistory: z.boolean(),
    presence: z.boolean(),
    comments: z.boolean(),
    trackChanges: z.boolean(),
    serverCompile: z.boolean(),
    reviewMetadataRoundTrip: z.enum(['native', 'lossless', 'unsupported', 'unknown']),
  })
  .strict();
export type ManuscriptWorkspaceCapabilitiesV1 = z.infer<
  typeof ManuscriptWorkspaceCapabilitiesV1Schema
>;

export const ManuscriptWorkspaceDescriptorV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    providerId: EntityIdSchema,
    displayName: z.string().trim().min(1).max(128),
    workspaceKind: ManuscriptWorkspaceKindSchema,
    collaborationModel: ManuscriptCollaborationModelSchema,
    capabilities: ManuscriptWorkspaceCapabilitiesV1Schema,
    unsupportedMetadata: z.array(z.string().trim().min(1).max(128)).max(32),
    limitations: z.array(z.string().trim().min(1).max(128)).max(32),
  })
  .strict();
export type ManuscriptWorkspaceDescriptorV1 = z.infer<typeof ManuscriptWorkspaceDescriptorV1Schema>;

export const ManuscriptAuthoritySchema = z.enum(['gosu', 'provider']);
export type ManuscriptAuthority = z.infer<typeof ManuscriptAuthoritySchema>;

export const ManuscriptRootDocumentSchema = z
  .string()
  .trim()
  .min(5)
  .max(1_024)
  .regex(
    /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\).+\.tex$/,
    'Expected a relative TeX root document path',
  )
  .refine((path) => !hasControlCharacter(path), 'Control characters are not allowed');
export type ManuscriptRootDocument = z.infer<typeof ManuscriptRootDocumentSchema>;

/**
 * Provider-neutral binding. Provider workspace locators, URLs and credentials
 * live in an adapter-private record keyed by `bindingId`; they are
 * intentionally not part of this portable contract.
 */
export const ManuscriptWorkspaceBindingV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    bindingId: EntityIdSchema,
    projectId: EntityIdSchema,
    manuscriptId: EntityIdSchema,
    providerId: EntityIdSchema,
    capabilitiesSnapshot: ManuscriptWorkspaceCapabilitiesV1Schema,
    authority: ManuscriptAuthoritySchema,
    enabled: z.boolean(),
    version: z.number().int().positive(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();
export type ManuscriptWorkspaceBindingV1 = z.infer<typeof ManuscriptWorkspaceBindingV1Schema>;

/** ADR terminology compatibility: a workspace link is the binding record. */
export const ManuscriptWorkspaceLinkV1Schema = ManuscriptWorkspaceBindingV1Schema;
export type ManuscriptWorkspaceLinkV1 = ManuscriptWorkspaceBindingV1;

export const ManuscriptCheckpointV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    checkpointId: EntityIdSchema,
    bindingId: EntityIdSchema,
    projectId: EntityIdSchema,
    manuscriptId: EntityIdSchema,
    providerId: EntityIdSchema,
    direction: z.enum(['bootstrap', 'fetch', 'publish', 'migration']),
    sourceAuthority: ManuscriptAuthoritySchema,
    sourceRevision: OpaqueRevisionSchema,
    gosuRevision: NullableOpaqueRevisionSchema,
    providerRevision: NullableOpaqueRevisionSchema,
    cursor: NullableOpaqueRevisionSchema,
    revisionEnvelopeDigest: Sha256DigestSchema,
    rootDocument: ManuscriptRootDocumentSchema,
    baseCheckpointId: EntityIdSchema.nullable(),
    actorId: EntityIdSchema,
    observedAt: IsoDateTimeSchema,
  })
  .strict();
export type ManuscriptCheckpointV1 = z.infer<typeof ManuscriptCheckpointV1Schema>;

export const ManuscriptSyncAnchorV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    bindingId: EntityIdSchema,
    generation: z.number().int().nonnegative(),
    lastCommonRevision: NullableOpaqueRevisionSchema,
    providerRevision: NullableOpaqueRevisionSchema,
    gosuRevision: NullableOpaqueRevisionSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();
export type ManuscriptSyncAnchorV1 = z.infer<typeof ManuscriptSyncAnchorV1Schema>;

export const ManuscriptSyncStateSchema = z.enum([
  'unlinked',
  'checking',
  'in_sync',
  'provider_ahead',
  'gosu_ahead',
  'diverged',
  'blocked',
  'failed',
]);
export type ManuscriptSyncState = z.infer<typeof ManuscriptSyncStateSchema>;

export const ManuscriptSyncAttemptV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    attemptId: EntityIdSchema,
    bindingId: EntityIdSchema,
    projectId: EntityIdSchema,
    manuscriptId: EntityIdSchema,
    providerId: EntityIdSchema,
    operation: z.enum(['bootstrap', 'fetch', 'publish', 'migration']),
    state: z.enum([
      'requested',
      'running',
      'succeeded',
      'blocked',
      'failed',
      'cancelled',
      'unknown',
    ]),
    sourceRevision: OpaqueRevisionSchema,
    targetRevision: NullableOpaqueRevisionSchema,
    expectedProviderRevision: NullableOpaqueRevisionSchema,
    idempotencyKey: z.string().trim().min(1).max(1_024),
    fencingToken: z.number().int().nonnegative(),
    requestedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable(),
    resultCheckpointId: EntityIdSchema.nullable(),
    failureCode: z.string().trim().min(1).max(128).nullable(),
  })
  .strict();
export type ManuscriptSyncAttemptV1 = z.infer<typeof ManuscriptSyncAttemptV1Schema>;
