import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  LectureOverleafSourceError,
  LectureOverleafSourceService,
} from '../src/main/lecture-overleaf-source-service';
import type { ManuscriptWorkspaceSnapshot } from '../src/shared/manuscript-workspace-contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-08-14T00:00:00.000Z';
const PROVIDER_REVISION = 'a'.repeat(40);

function item(
  manuscriptId: string,
  connection: ManuscriptWorkspaceSnapshot['manuscripts'][number]['connection'] = null,
): ManuscriptWorkspaceSnapshot['manuscripts'][number] {
  return {
    manuscript: {
      schemaVersion: 1,
      id: manuscriptId,
      projectId: PROJECT_ID,
      title: 'Imported Overleaf source',
      rootDocument: 'paper/main.tex',
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    },
    connection,
    canDeleteUnconfigured: connection === null,
  };
}

function connection(manuscriptId: string, withCheckpoint: boolean) {
  const bindingId = randomUUID();
  const checkpointId = randomUUID();
  return {
    bindingId,
    checkpointId,
    value: {
      binding: {
        schemaVersion: 1 as const,
        bindingId,
        projectId: PROJECT_ID,
        manuscriptId,
        providerId: 'overleaf_git',
        capabilitiesSnapshot: {
          schemaVersion: 1 as const,
          interactionModes: ['checkpoint_pull' as const],
          revisionTopology: 'linear' as const,
          conditionalPublish: false,
          providerHistory: true,
          presence: false,
          comments: false,
          trackChanges: false,
          serverCompile: true,
          reviewMetadataRoundTrip: 'unsupported' as const,
        },
        authority: 'gosu' as const,
        enabled: true,
        version: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
      providerDisplayName: 'Overleaf Git',
      workspaceUrl: null,
      lifecycle: 'ready' as const,
      syncState: 'provider_ahead' as const,
      anchor: {
        schemaVersion: 1 as const,
        bindingId,
        generation: 0,
        lastCommonRevision: null,
        providerRevision: null,
        gosuRevision: null,
        updatedAt: NOW,
      },
      lastObservedProviderRevision: PROVIDER_REVISION,
      lastObservedAt: NOW,
      lastFailureCode: null,
      lastCheckpoint: withCheckpoint
        ? {
            schemaVersion: 1 as const,
            checkpointId,
            bindingId,
            projectId: PROJECT_ID,
            manuscriptId,
            providerId: 'overleaf_git',
            direction: 'fetch' as const,
            sourceAuthority: 'provider' as const,
            sourceRevision: PROVIDER_REVISION,
            gosuRevision: null,
            providerRevision: PROVIDER_REVISION,
            cursor: PROVIDER_REVISION,
            revisionEnvelopeDigest: `sha256:${'b'.repeat(64)}`,
            rootDocument: 'paper/main.tex',
            baseCheckpointId: null,
            actorId: randomUUID(),
            observedAt: NOW,
          }
        : null,
    },
  };
}

function snapshot(
  entries: ManuscriptWorkspaceSnapshot['manuscripts'],
): ManuscriptWorkspaceSnapshot {
  return { schemaVersion: 1, projectId: PROJECT_ID, providers: [], manuscripts: entries };
}

function fixture(
  options: { connectFails?: boolean; captureReady?: boolean; invalidLinkedSnapshot?: boolean } = {},
) {
  const manuscriptId = randomUUID();
  const linked = connection(manuscriptId, false);
  const captured = connection(manuscriptId, true);
  // A fetched checkpoint retains the same binding identity as the linked snapshot.
  captured.value.binding = linked.value.binding;
  captured.value.anchor = linked.value.anchor;
  captured.value.lastCheckpoint = captured.value.lastCheckpoint
    ? { ...captured.value.lastCheckpoint, bindingId: linked.bindingId }
    : null;
  const list = vi.fn(async () => snapshot([]));
  const create = vi.fn(async () => snapshot([item(manuscriptId)]));
  const connectOverleafGit = vi.fn(async () => {
    if (options.connectFails) {
      throw Object.assign(new Error('auth'), { code: 'overleaf_git_auth_required' });
    }
    return snapshot([
      item(
        manuscriptId,
        options.invalidLinkedSnapshot
          ? { ...linked.value, lastObservedProviderRevision: null }
          : linked.value,
      ),
    ]);
  });
  const fetchCheckpoint = vi.fn(async () =>
    snapshot([item(manuscriptId, options.captureReady === false ? linked.value : captured.value)]),
  );
  const deleteUnconfigured = vi.fn(async () => snapshot([]));
  const service = new LectureOverleafSourceService({
    list,
    create,
    connectOverleafGit,
    fetchCheckpoint,
    deleteUnconfigured,
  });
  return {
    service,
    manuscriptId,
    linked,
    captured,
    list,
    create,
    connectOverleafGit,
    fetchCheckpoint,
    deleteUnconfigured,
  };
}

const command = {
  projectId: PROJECT_ID,
  title: 'Imported Overleaf source',
  rootDocument: 'paper/main.tex',
  remoteUrl: 'https://git.overleaf.com/0123456789abcdef01234567',
  accessToken: 'one-time-private-token',
};

describe('Lecture Overleaf source orchestration', () => {
  it('returns one exact ready manuscript candidate without URL or credential fields', async () => {
    const test = fixture();
    const receipt = await test.service.importOverleaf(command);

    expect(receipt.selection).toEqual({ projectId: PROJECT_ID, manuscriptId: test.manuscriptId });
    expect(receipt.candidate).toMatchObject({
      availability: 'ready',
      checkpointId: test.captured.checkpointId,
      providerRevision: PROVIDER_REVISION,
      observedAt: NOW,
    });
    expect(test.connectOverleafGit).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      manuscriptId: test.manuscriptId,
      expectedManuscriptVersion: 1,
      providerId: 'overleaf_git',
      remoteUrl: command.remoteUrl,
      accessToken: command.accessToken,
    });
    expect(JSON.stringify(receipt)).not.toContain(command.accessToken);
    expect(JSON.stringify(receipt)).not.toContain('git.overleaf.com');
    expect(test.deleteUnconfigured).not.toHaveBeenCalled();
  });

  it('deletes only the new unconfigured setup record when connection fails', async () => {
    const test = fixture({ connectFails: true });

    await expect(test.service.importOverleaf(command)).rejects.toMatchObject({
      code: 'overleaf_git_auth_required',
    });
    expect(test.deleteUnconfigured).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      manuscriptId: test.manuscriptId,
      expectedVersion: 1,
    });
    expect(test.fetchCheckpoint).not.toHaveBeenCalled();
  });

  it('preserves the linked Manuscript and credential provenance when capture is not ready', async () => {
    const test = fixture({ captureReady: false });

    await expect(test.service.importOverleaf(command)).rejects.toEqual(
      new LectureOverleafSourceError('lecture_overleaf_source_not_ready'),
    );
    expect(test.deleteUnconfigured).not.toHaveBeenCalled();
  });

  it('does not request setup deletion when the connector committed a binding but returned a bad view', async () => {
    const test = fixture({ invalidLinkedSnapshot: true });

    await expect(test.service.importOverleaf(command)).rejects.toEqual(
      new LectureOverleafSourceError('lecture_overleaf_source_conflict'),
    );
    expect(test.deleteUnconfigured).not.toHaveBeenCalled();
    expect(test.fetchCheckpoint).not.toHaveBeenCalled();
  });

  it('rejects unsafe root documents before invoking the Manuscript workflow', async () => {
    const test = fixture();

    await expect(
      test.service.importOverleaf({ ...command, rootDocument: '../private.tex' }),
    ).rejects.toBeDefined();
    expect(test.list).not.toHaveBeenCalled();
    expect(test.create).not.toHaveBeenCalled();
  });
});
