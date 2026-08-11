import type { ManuscriptWorkspaceBindingV1 } from '@gosu/contracts';
import {
  overleafGitManuscriptWorkspaceDescriptor,
  type FetchManuscriptCheckpointInput,
  type ManuscriptWorkspaceAdapter,
} from '@gosu/integrations';

import type { OverleafGitBindingConfiguration } from '../shared/manuscript-workspace-contracts';
import {
  OVERLEAF_LEGACY_UNOWNED_CREDENTIAL_REF,
  overleafCredentialWorkspaceId,
  type OverleafGitCredentialStore,
} from './overleaf-git-credential-store';
import type { OverleafGitTransport } from './overleaf-git-transport';

type OverleafGitConfigurationPort = Readonly<{
  getOverleafGitBindingConfiguration(
    bindingId: string,
  ): OverleafGitBindingConfiguration | null | Promise<OverleafGitBindingConfiguration | null>;
}>;

function requireOverleafBinding(binding: ManuscriptWorkspaceBindingV1) {
  if (binding.providerId !== overleafGitManuscriptWorkspaceDescriptor.providerId) {
    throw new Error('overleaf_git_binding_provider_mismatch');
  }
}

/**
 * Desktop-only Overleaf implementation of the provider-neutral manuscript port.
 * Provider locators remain behind this adapter and never enter the portable binding.
 */
export class OverleafGitManuscriptWorkspaceAdapter implements ManuscriptWorkspaceAdapter {
  readonly descriptor = overleafGitManuscriptWorkspaceDescriptor;

  constructor(
    private readonly configuration: OverleafGitConfigurationPort,
    private readonly transport: Pick<
      OverleafGitTransport,
      | 'inspect'
      | 'fetchCheckpoint'
      | 'restoreCheckpoint'
      | 'hasCheckpoint'
      | 'removeBindingArtifacts'
    >,
    private readonly now: () => Date = () => new Date(),
    private readonly credentials?: Pick<OverleafGitCredentialStore, 'eraseByReference'>,
  ) {}

  async workspaceConcurrencyKey(binding: ManuscriptWorkspaceBindingV1) {
    requireOverleafBinding(binding);
    return (await this.requireConfiguration(binding.bindingId)).workspaceId;
  }

  async credentialConcurrencyKey(credentialRef: string) {
    return this.requireCredentialWorkspaceId(credentialRef);
  }

  async purgeCredential(credentialRef: string) {
    if (!this.credentials) throw new Error('overleaf_keychain_unavailable');
    await this.credentials.eraseByReference(credentialRef);
  }

  async inspect(binding: ManuscriptWorkspaceBindingV1) {
    requireOverleafBinding(binding);
    const configuration = await this.requireConfiguration(binding.bindingId);
    const observation = await this.transport.inspect(
      configuration.remoteUrl,
      configuration.credentialRef,
    );
    return {
      providerRevision: observation.workspaceRevision,
      cursor: observation.workspaceRevision,
      observedAt: this.now().toISOString(),
    };
  }

  async hasCheckpointArtifact(
    binding: ManuscriptWorkspaceBindingV1,
    checkpoint: Parameters<NonNullable<ManuscriptWorkspaceAdapter['hasCheckpointArtifact']>>[1],
  ) {
    requireOverleafBinding(binding);
    if (checkpoint.bindingId !== binding.bindingId || !checkpoint.providerRevision) return false;
    return this.transport.hasCheckpoint(
      binding.bindingId,
      checkpoint.providerRevision,
      checkpoint.rootDocument,
      checkpoint.revisionEnvelopeDigest,
    );
  }

  async restoreCheckpointArtifact(
    input: Parameters<NonNullable<ManuscriptWorkspaceAdapter['restoreCheckpointArtifact']>>[0],
  ) {
    requireOverleafBinding(input.binding);
    if (
      input.checkpoint.bindingId !== input.binding.bindingId ||
      !input.checkpoint.providerRevision
    ) {
      throw new Error('overleaf_git_checkpoint_restore_invalid');
    }
    const configuration = await this.requireConfiguration(input.binding.bindingId);
    await this.transport.restoreCheckpoint(
      input.binding.bindingId,
      configuration.remoteUrl,
      configuration.credentialRef,
      input.checkpoint.providerRevision,
      input.checkpoint.rootDocument,
      input.checkpoint.revisionEnvelopeDigest,
    );
  }

  async purgeBindingArtifacts(bindingId: ManuscriptWorkspaceBindingV1['bindingId']) {
    await this.transport.removeBindingArtifacts(bindingId);
  }

  async fetchCheckpoint(input: FetchManuscriptCheckpointInput) {
    requireOverleafBinding(input.binding);
    if (!input.expectedProviderRevision) {
      throw new Error('overleaf_git_expected_revision_missing');
    }
    const configuration = await this.requireConfiguration(input.binding.bindingId);
    const result = await this.transport.fetchCheckpoint(
      input.binding.bindingId,
      configuration.remoteUrl,
      configuration.credentialRef,
      input.expectedProviderRevision,
      input.rootDocument,
    );
    return {
      providerRevision: result.workspaceRevision,
      cursor: result.workspaceRevision,
      revisionEnvelopeDigest: result.revisionEnvelopeDigest,
    };
  }

  private async requireConfiguration(bindingId: string) {
    const configuration = await this.configuration.getOverleafGitBindingConfiguration(bindingId);
    if (!configuration) throw new Error('overleaf_git_binding_configuration_missing');
    return configuration;
  }

  private requireCredentialWorkspaceId(credentialRef: string) {
    if (credentialRef === OVERLEAF_LEGACY_UNOWNED_CREDENTIAL_REF) return credentialRef;
    const workspaceId = overleafCredentialWorkspaceId(credentialRef);
    if (!workspaceId) throw new Error('overleaf_credential_reference_invalid');
    return workspaceId;
  }
}
