import { describe, expect, it } from 'vitest';
import {
  connectorRegistry,
  createManuscriptWorkspaceAdapterRegistry,
  createOverleafExport,
  deriveManuscriptSyncState,
  inspectObsidianMarkdown,
  overleafGitManuscriptWorkspaceDescriptor,
  type ManuscriptWorkspaceAdapter,
} from '../src/index';

describe('integration capability boundaries', () => {
  it('keeps Overleaf export-only and Zotero read-only', () => {
    expect(connectorRegistry.overleaf.capabilities).toMatchObject({
      read: false,
      write: false,
      export: true,
    });
    expect(connectorRegistry.zotero.capabilities).toMatchObject({
      read: true,
      write: false,
      attachments: false,
    });
  });

  it('extracts local wikilinks without retaining note content', () => {
    const metadata = inspectObsidianMarkdown(
      '---\ntags: [research, local]\n---\nSee [[Trial 8]] and [[Metric v3|metric]].',
    );
    expect(metadata.frontmatter.tags).toEqual(['research', 'local']);
    expect(metadata.wikilinks).toEqual(['Trial 8', 'Metric v3']);
    expect(JSON.stringify(metadata)).not.toContain('See');
  });

  it('binds Overleaf exports to a full commit and archive hash', () => {
    const result = createOverleafExport({
      repository: 'gli-minsuk-shin/GOSU',
      commitSha: 'a'.repeat(40),
      rootDocument: 'paper/main.tex',
      zip: new Uint8Array([1, 2, 3]),
    });
    expect(result.manifest.direction).toBe('one_way');
    expect(result.manifest.archiveSha256).toHaveLength(64);
  });

  it('describes Overleaf Git as a checkpoint adapter with external-only realtime editing', () => {
    expect(overleafGitManuscriptWorkspaceDescriptor).toMatchObject({
      providerId: 'overleaf_git',
      workspaceKind: 'remote_git_checkpoint',
      collaborationModel: 'checkpoint',
      capabilities: {
        interactionModes: ['checkpoint_pull', 'external_realtime_editor'],
        presence: false,
        comments: false,
        trackChanges: false,
        reviewMetadataRoundTrip: 'unsupported',
      },
    });
    expect(overleafGitManuscriptWorkspaceDescriptor.capabilities.interactionModes).not.toContain(
      'embedded_realtime_editor',
    );
    expect(overleafGitManuscriptWorkspaceDescriptor.capabilities.interactionModes).not.toContain(
      'checkpoint_publish',
    );
  });

  it('registers a fake local checkpoint store without claiming deferred editor ports', async () => {
    const nativeAdapter: ManuscriptWorkspaceAdapter = {
      descriptor: {
        schemaVersion: 1,
        providerId: 'native_fixture',
        displayName: 'Native fixture',
        workspaceKind: 'local_native',
        collaborationModel: 'checkpoint',
        capabilities: {
          schemaVersion: 1,
          interactionModes: ['checkpoint_pull'],
          revisionTopology: 'multi_version',
          conditionalPublish: false,
          providerHistory: true,
          presence: false,
          comments: false,
          trackChanges: false,
          serverCompile: false,
          reviewMetadataRoundTrip: 'unsupported',
        },
        unsupportedMetadata: [],
        limitations: [],
      },
      inspect: async () => ({
        providerRevision: 'native-revision-1',
        cursor: 'native-cursor-1',
        observedAt: '2026-08-11T01:00:00.000Z',
      }),
      fetchCheckpoint: async () => ({
        providerRevision: 'native-revision-1',
        cursor: 'native-cursor-1',
        revisionEnvelopeDigest: `sha256:${'a'.repeat(64)}`,
      }),
    };
    const registry = createManuscriptWorkspaceAdapterRegistry([nativeAdapter]);
    const binding = {
      schemaVersion: 1,
      bindingId: 'binding-1',
      projectId: 'project-1',
      manuscriptId: 'manuscript-1',
      providerId: 'native_fixture',
      capabilitiesSnapshot: nativeAdapter.descriptor.capabilities,
      authority: 'provider',
      enabled: true,
      version: 1,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    } as const;

    expect(registry.descriptors().map(({ providerId }) => providerId)).toEqual(['native_fixture']);
    await expect(registry.adapter('native_fixture').inspect(binding)).resolves.toMatchObject({
      providerRevision: 'native-revision-1',
    });
    await expect(
      registry.adapter('native_fixture').fetchCheckpoint?.({
        binding,
        expectedProviderRevision: 'native-revision-1',
        rootDocument: 'paper/main.tex',
        idempotencyKey: 'project-1:manuscript-1:fetch:native-revision-1:gosu-revision-1',
        fencingToken: 1,
      }),
    ).resolves.toMatchObject({
      providerRevision: 'native-revision-1',
      cursor: 'native-cursor-1',
    });
  });

  it('derives sync state without resolving concurrent changes', () => {
    const anchor = {
      schemaVersion: 1,
      bindingId: 'binding-1',
      generation: 3,
      lastCommonRevision: 'common-1',
      providerRevision: 'provider-1',
      gosuRevision: 'gosu-1',
      updatedAt: '2026-08-11T00:00:00.000Z',
    } as const;
    const state = (providerRevision: string, gosuRevision: string) =>
      deriveManuscriptSyncState({
        linked: true,
        lifecycle: 'ready',
        anchor,
        providerRevision,
        gosuRevision,
      });

    expect(state('provider-1', 'gosu-1')).toBe('in_sync');
    expect(state('provider-2', 'gosu-1')).toBe('provider_ahead');
    expect(state('provider-1', 'gosu-2')).toBe('gosu_ahead');
    expect(state('provider-2', 'gosu-2')).toBe('diverged');
    expect(
      deriveManuscriptSyncState({
        linked: true,
        lifecycle: 'ready',
        anchor: { ...anchor, lastCommonRevision: null },
        providerRevision: 'same-opaque-id',
        gosuRevision: 'same-opaque-id',
      }),
    ).toBe('diverged');
    expect(
      deriveManuscriptSyncState({
        linked: true,
        lifecycle: 'blocked',
        anchor,
        providerRevision: 'provider-1',
        gosuRevision: 'gosu-1',
      }),
    ).toBe('blocked');
  });
});
