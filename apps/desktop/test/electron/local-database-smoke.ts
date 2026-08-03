import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import Database from 'better-sqlite3-multiple-ciphers';
import { app, safeStorage } from 'electron';

import { LocalDatabase } from '../../src/main/local-database';
import { WorkspaceService } from '../../src/main/workspace-service';
import { WorkspaceDataRecoveryError } from '../../src/main/workspace-storage-error';
import type {
  ProjectChatAttempt,
  ProjectChatMessage,
} from '../../src/shared/project-chat-contracts';
import type {
  ProjectRecord,
  WorkspaceOperation,
  WorkspaceSnapshot,
} from '../../src/shared/workspace-contracts';

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
    const reconciled = reopened.getChatAttempt(legacyProjectId, durableAttemptId);
    invariant(
      reconciled?.status === 'interrupted' && reconciled.errorCode === 'application_interrupted',
      'migrated_chat_did_not_support_durable_attempt_reconciliation',
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
        raw
          .prepare(
            `insert into project_chat_profiles(
             project_id,version,harness_mode,response_depth,context_scope,
             instruction_revision_id,created_at,updated_at
           ) values(?,?,?,?,?,?,?,?)`,
          )
          .run(
            projectId,
            1,
            'planner',
            'deep',
            'board',
            revisionId,
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
        legacyProfile.localNotesVault === null &&
        legacyProfile.customInstructions === 'Legacy profile instructions.',
      'legacy_profile_v050_migration_failed',
    );
    const updated = migrated.updateProjectChatProfile({
      projectId,
      expectedVersion: 1,
      harnessMode: 'planner',
      responseDepth: 'deep',
      contextScope: 'board',
      localNotesVault: { id: 'f'.repeat(64), name: 'Migrated Vault' },
      customInstructions: 'Legacy profile instructions.',
    });
    invariant(
      updated?.version === 2 && updated.localNotesVault?.id === 'f'.repeat(64),
      'legacy_profile_v050_grant_update_failed',
    );
    migrated.close();
  } finally {
    app.setPath('userData', primaryUserData);
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
      database.getProjectChatProfile(chatProjectId).version === 0,
      'default_chat_profile_missing',
    );
    const chatProfile = database.updateProjectChatProfile({
      projectId: chatProjectId,
      expectedVersion: 0,
      harnessMode: 'planner',
      responseDepth: 'deep',
      contextScope: 'board',
      localNotesVault: { id: 'a'.repeat(64), name: 'Fixture Vault' },
      customInstructions: 'Prefer reproducible experiments.',
    });
    invariant(chatProfile?.version === 1, 'chat_profile_initial_update_failed');
    invariant(
      chatProfile.localNotesVault?.id === 'a'.repeat(64) &&
        chatProfile.localNotesVault.name === 'Fixture Vault',
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

    const interruptedAttemptId = randomUUID();
    const interruptedUserMessageId = randomUUID();
    const interruptedAttempt: ProjectChatAttempt = {
      id: interruptedAttemptId,
      projectId: chatProjectId,
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
    database.markChatAttemptRunning(interruptedRunning);

    const completedAttemptId = randomUUID();
    const completedUserMessageId = randomUUID();
    const completedAttempt: ProjectChatAttempt = {
      id: completedAttemptId,
      projectId: chatProjectId,
      userMessageId: completedUserMessageId,
      requestedModelId: 'fixture-model',
      reasoningOptionId: 'high',
      harnessMode: 'planner',
      responseDepth: 'deep',
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
    database.finishChatAttempt(
      { ...completedRunning, status: 'complete' },
      {
        id: randomUUID(),
        projectId: chatProjectId,
        role: 'assistant',
        content: 'This attempt completed durably.',
        status: 'complete',
        actions: [],
        createdAt: fixedTimestamp,
        completedAt: fixedTimestamp,
      },
    );
    database.close();

    const keyHex = safeStorage
      .decryptString(readFileSync(join(temporaryUserData, 'local-key.bin')))
      .trim();
    const legacyDatabase = new Database(join(temporaryUserData, 'gosu.db'));
    legacyDatabase.pragma(`key="x'${keyHex}'"`);
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
    mutationDatabase.close();

    const reopened = new LocalDatabase();
    reopened.open();
    const operationalSnapshot = reopened.loadWorkspaceState();
    invariant(operationalSnapshot?.revision === 6, 'kanban_workspace_restart_restore_failed');
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
        ?.columnLabels.backlog === 'Questions',
      'default_board_template_restart_restore_failed',
    );
    invariant(
      reopened
        .pendingWorkspaceChanges()
        .slice(-4)
        .map((operation) => operation.commandType)
        .join(',') === 'project.board.update,task.create,task.archive,project.create',
      'kanban_outbox_lineage_restore_failed',
    );
    invariant(
      reopened.pendingWorkspaceChanges().at(-1)?.payload.board !== undefined,
      'default_board_template_outbox_missing',
    );
    invariant(reopened.pendingWorkspaceSummary().count === 6, 'outbox_summary_restore_failed');
    invariant(
      reopened.pendingWorkspaceSummary().latestWorkspaceRevision === 6,
      'outbox_summary_revision_failed',
    );
    const reopenedChat = reopened.snapshot(chatProjectId);
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
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.profileVersion === 1 &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.promptProvenance
          ?.promptSha256 === 'e'.repeat(64),
      'completed_chat_attempt_restore_failed',
    );
    invariant(
      reopened.getProjectChatProfile(chatProjectId).version === 1 &&
        reopened.getProjectChatProfile(chatProjectId).customInstructions ===
          'Prefer reproducible experiments.' &&
        reopened.getProjectChatProfile(chatProjectId).localNotesVault?.id === 'a'.repeat(64) &&
        reopened.getProjectChatProfile(chatProjectId).localNotesVault?.name === 'Fixture Vault' &&
        reopened.getProjectChatProfile(chatProjectId).instructionRevision?.id ===
          chatProfile.instructionRevision?.id,
      'chat_profile_restart_restore_failed',
    );
    const reconciledAttempt = reopened.getChatAttempt(chatProjectId, interruptedAttemptId);
    invariant(
      reconciledAttempt?.status === 'interrupted' &&
        reconciledAttempt.errorCode === 'application_interrupted',
      'running_chat_attempt_was_not_reconciled',
    );
    invariant(
      reopenedChat.messages.filter(
        (message) => message.attemptId === interruptedAttemptId && message.role === 'assistant',
      ).length === 1,
      'interrupted_chat_attempt_receipt_missing',
    );
    invariant(reopenedChat.attempts?.length === 2, 'chat_attempt_snapshot_restore_failed');
    invariant(
      reopened.claimAction(chatProjectId, chatActionId, fixedTimestamp),
      'chat_action_claim_failed',
    );

    const duplicate = fixture(7, operationId, fixedTimestamp);
    let duplicateRejected = false;
    try {
      reopened.commitWorkspaceState(duplicate.state, duplicate.operation);
    } catch {
      duplicateRejected = true;
    }
    invariant(duplicateRejected, 'duplicate_outbox_operation_was_not_rejected');
    reopened.close();

    const afterRollback = new LocalDatabase();
    afterRollback.open();
    invariant(
      afterRollback.snapshot(chatProjectId).messages.find((message) => message.id === chatMessageId)
        ?.actions[0]?.errorCode === 'application_interrupted',
      'chat_action_interruption_reconciliation_failed',
    );
    invariant(
      afterRollback
        .snapshot(chatProjectId)
        .messages.filter(
          (message) => message.attemptId === interruptedAttemptId && message.role === 'assistant',
        ).length === 1,
      'chat_attempt_reconciliation_created_duplicate_receipt',
    );
    invariant(
      afterRollback.loadWorkspaceState()?.revision === 6,
      'workspace_transaction_did_not_roll_back',
    );
    invariant(
      afterRollback.pendingWorkspaceChanges().length === 6,
      'outbox_transaction_did_not_roll_back',
    );
    invariant(
      afterRollback.pendingWorkspaceSummary().count === 6,
      'outbox_summary_did_not_roll_back',
    );

    const competing = new LocalDatabase();
    competing.open();
    const accepted = fixture(7, randomUUID(), fixedTimestamp);
    const stale = fixture(7, randomUUID(), fixedTimestamp);
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
    invariant(afterRace.loadWorkspaceState()?.revision === 7, 'workspace_race_revision_changed');
    invariant(
      afterRace.loadWorkspaceState()?.projects[0]?.id === accepted.state.projects[0]?.id,
      'workspace_race_snapshot_was_overwritten',
    );
    invariant(
      afterRace.pendingWorkspaceChanges().filter((operation) => operation.workspaceRevision === 7)
        .length === 1,
      'workspace_race_created_duplicate_revision',
    );
    invariant(afterRace.pendingWorkspaceSummary().count === 7, 'workspace_race_summary_changed');
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
    invariant(recovered.loadWorkspaceState()?.revision === 7, 'opaque_payload_changed_snapshot');
    invariant(recovered.pendingWorkspaceSummary().count === 7, 'status_reconciliation_failed');
    invariant(
      recovered.pendingWorkspaceSummary().latestWorkspaceRevision === 7,
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
    acceptedOperation.workspaceRevision = 8;
    ambiguousOrdering
      .prepare('update sync_outbox set operation_json=?,workspace_revision=8 where id=?')
      .run(JSON.stringify(acceptedOperation), accepted.operation.id);
    ambiguousOrdering.close();

    const recoveryRequired = new LocalDatabase();
    recoveryRequired.open();
    invariant(
      recoveryRequired.loadWorkspaceState()?.revision === 7,
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
    verifyLegacyProfileMigration(temporaryUserData, fixedTimestamp);

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
