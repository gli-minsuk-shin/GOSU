import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import Database from 'better-sqlite3-multiple-ciphers';
import { app, safeStorage } from 'electron';
import {
  ManuscriptCheckpointV1Schema,
  ManuscriptSyncAnchorV1Schema,
  ManuscriptWorkspaceBindingV1Schema,
  type ModelInvocation,
} from '@gosu/contracts';

import { EXPERIMENT_EVALUATION_CODE_POLICY_HASH } from '../../src/main/experiment-evaluation-code-policy';
import { LocalDatabase } from '../../src/main/local-database';
import { ExperimentWorkspaceStorageError } from '../../src/main/experiment-workspace-storage-error';
import { buildLectureLatexDocument } from '../../src/main/lecture-latex-source';
import {
  LECTURE_STUDIO_AUTHORING_POLICY_VERSION,
  LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS,
} from '../../src/main/lecture-studio-prompt';
import {
  LectureExternalSourceManifestAuthenticator,
  LectureExternalSourceService,
} from '../../src/main/lecture-external-source-service';
import { LectureStudioService } from '../../src/main/lecture-studio-service';
import { LectureStudioStorageError } from '../../src/main/lecture-studio-storage-error';
import { literatureFingerprint } from '../../src/main/literature-crossref';
import { LiteratureStorageError } from '../../src/main/literature-storage-error';
import { WorkspaceService } from '../../src/main/workspace-service';
import { WorkspaceDataRecoveryError } from '../../src/main/workspace-storage-error';
import type {
  ProjectChatAttempt,
  ProjectChatMessage,
} from '../../src/shared/project-chat-contracts';
import {
  EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION,
  LECTURE_STUDIO_MAX_RETAINED_FAILURE_ATTEMPTS,
  LECTURE_STUDIO_MAX_STUDIOS,
  LECTURE_STUDIO_MAX_TRASHED_STUDIOS,
  type LectureStudio,
  type EmptyLectureStudioTrashInput,
  type LectureStudioAttachmentSnapshot,
  type LectureStudioFigureAsset,
  type LectureStudioMessage,
  type LectureStudioRevision,
  type LectureStudioRevisionV4,
} from '../../src/shared/lecture-studio-contracts';
import type { LectureStudioAttachmentCard } from '../../src/shared/lecture-studio-attachment-contracts';

type LectureStudioRevisionV2 = Extract<LectureStudioRevision, { schemaVersion: 2 }>;
type LectureStudioRevisionV3 = Extract<LectureStudioRevision, { schemaVersion: 3 }>;
type LectureStudioRevisionV1 = Extract<LectureStudioRevision, { schemaVersion: 1 }>;
import {
  EXPERIMENT_MAX_IDEAS_PER_PROJECT,
  EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT,
  type ExperimentIdea,
  type ExperimentLoggingTemplate,
  type ExperimentMetricPoint,
  type ExperimentRun,
} from '../../src/shared/experiment-workspace-contracts';
import type {
  ExperimentEvaluationDraft,
  ExperimentEvaluationMessage,
  ExperimentEvaluationProfile,
  ExperimentEvaluationRevision,
  ExperimentEvaluationSession,
} from '../../src/shared/experiment-evaluation-contracts';
import {
  PROJECT_CHAT_MAX_BRANCH_DEPTH,
  PROJECT_CHAT_MAX_BRANCH_MESSAGES,
  PROJECT_CHAT_RESEARCH_NOTE_SAVE_ABANDONED_SECTION,
  PROJECT_CHAT_RESEARCH_NOTE_SAVE_PENDING_SECTION,
} from '../../src/shared/project-chat-contracts';
import {
  LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT,
  type LiteratureAiProvenance,
  type LiteratureDiscoveryCoverage,
  type LiteratureDiscoveryTier,
  type LiteratureRankingSignals,
  type LiteratureSearchRun,
} from '../../src/shared/literature-contracts';
import type {
  ProjectRecord,
  WorkspaceOperation,
  WorkspaceSnapshot,
} from '../../src/shared/workspace-contracts';
import {
  ManuscriptRecordSchema,
  type StoredManuscriptWorkspaceConnection,
} from '../../src/shared/manuscript-workspace-contracts';

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fixture(revision: number, operationId: string, createdAt: string) {
  const project: ProjectRecord = {
    id: randomUUID(),
    name: `Persistence fixture ${revision}`,
    slug: `persistence-fixture-${revision}`,
    version: 1,
    createdAt,
    updatedAt: createdAt,
  };
  const state: WorkspaceSnapshot = {
    schemaVersion: 1,
    revision,
    projects: [project],
    tasks: [],
    objectives: [],
  };
  const operation: WorkspaceOperation = {
    schemaVersion: 1,
    workspaceRevision: revision,
    id: operationId,
    idempotencyKey: operationId,
    scope: `workspace:${project.id}:project:create`,
    projectId: project.id,
    entityType: 'project',
    entityId: project.id,
    commandType: 'project.create',
    baseVersion: null,
    createdAt,
    payload: { name: project.name, slug: project.slug },
  };
  return { state, operation };
}

async function verifyWorkspaceTrashPurge(rootUserData: string, fixedTimestamp: string) {
  const originalUserData = app.getPath('userData');
  const trashUserData = join(rootUserData, 'trash-purge-fixture');
  mkdirSync(trashUserData, { recursive: true });
  app.setPath('userData', trashUserData);
  const database = new LocalDatabase();
  try {
    database.open();
    const workspace = new WorkspaceService({
      load: () => database.loadWorkspaceState(),
      commit: (state, operation) => database.commitWorkspaceState(state, operation),
      purgeTrash: (state, operation, receipt) =>
        database.purgeWorkspaceTrash(state, operation, receipt),
      loadTrashPurgeReceipt: (idempotencyKey) =>
        database.loadWorkspaceTrashPurgeReceipt(idempotencyKey),
      pendingChanges: () => database.pendingWorkspaceChanges(),
      pendingSummary: () => database.pendingWorkspaceSummary(),
    });
    const activeProject = await workspace.createProject({ name: 'Active purge fixture' });
    const purgedProject = await workspace.createProject({ name: 'Trashed purge fixture' });
    const purgedManuscriptId = randomUUID();
    const purgedBindingId = randomUUID();
    const purgedProviderRevision = 'd'.repeat(40);
    const purgedManuscript = ManuscriptRecordSchema.parse({
      schemaVersion: 1,
      id: purgedManuscriptId,
      projectId: purgedProject.id,
      title: 'Trashed manuscript',
      rootDocument: 'paper/main.tex',
      version: 1,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    });
    invariant(database.createManuscript(purgedManuscript), 'trash_purge_manuscript_fixture_failed');
    const purgedBinding = ManuscriptWorkspaceBindingV1Schema.parse({
      schemaVersion: 1,
      bindingId: purgedBindingId,
      projectId: purgedProject.id,
      manuscriptId: purgedManuscriptId,
      providerId: 'overleaf_git',
      capabilitiesSnapshot: overleafCheckpointCapabilities(),
      authority: 'provider',
      enabled: true,
      version: 1,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    });
    invariant(
      database.connectOverleafGitWorkspace(
        {
          binding: purgedBinding,
          anchor: ManuscriptSyncAnchorV1Schema.parse({
            schemaVersion: 1,
            bindingId: purgedBindingId,
            generation: 0,
            lastCommonRevision: null,
            providerRevision: null,
            gosuRevision: null,
            updatedAt: fixedTimestamp,
          }),
          lifecycle: 'ready',
          lastObservedProviderRevision: purgedProviderRevision,
          lastObservedAt: fixedTimestamp,
          lastFailureCode: null,
        },
        {
          bindingId: purgedBindingId,
          remoteUrl: 'https://git@git.overleaf.com/0123456789abcdef01234567',
          workspaceId: '0123456789abcdef01234567',
          webUrl: 'https://www.overleaf.com/project/0123456789abcdef01234567',
          credentialRef: 'overleaf-git:0123456789abcdef01234567',
        },
        1,
      ),
      'trash_purge_manuscript_binding_fixture_failed',
    );
    database.appendManuscriptCheckpoint(
      ManuscriptCheckpointV1Schema.parse({
        schemaVersion: 1,
        checkpointId: randomUUID(),
        bindingId: purgedBindingId,
        projectId: purgedProject.id,
        manuscriptId: purgedManuscriptId,
        providerId: 'overleaf_git',
        direction: 'fetch',
        sourceAuthority: 'provider',
        sourceRevision: purgedProviderRevision,
        gosuRevision: null,
        providerRevision: purgedProviderRevision,
        cursor: purgedProviderRevision,
        revisionEnvelopeDigest: `sha256:${'e'.repeat(64)}`,
        rootDocument: purgedManuscript.rootDocument,
        baseCheckpointId: null,
        actorId: randomUUID(),
        observedAt: fixedTimestamp,
      }),
    );
    database.cache('research-notes-project', purgedProject.id, { projectId: purgedProject.id });
    const connectionId = randomUUID();
    invariant(
      database.createSshConnection({
        schemaVersion: 1,
        id: connectionId,
        label: 'Purge fixture server',
        hostAlias: 'purge-fixture',
        version: 1,
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      }),
      'trash_purge_connection_fixture_failed',
    );
    const purgedGrantId = randomUUID();
    invariant(
      database.createSshWorkspaceGrant({
        schemaVersion: 1,
        id: purgedGrantId,
        projectId: purgedProject.id,
        connectionId,
        canonicalRoot: '/workspace/purge-fixture',
        permissionMode: 'diagnostics',
        version: 1,
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      }),
      'trash_purge_ssh_grant_fixture_failed',
    );
    const preservedIdea: ExperimentIdea = {
      schemaVersion: 1,
      id: randomUUID(),
      projectId: purgedProject.id,
      parentIdeaId: null,
      title: 'Preserved failed experiment idea',
      hypothesis: 'Trash cleanup must not erase research provenance.',
      phase: 'Recovery',
      outcome: 'failed',
      resultSummary: 'Fixture result retained for audit.',
      version: 1,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
      completedAt: fixedTimestamp,
    };
    invariant(
      database.createExperimentIdea(preservedIdea),
      'trash_purge_experiment_idea_fixture_failed',
    );
    const preservedObjectiveId = randomUUID();
    database.appendExperimentMetricPoint({
      schemaVersion: 1,
      id: randomUUID(),
      projectId: purgedProject.id,
      ideaId: preservedIdea.id,
      objectiveId: preservedObjectiveId,
      objectiveVersion: 1,
      metricKey: 'audit-score',
      metricDisplayName: 'Audit score',
      direction: 'maximize',
      unit: null,
      aggregation: 'last',
      evaluatorHash: 'evaluator-audit-fixture',
      datasetHash: 'dataset-audit-fixture',
      holdoutHash: null,
      baseline: null,
      target: null,
      value: 0,
      source: 'manual',
      trialId: 'trash-preservation-trial',
      recordedAt: fixedTimestamp,
    });
    const preservedTemplate: ExperimentLoggingTemplate = {
      schemaVersion: 1,
      id: randomUUID(),
      projectId: purgedProject.id,
      version: 1,
      previousRevisionId: null,
      systemFields: [
        'schema_version',
        'template_version',
        'objective_version',
        'occurred_at',
        'event_type',
        'sequence',
        'run_id',
        'trial_id',
        'status',
        'server_label',
      ],
      customFields: [],
      templateHash: 'f'.repeat(64),
      createdAt: fixedTimestamp,
    };
    invariant(
      database.appendExperimentLoggingTemplate(preservedTemplate, 0)?.id === preservedTemplate.id,
      'trash_purge_experiment_template_fixture_failed',
    );
    const preservedRun: ExperimentRun = {
      schemaVersion: 1,
      id: randomUUID(),
      projectId: purgedProject.id,
      ideaId: preservedIdea.id,
      title: 'Preserved failed run',
      status: 'failed',
      mode: 'comparable',
      serverLabel: 'Purge fixture server',
      trialId: 'trash-preservation-trial',
      objectiveId: preservedObjectiveId,
      objectiveVersion: 1,
      loggingTemplate: {
        revisionId: preservedTemplate.id,
        version: preservedTemplate.version,
        systemFields: preservedTemplate.systemFields,
        customFields: preservedTemplate.customFields,
        templateHash: preservedTemplate.templateHash,
      },
      progressCurrent: null,
      progressTotal: null,
      currentStep: 'Failed before completion',
      latestMetric: null,
      logReference: null,
      processExitCode: null,
      processDurationMs: null,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
      startedAt: fixedTimestamp,
      completedAt: fixedTimestamp,
      version: 1,
    };
    invariant(
      database.createExperimentRun(preservedRun) &&
        database.bindExperimentRunExecution({
          projectId: purgedProject.id,
          runId: preservedRun.id,
          workspaceGrantId: purgedGrantId,
        }) &&
        database.stageExperimentRunExecutionIntent({
          projectId: purgedProject.id,
          runId: preservedRun.id,
          workspaceGrantId: purgedGrantId,
          grantVersion: 1,
          connectionId,
          connectionVersion: 1,
          canonicalRoot: '/workspace/purge-fixture',
          canonicalRootHash: createHash('sha256')
            .update('/workspace/purge-fixture', 'utf8')
            .digest('hex'),
          policyVersion: 1,
          executionPolicyHash: '2'.repeat(64),
          intentHash: '1'.repeat(64),
          workspaceSubdirectory: null,
          relativePath: 'logs/preserved.jsonl',
          createdAt: fixedTimestamp,
        }),
      'trash_purge_experiment_run_fixture_failed',
    );
    await workspace.trashProject({
      projectId: purgedProject.id,
      expectedVersion: purgedProject.version,
    });
    const idempotencyKey = randomUUID();
    const receipt = await workspace.emptyTrash({
      expectedWorkspaceRevision: (await workspace.snapshot()).revision,
      idempotencyKey,
      confirmation: 'EMPTY TRASH',
    });
    invariant(
      (await workspace.snapshot()).projects.every((project) => project.id === activeProject.id),
      'trash_purge_removed_non_trash_project',
    );
    invariant(
      database.get('research-notes-project', purgedProject.id) === null,
      'trash_purge_research_notes_link_not_detached',
    );
    invariant(
      database.listSshWorkspaceGrants(purgedProject.id).length === 0,
      'trash_purge_ssh_grant_not_detached',
    );
    invariant(
      database.listExperimentIdeas(purgedProject.id).some(({ id }) => id === preservedIdea.id) &&
        database
          .listExperimentMetricPoints(purgedProject.id)
          .some(({ trialId }) => trialId === preservedRun.trialId) &&
        database.getExperimentRun(purgedProject.id, preservedRun.id)?.status === 'failed' &&
        database.getExperimentRunExecutionIntent(purgedProject.id, preservedRun.id)?.intentHash ===
          '1'.repeat(64) &&
        database.getExperimentRunExecutionIntent(purgedProject.id, preservedRun.id)
          ?.canonicalRoot === '/workspace/purge-fixture',
      'trash_purge_erased_experiment_provenance',
    );
    invariant(
      database.listManuscripts(purgedProject.id).length === 0 &&
        database.getOverleafGitBindingConfiguration(purgedBindingId) === null &&
        database.latestManuscriptCheckpoint(purgedBindingId) === null,
      'trash_purge_manuscript_workspace_not_detached',
    );
    const queuedArtifactPurges = database.listManuscriptArtifactPurgeQueue([purgedProject.id]);
    invariant(
      queuedArtifactPurges.length === 1 &&
        queuedArtifactPurges[0]?.bindingId === purgedBindingId &&
        queuedArtifactPurges[0].projectId === purgedProject.id &&
        queuedArtifactPurges[0].providerId === 'overleaf_git' &&
        queuedArtifactPurges[0].queuedAt === receipt.completedAt &&
        database.listManuscriptArtifactPurgeQueue([activeProject.id]).length === 0,
      'trash_purge_artifact_cleanup_was_not_queued',
    );
    invariant(
      database.listManuscriptArtifactPurgeQueue(undefined, {
        queuedAt: queuedArtifactPurges[0]!.queuedAt,
        bindingId: queuedArtifactPurges[0]!.bindingId,
      }).length === 0,
      'manuscript_artifact_purge_cursor_did_not_advance',
    );
    const queuedCredentialCleanup = database.listManuscriptCredentialCleanupQueue();
    invariant(
      queuedCredentialCleanup.length === 1 &&
        queuedCredentialCleanup[0]?.providerId === 'overleaf_git' &&
        queuedCredentialCleanup[0].credentialRef === 'overleaf-git:0123456789abcdef01234567' &&
        queuedCredentialCleanup[0].queuedAt === receipt.completedAt &&
        !database.hasEnabledManuscriptCredentialReference(
          'overleaf_git',
          queuedCredentialCleanup[0].credentialRef,
        ),
      'trash_purge_credential_cleanup_was_not_queued',
    );
    invariant(
      database.listManuscriptCredentialCleanupQueue({
        queuedAt: queuedCredentialCleanup[0]!.queuedAt,
        providerId: queuedCredentialCleanup[0]!.providerId,
        credentialRef: queuedCredentialCleanup[0]!.credentialRef,
      }).length === 0,
      'manuscript_credential_cleanup_cursor_did_not_advance',
    );
    let invalidArtifactPurgeFilterRejected = false;
    try {
      database.listManuscriptArtifactPurgeQueue(['not-a-project-id']);
    } catch {
      invalidArtifactPurgeFilterRejected = true;
    }
    invariant(
      invalidArtifactPurgeFilterRejected,
      'manuscript_artifact_purge_filter_was_not_validated',
    );
    invariant(
      database.loadWorkspaceTrashPurgeReceipt(idempotencyKey)?.operationId === receipt.operationId,
      'trash_purge_receipt_not_durable',
    );
    invariant(
      (
        await workspace.emptyTrash({
          expectedWorkspaceRevision: 0,
          idempotencyKey,
          confirmation: 'EMPTY TRASH',
        })
      ).operationId === receipt.operationId,
      'trash_purge_retry_not_idempotent',
    );
    database.close();
    const reopened = new LocalDatabase();
    try {
      reopened.open();
      invariant(
        reopened.listManuscriptArtifactPurgeQueue()[0]?.bindingId === purgedBindingId,
        'manuscript_artifact_purge_queue_was_not_durable',
      );
      invariant(
        reopened.getExperimentRun(purgedProject.id, preservedRun.id)?.status === 'failed' &&
          reopened.getExperimentRunExecutionIntent(purgedProject.id, preservedRun.id)
            ?.intentHash === '1'.repeat(64),
        'trash_purge_experiment_provenance_was_not_durable',
      );
      invariant(
        reopened.completeManuscriptArtifactPurge(randomUUID()) === false &&
          reopened.completeManuscriptArtifactPurge(purgedBindingId) &&
          reopened.completeManuscriptArtifactPurge(purgedBindingId) === false &&
          reopened.listManuscriptArtifactPurgeQueue().length === 0,
        'manuscript_artifact_purge_completion_was_not_exact_or_idempotent',
      );
      invariant(
        reopened.listManuscriptCredentialCleanupQueue()[0]?.credentialRef ===
          'overleaf-git:0123456789abcdef01234567',
        'manuscript_credential_cleanup_queue_was_not_durable',
      );
      invariant(
        reopened.completeManuscriptCredentialCleanup(
          'overleaf_git',
          'overleaf-git:111111111111111111111111',
        ) === false &&
          reopened.completeManuscriptCredentialCleanup(
            'overleaf_git',
            'overleaf-git:0123456789abcdef01234567',
          ) &&
          reopened.completeManuscriptCredentialCleanup(
            'overleaf_git',
            'overleaf-git:0123456789abcdef01234567',
          ) === false &&
          reopened.listManuscriptCredentialCleanupQueue().length === 0,
        'manuscript_credential_cleanup_completion_was_not_exact_or_idempotent',
      );
    } finally {
      reopened.close();
    }
  } finally {
    database.close();
    app.setPath('userData', originalUserData);
  }
}

function overleafCheckpointCapabilities() {
  return {
    schemaVersion: 1 as const,
    interactionModes: ['checkpoint_pull' as const, 'external_realtime_editor' as const],
    revisionTopology: 'linear' as const,
    conditionalPublish: false,
    providerHistory: true,
    presence: false,
    comments: false,
    trackChanges: false,
    serverCompile: false,
    reviewMetadataRoundTrip: 'unsupported' as const,
  };
}

function verifyManuscriptWorkspacePersistence(rootUserData: string, fixedTimestamp: string) {
  const originalUserData = app.getPath('userData');
  const manuscriptUserData = join(rootUserData, 'manuscript-workspace-fixture');
  mkdirSync(manuscriptUserData, { recursive: true });
  app.setPath('userData', manuscriptUserData);
  const projectId = randomUUID();
  const manuscriptId = randomUUID();
  const bindingId = randomUUID();
  const providerRevision = 'a'.repeat(40);
  const checkpointId = randomUUID();
  const manuscript = ManuscriptRecordSchema.parse({
    schemaVersion: 1,
    id: manuscriptId,
    projectId,
    title: 'Persistence manuscript',
    rootDocument: 'paper/main.tex',
    version: 1,
    createdAt: fixedTimestamp,
    updatedAt: fixedTimestamp,
  });
  const binding = ManuscriptWorkspaceBindingV1Schema.parse({
    schemaVersion: 1,
    bindingId,
    projectId,
    manuscriptId,
    providerId: 'overleaf_git',
    capabilitiesSnapshot: overleafCheckpointCapabilities(),
    authority: 'provider',
    enabled: true,
    version: 1,
    createdAt: fixedTimestamp,
    updatedAt: fixedTimestamp,
  });
  const connection: StoredManuscriptWorkspaceConnection = {
    binding,
    anchor: ManuscriptSyncAnchorV1Schema.parse({
      schemaVersion: 1,
      bindingId,
      generation: 0,
      lastCommonRevision: null,
      providerRevision: null,
      gosuRevision: 'b'.repeat(40),
      updatedAt: fixedTimestamp,
    }),
    lifecycle: 'ready',
    lastObservedProviderRevision: providerRevision,
    lastObservedAt: fixedTimestamp,
    lastFailureCode: null,
  };
  const checkpoint = ManuscriptCheckpointV1Schema.parse({
    schemaVersion: 1,
    checkpointId,
    bindingId,
    projectId,
    manuscriptId,
    providerId: 'overleaf_git',
    direction: 'fetch',
    sourceAuthority: 'provider',
    sourceRevision: providerRevision,
    gosuRevision: 'b'.repeat(40),
    providerRevision,
    cursor: providerRevision,
    revisionEnvelopeDigest: `sha256:${'c'.repeat(64)}`,
    rootDocument: manuscript.rootDocument,
    baseCheckpointId: null,
    actorId: randomUUID(),
    observedAt: fixedTimestamp,
  });
  const database = new LocalDatabase();
  try {
    database.open();
    const unusedManuscriptId = randomUUID();
    const unusedManuscript = ManuscriptRecordSchema.parse({
      ...manuscript,
      id: unusedManuscriptId,
      title: 'Unused setup manuscript',
    });
    invariant(
      database.createManuscript(unusedManuscript),
      'unused_manuscript_record_insert_failed',
    );
    invariant(
      database.canDeleteUnconfiguredManuscript(projectId, unusedManuscriptId),
      'unused_manuscript_was_not_deletable',
    );
    invariant(
      database.deleteUnconfiguredManuscript(projectId, unusedManuscriptId, 1),
      'unused_manuscript_was_not_deleted',
    );
    invariant(
      database.getManuscript(projectId, unusedManuscriptId) === null,
      'unused_manuscript_delete_was_not_durable',
    );
    invariant(database.createManuscript(manuscript), 'manuscript_record_insert_failed');
    for (const invalidConfiguration of [
      {
        bindingId,
        remoteUrl: 'https://git@git.overleaf.com/0123456789abcdef01234567',
        workspaceId: '0123456789abcdef01234567',
        webUrl: 'https://www.overleaf.com/project/0123456789abcdef01234567',
        credentialRef: 'overleaf-git:111111111111111111111111',
      },
      {
        bindingId,
        remoteUrl: 'https://git@git.overleaf.com/111111111111111111111111',
        workspaceId: '0123456789abcdef01234567',
        webUrl: 'https://www.overleaf.com/project/0123456789abcdef01234567',
        credentialRef: 'overleaf-git:0123456789abcdef01234567',
      },
    ]) {
      let mismatchRejected = false;
      try {
        database.connectOverleafGitWorkspace(connection, invalidConfiguration, 1);
      } catch {
        mismatchRejected = true;
      }
      invariant(mismatchRejected, 'overleaf_workspace_credential_tuple_mismatch_was_not_rejected');
    }
    invariant(
      database.connectOverleafGitWorkspace(
        connection,
        {
          bindingId,
          remoteUrl: 'https://git@git.overleaf.com/0123456789abcdef01234567',
          workspaceId: '0123456789abcdef01234567',
          webUrl: 'https://www.overleaf.com/project/0123456789abcdef01234567',
          credentialRef: 'overleaf-git:0123456789abcdef01234567',
        },
        1,
      ),
      'manuscript_binding_insert_failed',
    );
    invariant(
      database.appendManuscriptCheckpoint(checkpoint).checkpointId === checkpointId,
      'manuscript_checkpoint_insert_failed',
    );
    invariant(
      !database.canDeleteUnconfiguredManuscript(projectId, manuscriptId),
      'provenance_manuscript_was_marked_deletable',
    );
    invariant(
      !database.deleteUnconfiguredManuscript(projectId, manuscriptId, 1),
      'provenance_manuscript_was_deleted',
    );
    invariant(
      database.appendManuscriptCheckpoint({ ...checkpoint, checkpointId: randomUUID() })
        .checkpointId === checkpointId,
      'manuscript_checkpoint_retry_was_not_idempotent',
    );
    const updatedManuscript = ManuscriptRecordSchema.parse({
      ...manuscript,
      title: 'Corrected persistence manuscript',
      rootDocument: 'manuscript/main.tex',
      version: 2,
    });
    invariant(
      database.updateManuscript(updatedManuscript, 1),
      'manuscript_optimistic_update_failed',
    );
    invariant(
      !database.updateManuscript({ ...updatedManuscript, title: 'Stale overwrite' }, 1),
      'manuscript_stale_update_was_not_rejected',
    );
    database.close();

    const keyHex = safeStorage
      .decryptString(readFileSync(join(manuscriptUserData, 'local-key.bin')))
      .trim();
    const legacy = new Database(join(manuscriptUserData, 'gosu.db'));
    try {
      legacy.pragma(`key="x'${keyHex}'"`);
      legacy
        .prepare('update overleaf_git_bindings set remote_url=? where binding_id=?')
        .run('https://git@git.overleaf.com/0123456789abcdef01234567', bindingId);
      legacy.exec(`
        drop trigger manuscript_workspace_connections_identity_insert_guard;
        drop trigger manuscript_workspace_connections_identity_update_guard;
        drop trigger manuscript_checkpoints_identity_insert_guard;
        drop trigger manuscript_artifact_purge_queue_identity_insert_guard;
        drop trigger manuscript_credential_cleanup_identity_insert_guard;
      `);
      legacy.exec('alter table manuscript_workspace_connections drop column provider_id');
      legacy.exec('alter table overleaf_git_bindings drop column credential_ref');
    } finally {
      legacy.close();
    }

    const reopened = new LocalDatabase();
    reopened.open();
    const restoredManuscript = reopened.listManuscripts(projectId)[0];
    invariant(restoredManuscript?.id === manuscriptId, 'manuscript_record_was_not_restored');
    invariant(
      restoredManuscript.title === 'Corrected persistence manuscript' &&
        restoredManuscript.rootDocument === 'manuscript/main.tex' &&
        restoredManuscript.version === 2,
      'manuscript_update_was_not_restored',
    );
    invariant(
      reopened.getManuscriptWorkspaceConnection(projectId, manuscriptId)?.binding.bindingId ===
        bindingId,
      'manuscript_binding_was_not_restored',
    );
    invariant(
      reopened.getOverleafGitBindingConfiguration(bindingId)?.workspaceId ===
        '0123456789abcdef01234567' &&
        reopened.getOverleafGitBindingConfiguration(bindingId)?.remoteUrl ===
          'https://git.overleaf.com/0123456789abcdef01234567' &&
        reopened.getOverleafGitBindingConfiguration(bindingId)?.credentialRef ===
          'overleaf-git:0123456789abcdef01234567',
      'overleaf_private_binding_was_not_restored',
    );
    invariant(
      reopened.listManuscriptCredentialReferences('overleaf_git').join(',') ===
        'overleaf-git:0123456789abcdef01234567',
      'overleaf_credential_reconciliation_reference_was_not_restored',
    );
    invariant(
      reopened.latestManuscriptCheckpoint(bindingId)?.checkpointId === checkpointId,
      'manuscript_checkpoint_was_not_restored',
    );
    reopened.close();

    const inspected = new Database(join(manuscriptUserData, 'gosu.db'));
    try {
      inspected.pragma(`key="x'${keyHex}'"`);
      const migrated = inspected
        .prepare('select provider_id from manuscript_workspace_connections where binding_id=?')
        .get(bindingId) as { provider_id: string } | undefined;
      invariant(
        migrated?.provider_id === 'overleaf_git',
        'legacy_manuscript_provider_id_was_not_backfilled',
      );
      const crossProjectId = randomUUID();
      const mismatchedBindingId = randomUUID();
      const mismatchedBinding = {
        ...binding,
        bindingId: mismatchedBindingId,
        projectId: crossProjectId,
      };
      let connectionIdentityRejected = false;
      try {
        inspected
          .prepare(
            `insert into manuscript_workspace_connections(
               binding_id,project_id,manuscript_id,provider_id,connection_json,
               binding_version,enabled,created_at,updated_at
             ) values(?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            mismatchedBindingId,
            crossProjectId,
            manuscriptId,
            'overleaf_git',
            JSON.stringify({
              ...connection,
              binding: mismatchedBinding,
              anchor: { ...connection.anchor, bindingId: mismatchedBindingId },
            }),
            1,
            1,
            fixedTimestamp,
            fixedTimestamp,
          );
      } catch {
        connectionIdentityRejected = true;
      }
      invariant(
        connectionIdentityRejected,
        'manuscript_cross_project_connection_identity_was_not_rejected',
      );
      let checkpointIdentityRejected = false;
      try {
        const mismatchedCheckpoint = {
          ...checkpoint,
          checkpointId: randomUUID(),
          projectId: crossProjectId,
          providerRevision: 'f'.repeat(40),
        };
        inspected
          .prepare(
            `insert into manuscript_checkpoints(
               checkpoint_id,binding_id,project_id,manuscript_id,provider_revision,
               checkpoint_json,observed_at
             ) values(?,?,?,?,?,?,?)`,
          )
          .run(
            mismatchedCheckpoint.checkpointId,
            bindingId,
            crossProjectId,
            manuscriptId,
            mismatchedCheckpoint.providerRevision,
            JSON.stringify(mismatchedCheckpoint),
            fixedTimestamp,
          );
      } catch {
        checkpointIdentityRejected = true;
      }
      invariant(
        checkpointIdentityRejected,
        'manuscript_cross_project_checkpoint_identity_was_not_rejected',
      );
      let purgeIdentityRejected = false;
      try {
        inspected
          .prepare(
            `insert into manuscript_artifact_purge_queue(
               binding_id,project_id,provider_id,queued_at
             ) values(?,?,?,?)`,
          )
          .run(bindingId, crossProjectId, 'overleaf_git', fixedTimestamp);
      } catch {
        purgeIdentityRejected = true;
      }
      invariant(purgeIdentityRejected, 'manuscript_cross_project_purge_identity_was_not_rejected');
      let credentialCleanupIdentityRejected = false;
      try {
        inspected
          .prepare(
            `insert into manuscript_credential_cleanup_queue(
               provider_id,credential_ref,queued_at
             ) values(?,?,?)`,
          )
          .run('overleaf_git', 'overleaf-git:111111111111111111111111', fixedTimestamp);
      } catch {
        credentialCleanupIdentityRejected = true;
      }
      invariant(
        credentialCleanupIdentityRejected,
        'manuscript_credential_cleanup_identity_was_not_rejected',
      );
    } finally {
      inspected.close();
    }
  } finally {
    database.close();
    app.setPath('userData', originalUserData);
  }
}

function verifyExperimentEvaluationPersistence(fixedTimestamp: string) {
  const database = new LocalDatabase();
  database.open();
  try {
    const at = (offsetMilliseconds: number) =>
      new Date(Date.parse(fixedTimestamp) + offsetMilliseconds).toISOString();
    const projectId = randomUUID();
    const invocation: ModelInvocation = {
      schemaVersion: 1,
      invocationId: randomUUID(),
      providerId: 'codex',
      requestedModelId: null,
      resolvedModelId: 'fixture-evaluation-model',
      catalogVersion: 'fixture-evaluation-catalog',
      reasoningOptionId: 'high',
      startedAt: fixedTimestamp,
    };
    const draft: ExperimentEvaluationDraft = {
      title: 'Held-out evaluation fixture',
      purpose: 'Verify durable evaluation recipes without treating preview data as evidence.',
      cadence: { unit: 'step', interval: 100, startAt: 0, stopAfter: 1_000 },
      metrics: [
        {
          key: 'validation_loss',
          displayName: 'Validation loss',
          direction: 'minimize',
          unit: null,
          aggregation: 'minimum',
          primary: true,
        },
      ],
      evaluationPolicy: 'Evaluate only against the pinned held-out fixture.',
      experimentRules: ['Never update model weights during evaluation.'],
      loggingFields: [
        {
          key: 'validation_loss',
          label: 'Validation loss',
          type: 'number',
          category: 'metric',
          requiredAt: ['progress', 'summary'],
          unit: null,
        },
      ],
      outputs: [
        {
          kind: 'number',
          title: 'Best validation loss',
          metricKey: 'validation_loss',
          description: 'Minimum validation loss observed in the evaluation window.',
        },
        {
          kind: 'plot',
          title: 'Validation trajectory',
          plotKind: 'line',
          xField: 'step',
          yMetricKeys: ['validation_loss'],
          description: 'Validation loss by training step.',
        },
      ],
      referenceCode: {
        language: 'python',
        fileName: 'evaluate_validation.py',
        content:
          'import math\n\ndef evaluate(values):\n    finite = [value for value in values if math.isfinite(value)]\n    return {"validation_loss": min(finite)}',
      },
      promptTemplate: 'Evaluate the pinned validation records and emit structured JSON.',
      preview: {
        dataKind: 'synthetic-preview',
        evidence: false,
        notice: 'Illustrative values only; no experiment was executed.',
        numbers: [{ label: 'Validation loss', value: 0.5, unit: null }],
        table: {
          title: 'Illustrative checkpoints',
          columns: ['step', 'validation_loss'],
          rows: [
            [100, 0.8],
            [200, 0.5],
          ],
        },
        plot: {
          title: 'Illustrative validation trajectory',
          subtitle: 'Synthetic preview every 100 steps',
          kind: 'line',
          xLabel: 'Step',
          yLabel: 'Validation loss',
          series: [
            {
              name: 'Validation loss',
              points: [
                { x: 100, y: 0.8, label: 'step 100' },
                { x: 200, y: 0.5, label: 'step 200' },
              ],
            },
          ],
        },
        reportMarkdown: '# Synthetic preview\n\nNo experiment was executed.',
      },
    };
    const contentHash = createHash('sha256').update(JSON.stringify(draft), 'utf8').digest('hex');
    const initialSession = (id: string, title: string): ExperimentEvaluationSession => ({
      schemaVersion: 1,
      id,
      projectId,
      title,
      status: 'draft',
      activeAttemptId: null,
      currentRevision: 0,
      acceptedProfileId: null,
      version: 1,
      lastErrorCode: null,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    });
    const userMessage = (
      sessionId: string,
      attemptId: string,
      createdAt: string,
    ): ExperimentEvaluationMessage => ({
      schemaVersion: 1,
      id: randomUUID(),
      sessionId,
      role: 'user',
      status: 'complete',
      content: 'Evaluate every 100 steps and keep the held-out split pinned.',
      attemptId,
      revision: null,
      invocation: null,
      createdAt,
      completedAt: createdAt,
    });
    const assistantMessage = (
      sessionId: string,
      attemptId: string,
      revision: number,
      modelInvocation: ModelInvocation,
      createdAt: string,
    ): ExperimentEvaluationMessage => ({
      schemaVersion: 1,
      id: randomUUID(),
      sessionId,
      role: 'assistant',
      status: 'complete',
      content: 'Prepared a held-out evaluation recipe for review.',
      attemptId,
      revision,
      invocation: modelInvocation,
      createdAt,
      completedAt: createdAt,
    });

    const sessionId = randomUUID();
    invariant(
      database.createExperimentEvaluationSession(
        initialSession(sessionId, 'Evaluation persistence fixture'),
      ),
      'experiment_evaluation_session_create_failed',
    );
    const attemptId = randomUUID();
    const generating = database.beginExperimentEvaluationTurn({
      projectId,
      sessionId,
      expectedVersion: 1,
      attemptId,
      userMessage: userMessage(sessionId, attemptId, at(1_000)),
      updatedAt: at(1_000),
    });
    invariant(
      generating?.status === 'generating' &&
        generating.version === 2 &&
        generating.activeAttemptId === attemptId,
      'experiment_evaluation_turn_begin_failed',
    );
    const revisionId = randomUUID();
    const revision: ExperimentEvaluationRevision = {
      schemaVersion: 1,
      id: revisionId,
      sessionId,
      revision: 1,
      attemptId,
      draft,
      contentHash,
      invocation,
      createdAt: at(2_000),
    };
    const readySession: ExperimentEvaluationSession = {
      ...generating,
      title: draft.title,
      status: 'ready',
      activeAttemptId: null,
      currentRevision: 1,
      acceptedProfileId: null,
      version: 3,
      lastErrorCode: null,
      updatedAt: at(2_000),
    };
    const ready = database.completeExperimentEvaluationTurn({
      session: readySession,
      revision,
      assistantMessage: assistantMessage(sessionId, attemptId, 1, invocation, at(2_000)),
    });
    const readyDetail = database.getExperimentEvaluationSessionDetail(projectId, sessionId);
    invariant(
      ready?.status === 'ready' &&
        ready.currentRevision === 1 &&
        readyDetail?.currentRevision?.contentHash === contentHash &&
        readyDetail.messages.length === 2 &&
        readyDetail.messages[1]?.invocation?.invocationId === invocation.invocationId,
      'experiment_evaluation_turn_completion_was_not_durable',
    );

    const profileId = randomUUID();
    const profile: ExperimentEvaluationProfile = {
      schemaVersion: 1,
      id: profileId,
      projectId,
      name: 'Held-out evaluation recipe',
      sourceSessionId: sessionId,
      sourceRevisionId: revisionId,
      draft,
      contentHash,
      codePolicyHash: EXPERIMENT_EVALUATION_CODE_POLICY_HASH,
      invocation,
      codePath: '/fixture/evaluation-profiles/evaluate_validation.py',
      promptPath: '/fixture/evaluation-profiles/evaluation-prompt.txt',
      useCount: 0,
      createdAt: at(3_000),
      lastUsedAt: at(3_000),
    };
    invariant(
      database.approveExperimentEvaluation({
        projectId,
        sessionId,
        expectedVersion: ready.version,
        revision: 1,
        profile: {
          ...profile,
          id: randomUUID(),
          codePolicyHash: '0'.repeat(64),
        },
        updatedAt: at(3_000),
      }) === null && database.listExperimentEvaluationProfiles(projectId).length === 0,
      'experiment_evaluation_tampered_code_policy_was_accepted',
    );
    const approved = database.approveExperimentEvaluation({
      projectId,
      sessionId,
      expectedVersion: ready.version,
      revision: 1,
      profile,
      updatedAt: at(3_000),
    });
    invariant(
      approved?.acceptedProfileId === profileId &&
        approved.version === 4 &&
        database.getExperimentEvaluationProfile(projectId, profileId)?.useCount === 0 &&
        database.getExperimentEvaluationProfile(projectId, profileId)?.codePolicyHash ===
          EXPERIMENT_EVALUATION_CODE_POLICY_HASH,
      'experiment_evaluation_profile_approval_failed',
    );

    const failedAttemptId = randomUUID();
    const generatingAfterApproval = database.beginExperimentEvaluationTurn({
      projectId,
      sessionId,
      expectedVersion: approved.version,
      attemptId: failedAttemptId,
      userMessage: userMessage(sessionId, failedAttemptId, at(4_000)),
      updatedAt: at(4_000),
    });
    invariant(
      generatingAfterApproval?.acceptedProfileId === profileId,
      'experiment_evaluation_begin_cleared_accepted_profile',
    );
    const failed = database.failExperimentEvaluationTurn({
      projectId,
      sessionId,
      attemptId: failedAttemptId,
      errorCode: 'fixture_generation_failed',
      messageStatus: 'failed',
      updatedAt: at(5_000),
    });
    invariant(
      failed?.status === 'failed' &&
        failed.acceptedProfileId === profileId &&
        database.getExperimentEvaluationSession(projectId, sessionId)?.acceptedProfileId ===
          profileId,
      'experiment_evaluation_failed_turn_dropped_accepted_profile',
    );

    const interruptedAttemptId = randomUUID();
    const generatingBeforeInterrupt = database.beginExperimentEvaluationTurn({
      projectId,
      sessionId,
      expectedVersion: failed.version,
      attemptId: interruptedAttemptId,
      userMessage: userMessage(sessionId, interruptedAttemptId, at(5_100)),
      updatedAt: at(5_100),
    });
    invariant(
      generatingBeforeInterrupt?.status === 'generating',
      'experiment_evaluation_interrupt_fixture_did_not_begin',
    );
    const interrupted = database.failExperimentEvaluationTurn({
      projectId,
      sessionId,
      attemptId: interruptedAttemptId,
      errorCode: 'experiment_evaluation_interrupted',
      messageStatus: 'interrupted',
      updatedAt: at(5_200),
    });
    invariant(
      interrupted?.status === 'failed' &&
        interrupted.lastErrorCode === 'experiment_evaluation_interrupted' &&
        database
          .getExperimentEvaluationSessionDetail(projectId, sessionId)
          ?.messages.some(
            (message) =>
              message.attemptId === interruptedAttemptId && message.status === 'interrupted',
          ),
      'experiment_evaluation_interrupted_message_was_not_persisted',
    );

    const reusedSessionId = randomUUID();
    const reusedAttemptId = randomUUID();
    const reusedSession: ExperimentEvaluationSession = {
      schemaVersion: 1,
      id: reusedSessionId,
      projectId,
      title: 'Held-out evaluation recipe copy',
      status: 'ready',
      activeAttemptId: null,
      currentRevision: 1,
      acceptedProfileId: profileId,
      version: 1,
      lastErrorCode: null,
      createdAt: at(6_000),
      updatedAt: at(6_000),
    };
    const reusedRevision: ExperimentEvaluationRevision = {
      ...revision,
      id: randomUUID(),
      sessionId: reusedSessionId,
      attemptId: reusedAttemptId,
      createdAt: at(6_000),
    };
    const reused = database.createExperimentEvaluationSessionFromProfile({
      session: reusedSession,
      revision: reusedRevision,
      profileId,
      usedAt: at(6_000),
    });
    invariant(
      reused?.acceptedProfileId === profileId &&
        database.getExperimentEvaluationProfile(projectId, profileId)?.useCount === 1 &&
        database.getExperimentEvaluationSessionDetail(projectId, reusedSessionId)?.currentRevision
          ?.id === reusedRevision.id,
      'experiment_evaluation_profile_reuse_failed',
    );

    const tamperSessionId = randomUUID();
    invariant(
      database.createExperimentEvaluationSession(
        initialSession(tamperSessionId, 'Evaluation tamper fixture'),
      ),
      'experiment_evaluation_tamper_session_create_failed',
    );
    const tamperAttemptId = randomUUID();
    const tamperGenerating = database.beginExperimentEvaluationTurn({
      projectId,
      sessionId: tamperSessionId,
      expectedVersion: 1,
      attemptId: tamperAttemptId,
      userMessage: userMessage(tamperSessionId, tamperAttemptId, at(7_000)),
      updatedAt: at(7_000),
    });
    invariant(tamperGenerating !== null, 'experiment_evaluation_tamper_turn_begin_failed');
    const tamperReady: ExperimentEvaluationSession = {
      ...tamperGenerating,
      status: 'ready',
      activeAttemptId: null,
      currentRevision: 1,
      version: 3,
      updatedAt: at(8_000),
    };
    const tamperRevision: ExperimentEvaluationRevision = {
      ...revision,
      id: randomUUID(),
      sessionId: tamperSessionId,
      attemptId: tamperAttemptId,
      createdAt: at(8_000),
    };
    let tamperedHashRejected = false;
    try {
      database.completeExperimentEvaluationTurn({
        session: tamperReady,
        revision: { ...tamperRevision, contentHash: '0'.repeat(64) },
        assistantMessage: assistantMessage(
          tamperSessionId,
          tamperAttemptId,
          1,
          invocation,
          at(8_000),
        ),
      });
    } catch (error) {
      tamperedHashRejected =
        error instanceof Error && error.message === 'invalid_experiment_evaluation_completion';
    }
    invariant(
      tamperedHashRejected &&
        database.getExperimentEvaluationSession(projectId, tamperSessionId)?.status ===
          'generating',
      'experiment_evaluation_tampered_content_hash_was_accepted',
    );
    const mismatchedInvocation: ModelInvocation = {
      ...invocation,
      invocationId: randomUUID(),
      resolvedModelId: 'different-fixture-model',
    };
    let tamperedInvocationRejected = false;
    try {
      database.completeExperimentEvaluationTurn({
        session: tamperReady,
        revision: tamperRevision,
        assistantMessage: assistantMessage(
          tamperSessionId,
          tamperAttemptId,
          1,
          mismatchedInvocation,
          at(8_000),
        ),
      });
    } catch (error) {
      tamperedInvocationRejected =
        error instanceof Error && error.message === 'invalid_experiment_evaluation_completion';
    }
    invariant(
      tamperedInvocationRejected &&
        database.getExperimentEvaluationSession(projectId, tamperSessionId)?.status ===
          'generating',
      'experiment_evaluation_tampered_invocation_was_accepted',
    );
    invariant(
      database.completeExperimentEvaluationTurn({
        session: tamperReady,
        revision: tamperRevision,
        assistantMessage: assistantMessage(
          tamperSessionId,
          tamperAttemptId,
          1,
          invocation,
          at(8_000),
        ),
      })?.status === 'ready',
      'experiment_evaluation_valid_completion_failed_after_tamper_rejection',
    );
  } finally {
    database.close();
  }
}

function verifyExperimentPersistence(fixedTimestamp: string) {
  const database = new LocalDatabase();
  database.open();
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const rootIdea: ExperimentIdea = {
    schemaVersion: 1,
    id: randomUUID(),
    projectId,
    parentIdeaId: null,
    title: 'Reproduce the baseline',
    hypothesis: 'A locked baseline makes later comparisons meaningful.',
    phase: 'baseline',
    outcome: 'planned',
    resultSummary: '',
    version: 1,
    createdAt: fixedTimestamp,
    updatedAt: fixedTimestamp,
    completedAt: null,
  };
  const childIdea: ExperimentIdea = {
    ...rootIdea,
    id: randomUUID(),
    parentIdeaId: rootIdea.id,
    title: 'Tune the learning rate',
    phase: 'optimization',
  };
  const otherRootIdea: ExperimentIdea = {
    ...rootIdea,
    id: randomUUID(),
    projectId: otherProjectId,
    title: 'Other project baseline',
  };
  invariant(database.createExperimentIdea(rootIdea), 'experiment_root_idea_insert_failed');
  invariant(database.createExperimentIdea(childIdea), 'experiment_child_idea_insert_failed');
  invariant(
    database.createExperimentIdea(otherRootIdea),
    'experiment_other_project_idea_insert_failed',
  );
  invariant(!database.createExperimentIdea(rootIdea), 'experiment_duplicate_idea_was_accepted');

  let crossProjectParentRejected = false;
  try {
    database.createExperimentIdea({
      ...childIdea,
      id: randomUUID(),
      projectId: otherProjectId,
    });
  } catch (error) {
    crossProjectParentRejected =
      error instanceof ExperimentWorkspaceStorageError && error.code === 'parent_not_found';
  }
  invariant(crossProjectParentRejected, 'experiment_cross_project_parent_was_accepted');
  invariant(
    database.listExperimentIdeas(otherProjectId).length === 1,
    'experiment_failed_parent_insert_was_not_atomic',
  );

  const completedAt = new Date(Date.parse(fixedTimestamp) + 1_000).toISOString();
  const updatedChild: ExperimentIdea = {
    ...childIdea,
    title: 'Tune the learning rate and scheduler',
    outcome: 'success',
    resultSummary: 'Improved the primary metric.',
    version: 2,
    updatedAt: completedAt,
    completedAt,
  };
  invariant(
    database.updateExperimentIdea(updatedChild, 1)?.version === 2,
    'experiment_idea_cas_update_failed',
  );
  invariant(
    database.updateExperimentIdea(updatedChild, 1) === null,
    'experiment_stale_idea_cas_was_accepted',
  );
  const experimentSearchMatches = database.searchExperimentIdeas(
    [projectId],
    'learning scheduler',
    10,
  );
  invariant(
    experimentSearchMatches.length === 1 && experimentSearchMatches[0]?.id === childIdea.id,
    'experiment_search_did_not_match_updated_idea',
  );
  invariant(
    database.searchExperimentIdeas([projectId], 'other project baseline', 10).length === 0,
    'experiment_search_crossed_project_boundary',
  );

  const metricDraft: Omit<ExperimentMetricPoint, 'sequence'> = {
    schemaVersion: 1,
    id: randomUUID(),
    projectId,
    ideaId: childIdea.id,
    objectiveId: randomUUID(),
    objectiveVersion: 3,
    metricKey: 'validation.rmse',
    metricDisplayName: 'Validation RMSE',
    direction: 'minimize',
    unit: 'rmse',
    aggregation: 'mean',
    evaluatorHash: 'evaluator-sha256-fixture',
    datasetHash: 'dataset-sha256-fixture',
    holdoutHash: 'holdout-sha256-fixture',
    baseline: 1.25,
    target: 1,
    value: 0.95,
    source: 'manual',
    trialId: 'trial-001',
    recordedAt: fixedTimestamp,
  };
  const firstPoint = database.appendExperimentMetricPoint(metricDraft);
  invariant(
    firstPoint.sequence === 1 &&
      firstPoint.aggregation === 'mean' &&
      firstPoint.evaluatorHash === metricDraft.evaluatorHash &&
      firstPoint.datasetHash === metricDraft.datasetHash &&
      firstPoint.holdoutHash === metricDraft.holdoutHash,
    'experiment_metric_provenance_insert_failed',
  );
  const competing = new LocalDatabase();
  competing.open();
  const secondPoint = competing.appendExperimentMetricPoint({
    ...metricDraft,
    id: randomUUID(),
    value: 0.91,
    trialId: 'trial-002',
  });
  competing.close();
  invariant(secondPoint.sequence === 2, 'experiment_metric_sequence_was_not_project_unique');
  const otherProjectPoint = database.appendExperimentMetricPoint({
    ...metricDraft,
    id: randomUUID(),
    projectId: otherProjectId,
    ideaId: otherRootIdea.id,
  });
  invariant(
    otherProjectPoint.sequence === 1,
    'experiment_metric_sequence_crossed_project_boundary',
  );
  const metricSearchMatches = database.searchExperimentMetricPoints(
    [projectId],
    'trial-002 0.91',
    10,
  );
  invariant(
    metricSearchMatches.length === 1 &&
      metricSearchMatches[0]?.ideaId === childIdea.id &&
      metricSearchMatches[0]?.trialId === 'trial-002' &&
      metricSearchMatches[0]?.value === 0.91,
    'experiment_metric_search_did_not_match_bounded_summary',
  );
  invariant(
    database.searchExperimentMetricPoints([otherProjectId], 'trial-002', 10).length === 0,
    'experiment_metric_search_crossed_project_boundary',
  );

  const missingIdeaId = randomUUID();
  const metricTails = database.listExperimentMetricTails({
    projectId,
    ideaIds: [childIdea.id, otherRootIdea.id, childIdea.id, missingIdeaId],
    perIdeaLimit: 2,
  });
  invariant(
    metricTails.length === 3 &&
      metricTails[0]?.ideaId === childIdea.id &&
      metricTails[0]?.metricPointTotal === 2 &&
      metricTails[0]?.metricPoints.map((point) => point.sequence).join(',') === '1,2' &&
      metricTails[1]?.ideaId === otherRootIdea.id &&
      metricTails[1]?.metricPointTotal === 0 &&
      metricTails[1]?.metricPoints.length === 0 &&
      metricTails[2]?.ideaId === missingIdeaId &&
      metricTails[2]?.metricPointTotal === 0,
    'experiment_metric_tail_query_was_not_bounded_or_project_scoped',
  );
  let invalidMetricTailQueryRejected = false;
  try {
    database.listExperimentMetricTails({
      projectId,
      ideaIds: ['not-an-idea-id'],
      perIdeaLimit: 1,
    });
  } catch {
    invalidMetricTailQueryRejected = true;
  }
  invariant(invalidMetricTailQueryRejected, 'experiment_metric_tail_query_was_not_validated');

  let missingMetricIdeaRejected = false;
  try {
    database.appendExperimentMetricPoint({
      ...metricDraft,
      id: randomUUID(),
      ideaId: randomUUID(),
    });
  } catch (error) {
    missingMetricIdeaRejected =
      error instanceof ExperimentWorkspaceStorageError && error.code === 'idea_not_found';
  }
  invariant(missingMetricIdeaRejected, 'experiment_metric_without_idea_was_accepted');
  invariant(
    database.listExperimentMetricPoints(projectId).length === 2,
    'experiment_failed_metric_insert_was_not_atomic',
  );
  const loggingTemplate: ExperimentLoggingTemplate = {
    schemaVersion: 1,
    id: randomUUID(),
    projectId,
    version: 1,
    previousRevisionId: null,
    systemFields: [
      'schema_version',
      'template_version',
      'objective_version',
      'occurred_at',
      'event_type',
      'sequence',
      'run_id',
      'trial_id',
      'status',
      'server_label',
    ],
    customFields: [
      {
        key: 'step',
        label: 'Step',
        type: 'integer',
        category: 'progress',
        requiredAt: ['progress'],
        unit: null,
      },
    ],
    templateHash: 'a'.repeat(64),
    createdAt: fixedTimestamp,
  };
  invariant(
    database.appendExperimentLoggingTemplate(loggingTemplate, 0)?.id === loggingTemplate.id,
    'experiment_logging_template_insert_failed',
  );
  const queuedRun: ExperimentRun = {
    schemaVersion: 1,
    id: randomUUID(),
    projectId,
    ideaId: null,
    title: 'Exploratory observability smoke run',
    status: 'queued',
    mode: 'exploratory',
    serverLabel: 'GPU fixture',
    trialId: 'exploratory-smoke-1',
    objectiveId: null,
    objectiveVersion: null,
    loggingTemplate: {
      revisionId: loggingTemplate.id,
      version: loggingTemplate.version,
      systemFields: loggingTemplate.systemFields,
      customFields: loggingTemplate.customFields,
      templateHash: loggingTemplate.templateHash,
    },
    progressCurrent: null,
    progressTotal: null,
    currentStep: null,
    latestMetric: null,
    logReference: null,
    processExitCode: null,
    processDurationMs: null,
    createdAt: fixedTimestamp,
    updatedAt: fixedTimestamp,
    startedAt: null,
    completedAt: null,
    version: 1,
  };
  invariant(database.createExperimentRun(queuedRun), 'experiment_run_insert_failed');
  const experimentConnectionId = randomUUID();
  const experimentGrantId = randomUUID();
  invariant(
    database.createSshConnection({
      schemaVersion: 1,
      id: experimentConnectionId,
      label: 'Experiment intent fixture server',
      hostAlias: 'experiment-intent-fixture',
      version: 1,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    }),
    'experiment_intent_connection_fixture_failed',
  );
  invariant(
    database.createSshWorkspaceGrant({
      schemaVersion: 1,
      id: experimentGrantId,
      projectId,
      connectionId: experimentConnectionId,
      canonicalRoot: '/workspace/experiment-intent-fixture',
      permissionMode: 'workspace',
      version: 1,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    }),
    'experiment_intent_grant_fixture_failed',
  );
  invariant(
    database.bindExperimentRunExecution({
      projectId,
      runId: queuedRun.id,
      workspaceGrantId: experimentGrantId,
    }),
    'experiment_execution_binding_insert_failed',
  );
  const executionIntent = {
    projectId,
    runId: queuedRun.id,
    workspaceGrantId: experimentGrantId,
    grantVersion: 1,
    connectionId: experimentConnectionId,
    connectionVersion: 1,
    canonicalRoot: '/workspace/experiment-intent-fixture',
    canonicalRootHash: createHash('sha256')
      .update('/workspace/experiment-intent-fixture', 'utf8')
      .digest('hex'),
    policyVersion: 1,
    executionPolicyHash: 'd'.repeat(64),
    intentHash: 'b'.repeat(64),
    workspaceSubdirectory: 'experiments/smoke',
    relativePath: 'logs/smoke.jsonl',
    createdAt: fixedTimestamp,
  } as const;
  invariant(
    database.stageExperimentRunExecutionIntent(executionIntent) &&
      database.stageExperimentRunExecutionIntent(executionIntent) &&
      database.getExperimentRunExecutionIntent(projectId, queuedRun.id)?.intentHash ===
        executionIntent.intentHash,
    'experiment_execution_intent_was_not_durable_or_idempotent',
  );
  const legacyIntentQueuedRun: ExperimentRun = {
    ...queuedRun,
    id: randomUUID(),
    trialId: 'trial-legacy-intent-origin-preserved',
    title: 'Legacy intent with recoverable origin',
  };
  invariant(
    database.createExperimentRun(legacyIntentQueuedRun) &&
      database.bindExperimentRunExecution({
        projectId,
        runId: legacyIntentQueuedRun.id,
        workspaceGrantId: experimentGrantId,
      }) &&
      database.stageExperimentRunExecutionIntent({
        ...executionIntent,
        runId: legacyIntentQueuedRun.id,
        intentHash: 'c'.repeat(64),
      }),
    'recoverable_legacy_experiment_intent_fixture_failed',
  );
  const orphanedIntentRun: ExperimentRun = {
    ...queuedRun,
    id: randomUUID(),
    trialId: 'trial-legacy-intent-origin-missing',
    title: 'Legacy intent with missing origin',
  };
  const orphanedConnectionId = randomUUID();
  const orphanedGrantId = randomUUID();
  const orphanedCanonicalRoot = '/workspace/orphaned-experiment-intent';
  invariant(
    database.createExperimentRun(orphanedIntentRun) &&
      database.createSshConnection({
        schemaVersion: 1,
        id: orphanedConnectionId,
        label: 'Orphaned experiment intent server',
        hostAlias: 'orphaned-experiment-intent',
        version: 1,
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      }) &&
      database.createSshWorkspaceGrant({
        schemaVersion: 1,
        id: orphanedGrantId,
        projectId,
        connectionId: orphanedConnectionId,
        canonicalRoot: orphanedCanonicalRoot,
        permissionMode: 'workspace',
        version: 1,
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      }) &&
      database.bindExperimentRunExecution({
        projectId,
        runId: orphanedIntentRun.id,
        workspaceGrantId: orphanedGrantId,
      }) &&
      database.stageExperimentRunExecutionIntent({
        ...executionIntent,
        runId: orphanedIntentRun.id,
        workspaceGrantId: orphanedGrantId,
        connectionId: orphanedConnectionId,
        canonicalRoot: orphanedCanonicalRoot,
        canonicalRootHash: createHash('sha256').update(orphanedCanonicalRoot, 'utf8').digest('hex'),
        intentHash: 'f'.repeat(64),
      }),
    'unrecoverable_legacy_experiment_intent_fixture_failed',
  );
  const lostAt = new Date(Date.parse(fixedTimestamp) + 2_000).toISOString();
  const lostRun: ExperimentRun = {
    ...queuedRun,
    status: 'lost',
    currentStep: 'runner lease expired',
    updatedAt: lostAt,
    startedAt: lostAt,
    completedAt: lostAt,
    version: 2,
  };
  invariant(
    database.updateExperimentRun(lostRun, 1)?.status === 'lost',
    'experiment_run_cas_update_failed',
  );
  invariant(
    database.updateExperimentRun(lostRun, 1) === null,
    'experiment_run_stale_cas_was_accepted',
  );
  const interruptedRunningRun: ExperimentRun = {
    ...queuedRun,
    id: randomUUID(),
    trialId: 'trial-interrupted-running',
    title: 'Interrupted running trial',
    status: 'running',
    currentStep: 'training epoch 3',
    startedAt: fixedTimestamp,
  };
  invariant(
    database.createExperimentRun(interruptedRunningRun),
    'running_experiment_run_insert_failed',
  );
  const pendingVerificationRun: ExperimentRun = {
    ...queuedRun,
    id: randomUUID(),
    trialId: 'trial-pending-verification',
    title: 'Pending verification trial',
    status: 'verifying',
    currentStep: 'Awaiting exact log verification',
    logReference: {
      referenceId: randomUUID(),
      displayName: 'Pending verification JSONL log',
      contentHash: 'c'.repeat(64),
      sizeBytes: 256,
      validationState: 'pending',
      missingFields: [],
    },
    processExitCode: 0,
    processDurationMs: 4_321,
    startedAt: fixedTimestamp,
    version: 2,
  };
  invariant(
    database.createExperimentRun(pendingVerificationRun),
    'verifying_experiment_run_insert_failed',
  );
  const legacySuccessRun: ExperimentRun = {
    ...queuedRun,
    id: randomUUID(),
    ideaId: childIdea.id,
    trialId: 'trial-legacy-success-with-receipt',
    title: 'Legacy successful trial',
    status: 'succeeded',
    mode: 'comparable',
    objectiveId: metricDraft.objectiveId,
    objectiveVersion: metricDraft.objectiveVersion,
    currentStep: 'Completed',
    latestMetric: {
      key: metricDraft.metricKey,
      displayName: metricDraft.metricDisplayName,
      value: metricDraft.value,
      unit: metricDraft.unit,
      recordedAt: fixedTimestamp,
    },
    logReference: {
      referenceId: randomUUID(),
      displayName: 'Legacy successful JSONL log',
      contentHash: 'e'.repeat(64),
      sizeBytes: 128,
      validationState: 'valid',
      missingFields: [],
    },
    processExitCode: 0,
    processDurationMs: 1_234,
    startedAt: fixedTimestamp,
    completedAt: fixedTimestamp,
    version: 2,
  };
  invariant(
    database.createExperimentRun(legacySuccessRun) &&
      database.bindExperimentRunExecution({
        projectId,
        runId: legacySuccessRun.id,
        workspaceGrantId: experimentGrantId,
      }) &&
      database.stageExperimentRunExecutionIntent({
        ...executionIntent,
        runId: legacySuccessRun.id,
        intentHash: '1'.repeat(64),
      }),
    'legacy_success_experiment_run_insert_failed',
  );
  database.close();

  const keyHex = safeStorage
    .decryptString(readFileSync(join(app.getPath('userData'), 'local-key.bin')))
    .trim();
  const raw = new Database(join(app.getPath('userData'), 'gosu.db'));
  raw.pragma(`key="x'${keyHex}'"`);
  raw.pragma('foreign_keys=ON');
  try {
    let rawCrossProjectParentRejected = false;
    try {
      raw
        .prepare(
          `insert into experiment_ideas(
             id,schema_version,project_id,parent_idea_id,title,hypothesis,phase,outcome,
             result_summary,version,created_at,updated_at,completed_at
           )
           select ?,schema_version,?,id,?,hypothesis,phase,outcome,result_summary,
                  version,created_at,updated_at,completed_at
           from experiment_ideas where id=?`,
        )
        .run(randomUUID(), otherProjectId, 'Invalid cross-project child', rootIdea.id);
    } catch {
      rawCrossProjectParentRejected = true;
    }
    invariant(
      rawCrossProjectParentRejected,
      'experiment_composite_parent_foreign_key_was_not_enforced',
    );

    let rawCrossProjectMetricRejected = false;
    try {
      raw
        .prepare(
          `insert into experiment_metric_points(
             id,schema_version,project_id,idea_id,sequence,objective_id,objective_version,
             metric_key,metric_display_name,direction,unit,aggregation,evaluator_hash,
             dataset_hash,holdout_hash,baseline,target,value,source,trial_id,recorded_at
           )
           select ?,schema_version,?,idea_id,2,objective_id,objective_version,metric_key,
                  metric_display_name,direction,unit,aggregation,evaluator_hash,dataset_hash,
                  holdout_hash,baseline,target,value,source,trial_id,recorded_at
           from experiment_metric_points where id=?`,
        )
        .run(randomUUID(), otherProjectId, firstPoint.id);
    } catch {
      rawCrossProjectMetricRejected = true;
    }
    invariant(
      rawCrossProjectMetricRejected,
      'experiment_composite_metric_foreign_key_was_not_enforced',
    );

    let duplicateSequenceRejected = false;
    try {
      raw
        .prepare(
          `insert into experiment_metric_points(
             id,schema_version,project_id,idea_id,sequence,objective_id,objective_version,
             metric_key,metric_display_name,direction,unit,aggregation,evaluator_hash,
             dataset_hash,holdout_hash,baseline,target,value,source,trial_id,recorded_at
           )
           select ?,schema_version,project_id,idea_id,sequence,objective_id,objective_version,
                  metric_key,metric_display_name,direction,unit,aggregation,evaluator_hash,
                  dataset_hash,holdout_hash,baseline,target,value,source,trial_id,recorded_at
           from experiment_metric_points where id=?`,
        )
        .run(randomUUID(), firstPoint.id);
    } catch {
      duplicateSequenceRejected = true;
    }
    invariant(duplicateSequenceRejected, 'experiment_duplicate_metric_sequence_was_accepted');

    let metricUpdateRejected = false;
    try {
      raw.prepare('update experiment_metric_points set value=? where id=?').run(9, firstPoint.id);
    } catch {
      metricUpdateRejected = true;
    }
    let metricDeleteRejected = false;
    try {
      raw.prepare('delete from experiment_metric_points where id=?').run(firstPoint.id);
    } catch {
      metricDeleteRejected = true;
    }
    invariant(
      metricUpdateRejected && metricDeleteRejected,
      'experiment_metric_append_only_guard_failed',
    );

    raw
      .prepare(
        `with recursive counter(value) as (
           values(1) union all select value+1 from counter where value<498
         )
         insert into experiment_ideas(
           id,schema_version,project_id,parent_idea_id,title,hypothesis,phase,outcome,
           result_summary,version,created_at,updated_at,completed_at
         )
         select printf('20000000-0000-4000-8000-%012d',value),1,?,null,
                'Capacity idea ' || value,'','','planned','',1,?,?,null
         from counter`,
      )
      .run(projectId, fixedTimestamp, fixedTimestamp);
    raw
      .prepare(
        `with digits(value) as (
           values(0),(1),(2),(3),(4),(5),(6),(7),(8),(9)
         ), numbers(sequence) as (
           select 3+ones.value+10*tens.value+100*hundreds.value+1000*thousands.value
           from digits ones cross join digits tens cross join digits hundreds
           cross join digits thousands
         )
         insert into experiment_metric_points(
           id,schema_version,project_id,idea_id,sequence,objective_id,objective_version,
           metric_key,metric_display_name,direction,unit,aggregation,evaluator_hash,
           dataset_hash,holdout_hash,baseline,target,value,source,trial_id,recorded_at
         )
         select printf('30000000-0000-4000-8000-%012d',numbers.sequence),seed.schema_version,
                seed.project_id,seed.idea_id,numbers.sequence,seed.objective_id,
                seed.objective_version,seed.metric_key,seed.metric_display_name,seed.direction,
                seed.unit,seed.aggregation,seed.evaluator_hash,seed.dataset_hash,seed.holdout_hash,
                seed.baseline,seed.target,seed.value,
                case when numbers.sequence=${EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT}
                  then 'runner-summary' else seed.source end,
                case when numbers.sequence=${EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT}
                  then 'trial-legacy-success-with-receipt' else seed.trial_id end,
                seed.recorded_at
         from experiment_metric_points seed cross join numbers
         where seed.id=? and numbers.sequence<=${EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT}`,
      )
      .run(firstPoint.id);
  } finally {
    raw.close();
  }

  const reopened = new LocalDatabase();
  reopened.open();
  try {
    invariant(
      reopened.listExperimentIdeas(projectId).length === EXPERIMENT_MAX_IDEAS_PER_PROJECT,
      'experiment_ideas_did_not_persist_to_capacity',
    );
    const durablePoints = reopened.listExperimentMetricPoints(projectId);
    invariant(
      durablePoints.length === EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT &&
        durablePoints[0]?.id === firstPoint.id &&
        durablePoints[0]?.evaluatorHash === metricDraft.evaluatorHash &&
        durablePoints[1]?.sequence === 2 &&
        durablePoints.at(-1)?.sequence === EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT &&
        durablePoints.at(-1)?.source === 'runner-summary' &&
        durablePoints.at(-1)?.trialId === legacySuccessRun.trialId,
      'experiment_metric_points_did_not_persist_in_sequence',
    );
    const durableTail = reopened.listExperimentMetricTails({
      projectId,
      ideaIds: [childIdea.id],
      perIdeaLimit: 3,
    });
    invariant(
      durableTail[0]?.metricPointTotal === EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT &&
        durableTail[0]?.metricPoints.map((point) => point.sequence).join(',') === '4998,4999,5000',
      'experiment_metric_tail_did_not_return_latest_points_in_ascending_order',
    );
    invariant(
      reopened.getExperimentIdea(projectId, childIdea.id)?.title === updatedChild.title,
      'experiment_idea_update_did_not_persist',
    );
    invariant(
      reopened.getLatestExperimentLoggingTemplate(projectId)?.id === loggingTemplate.id,
      'experiment_logging_template_did_not_persist',
    );
    invariant(
      reopened.getExperimentRun(projectId, queuedRun.id)?.status === 'lost' &&
        reopened.getExperimentRun(projectId, queuedRun.id)?.completedAt === lostAt,
      'experiment_run_did_not_persist',
    );
    invariant(
      reopened.getExperimentRunExecutionIntent(projectId, queuedRun.id)?.intentHash ===
        executionIntent.intentHash,
      'experiment_execution_intent_did_not_persist',
    );
    const reconciledExperimentRun = reopened.getExperimentRun(projectId, interruptedRunningRun.id);
    invariant(
      reconciledExperimentRun?.status === 'lost' &&
        reconciledExperimentRun.currentStep === 'Application interrupted; remote outcome unknown' &&
        reconciledExperimentRun.completedAt !== null &&
        reconciledExperimentRun.version === interruptedRunningRun.version + 1,
      'running_experiment_run_was_not_reconciled',
    );
    const durableVerificationRun = reopened.getExperimentRun(projectId, pendingVerificationRun.id);
    invariant(
      durableVerificationRun?.status === 'verifying' &&
        durableVerificationRun.logReference?.validationState === 'pending' &&
        durableVerificationRun.processExitCode === 0 &&
        durableVerificationRun.completedAt === null,
      'completed_process_log_verification_was_not_resumable_after_restart',
    );

    let ideaLimitRejected = false;
    try {
      reopened.createExperimentIdea({
        ...rootIdea,
        id: randomUUID(),
        title: 'Over idea capacity',
      });
    } catch (error) {
      ideaLimitRejected =
        error instanceof ExperimentWorkspaceStorageError && error.code === 'idea_limit_reached';
    }
    let metricLimitRejected = false;
    try {
      reopened.appendExperimentMetricPoint({
        ...metricDraft,
        id: randomUUID(),
      });
    } catch (error) {
      metricLimitRejected =
        error instanceof ExperimentWorkspaceStorageError && error.code === 'metric_limit_reached';
    }
    invariant(ideaLimitRejected, 'experiment_idea_project_cap_was_not_enforced');
    invariant(metricLimitRejected, 'experiment_metric_project_cap_was_not_enforced');
    invariant(
      reopened.listExperimentIdeas(projectId).length === EXPERIMENT_MAX_IDEAS_PER_PROJECT &&
        reopened.listExperimentMetricPoints(projectId).length ===
          EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT,
      'experiment_capacity_failure_was_not_atomic',
    );
  } finally {
    reopened.close();
  }

  const currentSchema = new Database(join(app.getPath('userData'), 'gosu.db'));
  currentSchema.pragma(`key="x'${keyHex}'"`);
  currentSchema.pragma('foreign_keys=ON');
  try {
    currentSchema
      .transaction(() => {
        invariant(
          Boolean(
            currentSchema
              .prepare(
                `select 1 from local_schema_migrations
                 where id='experiment-runs-hardening-v1'`,
              )
              .get(),
          ),
          'current_experiment_run_hardening_marker_missing',
        );
        currentSchema.exec('drop trigger if exists experiment_runs_update_guard');
        currentSchema
          .prepare(
            `update experiment_runs
             set process_exit_code=null,process_duration_ms=null
             where project_id=? and id=? and status='succeeded'`,
          )
          .run(projectId, legacySuccessRun.id);
      })
      .immediate();
  } finally {
    currentSchema.close();
  }

  const currentSchemaReopened = new LocalDatabase();
  currentSchemaReopened.open();
  invariant(
    currentSchemaReopened.getExperimentRun(projectId, legacySuccessRun.id)?.status === 'lost',
    'current_schema_unverified_success_was_not_quarantined',
  );
  const verifiedMetricPoints = currentSchemaReopened.listExperimentMetricPoints(projectId);
  invariant(
    verifiedMetricPoints.length === EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT - 1 &&
      !verifiedMetricPoints.some(
        (point) => point.source === 'runner-summary' && point.trialId === legacySuccessRun.trialId,
      ),
    'unverified_runner_summary_was_exposed_by_metric_list',
  );
  invariant(
    currentSchemaReopened.searchExperimentMetricPoints([projectId], legacySuccessRun.trialId, 10)
      .length === 0,
    'unverified_runner_summary_was_exposed_by_global_search',
  );
  const verifiedMetricTail = currentSchemaReopened.listExperimentMetricTails({
    projectId,
    ideaIds: [childIdea.id],
    perIdeaLimit: 3,
  });
  invariant(
    verifiedMetricTail[0]?.metricPointTotal === EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT - 1 &&
      verifiedMetricTail[0]?.metricPoints.map((point) => point.sequence).join(',') ===
        '4997,4998,4999',
    'unverified_runner_summary_was_exposed_by_metric_tail',
  );
  currentSchemaReopened.close();

  const legacyIntentSchema = new Database(join(app.getPath('userData'), 'gosu.db'));
  legacyIntentSchema.pragma(`key="x'${keyHex}'"`);
  legacyIntentSchema.pragma('foreign_keys=OFF');
  try {
    legacyIntentSchema
      .transaction(() => {
        legacyIntentSchema.exec(`
          drop trigger if exists experiment_runs_update_guard;
          drop trigger if exists experiment_run_execution_intents_delete_guard;
          drop trigger if exists experiment_run_execution_intents_update_guard;
        `);
        legacyIntentSchema
          .prepare(
            `update experiment_runs
             set status='succeeded',process_exit_code=0,process_duration_ms=1234,
                 current_step='Completed',updated_at=?,version=version+1
             where project_id=? and id=?`,
          )
          .run(fixedTimestamp, projectId, legacySuccessRun.id);
        legacyIntentSchema.exec(`
          create table experiment_run_execution_intents_legacy_fixture (
            project_id text not null check (length(project_id) = 36),
            run_id text not null check (length(run_id) = 36),
            workspace_grant_id text not null check (length(workspace_grant_id) = 36),
            intent_hash text not null check (length(intent_hash) = 64),
            workspace_subdirectory text check (
              workspace_subdirectory is null or length(workspace_subdirectory) <= 512
            ),
            relative_path text not null check (length(relative_path) between 1 and 512),
            created_at text not null,
            primary key(project_id,run_id),
            foreign key(project_id,run_id) references experiment_runs(project_id,id)
          );
          insert into experiment_run_execution_intents_legacy_fixture(
            project_id,run_id,workspace_grant_id,intent_hash,workspace_subdirectory,
            relative_path,created_at
          )
          select project_id,run_id,workspace_grant_id,intent_hash,workspace_subdirectory,
                 relative_path,created_at
          from experiment_run_execution_intents;
          drop table experiment_run_execution_intents;
          alter table experiment_run_execution_intents_legacy_fixture
            rename to experiment_run_execution_intents;
          delete from local_schema_migrations where id='experiment-run-intent-authority-v2';
        `);
        legacyIntentSchema
          .prepare('delete from ssh_workspace_grants where id=?')
          .run(orphanedGrantId);
      })
      .immediate();
  } finally {
    legacyIntentSchema.close();
  }

  const authorityMigrated = new LocalDatabase();
  authorityMigrated.open();
  invariant(
    authorityMigrated.getExperimentRun(projectId, queuedRun.id)?.processExitCode === null &&
      authorityMigrated.getExperimentRunExecutionIntent(projectId, queuedRun.id)?.intentHash ===
        executionIntent.intentHash,
    'legacy_experiment_intent_preserved_unrelated_run_receipt',
  );
  invariant(
    authorityMigrated.getExperimentRun(projectId, legacySuccessRun.id)?.status === 'lost' &&
      authorityMigrated.getExperimentRun(projectId, legacySuccessRun.id)?.currentStep ===
        'Legacy execution intent requires provenance review' &&
      authorityMigrated.getExperimentRunExecutionIntent(projectId, legacySuccessRun.id)
        ?.executionPolicyHash !== executionIntent.executionPolicyHash,
    'legacy_authority_success_was_not_quarantined',
  );
  invariant(
    authorityMigrated.searchExperimentMetricPoints([projectId], legacySuccessRun.trialId, 10)
      .length === 0,
    'legacy_authority_summary_was_exposed_by_global_search',
  );
  const migratedRecoverableIntent = authorityMigrated.getExperimentRunExecutionIntent(
    projectId,
    legacyIntentQueuedRun.id,
  );
  invariant(
    authorityMigrated.getExperimentRun(projectId, legacyIntentQueuedRun.id)?.status === 'lost' &&
      migratedRecoverableIntent?.workspaceGrantId === experimentGrantId &&
      migratedRecoverableIntent.grantVersion === 1 &&
      migratedRecoverableIntent.connectionId === experimentConnectionId &&
      migratedRecoverableIntent.connectionVersion === 1 &&
      migratedRecoverableIntent.canonicalRoot === '/workspace/experiment-intent-fixture' &&
      migratedRecoverableIntent.canonicalRootHash ===
        createHash('sha256').update('/workspace/experiment-intent-fixture', 'utf8').digest('hex') &&
      migratedRecoverableIntent.executionPolicyHash !== executionIntent.executionPolicyHash,
    'legacy_experiment_intent_origin_was_not_backfilled_fail_closed',
  );
  invariant(
    authorityMigrated.getExperimentRun(projectId, orphanedIntentRun.id)?.status === 'lost' &&
      authorityMigrated.getExperimentRunExecutionIntent(projectId, orphanedIntentRun.id) === null,
    'legacy_experiment_intent_without_origin_was_not_quarantined',
  );
  authorityMigrated.close();

  const tombstoneInspection = new Database(join(app.getPath('userData'), 'gosu.db'));
  tombstoneInspection.pragma(`key="x'${keyHex}'"`);
  try {
    const tombstone = tombstoneInspection
      .prepare(
        `select workspace_grant_id,intent_hash,recovery_reason
         from experiment_run_execution_intent_legacy_tombstones
         where project_id=? and run_id=?`,
      )
      .get(projectId, orphanedIntentRun.id) as
      { workspace_grant_id: string; intent_hash: string; recovery_reason: string } | undefined;
    invariant(
      tombstone?.workspace_grant_id === orphanedGrantId &&
        tombstone.intent_hash === 'f'.repeat(64) &&
        tombstone.recovery_reason === 'legacy_origin_unrecoverable',
      'unrecoverable_legacy_experiment_intent_tombstone_missing',
    );
  } finally {
    tombstoneInspection.close();
  }

  const legacyRunSuccess: ExperimentRun = {
    ...legacySuccessRun,
    id: randomUUID(),
    trialId: 'trial-old-run-schema-success',
    title: 'Old run schema successful trial',
  };
  const legacyRunFixtureDatabase = new LocalDatabase();
  legacyRunFixtureDatabase.open();
  invariant(
    legacyRunFixtureDatabase.createExperimentRun(legacyRunSuccess),
    'legacy_run_schema_success_fixture_failed',
  );
  legacyRunFixtureDatabase.close();

  const legacyRunSchema = new Database(join(app.getPath('userData'), 'gosu.db'));
  legacyRunSchema.pragma(`key="x'${keyHex}'"`);
  legacyRunSchema.pragma('foreign_keys=OFF');
  try {
    legacyRunSchema
      .transaction(() => {
        legacyRunSchema
          .prepare(
            `update experiment_runs
             set status='failed',
                 log_reference_json=json_set(log_reference_json,'$.validationState','invalid'),
                 current_step='Legacy migration fixture',completed_at=?,updated_at=?,version=version+1
             where status='verifying'`,
          )
          .run(fixedTimestamp, fixedTimestamp);
        legacyRunSchema.exec(`
          drop trigger if exists experiment_runs_project_limit;
          drop trigger if exists experiment_runs_insert_guard;
          drop trigger if exists experiment_runs_update_guard;
          drop trigger if exists experiment_runs_delete_guard;
          drop index if exists experiment_runs_by_project;
          create table experiment_runs_legacy_fixture (
            id text primary key check (length(id) = 36),
            schema_version integer not null check (schema_version = 1),
            project_id text not null check (length(project_id) = 36),
            idea_id text check (idea_id is null or length(idea_id) = 36),
            title text not null check (length(title) between 1 and 160),
            status text not null check (
              status in ('queued','running','succeeded','failed','cancelled','lost')
            ),
            mode text not null check (mode in ('comparable','exploratory')),
            server_label text not null check (length(server_label) between 1 and 120),
            trial_id text not null check (length(trial_id) between 1 and 128),
            objective_id text check (objective_id is null or length(objective_id) = 36),
            objective_version integer check (objective_version is null or objective_version > 0),
            logging_template_revision_id text not null check (
              length(logging_template_revision_id) = 36
            ),
            logging_template_json text not null check (
              length(logging_template_json) between 2 and 65536
            ),
            progress_current integer check (progress_current is null or progress_current >= 0),
            progress_total integer check (progress_total is null or progress_total > 0),
            current_step text check (current_step is null or length(current_step) between 1 and 160),
            latest_metric_json text check (
              latest_metric_json is null or length(latest_metric_json) between 2 and 8192
            ),
            log_reference_json text check (
              log_reference_json is null or length(log_reference_json) between 2 and 16384
            ),
            created_at text not null,
            updated_at text not null,
            started_at text,
            completed_at text,
            version integer not null check (version > 0),
            unique(project_id,id),
            unique(project_id,trial_id),
            check ((objective_id is null) = (objective_version is null)),
            check (mode='exploratory' or (idea_id is not null and objective_id is not null)),
            check (mode='comparable' or objective_id is null),
            check (
              progress_current is null or progress_total is null or progress_current <= progress_total
            ),
            foreign key(project_id,idea_id) references experiment_ideas(project_id,id),
            foreign key(project_id,logging_template_revision_id)
              references experiment_logging_template_revisions(project_id,id)
          );
          insert into experiment_runs_legacy_fixture(
            id,schema_version,project_id,idea_id,title,status,mode,server_label,trial_id,
            objective_id,objective_version,logging_template_revision_id,logging_template_json,
            progress_current,progress_total,current_step,latest_metric_json,log_reference_json,
            created_at,updated_at,started_at,completed_at,version
          )
          select id,schema_version,project_id,idea_id,title,status,mode,server_label,trial_id,
                 objective_id,objective_version,logging_template_revision_id,logging_template_json,
                 progress_current,progress_total,current_step,latest_metric_json,log_reference_json,
                 created_at,updated_at,started_at,completed_at,version
          from experiment_runs;
          drop table experiment_runs;
          alter table experiment_runs_legacy_fixture rename to experiment_runs;
          delete from local_schema_migrations where id='experiment-runs-hardening-v1';
        `);
      })
      .immediate();
  } finally {
    legacyRunSchema.close();
  }

  const migratedRuns = new LocalDatabase();
  migratedRuns.open();
  invariant(
    migratedRuns.getExperimentRun(projectId, legacyRunSuccess.id)?.status === 'lost' &&
      migratedRuns.getExperimentRun(projectId, legacyRunSuccess.id)?.currentStep ===
        'Legacy result requires provenance review',
    'legacy_experiment_runs_hardening_migration_failed',
  );
  migratedRuns.close();

  const migratedAgain = new LocalDatabase();
  migratedAgain.open();
  invariant(
    migratedAgain.getExperimentRun(projectId, queuedRun.id)?.status === 'lost' &&
      migratedAgain.getExperimentRun(projectId, legacyIntentQueuedRun.id)?.status === 'lost' &&
      migratedAgain.getExperimentRun(projectId, legacySuccessRun.id)?.status === 'lost' &&
      migratedAgain.getExperimentRun(projectId, legacyRunSuccess.id)?.status === 'lost' &&
      migratedAgain.getExperimentRunExecutionIntent(projectId, legacyIntentQueuedRun.id)
        ?.canonicalRoot === '/workspace/experiment-intent-fixture' &&
      migratedAgain.getExperimentRunExecutionIntent(projectId, orphanedIntentRun.id) === null,
    'experiment_run_upgrade_migrations_were_not_idempotent',
  );
  migratedAgain.close();
}

function verifyLectureStudioListDetailBoundary(fixedTimestamp: string) {
  const projectId = randomUUID();
  const recordId = randomUUID();
  const studio: LectureStudio = {
    schemaVersion: 1,
    id: randomUUID(),
    title: 'SQLCipher lecture boundary',
    kind: 'talk',
    durationMinutes: 20,
    outputProjectId: projectId,
    sourceProjectIds: [projectId],
    sourceSelection: {
      literature: [{ projectId, recordId }],
      experiments: [],
      manuscripts: [],
      externalSources: null,
    },
    generationBrief: {
      notesTargetPages: 12,
      slidesTargetPages: 24,
      detailLevel: 'detailed',
      structure: { mode: 'adaptive' },
      customInstructions: 'Emphasize the reproducibility checklist.',
    },
    status: 'draft',
    activeAttemptId: null,
    currentRevision: 0,
    version: 1,
    lastErrorCode: null,
    createdAt: fixedTimestamp,
    updatedAt: fixedTimestamp,
  };
  const userMessage = (attemptId: string, content: string): LectureStudioMessage => ({
    schemaVersion: 1,
    id: randomUUID(),
    studioId: studio.id,
    role: 'user',
    status: 'complete',
    content,
    attemptId,
    revision: null,
    invocation: null,
    createdAt: fixedTimestamp,
    completedAt: fixedTimestamp,
  });
  const attachmentContent = String.raw`\section{Turn attachment evidence}
The attached derivation contributes the bounded source label [A1].`;
  const attachmentCard: LectureStudioAttachmentCard = {
    id: randomUUID(),
    displayName: 'turn-evidence.tex',
    format: 'latex',
    byteSize: Buffer.byteLength(attachmentContent, 'utf8'),
    sha256: createHash('sha256').update(attachmentContent, 'utf8').digest('hex'),
    unitLabel: 'part',
    unitCount: 1,
    extractedCharacters: attachmentContent.length,
    truncated: false,
    textAvailable: true,
    reconstructionNotice: 'Exact UTF-8 LaTeX text imported for this Lecture Assistant turn.',
    expiresAt: fixedTimestamp,
  };
  const attachmentSnapshot: LectureStudioAttachmentSnapshot = {
    sourceLabel: 'A1',
    attachmentId: attachmentCard.id,
    projectId,
    studioId: studio.id,
    displayName: attachmentCard.displayName,
    format: attachmentCard.format,
    byteSize: attachmentCard.byteSize,
    sourceSha256: attachmentCard.sha256,
    unitLabel: attachmentCard.unitLabel,
    unitCount: attachmentCard.unitCount,
    content: attachmentContent,
    contentSha256: createHash('sha256').update(attachmentContent, 'utf8').digest('hex'),
    extractedCharacters: attachmentContent.length,
    truncated: false,
    reconstructionNotice: attachmentCard.reconstructionNotice!,
    capturedAt: fixedTimestamp,
  };
  const revisionFixture = (revision: number, attemptId: string): LectureStudioRevisionV1 => ({
    schemaVersion: 1,
    id: randomUUID(),
    studioId: studio.id,
    revision,
    attemptId,
    sourceManifest: {
      schemaVersion: 1,
      selectedProjectIds: [projectId],
      literature: [
        {
          sourceLabel: 'L1',
          projectId,
          projectName: 'SQLCipher fixture project',
          recordId,
          recordVersion: 1,
          annotationVersion: 0,
          title: 'A bounded lecture source',
          authors: ['Ada Researcher'],
          containerTitle: 'Fixture Journal',
          publishedYear: 2026,
          doi: '10.0000/gosu.fixture',
          citationKey: 'researcher2026bounded',
          reviewStatus: 'included',
          topics: ['lecture studio'],
          metadataSummary: 'A metadata-only fixture for encrypted persistence.',
          metadataOnly: true,
        },
      ],
      experiments: [],
    },
    sourceManifestSha256: 'a'.repeat(64),
    lectureNotesMarkdown: `# Lecture notes revision ${revision}`,
    slidesMarkdown: `# Slides revision ${revision}`,
    artifacts: [
      {
        kind: 'lecture-notes',
        relativePath: `Lecture Studio/fixture/revision-${revision}/lecture-notes.md`,
        contentSha256: 'b'.repeat(64),
        savedAt: fixedTimestamp,
      },
      {
        kind: 'slides',
        relativePath: `Lecture Studio/fixture/revision-${revision}/slides.md`,
        contentSha256: 'c'.repeat(64),
        savedAt: fixedTimestamp,
      },
    ],
    invocation: {
      schemaVersion: 1,
      invocationId: randomUUID(),
      providerId: 'codex',
      requestedModelId: null,
      resolvedModelId: 'fixture-model',
      catalogVersion: 'fixture-catalog',
      reasoningOptionId: null,
      startedAt: fixedTimestamp,
    },
    createdAt: fixedTimestamp,
  });
  const latexRevisionFixture = (revision: number, attemptId: string): LectureStudioRevisionV2 => {
    const lectureNotesLatex = buildLectureLatexDocument(
      'lecture-notes',
      studio.title,
      String.raw`\section{정확한 V2 복원}
이 리비전은 암호화된 저장소에서 $f(x)=x^2+1$을 그대로 복원해야 한다.
\begin{theorem}
$x \in \mathbb{R}$이면 $f(x) \geq 1$이다.
\end{theorem}
\section{Sources used}
\begin{itemize}
\item [L1] A bounded lecture source.
\end{itemize}`,
    );
    const slidesLatex = buildLectureLatexDocument(
      'slides',
      studio.title,
      String.raw`\begin{frame}{정확한 V2 복원}
\begin{itemize}
\item 암호화 저장소를 닫았다 다시 열어도 $f(x)=x^2+1$을 보존한다.
\item 출처: [L1]
\end{itemize}
\end{frame}`,
    );
    return {
      schemaVersion: 2,
      id: randomUUID(),
      studioId: studio.id,
      revision,
      attemptId,
      sourceManifest: {
        ...revisionFixture(revision, attemptId).sourceManifest,
        schemaVersion: 2,
        manuscripts: [],
      },
      sourceManifestSha256: 'd'.repeat(64),
      lectureNotesLatex,
      slidesLatex,
      artifacts: [
        {
          kind: 'lecture-notes',
          relativePath: `Lecture Studio/fixture/revision-${revision}/Lecture Notes.tex`,
          contentSha256: createHash('sha256').update(lectureNotesLatex, 'utf8').digest('hex'),
          savedAt: fixedTimestamp,
        },
        {
          kind: 'slides',
          relativePath: `Lecture Studio/fixture/revision-${revision}/Slides.tex`,
          contentSha256: createHash('sha256').update(slidesLatex, 'utf8').digest('hex'),
          savedAt: fixedTimestamp,
        },
      ],
      invocation: revisionFixture(revision, attemptId).invocation,
      createdAt: fixedTimestamp,
    };
  };
  const provenanceRevisionFixture = (
    revision: number,
    attemptId: string,
    generationBriefSnapshot: LectureStudio['generationBrief'],
  ): LectureStudioRevisionV3 => {
    const base = latexRevisionFixture(revision, attemptId);
    const snapshot = structuredClone(generationBriefSnapshot);
    return {
      ...base,
      schemaVersion: 3,
      generationBriefSnapshot: snapshot,
      generationBriefSha256: createHash('sha256')
        .update(JSON.stringify(snapshot), 'utf8')
        .digest('hex'),
      authoringPolicyVersion: LECTURE_STUDIO_AUTHORING_POLICY_VERSION,
      authoringPolicySha256: createHash('sha256')
        .update(LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS, 'utf8')
        .digest('hex'),
    };
  };
  const externalLatexRevisionFixture = (
    revision: number,
    attemptId: string,
  ): LectureStudioRevisionV2 => {
    const base = latexRevisionFixture(revision, attemptId);
    const externalSourceId = randomUUID();
    const externalContent = '# Frozen external evidence\n\nSQLCipher must preserve [F1].';
    const externalBytes = Buffer.from(externalContent, 'utf8');
    const sourceManifest = {
      schemaVersion: 3 as const,
      selectedProjectIds: [projectId],
      literature: [],
      experiments: [],
      manuscripts: [],
      externalSources: [
        {
          schemaVersion: 1 as const,
          id: externalSourceId,
          projectId,
          studioId: studio.id,
          displayName: 'frozen-evidence.md',
          kind: 'markdown' as const,
          mediaType: 'text/markdown' as const,
          byteSize: externalBytes.byteLength,
          sourceSha256: createHash('sha256').update(externalBytes).digest('hex'),
          extraction: {
            policyVersion: 1 as const,
            characterBudget: 40_000,
            unitLabel: 'part' as const,
            unitCount: 1,
            content: externalContent,
            contentSha256: createHash('sha256').update(externalContent, 'utf8').digest('hex'),
            extractedCharacters: externalContent.length,
            truncated: false,
            textAvailable: true,
            reconstructionNotice: 'Exact UTF-8 Markdown text imported by GOSU.',
          },
          importedAt: fixedTimestamp,
          sourceLabel: 'F1',
        },
      ],
    };
    return {
      ...base,
      sourceManifest,
      sourceManifestSha256: createHash('sha256')
        .update(JSON.stringify(sourceManifest), 'utf8')
        .digest('hex'),
    };
  };
  const attachmentLatexRevisionFixture = (
    revision: number,
    attemptId: string,
  ): LectureStudioRevisionV2 => {
    const base = latexRevisionFixture(revision, attemptId);
    const sourceManifest = {
      schemaVersion: 4 as const,
      selectedProjectIds: [projectId],
      literature: [],
      experiments: [],
      manuscripts: [],
      externalSources: [],
      turnAttachments: [attachmentSnapshot],
    };
    return {
      ...base,
      sourceManifest,
      sourceManifestSha256: createHash('sha256')
        .update(JSON.stringify(sourceManifest), 'utf8')
        .digest('hex'),
    };
  };
  const assistantMessage = (
    attemptId: string,
    revision: number,
    id: string = randomUUID(),
  ): LectureStudioMessage => ({
    schemaVersion: 1,
    id,
    studioId: studio.id,
    role: 'assistant',
    status: 'complete',
    content: `Completed lecture revision ${revision}.`,
    attemptId,
    revision,
    invocation: revisionFixture(revision, attemptId).invocation,
    createdAt: fixedTimestamp,
    completedAt: fixedTimestamp,
  });

  let database = new LocalDatabase();
  database.open();
  invariant(database.createLectureStudio(studio), 'lecture_studio_insert_failed');
  const summaries = database.listLectureStudios();
  invariant(summaries.length === 1, 'lecture_studio_summary_missing');
  invariant(
    !('sourceSelection' in (summaries[0] as unknown as Record<string, unknown>)),
    'lecture_studio_list_leaked_source_selection',
  );
  const initialDetail = database.getLectureStudioDetail(studio.id);
  invariant(initialDetail !== null, 'lecture_studio_detail_missing');
  invariant(
    initialDetail.studio.sourceSelection.literature[0]?.recordId === recordId,
    'lecture_studio_detail_lost_source_selection',
  );
  invariant(
    initialDetail.messages.length === 0 && initialDetail.revisions.length === 0,
    'lecture_studio_detail_started_with_history',
  );

  // New, non-default generation controls must survive an encrypted database reopen.
  database.close();
  const generationRoundTrip = new LocalDatabase();
  generationRoundTrip.open();
  invariant(
    JSON.stringify(generationRoundTrip.getLectureStudio(studio.id)?.generationBrief) ===
      JSON.stringify(studio.generationBrief),
    'lecture_generation_brief_was_not_persisted_after_reopen',
  );
  const editedBrief = {
    notesTargetPages: 30,
    slidesTargetPages: 40,
    detailLevel: 'exhaustive' as const,
    structure: {
      mode: 'custom' as const,
      sections: [
        { title: 'Evidence', coverage: 'notes-and-slides' as const },
        { title: 'Technical appendix', coverage: 'notes-only' as const },
      ],
    },
    documentFeatures: {
      includeSlideTitlePage: true,
      showInlineEvidenceLabels: true,
      includeSourcesUsedSection: true,
    },
    customInstructions: 'Persist this revised generation policy.',
  };
  const generationUpdateStudio: LectureStudio = {
    ...studio,
    id: randomUUID(),
    title: 'Generation brief update fixture',
    generationBrief: {
      ...studio.generationBrief,
      documentFeatures: {
        includeSlideTitlePage: true,
        showInlineEvidenceLabels: true,
        includeSourcesUsedSection: true,
      },
    },
  };
  invariant(
    generationRoundTrip.createLectureStudio(generationUpdateStudio),
    'lecture_generation_brief_update_fixture_insert_failed',
  );
  const editedStudio = generationRoundTrip.updateLectureStudioGenerationBrief(
    generationUpdateStudio.id,
    generationUpdateStudio.version,
    editedBrief,
    fixedTimestamp,
  );
  invariant(
    editedStudio?.version === generationUpdateStudio.version + 1 &&
      JSON.stringify(editedStudio.generationBrief) === JSON.stringify(editedBrief) &&
      generationRoundTrip.listLectureStudioRevisions(generationUpdateStudio.id, 10).length === 0,
    'lecture_generation_brief_update_failed_or_mutated_history',
  );
  invariant(
    generationRoundTrip.updateLectureStudioGenerationBrief(
      generationUpdateStudio.id,
      generationUpdateStudio.version,
      generationUpdateStudio.generationBrief,
      fixedTimestamp,
    ) === null,
    'lecture_generation_brief_stale_version_was_accepted',
  );
  generationRoundTrip.close();

  const generationUpdateReopen = new LocalDatabase();
  generationUpdateReopen.open();
  const reopenedEditedStudio = generationUpdateReopen.getLectureStudio(generationUpdateStudio.id);
  const reopenedCustomStructure = reopenedEditedStudio?.generationBrief.structure;
  invariant(
    reopenedEditedStudio?.version === editedStudio.version &&
      JSON.stringify(reopenedEditedStudio.generationBrief) === JSON.stringify(editedBrief) &&
      reopenedCustomStructure?.mode === 'custom' &&
      isDeepStrictEqual(reopenedCustomStructure.sections, editedBrief.structure.sections),
    'lecture_generation_brief_update_was_not_persisted_after_reopen',
  );
  const updateRaceAttemptId = randomUUID();
  const turnBrief = {
    ...editedBrief,
    documentFeatures: {
      includeSlideTitlePage: false,
      showInlineEvidenceLabels: false,
      includeSourcesUsedSection: false,
    },
    customInstructions: 'Persist the Assistant directive even if this turn fails.',
  };
  const updateRaceGenerating = generationUpdateReopen.beginLectureStudioTurn({
    studioId: generationUpdateStudio.id,
    expectedVersion: reopenedEditedStudio.version,
    attemptId: updateRaceAttemptId,
    userMessage: null,
    updatedAt: fixedTimestamp,
    generationBrief: turnBrief,
  });
  invariant(
    updateRaceGenerating !== null &&
      isDeepStrictEqual(updateRaceGenerating.generationBrief, turnBrief) &&
      isDeepStrictEqual(
        generationUpdateReopen.getLectureStudio(generationUpdateStudio.id)?.generationBrief,
        turnBrief,
      ),
    'lecture_generation_brief_turn_override_was_not_persisted_atomically',
  );
  invariant(
    generationUpdateReopen.updateLectureStudioGenerationBrief(
      generationUpdateStudio.id,
      updateRaceGenerating.version,
      generationUpdateStudio.generationBrief,
      fixedTimestamp,
    ) === null,
    'lecture_generation_brief_update_won_after_generation_started',
  );
  const updateRaceFailed = generationUpdateReopen.failLectureStudioTurn({
    studioId: generationUpdateStudio.id,
    attemptId: updateRaceAttemptId,
    errorCode: 'fixture_race_complete',
    messageStatus: 'interrupted',
    updatedAt: fixedTimestamp,
  });
  invariant(
    updateRaceFailed !== null && isDeepStrictEqual(updateRaceFailed.generationBrief, turnBrief),
    'lecture_generation_brief_turn_override_was_not_retained_after_failure',
  );
  const trashedUpdateFixture = generationUpdateReopen.setLectureStudioTrashed(
    generationUpdateStudio.id,
    updateRaceFailed.version,
    fixedTimestamp,
    fixedTimestamp,
  );
  invariant(
    trashedUpdateFixture?.trashedAt !== undefined,
    'lecture_generation_brief_fixture_trash_failed',
  );
  invariant(
    generationUpdateReopen.emptyLectureStudioTrash(
      {
        idempotencyKey: randomUUID(),
        confirmation: 'EMPTY LECTURE TRASH',
        targets: [
          {
            studioId: trashedUpdateFixture.id,
            expectedVersion: trashedUpdateFixture.version,
            trashedAt: trashedUpdateFixture.trashedAt,
          },
        ],
      },
      fixedTimestamp,
    )?.removedStudios.length === 1 &&
      generationUpdateReopen.getLectureStudio(generationUpdateStudio.id) === null,
    'lecture_generation_brief_fixture_cleanup_failed',
  );
  generationUpdateReopen.close();

  // Simulate a studio persisted before both Manuscript sources and generation controls existed.
  // Reopening must add the column, restore the safe default, and normalize the old selection.
  const legacyLectureKeyHex = safeStorage
    .decryptString(readFileSync(join(app.getPath('userData'), 'local-key.bin')))
    .trim();
  const legacyAttachmentMessageId = randomUUID();
  const legacyLectureRow = new Database(join(app.getPath('userData'), 'gosu.db'));
  legacyLectureRow.pragma(`key="x'${legacyLectureKeyHex}'"`);
  try {
    legacyLectureRow.exec('alter table lecture_studios drop column generation_brief_json');
    legacyLectureRow.exec('alter table lecture_studio_messages drop column attachments_json');
    legacyLectureRow
      .prepare('update lecture_studios set source_selection_json=? where id=?')
      .run(JSON.stringify({ literature: [{ projectId, recordId }], experiments: [] }), studio.id);
    legacyLectureRow
      .prepare(
        `insert into lecture_studio_messages(
           id,schema_version,studio_id,role,status,content,attempt_id,revision,
           invocation_json,created_at,completed_at
         ) values(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        legacyAttachmentMessageId,
        1,
        studio.id,
        'user',
        'failed',
        'Legacy Lecture Assistant message without attachment storage.',
        null,
        null,
        null,
        fixedTimestamp,
        fixedTimestamp,
      );
  } finally {
    legacyLectureRow.close();
  }
  database = new LocalDatabase();
  database.open();
  const legacyDetail = database.getLectureStudioDetail(studio.id);
  invariant(
    legacyDetail?.studio.sourceSelection.literature[0]?.recordId === recordId &&
      legacyDetail.studio.sourceSelection.manuscripts.length === 0 &&
      JSON.stringify(legacyDetail.studio.generationBrief) ===
        JSON.stringify({
          notesTargetPages: null,
          slidesTargetPages: null,
          detailLevel: 'standard',
          structure: { mode: 'adaptive' },
          customInstructions: '',
        }),
    'legacy_lecture_selection_was_not_normalized_after_reopen',
  );
  const legacyAttachmentMessage = legacyDetail.messages.find(
    (message) => message.id === legacyAttachmentMessageId,
  );
  invariant(
    legacyAttachmentMessage !== undefined && legacyAttachmentMessage.attachments === undefined,
    'legacy_lecture_message_did_not_decode_null_attachments_as_undefined',
  );

  // A generation brief written before structure templates existed must retain its other controls
  // while receiving the adaptive structure default after a full encrypted-database reopen.
  database.close();
  const legacyGenerationBriefWithoutStructure = {
    notesTargetPages: 18,
    slidesTargetPages: 26,
    detailLevel: 'detailed',
    customInstructions: 'Legacy generation brief without a structure field.',
  };
  const legacyGenerationBriefRow = new Database(join(app.getPath('userData'), 'gosu.db'));
  legacyGenerationBriefRow.pragma(`key="x'${legacyLectureKeyHex}'"`);
  try {
    legacyGenerationBriefRow
      .prepare('update lecture_studios set generation_brief_json=? where id=?')
      .run(JSON.stringify(legacyGenerationBriefWithoutStructure), studio.id);
  } finally {
    legacyGenerationBriefRow.close();
  }
  database = new LocalDatabase();
  database.open();
  invariant(
    isDeepStrictEqual(database.getLectureStudio(studio.id)?.generationBrief, {
      ...legacyGenerationBriefWithoutStructure,
      structure: { mode: 'adaptive' },
    }),
    'legacy_lecture_generation_brief_without_structure_did_not_default_to_adaptive_after_reopen',
  );

  // Historical custom section titles such as References were valid before document-level
  // controls became configurable. Reopening must retain their exact bytes so the Main service
  // can grandfather the existing content topic without changing provenance.
  database.close();
  const legacyCustomReferencesBrief = {
    notesTargetPages: 18,
    slidesTargetPages: 26,
    detailLevel: 'detailed',
    structure: {
      mode: 'custom',
      sections: [{ title: 'References', coverage: 'notes-and-slides' }],
    },
    customInstructions: 'Historical custom References topic.',
  };
  const legacyCustomReferencesRow = new Database(join(app.getPath('userData'), 'gosu.db'));
  legacyCustomReferencesRow.pragma(`key="x'${legacyLectureKeyHex}'"`);
  try {
    legacyCustomReferencesRow
      .prepare('update lecture_studios set generation_brief_json=? where id=?')
      .run(JSON.stringify(legacyCustomReferencesBrief), studio.id);
  } finally {
    legacyCustomReferencesRow.close();
  }
  database = new LocalDatabase();
  database.open();
  invariant(
    JSON.stringify(database.getLectureStudio(studio.id)?.generationBrief) ===
      JSON.stringify(legacyCustomReferencesBrief),
    'legacy_custom_references_brief_changed_after_reopen',
  );

  const failedAttemptId = randomUUID();
  const failedUser = userMessage(failedAttemptId, 'This edit must fail.');
  const failedGenerating = database.beginLectureStudioTurn({
    studioId: studio.id,
    expectedVersion: studio.version,
    attemptId: failedAttemptId,
    userMessage: failedUser,
    updatedAt: fixedTimestamp,
    attempt: {
      schemaVersion: 1,
      id: failedAttemptId,
      studioId: studio.id,
      status: 'running',
      requestedModelId: null,
      resolvedModelId: null,
      providerId: null,
      catalogVersion: null,
      reasoningOptionId: 'high',
      phases: [],
      validations: [],
      terminalCode: null,
      startedAt: fixedTimestamp,
      completedAt: null,
    },
  });
  invariant(failedGenerating?.status === 'generating', 'lecture_failed_turn_did_not_begin');
  invariant(
    database.recordLectureStudioAttemptPhase(studio.id, failedAttemptId, {
      phase: 'preparing_sources',
      sequence: 1,
      occurredAt: fixedTimestamp,
    })?.phases.length === 1 &&
      database.recordLectureStudioAttemptPhase(studio.id, failedAttemptId, {
        phase: 'validating_output',
        sequence: 5,
        occurredAt: fixedTimestamp,
      })?.phases.length === 2,
    'lecture_attempt_phases_were_not_persisted',
  );
  invariant(
    database.recordLectureStudioAttemptValidation(studio.id, failedAttemptId, {
      pass: 'initial',
      category: 'latex_grammar',
      diagnostics: [{ document: 'lecture-notes', reason: 'unsupported_command', tokenCount: 2 }],
      recordedAt: fixedTimestamp,
    })?.validations.length === 1 &&
      database.recordLectureStudioAttemptValidation(studio.id, failedAttemptId, {
        pass: 'correction',
        category: 'latex_grammar',
        diagnostics: [{ document: 'slides', reason: 'control_character', tokenCount: 0 }],
        recordedAt: fixedTimestamp,
      })?.validations.length === 2,
    'lecture_attempt_validations_were_not_persisted',
  );
  const failedInvocation = revisionFixture(1, failedAttemptId).invocation;
  invariant(
    database.recordLectureStudioAttemptInvocation(studio.id, failedAttemptId, failedInvocation)
      ?.resolvedModelId === failedInvocation.resolvedModelId,
    'lecture_attempt_invocation_was_not_persisted',
  );
  invariant(
    database.beginLectureStudioTurn({
      studioId: studio.id,
      expectedVersion: studio.version,
      attemptId: randomUUID(),
      userMessage: null,
      updatedAt: fixedTimestamp,
    }) === null,
    'lecture_duplicate_begin_was_not_rejected',
  );
  const failedStudio = database.failLectureStudioTurn({
    studioId: studio.id,
    attemptId: failedAttemptId,
    errorCode: 'lecture_invalid_latex_grammar',
    messageStatus: 'failed',
    updatedAt: fixedTimestamp,
  });
  invariant(failedStudio?.status === 'failed', 'lecture_failed_turn_was_not_finalized');
  invariant(
    database.listLectureStudioMessages(studio.id, 10)[0]?.status === 'failed',
    'lecture_failed_user_message_remained_complete',
  );
  const failedAttempt = database.getLatestLectureStudioAttempt(studio.id);
  invariant(
    failedAttempt?.status === 'failed' &&
      failedAttempt.terminalCode === 'lecture_invalid_latex_grammar' &&
      failedAttempt.resolvedModelId === failedInvocation.resolvedModelId &&
      failedAttempt.providerId === failedInvocation.providerId &&
      failedAttempt.catalogVersion === failedInvocation.catalogVersion &&
      failedAttempt.phases.length === 2 &&
      failedAttempt.validations.length === 2 &&
      database.getLectureStudioDetail(studio.id)?.lastAttempt?.id === failedAttemptId,
    'lecture_failed_attempt_diagnostics_or_model_identity_were_not_finalized_atomically',
  );

  const interruptedAttemptId = randomUUID();
  const interruptedUser = userMessage(interruptedAttemptId, 'This edit is interrupted by restart.');
  const interruptedGenerating = database.beginLectureStudioTurn({
    studioId: studio.id,
    expectedVersion: failedStudio.version,
    attemptId: interruptedAttemptId,
    userMessage: interruptedUser,
    updatedAt: fixedTimestamp,
    attempt: {
      schemaVersion: 1,
      id: interruptedAttemptId,
      studioId: studio.id,
      status: 'running',
      requestedModelId: 'fixture-requested-model',
      resolvedModelId: null,
      providerId: null,
      catalogVersion: null,
      reasoningOptionId: 'high',
      phases: [],
      validations: [],
      terminalCode: null,
      startedAt: fixedTimestamp,
      completedAt: null,
    },
  });
  invariant(interruptedGenerating !== null, 'lecture_interrupted_turn_did_not_begin');
  database.close();

  const reopened = new LocalDatabase();
  reopened.open();
  const interruptedStudio = reopened.getLectureStudio(studio.id);
  invariant(
    interruptedStudio?.status === 'failed' &&
      interruptedStudio.lastErrorCode === 'application_interrupted',
    'lecture_restart_did_not_reconcile_generating_studio',
  );
  invariant(
    reopened
      .listLectureStudioMessages(studio.id, 10)
      .find((message) => message.id === interruptedUser.id)?.status === 'interrupted',
    'lecture_restart_did_not_interrupt_active_user_message',
  );
  invariant(
    reopened.getLatestLectureStudioAttempt(studio.id)?.status === 'interrupted' &&
      reopened.getLatestLectureStudioAttempt(studio.id)?.terminalCode === 'application_interrupted',
    'lecture_restart_did_not_reconcile_running_attempt_diagnostics',
  );

  const successfulAttemptId = randomUUID();
  const successfulUser = userMessage(successfulAttemptId, 'Generate the first revision.');
  const successfulGenerating = reopened.beginLectureStudioTurn({
    studioId: studio.id,
    expectedVersion: interruptedStudio.version,
    attemptId: successfulAttemptId,
    userMessage: successfulUser,
    updatedAt: fixedTimestamp,
    attempt: {
      schemaVersion: 1,
      id: successfulAttemptId,
      studioId: studio.id,
      status: 'running',
      requestedModelId: null,
      resolvedModelId: null,
      providerId: null,
      catalogVersion: null,
      reasoningOptionId: 'high',
      phases: [],
      validations: [],
      terminalCode: null,
      startedAt: fixedTimestamp,
      completedAt: null,
    },
  });
  invariant(successfulGenerating !== null, 'lecture_successful_turn_did_not_begin');
  const firstRevision = revisionFixture(1, successfulAttemptId);
  const firstAssistant = assistantMessage(successfulAttemptId, 1);
  invariant(
    reopened.completeLectureStudioTurn({
      studio: {
        ...successfulGenerating,
        generationBrief: {
          ...successfulGenerating.generationBrief,
          detailLevel: 'exhaustive',
        },
        status: 'ready',
        activeAttemptId: null,
        currentRevision: 1,
        version: successfulGenerating.version + 1,
        lastErrorCode: null,
        updatedAt: fixedTimestamp,
      },
      revision: firstRevision,
      assistantMessage: firstAssistant,
    }) === null,
    'lecture_generation_brief_changed_during_completion',
  );
  const readyStudio = reopened.completeLectureStudioTurn({
    studio: {
      ...successfulGenerating,
      status: 'ready',
      activeAttemptId: null,
      currentRevision: 1,
      version: successfulGenerating.version + 1,
      lastErrorCode: null,
      updatedAt: fixedTimestamp,
    },
    revision: firstRevision,
    assistantMessage: firstAssistant,
  });
  invariant(
    readyStudio?.status === 'ready' && readyStudio.currentRevision === 1,
    'lecture_completion_was_not_persisted',
  );
  invariant(
    reopened.getCurrentLectureStudioRevision(studio.id)?.id === firstRevision.id,
    'lecture_current_revision_missing',
  );
  invariant(
    reopened.getLatestLectureStudioAttempt(studio.id)?.status === 'succeeded' &&
      reopened.getLatestLectureStudioAttempt(studio.id)?.terminalCode === null &&
      reopened.getLatestLectureStudioAttempt(studio.id)?.resolvedModelId ===
        firstRevision.invocation.resolvedModelId,
    'lecture_success_attempt_was_not_finalized_with_the_revision',
  );

  const latexAttemptId = randomUUID();
  const latexUser = userMessage(latexAttemptId, 'Generate the canonical LaTeX V2 revision.');
  const latexGenerating = reopened.beginLectureStudioTurn({
    studioId: studio.id,
    expectedVersion: readyStudio.version,
    attemptId: latexAttemptId,
    userMessage: latexUser,
    updatedAt: fixedTimestamp,
  });
  invariant(latexGenerating !== null, 'lecture_latex_v2_turn_did_not_begin');
  const latexRevision = latexRevisionFixture(2, latexAttemptId);
  const latexAssistant = assistantMessage(latexAttemptId, 2);
  const latexReadyStudio = reopened.completeLectureStudioTurn({
    studio: {
      ...latexGenerating,
      status: 'ready',
      activeAttemptId: null,
      currentRevision: 2,
      version: latexGenerating.version + 1,
      lastErrorCode: null,
      updatedAt: fixedTimestamp,
    },
    revision: latexRevision,
    assistantMessage: latexAssistant,
  });
  invariant(
    latexReadyStudio?.currentRevision === 2 &&
      isDeepStrictEqual(reopened.getCurrentLectureStudioRevision(studio.id), latexRevision),
    'lecture_latex_v2_revision_was_not_decoded_exactly_before_reopen',
  );
  reopened.close();

  const encryptedLatexKeyHex = safeStorage
    .decryptString(readFileSync(join(app.getPath('userData'), 'local-key.bin')))
    .trim();
  const encryptedLatexInspection = new Database(join(app.getPath('userData'), 'gosu.db'));
  encryptedLatexInspection.pragma(`key="x'${encryptedLatexKeyHex}'"`);
  try {
    const latexColumns = encryptedLatexInspection.pragma(
      'table_info(lecture_studio_revisions)',
    ) as Array<{ name: string }>;
    const latexRow = encryptedLatexInspection
      .prepare(
        `select lecture_notes_markdown,slides_markdown,lecture_notes_latex,
                slides_latex,artifacts_json
         from lecture_studio_revisions where id=?`,
      )
      .get(latexRevision.id) as
      | {
          lecture_notes_markdown: string;
          slides_markdown: string;
          lecture_notes_latex: string | null;
          slides_latex: string | null;
          artifacts_json: string;
        }
      | undefined;
    invariant(
      latexColumns.some((column) => column.name === 'lecture_notes_latex') &&
        latexColumns.some((column) => column.name === 'slides_latex'),
      'lecture_latex_v2_columns_missing_after_reopen',
    );
    invariant(
      latexRow?.lecture_notes_markdown === 'GOSU_LATEX_V2' &&
        latexRow.slides_markdown === 'GOSU_LATEX_V2' &&
        latexRow.lecture_notes_latex === latexRevision.lectureNotesLatex &&
        latexRow.slides_latex === latexRevision.slidesLatex &&
        latexRow.artifacts_json === JSON.stringify(latexRevision.artifacts),
      'lecture_latex_v2_columns_or_artifacts_changed_in_encrypted_storage',
    );
    let rejectedHalfLatexPair = false;
    try {
      encryptedLatexInspection
        .prepare('update lecture_studio_revisions set slides_latex=null where id=?')
        .run(latexRevision.id);
    } catch (error) {
      rejectedHalfLatexPair =
        error instanceof Error && error.message.includes('lecture_revision_latex_pair_required');
    }
    invariant(rejectedHalfLatexPair, 'lecture_latex_v2_pair_constraint_was_not_enforced');
  } finally {
    encryptedLatexInspection.close();
  }

  const latexReopened = new LocalDatabase();
  latexReopened.open();
  const decodedV1AndV2 = latexReopened.listLectureStudioRevisions(studio.id, 10);
  invariant(
    decodedV1AndV2.length === 2 &&
      decodedV1AndV2[0]?.schemaVersion === 1 &&
      decodedV1AndV2[1]?.schemaVersion === 2 &&
      isDeepStrictEqual(decodedV1AndV2[1], latexRevision) &&
      isDeepStrictEqual(latexReopened.getCurrentLectureStudioRevision(studio.id), latexRevision),
    'lecture_revision_union_did_not_decode_v1_and_v2_exactly_after_reopen',
  );

  const atomicAttemptId = randomUUID();
  const atomicUser = userMessage(atomicAttemptId, 'Force an atomic completion rollback.');
  const atomicGenerating = latexReopened.beginLectureStudioTurn({
    studioId: studio.id,
    expectedVersion: latexReadyStudio.version,
    attemptId: atomicAttemptId,
    userMessage: atomicUser,
    updatedAt: fixedTimestamp,
  });
  invariant(atomicGenerating !== null, 'lecture_atomic_turn_did_not_begin');
  let atomicCompletionRejected = false;
  try {
    latexReopened.completeLectureStudioTurn({
      studio: {
        ...atomicGenerating,
        status: 'ready',
        activeAttemptId: null,
        currentRevision: 3,
        version: atomicGenerating.version + 1,
        lastErrorCode: null,
        updatedAt: fixedTimestamp,
      },
      revision: revisionFixture(3, atomicAttemptId),
      assistantMessage: assistantMessage(atomicAttemptId, 3, latexAssistant.id),
    });
  } catch {
    atomicCompletionRejected = true;
  }
  invariant(atomicCompletionRejected, 'lecture_atomic_completion_fixture_did_not_fail');
  invariant(
    latexReopened.getLectureStudio(studio.id)?.status === 'generating' &&
      latexReopened.listLectureStudioRevisions(studio.id, 10).length === 2 &&
      latexReopened.getLectureStudioRevision(studio.id, 3) === null,
    'lecture_completion_transaction_did_not_roll_back',
  );
  invariant(
    latexReopened.failLectureStudioTurn({
      studioId: studio.id,
      attemptId: atomicAttemptId,
      errorCode: 'fixture_atomic_failure',
      messageStatus: 'failed',
      updatedAt: fixedTimestamp,
    })?.status === 'failed',
    'lecture_atomic_turn_cleanup_failed',
  );
  invariant(
    latexReopened.listLectureStudioMessages(studio.id, 2).length === 2 &&
      latexReopened.listLectureStudioRevisions(studio.id, 1).length === 1,
    'lecture_history_queries_were_not_bounded',
  );
  let invalidLimitRejected = false;
  try {
    latexReopened.listLectureStudioMessages(studio.id, 0);
  } catch (error) {
    invalidLimitRejected =
      error instanceof Error && error.message === 'invalid_lecture_query_limit';
  }
  invariant(invalidLimitRejected, 'lecture_invalid_history_limit_was_not_rejected');

  const externalAttemptId = randomUUID();
  const studioAfterAtomicFailure = latexReopened.getLectureStudio(studio.id);
  invariant(studioAfterAtomicFailure !== null, 'lecture_external_v3_studio_missing');
  const externalGenerating = latexReopened.beginLectureStudioTurn({
    studioId: studio.id,
    expectedVersion: studioAfterAtomicFailure.version,
    attemptId: externalAttemptId,
    userMessage: userMessage(externalAttemptId, 'Persist frozen external evidence.'),
    updatedAt: fixedTimestamp,
  });
  invariant(externalGenerating !== null, 'lecture_external_v3_turn_did_not_begin');
  const externalRevision = externalLatexRevisionFixture(3, externalAttemptId);
  const externalReady = latexReopened.completeLectureStudioTurn({
    studio: {
      ...externalGenerating,
      status: 'ready',
      activeAttemptId: null,
      currentRevision: 3,
      version: externalGenerating.version + 1,
      lastErrorCode: null,
      updatedAt: fixedTimestamp,
    },
    revision: externalRevision,
    assistantMessage: assistantMessage(externalAttemptId, 3),
  });
  invariant(
    externalReady?.currentRevision === 3 &&
      isDeepStrictEqual(latexReopened.getCurrentLectureStudioRevision(studio.id), externalRevision),
    'lecture_external_v3_revision_was_not_decoded_exactly_before_reopen',
  );

  const attachmentAttemptId = randomUUID();
  const malformedAttachmentUser = {
    ...userMessage(attachmentAttemptId, 'Reject unsafe attachment receipt fields.'),
    attachments: [
      {
        ...attachmentCard,
        localPath: '/private/turn-evidence.tex',
        content: attachmentContent,
        studioId: studio.id,
      },
    ],
  } as unknown as LectureStudioMessage;
  let malformedAttachmentRejected = false;
  try {
    latexReopened.beginLectureStudioTurn({
      studioId: studio.id,
      expectedVersion: externalReady.version,
      attemptId: attachmentAttemptId,
      userMessage: malformedAttachmentUser,
      updatedAt: fixedTimestamp,
    });
  } catch {
    malformedAttachmentRejected = true;
  }
  invariant(
    malformedAttachmentRejected &&
      latexReopened.getLectureStudio(studio.id)?.status === 'ready' &&
      latexReopened.getLectureStudio(studio.id)?.version === externalReady.version &&
      !latexReopened
        .listLectureStudioMessages(studio.id, 50)
        .some((message) => message.id === malformedAttachmentUser.id),
    'lecture_message_accepted_unsafe_attachment_receipt_fields',
  );

  const attachmentUser: LectureStudioMessage = {
    ...userMessage(attachmentAttemptId, 'Use the attached LaTeX evidence in this revision.'),
    attachments: [attachmentCard],
  };
  const attachmentGenerating = latexReopened.beginLectureStudioTurn({
    studioId: studio.id,
    expectedVersion: externalReady.version,
    attemptId: attachmentAttemptId,
    userMessage: attachmentUser,
    updatedAt: fixedTimestamp,
  });
  invariant(attachmentGenerating !== null, 'lecture_attachment_v4_turn_did_not_begin');
  const attachmentRevision = attachmentLatexRevisionFixture(4, attachmentAttemptId);
  invariant(
    attachmentRevision.sourceManifest.schemaVersion === 4,
    'lecture_attachment_fixture_was_not_v4',
  );
  const wrongStudioAttachmentRevision: LectureStudioRevisionV2 = {
    ...attachmentRevision,
    sourceManifest: {
      ...attachmentRevision.sourceManifest,
      turnAttachments: [{ ...attachmentSnapshot, studioId: randomUUID() }],
    },
  };
  let wrongStudioRevisionRejected = false;
  try {
    latexReopened.completeLectureStudioTurn({
      studio: {
        ...attachmentGenerating,
        status: 'ready',
        activeAttemptId: null,
        currentRevision: 4,
        version: attachmentGenerating.version + 1,
        lastErrorCode: null,
        updatedAt: fixedTimestamp,
      },
      revision: wrongStudioAttachmentRevision,
      assistantMessage: assistantMessage(attachmentAttemptId, 4),
    });
  } catch {
    wrongStudioRevisionRejected = true;
  }
  invariant(
    wrongStudioRevisionRejected &&
      latexReopened.getLectureStudio(studio.id)?.status === 'generating' &&
      latexReopened.getLectureStudioRevision(studio.id, 4) === null,
    'lecture_wrong_studio_v4_attachment_revision_did_not_fail_closed',
  );
  const attachmentReady = latexReopened.completeLectureStudioTurn({
    studio: {
      ...attachmentGenerating,
      status: 'ready',
      activeAttemptId: null,
      currentRevision: 4,
      version: attachmentGenerating.version + 1,
      lastErrorCode: null,
      updatedAt: fixedTimestamp,
    },
    revision: attachmentRevision,
    assistantMessage: assistantMessage(attachmentAttemptId, 4),
  });
  const attachmentMessageBeforeReopen = latexReopened
    .listLectureStudioMessages(studio.id, 50)
    .find((message) => message.id === attachmentUser.id);
  const persistedAttachmentCard = attachmentMessageBeforeReopen?.attachments?.[0];
  invariant(
    attachmentReady?.currentRevision === 4 &&
      isDeepStrictEqual(
        latexReopened.getCurrentLectureStudioRevision(studio.id),
        attachmentRevision,
      ) &&
      isDeepStrictEqual(attachmentMessageBeforeReopen?.attachments, [attachmentCard]) &&
      persistedAttachmentCard !== undefined &&
      !('path' in persistedAttachmentCard) &&
      !('localPath' in persistedAttachmentCard) &&
      !('content' in persistedAttachmentCard) &&
      !('body' in persistedAttachmentCard) &&
      !('studioId' in persistedAttachmentCard),
    'lecture_attachment_card_or_v4_revision_changed_before_reopen',
  );

  const provenanceAttemptId = randomUUID();
  const provenanceGenerating = latexReopened.beginLectureStudioTurn({
    studioId: studio.id,
    expectedVersion: attachmentReady.version,
    attemptId: provenanceAttemptId,
    userMessage: userMessage(
      provenanceAttemptId,
      'Persist the complete generation brief and authoring policy provenance.',
    ),
    updatedAt: fixedTimestamp,
    generationBrief: {
      ...attachmentReady.generationBrief,
      documentFeatures: {
        includeSlideTitlePage: true,
        showInlineEvidenceLabels: true,
        includeSourcesUsedSection: true,
      },
    },
  });
  invariant(provenanceGenerating !== null, 'lecture_provenance_v3_turn_did_not_begin');
  const provenanceRevision = provenanceRevisionFixture(
    5,
    provenanceAttemptId,
    provenanceGenerating.generationBrief,
  );
  const provenanceReady = latexReopened.completeLectureStudioTurn({
    studio: {
      ...provenanceGenerating,
      status: 'ready',
      activeAttemptId: null,
      currentRevision: 5,
      version: provenanceGenerating.version + 1,
      lastErrorCode: null,
      updatedAt: fixedTimestamp,
    },
    revision: provenanceRevision,
    assistantMessage: assistantMessage(provenanceAttemptId, 5),
  });
  invariant(
    provenanceReady?.currentRevision === 5 &&
      isDeepStrictEqual(
        latexReopened.getCurrentLectureStudioRevision(studio.id),
        provenanceRevision,
      ),
    'lecture_provenance_v3_revision_changed_before_reopen',
  );
  latexReopened.close();

  const provenanceRoundTrip = new LocalDatabase();
  provenanceRoundTrip.open();
  invariant(
    isDeepStrictEqual(
      provenanceRoundTrip.getLectureStudioRevision(studio.id, 5),
      provenanceRevision,
    ) &&
      isDeepStrictEqual(
        provenanceRoundTrip.getCurrentLectureStudioRevision(studio.id),
        provenanceRevision,
      ),
    'lecture_provenance_v3_revision_was_not_persisted_exactly_after_reopen',
  );
  provenanceRoundTrip.close();

  // Revision rows are append-only through the application. Simulate encrypted-file corruption by
  // temporarily removing the raw SQL update guard, then prove the decoder rejects a brief/hash
  // mismatch. The canonical hash is restored before the rest of the smoke test continues.
  const corruptProvenanceRow = new Database(join(app.getPath('userData'), 'gosu.db'));
  corruptProvenanceRow.pragma(`key="x'${legacyLectureKeyHex}'"`);
  try {
    corruptProvenanceRow.exec('drop trigger if exists lecture_studio_revisions_update_guard');
    corruptProvenanceRow
      .prepare('update lecture_studio_revisions set generation_brief_sha256=? where id=?')
      .run('f'.repeat(64), provenanceRevision.id);
  } finally {
    corruptProvenanceRow.close();
  }
  const mismatchedProvenance = new LocalDatabase();
  mismatchedProvenance.open();
  let mismatchedProvenanceRejected = false;
  try {
    mismatchedProvenance.getLectureStudioRevision(studio.id, 5);
  } catch (error) {
    mismatchedProvenanceRejected =
      error instanceof Error && error.message === 'invalid_lecture_revision_generation_brief_hash';
  }
  invariant(
    mismatchedProvenanceRejected,
    'lecture_provenance_v3_mismatched_generation_brief_hash_did_not_fail_closed',
  );
  mismatchedProvenance.close();

  const restoreProvenanceRow = new Database(join(app.getPath('userData'), 'gosu.db'));
  restoreProvenanceRow.pragma(`key="x'${legacyLectureKeyHex}'"`);
  try {
    restoreProvenanceRow.exec('drop trigger if exists lecture_studio_revisions_update_guard');
    restoreProvenanceRow
      .prepare('update lecture_studio_revisions set generation_brief_sha256=? where id=?')
      .run(provenanceRevision.generationBriefSha256, provenanceRevision.id);
  } finally {
    restoreProvenanceRow.close();
  }

  const persisted = new LocalDatabase();
  persisted.open();
  const attachmentMessageAfterReopen = persisted
    .listLectureStudioMessages(studio.id, 50)
    .find((message) => message.id === attachmentUser.id);
  invariant(
    isDeepStrictEqual(persisted.getCurrentLectureStudioRevision(studio.id), provenanceRevision) &&
      isDeepStrictEqual(persisted.getLectureStudioRevision(studio.id, 4), attachmentRevision) &&
      isDeepStrictEqual(persisted.getLectureStudioRevision(studio.id, 3), externalRevision) &&
      persisted.listLectureStudioRevisions(studio.id, 10).length === 5 &&
      isDeepStrictEqual(attachmentMessageAfterReopen?.attachments, [attachmentCard]) &&
      isDeepStrictEqual(
        (
          persisted.getLectureStudioRevision(studio.id, 4)?.sourceManifest as {
            turnAttachments?: readonly LectureStudioAttachmentSnapshot[];
          }
        ).turnAttachments,
        [attachmentSnapshot],
      ) &&
      persisted
        .listLectureStudioMessages(studio.id, 50)
        .find((message) => message.id === atomicUser.id)?.status === 'failed',
    'lecture_attachment_cards_or_v4_source_manifest_were_not_persisted_after_reopen',
  );

  const firstFigureBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
  const figureAsset = (id: string, bytes: Buffer): LectureStudioFigureAsset => ({
    id,
    studioId: studio.id,
    displayName: 'SQLCipher figure.png',
    fileName: `Figure-${id}.jpg`,
    mediaType: 'image/jpeg',
    sourceFormat: 'png',
    byteSize: bytes.byteLength,
    width: 2,
    height: 2,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    origin: 'user',
    createdAt: fixedTimestamp,
  });
  const studioBeforeFigures = persisted.getLectureStudio(studio.id);
  invariant(studioBeforeFigures !== null, 'lecture_figure_studio_missing');
  const detachedAsset = figureAsset(randomUUID(), firstFigureBytes);
  const firstFigureReceipt = persisted.addLectureStudioFigures({
    studioId: studio.id,
    expectedVersion: studioBeforeFigures.version,
    figures: [{ asset: detachedAsset, jpegBytes: firstFigureBytes }],
    updatedAt: fixedTimestamp,
  });
  invariant(
    firstFigureReceipt?.studio.version === studioBeforeFigures.version + 1 &&
      firstFigureReceipt.figures.length === 1 &&
      isDeepStrictEqual(
        Buffer.from(persisted.getLectureStudioFigure(studio.id, detachedAsset.id)?.bytes ?? []),
        firstFigureBytes,
      ),
    'lecture_figure_bytes_or_add_version_were_not_persisted',
  );
  const removedFigureReceipt = persisted.removeLectureStudioFigure({
    studioId: studio.id,
    expectedVersion: firstFigureReceipt.studio.version,
    figureId: detachedAsset.id,
    sha256: detachedAsset.sha256,
    updatedAt: fixedTimestamp,
  });
  invariant(
    removedFigureReceipt?.studio.version === firstFigureReceipt.studio.version + 1 &&
      removedFigureReceipt.figures.length === 0 &&
      persisted.listLectureStudioFigures(studio.id).length === 0 &&
      persisted.getLectureStudioFigure(studio.id, detachedAsset.id) === null,
    'lecture_unreferenced_figure_blob_was_not_hard_deleted',
  );

  const activeAsset = figureAsset(randomUUID(), firstFigureBytes);
  const activeFigureReceipt = persisted.addLectureStudioFigures({
    studioId: studio.id,
    expectedVersion: removedFigureReceipt.studio.version,
    figures: [{ asset: activeAsset, jpegBytes: firstFigureBytes }],
    updatedAt: fixedTimestamp,
  });
  invariant(activeFigureReceipt !== null, 'lecture_active_figure_add_failed');
  const duplicateAsset = figureAsset(randomUUID(), firstFigureBytes);
  const duplicateReceipt = persisted.addLectureStudioFigures({
    studioId: studio.id,
    expectedVersion: activeFigureReceipt.studio.version,
    figures: [{ asset: duplicateAsset, jpegBytes: firstFigureBytes }],
    updatedAt: fixedTimestamp,
  });
  invariant(
    duplicateReceipt?.studio.version === activeFigureReceipt.studio.version &&
      duplicateReceipt.figures.length === 1 &&
      duplicateReceipt.figures[0]?.id === activeAsset.id,
    'lecture_active_figure_sha_dedupe_changed_version_or_identity',
  );
  const staleBytes = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0xff, 0xd9]);
  invariant(
    persisted.addLectureStudioFigures({
      studioId: studio.id,
      expectedVersion: activeFigureReceipt.studio.version - 1,
      figures: [{ asset: figureAsset(randomUUID(), staleBytes), jpegBytes: staleBytes }],
      updatedAt: fixedTimestamp,
    }) === null,
    'lecture_figure_stale_version_was_not_rejected',
  );

  const messagesBeforeV4 = persisted.listLectureStudioMessages(studio.id, 50).length;
  const unusedFigureAttemptId = randomUUID();
  const unusedFigureGenerating = persisted.beginLectureStudioTurn({
    studioId: studio.id,
    expectedVersion: activeFigureReceipt.studio.version,
    attemptId: unusedFigureAttemptId,
    userMessage: null,
    updatedAt: fixedTimestamp,
  });
  invariant(unusedFigureGenerating !== null, 'lecture_unused_figure_v3_turn_did_not_begin');
  const unusedFigureNotes = provenanceRevision.lectureNotesLatex.replace(
    '% GOSU-CONTENT-END',
    '\\section{Unused library figure}\n% GOSU-CONTENT-END',
  );
  const unusedFigureRevision = {
    ...provenanceRevision,
    id: randomUUID(),
    revision: 6,
    attemptId: unusedFigureAttemptId,
    lectureNotesLatex: unusedFigureNotes,
    artifacts: [
      {
        kind: 'lecture-notes' as const,
        relativePath: 'Lecture Notes & Slides/unused-figure-v3/Lecture Notes.tex',
        contentSha256: createHash('sha256').update(unusedFigureNotes, 'utf8').digest('hex'),
        savedAt: fixedTimestamp,
      },
      {
        kind: 'slides' as const,
        relativePath: 'Lecture Notes & Slides/unused-figure-v3/Slides.tex',
        contentSha256: createHash('sha256')
          .update(provenanceRevision.slidesLatex, 'utf8')
          .digest('hex'),
        savedAt: fixedTimestamp,
      },
    ],
    invocation: { ...provenanceRevision.invocation, invocationId: randomUUID() },
    createdAt: fixedTimestamp,
  };
  const unusedFigureReady = persisted.completeLectureStudioTurn({
    studio: {
      ...unusedFigureGenerating,
      status: 'ready',
      activeAttemptId: null,
      currentRevision: 6,
      version: unusedFigureGenerating.version + 1,
      lastErrorCode: null,
      updatedAt: fixedTimestamp,
    },
    revision: unusedFigureRevision,
    assistantMessage: null,
  });
  invariant(
    unusedFigureReady?.currentRevision === 6 &&
      isDeepStrictEqual(persisted.getCurrentLectureStudioRevision(studio.id), unusedFigureRevision),
    'lecture_active_but_unused_figure_blocked_v3_completion',
  );

  const modelV4AttemptId = randomUUID();
  const modelV4Generating = persisted.beginLectureStudioTurn({
    studioId: studio.id,
    expectedVersion: unusedFigureReady.version,
    attemptId: modelV4AttemptId,
    userMessage: null,
    updatedAt: fixedTimestamp,
  });
  invariant(modelV4Generating !== null, 'lecture_model_v4_turn_did_not_begin');
  const modelNotes = provenanceRevision.lectureNotesLatex.replace(
    '% GOSU-CONTENT-END',
    '\\section{Model V4 figure snapshot}\n% GOSU-CONTENT-END',
  );
  const modelSlides = provenanceRevision.slidesLatex;
  const modelV4Revision: LectureStudioRevisionV4 = {
    ...provenanceRevision,
    schemaVersion: 4,
    id: randomUUID(),
    revision: 7,
    attemptId: modelV4AttemptId,
    lectureNotesLatex: modelNotes,
    slidesLatex: modelSlides,
    authorship: { kind: 'model' },
    figureAssets: activeFigureReceipt.figures,
    artifacts: [
      {
        kind: 'lecture-notes',
        relativePath: 'Lecture Notes & Slides/model-v4/Lecture Notes.tex',
        contentSha256: createHash('sha256').update(modelNotes, 'utf8').digest('hex'),
        savedAt: fixedTimestamp,
      },
      {
        kind: 'slides',
        relativePath: 'Lecture Notes & Slides/model-v4/Slides.tex',
        contentSha256: createHash('sha256').update(modelSlides, 'utf8').digest('hex'),
        savedAt: fixedTimestamp,
      },
    ],
    invocation: { ...provenanceRevision.invocation, invocationId: randomUUID() },
    createdAt: fixedTimestamp,
  };
  const modelV4Ready = persisted.completeLectureStudioTurn({
    studio: {
      ...modelV4Generating,
      status: 'ready',
      activeAttemptId: null,
      currentRevision: 7,
      version: modelV4Generating.version + 1,
      lastErrorCode: null,
      updatedAt: fixedTimestamp,
    },
    revision: modelV4Revision,
    assistantMessage: null,
  });
  invariant(
    modelV4Ready?.currentRevision === 7 &&
      isDeepStrictEqual(persisted.getCurrentLectureStudioRevision(studio.id), modelV4Revision),
    'lecture_model_v4_revision_was_not_persisted',
  );

  const manualNotes = modelNotes.replace(
    '% GOSU-CONTENT-END',
    '\\section{Manual immutable edit}\n% GOSU-CONTENT-END',
  );
  const manualV4Revision: LectureStudioRevisionV4 = {
    ...modelV4Revision,
    id: randomUUID(),
    revision: 8,
    attemptId: randomUUID(),
    lectureNotesLatex: manualNotes,
    authorship: {
      kind: 'manual',
      baseRevisionId: modelV4Revision.id,
      baseRevision: 7,
      editedKinds: ['lecture-notes'],
    },
    artifacts: [
      {
        kind: 'lecture-notes',
        relativePath: 'Lecture Notes & Slides/manual-v4/Lecture Notes.tex',
        contentSha256: createHash('sha256').update(manualNotes, 'utf8').digest('hex'),
        savedAt: fixedTimestamp,
      },
      {
        kind: 'slides',
        relativePath: 'Lecture Notes & Slides/manual-v4/Slides.tex',
        contentSha256: createHash('sha256').update(modelSlides, 'utf8').digest('hex'),
        savedAt: fixedTimestamp,
      },
    ],
    invocation: null,
    createdAt: fixedTimestamp,
  };
  const manualReady = persisted.commitManualLectureStudioRevision({
    studioId: studio.id,
    expectedVersion: modelV4Ready.version,
    expectedCurrentRevision: 7,
    revision: manualV4Revision,
    updatedAt: fixedTimestamp,
  });
  invariant(
    manualReady?.currentRevision === 8 &&
      manualReady.version === modelV4Ready.version + 1 &&
      persisted.listLectureStudioMessages(studio.id, 50).length === messagesBeforeV4,
    'lecture_manual_v4_append_added_a_message_or_failed_to_advance',
  );
  invariant(
    persisted.commitManualLectureStudioRevision({
      studioId: studio.id,
      expectedVersion: modelV4Ready.version,
      expectedCurrentRevision: 7,
      revision: manualV4Revision,
      updatedAt: fixedTimestamp,
    }) === null,
    'lecture_manual_v4_stale_cas_was_not_rejected',
  );
  let referencedFigureRemovalRejected = false;
  try {
    persisted.removeLectureStudioFigure({
      studioId: studio.id,
      expectedVersion: manualReady.version,
      figureId: activeAsset.id,
      sha256: activeAsset.sha256,
      updatedAt: fixedTimestamp,
    });
  } catch (error) {
    referencedFigureRemovalRejected =
      error instanceof Error && error.message === 'lecture_figure_in_use';
  }
  invariant(
    referencedFigureRemovalRejected &&
      persisted.getLectureStudio(studio.id)?.version === manualReady.version,
    'lecture_current_revision_figure_reference_was_not_fenced',
  );

  const historicalOnlyNotes = manualNotes.replace(
    '% GOSU-CONTENT-END',
    '\\section{Detached historical figure}\n% GOSU-CONTENT-END',
  );
  const historicalOnlyRevision: LectureStudioRevisionV4 = {
    ...manualV4Revision,
    id: randomUUID(),
    revision: 9,
    attemptId: randomUUID(),
    lectureNotesLatex: historicalOnlyNotes,
    authorship: {
      kind: 'manual',
      baseRevisionId: manualV4Revision.id,
      baseRevision: 8,
      editedKinds: ['lecture-notes'],
    },
    figureAssets: [],
    artifacts: [
      {
        kind: 'lecture-notes',
        relativePath: 'Lecture Notes & Slides/historical-only-v4/Lecture Notes.tex',
        contentSha256: createHash('sha256').update(historicalOnlyNotes, 'utf8').digest('hex'),
        savedAt: fixedTimestamp,
      },
      {
        kind: 'slides',
        relativePath: 'Lecture Notes & Slides/historical-only-v4/Slides.tex',
        contentSha256: createHash('sha256').update(modelSlides, 'utf8').digest('hex'),
        savedAt: fixedTimestamp,
      },
    ],
    invocation: null,
    createdAt: fixedTimestamp,
  };
  const historicalOnlyReady = persisted.commitManualLectureStudioRevision({
    studioId: studio.id,
    expectedVersion: manualReady.version,
    expectedCurrentRevision: 8,
    revision: historicalOnlyRevision,
    updatedAt: fixedTimestamp,
  });
  invariant(
    historicalOnlyReady?.currentRevision === 9,
    'lecture_historical_figure_detach_revision_failed',
  );
  const historicalFigureRemoval = persisted.removeLectureStudioFigure({
    studioId: studio.id,
    expectedVersion: historicalOnlyReady.version,
    figureId: activeAsset.id,
    sha256: activeAsset.sha256,
    updatedAt: fixedTimestamp,
  });
  invariant(
    historicalFigureRemoval?.studio.version === historicalOnlyReady.version + 1 &&
      historicalFigureRemoval.figures.length === 0 &&
      persisted.listLectureStudioFigures(studio.id).length === 0 &&
      isDeepStrictEqual(
        Buffer.from(persisted.getLectureStudioFigure(studio.id, activeAsset.id)?.bytes ?? []),
        firstFigureBytes,
      ),
    'lecture_historical_revision_figure_bytes_were_not_soft_deleted_and_retained',
  );

  const manualRoundTrip = new LocalDatabase();
  manualRoundTrip.open();
  invariant(
    isDeepStrictEqual(
      manualRoundTrip.getLectureStudioRevision(studio.id, 6),
      unusedFigureRevision,
    ) &&
      isDeepStrictEqual(manualRoundTrip.getLectureStudioRevision(studio.id, 7), modelV4Revision) &&
      isDeepStrictEqual(manualRoundTrip.getLectureStudioRevision(studio.id, 8), manualV4Revision) &&
      isDeepStrictEqual(
        manualRoundTrip.getLectureStudioRevision(studio.id, 9),
        historicalOnlyRevision,
      ) &&
      isDeepStrictEqual(
        manualRoundTrip.getCurrentLectureStudioRevision(studio.id),
        historicalOnlyRevision,
      ) &&
      manualRoundTrip.getLectureStudioFigure(studio.id, detachedAsset.id) === null &&
      isDeepStrictEqual(
        Buffer.from(manualRoundTrip.getLectureStudioFigure(studio.id, activeAsset.id)?.bytes ?? []),
        firstFigureBytes,
      ),
    'lecture_v4_model_manual_or_detached_figure_gc_changed_after_reopen',
  );
  manualRoundTrip.close();

  const rawV4Inspection = new Database(join(app.getPath('userData'), 'gosu.db'));
  rawV4Inspection.pragma(`key="x'${legacyLectureKeyHex}'"`);
  try {
    const modelRow = rawV4Inspection
      .prepare(
        `select invocation_json,authorship_json,figure_assets_json
         from lecture_studio_revisions where id=?`,
      )
      .get(modelV4Revision.id) as
      { invocation_json: string; authorship_json: string; figure_assets_json: string } | undefined;
    const manualRow = rawV4Inspection
      .prepare(
        `select invocation_json,authorship_json,figure_assets_json
         from lecture_studio_revisions where id=?`,
      )
      .get(manualV4Revision.id) as
      { invocation_json: string; authorship_json: string; figure_assets_json: string } | undefined;
    const detachedFigureRow = rawV4Inspection
      .prepare(
        `select image_bytes,deleted_at from lecture_studio_figures
         where studio_id=? and id=?`,
      )
      .get(studio.id, detachedAsset.id) as
      { image_bytes: Buffer; deleted_at: string | null } | undefined;
    const historicalFigureRow = rawV4Inspection
      .prepare(
        `select image_bytes,deleted_at from lecture_studio_figures
         where studio_id=? and id=?`,
      )
      .get(studio.id, activeAsset.id) as
      { image_bytes: Buffer; deleted_at: string | null } | undefined;
    invariant(
      modelRow?.invocation_json !== 'null' &&
        JSON.parse(modelRow?.authorship_json ?? '{}').kind === 'model' &&
        manualRow?.invocation_json === 'null' &&
        JSON.parse(manualRow?.authorship_json ?? '{}').kind === 'manual' &&
        manualRow?.figure_assets_json === JSON.stringify(manualV4Revision.figureAssets) &&
        detachedFigureRow === undefined &&
        historicalFigureRow?.deleted_at === fixedTimestamp &&
        isDeepStrictEqual(Buffer.from(historicalFigureRow.image_bytes), firstFigureBytes),
      'lecture_v4_provenance_or_detached_blob_gc_changed_in_sqlcipher_storage',
    );
  } finally {
    rawV4Inspection.close();
  }

  for (let index = 1; index < LECTURE_STUDIO_MAX_STUDIOS; index += 1) {
    const capacityProjectId = randomUUID();
    invariant(
      persisted.createLectureStudio({
        ...studio,
        id: randomUUID(),
        title: `Capacity fixture ${index}`,
        outputProjectId: capacityProjectId,
        sourceProjectIds: [capacityProjectId],
        sourceSelection: {
          literature: [{ projectId: capacityProjectId, recordId: randomUUID() }],
          experiments: [],
          manuscripts: [],
          externalSources: null,
        },
      }),
      'lecture_capacity_fixture_insert_failed',
    );
  }
  let capacityRejected = false;
  try {
    persisted.createLectureStudio({ ...studio, id: randomUUID(), title: 'Over capacity' });
  } catch (error) {
    capacityRejected =
      error instanceof LectureStudioStorageError && error.code === 'capacity_reached';
  }
  invariant(capacityRejected, 'lecture_studio_capacity_error_was_not_typed');

  const capacityRows = persisted.listLectureStudios();
  for (const summary of capacityRows) {
    invariant(
      persisted.setLectureStudioTrashed(
        summary.id,
        summary.version,
        fixedTimestamp,
        fixedTimestamp,
      ) !== null,
      'lecture_trash_capacity_fixture_move_failed',
    );
  }
  for (let index = capacityRows.length; index < LECTURE_STUDIO_MAX_TRASHED_STUDIOS; index += 1) {
    const capacityProjectId = randomUUID();
    const next = {
      ...studio,
      id: randomUUID(),
      title: `Trash capacity fixture ${index}`,
      outputProjectId: capacityProjectId,
      sourceProjectIds: [capacityProjectId],
      sourceSelection: {
        literature: [{ projectId: capacityProjectId, recordId: randomUUID() }],
        experiments: [],
        manuscripts: [],
        externalSources: null,
      },
      currentRevision: 0,
      version: 1,
    };
    invariant(persisted.createLectureStudio(next), 'lecture_trash_capacity_insert_failed');
    invariant(
      persisted.setLectureStudioTrashed(next.id, next.version, fixedTimestamp, fixedTimestamp) !==
        null,
      'lecture_trash_capacity_move_failed',
    );
  }
  const overTrashProjectId = randomUUID();
  const overTrash = {
    ...studio,
    id: randomUUID(),
    title: 'Over trash capacity',
    outputProjectId: overTrashProjectId,
    sourceProjectIds: [overTrashProjectId],
    sourceSelection: {
      literature: [{ projectId: overTrashProjectId, recordId: randomUUID() }],
      experiments: [],
      manuscripts: [],
      externalSources: null,
    },
    currentRevision: 0,
    version: 1,
  };
  invariant(persisted.createLectureStudio(overTrash), 'lecture_over_trash_insert_failed');
  let trashCapacityRejected = false;
  try {
    persisted.setLectureStudioTrashed(
      overTrash.id,
      overTrash.version,
      fixedTimestamp,
      fixedTimestamp,
    );
  } catch (error) {
    trashCapacityRejected =
      error instanceof LectureStudioStorageError && error.code === 'capacity_reached';
  }
  invariant(trashCapacityRejected, 'lecture_trash_capacity_error_was_not_typed');

  const trashCapacityReceipt = persisted.emptyLectureStudioTrash(
    {
      idempotencyKey: randomUUID(),
      confirmation: EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION,
      targets: persisted
        .listLectureStudios(true)
        .filter((summary) => summary.trashedAt !== undefined)
        .map((summary) => ({
          studioId: summary.id,
          expectedVersion: summary.version,
          trashedAt: summary.trashedAt!,
        }))
        .sort((left, right) => left.studioId.localeCompare(right.studioId)),
    },
    fixedTimestamp,
  );
  invariant(
    trashCapacityReceipt?.removedStudios.length === LECTURE_STUDIO_MAX_TRASHED_STUDIOS,
    'lecture_full_trash_could_not_be_emptied',
  );

  const replacementProjectId = randomUUID();
  invariant(
    persisted.createLectureStudio({
      ...studio,
      id: studio.id,
      title: 'SQLCipher lecture boundary restored after capacity check',
      outputProjectId: replacementProjectId,
      sourceProjectIds: [replacementProjectId],
      sourceSelection: {
        literature: [{ projectId: replacementProjectId, recordId: randomUUID() }],
        experiments: [],
        manuscripts: [],
        externalSources: null,
      },
      currentRevision: 0,
      version: 1,
    }),
    'lecture_trash_fixture_reinsert_failed',
  );
  const activeSummary = persisted.listLectureStudios().find((summary) => summary.id === studio.id);
  invariant(activeSummary !== undefined, 'lecture_trash_fixture_active_studio_missing');
  const trashedStudio = persisted.setLectureStudioTrashed(
    activeSummary.id,
    activeSummary.version,
    fixedTimestamp,
    fixedTimestamp,
  );
  invariant(trashedStudio?.trashedAt === fixedTimestamp, 'lecture_trash_move_failed');
  invariant(
    persisted.listLectureStudios().every((summary) => summary.id !== studio.id) &&
      persisted.listLectureStudios(true).some((summary) => summary.id === studio.id),
    'lecture_trash_list_visibility_failed',
  );
  invariant(
    persisted.beginLectureStudioTurn({
      studioId: studio.id,
      expectedVersion: trashedStudio.version,
      attemptId: randomUUID(),
      userMessage: null,
      updatedAt: fixedTimestamp,
    }) === null,
    'lecture_trashed_studio_started_generation',
  );
  const restoredStudio = persisted.setLectureStudioTrashed(
    studio.id,
    trashedStudio.version,
    null,
    fixedTimestamp,
  );
  invariant(restoredStudio !== null && !restoredStudio.trashedAt, 'lecture_trash_restore_failed');
  const trashedAgain = persisted.setLectureStudioTrashed(
    studio.id,
    restoredStudio.version,
    fixedTimestamp,
    fixedTimestamp,
  );
  invariant(trashedAgain !== null, 'lecture_trash_second_move_failed');
  const emptyCommand: EmptyLectureStudioTrashInput = {
    idempotencyKey: randomUUID(),
    confirmation: EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION,
    targets: [
      {
        studioId: trashedAgain.id,
        expectedVersion: trashedAgain.version,
        trashedAt: trashedAgain.trashedAt!,
      },
    ],
  };

  const racedStudioId = randomUUID();
  const racedProjectId = randomUUID();
  const racedStudio: LectureStudio = {
    ...studio,
    id: racedStudioId,
    title: 'Studio added after Trash confirmation',
    outputProjectId: racedProjectId,
    sourceProjectIds: [racedProjectId],
    sourceSelection: {
      literature: [{ projectId: racedProjectId, recordId: randomUUID() }],
      experiments: [],
      manuscripts: [],
      externalSources: null,
    },
    currentRevision: 0,
    version: 1,
  };
  invariant(persisted.createLectureStudio(racedStudio), 'lecture_trash_race_insert_failed');
  const racedTrashed = persisted.setLectureStudioTrashed(
    racedStudio.id,
    racedStudio.version,
    fixedTimestamp,
    fixedTimestamp,
  );
  invariant(racedTrashed !== null, 'lecture_trash_race_move_failed');
  let exactSetRejected = false;
  try {
    persisted.emptyLectureStudioTrash(emptyCommand, fixedTimestamp);
  } catch (error) {
    exactSetRejected = error instanceof LectureStudioStorageError && error.code === 'trash_changed';
  }
  invariant(exactSetRejected, 'lecture_trash_added_target_race_was_not_rejected');
  invariant(
    persisted.getLectureStudio(studio.id) !== null &&
      persisted.getLectureStudio(racedStudio.id) !== null,
    'lecture_trash_added_target_race_deleted_rows',
  );
  let exactVersionRejected = false;
  try {
    persisted.emptyLectureStudioTrash(
      {
        ...emptyCommand,
        idempotencyKey: randomUUID(),
        targets: [
          { ...emptyCommand.targets[0]!, expectedVersion: trashedAgain.version + 1 },
          {
            studioId: racedTrashed.id,
            expectedVersion: racedTrashed.version,
            trashedAt: racedTrashed.trashedAt!,
          },
        ].sort((left, right) => left.studioId.localeCompare(right.studioId)),
      },
      fixedTimestamp,
    );
  } catch (error) {
    exactVersionRejected =
      error instanceof LectureStudioStorageError && error.code === 'trash_changed';
  }
  invariant(exactVersionRejected, 'lecture_trash_version_race_was_not_rejected');
  invariant(
    persisted.getLectureStudio(studio.id) !== null &&
      persisted.getLectureStudio(racedStudio.id) !== null,
    'lecture_trash_version_race_deleted_rows',
  );
  const racedRestored = persisted.setLectureStudioTrashed(
    racedTrashed.id,
    racedTrashed.version,
    null,
    fixedTimestamp,
  );
  invariant(racedRestored !== null, 'lecture_trash_race_restore_failed');
  let exactRemovalRejected = false;
  try {
    persisted.emptyLectureStudioTrash(
      {
        ...emptyCommand,
        idempotencyKey: randomUUID(),
        targets: [
          emptyCommand.targets[0]!,
          {
            studioId: racedTrashed.id,
            expectedVersion: racedTrashed.version,
            trashedAt: racedTrashed.trashedAt!,
          },
        ].sort((left, right) => left.studioId.localeCompare(right.studioId)),
      },
      fixedTimestamp,
    );
  } catch (error) {
    exactRemovalRejected =
      error instanceof LectureStudioStorageError && error.code === 'trash_changed';
  }
  invariant(exactRemovalRejected, 'lecture_trash_removed_target_race_was_not_rejected');
  invariant(
    persisted.getLectureStudio(studio.id) !== null &&
      persisted.getLectureStudio(racedStudio.id)?.trashedAt === undefined,
    'lecture_trash_removed_target_race_deleted_rows',
  );
  const trashReceipt = persisted.emptyLectureStudioTrash(emptyCommand, fixedTimestamp);
  invariant(
    trashReceipt?.removedStudios.some((removed) => removed.studioId === studio.id) === true &&
      trashReceipt.removedStudios[0]?.revisionCount === 0,
    'lecture_trash_purge_receipt_missing_history_counts',
  );
  invariant(
    JSON.stringify(persisted.emptyLectureStudioTrash(emptyCommand, fixedTimestamp)) ===
      JSON.stringify(trashReceipt),
    'lecture_trash_purge_was_not_idempotent',
  );
  invariant(
    persisted.getLectureStudio(studio.id) === null &&
      persisted.getLectureStudio(racedStudio.id)?.trashedAt === undefined &&
      persisted.listLectureStudios().length === 2,
    'lecture_trash_purge_removed_active_studios_or_kept_purged_studio',
  );
  persisted.close();
}

function verifyLectureStudioAttemptRetention(fixedTimestamp: string) {
  const studioFixture = (title: string): LectureStudio => {
    const projectId = randomUUID();
    return {
      schemaVersion: 1,
      id: randomUUID(),
      title,
      kind: 'talk',
      durationMinutes: 20,
      outputProjectId: projectId,
      sourceProjectIds: [projectId],
      sourceSelection: {
        literature: [{ projectId, recordId: randomUUID() }],
        experiments: [],
        manuscripts: [],
        externalSources: null,
      },
      generationBrief: {
        notesTargetPages: null,
        slidesTargetPages: null,
        detailLevel: 'standard',
        structure: { mode: 'adaptive' },
        customInstructions: '',
      },
      status: 'draft',
      activeAttemptId: null,
      currentRevision: 0,
      version: 1,
      lastErrorCode: null,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    };
  };
  const runningAttempt = (studioId: string, id: string) => ({
    schemaVersion: 1 as const,
    id,
    studioId,
    status: 'running' as const,
    requestedModelId: null,
    resolvedModelId: null,
    providerId: null,
    catalogVersion: null,
    reasoningOptionId: 'high',
    phases: [],
    validations: [],
    terminalCode: null,
    startedAt: fixedTimestamp,
    completedAt: null,
  });
  const retainedStudio = studioFixture('Bounded Lecture attempt diagnostics');
  const activeStudio = studioFixture('Running Lecture attempt diagnostics');
  const database = new LocalDatabase();
  database.open();
  invariant(database.createLectureStudio(retainedStudio), 'lecture_retention_studio_insert_failed');
  invariant(database.createLectureStudio(activeStudio), 'lecture_running_studio_insert_failed');

  const succeededAttemptId = randomUUID();
  const succeededGenerating = database.beginLectureStudioTurn({
    studioId: retainedStudio.id,
    expectedVersion: retainedStudio.version,
    attemptId: succeededAttemptId,
    userMessage: null,
    updatedAt: fixedTimestamp,
    attempt: runningAttempt(retainedStudio.id, succeededAttemptId),
  });
  invariant(succeededGenerating !== null, 'lecture_retention_success_did_not_begin');
  const invocation: ModelInvocation = {
    schemaVersion: 1,
    invocationId: randomUUID(),
    providerId: 'codex',
    requestedModelId: null,
    resolvedModelId: 'fixture-model',
    catalogVersion: 'fixture-catalog',
    reasoningOptionId: 'high',
    startedAt: fixedTimestamp,
  };
  const revision: LectureStudioRevision = {
    schemaVersion: 1,
    id: randomUUID(),
    studioId: retainedStudio.id,
    revision: 1,
    attemptId: succeededAttemptId,
    sourceManifest: {
      schemaVersion: 1,
      selectedProjectIds: retainedStudio.sourceProjectIds,
      literature: [
        {
          sourceLabel: 'L1',
          projectId: retainedStudio.outputProjectId,
          projectName: 'Retention fixture project',
          recordId: retainedStudio.sourceSelection.literature[0]!.recordId,
          recordVersion: 1,
          annotationVersion: 0,
          title: 'Bounded diagnostic retention',
          authors: ['Fixture Author'],
          containerTitle: null,
          publishedYear: 2026,
          doi: null,
          citationKey: null,
          reviewStatus: 'included',
          topics: [],
          metadataSummary: 'A content-free attempt-retention fixture.',
          metadataOnly: true,
        },
      ],
      experiments: [],
    },
    sourceManifestSha256: 'a'.repeat(64),
    lectureNotesMarkdown: '# Retained successful revision',
    slidesMarkdown: '# Retained successful slides',
    artifacts: [
      {
        kind: 'lecture-notes',
        relativePath: 'Lecture Studio/retention/revision-1/lecture-notes.md',
        contentSha256: 'b'.repeat(64),
        savedAt: fixedTimestamp,
      },
      {
        kind: 'slides',
        relativePath: 'Lecture Studio/retention/revision-1/slides.md',
        contentSha256: 'c'.repeat(64),
        savedAt: fixedTimestamp,
      },
    ],
    invocation,
    createdAt: fixedTimestamp,
  };
  let retainedState = database.completeLectureStudioTurn({
    studio: {
      ...succeededGenerating,
      status: 'ready',
      activeAttemptId: null,
      currentRevision: 1,
      version: succeededGenerating.version + 1,
      lastErrorCode: null,
      updatedAt: fixedTimestamp,
    },
    revision,
    assistantMessage: null,
  });
  invariant(retainedState !== null, 'lecture_retention_success_did_not_complete');

  const failureAttemptIds: string[] = [];
  let usageProtectedFailureAttemptId: string | null = null;
  for (let index = 0; index < LECTURE_STUDIO_MAX_RETAINED_FAILURE_ATTEMPTS + 5; index += 1) {
    const attemptId = randomUUID();
    failureAttemptIds.push(attemptId);
    const generating = database.beginLectureStudioTurn({
      studioId: retainedStudio.id,
      expectedVersion: retainedState.version,
      attemptId,
      userMessage: null,
      updatedAt: fixedTimestamp,
      attempt: runningAttempt(retainedStudio.id, attemptId),
    });
    invariant(generating !== null, 'lecture_retention_failure_did_not_begin');
    retainedState = database.failLectureStudioTurn({
      studioId: retainedStudio.id,
      attemptId,
      errorCode: 'lecture_generation_failed',
      messageStatus: 'failed',
      updatedAt: fixedTimestamp,
    });
    invariant(retainedState !== null, 'lecture_retention_failure_did_not_finish');
    if (index === 0) {
      usageProtectedFailureAttemptId = attemptId;
      database.recordAttributedModelInvocation(
        'lecture-retention-usage-thread',
        'lecture-retention-usage-turn',
        { ...invocation, invocationId: randomUUID() },
        {
          workloadKind: 'lecture_generation',
          projectId: retainedStudio.outputProjectId,
          lectureStudioId: retainedStudio.id,
          lectureAttemptId: attemptId,
        },
        {
          connectionKey: 'codex:chatgpt',
          connectionLabel: 'ChatGPT',
          upstreamProviderId: null,
        },
        fixedTimestamp,
      );
    }
  }
  invariant(
    database.getLatestLectureStudioAttempt(retainedStudio.id)?.id === failureAttemptIds.at(-1) &&
      database.listLectureStudioMessages(retainedStudio.id, 10).length === 0,
    'lecture_retention_latest_message_less_failure_was_not_preserved',
  );

  const activeAttemptId = randomUUID();
  invariant(
    database.beginLectureStudioTurn({
      studioId: activeStudio.id,
      expectedVersion: activeStudio.version,
      attemptId: activeAttemptId,
      userMessage: null,
      updatedAt: fixedTimestamp,
      attempt: runningAttempt(activeStudio.id, activeAttemptId),
    }) !== null,
    'lecture_retention_running_attempt_did_not_begin',
  );
  database.close();

  const keyHex = safeStorage
    .decryptString(readFileSync(join(app.getPath('userData'), 'local-key.bin')))
    .trim();
  const beforeRestart = new Database(join(app.getPath('userData'), 'gosu.db'));
  beforeRestart.pragma(`key="x'${keyHex}'"`);
  const retainedFailureRows = beforeRestart
    .prepare(
      `select id from lecture_studio_attempts
       where studio_id=? and status in ('failed','interrupted')
       order by started_at desc,rowid desc`,
    )
    .all(retainedStudio.id) as Array<{ id: string }>;
  invariant(
    usageProtectedFailureAttemptId !== null &&
      retainedFailureRows.length === LECTURE_STUDIO_MAX_RETAINED_FAILURE_ATTEMPTS + 1 &&
      isDeepStrictEqual(
        retainedFailureRows.map((row) => row.id),
        [
          ...failureAttemptIds.slice(-LECTURE_STUDIO_MAX_RETAINED_FAILURE_ATTEMPTS).reverse(),
          usageProtectedFailureAttemptId,
        ],
      ) &&
      (
        beforeRestart
          .prepare(
            `select count(*) as count from lecture_studio_attempts
             where studio_id=? and id=? and status='succeeded'`,
          )
          .get(retainedStudio.id, succeededAttemptId) as { count: number }
      ).count === 1 &&
      (
        beforeRestart
          .prepare(
            `select count(*) as count from lecture_studio_attempts
             where studio_id=? and id=? and status='running'`,
          )
          .get(activeStudio.id, activeAttemptId) as { count: number }
      ).count === 1,
    'lecture_retention_pruned_success_or_running_or_kept_old_failures',
  );
  const insertOverflow = beforeRestart.prepare(
    `insert into lecture_studio_attempts(
       id,schema_version,studio_id,status,requested_model_id,resolved_model_id,provider_id,
       catalog_version,reasoning_option_id,phases_json,validations_json,terminal_code,
       started_at,completed_at
     ) values(?,1,?,'failed',null,null,null,null,'high','[]','[]',
              'lecture_generation_failed',?,?)`,
  );
  const oldTimestamp = new Date(Date.parse(fixedTimestamp) - 86_400_000).toISOString();
  const overflowAttemptIds = Array.from({ length: 5 }, () => randomUUID());
  for (const attemptId of overflowAttemptIds) {
    insertOverflow.run(attemptId, retainedStudio.id, oldTimestamp, fixedTimestamp);
  }
  beforeRestart.close();

  const reopened = new LocalDatabase();
  reopened.open();
  invariant(
    reopened.getLatestLectureStudioAttempt(retainedStudio.id)?.id === failureAttemptIds.at(-1) &&
      reopened.getLatestLectureStudioAttempt(activeStudio.id)?.id === activeAttemptId &&
      reopened.getLatestLectureStudioAttempt(activeStudio.id)?.status === 'interrupted',
    'lecture_retention_startup_reconciliation_changed_the_latest_attempt',
  );
  const snapshottedActiveAttempt = reopened
    .listStoredLectureUsageAttempts(
      new Date(Date.parse(fixedTimestamp) - 1).toISOString(),
      new Date(Date.parse(fixedTimestamp) + 1).toISOString(),
      fixedTimestamp,
    )
    .find((attempt) => attempt.attemptId === activeAttemptId);
  invariant(
    snapshottedActiveAttempt?.status === 'running' && snapshottedActiveAttempt.completedAt === null,
    'lecture_usage_snapshot_did_not_preserve_running_attempt_state',
  );
  reopened.close();

  const afterRestart = new Database(join(app.getPath('userData'), 'gosu.db'));
  afterRestart.pragma(`key="x'${keyHex}'"`);
  try {
    const terminalCount = afterRestart
      .prepare(
        `select count(*) as count from lecture_studio_attempts
         where studio_id=? and status in ('failed','interrupted')`,
      )
      .get(retainedStudio.id) as { count: number };
    const succeededCount = afterRestart
      .prepare(
        `select count(*) as count from lecture_studio_attempts
         where studio_id=? and id=? and status='succeeded'`,
      )
      .get(retainedStudio.id, succeededAttemptId) as { count: number };
    const staleOverflowCount = afterRestart
      .prepare(
        `select count(*) as count from lecture_studio_attempts
         where studio_id=? and id in (${overflowAttemptIds.map(() => '?').join(',')})`,
      )
      .get(retainedStudio.id, ...overflowAttemptIds) as { count: number };
    invariant(
      terminalCount.count === LECTURE_STUDIO_MAX_RETAINED_FAILURE_ATTEMPTS + 1 &&
        succeededCount.count === 1 &&
        staleOverflowCount.count === 0,
      'lecture_retention_startup_cleanup_was_not_bounded_or_preserved_success',
    );
  } finally {
    afterRestart.close();
  }
}

async function verifyLectureExternalSourceTrashPurgeRecovery(
  rootUserData: string,
  fixedTimestamp: string,
) {
  const projectId = randomUUID();
  const activeStudioId = randomUUID();
  const orphanedStudioId = randomUUID();
  const trashedKeepStudioId = randomUUID();
  const sourceFixtureRoot = join(rootUserData, 'lecture-external-source-trash-fixtures');
  const managedRoot = join(rootUserData, 'lecture-external-source-trash-managed');
  mkdirSync(sourceFixtureRoot, { recursive: true });
  let selectedPaths: readonly string[] = [];
  const externalSources = new LectureExternalSourceService({
    rootDirectory: () => managedRoot,
    chooseFiles: async () => selectedPaths,
    validateProject: async (candidateProjectId) => {
      if (candidateProjectId !== projectId) throw new Error('project_not_found');
    },
    manifestAuthenticator: new LectureExternalSourceManifestAuthenticator({
      rootDirectory: () => managedRoot,
      encryption: safeStorage,
    }),
  });
  const claimSource = async (studioId: string, label: string) => {
    const sourcePath = join(sourceFixtureRoot, `${label}.md`);
    writeFileSync(sourcePath, `# ${label}\n\nDurable external evidence for trash recovery.`);
    selectedPaths = [sourcePath];
    const staged = await externalSources.chooseAndStage({ projectId, sourceSetId: null });
    const source = staged.sources[0];
    invariant(source !== undefined, 'lecture_external_trash_source_not_staged');
    await externalSources.claim({
      projectId,
      studioId,
      sourceSetId: staged.id,
      selectedSourceIds: [source.id],
    });
    return { sourceSetId: staged.id, sourceId: source.id };
  };
  const activeSource = await claimSource(activeStudioId, 'active-studio');
  const orphanedSource = await claimSource(orphanedStudioId, 'purge-failure-orphan');

  const database = new LocalDatabase();
  database.open();
  try {
    const studio = (
      id: string,
      title: string,
      externalSource: Readonly<{ sourceSetId: string; sourceId: string }>,
    ): LectureStudio => ({
      schemaVersion: 1,
      id,
      title,
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectId,
      sourceProjectIds: [projectId],
      sourceSelection: {
        literature: [],
        experiments: [],
        manuscripts: [],
        externalSources: {
          sourceSetId: externalSource.sourceSetId,
          sourceIds: [externalSource.sourceId],
        },
      },
      generationBrief: {
        notesTargetPages: null,
        slidesTargetPages: null,
        detailLevel: 'standard',
        structure: { mode: 'adaptive' },
        customInstructions: '',
      },
      status: 'draft',
      activeAttemptId: null,
      currentRevision: 0,
      version: 1,
      lastErrorCode: null,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    });
    const activeStudio = studio(activeStudioId, 'Active external source', activeSource);
    const orphanedStudio = studio(
      orphanedStudioId,
      'External source with failed filesystem purge',
      orphanedSource,
    );
    invariant(
      database.createLectureStudio(activeStudio) && database.createLectureStudio(orphanedStudio),
      'lecture_external_trash_studio_insert_failed',
    );
    const trashedOrphan = database.setLectureStudioTrashed(
      orphanedStudio.id,
      orphanedStudio.version,
      fixedTimestamp,
      fixedTimestamp,
    );
    invariant(trashedOrphan !== null, 'lecture_external_trash_move_failed');

    let purgeAttempts = 0;
    const codexEvents = new EventEmitter();
    const lifecycle = new LectureStudioService({
      storage: database,
      sources: database,
      manuscripts: {
        list: async () => {
          throw new Error('unused_manuscript_list');
        },
        listCheckpointFiles: async () => {
          throw new Error('unused_manuscript_file_list');
        },
        readCheckpointFile: async () => {
          throw new Error('unused_manuscript_file_read');
        },
      },
      externalSources: {
        claim: (input) => externalSources.claim(input),
        discard: (input) => externalSources.discard(input),
        snapshots: (input) => externalSources.snapshots(input),
        rollbackClaim: (input) => externalSources.rollbackClaim(input),
        purgeStudio: async () => {
          purgeAttempts += 1;
          throw new Error('fixture_external_source_purge_failed');
        },
      },
      workspace: {
        snapshot: () => ({
          schemaVersion: 1,
          revision: 0,
          projects: [],
          tasks: [],
          objectives: [],
        }),
      },
      artifacts: {
        assertRevisionDestination: () => undefined,
        saveRevisionArtifacts: async () => {
          throw new Error('unused_lecture_artifact_save');
        },
        confirmRevisionArtifacts: () => undefined,
        rollbackRevisionArtifacts: () => undefined,
        listPendingRevisionArtifacts: () => [],
        confirmPendingRevisionArtifacts: () => undefined,
        rollbackPendingRevisionArtifacts: () => undefined,
        resolveLectureRevisionArtifact: async () => {
          throw new Error('unused_lecture_artifact_resolve');
        },
      },
      codex: {
        on: codexEvents.on.bind(codexEvents),
        startThread: async () => {
          throw new Error('unused_lecture_codex_thread');
        },
        runTurn: async () => {
          throw new Error('unused_lecture_codex_turn');
        },
        interruptTurn: async () => undefined,
        releaseThread: async () => undefined,
      },
      pdfCompiler: {
        compile: async () => {
          throw new Error('unused_lecture_pdf_compile');
        },
      },
      prepareDirectory: async () => {
        throw new Error('unused_lecture_workspace_prepare');
      },
    });
    const emptyCommand: EmptyLectureStudioTrashInput = {
      idempotencyKey: randomUUID(),
      confirmation: EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION,
      targets: [
        {
          studioId: orphanedStudioId,
          expectedVersion: trashedOrphan.version,
          trashedAt: trashedOrphan.trashedAt!,
        },
      ],
    };
    const receipt = await lifecycle.emptyTrash(emptyCommand);
    invariant(
      receipt.removedStudios.length === 1 &&
        receipt.removedStudios[0]?.studioId === orphanedStudioId &&
        purgeAttempts === 1,
      'lecture_external_trash_receipt_or_purge_attempt_missing',
    );
    invariant(
      database.getLectureStudio(orphanedStudioId) === null &&
        database.getLectureStudio(activeStudioId)?.trashedAt === undefined,
      'lecture_external_trash_sql_purge_did_not_commit',
    );
    const orphanedDirectory = join(managedRoot, 'studios', projectId, orphanedStudioId);
    invariant(
      existsSync(orphanedDirectory),
      'lecture_external_trash_failed_purge_did_not_leave_recoverable_orphan',
    );

    // A newly trashed Studio can exist before the next launch. Retrying the earlier idempotency
    // key must return its durable receipt without deleting this newer row.
    const trashedKeepSource = await claimSource(trashedKeepStudioId, 'trashed-studio-to-preserve');
    const trashedKeepStudio = studio(
      trashedKeepStudioId,
      'Trashed external source preserved at startup',
      trashedKeepSource,
    );
    invariant(
      database.createLectureStudio(trashedKeepStudio),
      'lecture_external_trash_keep_studio_insert_failed',
    );
    invariant(
      database.setLectureStudioTrashed(
        trashedKeepStudio.id,
        trashedKeepStudio.version,
        fixedTimestamp,
        fixedTimestamp,
      ) !== null,
      'lecture_external_trash_keep_studio_move_failed',
    );
    database.close();

    const reopened = new LocalDatabase();
    try {
      reopened.open();
      invariant(
        JSON.stringify(reopened.emptyLectureStudioTrash(emptyCommand, fixedTimestamp)) ===
          JSON.stringify(receipt),
        'lecture_external_trash_receipt_was_not_durable',
      );
      invariant(
        reopened.getLectureStudio(orphanedStudioId) === null &&
          reopened.getLectureStudio(trashedKeepStudioId)?.trashedAt === fixedTimestamp,
        'lecture_external_trash_rows_changed_during_idempotent_retry',
      );
      // Recreate the service and manifest authenticator to match the real app-start boundary,
      // including reopening its SafeStorage-sealed manifest key from disk.
      const restartedExternalSources = new LectureExternalSourceService({
        rootDirectory: () => managedRoot,
        chooseFiles: async () => [],
        validateProject: async (candidateProjectId) => {
          if (candidateProjectId !== projectId) throw new Error('project_not_found');
        },
        manifestAuthenticator: new LectureExternalSourceManifestAuthenticator({
          rootDirectory: () => managedRoot,
          encryption: safeStorage,
        }),
      });
      const cleanup = await restartedExternalSources.cleanupOrphanedStudios(
        reopened.listLectureStudios(true).map(({ id, outputProjectId }) => ({
          projectId: outputProjectId,
          studioId: id,
        })),
      );
      invariant(
        cleanup.removedStudioDirectories === 1 && cleanup.removedClaimDirectories === 0,
        'lecture_external_startup_orphan_cleanup_was_not_exact',
      );
      invariant(
        !existsSync(orphanedDirectory) &&
          existsSync(join(managedRoot, 'studios', projectId, activeStudioId)) &&
          existsSync(join(managedRoot, 'studios', projectId, trashedKeepStudioId)),
        'lecture_external_startup_cleanup_removed_owned_or_kept_orphaned_sources',
      );
      await externalSources.discard({
        projectId,
        sourceSetId: trashedKeepSource.sourceSetId,
      });
    } finally {
      reopened.close();
    }
  } finally {
    database.close();
  }
}

function verifyLiteraturePersistence(fixedTimestamp: string) {
  const database = new LocalDatabase();
  database.open();
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const title = 'Bounded research systems';
  const authors = ['Ada Researcher'];
  const firstFingerprint = literatureFingerprint(title, authors, 2026);
  const firstRunId = randomUUID();
  const firstRun = {
    schemaVersion: 1 as const,
    id: firstRunId,
    projectId,
    provider: 'crossref' as const,
    query: 'bounded research systems',
    authorQuery: 'Ada Researcher',
    venueQuery: 'Journal of Fixtures',
    fromYear: 2020,
    toYear: 2026,
    requestedLimit: 25,
    status: 'running' as const,
    foundCount: 0,
    newCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    conflictCount: 0,
    conflicts: [],
    createdAt: fixedTimestamp,
    completedAt: null,
  };
  invariant(database.beginLiteratureSearch(firstRun), 'literature_search_start_failed');
  const firstReceipt = database.completeLiteratureSearch(
    projectId,
    firstRunId,
    [
      {
        provider: 'crossref',
        providerId: 'crossref-fixture-1',
        doi: '10.1000/gosu.fixture',
        fingerprint: firstFingerprint,
        title,
        authors,
        containerTitle: 'Journal of Fixtures',
        publishedYear: 2026,
        abstractText: 'A provider abstract used to derive detailed keywords.',
        topics: ['research systems'],
        workType: 'journal-article',
        citationCount: 2,
        sourceUrl: 'https://doi.org/10.1000/gosu.fixture',
      },
    ],
    fixedTimestamp,
  );
  invariant(
    firstReceipt.newCount === 1 && firstReceipt.run.fromYear === 2020,
    'literature_search_insert_failed',
  );
  const first = database.listLiteratureRecords(projectId)[0];
  invariant(
    first?.doi === '10.1000/gosu.fixture' &&
      first.abstractText === 'A provider abstract used to derive detailed keywords.',
    'literature_doi_or_abstract_was_not_persisted',
  );
  const manual = database.updateLiteratureManualAnnotations({
    projectId,
    recordId: first.id,
    expectedVersion: first.version,
    expectedAnnotationVersion: first.annotationVersion,
    manualTopics: ['verified'],
    manualSummary: 'Human-reviewed summary',
    manualRelevance: 'Directly relevant',
    reviewStatus: 'included',
    updatedAt: fixedTimestamp,
  });
  invariant(
    manual?.annotationVersion === 1 && manual.reviewStatus === 'included',
    'literature_manual_annotation_update_failed',
  );
  const provenance: LiteratureAiProvenance = {
    invocation: {
      schemaVersion: 1,
      invocationId: randomUUID(),
      providerId: 'codex',
      requestedModelId: null,
      resolvedModelId: 'fixture-model',
      catalogVersion: 'fixture-catalog',
      reasoningOptionId: 'high',
      startedAt: fixedTimestamp,
    },
    inputSha256: 'a'.repeat(64),
    generatedAt: fixedTimestamp,
    metadataOnly: true,
  };
  const ai = database.applyLiteratureAiAnnotations(
    projectId,
    [
      {
        recordId: first.id,
        expectedVersion: manual.version,
        expectedAnnotationVersion: manual.annotationVersion,
        topics: ['metadata'],
        keywords: ['bounded research system', 'metadata quality'],
        summary: 'Metadata-only AI summary',
        relevance: 'high',
        studyType: 'Not assessable from metadata alone',
        limitations: ['Not assessable from metadata alone'],
        provenance,
      },
    ],
    fixedTimestamp,
  );
  invariant(
    ai?.[0]?.aiAnnotations?.provenance.metadataOnly &&
      ai[0].aiAnnotations.keywords?.includes('metadata quality'),
    'literature_ai_update_failed',
  );

  const secondRunId = randomUUID();
  invariant(
    database.beginLiteratureSearch({ ...firstRun, id: secondRunId, query: 'refresh fixture' }),
    'literature_refresh_start_failed',
  );
  const refresh = database.completeLiteratureSearch(
    projectId,
    secondRunId,
    [
      {
        provider: 'crossref',
        providerId: 'crossref-fixture-1',
        doi: '10.1000/gosu.fixture',
        fingerprint: literatureFingerprint('Updated provider title', authors, 2026),
        title: 'Updated provider title',
        authors,
        containerTitle: 'Updated Fixture Journal',
        publishedYear: 2026,
        topics: ['updated source topic'],
        workType: 'journal-article',
        citationCount: 9,
        sourceUrl: 'https://doi.org/10.1000/gosu.fixture',
      },
    ],
    fixedTimestamp,
  );
  invariant(refresh.updatedCount === 1, 'literature_crossref_refresh_not_classified');
  const refreshed = database.listLiteratureRecords(projectId)[0];
  invariant(
    refreshed?.title === 'Updated provider title' &&
      refreshed.manualAnnotations.summary === 'Human-reviewed summary' &&
      refreshed.aiAnnotations === null &&
      refreshed.annotationVersion === ai[0]!.annotationVersion + 1,
    'literature_crossref_refresh_did_not_invalidate_stale_ai',
  );
  const reorganized = database.applyLiteratureAiAnnotations(
    projectId,
    [
      {
        recordId: refreshed.id,
        expectedVersion: refreshed.version,
        expectedAnnotationVersion: refreshed.annotationVersion,
        topics: ['updated metadata'],
        summary: 'Metadata-only AI summary',
        relevance: 'high',
        studyType: 'Not assessable from metadata alone',
        limitations: ['Not assessable from metadata alone'],
        provenance,
      },
    ],
    fixedTimestamp,
  );
  invariant(
    reorganized?.[0]?.aiAnnotations?.summary === 'Metadata-only AI summary',
    'literature_crossref_refresh_could_not_be_reorganized',
  );

  const imported = database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'import',
        doi: '10.1000/gosu.fixture',
        fingerprint: firstFingerprint,
        title: 'Untrusted stale imported title',
        authors: ['Different Imported Author'],
        publishedYear: 2020,
        topics: ['stale import topic'],
        citationKey: 'ImportedReviewKey',
        reviewStatus: 'reviewed',
        manualAnnotations: {
          topics: ['restored review'],
          summary: 'Imported human review',
          relevance: 'Imported relevance',
        },
      },
    ],
    fixedTimestamp,
  );
  invariant(imported.updated === 1, 'literature_review_import_not_updated');
  const merged = database.listLiteratureRecords(projectId)[0];
  invariant(
    merged?.provider === 'crossref' &&
      merged.title === 'Updated provider title' &&
      merged.manualAnnotations.summary === 'Imported human review' &&
      merged.reviewStatus === 'reviewed' &&
      merged.aiAnnotations?.summary === 'Metadata-only AI summary',
    'literature_import_trust_merge_failed',
  );
  const literatureSearchMatches = database.searchLiteratureRecords(
    [projectId],
    'imported human review',
    10,
  );
  invariant(
    literatureSearchMatches.length === 1 && literatureSearchMatches[0]?.id === merged.id,
    'literature_search_did_not_match_manual_annotation',
  );
  invariant(
    database.searchLiteratureRecords([projectId], merged.citationKey, 10)[0]?.id === merged.id &&
      database.searchLiteratureRecords([projectId], String(merged.publishedYear), 10)[0]?.id ===
        merged.id &&
      database.searchLiteratureRecords([projectId], String(merged.citationCount), 10)[0]?.id ===
        merged.id,
    'literature_search_did_not_match_citation_identity_fields',
  );
  invariant(
    database.searchLiteratureRecords([otherProjectId], 'imported human review', 10).length === 0,
    'literature_search_crossed_project_boundary',
  );

  const providerIdentityTitle = 'Provider identity before metadata change';
  database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'crossref',
        providerId: 'https://api.crossref.org/works/provider-only-fixture',
        fingerprint: literatureFingerprint(providerIdentityTitle, authors, 2025),
        title: providerIdentityTitle,
        authors,
        publishedYear: 2025,
        topics: [],
      },
    ],
    fixedTimestamp,
  );
  database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'crossref',
        providerId: '10.1000/gosu.provider-enriched',
        doi: '10.1000/gosu.provider-enriched',
        fingerprint: literatureFingerprint(providerIdentityTitle, authors, 2025),
        title: providerIdentityTitle,
        authors,
        publishedYear: 2025,
        topics: [],
      },
    ],
    fixedTimestamp,
  );
  database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'crossref',
        providerId: '10.1000/gosu.provider-enriched',
        doi: '10.1000/gosu.provider-enriched',
        fingerprint: literatureFingerprint('Provider identity changed title', authors, 2025),
        title: 'Provider identity changed title',
        authors,
        publishedYear: 2025,
        topics: [],
      },
    ],
    fixedTimestamp,
  );
  const providerIdentity = database
    .listLiteratureRecords(projectId)
    .find((record) => record.doi === '10.1000/gosu.provider-enriched');
  const providerFallbackIdentity = database
    .listLiteratureRecords(projectId)
    .find(
      (record) =>
        record.providerRecordId === 'https://api.crossref.org/works/provider-only-fixture',
    );
  invariant(
    database.countLiteratureRecords(projectId) === 3 &&
      providerIdentity?.doi === '10.1000/gosu.provider-enriched' &&
      providerIdentity?.fingerprint ===
        literatureFingerprint('Provider identity changed title', authors, 2025) &&
      providerFallbackIdentity?.doi === null,
    'literature_provider_identity_or_fingerprint_refresh_failed',
  );

  const fingerprintTitle = 'Fingerprint-only identity';
  const fingerprint = literatureFingerprint(fingerprintTitle, authors, 2024);
  database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'import',
        fingerprint,
        title: fingerprintTitle,
        authors,
        publishedYear: 2024,
        topics: [],
      },
      {
        provider: 'import',
        fingerprint,
        title: fingerprintTitle,
        authors,
        publishedYear: 2024,
        topics: [],
        reviewStatus: 'screening',
      },
    ],
    fixedTimestamp,
  );
  invariant(
    database.countLiteratureRecords(projectId) === 4,
    'literature_fingerprint_dedupe_failed',
  );
  database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'crossref',
        providerId: '10.1000/gosu.fingerprint-enriched',
        doi: '10.1000/gosu.fingerprint-enriched',
        fingerprint,
        title: fingerprintTitle,
        authors,
        publishedYear: 2024,
        topics: ['provider metadata'],
      },
    ],
    fixedTimestamp,
  );
  const enrichedFingerprintRecord = database
    .listLiteratureRecords(projectId)
    .find((record) => record.doi === '10.1000/gosu.fingerprint-enriched');
  invariant(
    database.countLiteratureRecords(projectId) === 4 &&
      enrichedFingerprintRecord?.provider === 'crossref' &&
      enrichedFingerprintRecord.reviewStatus === 'screening',
    'literature_weak_fingerprint_was_not_safely_enriched',
  );

  database.upsertLiteratureCandidates(
    otherProjectId,
    [
      {
        provider: 'crossref',
        doi: '10.1000/gosu.fixture',
        fingerprint: firstFingerprint,
        title,
        authors,
        publishedYear: 2026,
        topics: [],
      },
    ],
    fixedTimestamp,
  );
  invariant(
    database.countLiteratureRecords(otherProjectId) === 1 &&
      database.countLiteratureRecords(projectId) === 4,
    'literature_project_isolation_failed',
  );

  const beforeAtomicConflict = database.getLiteratureRecordsByIds(projectId, [merged.id])[0]!;
  const atomicConflict = database.applyLiteratureAiAnnotations(
    projectId,
    [
      {
        recordId: merged.id,
        expectedVersion: beforeAtomicConflict.version,
        expectedAnnotationVersion: beforeAtomicConflict.annotationVersion,
        topics: ['would-be-write'],
        summary: 'This must roll back',
        relevance: 'low',
        studyType: '',
        limitations: [],
        provenance,
      },
      {
        recordId: randomUUID(),
        expectedVersion: 1,
        expectedAnnotationVersion: 0,
        topics: [],
        summary: '',
        relevance: 'uncertain',
        studyType: '',
        limitations: [],
        provenance,
      },
    ],
    fixedTimestamp,
  );
  invariant(atomicConflict === null, 'literature_ai_conflict_was_not_rejected');
  invariant(
    database.getLiteratureRecordsByIds(projectId, [merged.id])[0]?.aiAnnotations?.summary ===
      'Metadata-only AI summary',
    'literature_ai_conflict_was_not_atomic',
  );
  invariant(
    database.updateLiteratureManualAnnotations({
      projectId,
      recordId: merged.id,
      expectedVersion: 1,
      expectedAnnotationVersion: 0,
      manualTopics: [],
      manualSummary: '',
      manualRelevance: '',
      reviewStatus: 'unreviewed',
      updatedAt: fixedTimestamp,
    }) === null,
    'literature_manual_conflict_was_not_rejected',
  );

  const beforeSourceRefresh = database.getLiteratureRecordsByIds(projectId, [merged.id])[0]!;
  const staleDraftRunId = randomUUID();
  invariant(
    database.beginLiteratureSearch({
      ...firstRun,
      id: staleDraftRunId,
      query: 'source refresh after AI draft',
    }),
    'literature_stale_ai_refresh_start_failed',
  );
  database.completeLiteratureSearch(
    projectId,
    staleDraftRunId,
    [
      {
        provider: 'crossref',
        ...(beforeSourceRefresh.providerRecordId
          ? { providerId: beforeSourceRefresh.providerRecordId }
          : {}),
        ...(beforeSourceRefresh.doi ? { doi: beforeSourceRefresh.doi } : {}),
        fingerprint: literatureFingerprint('Source changed after AI draft', authors, 2026),
        title: 'Source changed after AI draft',
        authors,
        ...(beforeSourceRefresh.containerTitle
          ? { containerTitle: beforeSourceRefresh.containerTitle }
          : {}),
        publishedYear: 2026,
        topics: ['fresh source metadata'],
        ...(beforeSourceRefresh.workType ? { workType: beforeSourceRefresh.workType } : {}),
        citationCount: 10,
        ...(beforeSourceRefresh.sourceUrl ? { sourceUrl: beforeSourceRefresh.sourceUrl } : {}),
      },
    ],
    fixedTimestamp,
  );
  const afterSourceRefresh = database.getLiteratureRecordsByIds(projectId, [merged.id])[0]!;
  invariant(
    afterSourceRefresh.version === beforeSourceRefresh.version + 1 &&
      afterSourceRefresh.annotationVersion === beforeSourceRefresh.annotationVersion + 1 &&
      afterSourceRefresh.aiAnnotations === null,
    'literature_source_refresh_did_not_clear_ai_annotations',
  );
  invariant(
    database.applyLiteratureAiAnnotations(
      projectId,
      [
        {
          recordId: merged.id,
          expectedVersion: beforeSourceRefresh.version,
          expectedAnnotationVersion: beforeSourceRefresh.annotationVersion,
          topics: ['stale-draft'],
          summary: 'This stale draft must not apply',
          relevance: 'low',
          studyType: '',
          limitations: [],
          provenance,
        },
      ],
      fixedTimestamp,
    ) === null,
    'literature_stale_ai_source_version_was_accepted',
  );
  const freshAi = database.applyLiteratureAiAnnotations(
    projectId,
    [
      {
        recordId: merged.id,
        expectedVersion: afterSourceRefresh.version,
        expectedAnnotationVersion: afterSourceRefresh.annotationVersion,
        topics: ['fresh-draft'],
        summary: 'Fresh metadata-only draft',
        relevance: 'high',
        studyType: '',
        limitations: [],
        provenance,
      },
    ],
    fixedTimestamp,
  );
  invariant(
    freshAi?.[0]?.aiAnnotations?.summary === 'Fresh metadata-only draft',
    'literature_source_refresh_new_ai_cas_failed',
  );
  invariant(
    database.deleteLiteratureRecord(projectId, merged.id, freshAi[0]!.version, fixedTimestamp),
    'literature_soft_delete_failed',
  );
  invariant(
    !database.listLiteratureRecords(projectId).some((record) => record.id === merged.id),
    'literature_soft_delete_remained_visible',
  );
  database.close();

  const reopened = new LocalDatabase();
  reopened.open();
  const reopenedRuns = reopened.listLiteratureSearchRuns(projectId);
  invariant(reopenedRuns.length === 3, 'literature_runs_not_reopened');
  invariant(
    reopenedRuns.find((run) => run.id === firstRunId)?.authorQuery === 'Ada Researcher' &&
      reopenedRuns.find((run) => run.id === firstRunId)?.venueQuery === 'Journal of Fixtures',
    'literature_structured_search_filters_not_reopened',
  );
  invariant(reopened.countLiteratureRecords(projectId) === 3, 'literature_records_not_reopened');
  invariant(
    reopened.countLiteratureRecords(otherProjectId) === 1,
    'literature_other_project_not_reopened',
  );
  reopened.close();
}

function verifyLiteratureSearchTagPersistence(fixedTimestamp: string) {
  const database = new LocalDatabase();
  database.open();
  const projectId = randomUUID();
  const doi = '10.1000/gosu.search-tags';
  const candidate = {
    provider: 'crossref' as const,
    providerId: 'crossref-search-tags',
    doi,
    fingerprint: literatureFingerprint('Tagged literature fixture', ['Tag Researcher'], 2026),
    title: 'Tagged literature fixture',
    authors: ['Tag Researcher'],
    containerTitle: 'Journal of Search Provenance',
    publishedYear: 2026,
    topics: ['provider subject'],
    workType: 'journal-article',
    citationCount: 7,
    sourceUrl: `https://doi.org/${doi}`,
  };
  const run = (
    query: string,
    searchTags: LiteratureSearchRun['searchTags'],
  ): LiteratureSearchRun => ({
    schemaVersion: 1,
    id: randomUUID(),
    projectId,
    provider: 'crossref',
    query,
    searchTags,
    fromYear: null,
    toYear: null,
    requestedLimit: 10,
    status: 'running',
    foundCount: 0,
    newCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    conflictCount: 0,
    conflicts: [],
    createdAt: fixedTimestamp,
    completedAt: null,
  });

  const firstRun = run('tabular foundation models', {
    topics: ['Tabular foundation models'],
    keywords: ['TabPFN'],
  });
  invariant(database.beginLiteratureSearch(firstRun), 'literature_tag_search_start_failed');
  invariant(
    database.completeLiteratureSearch(projectId, firstRun.id, [candidate], fixedTimestamp)
      .newCount === 1,
    'literature_tag_search_insert_failed',
  );
  const inserted = database.listLiteratureRecords(projectId)[0]!;
  const provenance: LiteratureAiProvenance = {
    invocation: {
      schemaVersion: 1,
      invocationId: randomUUID(),
      providerId: 'codex',
      requestedModelId: null,
      resolvedModelId: 'fixture-model',
      catalogVersion: 'fixture-catalog',
      reasoningOptionId: null,
      startedAt: fixedTimestamp,
    },
    inputSha256: 'd'.repeat(64),
    generatedAt: fixedTimestamp,
    metadataOnly: true,
  };
  const annotated = database.applyLiteratureAiAnnotations(
    projectId,
    [
      {
        recordId: inserted.id,
        expectedVersion: inserted.version,
        expectedAnnotationVersion: inserted.annotationVersion,
        topics: ['AI suggestion'],
        summary: 'Keep this draft across tag-only updates.',
        relevance: 'high',
        studyType: '',
        limitations: [],
        provenance,
      },
    ],
    fixedTimestamp,
  )![0]!;

  const secondRun = run('in-context tabular learning', {
    topics: ['ＴＡＢＵＬＡＲ foundation models', 'In-context learning'],
    keywords: ['tabpfn', 'benchmarks'],
  });
  invariant(database.beginLiteratureSearch(secondRun), 'literature_second_tag_search_start_failed');
  const accumulatedReceipt = database.completeLiteratureSearch(
    projectId,
    secondRun.id,
    [candidate],
    fixedTimestamp,
  );
  const accumulated = database.listLiteratureRecords(projectId)[0]!;
  invariant(
    accumulatedReceipt.updatedCount === 1 &&
      accumulated.version === annotated.version + 1 &&
      accumulated.annotationVersion === annotated.annotationVersion &&
      accumulated.aiAnnotations?.summary === 'Keep this draft across tag-only updates.' &&
      accumulated.searchTags?.topics.join('|') ===
        'Tabular foundation models|In-context learning' &&
      accumulated.searchTags.keywords.join('|') === 'TabPFN|benchmarks',
    'literature_search_tags_were_not_accumulated_safely',
  );

  const duplicateRun = run('same normalized tags', {
    topics: ['tabular FOUNDATION models', 'in-context learning'],
    keywords: ['ＴａｂＰＦＮ', 'BENCHMARKS'],
  });
  invariant(database.beginLiteratureSearch(duplicateRun), 'literature_duplicate_tag_start_failed');
  const duplicateReceipt = database.completeLiteratureSearch(
    projectId,
    duplicateRun.id,
    [candidate],
    fixedTimestamp,
  );
  const afterDuplicate = database.listLiteratureRecords(projectId)[0]!;
  invariant(
    duplicateReceipt.unchangedCount === 1 && afterDuplicate.version === accumulated.version,
    'literature_search_tag_normalization_was_not_idempotent',
  );

  database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'crossref',
        providerId: 'crossref-other-tag-record',
        doi: '10.1000/gosu.search-tags.other',
        fingerprint: literatureFingerprint('Other tagged identity', ['Tag Researcher'], 2025),
        title: 'Other tagged identity',
        authors: ['Tag Researcher'],
        publishedYear: 2025,
        topics: [],
      },
    ],
    fixedTimestamp,
  );
  const conflictRun = run('conflicting tag search', {
    topics: ['Must not be applied'],
    keywords: ['conflict'],
  });
  invariant(database.beginLiteratureSearch(conflictRun), 'literature_conflict_tag_start_failed');
  const conflictReceipt = database.completeLiteratureSearch(
    projectId,
    conflictRun.id,
    [
      {
        ...candidate,
        providerId: 'crossref-other-tag-record',
      },
    ],
    fixedTimestamp,
  );
  invariant(
    conflictReceipt.conflictCount === 1 &&
      database
        .listLiteratureRecords(projectId)
        .every(
          (record) =>
            !record.searchTags?.topics.includes('Must not be applied') &&
            !record.searchTags?.keywords.includes('conflict'),
        ),
    'literature_identity_conflict_received_search_tags',
  );

  const failedRun = run('failed tag search', {
    topics: ['Failure must not apply'],
    keywords: [],
  });
  invariant(database.beginLiteratureSearch(failedRun), 'literature_failed_tag_start_failed');
  invariant(
    database.failLiteratureSearch(projectId, failedRun.id, 'failed', fixedTimestamp),
    'literature_failed_tag_run_not_reconciled',
  );
  invariant(
    database
      .listLiteratureRecords(projectId)
      .every((record) => !record.searchTags?.topics.includes('Failure must not apply')),
    'literature_failed_search_received_tags',
  );
  database.close();

  const reopened = new LocalDatabase();
  reopened.open();
  const durableRecord = reopened
    .listLiteratureRecords(projectId)
    .find((record) => record.doi === doi);
  const durableRun = reopened
    .listLiteratureSearchRuns(projectId)
    .find((search) => search.id === secondRun.id);
  invariant(
    durableRecord?.searchTags?.topics.join('|') ===
      'Tabular foundation models|In-context learning' &&
      durableRun?.searchTags?.keywords.join('|') === 'tabpfn|benchmarks',
    'literature_search_tags_were_not_durable',
  );
  reopened.close();
}

function verifySparseSemanticScholarMerge(fixedTimestamp: string) {
  const database = new LocalDatabase();
  database.open();
  const projectId = randomUUID();
  const doi = '10.1000/gosu.sparse-semantic';
  const title = 'Durable provider metadata';
  const authors = ['Ada Researcher', 'Grace Scientist'];
  const originalFingerprint = literatureFingerprint(title, authors, 2018);
  const original = database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'crossref',
        providerId: doi,
        doi,
        fingerprint: originalFingerprint,
        title,
        authors,
        containerTitle: 'Journal of Durable Metadata',
        publishedYear: 2018,
        topics: ['durable metadata', 'research systems'],
        workType: 'journal-article',
        citationCount: 72,
        sourceUrl: `https://doi.org/${doi}`,
      },
    ],
    fixedTimestamp,
  );
  invariant(original.imported === 1, 'sparse_semantic_fixture_was_not_inserted');
  const inserted = database.listLiteratureRecords(projectId)[0]!;
  const manual = database.updateLiteratureManualAnnotations({
    projectId,
    recordId: inserted.id,
    expectedVersion: inserted.version,
    expectedAnnotationVersion: inserted.annotationVersion,
    manualTopics: ['human verified'],
    manualSummary: 'Preserve this human review.',
    manualRelevance: 'Directly relevant',
    reviewStatus: 'included',
    updatedAt: fixedTimestamp,
  })!;
  const provenance: LiteratureAiProvenance = {
    invocation: {
      schemaVersion: 1,
      invocationId: randomUUID(),
      providerId: 'codex',
      requestedModelId: null,
      resolvedModelId: 'fixture-model',
      catalogVersion: 'fixture-catalog',
      reasoningOptionId: 'high',
      startedAt: fixedTimestamp,
    },
    inputSha256: 'c'.repeat(64),
    generatedAt: fixedTimestamp,
    metadataOnly: true,
  };
  const annotated = database.applyLiteratureAiAnnotations(
    projectId,
    [
      {
        recordId: manual.id,
        expectedVersion: manual.version,
        expectedAnnotationVersion: manual.annotationVersion,
        topics: ['provider metadata'],
        summary: 'AI summary before provider promotion',
        relevance: 'high',
        studyType: '',
        limitations: [],
        provenance,
      },
    ],
    fixedTimestamp,
  )![0]!;
  const sparseSemanticCandidate = {
    provider: 'semantic-scholar' as const,
    providerId: 'semantic-sparse-fixture',
    doi,
    fingerprint: literatureFingerprint(title, [], undefined),
    title,
    authors: [],
    topics: [],
  };

  const promotion = database.upsertLiteratureCandidates(
    projectId,
    [sparseSemanticCandidate],
    fixedTimestamp,
  );
  const promoted = database.listLiteratureRecords(projectId)[0]!;
  invariant(
    promotion.updated === 1 &&
      promoted.provider === 'semantic-scholar' &&
      promoted.providerRecordId === 'semantic-sparse-fixture' &&
      promoted.authors.join('|') === authors.join('|') &&
      promoted.containerTitle === 'Journal of Durable Metadata' &&
      promoted.publishedYear === 2018 &&
      promoted.sourceTopics.join('|') === 'durable metadata|research systems' &&
      promoted.workType === 'journal-article' &&
      promoted.citationCount === 72 &&
      promoted.sourceUrl === `https://doi.org/${doi}` &&
      promoted.fingerprint === originalFingerprint &&
      promoted.manualAnnotations.summary === 'Preserve this human review.' &&
      promoted.reviewStatus === 'included' &&
      promoted.aiAnnotations === null &&
      promoted.annotationVersion === annotated.annotationVersion + 1,
    'sparse_semantic_provider_promotion_erased_known_metadata',
  );

  const refreshedAi = database.applyLiteratureAiAnnotations(
    projectId,
    [
      {
        recordId: promoted.id,
        expectedVersion: promoted.version,
        expectedAnnotationVersion: promoted.annotationVersion,
        topics: ['preserved metadata'],
        summary: 'AI summary after provider promotion',
        relevance: 'high',
        studyType: '',
        limitations: [],
        provenance,
      },
    ],
    fixedTimestamp,
  )![0]!;
  const noOp = database.upsertLiteratureCandidates(
    projectId,
    [sparseSemanticCandidate],
    fixedTimestamp,
  );
  const afterNoOp = database.listLiteratureRecords(projectId)[0]!;
  invariant(
    noOp.skipped === 1 &&
      afterNoOp.version === refreshedAi.version &&
      afterNoOp.annotationVersion === refreshedAi.annotationVersion &&
      afterNoOp.aiAnnotations?.summary === 'AI summary after provider promotion',
    'repeated_sparse_semantic_refresh_invalidated_unchanged_ai',
  );

  const richerTitle = 'Richer Semantic Scholar metadata';
  const richerAuthors = ['Ada Researcher', 'Katherine Scholar'];
  const richer = database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'semantic-scholar',
        providerId: 'semantic-sparse-fixture',
        doi,
        fingerprint: literatureFingerprint(richerTitle, richerAuthors, 2024),
        title: richerTitle,
        authors: richerAuthors,
        containerTitle: 'Semantic Systems Conference',
        publishedYear: 2024,
        topics: ['foundation models'],
        workType: 'Conference',
        citationCount: 99,
        sourceUrl: 'https://www.semanticscholar.org/paper/semantic-sparse-fixture',
      },
    ],
    fixedTimestamp,
  );
  const enriched = database.listLiteratureRecords(projectId)[0]!;
  invariant(
    richer.updated === 1 &&
      enriched.title === richerTitle &&
      enriched.authors.join('|') === richerAuthors.join('|') &&
      enriched.containerTitle === 'Semantic Systems Conference' &&
      enriched.publishedYear === 2024 &&
      enriched.sourceTopics.join('|') === 'foundation models' &&
      enriched.workType === 'Conference' &&
      enriched.citationCount === 99 &&
      enriched.fingerprint === literatureFingerprint(richerTitle, richerAuthors, 2024) &&
      enriched.manualAnnotations.summary === 'Preserve this human review.' &&
      enriched.aiAnnotations === null,
    'explicit_richer_semantic_metadata_was_not_applied',
  );
  database.close();

  const reopened = new LocalDatabase();
  reopened.open();
  const durable = reopened.listLiteratureRecords(projectId)[0];
  invariant(
    durable?.provider === 'semantic-scholar' &&
      durable.title === richerTitle &&
      durable.manualAnnotations.summary === 'Preserve this human review.',
    'semantic_metadata_merge_was_not_durable',
  );
  reopened.close();
}

function verifyLiteratureDiscoveryPersistence(fixedTimestamp: string) {
  const database = new LocalDatabase();
  database.open();
  const projectId = randomUUID();
  const runId = randomUUID();
  const query = 'deep literature discovery';
  invariant(
    database.beginLiteratureSearch({
      schemaVersion: 1,
      id: runId,
      projectId,
      provider: 'balanced',
      policyId: 'balanced-three-layer',
      policyVersion: 1,
      query,
      fromYear: null,
      toYear: null,
      requestedLimit: 3,
      status: 'running',
      foundCount: 0,
      retrievedCount: 0,
      selectedCount: 0,
      tierCounts: { core: 0, rising: 0, broad: 0 },
      newCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      conflictCount: 0,
      conflicts: [],
      createdAt: fixedTimestamp,
      completedAt: null,
    }),
    'literature_discovery_search_start_failed',
  );
  const discovery = (
    tier: LiteratureDiscoveryTier,
    tierRank: number,
    score: number,
  ): LiteratureRankingSignals => ({
    tier,
    matchedLayers: tier === 'broad' ? ['broad'] : [tier, 'broad'],
    tierRank,
    overallScore: score,
    relevanceScore: score,
    authorityScore: tier === 'core' ? 0.9 : 0.3,
    momentumScore: tier === 'rising' ? 0.9 : 0.2,
    citationVelocityProxy: tier === 'rising' ? 12.5 : 1,
    influentialCitationCount: tier === 'core' ? 100 : 2,
    maxAuthorHIndex: tier === 'core' ? 80 : 10,
    reasons:
      tier === 'core'
        ? ['high-query-relevance', 'high-citation-impact']
        : tier === 'rising'
          ? ['recent-publication', 'estimated-citation-momentum']
          : ['broad-recall'],
    signalSources: ['semantic-scholar'],
  });
  const candidates = (['core', 'rising', 'broad'] as const).map((tier, index) => ({
    provider: 'semantic-scholar' as const,
    providerId: `discovery-${tier}`,
    doi: `10.1000/gosu.discovery.${tier}`,
    fingerprint: literatureFingerprint(`Discovery ${tier}`, ['Discovery Author'], 2026 - index),
    title: `Discovery ${tier}`,
    authors: ['Discovery Author'],
    publishedYear: 2026 - index,
    topics: ['discovery'],
    citationCount: 100 - index,
    discovery: discovery(tier, 1, 0.9 - index * 0.1),
  }));
  const coverage: LiteratureDiscoveryCoverage = {
    source: 'semantic-scholar',
    availableSignals: ['relevance', 'citation-authority', 'recent-momentum'],
    degradationReasons: ['author-metrics-unavailable'],
  };
  const receipt = database.completeLiteratureSearch(projectId, runId, candidates, fixedTimestamp, {
    retrievedCount: 137,
    selectedCount: 3,
    tierCounts: { core: 1, rising: 1, broad: 1 },
    coverage,
  });
  invariant(
    receipt.retrievedCount === 137 &&
      receipt.selectedCount === 3 &&
      receipt.tierCounts.core === 1 &&
      receipt.tierCounts.rising === 1 &&
      receipt.tierCounts.broad === 1 &&
      receipt.run.coverage?.source === 'semantic-scholar' &&
      receipt.run.coverage.degradationReasons[0] === 'author-metrics-unavailable',
    'literature_discovery_counts_were_not_persisted',
  );
  const records = database.listLiteratureRecords(projectId);
  invariant(
    records.every(
      (record) =>
        record.discovery?.searchRunId === runId &&
        record.discovery.query === query &&
        record.discovery.policyId === 'balanced-three-layer',
    ) && new Set(records.map((record) => record.discovery?.tier)).size === 3,
    'literature_discovery_provenance_was_not_persisted',
  );
  database.close();

  const reopened = new LocalDatabase();
  reopened.open();
  const [savedRun] = reopened.listLiteratureSearchRuns(projectId);
  invariant(
    savedRun?.retrievedCount === 137 &&
      savedRun.selectedCount === 3 &&
      savedRun.tierCounts?.core === 1 &&
      savedRun.coverage?.availableSignals.includes('citation-authority') === true &&
      savedRun.coverage.degradationReasons.includes('author-metrics-unavailable') &&
      reopened
        .listLiteratureRecords(projectId)
        .every((record) => record.discovery !== undefined && record.discovery !== null),
    'literature_discovery_provenance_was_not_durable',
  );
  reopened.close();
}

function verifyLiteratureBoundsAndIdentity(fixedTimestamp: string) {
  const database = new LocalDatabase();
  database.open();
  try {
    const identityProjectId = randomUUID();
    const identityCandidates = ['doi', 'provider', 'fingerprint'].map((name, index) => ({
      provider: 'crossref' as const,
      providerId: `identity-provider-${index}`,
      doi: `10.1000/gosu.identity-${index}`,
      fingerprint: literatureFingerprint(`Identity ${name}`, ['Identity Author'], 2026),
      title: `Identity ${name}`,
      authors: ['Identity Author'],
      publishedYear: 2026,
      topics: [],
      citationKey: `Identity${index}`,
    }));
    database.upsertLiteratureCandidates(identityProjectId, identityCandidates, fixedTimestamp);

    const canonicalArxivProjectId = randomUUID();
    const canonicalId = 'arxiv:2504.10808';
    const huggingFaceInsert = database.upsertLiteratureCandidates(
      canonicalArxivProjectId,
      [
        {
          provider: 'hugging-face',
          providerId: '2504.10808',
          canonicalId,
          fingerprint: '8'.repeat(64),
          title: 'HF title formatting',
          authors: ['HF Author Format'],
          publishedYear: 2025,
          topics: [],
        },
      ],
      fixedTimestamp,
    );
    const semanticScholarMerge = database.upsertLiteratureCandidates(
      canonicalArxivProjectId,
      [
        {
          provider: 'semantic-scholar',
          providerId: 'semantic-paper-identity',
          canonicalId,
          fingerprint: '9'.repeat(64),
          title: 'Semantic Scholar canonical title',
          authors: ['Semantic Author Format'],
          publishedYear: 2025,
          topics: ['canonical identity'],
          citationCount: 42,
        },
      ],
      fixedTimestamp,
    );
    const [canonicalRecord] = database.listLiteratureRecords(canonicalArxivProjectId);
    invariant(
      huggingFaceInsert.imported === 1 &&
        semanticScholarMerge.updated === 1 &&
        database.countLiteratureRecords(canonicalArxivProjectId) === 1 &&
        canonicalRecord?.canonicalId === canonicalId &&
        canonicalRecord.provider === 'semantic-scholar' &&
        canonicalRecord.citationCount === 42,
      'literature_cross_provider_arxiv_identity_was_not_merged',
    );

    const sharedFingerprintProjectId = randomUUID();
    const sharedFingerprintTitle =
      'A physics-informed residual correction framework for pretrained tabular foundation model based battery health prognostics';
    const sharedFingerprintAuthors = ['Zhiqiang Li'];
    const sharedFingerprint = literatureFingerprint(
      sharedFingerprintTitle,
      sharedFingerprintAuthors,
      2026,
    );
    const sharedFingerprintCandidates = ['10.2139/ssrn.6778930', '10.2139/ssrn.6862081'].map(
      (doi) => ({
        provider: 'crossref' as const,
        providerId: doi,
        doi,
        fingerprint: sharedFingerprint,
        title: sharedFingerprintTitle,
        authors: sharedFingerprintAuthors,
        publishedYear: 2026,
        topics: [],
      }),
    );
    const sharedFingerprintRunId = randomUUID();
    invariant(
      database.beginLiteratureSearch({
        schemaVersion: 1,
        id: sharedFingerprintRunId,
        projectId: sharedFingerprintProjectId,
        provider: 'crossref',
        query: 'tabular foundation model',
        fromYear: null,
        toYear: null,
        requestedLimit: 25,
        status: 'running',
        foundCount: 0,
        newCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        conflictCount: 0,
        retrievedCount: 0,
        selectedCount: 0,
        tierCounts: { core: 0, rising: 0, broad: 0 },
        conflicts: [],
        createdAt: fixedTimestamp,
        completedAt: null,
      }),
      'literature_shared_fingerprint_search_start_failed',
    );
    const sharedFingerprintReceipt = database.completeLiteratureSearch(
      sharedFingerprintProjectId,
      sharedFingerprintRunId,
      sharedFingerprintCandidates,
      fixedTimestamp,
    );
    const sharedFingerprintRecords = database.listLiteratureRecords(sharedFingerprintProjectId);
    invariant(
      sharedFingerprintReceipt.foundCount === 2 &&
        sharedFingerprintReceipt.newCount === 2 &&
        sharedFingerprintReceipt.conflictCount === 0 &&
        sharedFingerprintRecords.length === 2 &&
        new Set(sharedFingerprintRecords.map((record) => record.doi)).size === 2 &&
        sharedFingerprintRecords.every((record) => record.fingerprint === sharedFingerprint),
      'literature_distinct_dois_with_shared_fingerprint_were_not_preserved',
    );
    const repeatedSharedFingerprintRunId = randomUUID();
    invariant(
      database.beginLiteratureSearch({
        ...sharedFingerprintReceipt.run,
        id: repeatedSharedFingerprintRunId,
        status: 'running',
        foundCount: 0,
        newCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        conflictCount: 0,
        retrievedCount: 0,
        selectedCount: 0,
        tierCounts: { core: 0, rising: 0, broad: 0 },
        conflicts: [],
        completedAt: null,
      }),
      'literature_shared_fingerprint_repeat_start_failed',
    );
    const repeatedSharedFingerprintReceipt = database.completeLiteratureSearch(
      sharedFingerprintProjectId,
      repeatedSharedFingerprintRunId,
      sharedFingerprintCandidates,
      fixedTimestamp,
    );
    invariant(
      repeatedSharedFingerprintReceipt.unchangedCount === 2 &&
        repeatedSharedFingerprintReceipt.conflictCount === 0 &&
        database.countLiteratureRecords(sharedFingerprintProjectId) === 2,
      'literature_distinct_dois_with_shared_fingerprint_were_not_idempotent',
    );
    let ambiguousWeakImportRejected = false;
    try {
      database.upsertLiteratureCandidates(
        sharedFingerprintProjectId,
        [
          {
            provider: 'import',
            fingerprint: sharedFingerprint,
            title: sharedFingerprintTitle,
            authors: sharedFingerprintAuthors,
            publishedYear: 2026,
            topics: [],
          },
        ],
        fixedTimestamp,
      );
    } catch (error) {
      ambiguousWeakImportRejected =
        error instanceof LiteratureStorageError && error.code === 'identity_conflict';
    }
    invariant(
      ambiguousWeakImportRejected &&
        database.countLiteratureRecords(sharedFingerprintProjectId) === 2,
      'literature_ambiguous_weak_fingerprint_was_not_rejected',
    );

    const singleStrongProjectId = randomUUID();
    const singleStrongFingerprint = literatureFingerprint(
      'One strong record with coarse metadata',
      ['Shared Author'],
      2026,
    );
    database.upsertLiteratureCandidates(
      singleStrongProjectId,
      [
        {
          provider: 'crossref',
          providerId: '10.1000/gosu.single-strong',
          doi: '10.1000/gosu.single-strong',
          fingerprint: singleStrongFingerprint,
          title: 'One strong record with coarse metadata',
          authors: ['Shared Author'],
          publishedYear: 2026,
          topics: [],
        },
      ],
      fixedTimestamp,
    );
    const singleStrongRecord = database.listLiteratureRecords(singleStrongProjectId)[0]!;
    const weakImport = {
      provider: 'import' as const,
      fingerprint: singleStrongFingerprint,
      title: singleStrongRecord.title,
      authors: singleStrongRecord.authors,
      ...(singleStrongRecord.publishedYear
        ? { publishedYear: singleStrongRecord.publishedYear }
        : {}),
      topics: [],
      reviewStatus: 'included' as const,
    };
    for (const deleted of [false, true]) {
      if (deleted) {
        invariant(
          database.deleteLiteratureRecord(
            singleStrongProjectId,
            singleStrongRecord.id,
            singleStrongRecord.version,
            fixedTimestamp,
          ),
          'literature_single_strong_delete_fixture_failed',
        );
      }
      let weakStrongCollisionRejected = false;
      try {
        database.upsertLiteratureCandidates(singleStrongProjectId, [weakImport], fixedTimestamp);
      } catch (error) {
        weakStrongCollisionRejected =
          error instanceof LiteratureStorageError && error.code === 'identity_conflict';
      }
      invariant(
        weakStrongCollisionRejected &&
          database.countLiteratureRecords(singleStrongProjectId) === (deleted ? 0 : 1),
        deleted
          ? 'literature_weak_fingerprint_resurrected_deleted_strong_record'
          : 'literature_weak_fingerprint_merged_into_strong_record',
      );
    }

    let identityConflictRejected = false;
    try {
      database.upsertLiteratureCandidates(
        identityProjectId,
        [
          {
            provider: 'import',
            fingerprint: literatureFingerprint('Must roll back', ['Atomic Author'], 2026),
            title: 'Must roll back',
            authors: ['Atomic Author'],
            publishedYear: 2026,
            topics: [],
            citationKey: 'MustRollBack',
          },
          {
            provider: 'crossref',
            providerId: identityCandidates[1]!.providerId,
            doi: identityCandidates[0]!.doi,
            fingerprint: identityCandidates[2]!.fingerprint,
            title: 'Conflicting three-way identity',
            authors: ['Identity Author'],
            publishedYear: 2026,
            topics: [],
          },
        ],
        fixedTimestamp,
      );
    } catch (error) {
      identityConflictRejected =
        error instanceof LiteratureStorageError && error.code === 'identity_conflict';
    }
    invariant(identityConflictRejected, 'literature_identity_conflict_was_not_typed');
    invariant(
      database.countLiteratureRecords(identityProjectId) === identityCandidates.length &&
        !database
          .listLiteratureRecords(identityProjectId)
          .some((record) => record.citationKey === 'MustRollBack'),
      'literature_identity_conflict_was_not_atomic',
    );

    const isolatedConflictRunId = randomUUID();
    invariant(
      database.beginLiteratureSearch({
        schemaVersion: 1,
        id: isolatedConflictRunId,
        projectId: identityProjectId,
        provider: 'crossref',
        query: 'isolated strong identity conflict',
        fromYear: null,
        toYear: null,
        requestedLimit: 5,
        status: 'running',
        foundCount: 0,
        newCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        conflictCount: 0,
        conflicts: [],
        createdAt: fixedTimestamp,
        completedAt: null,
      }),
      'literature_isolated_conflict_search_start_failed',
    );
    const safeSearchCandidate = {
      provider: 'crossref' as const,
      providerId: '10.1000/gosu.identity-safe-search',
      doi: '10.1000/gosu.identity-safe-search',
      fingerprint: literatureFingerprint('Safe search candidate', ['Safe Author'], 2026),
      title: 'Safe search candidate',
      authors: ['Safe Author'],
      publishedYear: 2026,
      topics: [],
    };
    const isolatedConflictReceipt = database.completeLiteratureSearch(
      identityProjectId,
      isolatedConflictRunId,
      [
        ...Array.from({ length: 4 }, (_, index) => ({
          provider: 'crossref' as const,
          providerId: identityCandidates[1]!.providerId,
          doi: identityCandidates[0]!.doi,
          fingerprint: literatureFingerprint(
            `Conflicting strong identities from search ${index}`,
            ['Identity Author'],
            2026,
          ),
          title: `Conflicting strong identities from search ${index}`,
          authors: ['Identity Author'],
          publishedYear: 2026,
          topics: [],
        })),
        safeSearchCandidate,
      ],
      fixedTimestamp,
    );
    const isolatedConflictRun = database
      .listLiteratureSearchRuns(identityProjectId)
      .find((run) => run.id === isolatedConflictRunId);
    const identityRecordsAfterSearch = database.listLiteratureRecords(identityProjectId);
    invariant(
      isolatedConflictReceipt.foundCount === 5 &&
        isolatedConflictReceipt.newCount === 1 &&
        isolatedConflictReceipt.updatedCount === 0 &&
        isolatedConflictReceipt.unchangedCount === 0 &&
        isolatedConflictReceipt.conflictCount === 4 &&
        isolatedConflictReceipt.run.status === 'complete' &&
        isolatedConflictReceipt.run.conflictCount === 4 &&
        isolatedConflictReceipt.run.conflicts.length === 3 &&
        isolatedConflictReceipt.run.conflicts[0]?.doi === identityCandidates[0]!.doi &&
        isolatedConflictReceipt.run.conflicts[0]?.providerRecordId ===
          identityCandidates[1]!.providerId &&
        isolatedConflictRun?.status === 'complete' &&
        isolatedConflictRun.conflictCount === 4 &&
        isolatedConflictRun.conflicts.length === 3 &&
        isolatedConflictRun.conflicts[0]?.title === 'Conflicting strong identities from search 0' &&
        identityRecordsAfterSearch.some((record) => record.doi === safeSearchCandidate.doi) &&
        identityCandidates.every((candidate) =>
          identityRecordsAfterSearch.some(
            (record) =>
              record.doi === candidate.doi && record.providerRecordId === candidate.providerId,
          ),
        ) &&
        identityRecordsAfterSearch.length === identityCandidates.length + 1,
      'literature_search_identity_conflict_was_not_isolated',
    );

    for (const mismatch of [
      {
        ...identityCandidates[0]!,
        doi: '10.1000/gosu.identity-different',
      },
      {
        ...identityCandidates[0]!,
        providerId: 'identity-provider-different',
      },
    ]) {
      let strongIdentityMismatchRejected = false;
      try {
        database.upsertLiteratureCandidates(identityProjectId, [mismatch], fixedTimestamp);
      } catch (error) {
        strongIdentityMismatchRejected =
          error instanceof LiteratureStorageError && error.code === 'identity_conflict';
      }
      invariant(
        strongIdentityMismatchRejected,
        'literature_strong_identity_mismatch_was_not_rejected',
      );
    }
    const preservedIdentity = database
      .listLiteratureRecords(identityProjectId)
      .find((record) => record.fingerprint === identityCandidates[0]!.fingerprint);
    invariant(
      preservedIdentity?.doi === identityCandidates[0]!.doi &&
        preservedIdentity.providerRecordId === identityCandidates[0]!.providerId,
      'literature_strong_identity_mismatch_overwrote_identity',
    );

    const capacityProjectId = randomUUID();
    const capacityCandidate = (index: number, provider: 'crossref' | 'import' = 'import') => ({
      provider,
      ...(provider === 'crossref' ? { providerId: `capacity-provider-${index}` } : {}),
      fingerprint: literatureFingerprint(`Capacity record ${index}`, ['Capacity Author'], 2026),
      title: `Capacity record ${index}`,
      authors: ['Capacity Author'],
      publishedYear: 2026,
      topics: [],
      citationKey: `Capacity${index}`,
    });
    database.upsertLiteratureCandidates(
      capacityProjectId,
      Array.from({ length: LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT - 1 }, (_, index) =>
        capacityCandidate(index),
      ),
      fixedTimestamp,
    );

    const capacityRunId = randomUUID();
    invariant(
      database.beginLiteratureSearch({
        schemaVersion: 1,
        id: capacityRunId,
        projectId: capacityProjectId,
        provider: 'crossref',
        query: 'capacity boundary',
        fromYear: null,
        toYear: null,
        requestedLimit: 2,
        status: 'running',
        foundCount: 0,
        newCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        conflictCount: 0,
        conflicts: [],
        createdAt: fixedTimestamp,
        completedAt: null,
      }),
      'literature_capacity_search_start_failed',
    );
    let searchLimitRejected = false;
    try {
      database.completeLiteratureSearch(
        capacityProjectId,
        capacityRunId,
        [capacityCandidate(10_000, 'crossref'), capacityCandidate(10_001, 'crossref')],
        fixedTimestamp,
      );
    } catch (error) {
      searchLimitRejected =
        error instanceof LiteratureStorageError && error.code === 'record_limit_reached';
    }
    invariant(searchLimitRejected, 'literature_search_capacity_was_not_typed');
    invariant(
      database.countLiteratureRecords(capacityProjectId) ===
        LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT - 1,
      'literature_search_capacity_was_not_atomic',
    );
    invariant(
      database.failLiteratureSearch(capacityProjectId, capacityRunId, 'failed', fixedTimestamp),
      'literature_capacity_search_was_not_reconcilable',
    );

    let importLimitRejected = false;
    try {
      database.upsertLiteratureCandidates(
        capacityProjectId,
        [capacityCandidate(20_000), capacityCandidate(20_001)],
        fixedTimestamp,
      );
    } catch (error) {
      importLimitRejected =
        error instanceof LiteratureStorageError && error.code === 'record_limit_reached';
    }
    invariant(importLimitRejected, 'literature_import_capacity_was_not_typed');
    invariant(
      database.countLiteratureRecords(capacityProjectId) ===
        LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT - 1,
      'literature_import_capacity_was_not_atomic',
    );
    database.upsertLiteratureCandidates(
      capacityProjectId,
      [capacityCandidate(30_000)],
      fixedTimestamp,
    );
    invariant(
      database.listLiteratureRecords(capacityProjectId).length ===
        LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT,
      'literature_record_list_was_silently_truncated',
    );
  } finally {
    database.close();
  }
}

function verifyLiteratureRelevanceMigration(rootUserData: string, fixedTimestamp: string) {
  const primaryUserData = app.getPath('userData');
  const legacyUserData = join(rootUserData, 'legacy-literature-relevance-v1');
  mkdirSync(legacyUserData, { recursive: true });
  app.setPath('userData', legacyUserData);
  try {
    const projectId = randomUUID();
    const legacySearchRunId = randomUUID();
    const bootstrap = new LocalDatabase();
    bootstrap.open();
    bootstrap.upsertLiteratureCandidates(
      projectId,
      [
        {
          provider: 'import',
          fingerprint: literatureFingerprint('Relevance migration', ['Migration Author'], 2026),
          title: 'Relevance migration',
          authors: ['Migration Author'],
          publishedYear: 2026,
          topics: [],
          manualAnnotations: {
            topics: [],
            summary: '',
            relevance: 'n'.repeat(4_000),
          },
        },
      ],
      fixedTimestamp,
    );
    const inserted = bootstrap.listLiteratureRecords(projectId)[0]!;
    invariant(
      inserted.manualAnnotations.relevance.length === 4_000,
      'new_literature_relevance_limit_was_not_applied',
    );
    const legacyValue = 'Preserved legacy relevance';
    const legacyRecord = bootstrap.updateLiteratureManualAnnotations({
      projectId,
      recordId: inserted.id,
      expectedVersion: inserted.version,
      expectedAnnotationVersion: inserted.annotationVersion,
      manualTopics: [],
      manualSummary: '',
      manualRelevance: legacyValue,
      reviewStatus: inserted.reviewStatus,
      updatedAt: fixedTimestamp,
    });
    invariant(legacyRecord !== null, 'legacy_literature_relevance_fixture_failed');
    bootstrap.upsertLiteratureCandidates(
      projectId,
      [
        {
          provider: 'hugging-face',
          providerId: '2504.10808v2',
          canonicalId: 'arxiv:2504.10808',
          fingerprint: literatureFingerprint('Legacy HF canonical paper', ['HF Author'], 2025),
          title: 'Legacy HF canonical paper',
          authors: ['HF Author'],
          publishedYear: 2025,
          topics: [],
        },
      ],
      fixedTimestamp,
    );
    const legacyHuggingFaceRecord = bootstrap
      .listLiteratureRecords(projectId)
      .find((record) => record.provider === 'hugging-face')!;
    bootstrap.close();

    const keyHex = safeStorage
      .decryptString(readFileSync(join(legacyUserData, 'local-key.bin')))
      .trim();
    const raw = new Database(join(legacyUserData, 'gosu.db'));
    try {
      raw.pragma(`key="x'${keyHex}'"`);
      raw.transaction(() => {
        raw
          .prepare('delete from local_schema_migrations where id=?')
          .run('literature-manual-relevance-v2');
        raw
          .prepare('delete from local_schema_migrations where id=?')
          .run('literature-weak-fingerprint-v1');
        raw
          .prepare('delete from local_schema_migrations where id=?')
          .run('literature-balanced-discovery-v1');
        raw
          .prepare('delete from local_schema_migrations where id=?')
          .run('literature-discovery-coverage-v1');
        raw
          .prepare('delete from local_schema_migrations where id=?')
          .run('literature-search-tags-v1');
        raw
          .prepare('delete from local_schema_migrations where id=?')
          .run('literature-hugging-face-provider-v1');
        raw
          .prepare('delete from local_schema_migrations where id=?')
          .run('literature-canonical-identity-v1');
        raw.exec(`
          drop index literature_record_weak_fingerprint_identity;
          drop index literature_records_by_fingerprint;
          drop index literature_record_canonical_identity;
          alter table literature_records drop column canonical_id;
          create unique index literature_record_fingerprint_identity
            on literature_records(project_id,fingerprint);
          alter table literature_records drop column current_discovery_json;
          alter table literature_records drop column search_tags_json;
          alter table literature_search_runs drop column policy_id;
          alter table literature_search_runs drop column policy_version;
          alter table literature_search_runs drop column retrieved_count;
          alter table literature_search_runs drop column selected_count;
          alter table literature_search_runs drop column core_count;
          alter table literature_search_runs drop column rising_count;
          alter table literature_search_runs drop column broad_count;
          alter table literature_search_runs drop column discovery_coverage_json;
          alter table literature_search_runs drop column search_tags_json;
          alter table literature_search_hits drop column discovery_tier;
          alter table literature_search_hits drop column tier_rank;
          alter table literature_search_hits drop column overall_score;
          alter table literature_search_hits drop column ranking_signals_json;
          drop table literature_search_conflicts;
          create table literature_search_conflicts (
            search_run_id text not null references literature_search_runs(id) on delete cascade,
            ordinal integer not null check (ordinal between 1 and 50),
            provider text not null check (provider='crossref'),
            provider_record_id text check (
              provider_record_id is null or length(provider_record_id) between 1 and 2048
            ),
            doi text check (doi is null or length(doi) between 1 and 512),
            fingerprint text not null check (length(fingerprint)=64),
            title text not null check (length(title) between 1 and 2000),
            authors_json text not null check (length(authors_json) <= 32768),
            published_year integer check (
              published_year is null or published_year between 1000 and 3000
            ),
            primary key(search_run_id,ordinal)
          );
          alter table literature_search_runs drop column conflict_count;
          alter table literature_records rename column manual_relevance to manual_relevance_v2;
          alter table literature_records add column manual_relevance text check (
            manual_relevance is null or length(manual_relevance) between 1 and 64
          );
          update literature_records set manual_relevance=manual_relevance_v2;
          alter table literature_records drop column manual_relevance_v2;
        `);
        raw
          .prepare(
            `insert into literature_search_runs(
               id,schema_version,project_id,provider,query,requested_limit,from_year,to_year,status,
               new_count,updated_count,unchanged_count,created_at,completed_at
             ) values(?,1,?,'crossref',?,25,null,null,'complete',1,0,0,?,?)`,
          )
          .run(
            legacySearchRunId,
            projectId,
            'legacy completed discovery',
            fixedTimestamp,
            fixedTimestamp,
          );
        raw
          .prepare(
            `insert into literature_search_conflicts(
               search_run_id,ordinal,provider,provider_record_id,doi,fingerprint,title,
               authors_json,published_year
             ) values(?,1,'crossref',?,?,?,?,?,2024)`,
          )
          .run(
            legacySearchRunId,
            '10.1000/legacy-conflict',
            '10.1000/legacy-conflict',
            literatureFingerprint('Preserved legacy conflict', ['Conflict Author'], 2024),
            'Preserved legacy conflict',
            JSON.stringify(['Conflict Author']),
          );
      })();
    } finally {
      raw.close();
    }

    const migrated = new LocalDatabase();
    migrated.open();
    const migratedRecords = migrated.listLiteratureRecords(projectId);
    const preserved = migratedRecords.find((record) => record.id === inserted.id)!;
    const migratedHuggingFaceRecord = migratedRecords.find(
      (record) => record.id === legacyHuggingFaceRecord.id,
    );
    invariant(
      preserved.manualAnnotations.relevance === legacyValue,
      'legacy_literature_relevance_was_not_preserved',
    );
    invariant(
      migratedHuggingFaceRecord?.title === legacyHuggingFaceRecord.title &&
        migratedHuggingFaceRecord.canonicalId === 'arxiv:2504.10808',
      'legacy_hugging_face_canonical_identity_was_not_preserved',
    );
    const expandedValue = 'r'.repeat(4_000);
    const expanded = migrated.updateLiteratureManualAnnotations({
      projectId,
      recordId: preserved.id,
      expectedVersion: preserved.version,
      expectedAnnotationVersion: preserved.annotationVersion,
      manualTopics: [],
      manualSummary: '',
      manualRelevance: expandedValue,
      reviewStatus: preserved.reviewStatus,
      updatedAt: fixedTimestamp,
    });
    invariant(
      expanded?.manualAnnotations.relevance === expandedValue,
      'migrated_literature_relevance_limit_was_not_applied',
    );
    const migratedLegacyRun = migrated
      .listLiteratureSearchRuns(projectId)
      .find(({ id }) => id === legacySearchRunId);
    invariant(
      migratedLegacyRun?.retrievedCount === 1 &&
        migratedLegacyRun.selectedCount === 1 &&
        migratedLegacyRun.searchTags?.topics.length === 0 &&
        migratedLegacyRun.searchTags.keywords.length === 0 &&
        migratedLegacyRun.conflicts[0]?.canonicalId === null &&
        migratedLegacyRun.conflicts[0]?.doi === '10.1000/legacy-conflict' &&
        migratedLegacyRun.conflicts[0]?.title === 'Preserved legacy conflict' &&
        migratedLegacyRun.conflicts[0]?.authors[0] === 'Conflict Author' &&
        migratedLegacyRun.tierCounts === undefined,
      'legacy_literature_search_counts_were_not_backfilled_safely',
    );
    migrated.close();

    const inspected = new Database(join(legacyUserData, 'gosu.db'));
    try {
      inspected.pragma(`key="x'${keyHex}'"`);
      const columns = inspected.pragma('table_info(literature_records)') as Array<{ name: string }>;
      const searchColumns = inspected.pragma('table_info(literature_search_runs)') as Array<{
        name: string;
      }>;
      const hitColumns = inspected.pragma('table_info(literature_search_hits)') as Array<{
        name: string;
      }>;
      const indexes = inspected.pragma('index_list(literature_records)') as Array<{
        name: string;
        unique: number;
      }>;
      const table = inspected
        .prepare("select sql from sqlite_master where type='table' and name='literature_records'")
        .get() as { sql: string };
      const conflictTable = inspected
        .prepare(
          "select sql from sqlite_master where type='table' and name='literature_search_conflicts'",
        )
        .get() as { sql: string };
      const canonicalIndex = inspected
        .prepare(
          "select sql from sqlite_master where type='index' and name='literature_record_canonical_identity'",
        )
        .get() as { sql: string };
      const weakFingerprintIndex = inspected
        .prepare(
          "select sql from sqlite_master where type='index' and name='literature_record_weak_fingerprint_identity'",
        )
        .get() as { sql: string };
      invariant(
        columns
          .filter((column) => column.name.includes('manual_relevance'))
          .every((column) => column.name === 'manual_relevance') &&
          columns.filter((column) => column.name === 'manual_relevance').length === 1,
        'literature_relevance_migration_left_a_duplicate_column',
      );
      invariant(
        /\bmanual_relevance\s+text\s+check\s*\(\s*manual_relevance\s+is\s+null\s+or\s+length\s*\(\s*manual_relevance\s*\)\s+between\s+1\s+and\s+4000\s*\)/iu.test(
          table.sql,
        ),
        'literature_relevance_migration_schema_is_not_4000',
      );
      invariant(
        searchColumns.some((column) => column.name === 'conflict_count'),
        'literature_search_conflict_count_was_not_migrated',
      );
      invariant(
        columns.some((column) => column.name === 'current_discovery_json') &&
          columns.some((column) => column.name === 'search_tags_json') &&
          columns.some((column) => column.name === 'canonical_id') &&
          [
            'policy_id',
            'policy_version',
            'retrieved_count',
            'selected_count',
            'core_count',
            'rising_count',
            'broad_count',
            'discovery_coverage_json',
            'search_tags_json',
          ].every((name) => searchColumns.some((column) => column.name === name)) &&
          ['discovery_tier', 'tier_rank', 'overall_score', 'ranking_signals_json'].every((name) =>
            hitColumns.some((column) => column.name === name),
          ) &&
          /provider\s+text\s+not\s+null\s+check/iu.test(conflictTable.sql) &&
          conflictTable.sql.includes("'semantic-scholar'") &&
          conflictTable.sql.includes("'hugging-face'") &&
          /\bcanonical_id\s+text\b/iu.test(conflictTable.sql),
        'literature_discovery_schema_was_not_migrated',
      );
      invariant(
        !indexes.some((index) => index.name === 'literature_record_fingerprint_identity') &&
          indexes.some(
            (index) =>
              index.name === 'literature_record_weak_fingerprint_identity' && index.unique === 1,
          ) &&
          indexes.some(
            (index) => index.name === 'literature_records_by_fingerprint' && index.unique === 0,
          ) &&
          indexes.some(
            (index) => index.name === 'literature_record_canonical_identity' && index.unique === 1,
          ) &&
          /canonical_id\s+is\s+not\s+null/iu.test(canonicalIndex.sql) &&
          /canonical_id\s+is\s+null/iu.test(weakFingerprintIndex.sql),
        'literature_fingerprint_identity_index_was_not_migrated',
      );
    } finally {
      inspected.close();
    }

    const reopened = new LocalDatabase();
    reopened.open();
    invariant(
      reopened.listLiteratureRecords(projectId).find((record) => record.id === inserted.id)
        ?.manualAnnotations.relevance === expandedValue,
      'migrated_literature_relevance_was_not_durable',
    );
    reopened.close();
  } finally {
    app.setPath('userData', primaryUserData);
  }
}

function verifyLegacyChatMigration(rootUserData: string, fixedTimestamp: string) {
  const primaryUserData = app.getPath('userData');
  const legacyUserData = join(rootUserData, 'legacy-chat-v030');
  mkdirSync(legacyUserData, { recursive: true });
  app.setPath('userData', legacyUserData);
  try {
    const bootstrap = new LocalDatabase();
    bootstrap.open();
    bootstrap.close();

    const keyHex = safeStorage
      .decryptString(readFileSync(join(legacyUserData, 'local-key.bin')))
      .trim();
    const legacyUserId = randomUUID();
    const legacyAssistantId = randomUUID();
    const legacyProjectId = randomUUID();
    const raw = new Database(join(legacyUserData, 'gosu.db'));
    try {
      raw.pragma(`key="x'${keyHex}'"`);
      raw.pragma('foreign_keys=OFF');
      raw.transaction(() => {
        raw
          .prepare('delete from local_schema_migrations where id=?')
          .run('project-chat-sessions-v1');
        raw.exec(`
          drop table project_chat_actions;
          drop table project_chat_attempts;
          drop table project_chat_messages;
          create table project_chat_messages (
            id text primary key,
            project_id text not null,
            role text not null check (role in ('user','assistant')),
            content text not null check (length(content) between 1 and 32000),
            status text not null check (status in ('complete','failed','interrupted')),
            turn_id text check (turn_id is null or length(turn_id) between 1 and 256),
            model_json text check (model_json is null or length(model_json) <= 4096),
            created_at text not null,
            completed_at text not null
          );
          create index project_chat_messages_by_project
            on project_chat_messages(project_id,created_at,id);
          create table project_chat_actions (
            id text primary key,
            message_id text not null references project_chat_messages(id) on delete cascade,
            project_id text not null,
            command_json text not null check (length(command_json) <= 4096),
            status text not null check (status in ('proposed','applying','applied','failed')),
            result_entity_id text,
            result_entity_version integer,
            error_code text,
            created_at text not null,
            updated_at text not null
          );
          create index project_chat_actions_by_message
            on project_chat_actions(message_id,created_at,id);
        `);
        const insertLegacyMessage = raw.prepare(
          `insert into project_chat_messages(
             id,project_id,role,content,status,turn_id,model_json,created_at,completed_at
           ) values(?,?,?,?,?,?,?,?,?)`,
        );
        insertLegacyMessage.run(
          legacyUserId,
          legacyProjectId,
          'user',
          'Legacy failed request',
          'complete',
          null,
          null,
          fixedTimestamp,
          fixedTimestamp,
        );
        insertLegacyMessage.run(
          legacyAssistantId,
          legacyProjectId,
          'assistant',
          'Legacy Codex failure',
          'failed',
          null,
          null,
          fixedTimestamp,
          fixedTimestamp,
        );
      })();
    } finally {
      raw.close();
    }

    const migrated = new LocalDatabase();
    migrated.open();
    const migratedSnapshot = migrated.snapshot(legacyProjectId);
    invariant(migratedSnapshot.messages.length === 2, 'legacy_chat_messages_were_not_preserved');
    invariant(
      migratedSnapshot.session?.isDefault === true && migratedSnapshot.sessions?.length === 1,
      'legacy_chat_default_session_was_not_created_once',
    );
    invariant(
      migrated.snapshot(legacyProjectId).session?.id === migratedSnapshot.session?.id,
      'legacy_chat_default_session_was_not_idempotent',
    );
    invariant(
      migratedSnapshot.messages.every((message) => message.attemptId === undefined),
      'legacy_chat_messages_received_false_attempt_lineage',
    );
    invariant(migratedSnapshot.attempts?.length === 0, 'legacy_chat_created_false_attempts');
    const durableAttemptId = randomUUID();
    const durableUserMessageId = randomUUID();
    migrated.beginChatAttempt(
      {
        id: durableAttemptId,
        projectId: legacyProjectId,
        userMessageId: durableUserMessageId,
        requestedModelId: null,
        reasoningOptionId: null,
        status: 'starting',
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      },
      {
        id: durableUserMessageId,
        projectId: legacyProjectId,
        role: 'user',
        content: 'First durable request after migration',
        status: 'complete',
        actions: [],
        createdAt: fixedTimestamp,
        completedAt: fixedTimestamp,
      },
    );
    migrated.close();

    const reopened = new LocalDatabase();
    reopened.open();
    invariant(
      reopened.snapshot(legacyProjectId).session?.id === migratedSnapshot.session?.id,
      'legacy_chat_default_session_changed_after_restart',
    );
    const reconciled = reopened.getChatAttempt(legacyProjectId, durableAttemptId);
    invariant(
      reconciled?.status === 'interrupted' &&
        reconciled.errorCode === 'application_interrupted' &&
        reconciled.collaborationModeId === undefined &&
        reconciled.personality === undefined &&
        reconciled.responseVerbosity === undefined,
      'migrated_chat_did_not_support_durable_attempt_reconciliation',
    );
    reopened.close();
  } finally {
    app.setPath('userData', primaryUserData);
  }
}

function verifyLegacySshMigration(rootUserData: string, fixedTimestamp: string) {
  const primaryUserData = app.getPath('userData');
  const legacyUserData = join(rootUserData, 'legacy-ssh-v010');
  mkdirSync(legacyUserData, { recursive: true });
  app.setPath('userData', legacyUserData);
  try {
    const bootstrap = new LocalDatabase();
    bootstrap.open();
    bootstrap.close();

    const keyHex = safeStorage
      .decryptString(readFileSync(join(legacyUserData, 'local-key.bin')))
      .trim();
    const legacyConnectionId = randomUUID();
    const raw = new Database(join(legacyUserData, 'gosu.db'));
    try {
      raw.pragma(`key="x'${keyHex}'"`);
      raw.pragma('foreign_keys=OFF');
      raw.transaction(() => {
        raw.exec(`
          drop table ssh_workspace_grants;
          drop table ssh_connections;
          create table ssh_connections (
            id text primary key check (length(id) = 36),
            schema_version integer not null check (schema_version = 1),
            label text not null check (length(label) between 1 and 120),
            host_alias text not null check (length(host_alias) between 1 and 255),
            version integer not null check (version > 0),
            created_at text not null,
            updated_at text not null
          );
          create index ssh_connections_by_label on ssh_connections(label,id);
        `);
        raw
          .prepare(
            `insert into ssh_connections(
               id,schema_version,label,host_alias,version,created_at,updated_at
             ) values(?,?,?,?,?,?,?)`,
          )
          .run(
            legacyConnectionId,
            1,
            'Legacy alias',
            'legacy-research-gpu',
            1,
            fixedTimestamp,
            fixedTimestamp,
          );
      })();
    } finally {
      raw.close();
    }

    const migrated = new LocalDatabase();
    migrated.open();
    const legacy = migrated
      .listSshConnections()
      .find((connection) => connection.id === legacyConnectionId);
    invariant(
      legacy?.hostAlias === 'legacy-research-gpu' && legacy.directTarget === null,
      'legacy_ssh_alias_migration_failed',
    );
    invariant(
      migrated.listSshWorkspaceGrants(randomUUID()).length === 0,
      'legacy_ssh_workspace_table_missing',
    );

    const directConnectionId = randomUUID();
    const projectId = randomUUID();
    const grantId = randomUUID();
    invariant(
      migrated.createSshConnection({
        schemaVersion: 1,
        id: directConnectionId,
        label: 'Imported SSH server',
        hostAlias: 'direct-203.0.113.20-2222',
        directTarget: {
          host: '203.0.113.20',
          user: 'researcher',
          port: 2222,
          localForwards: [],
        },
        version: 1,
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      }),
      'migrated_ssh_direct_profile_create_failed',
    );
    invariant(
      migrated.createSshWorkspaceGrant({
        schemaVersion: 1,
        id: grantId,
        projectId,
        connectionId: directConnectionId,
        canonicalRoot: '/workspace/research-project',
        permissionMode: 'diagnostics',
        version: 1,
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      }),
      'migrated_ssh_workspace_grant_create_failed',
    );
    invariant(
      migrated.updateSshWorkspaceGrant(
        {
          schemaVersion: 1,
          id: grantId,
          projectId,
          connectionId: directConnectionId,
          canonicalRoot: '/workspace/research-project',
          permissionMode: 'workspace',
          trustedAccess: {
            schemaVersion: 1,
            policyVersion: 1,
            projectId,
            grantId,
            grantVersion: 2,
            connectionId: directConnectionId,
            connectionVersion: 1,
            canonicalRoot: '/workspace/research-project',
            enabledAt: fixedTimestamp,
          },
          version: 2,
          createdAt: fixedTimestamp,
          updatedAt: fixedTimestamp,
        },
        1,
      ),
      'migrated_ssh_trusted_workspace_update_failed',
    );
    invariant(
      migrated.appendSshTrustedWorkspaceAudit({
        schemaVersion: 1,
        id: randomUUID(),
        projectId,
        grantId,
        grantVersion: 2,
        connectionId: directConnectionId,
        connectionVersion: 1,
        policyVersion: 1,
        sessionId: randomUUID(),
        attemptId: randomUUID(),
        turnId: 'migration-smoke-turn',
        toolCallId: 'migration-smoke-tool',
        operation: 'inspect',
        commandSha256: 'a'.repeat(64),
        autoApprovedAt: fixedTimestamp,
      }),
      'migrated_ssh_trusted_workspace_audit_failed',
    );
    migrated.close();

    const reopened = new LocalDatabase();
    reopened.open();
    invariant(
      reopened.listSshConnections().some((connection) => connection.id === legacyConnectionId) &&
        reopened.listSshConnections().some((connection) => connection.id === directConnectionId),
      'migrated_ssh_profiles_were_not_durable',
    );
    invariant(
      reopened.listSshWorkspaceGrants(projectId)[0]?.id === grantId &&
        reopened.listSshWorkspaceGrants(projectId)[0]?.trustedAccess?.policyVersion === 1,
      'migrated_ssh_workspace_grant_was_not_durable',
    );
    reopened.close();
  } finally {
    app.setPath('userData', primaryUserData);
  }
}

function verifyLegacyProfileMigration(rootUserData: string, fixedTimestamp: string) {
  const primaryUserData = app.getPath('userData');
  const legacyUserData = join(rootUserData, 'legacy-profile-v050');
  mkdirSync(legacyUserData, { recursive: true });
  app.setPath('userData', legacyUserData);
  try {
    const bootstrap = new LocalDatabase();
    bootstrap.open();
    bootstrap.close();

    const keyHex = safeStorage
      .decryptString(readFileSync(join(legacyUserData, 'local-key.bin')))
      .trim();
    const projectId = randomUUID();
    const revisionId = randomUUID();
    const contextProjectId = randomUUID();
    const contextRevisionId = randomUUID();
    const reviewerProjectId = randomUUID();
    const reviewerRevisionId = randomUUID();
    const raw = new Database(join(legacyUserData, 'gosu.db'));
    try {
      raw.pragma(`key="x'${keyHex}'"`);
      raw.pragma('foreign_keys=OFF');
      raw.transaction(() => {
        raw.exec(`
          drop table project_chat_profiles;
          create table project_chat_profiles (
            project_id text primary key,
            version integer not null check (version > 0),
            harness_mode text not null check (harness_mode in ('context','planner','reviewer')),
            response_depth text not null check (response_depth in ('concise','standard','deep')),
            context_scope text not null check (context_scope in ('project','board','objective')),
            local_notes_vault_id text,
            local_notes_vault_name text,
            instruction_revision_id text not null
              references project_chat_instruction_revisions(id),
            created_at text not null,
            updated_at text not null
          );
        `);
        raw
          .prepare(
            `insert into project_chat_instruction_revisions(
             id,project_id,revision,content,content_sha256,created_at
           ) values(?,?,?,?,?,?)`,
          )
          .run(
            revisionId,
            projectId,
            1,
            'Legacy profile instructions.',
            'd'.repeat(64),
            fixedTimestamp,
          );
        const insertLegacyRevision = raw.prepare(
          `insert into project_chat_instruction_revisions(
             id,project_id,revision,content,content_sha256,created_at
           ) values(?,?,?,?,?,?)`,
        );
        insertLegacyRevision.run(
          contextRevisionId,
          contextProjectId,
          1,
          '',
          'e'.repeat(64),
          fixedTimestamp,
        );
        insertLegacyRevision.run(
          reviewerRevisionId,
          reviewerProjectId,
          1,
          '',
          'f'.repeat(64),
          fixedTimestamp,
        );
        const insertLegacyProfile = raw.prepare(
          `insert into project_chat_profiles(
             project_id,version,harness_mode,response_depth,context_scope,
             local_notes_vault_id,local_notes_vault_name,
             instruction_revision_id,created_at,updated_at
           ) values(?,?,?,?,?,?,?,?,?,?)`,
        );
        insertLegacyProfile.run(
          projectId,
          1,
          'planner',
          'deep',
          'board',
          null,
          null,
          revisionId,
          fixedTimestamp,
          fixedTimestamp,
        );
        insertLegacyProfile.run(
          contextProjectId,
          1,
          'context',
          'standard',
          'project',
          'e'.repeat(64),
          'Legacy Read Vault',
          contextRevisionId,
          fixedTimestamp,
          fixedTimestamp,
        );
        insertLegacyProfile.run(
          reviewerProjectId,
          1,
          'reviewer',
          'concise',
          'objective',
          null,
          null,
          reviewerRevisionId,
          fixedTimestamp,
          fixedTimestamp,
        );
      })();
    } finally {
      raw.close();
    }

    const migrated = new LocalDatabase();
    migrated.open();
    const legacyProfile = migrated.getProjectChatProfile(projectId);
    invariant(
      legacyProfile.version === 1 &&
        legacyProfile.collaborationModeId === 'plan' &&
        legacyProfile.personality === 'auto' &&
        legacyProfile.responseVerbosity === 'high' &&
        legacyProfile.webSearchMode === 'cached' &&
        legacyProfile.localNotesVault === null &&
        legacyProfile.customInstructions === 'Legacy profile instructions.' &&
        legacyProfile.policyRules.length === 0,
      'legacy_profile_v050_migration_failed',
    );
    invariant(
      migrated.getProjectChatProfile(contextProjectId).collaborationModeId === 'default' &&
        migrated.getProjectChatProfile(contextProjectId).responseVerbosity === 'medium' &&
        migrated.getProjectChatProfile(contextProjectId).localNotesVault
          ?.allowAgentMarkdownCreate === false &&
        migrated.getProjectChatProfile(reviewerProjectId).collaborationModeId === 'default' &&
        migrated.getProjectChatProfile(reviewerProjectId).responseVerbosity === 'low',
      'legacy_profile_v050_native_mode_mapping_failed',
    );
    const updated = migrated.updateProjectChatProfile({
      projectId,
      expectedVersion: 1,
      harnessMode: 'planner',
      responseDepth: 'deep',
      collaborationModeId: 'research-orchestrator-v2',
      personality: 'friendly',
      responseVerbosity: 'low',
      webSearchMode: 'live',
      contextScope: 'board',
      localNotesVault: {
        id: 'f'.repeat(64),
        name: 'Migrated Vault',
        allowAgentMarkdownCreate: true,
      },
      customInstructions: 'Legacy profile instructions.',
      policyRules: ['Preserve the migrated project rule.'],
    });
    invariant(
      updated?.version === 2 &&
        updated.collaborationModeId === 'research-orchestrator-v2' &&
        updated.personality === 'friendly' &&
        updated.responseVerbosity === 'low' &&
        updated.webSearchMode === 'live' &&
        updated.localNotesVault?.id === 'f'.repeat(64) &&
        updated.localNotesVault.allowAgentMarkdownCreate === true &&
        updated.policyRules[0] === 'Preserve the migrated project rule.',
      'legacy_profile_v050_grant_update_failed',
    );
    migrated.close();
  } finally {
    app.setPath('userData', primaryUserData);
  }
}

function verifyModelUsagePersistence(fixedTimestamp: string) {
  const keyHex = safeStorage
    .decryptString(readFileSync(join(app.getPath('userData'), 'local-key.bin')))
    .trim();
  const before = new Database(join(app.getPath('userData'), 'gosu.db'));
  before.pragma(`key="x'${keyHex}'"`);
  const outboxCountBefore = (
    before.prepare('select count(*) count from sync_outbox').get() as { count: number }
  ).count;
  before.close();
  const database = new LocalDatabase();
  database.open();
  let rejectedInvocationId: string;
  const projectId = randomUUID();
  const invocation: ModelInvocation = {
    schemaVersion: 1,
    invocationId: randomUUID(),
    providerId: 'codex',
    requestedModelId: null,
    resolvedModelId: 'usage-fixture-model',
    catalogVersion: 'usage-fixture-catalog',
    reasoningOptionId: 'high',
    startedAt: fixedTimestamp,
  };
  try {
    database.recordAttributedModelInvocation(
      'usage-fixture-thread',
      'usage-fixture-turn',
      invocation,
      { workloadKind: 'literature_organize', projectId },
      {
        connectionKey: 'codex:chatgpt',
        connectionLabel: 'ChatGPT',
        upstreamProviderId: null,
      },
      fixedTimestamp,
    );
    invariant(
      database.recordCodexModelUsageTotal({
        providerId: 'codex',
        threadId: 'usage-fixture-thread',
        turnId: 'usage-fixture-turn',
        totals: {
          inputTokens: 100,
          outputTokens: 40,
          totalTokens: 140,
          cachedReadTokens: 20,
          cachedWriteTokens: 5,
          reasoningOutputTokens: 10,
        },
        observedAt: fixedTimestamp,
      }) === 'recorded',
      'model_usage_cumulative_total_was_not_recorded',
    );
    invariant(
      database.listStoredModelUsage(
        new Date(Date.parse(fixedTimestamp) - 1).toISOString(),
        new Date(Date.parse(fixedTimestamp) + 1).toISOString(),
      ).length === 0,
      'active_model_usage_was_exposed_before_terminal_status',
    );
    invariant(
      database.recordCodexModelUsageTotal({
        providerId: 'codex',
        threadId: 'usage-fixture-thread',
        turnId: 'usage-fixture-turn',
        totals: {
          inputTokens: 100,
          outputTokens: 40,
          totalTokens: 140,
          cachedReadTokens: 20,
          cachedWriteTokens: 5,
          reasoningOutputTokens: 10,
        },
        observedAt: fixedTimestamp,
      }) === 'ignored',
      'duplicate_model_usage_total_was_counted',
    );
    invariant(
      database.recordCodexModelUsageTotal({
        providerId: 'codex',
        threadId: 'usage-fixture-thread',
        turnId: 'usage-fixture-turn',
        totals: {
          inputTokens: 99,
          outputTokens: 40,
          totalTokens: 139,
          cachedReadTokens: 20,
          cachedWriteTokens: 5,
          reasoningOutputTokens: 10,
        },
        observedAt: fixedTimestamp,
      }) === 'regressed',
      'regressed_model_usage_total_was_counted',
    );
    invariant(
      database.listStoredModelUsage(
        new Date(Date.parse(fixedTimestamp) - 1).toISOString(),
        new Date(Date.parse(fixedTimestamp) + 1).toISOString(),
      ).length === 0,
      'regressed_active_model_usage_was_exposed_before_terminal_status',
    );
    database.finishModelUsageTurn({
      providerId: 'codex',
      threadId: 'usage-fixture-thread',
      turnId: 'usage-fixture-turn',
      terminalStatus: 'completed',
      successful: true,
      completedAt: fixedTimestamp,
    });
    invariant(
      database.recordCodexModelUsageTotal({
        providerId: 'codex',
        threadId: 'usage-fixture-thread',
        turnId: 'usage-fixture-turn',
        totals: {
          inputTokens: 150,
          outputTokens: 45,
          totalTokens: 195,
          cachedReadTokens: 25,
          cachedWriteTokens: 6,
          reasoningOutputTokens: 11,
        },
        observedAt: fixedTimestamp,
      }) === 'recorded',
      'late_model_usage_update_was_not_recorded',
    );
    const rows = database.listStoredModelUsage(
      new Date(Date.parse(fixedTimestamp) - 1).toISOString(),
      new Date(Date.parse(fixedTimestamp) + 1).toISOString(),
    );
    invariant(
      rows.length === 1 &&
        rows[0]?.coverage === 'partial' &&
        rows[0].totalTokens === 195 &&
        rows[0].cachedReadTokens === 25 &&
        rows[0].projectId === projectId,
      'regressed_model_usage_was_incorrectly_restored_to_exact',
    );
    const invalidInvocation = { ...invocation, invocationId: randomUUID() };
    rejectedInvocationId = invalidInvocation.invocationId;
    let attributionRejected = false;
    try {
      database.recordAttributedModelInvocation(
        'usage-invalid-thread',
        'usage-invalid-turn',
        invalidInvocation,
        { workloadKind: 'lecture_generation', projectId },
        {
          connectionKey: 'codex:chatgpt',
          connectionLabel: 'ChatGPT',
          upstreamProviderId: null,
        },
      );
    } catch {
      attributionRejected = true;
    }
    invariant(attributionRejected, 'invalid_model_usage_attribution_was_accepted');
    invariant(
      !database
        .listStoredModelUsage(
          new Date(Date.parse(fixedTimestamp) - 1).toISOString(),
          new Date(Date.parse(fixedTimestamp) + 1).toISOString(),
        )
        .some((row) => row.invocationId === invalidInvocation.invocationId),
      'failed_model_usage_attribution_left_a_partial_invocation',
    );
  } finally {
    database.close();
  }

  const reopened = new LocalDatabase();
  reopened.open();
  try {
    const secondInvocation: ModelInvocation = {
      ...invocation,
      invocationId: randomUUID(),
      startedAt: new Date(Date.parse(fixedTimestamp) + 1).toISOString(),
    };
    reopened.recordAttributedModelInvocation(
      'usage-fixture-thread',
      'usage-fixture-turn-2',
      secondInvocation,
      { workloadKind: 'experiment_evaluation', projectId },
      {
        connectionKey: 'codex:chatgpt',
        connectionLabel: 'ChatGPT',
        upstreamProviderId: null,
      },
    );
    invariant(
      reopened.recordCodexModelUsageTotal({
        providerId: 'codex',
        threadId: 'usage-fixture-thread',
        turnId: 'usage-fixture-turn-2',
        totals: {
          inputTokens: 210,
          outputTokens: 65,
          totalTokens: 275,
          cachedReadTokens: 35,
          cachedWriteTokens: 8,
          reasoningOutputTokens: 16,
        },
        observedAt: secondInvocation.startedAt,
      }) === 'recorded',
      'model_usage_restart_cursor_was_not_resumed',
    );
    reopened.finishModelUsageTurn({
      providerId: 'codex',
      threadId: 'usage-fixture-thread',
      turnId: 'usage-fixture-turn-2',
      terminalStatus: 'interrupted',
      successful: false,
      completedAt: secondInvocation.startedAt,
    });
    const unavailableInvocation: ModelInvocation = {
      ...invocation,
      invocationId: randomUUID(),
      startedAt: new Date(Date.parse(fixedTimestamp) + 2).toISOString(),
    };
    reopened.recordAttributedModelInvocation(
      'usage-unavailable-thread',
      'usage-unavailable-turn',
      unavailableInvocation,
      { workloadKind: 'literature_organize', projectId },
      {
        connectionKey: 'codex:chatgpt',
        connectionLabel: 'ChatGPT',
        upstreamProviderId: null,
      },
    );
    reopened.finishModelUsageTurn({
      providerId: 'codex',
      threadId: 'usage-unavailable-thread',
      turnId: 'usage-unavailable-turn',
      terminalStatus: 'failed',
      successful: false,
      completedAt: unavailableInvocation.startedAt,
    });
    const zeroInvocation: ModelInvocation = {
      ...invocation,
      invocationId: randomUUID(),
      startedAt: new Date(Date.parse(fixedTimestamp) + 3).toISOString(),
    };
    reopened.recordAttributedModelInvocation(
      'usage-zero-thread',
      'usage-zero-turn',
      zeroInvocation,
      { workloadKind: 'literature_organize', projectId },
      {
        connectionKey: 'codex:chatgpt',
        connectionLabel: 'ChatGPT',
        upstreamProviderId: null,
      },
    );
    invariant(
      reopened.recordCodexModelUsageTotal({
        providerId: 'codex',
        threadId: 'usage-zero-thread',
        turnId: 'usage-zero-turn',
        totals: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          reasoningOutputTokens: 0,
        },
        observedAt: zeroInvocation.startedAt,
      }) === 'recorded',
      'explicit_zero_model_usage_was_not_recorded',
    );
    invariant(
      reopened.recordCodexModelUsageTotal({
        providerId: 'codex',
        threadId: 'usage-zero-thread',
        turnId: 'usage-zero-turn',
        totals: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          reasoningOutputTokens: 0,
        },
        observedAt: zeroInvocation.startedAt,
      }) === 'ignored',
      'duplicate_zero_model_usage_was_counted',
    );
    reopened.finishModelUsageTurn({
      providerId: 'codex',
      threadId: 'usage-zero-thread',
      turnId: 'usage-zero-turn',
      terminalStatus: 'completed',
      successful: true,
      completedAt: zeroInvocation.startedAt,
    });
    const restartedRows = reopened.listStoredModelUsage(
      new Date(Date.parse(fixedTimestamp) - 1).toISOString(),
      new Date(Date.parse(fixedTimestamp) + 4).toISOString(),
    );
    const resumed = restartedRows.find((row) => row.invocationId === secondInvocation.invocationId);
    invariant(
      resumed?.coverage === 'partial' &&
        resumed.inputTokens === 60 &&
        resumed.outputTokens === 20 &&
        resumed.totalTokens === 80 &&
        resumed.cachedReadTokens === 10 &&
        resumed.cachedWriteTokens === 2 &&
        resumed.reasoningOutputTokens === 5,
      'model_usage_restart_delta_was_not_exact',
    );
    invariant(
      restartedRows.find((row) => row.invocationId === unavailableInvocation.invocationId)
        ?.coverage === 'unavailable',
      'model_usage_missing_terminal_report_was_not_unavailable',
    );
    const explicitZero = restartedRows.find(
      (row) => row.invocationId === zeroInvocation.invocationId,
    );
    invariant(
      explicitZero?.coverage === 'exact' &&
        explicitZero.inputTokens === 0 &&
        explicitZero.outputTokens === 0 &&
        explicitZero.totalTokens === 0,
      'explicit_zero_model_usage_was_treated_as_unreported',
    );
  } finally {
    reopened.close();
  }

  const inspected = new Database(join(app.getPath('userData'), 'gosu.db'));
  inspected.pragma(`key="x'${keyHex}'"`);
  try {
    const indexes = inspected.pragma('index_list(model_invocations)') as Array<{ name: string }>;
    invariant(
      indexes.some((index) => index.name === 'model_invocations_usage_range'),
      'model_usage_range_index_missing',
    );
    const rejectedInvocation = inspected
      .prepare('select invocation_id from model_invocations where invocation_id=?')
      .get(rejectedInvocationId);
    invariant(
      rejectedInvocation === undefined,
      'failed_model_usage_attribution_left_a_partial_invocation',
    );
    const outboxCountAfter = (
      inspected.prepare('select count(*) count from sync_outbox').get() as { count: number }
    ).count;
    invariant(outboxCountAfter === outboxCountBefore, 'local_model_usage_was_added_to_sync_outbox');
  } finally {
    inspected.close();
  }
}

const temporaryUserData = mkdtempSync(join(tmpdir(), 'gosu-local-db-smoke-'));
app.setPath('userData', temporaryUserData);

void app.whenReady().then(async () => {
  const operationId = randomUUID();
  const secondOperationId = randomUUID();
  const fixedTimestamp = new Date().toISOString();
  try {
    const first = fixture(1, operationId, fixedTimestamp);
    const second = fixture(2, secondOperationId, fixedTimestamp);
    const database = new LocalDatabase();
    database.open();
    database.commitWorkspaceState(first.state, first.operation);
    database.commitWorkspaceState(second.state, second.operation);
    const chatMessageId = randomUUID();
    const chatActionId = randomUUID();
    const chatProjectId = second.state.projects[0]!.id;
    invariant(
      database.getProjectChatProfile(chatProjectId).version === 0 &&
        database.getProjectChatProfile(chatProjectId).collaborationModeId === null &&
        database.getProjectChatProfile(chatProjectId).responseVerbosity === 'auto' &&
        database.getProjectChatProfile(chatProjectId).webSearchMode === 'cached' &&
        database.getProjectChatProfile(chatProjectId).policyRules.length === 0,
      'default_chat_profile_missing',
    );
    const chatProfile = database.updateProjectChatProfile({
      projectId: chatProjectId,
      expectedVersion: 0,
      harnessMode: 'planner',
      responseDepth: 'deep',
      collaborationModeId: 'research-orchestrator-v2',
      personality: 'pragmatic',
      responseVerbosity: 'high',
      webSearchMode: 'live',
      contextScope: 'board',
      localNotesVault: {
        id: 'a'.repeat(64),
        name: 'Fixture Vault',
        allowAgentMarkdownCreate: true,
      },
      customInstructions: 'Prefer reproducible experiments.',
      policyRules: ['Separate measured results from estimates.', 'State uncertainty explicitly.'],
    });
    invariant(chatProfile?.version === 1, 'chat_profile_initial_update_failed');
    invariant(
      chatProfile.collaborationModeId === 'research-orchestrator-v2' &&
        chatProfile.personality === 'pragmatic' &&
        chatProfile.responseVerbosity === 'high' &&
        chatProfile.webSearchMode === 'live' &&
        chatProfile.policyRules.length === 2 &&
        chatProfile.policyRules[0] === 'Separate measured results from estimates.',
      'chat_profile_native_settings_missing',
    );
    invariant(
      chatProfile.localNotesVault?.id === 'a'.repeat(64) &&
        chatProfile.localNotesVault.name === 'Fixture Vault' &&
        chatProfile.localNotesVault.allowAgentMarkdownCreate === true,
      'chat_profile_local_notes_grant_missing',
    );
    invariant(
      database.updateProjectChatProfile({
        projectId: chatProjectId,
        expectedVersion: 0,
        harnessMode: 'reviewer',
        responseDepth: 'concise',
        contextScope: 'objective',
        localNotesVault: null,
        customInstructions: '',
      }) === null,
      'stale_chat_profile_update_was_accepted',
    );
    const chatMessage: ProjectChatMessage = {
      id: chatMessageId,
      projectId: chatProjectId,
      role: 'assistant',
      content: 'Create the reproduction task after review.',
      status: 'complete',
      actions: [
        {
          id: chatActionId,
          projectId: chatProjectId,
          messageId: chatMessageId,
          command: { type: 'task.create', title: 'Reproduce baseline', status: 'planned' },
          status: 'proposed',
          createdAt: fixedTimestamp,
          updatedAt: fixedTimestamp,
        },
      ],
      createdAt: fixedTimestamp,
      completedAt: fixedTimestamp,
    };
    database.saveMessage(chatMessage);
    const defaultChatSession = database.ensureDefaultProjectChatSession(chatProjectId);
    invariant(
      database.ensureDefaultProjectChatSession(chatProjectId).id === defaultChatSession.id &&
        database.listProjectChatSessions(chatProjectId).filter((session) => session.isDefault)
          .length === 1,
      'default_chat_session_was_not_idempotent',
    );
    invariant(
      database.renameProjectChatSession(
        chatProjectId,
        defaultChatSession.id,
        'Primary research chat',
      )?.isDefault === true,
      'default_chat_session_marker_changed_during_rename',
    );
    const independentChatSession = database.createProjectChatSession(chatProjectId);
    invariant(
      database.snapshot(chatProjectId, independentChatSession.id).messages.length === 0,
      'new_root_chat_inherited_default_history',
    );
    const queuedTurnId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const queuedTurn = database.enqueueProjectChatTurn({
      id: queuedTurnId,
      projectId: chatProjectId,
      sessionId: independentChatSession.id,
      message: 'Original durable queued turn',
      requestedModelId: null,
      reasoningOptionId: null,
      priority: 'normal',
      status: 'queued',
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    });
    const laterQueuedTurnId = '00000000-0000-4000-8000-000000000001';
    const laterQueuedTurn = database.enqueueProjectChatTurn({
      id: laterQueuedTurnId,
      projectId: chatProjectId,
      sessionId: independentChatSession.id,
      message: 'Later same-timestamp durable queued turn',
      requestedModelId: null,
      reasoningOptionId: null,
      priority: 'normal',
      status: 'queued',
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    });
    invariant(
      queuedTurn.enqueueSequence !== undefined &&
        laterQueuedTurn.enqueueSequence !== undefined &&
        queuedTurn.enqueueSequence < laterQueuedTurn.enqueueSequence,
      'project_chat_queue_sequence_not_monotonic',
    );
    invariant(
      database.updateProjectChatQueuedTurn(
        chatProjectId,
        independentChatSession.id,
        queuedTurnId,
        'Edited durable queued turn',
        fixedTimestamp,
      )?.message === 'Edited durable queued turn',
      'project_chat_queue_edit_failed',
    );
    invariant(
      database.prioritizeProjectChatQueuedTurn(
        chatProjectId,
        independentChatSession.id,
        queuedTurnId,
        fixedTimestamp,
      ) === 'queued' &&
        database.claimNextProjectChatQueuedTurn(chatProjectId, independentChatSession.id)?.id ===
          queuedTurnId,
      'project_chat_queue_claim_failed',
    );
    invariant(
      database.prioritizeProjectChatQueuedTurn(
        chatProjectId,
        independentChatSession.id,
        queuedTurnId,
        fixedTimestamp,
      ) === 'starting',
      'project_chat_queue_starting_run_now_was_not_accepted',
    );
    const queueFailureProjectId = randomUUID();
    const queueFailureSession = database.ensureDefaultProjectChatSession(queueFailureProjectId);
    const failedQueueId = randomUUID();
    database.enqueueProjectChatTurn({
      id: failedQueueId,
      projectId: queueFailureProjectId,
      sessionId: queueFailureSession.id,
      message: 'Queued input with an expired opaque attachment ID',
      requestedModelId: null,
      reasoningOptionId: null,
      attachmentIds: [randomUUID()],
      priority: 'normal',
      status: 'queued',
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    });
    const laterHealthyQueueId = randomUUID();
    database.enqueueProjectChatTurn({
      id: laterHealthyQueueId,
      projectId: queueFailureProjectId,
      sessionId: queueFailureSession.id,
      message: 'Later healthy queued input',
      requestedModelId: null,
      reasoningOptionId: null,
      priority: 'normal',
      status: 'queued',
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    });
    invariant(
      database.claimNextProjectChatQueuedTurn(queueFailureProjectId, queueFailureSession.id)?.id ===
        failedQueueId,
      'project_chat_failed_queue_claim_order_changed',
    );
    const queueFailureAttemptId = randomUUID();
    const queueFailureUserMessageId = randomUUID();
    const queueFailureCompletedAt = new Date(Date.parse(fixedTimestamp) + 500).toISOString();
    const queueFailureAttempt: ProjectChatAttempt = {
      id: queueFailureAttemptId,
      projectId: queueFailureProjectId,
      sessionId: queueFailureSession.id,
      userMessageId: queueFailureUserMessageId,
      requestedModelId: null,
      reasoningOptionId: null,
      status: 'failed',
      createdAt: fixedTimestamp,
      updatedAt: queueFailureCompletedAt,
    };
    const queueFailureUserMessage: ProjectChatMessage = {
      id: queueFailureUserMessageId,
      projectId: queueFailureProjectId,
      role: 'user',
      content: 'Queued input with an expired opaque attachment ID',
      status: 'complete',
      attemptId: queueFailureAttemptId,
      actions: [],
      createdAt: fixedTimestamp,
      completedAt: queueFailureCompletedAt,
    };
    const queueFailureAssistantMessage: ProjectChatMessage = {
      id: randomUUID(),
      projectId: queueFailureProjectId,
      role: 'assistant',
      content: 'The queued attachment expired. Attach it again and resend.',
      status: 'failed',
      attemptId: queueFailureAttemptId,
      actions: [],
      createdAt: queueFailureCompletedAt,
      completedAt: queueFailureCompletedAt,
    };
    invariant(
      database.failProjectChatQueuedTurn(
        failedQueueId,
        queueFailureAttempt,
        queueFailureUserMessage,
        queueFailureAssistantMessage,
      ) &&
        database.snapshot(queueFailureProjectId).messages.length === 2 &&
        database.claimNextProjectChatQueuedTurn(queueFailureProjectId, queueFailureSession.id)
          ?.id === laterHealthyQueueId,
      'project_chat_failed_queue_did_not_release_later_work',
    );

    const interruptedChatSession = database.createProjectChatSession(
      chatProjectId,
      'Interrupted restart fixture',
    );
    const interruptedAttemptId = randomUUID();
    const interruptedUserMessageId = randomUUID();
    const interruptedAttempt: ProjectChatAttempt = {
      id: interruptedAttemptId,
      projectId: chatProjectId,
      sessionId: interruptedChatSession.id,
      userMessageId: interruptedUserMessageId,
      requestedModelId: null,
      reasoningOptionId: null,
      status: 'starting',
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    };
    database.beginChatAttempt(interruptedAttempt, {
      id: interruptedUserMessageId,
      projectId: chatProjectId,
      role: 'user',
      content: 'Leave this turn running across a restart.',
      status: 'complete',
      actions: [],
      createdAt: fixedTimestamp,
      completedAt: fixedTimestamp,
    });
    const interruptedRunning: ProjectChatAttempt = {
      ...interruptedAttempt,
      threadId: 'thread-interrupted-fixture',
      turnId: 'turn-interrupted-fixture',
      model: {
        invocationId: randomUUID(),
        requestedModelId: null,
        resolvedModelId: 'fixture-model',
        catalogVersion: 'fixture-catalog',
        reasoningOptionId: null,
      },
      status: 'running',
    };
    const interruptedAgentRunId = randomUUID();
    database.beginProjectAgentRun({
      schemaVersion: 1,
      id: interruptedAgentRunId,
      projectId: chatProjectId,
      sessionId: interruptedChatSession.id,
      attemptId: interruptedAttemptId,
      status: 'starting',
      goal: 'Leave this turn running across a restart.',
      contextPlan: {
        schemaVersion: 1,
        strategy: 'recent-history-plus-working-memory',
        includedSegments: ['project-identity'],
        candidateMessageCount: 0,
        recentMessageCount: 0,
        omittedMessageCount: 0,
        recentHistoryCharacters: 0,
        workingMemoryRevision: null,
        memoryEntryCount: 0,
        memoryCharacters: 0,
        estimatedInputCharactersSaved: 0,
      },
      nodes: [
        {
          id: randomUUID(),
          runId: interruptedAgentRunId,
          kind: 'coordinator',
          providerId: 'provider-pending',
          status: 'starting',
          task: 'Leave this turn running across a restart.',
          invocationId: null,
          resultSummary: null,
          createdAt: fixedTimestamp,
          updatedAt: fixedTimestamp,
          completedAt: null,
        },
      ],
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
      completedAt: null,
    });
    database.markChatAttemptRunning(interruptedRunning);
    database.markProjectAgentRunRunning({
      attemptId: interruptedAttemptId,
      providerId: 'codex',
      invocationId: interruptedRunning.model!.invocationId,
      updatedAt: fixedTimestamp,
    });
    const hermesAuditSession = database.createProjectChatSession(
      chatProjectId,
      'Hermes audit purge fixture',
    );
    const hermesAuditAttemptId = randomUUID();
    const hermesAuditUserMessageId = randomUUID();
    const hermesAuditInvocationId = randomUUID();
    const hermesAuditAttempt: ProjectChatAttempt = {
      id: hermesAuditAttemptId,
      projectId: chatProjectId,
      sessionId: hermesAuditSession.id,
      userMessageId: hermesAuditUserMessageId,
      requestedModelId: null,
      reasoningOptionId: null,
      status: 'starting',
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    };
    database.beginChatAttempt(hermesAuditAttempt, {
      id: hermesAuditUserMessageId,
      projectId: chatProjectId,
      role: 'user',
      content: 'RAW_HERMES_TASK_MUST_NOT_ENTER_AUDIT_RECEIPT',
      status: 'complete',
      actions: [],
      createdAt: fixedTimestamp,
      completedAt: fixedTimestamp,
    });
    const hermesAgentRunId = randomUUID();
    database.beginProjectAgentRun({
      schemaVersion: 1,
      id: hermesAgentRunId,
      projectId: chatProjectId,
      sessionId: hermesAuditSession.id,
      attemptId: hermesAuditAttemptId,
      status: 'starting',
      goal: 'Delegate one bounded review.',
      contextPlan: {
        schemaVersion: 1,
        strategy: 'recent-history-plus-working-memory',
        includedSegments: ['project-identity'],
        candidateMessageCount: 0,
        recentMessageCount: 0,
        omittedMessageCount: 0,
        recentHistoryCharacters: 0,
        workingMemoryRevision: null,
        memoryEntryCount: 0,
        memoryCharacters: 0,
        estimatedInputCharactersSaved: 0,
      },
      nodes: [
        {
          id: randomUUID(),
          runId: hermesAgentRunId,
          kind: 'coordinator',
          providerId: 'provider-pending',
          status: 'starting',
          task: 'Delegate one bounded review.',
          invocationId: null,
          resultSummary: null,
          createdAt: fixedTimestamp,
          updatedAt: fixedTimestamp,
          completedAt: null,
        },
      ],
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
      completedAt: null,
    });
    const hermesCoordinatorInvocationId = randomUUID();
    database.markChatAttemptRunning({
      ...hermesAuditAttempt,
      threadId: 'thread-hermes-audit-fixture',
      turnId: 'turn-hermes-audit-fixture',
      model: {
        invocationId: hermesCoordinatorInvocationId,
        providerId: 'codex',
        requestedModelId: null,
        resolvedModelId: 'fixture-model',
        catalogVersion: 'fixture-catalog',
        reasoningOptionId: null,
      },
      status: 'running',
    });
    database.markProjectAgentRunRunning({
      attemptId: hermesAuditAttemptId,
      providerId: 'codex',
      invocationId: hermesCoordinatorInvocationId,
      updatedAt: fixedTimestamp,
    });
    const hermesAuditReceipt = {
      schemaVersion: 1 as const,
      projectId: chatProjectId,
      sessionId: hermesAuditSession.id,
      attemptId: hermesAuditAttemptId,
      invocationId: hermesAuditInvocationId,
      providerId: 'hermes' as const,
      transport: 'acp-v1' as const,
      resolvedModelId: 'hermes-configured-model',
      configuredProviderId: 'nous',
      catalogVersion: 'c'.repeat(64),
      agentName: 'Hermes Agent',
      agentVersion: '0.19.1',
      stopReason: 'end_turn',
      startedAt: fixedTimestamp,
      recordedAt: fixedTimestamp,
    };
    database.recordHermesDelegationReceipt(hermesAuditReceipt);
    database.recordHermesDelegationReceipt(hermesAuditReceipt);
    invariant(
      database.listHermesDelegationReceipts(
        chatProjectId,
        hermesAuditSession.id,
        hermesAuditAttemptId,
      ).length === 1,
      'hermes_delegation_receipt_exact_retry_was_not_idempotent',
    );
    invariant(
      database
        .snapshot(chatProjectId, hermesAuditSession.id)
        .agentRuns?.find((run) => run.id === hermesAgentRunId)
        ?.nodes.some(
          (node) =>
            node.kind === 'delegated-worker' &&
            node.providerId === 'hermes' &&
            node.invocationId === hermesAuditInvocationId,
        ),
      'hermes_delegation_was_not_recorded_as_agent_child_node',
    );
    let hermesAuditConflictRejected = false;
    try {
      database.recordHermesDelegationReceipt({
        ...hermesAuditReceipt,
        stopReason: 'conflicting_retry',
      });
    } catch {
      hermesAuditConflictRejected = true;
    }
    invariant(
      hermesAuditConflictRejected,
      'hermes_delegation_receipt_conflicting_retry_was_accepted',
    );
    const duplicateActiveAttemptId = randomUUID();
    const duplicateActiveUserMessageId = randomUUID();
    let duplicateActiveSessionAttemptRejected = false;
    try {
      database.beginChatAttempt(
        {
          ...interruptedAttempt,
          id: duplicateActiveAttemptId,
          userMessageId: duplicateActiveUserMessageId,
        },
        {
          id: duplicateActiveUserMessageId,
          projectId: chatProjectId,
          role: 'user',
          content: 'This same-session active turn must be rejected.',
          status: 'complete',
          actions: [],
          createdAt: fixedTimestamp,
          completedAt: fixedTimestamp,
        },
      );
    } catch {
      duplicateActiveSessionAttemptRejected = true;
    }
    invariant(
      duplicateActiveSessionAttemptRejected &&
        !database
          .snapshot(chatProjectId, interruptedChatSession.id)
          .messages.some((message) => message.id === duplicateActiveUserMessageId),
      'project_chat_same_session_active_attempt_was_not_atomic',
    );
    const interruptedResearchNoteArtifactId = '1'.repeat(16);
    const interruptedResearchNotePath = `Project Progress/Recovered progress--${interruptedResearchNoteArtifactId}.md`;
    const interruptedResearchNoteSha256 = '2'.repeat(64);
    database.stageResearchNoteSave({
      schemaVersion: 1,
      projectId: chatProjectId,
      sessionId: interruptedChatSession.id,
      attemptId: interruptedAttemptId,
      bindingId: 'a'.repeat(64),
      category: 'project-progress',
      artifactId: interruptedResearchNoteArtifactId,
      expectedContentSha256: interruptedResearchNoteSha256,
      stagedAt: fixedTimestamp,
    });
    database.confirmResearchNoteSave({
      projectId: chatProjectId,
      sessionId: interruptedChatSession.id,
      attemptId: interruptedAttemptId,
      artifactId: interruptedResearchNoteArtifactId,
      category: 'project-progress',
      relativePath: interruptedResearchNotePath,
      contentSha256: interruptedResearchNoteSha256,
      confirmedAt: fixedTimestamp,
    });

    const completedAttemptId = randomUUID();
    const completedUserMessageId = randomUUID();
    const completedAttempt: ProjectChatAttempt = {
      id: completedAttemptId,
      projectId: chatProjectId,
      sessionId: defaultChatSession.id,
      userMessageId: completedUserMessageId,
      requestedModelId: 'fixture-model',
      reasoningOptionId: 'high',
      harnessMode: 'planner',
      responseDepth: 'deep',
      collaborationModeId: 'research-orchestrator-v2',
      personality: 'pragmatic',
      responseVerbosity: 'high',
      webSearchMode: 'live',
      contextScope: 'board',
      profileVersion: chatProfile.version,
      instructionRevisionId: chatProfile.instructionRevision?.id ?? null,
      promptProvenance: {
        schemaVersion: 1,
        assemblyVersion: 1,
        baseInstructionId: 'gosu.project-chat.base',
        baseInstructionVersion: 1,
        baseInstructionsSha256: 'a'.repeat(64),
        harnessInstructionId: 'gosu.project-chat.harness.planner',
        harnessInstructionVersion: 1,
        harnessInstructionsSha256: 'b'.repeat(64),
        customInstructionsSha256: 'c'.repeat(64),
        developerInstructionsSha256: 'd'.repeat(64),
        promptSha256: 'e'.repeat(64),
        projectContextSha256: 'f'.repeat(64),
        visibleHistorySha256: '0'.repeat(64),
        userMessageSha256: '1'.repeat(64),
        profileVersion: chatProfile.version,
        instructionRevisionId: chatProfile.instructionRevision?.id ?? null,
        workspaceRevision: second.state.revision,
        developerInstructionsCharacters: 700,
        promptCharacters: 1_200,
        contextTruncated: false,
        historyTruncated: false,
      },
      status: 'starting',
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    };
    database.beginChatAttempt(completedAttempt, {
      id: completedUserMessageId,
      projectId: chatProjectId,
      role: 'user',
      content: 'Complete this durable attempt.',
      status: 'complete',
      actions: [],
      createdAt: fixedTimestamp,
      completedAt: fixedTimestamp,
    });
    const completedAgentRunId = randomUUID();
    const completedAgentNodeId = randomUUID();
    database.beginProjectAgentRun({
      schemaVersion: 1,
      id: completedAgentRunId,
      projectId: chatProjectId,
      sessionId: defaultChatSession.id,
      attemptId: completedAttemptId,
      status: 'starting',
      goal: 'Complete this durable attempt.',
      contextPlan: {
        schemaVersion: 1,
        strategy: 'recent-history-plus-working-memory',
        includedSegments: ['project-identity', 'recent-history'],
        candidateMessageCount: 2,
        recentMessageCount: 2,
        omittedMessageCount: 0,
        recentHistoryCharacters: 400,
        workingMemoryRevision: null,
        memoryEntryCount: 0,
        memoryCharacters: 0,
        estimatedInputCharactersSaved: 0,
      },
      nodes: [
        {
          id: completedAgentNodeId,
          runId: completedAgentRunId,
          kind: 'coordinator',
          providerId: 'provider-pending',
          status: 'starting',
          task: 'Complete this durable attempt.',
          invocationId: null,
          resultSummary: null,
          createdAt: fixedTimestamp,
          updatedAt: fixedTimestamp,
          completedAt: null,
        },
      ],
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
      completedAt: null,
    });
    const completedRunning: ProjectChatAttempt = {
      ...completedAttempt,
      threadId: 'thread-completed-fixture',
      turnId: 'turn-completed-fixture',
      model: {
        invocationId: randomUUID(),
        requestedModelId: 'fixture-model',
        resolvedModelId: 'fixture-model',
        catalogVersion: 'fixture-catalog',
        reasoningOptionId: 'high',
      },
      status: 'running',
    };
    database.markChatAttemptRunning(completedRunning);
    database.markProjectAgentRunRunning({
      attemptId: completedAttemptId,
      providerId: 'codex',
      invocationId: completedRunning.model!.invocationId,
      updatedAt: fixedTimestamp,
    });
    const completedResearchNoteArtifactId = '3'.repeat(16);
    const completedResearchNotePath = `Experiments/Durable plan--${completedResearchNoteArtifactId}.md`;
    const completedResearchNoteSha256 = '4'.repeat(64);
    database.stageResearchNoteSave({
      schemaVersion: 1,
      projectId: chatProjectId,
      sessionId: defaultChatSession.id,
      attemptId: completedAttemptId,
      bindingId: 'a'.repeat(64),
      category: 'experiments',
      artifactId: completedResearchNoteArtifactId,
      expectedContentSha256: completedResearchNoteSha256,
      stagedAt: fixedTimestamp,
    });
    database.markResearchNoteSaveUncertain({
      projectId: chatProjectId,
      sessionId: defaultChatSession.id,
      attemptId: completedAttemptId,
      artifactId: completedResearchNoteArtifactId,
      uncertainAt: fixedTimestamp,
    });
    const completedAssistantMessageId = randomUUID();
    database.finishChatAttempt(
      { ...completedRunning, status: 'complete' },
      {
        id: completedAssistantMessageId,
        projectId: chatProjectId,
        role: 'assistant',
        content: `This attempt completed durably.\n\n---\n${PROJECT_CHAT_RESEARCH_NOTE_SAVE_PENDING_SECTION}`,
        status: 'complete',
        actions: [],
        createdAt: fixedTimestamp,
        completedAt: fixedTimestamp,
      },
    );
    database.finishProjectAgentRun({
      attemptId: completedAttemptId,
      status: 'complete',
      assistantContent: 'This attempt completed durably.',
      updatedAt: fixedTimestamp,
    });
    const completedAgentSnapshot = database.snapshot(chatProjectId, defaultChatSession.id);
    invariant(
      completedAgentSnapshot.agentRuns?.some(
        (run) =>
          run.id === completedAgentRunId &&
          run.status === 'complete' &&
          run.nodes[0]?.providerId === 'codex' &&
          run.nodes[0]?.status === 'complete',
      ) &&
        completedAgentSnapshot.agentMemory?.revision === 1 &&
        completedAgentSnapshot.agentMemory.entries[0]?.attemptId === completedAttemptId,
      'project_agent_run_or_working_memory_not_persisted',
    );
    invariant(
      database.abandonResearchNoteSave({
        projectId: chatProjectId,
        sessionId: defaultChatSession.id,
        attemptId: completedAttemptId,
        artifactId: completedResearchNoteArtifactId,
        abandonedAt: fixedTimestamp,
      }) &&
        database
          .snapshot(chatProjectId)
          .messages.find((message) => message.id === completedAssistantMessageId)
          ?.content.includes(PROJECT_CHAT_RESEARCH_NOTE_SAVE_ABANDONED_SECTION) &&
        !database
          .snapshot(chatProjectId)
          .messages.find((message) => message.id === completedAssistantMessageId)
          ?.content.includes(PROJECT_CHAT_RESEARCH_NOTE_SAVE_PENDING_SECTION),
      'verified_missing_research_note_was_not_terminalized',
    );
    database.confirmResearchNoteSave({
      projectId: chatProjectId,
      sessionId: defaultChatSession.id,
      attemptId: completedAttemptId,
      artifactId: completedResearchNoteArtifactId,
      category: 'experiments',
      relativePath: completedResearchNotePath,
      contentSha256: completedResearchNoteSha256,
      confirmedAt: fixedTimestamp,
    });
    const lateResearchNoteMessage = database
      .snapshot(chatProjectId)
      .messages.find((message) => message.id === completedAssistantMessageId);
    invariant(
      lateResearchNoteMessage?.content.includes(`Research Notes/${completedResearchNotePath}`) &&
        !lateResearchNoteMessage.content.includes(
          PROJECT_CHAT_RESEARCH_NOTE_SAVE_ABANDONED_SECTION,
        ),
      'late_exact_research_note_save_did_not_supersede_abandoned_receipt',
    );
    const modalityAttemptId = randomUUID();
    const modalityUserMessageId = randomUUID();
    const modalityAttempt: ProjectChatAttempt = {
      id: modalityAttemptId,
      projectId: chatProjectId,
      sessionId: defaultChatSession.id,
      userMessageId: modalityUserMessageId,
      requestedModelId: 'text-only-model',
      reasoningOptionId: null,
      status: 'starting',
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    };
    database.beginChatAttempt(modalityAttempt, {
      id: modalityUserMessageId,
      projectId: chatProjectId,
      role: 'user',
      content: 'Analyze an image with a text-only model.',
      status: 'complete',
      actions: [],
      createdAt: fixedTimestamp,
      completedAt: fixedTimestamp,
    });
    database.finishChatAttempt(
      {
        ...modalityAttempt,
        status: 'failed',
        errorCode: 'attachment_model_modality_unsupported',
      },
      {
        id: randomUUID(),
        projectId: chatProjectId,
        role: 'assistant',
        content: 'The selected model cannot accept image attachments.',
        status: 'failed',
        actions: [],
        createdAt: fixedTimestamp,
        completedAt: fixedTimestamp,
      },
    );
    const sshConnectionId = randomUUID();
    const sshProfile = {
      schemaVersion: 1 as const,
      id: sshConnectionId,
      label: 'Fixture GPU',
      hostAlias: 'fixture-gpu',
      directTarget: {
        host: '203.0.113.10',
        user: 'researcher',
        port: 2222,
        localForwards: [
          {
            bindAddress: '127.0.0.1' as const,
            localPort: 8080,
            destinationHost: 'localhost' as const,
            destinationPort: 8080,
          },
        ],
      },
      version: 1,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    };
    invariant(database.createSshConnection(sshProfile), 'ssh_profile_create_failed');
    invariant(!database.createSshConnection(sshProfile), 'ssh_profile_duplicate_was_accepted');
    const updatedSshProfile = {
      ...sshProfile,
      label: 'Fixture GPU 2',
      hostAlias: 'fixture-gpu-2',
      version: 2,
    };
    invariant(
      !database.updateSshConnection({ ...updatedSshProfile, version: 3 }, 2),
      'ssh_profile_stale_version_was_accepted',
    );
    invariant(database.updateSshConnection(updatedSshProfile, 1), 'ssh_profile_update_failed');
    const sshWorkspaceGrantId = randomUUID();
    const sshWorkspaceGrant = {
      schemaVersion: 1 as const,
      id: sshWorkspaceGrantId,
      projectId: chatProjectId,
      connectionId: sshConnectionId,
      canonicalRoot: '/workspace',
      permissionMode: 'diagnostics' as const,
      version: 1,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    };
    invariant(
      database.createSshWorkspaceGrant(sshWorkspaceGrant),
      'ssh_workspace_grant_create_failed',
    );
    invariant(
      !database.createSshWorkspaceGrant(sshWorkspaceGrant),
      'ssh_workspace_grant_duplicate_was_accepted',
    );
    const updatedSshWorkspaceGrant = {
      ...sshWorkspaceGrant,
      canonicalRoot: '/workspace/research-project',
      permissionMode: 'workspace' as const,
      version: 2,
    };
    invariant(
      !database.updateSshWorkspaceGrant({ ...updatedSshWorkspaceGrant, version: 3 }, 2),
      'ssh_workspace_grant_stale_version_was_accepted',
    );
    invariant(
      database.updateSshWorkspaceGrant(updatedSshWorkspaceGrant, 1),
      'ssh_workspace_grant_update_failed',
    );
    database.close();

    const branchLimitProjectId = randomUUID();
    const branchLimitSessionId = randomUUID();
    let branchLimitMessageId = '';
    const keyHex = safeStorage
      .decryptString(readFileSync(join(temporaryUserData, 'local-key.bin')))
      .trim();
    const legacyDatabase = new Database(join(temporaryUserData, 'gosu.db'));
    legacyDatabase.pragma(`key="x'${keyHex}'"`);
    let defaultMarkerMutationRejected = false;
    try {
      legacyDatabase
        .prepare('update project_chat_sessions set is_default=0 where id=?')
        .run(defaultChatSession.id);
    } catch (error) {
      defaultMarkerMutationRejected =
        error instanceof Error && error.message.includes('chat_default_session_immutable');
    }
    invariant(defaultMarkerMutationRejected, 'default_chat_session_marker_was_mutable');
    legacyDatabase.transaction(() => {
      legacyDatabase
        .prepare(
          `insert into project_chat_sessions(
             id,project_id,title,is_default,parent_session_id,branched_from_message_id,
             created_at,updated_at
           ) values(?,?,?,1,null,null,?,?)`,
        )
        .run(
          branchLimitSessionId,
          branchLimitProjectId,
          'Branch limit fixture',
          fixedTimestamp,
          fixedTimestamp,
        );
      legacyDatabase.exec(`
        with digits(value) as (
          values(0),(1),(2),(3),(4),(5),(6),(7),(8),(9)
        ), sequence(value) as (
          select ones.value+10*tens.value+100*hundreds.value+1000*thousands.value+1
          from digits ones cross join digits tens cross join digits hundreds cross join digits thousands
          where ones.value+10*tens.value+100*hundreds.value+1000*thousands.value
                <${PROJECT_CHAT_MAX_BRANCH_MESSAGES + 1}
        )
        insert into project_chat_messages(
          id,project_id,role,content,status,attempt_id,turn_id,model_json,created_at,completed_at
        )
        select printf('%08x-0000-4000-8000-%012x',value,value),
               '${branchLimitProjectId}','assistant','Branch limit message','complete',
               null,null,null,'${fixedTimestamp}','${fixedTimestamp}'
        from sequence;
        with digits(value) as (
          values(0),(1),(2),(3),(4),(5),(6),(7),(8),(9)
        ), sequence(value) as (
          select ones.value+10*tens.value+100*hundreds.value+1000*thousands.value+1
          from digits ones cross join digits tens cross join digits hundreds cross join digits thousands
          where ones.value+10*tens.value+100*hundreds.value+1000*thousands.value
                <${PROJECT_CHAT_MAX_BRANCH_MESSAGES + 1}
        )
        insert into project_chat_session_messages(session_id,message_id,ordinal)
        select '${branchLimitSessionId}',
               printf('%08x-0000-4000-8000-%012x',value,value),value
        from sequence;
      `);
      branchLimitMessageId = (
        legacyDatabase
          .prepare(
            `select message_id from project_chat_session_messages
             where session_id=? order by ordinal desc limit 1`,
          )
          .get(branchLimitSessionId) as { message_id: string }
      ).message_id;
    })();
    const sshColumns = (
      legacyDatabase.pragma('table_info(ssh_connections)') as Array<{ name: string }>
    ).map((column) => column.name);
    invariant(
      sshColumns.join(',') ===
        'id,schema_version,label,host_alias,direct_target_json,version,created_at,updated_at',
      'ssh_profile_table_contains_unexpected_data',
    );
    const legacyRows = legacyDatabase
      .prepare(
        `select id,scope,operation_json,base_version,created_at,delivered_at
         from sync_outbox where scope like 'workspace:%' order by rowid asc`,
      )
      .all() as Array<{
      id: string;
      scope: string;
      operation_json: string;
      base_version: number | null;
      created_at: string;
      delivered_at: string | null;
    }>;
    legacyDatabase.transaction(() => {
      legacyDatabase.exec(`
        create table sync_outbox_v01 (
          id text primary key,
          scope text not null,
          operation_json text not null,
          base_version integer,
          created_at text not null,
          delivered_at text
        )
      `);
      const insertLegacy = legacyDatabase.prepare(
        `insert into sync_outbox_v01(
           id,scope,operation_json,base_version,created_at,delivered_at
         ) values(?,?,?,?,?,?)`,
      );
      for (const row of legacyRows) {
        const operation = JSON.parse(row.operation_json) as Record<string, unknown>;
        delete operation.workspaceRevision;
        insertLegacy.run(
          row.id,
          row.scope,
          JSON.stringify(operation),
          row.base_version,
          row.created_at,
          row.delivered_at,
        );
      }
      legacyDatabase.exec(`
        drop table sync_outbox;
        alter table sync_outbox_v01 rename to sync_outbox;
        drop table local_workspace_outbox_status;
      `);
    })();
    legacyDatabase.close();

    const encryptedHeader = readFileSync(join(temporaryUserData, 'gosu.db')).subarray(0, 16);
    invariant(
      encryptedHeader.toString('utf8') !== 'SQLite format 3\0',
      'workspace_database_was_not_encrypted',
    );

    const legacyReopened = new LocalDatabase();
    legacyReopened.open();
    invariant(
      legacyReopened.loadWorkspaceState()?.revision === 2,
      'legacy_workspace_restart_restore_failed',
    );
    invariant(
      legacyReopened
        .pendingWorkspaceChanges()
        .every((operation, index) => operation.workspaceRevision === index + 1),
      'outbox_sequence_restore_failed',
    );
    invariant(
      legacyReopened.pendingWorkspaceSummary().count === 2,
      'legacy_outbox_summary_restore_failed',
    );
    invariant(
      legacyReopened.pendingWorkspaceSummary().latestWorkspaceRevision === 2,
      'legacy_outbox_summary_revision_failed',
    );
    const restoredSshProfile = legacyReopened
      .listSshConnections()
      .find((profile) => profile.id === sshConnectionId);
    invariant(
      restoredSshProfile?.directTarget?.host === '203.0.113.10' &&
        restoredSshProfile.directTarget.localForwards[0]?.localPort === 8080,
      'ssh_direct_target_restart_restore_failed',
    );
    invariant(
      !JSON.stringify(restoredSshProfile).includes('ssh -p'),
      'ssh_raw_import_command_was_persisted',
    );
    const restoredSshWorkspaceGrant = legacyReopened
      .listSshWorkspaceGrants(chatProjectId)
      .find((grant) => grant.id === sshWorkspaceGrantId);
    invariant(
      restoredSshWorkspaceGrant?.canonicalRoot === '/workspace/research-project' &&
        restoredSshWorkspaceGrant.permissionMode === 'workspace' &&
        restoredSshWorkspaceGrant.version === 2,
      'ssh_workspace_grant_restart_restore_failed',
    );
    invariant(
      !legacyReopened.removeSshWorkspaceGrant(chatProjectId, sshWorkspaceGrantId, 1),
      'ssh_workspace_grant_stale_remove_was_accepted',
    );
    legacyReopened.close();

    const mutationDatabase = new LocalDatabase();
    mutationDatabase.open();
    const workspace = new WorkspaceService({
      load: () => mutationDatabase.loadWorkspaceState(),
      commit: (state, operation) => mutationDatabase.commitWorkspaceState(state, operation),
      pendingChanges: () => mutationDatabase.pendingWorkspaceChanges(),
      pendingSummary: () => mutationDatabase.pendingWorkspaceSummary(),
    });
    const legacySnapshot = await workspace.snapshot();
    const legacyProject = legacySnapshot.projects[0];
    invariant(legacyProject !== undefined, 'legacy_project_missing');
    invariant(legacyProject.board === undefined, 'legacy_project_received_persisted_defaults');
    await workspace.updateBoardSettings({
      projectId: legacyProject.id,
      expectedVersion: legacyProject.version,
      board: {
        title: 'Reproduction pipeline',
        columnLabels: {
          backlog: 'Ideas',
          planned: 'Ready',
          in_progress: 'Running',
          review: 'Evidence check',
          done: 'Published',
        },
        columnOrder: ['backlog', 'planned', 'in_progress', 'review', 'done'],
        wipLimits: { backlog: null, planned: 4, in_progress: 2, review: 1, done: null },
      },
    });
    const persistedTask = await workspace.createTask({
      projectId: legacyProject.id,
      title: 'Run reproducibility baseline',
      status: 'in_progress',
      description: 'Verify metric parity before the ablation.',
      priority: 'urgent',
      dueDate: '2026-08-20',
      labels: ['GPU', 'gpu', 'paper'],
    });
    await workspace.setTaskArchived({
      projectId: legacyProject.id,
      taskId: persistedTask.id,
      expectedVersion: persistedTask.version,
      archived: true,
    });
    const templatedProject = await workspace.createProject({
      name: 'Default template copy',
      board: {
        title: 'Paper pipeline',
        columnLabels: {
          backlog: 'Questions',
          planned: 'Selected',
          in_progress: 'Analyzing',
          review: 'Evidence check',
          done: 'Accepted',
        },
        columnOrder: ['backlog', 'planned', 'in_progress', 'review', 'done'],
        wipLimits: { backlog: null, planned: 5, in_progress: 2, review: 2, done: null },
      },
    });
    const archivedProject = await workspace.setProjectArchived({
      projectId: templatedProject.id,
      expectedVersion: templatedProject.version,
      archived: true,
    });
    mutationDatabase.close();

    const archivedRestart = new LocalDatabase();
    archivedRestart.open();
    const archivedWorkspace = new WorkspaceService({
      load: () => archivedRestart.loadWorkspaceState(),
      commit: (state, operation) => archivedRestart.commitWorkspaceState(state, operation),
      pendingChanges: () => archivedRestart.pendingWorkspaceChanges(),
      pendingSummary: () => archivedRestart.pendingWorkspaceSummary(),
    });
    const archivedSnapshot = await archivedWorkspace.snapshot();
    invariant(
      archivedSnapshot.projects.find((project) => project.id === templatedProject.id)
        ?.archivedAt !== undefined,
      'project_archive_restart_restore_failed',
    );
    await archivedWorkspace.setProjectArchived({
      projectId: templatedProject.id,
      expectedVersion: archivedProject.version,
      archived: false,
    });
    archivedRestart.close();

    const reopened = new LocalDatabase();
    reopened.open();
    invariant(
      reopened.snapshot(chatProjectId, independentChatSession.id).queuedTurns?.[0]?.id ===
        queuedTurnId &&
        reopened.snapshot(chatProjectId, independentChatSession.id).queuedTurns?.[0]?.message ===
          'Edited durable queued turn' &&
        reopened.snapshot(chatProjectId, independentChatSession.id).queuedTurns?.[0]?.status ===
          'queued' &&
        reopened.snapshot(chatProjectId, independentChatSession.id).queuedTurns?.[1]?.id ===
          laterQueuedTurnId &&
        (reopened.snapshot(chatProjectId, independentChatSession.id).queuedTurns?.[0]
          ?.enqueueSequence ?? 0) <
          (reopened.snapshot(chatProjectId, independentChatSession.id).queuedTurns?.[1]
            ?.enqueueSequence ?? 0),
      'project_chat_queue_restart_reconciliation_failed',
    );
    let branchMessageLimitRejected = false;
    try {
      reopened.branchProjectChatSession({
        projectId: branchLimitProjectId,
        sourceSessionId: branchLimitSessionId,
        branchFromMessageId: branchLimitMessageId,
      });
    } catch (error) {
      branchMessageLimitRejected =
        error instanceof Error && error.message === 'chat_branch_limit_reached';
    }
    invariant(branchMessageLimitRejected, 'chat_branch_message_limit_was_not_enforced');
    const firstBranchMessageId = '00000001-0000-4000-8000-000000000001';
    let lineageSourceSessionId: string = branchLimitSessionId;
    for (let depth = 0; depth < PROJECT_CHAT_MAX_BRANCH_DEPTH; depth += 1) {
      lineageSourceSessionId = reopened.branchProjectChatSession({
        projectId: branchLimitProjectId,
        sourceSessionId: lineageSourceSessionId,
        branchFromMessageId: firstBranchMessageId,
      }).id;
    }
    let branchDepthLimitRejected = false;
    try {
      reopened.branchProjectChatSession({
        projectId: branchLimitProjectId,
        sourceSessionId: lineageSourceSessionId,
        branchFromMessageId: firstBranchMessageId,
      });
    } catch (error) {
      branchDepthLimitRejected =
        error instanceof Error && error.message === 'chat_branch_limit_reached';
    }
    invariant(branchDepthLimitRejected, 'chat_branch_depth_limit_was_not_enforced');
    const unrelatedRoot = reopened.createProjectChatSession(branchLimitProjectId, 'Unrelated root');
    let crossSessionBranchRejected = false;
    try {
      reopened.branchProjectChatSession({
        projectId: branchLimitProjectId,
        sourceSessionId: unrelatedRoot.id,
        branchFromMessageId: firstBranchMessageId,
      });
    } catch (error) {
      crossSessionBranchRejected =
        error instanceof Error && error.message === 'chat_branch_message_not_found';
    }
    invariant(crossSessionBranchRejected, 'cross_session_chat_branch_was_not_rejected');
    const operationalSnapshot = reopened.loadWorkspaceState();
    invariant(operationalSnapshot?.revision === 8, 'kanban_workspace_restart_restore_failed');
    invariant(
      operationalSnapshot.projects[0]?.board?.title === 'Reproduction pipeline' &&
        operationalSnapshot.projects[0]?.board?.columnLabels.review === 'Evidence check' &&
        operationalSnapshot.projects[0]?.board?.wipLimits.in_progress === 2,
      'kanban_board_settings_restart_restore_failed',
    );
    const restoredTask = operationalSnapshot.tasks.find((task) => task.id === persistedTask.id);
    invariant(
      restoredTask?.description === 'Verify metric parity before the ablation.' &&
        restoredTask.priority === 'urgent' &&
        restoredTask.dueDate === '2026-08-20' &&
        restoredTask.labels?.join(',') === 'GPU,paper' &&
        restoredTask.archivedAt !== undefined &&
        restoredTask.version === 2,
      'kanban_task_metadata_archive_restart_restore_failed',
    );
    invariant(
      operationalSnapshot.projects.find((project) => project.id === templatedProject.id)?.board
        ?.columnLabels.backlog === 'Questions' &&
        operationalSnapshot.projects.find((project) => project.id === templatedProject.id)
          ?.archivedAt === undefined &&
        operationalSnapshot.projects.find((project) => project.id === templatedProject.id)
          ?.version === 3,
      'project_archive_unarchive_restart_restore_failed',
    );
    invariant(
      reopened
        .pendingWorkspaceChanges()
        .slice(-6)
        .map((operation) => operation.commandType)
        .join(',') ===
        'project.board.update,task.create,task.archive,project.create,project.archive,project.unarchive',
      'kanban_outbox_lineage_restore_failed',
    );
    invariant(
      reopened
        .pendingWorkspaceChanges()
        .find(
          (operation) =>
            operation.commandType === 'project.create' &&
            operation.entityId === templatedProject.id,
        )?.payload.board !== undefined,
      'default_board_template_outbox_missing',
    );
    invariant(reopened.pendingWorkspaceSummary().count === 8, 'outbox_summary_restore_failed');
    invariant(
      reopened.pendingWorkspaceSummary().latestWorkspaceRevision === 8,
      'outbox_summary_revision_failed',
    );
    const reopenedChat = reopened.snapshot(chatProjectId);
    const completedResearchNoteMessage = reopenedChat.messages.find(
      (message) => message.id === completedAssistantMessageId,
    );
    invariant(
      completedResearchNoteMessage?.content.includes(
        `Research Notes/${completedResearchNotePath}`,
      ) &&
        !completedResearchNoteMessage.content.includes(
          PROJECT_CHAT_RESEARCH_NOTE_SAVE_PENDING_SECTION,
        ) &&
        completedResearchNoteMessage.content.split(`Research Notes/${completedResearchNotePath}`)
          .length === 2,
      'completed_research_note_receipt_was_not_reported_exactly_once',
    );
    const reopenedSsh = reopened.listSshConnections();
    invariant(
      reopenedSsh.length === 1 &&
        reopenedSsh[0]?.id === sshConnectionId &&
        reopenedSsh[0].label === 'Fixture GPU 2' &&
        reopenedSsh[0].hostAlias === 'fixture-gpu-2' &&
        reopenedSsh[0].version === 2,
      'ssh_profile_restart_restore_failed',
    );
    invariant(
      reopened.removeSshConnection(sshConnectionId, 2),
      'ssh_profile_remove_for_grant_cascade_failed',
    );
    invariant(
      reopened.listSshWorkspaceGrants(chatProjectId).length === 0,
      'ssh_workspace_grant_connection_cascade_failed',
    );
    invariant(
      reopened.listProjectChatSessions(chatProjectId).length === 4 &&
        reopened.snapshot(chatProjectId, independentChatSession.id).messages.length === 0,
      'root_chat_session_isolation_did_not_survive_restart',
    );
    const completedBranchSession = reopened.branchProjectChatSession({
      projectId: chatProjectId,
      sourceSessionId: defaultChatSession.id,
      branchFromMessageId: completedAssistantMessageId,
    });
    const branchedSnapshot = reopened.snapshot(chatProjectId, completedBranchSession.id);
    invariant(
      branchedSnapshot.messages.some((message) => message.id === completedAssistantMessageId) &&
        !branchedSnapshot.messages.some(
          (message) => message.attemptId === interruptedAttemptId && message.role === 'assistant',
        ),
      'chat_branch_did_not_stop_at_completed_message',
    );
    invariant(
      reopened.getChatAttempt(chatProjectId, independentChatSession.id, completedAttemptId) ===
        null,
      'chat_attempt_crossed_root_session_boundary',
    );
    let crossProjectBranchRejected = false;
    try {
      reopened.branchProjectChatSession({
        projectId: first.state.projects[0]!.id,
        sourceSessionId: defaultChatSession.id,
        branchFromMessageId: completedAssistantMessageId,
      });
    } catch (error) {
      crossProjectBranchRejected =
        error instanceof Error && error.message === 'chat_session_not_found';
    }
    invariant(crossProjectBranchRejected, 'cross_project_chat_branch_was_not_rejected');
    invariant(
      reopenedChat.messages.find((message) => message.id === chatMessageId)?.content ===
        chatMessage.content,
      'chat_message_restore_failed',
    );
    invariant(
      reopenedChat.messages.find((message) => message.id === chatMessageId)?.actions[0]?.status ===
        'proposed',
      'chat_action_restore_failed',
    );
    invariant(
      reopened.getChatAttempt(chatProjectId, completedAttemptId)?.status === 'complete' &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.harnessMode === 'planner' &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.collaborationModeId ===
          'research-orchestrator-v2' &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.personality === 'pragmatic' &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.responseVerbosity === 'high' &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.webSearchMode === 'live' &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.profileVersion === 1 &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.promptProvenance
          ?.promptSha256 === 'e'.repeat(64),
      'completed_chat_attempt_restore_failed',
    );
    invariant(
      reopenedChat.agentRuns?.some(
        (run) =>
          run.id === completedAgentRunId &&
          run.status === 'complete' &&
          run.nodes[0]?.status === 'complete',
      ) &&
        reopenedChat.agentMemory?.revision === 1 &&
        reopenedChat.agentMemory.entries[0]?.attemptId === completedAttemptId,
      'project_agent_runtime_restart_restore_failed',
    );
    invariant(
      reopened.getProjectChatProfile(chatProjectId).version === 1 &&
        reopened.getProjectChatProfile(chatProjectId).customInstructions ===
          'Prefer reproducible experiments.' &&
        reopened.getProjectChatProfile(chatProjectId).collaborationModeId ===
          'research-orchestrator-v2' &&
        reopened.getProjectChatProfile(chatProjectId).personality === 'pragmatic' &&
        reopened.getProjectChatProfile(chatProjectId).responseVerbosity === 'high' &&
        reopened.getProjectChatProfile(chatProjectId).webSearchMode === 'live' &&
        reopened.getProjectChatProfile(chatProjectId).policyRules.join('|') ===
          'Separate measured results from estimates.|State uncertainty explicitly.' &&
        reopened.getProjectChatProfile(chatProjectId).localNotesVault?.id === 'a'.repeat(64) &&
        reopened.getProjectChatProfile(chatProjectId).localNotesVault?.name === 'Fixture Vault' &&
        reopened.getProjectChatProfile(chatProjectId).instructionRevision?.id ===
          chatProfile.instructionRevision?.id,
      'chat_profile_restart_restore_failed',
    );
    const reopenedInterruptedChat = reopened.snapshot(chatProjectId, interruptedChatSession.id);
    const reconciledAttempt = reopened.getChatAttempt(
      chatProjectId,
      interruptedChatSession.id,
      interruptedAttemptId,
    );
    invariant(
      reconciledAttempt?.status === 'interrupted' &&
        reconciledAttempt.errorCode === 'application_interrupted',
      'running_chat_attempt_was_not_reconciled',
    );
    invariant(
      reopenedInterruptedChat.messages.filter(
        (message) => message.attemptId === interruptedAttemptId && message.role === 'assistant',
      ).length === 1,
      'interrupted_chat_attempt_receipt_missing',
    );
    invariant(
      reopenedInterruptedChat.agentRuns?.some(
        (run) =>
          run.id === interruptedAgentRunId &&
          run.status === 'interrupted' &&
          run.nodes[0]?.status === 'interrupted',
      ),
      'running_project_agent_run_was_not_reconciled',
    );
    const interruptedResearchNoteMessage = reopenedInterruptedChat.messages.find(
      (message) => message.attemptId === interruptedAttemptId && message.role === 'assistant',
    );
    invariant(
      interruptedResearchNoteMessage?.content.includes(
        `Research Notes/${interruptedResearchNotePath}`,
      ) &&
        interruptedResearchNoteMessage.content.split(
          `Research Notes/${interruptedResearchNotePath}`,
        ).length === 2,
      'interrupted_research_note_receipt_was_not_reconciled_exactly_once',
    );
    invariant(
      reopened.listUnreportedResearchNoteSaves().length === 0,
      'reported_research_note_receipt_remained_pending',
    );
    invariant(
      reopened.getChatAttempt(chatProjectId, modalityAttemptId)?.errorCode ===
        'attachment_model_modality_unsupported',
      'chat_attempt_modality_error_restore_failed',
    );
    invariant(
      reopenedChat.attempts?.length === 2 && reopenedInterruptedChat.attempts?.length === 1,
      'chat_attempt_snapshot_restore_failed',
    );
    invariant(
      reopened.claimAction(chatProjectId, chatActionId, fixedTimestamp),
      'chat_action_claim_failed',
    );

    const independentSession = reopened.createProjectChatSession(
      chatProjectId,
      'Independent investigation',
    );
    invariant(
      reopened.snapshot(chatProjectId, independentSession.id).messages.length === 0,
      'new_chat_session_inherited_default_history',
    );
    const sessionAttemptId = randomUUID();
    const sessionUserMessageId = randomUUID();
    const sessionAssistantMessageId = randomUUID();
    const sessionAttempt: ProjectChatAttempt = {
      id: sessionAttemptId,
      projectId: chatProjectId,
      sessionId: independentSession.id,
      userMessageId: sessionUserMessageId,
      requestedModelId: null,
      reasoningOptionId: null,
      status: 'starting',
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    };
    reopened.beginChatAttempt(sessionAttempt, {
      id: sessionUserMessageId,
      projectId: chatProjectId,
      role: 'user',
      content: 'Session-only question',
      status: 'complete',
      actions: [],
      createdAt: fixedTimestamp,
      completedAt: fixedTimestamp,
    });
    const sessionRunning: ProjectChatAttempt = {
      ...sessionAttempt,
      threadId: 'thread-session-fixture',
      turnId: 'turn-session-fixture',
      model: {
        invocationId: randomUUID(),
        requestedModelId: null,
        resolvedModelId: 'fixture-model',
        catalogVersion: 'fixture-catalog',
        reasoningOptionId: null,
      },
      status: 'running',
    };
    reopened.markChatAttemptRunning(sessionRunning);
    reopened.finishChatAttempt(
      { ...sessionRunning, status: 'complete' },
      {
        id: sessionAssistantMessageId,
        projectId: chatProjectId,
        role: 'assistant',
        content: 'Session-only answer',
        status: 'complete',
        actions: [],
        createdAt: fixedTimestamp,
        completedAt: fixedTimestamp,
      },
    );
    const branchedSession = reopened.branchProjectChatSession({
      projectId: chatProjectId,
      sourceSessionId: independentSession.id,
      branchFromMessageId: sessionAssistantMessageId,
    });
    invariant(
      reopened.snapshot(chatProjectId, branchedSession.id).messages.length === 2,
      'branched_chat_session_did_not_copy_membership_prefix',
    );
    const titleInvocationId = randomUUID();
    const generatedTitleSession = reopened.renameProjectChatSessionIfUnchanged({
      projectId: chatProjectId,
      sessionId: branchedSession.id,
      expectedTitle: branchedSession.title,
      title: 'Generated alternative hypothesis',
      titleModel: {
        invocationId: titleInvocationId,
        requestedModelId: 'opaque-provider-default',
        resolvedModelId: 'opaque-provider-default',
        catalogVersion: 'provider-catalog-v2',
        reasoningOptionId: 'native-first',
      },
      updatedAt: new Date(Date.parse(fixedTimestamp) + 1_000).toISOString(),
    });
    invariant(
      generatedTitleSession?.title === 'Generated alternative hypothesis' &&
        generatedTitleSession.titleModel?.invocationId === titleInvocationId,
      'chat_session_generated_title_provenance_failed',
    );
    const renamedSession = reopened.renameProjectChatSession(
      chatProjectId,
      branchedSession.id,
      'Alternative hypothesis',
    );
    invariant(
      renamedSession?.title === 'Alternative hypothesis' &&
        renamedSession.id === branchedSession.id,
      'chat_session_rename_failed',
    );
    invariant(
      renamedSession.titleModel === undefined &&
        reopened.renameProjectChatSessionIfUnchanged({
          projectId: chatProjectId,
          sessionId: branchedSession.id,
          expectedTitle: 'Alternative hypothesis',
          title: 'Stale generated title',
          titleModel: {
            invocationId: randomUUID(),
            requestedModelId: 'opaque-provider-default',
            resolvedModelId: 'opaque-provider-default',
            catalogVersion: 'provider-catalog-v2',
            reasoningOptionId: 'native-first',
          },
          updatedAt: new Date(Date.parse(fixedTimestamp) + 2_000).toISOString(),
        }) === null,
      'chat_session_manual_rename_did_not_win_title_cas',
    );
    const canonicalMessageMatches = reopened.searchProjectChatMessages(
      [chatProjectId],
      'Session-only answer',
      10,
    );
    invariant(
      canonicalMessageMatches.length === 1 &&
        canonicalMessageMatches[0]?.messageId === sessionAssistantMessageId &&
        canonicalMessageMatches[0].sessionId === branchedSession.id &&
        canonicalMessageMatches[0].sessionTitle === 'Alternative hypothesis',
      'project_chat_search_duplicate_branch_membership_not_canonicalized',
    );
    const sessionTitleMatches = reopened.searchProjectChatMessages(
      [chatProjectId],
      'Alternative hypothesis',
      10,
    );
    invariant(
      sessionTitleMatches.length === 2 &&
        sessionTitleMatches.every(
          (match) =>
            match.sessionId === branchedSession.id &&
            match.sessionTitle === 'Alternative hypothesis',
        ),
      'project_chat_search_session_title_match_failed',
    );
    invariant(
      reopened.searchProjectChatMessages([first.state.projects[0]!.id], 'Session-only answer', 10)
        .length === 0,
      'project_chat_search_cross_project_isolation_failed',
    );
    invariant(
      reopened
        .snapshot(chatProjectId)
        .messages.every(
          (message) =>
            message.id !== sessionUserMessageId && message.id !== sessionAssistantMessageId,
        ),
      'independent_chat_session_leaked_into_default_history',
    );

    const duplicate = fixture(9, operationId, fixedTimestamp);
    let duplicateRejected = false;
    try {
      reopened.commitWorkspaceState(duplicate.state, duplicate.operation);
    } catch {
      duplicateRejected = true;
    }
    invariant(duplicateRejected, 'duplicate_outbox_operation_was_not_rejected');
    reopened.close();

    const receiptMetadata = new Database(join(temporaryUserData, 'gosu.db'));
    receiptMetadata.pragma(`key="x'${keyHex}'"`);
    const receiptColumns = receiptMetadata.pragma(
      'table_info(project_chat_research_note_save_receipts)',
    ) as Array<{ name: string }>;
    const receiptTable = receiptMetadata
      .prepare(
        `select sql from sqlite_master
         where type='table' and name='project_chat_research_note_save_receipts'`,
      )
      .get() as { sql: string };
    invariant(
      receiptColumns.length > 0 &&
        receiptColumns.every(
          (column) => !['content', 'body', 'markdown', 'title'].includes(column.name),
        ),
      'research_note_receipt_schema_persisted_file_body_metadata',
    );
    invariant(
      /['"]abandoned['"]/u.test(receiptTable.sql),
      'research_note_abandoned_receipt_schema_was_not_migrated',
    );
    const reportedReceiptCount = receiptMetadata
      .prepare(
        `select count(*) as count from project_chat_research_note_save_receipts
         where status='reported'`,
      )
      .get() as { count: number };
    invariant(reportedReceiptCount.count === 2, 'research_note_receipts_were_not_reported_once');
    const hermesReceiptColumns = receiptMetadata.pragma(
      'table_info(project_chat_hermes_delegation_receipts)',
    ) as Array<{ name: string }>;
    invariant(
      hermesReceiptColumns.length > 0 &&
        hermesReceiptColumns.every(
          (column) =>
            !['task', 'context', 'reply', 'credential', 'credential_proof'].includes(column.name),
        ),
      'hermes_delegation_receipt_schema_persisted_raw_payload_fields',
    );
    const hermesAuditStored = receiptMetadata
      .prepare('select * from project_chat_hermes_delegation_receipts where invocation_id=?')
      .get(hermesAuditInvocationId) as Record<string, unknown> | undefined;
    const hermesAuditSerialized = JSON.stringify(hermesAuditStored);
    invariant(
      hermesAuditStored !== undefined &&
        !hermesAuditSerialized.includes('RAW_HERMES_TASK_MUST_NOT_ENTER_AUDIT_RECEIPT') &&
        !hermesAuditSerialized.includes('RAW_HERMES_CONTEXT') &&
        !hermesAuditSerialized.includes('RAW_HERMES_REPLY') &&
        !hermesAuditSerialized.includes('credentialProof'),
      'hermes_delegation_receipt_persisted_raw_payload',
    );
    let hermesAuditUpdateRejected = false;
    try {
      receiptMetadata
        .prepare(
          `update project_chat_hermes_delegation_receipts
           set stop_reason='mutated' where invocation_id=?`,
        )
        .run(hermesAuditInvocationId);
    } catch {
      hermesAuditUpdateRejected = true;
    }
    let hermesAuditDeleteRejected = false;
    try {
      receiptMetadata
        .prepare('delete from project_chat_hermes_delegation_receipts where invocation_id=?')
        .run(hermesAuditInvocationId);
    } catch {
      hermesAuditDeleteRejected = true;
    }
    invariant(
      hermesAuditUpdateRejected && hermesAuditDeleteRejected,
      'hermes_delegation_receipt_append_only_guard_failed',
    );
    invariant(
      receiptMetadata
        .prepare('delete from project_chat_attempts where id=?')
        .run(hermesAuditAttemptId).changes === 1 &&
        (
          receiptMetadata
            .prepare(
              'select count(*) as count from project_chat_hermes_delegation_receipts where invocation_id=?',
            )
            .get(hermesAuditInvocationId) as { count: number }
        ).count === 1,
      'hermes_delegation_receipt_blocked_attempt_purge_or_was_cascaded',
    );
    receiptMetadata.close();

    const afterRollback = new LocalDatabase();
    afterRollback.open();
    invariant(
      afterRollback
        .listProjectChatSessions(chatProjectId)
        .find((session) => session.id === branchedSession.id)?.title === 'Alternative hypothesis',
      'chat_session_rename_was_not_persisted_after_reopen',
    );
    invariant(
      afterRollback.snapshot(chatProjectId).messages.find((message) => message.id === chatMessageId)
        ?.actions[0]?.errorCode === 'application_interrupted',
      'chat_action_interruption_reconciliation_failed',
    );
    invariant(
      afterRollback
        .snapshot(chatProjectId, interruptedChatSession.id)
        .messages.filter(
          (message) => message.attemptId === interruptedAttemptId && message.role === 'assistant',
        ).length === 1,
      'chat_attempt_reconciliation_created_duplicate_receipt',
    );
    invariant(
      afterRollback.loadWorkspaceState()?.revision === 8,
      'workspace_transaction_did_not_roll_back',
    );
    invariant(
      afterRollback.pendingWorkspaceChanges().length === 8,
      'outbox_transaction_did_not_roll_back',
    );
    invariant(
      afterRollback.pendingWorkspaceSummary().count === 8,
      'outbox_summary_did_not_roll_back',
    );

    const competing = new LocalDatabase();
    competing.open();
    const accepted = fixture(9, randomUUID(), fixedTimestamp);
    const stale = fixture(9, randomUUID(), fixedTimestamp);
    afterRollback.commitWorkspaceState(accepted.state, accepted.operation);
    let staleRevisionRejected = false;
    try {
      competing.commitWorkspaceState(stale.state, stale.operation);
    } catch (error) {
      staleRevisionRejected =
        error instanceof Error && error.message === 'workspace_revision_conflict';
    }
    invariant(staleRevisionRejected, 'stale_workspace_revision_was_not_rejected');
    afterRollback.close();
    competing.close();

    const afterRace = new LocalDatabase();
    afterRace.open();
    invariant(afterRace.loadWorkspaceState()?.revision === 9, 'workspace_race_revision_changed');
    invariant(
      afterRace.loadWorkspaceState()?.projects[0]?.id === accepted.state.projects[0]?.id,
      'workspace_race_snapshot_was_overwritten',
    );
    invariant(
      afterRace.pendingWorkspaceChanges().filter((operation) => operation.workspaceRevision === 9)
        .length === 1,
      'workspace_race_created_duplicate_revision',
    );
    invariant(afterRace.pendingWorkspaceSummary().count === 9, 'workspace_race_summary_changed');
    afterRace.close();

    const opaquePayload = '{legacy-operation-payload-is-not-json';
    const corruptStatus = new Database(join(temporaryUserData, 'gosu.db'));
    corruptStatus.pragma(`key="x'${keyHex}'"`);
    corruptStatus.transaction(() => {
      corruptStatus
        .prepare('update sync_outbox set operation_json=?,workspace_revision=null where id=?')
        .run(opaquePayload, operationId);
      corruptStatus
        .prepare(
          `update local_workspace_outbox_status
           set pending_count=1,latest_workspace_revision=null where singleton_id=1`,
        )
        .run();
    })();
    corruptStatus.close();

    const recovered = new LocalDatabase();
    recovered.open();
    invariant(recovered.loadWorkspaceState()?.revision === 9, 'opaque_payload_changed_snapshot');
    invariant(recovered.pendingWorkspaceSummary().count === 9, 'status_reconciliation_failed');
    invariant(
      recovered.pendingWorkspaceSummary().latestWorkspaceRevision === 9,
      'status_revision_reconciliation_failed',
    );
    let opaqueQueueRejected = false;
    try {
      recovered.pendingWorkspaceChanges();
    } catch (error) {
      opaqueQueueRejected = error instanceof WorkspaceDataRecoveryError;
    }
    invariant(opaqueQueueRejected, 'opaque_queue_was_not_marked_for_recovery');
    recovered.close();

    const preservedPayload = new Database(join(temporaryUserData, 'gosu.db'));
    preservedPayload.pragma(`key="x'${keyHex}'"`);
    const preserved = preservedPayload
      .prepare('select operation_json from sync_outbox where id=?')
      .get(operationId) as { operation_json: string };
    preservedPayload.close();
    invariant(preserved.operation_json === opaquePayload, 'opaque_payload_was_rewritten');

    const ambiguousOrdering = new Database(join(temporaryUserData, 'gosu.db'));
    ambiguousOrdering.pragma(`key="x'${keyHex}'"`);
    const acceptedRow = ambiguousOrdering
      .prepare('select operation_json from sync_outbox where id=?')
      .get(accepted.operation.id) as { operation_json: string };
    const acceptedOperation = JSON.parse(acceptedRow.operation_json) as Record<string, unknown>;
    acceptedOperation.workspaceRevision = 10;
    ambiguousOrdering
      .prepare('update sync_outbox set operation_json=?,workspace_revision=10 where id=?')
      .run(JSON.stringify(acceptedOperation), accepted.operation.id);
    ambiguousOrdering.close();

    const recoveryRequired = new LocalDatabase();
    recoveryRequired.open();
    invariant(
      recoveryRequired.loadWorkspaceState()?.revision === 9,
      'ambiguous_outbox_hid_workspace_snapshot',
    );
    let ambiguousSummaryRejected = false;
    try {
      recoveryRequired.pendingWorkspaceSummary();
    } catch (error) {
      ambiguousSummaryRejected = error instanceof WorkspaceDataRecoveryError;
    }
    invariant(ambiguousSummaryRejected, 'ambiguous_outbox_was_silently_renumbered');
    recoveryRequired.close();

    verifyLegacyChatMigration(temporaryUserData, fixedTimestamp);
    verifyLegacySshMigration(temporaryUserData, fixedTimestamp);
    verifyLegacyProfileMigration(temporaryUserData, fixedTimestamp);
    verifyLiteratureRelevanceMigration(temporaryUserData, fixedTimestamp);
    verifyLiteraturePersistence(fixedTimestamp);
    verifyLiteratureSearchTagPersistence(fixedTimestamp);
    verifySparseSemanticScholarMerge(fixedTimestamp);
    verifyLiteratureDiscoveryPersistence(fixedTimestamp);
    verifyLiteratureBoundsAndIdentity(fixedTimestamp);
    verifyExperimentEvaluationPersistence(fixedTimestamp);
    verifyModelUsagePersistence(fixedTimestamp);
    verifyExperimentPersistence(fixedTimestamp);
    verifyLectureStudioListDetailBoundary(fixedTimestamp);
    verifyLectureStudioAttemptRetention(fixedTimestamp);
    await verifyLectureExternalSourceTrashPurgeRecovery(temporaryUserData, fixedTimestamp);
    verifyManuscriptWorkspacePersistence(temporaryUserData, fixedTimestamp);
    await verifyWorkspaceTrashPurge(temporaryUserData, fixedTimestamp);

    process.stdout.write('local SQLCipher workspace smoke test passed\n');
    app.exit(0);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'local_database_smoke_failed'}\n`,
    );
    app.exit(1);
  } finally {
    invariant(
      basename(temporaryUserData).startsWith('gosu-local-db-smoke-'),
      'temporary_workspace_path_rejected',
    );
    rmSync(temporaryUserData, { recursive: true, force: true });
  }
});
