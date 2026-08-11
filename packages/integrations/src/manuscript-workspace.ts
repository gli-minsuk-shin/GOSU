import {
  ManuscriptWorkspaceDescriptorV1Schema,
  type ManuscriptCheckpointV1,
  type ManuscriptSyncAnchorV1,
  type ManuscriptSyncState,
  type ManuscriptWorkspaceBindingV1,
  type ManuscriptWorkspaceDescriptorV1,
} from '@gosu/contracts';

export type ManuscriptWorkspaceObservation = Readonly<{
  providerRevision: string | null;
  cursor: string | null;
  observedAt: string;
}>;

export type ManuscriptCheckpointResult = Readonly<{
  providerRevision: string;
  cursor: string | null;
  revisionEnvelopeDigest: ManuscriptCheckpointV1['revisionEnvelopeDigest'];
}>;

type AdapterOperationContext = Readonly<{
  binding: ManuscriptWorkspaceBindingV1;
  idempotencyKey: string;
  fencingToken: number;
}>;

export type BootstrapManuscriptWorkspaceInput = AdapterOperationContext &
  Readonly<{
    sourceRevision: string;
    rootDocument: string;
    artifactLease: string;
  }>;

export type FetchManuscriptCheckpointInput = AdapterOperationContext &
  Readonly<{
    expectedProviderRevision: string | null;
    rootDocument: ManuscriptCheckpointV1['rootDocument'];
  }>;

export type RestoreManuscriptCheckpointArtifactInput = AdapterOperationContext &
  Readonly<{
    checkpoint: ManuscriptCheckpointV1;
  }>;

export type PublishManuscriptCheckpointInput = AdapterOperationContext &
  Readonly<{
    checkpoint: ManuscriptCheckpointV1;
    expectedProviderRevision: string | null;
  }>;

/**
 * Realtime operation codecs remain provider-owned for now. The common port
 * exposes only an opaque session lifecycle while every provider implements
 * the checkpoint boundary used for review and migration.
 */
export interface ManuscriptRealtimeSessionPort {
  readonly protocolVersion: string;
  open(binding: ManuscriptWorkspaceBindingV1): Promise<Readonly<{ sessionRef: string }>>;
  close(sessionRef: string): Promise<void>;
}

export interface ManuscriptWorkspaceAdapter {
  readonly descriptor: ManuscriptWorkspaceDescriptorV1;
  /**
   * Opaque provider-workspace key used to serialize operations that share credentials or
   * provider-side state across otherwise independent GOSU projects.
   */
  workspaceConcurrencyKey?(binding: ManuscriptWorkspaceBindingV1): Promise<string>;
  inspect(binding: ManuscriptWorkspaceBindingV1): Promise<ManuscriptWorkspaceObservation>;
  hasCheckpointArtifact?(
    binding: ManuscriptWorkspaceBindingV1,
    checkpoint: ManuscriptCheckpointV1,
  ): Promise<boolean>;
  restoreCheckpointArtifact?(input: RestoreManuscriptCheckpointArtifactInput): Promise<void>;
  /**
   * Removes provider-private local artifacts after the owning project metadata has been
   * durably purged. Hosted/provider content is never deleted by this hook.
   */
  purgeBindingArtifacts?(bindingId: ManuscriptWorkspaceBindingV1['bindingId']): Promise<void>;
  credentialConcurrencyKey?(credentialRef: string): Promise<string>;
  purgeCredential?(credentialRef: string): Promise<void>;
  bootstrap?(input: BootstrapManuscriptWorkspaceInput): Promise<ManuscriptCheckpointResult>;
  fetchCheckpoint?(input: FetchManuscriptCheckpointInput): Promise<ManuscriptCheckpointResult>;
  publishCheckpoint?(input: PublishManuscriptCheckpointInput): Promise<ManuscriptCheckpointResult>;
  readonly realtime?: ManuscriptRealtimeSessionPort;
}

function requiresMode(
  descriptor: ManuscriptWorkspaceDescriptorV1,
  mode: ManuscriptWorkspaceDescriptorV1['capabilities']['interactionModes'][number],
) {
  return descriptor.capabilities.interactionModes.includes(mode);
}

function validateAdapterOperations(adapter: ManuscriptWorkspaceAdapter) {
  const { descriptor } = adapter;
  const requirements = [
    ['bootstrap_export', adapter.bootstrap],
    ['checkpoint_pull', adapter.fetchCheckpoint],
    ['checkpoint_publish', adapter.publishCheckpoint],
    ['embedded_realtime_editor', adapter.realtime],
  ] as const;

  for (const [mode, operation] of requirements) {
    const declared = requiresMode(descriptor, mode);
    if (declared && operation === undefined) {
      throw new Error(`manuscript_adapter_operation_missing:${descriptor.providerId}:${mode}`);
    }
    if (!declared && operation !== undefined) {
      throw new Error(`manuscript_adapter_operation_not_declared:${descriptor.providerId}:${mode}`);
    }
  }
}

/** Pure registry: construction validates capability honesty and duplicate IDs. */
export class ManuscriptWorkspaceAdapterRegistry {
  private readonly adapters: ReadonlyMap<string, ManuscriptWorkspaceAdapter>;

  constructor(adapters: readonly ManuscriptWorkspaceAdapter[]) {
    const entries = new Map<string, ManuscriptWorkspaceAdapter>();
    for (const adapter of adapters) {
      const descriptor = ManuscriptWorkspaceDescriptorV1Schema.parse(adapter.descriptor);
      if (entries.has(descriptor.providerId)) {
        throw new Error(`duplicate_manuscript_workspace_adapter:${descriptor.providerId}`);
      }
      validateAdapterOperations(adapter);
      entries.set(descriptor.providerId, adapter);
    }
    this.adapters = entries;
  }

  descriptors(): readonly ManuscriptWorkspaceDescriptorV1[] {
    return [...this.adapters.values()].map(({ descriptor }) => descriptor);
  }

  adapter(providerId: string): ManuscriptWorkspaceAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) throw new Error(`unknown_manuscript_workspace_adapter:${providerId}`);
    return adapter;
  }
}

export function createManuscriptWorkspaceAdapterRegistry(
  adapters: readonly ManuscriptWorkspaceAdapter[],
) {
  return new ManuscriptWorkspaceAdapterRegistry(adapters);
}

export const overleafGitManuscriptWorkspaceDescriptor = ManuscriptWorkspaceDescriptorV1Schema.parse(
  {
    schemaVersion: 1,
    providerId: 'overleaf_git',
    displayName: 'Overleaf Git checkpoints',
    workspaceKind: 'remote_git_checkpoint',
    collaborationModel: 'checkpoint',
    capabilities: {
      schemaVersion: 1,
      interactionModes: ['checkpoint_pull', 'external_realtime_editor'],
      revisionTopology: 'linear',
      conditionalPublish: false,
      providerHistory: true,
      presence: false,
      comments: false,
      trackChanges: false,
      serverCompile: false,
      reviewMetadataRoundTrip: 'unsupported',
    },
    unsupportedMetadata: ['presence', 'comments', 'track_changes', 'realtime_operations'],
    limitations: [
      'existing_project_link_only',
      'manual_checkpoint_only',
      'single_linear_history',
      'publish_not_available_in_v1',
      'no_background_polling',
    ],
  },
);

export const manuscriptWorkspaceDescriptorRegistry = Object.freeze({
  overleaf_git: overleafGitManuscriptWorkspaceDescriptor,
});

export type BuiltinManuscriptWorkspaceProviderId =
  keyof typeof manuscriptWorkspaceDescriptorRegistry;

export function getManuscriptWorkspaceDescriptor(id: BuiltinManuscriptWorkspaceProviderId) {
  return manuscriptWorkspaceDescriptorRegistry[id];
}

export type ManuscriptSyncObservation = Readonly<{
  linked: boolean;
  lifecycle: 'ready' | 'checking' | 'blocked' | 'failed';
  anchor: ManuscriptSyncAnchorV1 | null;
  providerRevision: string | null;
  gosuRevision: string | null;
}>;

/**
 * Derives relation only from immutable observations. It never mutates an
 * anchor and never resolves divergence with last-write-wins semantics.
 */
export function deriveManuscriptSyncState(
  observation: ManuscriptSyncObservation,
): ManuscriptSyncState {
  if (!observation.linked) return 'unlinked';
  if (observation.lifecycle !== 'ready') return observation.lifecycle;

  const { anchor, providerRevision, gosuRevision } = observation;
  if (anchor === null || anchor.lastCommonRevision === null) {
    if (providerRevision === null && gosuRevision === null) return 'checking';
    if (providerRevision === null) return 'gosu_ahead';
    if (gosuRevision === null) return 'provider_ahead';
    // Opaque provider and repository revision IDs are never comparable. Until an explicit,
    // content-verified common checkpoint exists, two non-null heads are unrelated.
    return 'diverged';
  }

  const providerChanged = providerRevision !== anchor.providerRevision;
  const gosuChanged = gosuRevision !== anchor.gosuRevision;
  if (providerChanged && gosuChanged) return 'diverged';
  if (providerChanged) return 'provider_ahead';
  if (gosuChanged) return 'gosu_ahead';
  return 'in_sync';
}
