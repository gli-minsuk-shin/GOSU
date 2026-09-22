import { describe, expect, it, vi } from 'vitest';

import {
  WorkspaceService,
  WorkspaceServiceError,
  type WorkspaceStorage,
} from '../src/main/workspace-service';
import {
  DEFAULT_WORKSPACE_BOARD_SETTINGS,
  resolveWorkspaceBoardSettings,
  type EmptyProjectTrashReceipt,
  type WorkspaceObjective,
  type WorkspaceOperation,
  type WorkspaceSnapshot,
} from '../src/shared/workspace-contracts';

class MemoryWorkspaceStorage implements WorkspaceStorage {
  state: WorkspaceSnapshot | null = null;
  operations: WorkspaceOperation[] = [];
  trashReceipts = new Map<string, EmptyProjectTrashReceipt>();

  load() {
    return this.state === null ? null : structuredClone(this.state);
  }

  commit(state: WorkspaceSnapshot, operation: WorkspaceOperation) {
    this.state = structuredClone(state);
    this.operations.push(structuredClone(operation));
  }

  purgeTrash(
    state: WorkspaceSnapshot,
    operation: WorkspaceOperation,
    receipt: EmptyProjectTrashReceipt,
  ) {
    this.commit(state, operation);
    this.trashReceipts.set(receipt.idempotencyKey, structuredClone(receipt));
  }

  loadTrashPurgeReceipt(idempotencyKey: string) {
    return structuredClone(this.trashReceipts.get(idempotencyKey) ?? null);
  }

  pendingChanges() {
    return structuredClone(this.operations);
  }

  pendingSummary() {
    return {
      count: this.operations.length,
      latestWorkspaceRevision: this.operations.at(-1)?.workspaceRevision ?? null,
    };
  }
}

const objectiveFields = {
  goal: 'Improve deterministic validation accuracy under a fixed experiment budget',
  primaryMetric: {
    key: 'accuracy',
    displayName: 'Validation accuracy',
    direction: 'maximize' as const,
    unit: 'ratio',
    aggregation: 'maximum' as const,
    evaluatorHash: 'evaluator:abcdef123',
    datasetHash: 'dataset:0123456789abcdef',
    holdoutHash: 'holdout:0123456789abcdef',
    baseline: 0.8,
    target: 0.9,
  },
  guardrails: [{ metricKey: 'latency_ms', operator: 'lte' as const, threshold: 50 }],
  budget: {
    maxTrials: 10,
    maxConcurrentTrials: 2,
    maxWallTimeSeconds: 7_200,
    maxGpuHours: 4,
    maxFailures: 3,
  },
  stopPolicy: {
    stopWhenTargetReached: true,
    guardrailAction: 'pause' as const,
    maxConsecutiveNoImprovement: 5,
  },
};

function expectServiceError(error: unknown, code: WorkspaceServiceError['code']) {
  expect(error).toBeInstanceOf(WorkspaceServiceError);
  expect(error).toMatchObject({ code });
}

describe('WorkspaceService', () => {
  it('persists personal tasks with no project and supports editing, completion, trash and restart', async () => {
    const storage = new MemoryWorkspaceStorage(),
      service = new WorkspaceService(storage);
    const task = await service.createTask({
      projectId: null,
      title: 'Personal follow-up',
      dueDate: '2026-09-20',
      dueAt: '2026-09-20T04:30:00Z',
    });
    expect((await service.snapshot()).projects).toEqual([]);
    expect(task.projectId).toBeNull();
    expect(storage.operations.at(-1)?.projectId).toBeUndefined();
    const done = await service.updateTask({
      projectId: null,
      taskId: task.id,
      expectedVersion: task.version,
      status: 'done',
    });
    const deleted = await service.setTaskArchived({
      projectId: null,
      taskId: task.id,
      expectedVersion: done.version,
      archived: true,
    });
    expect(deleted.archivedAt).toBeDefined();
    const restored = await new WorkspaceService(storage).setTaskArchived({
      projectId: null,
      taskId: task.id,
      expectedVersion: deleted.version,
      archived: false,
    });
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.dueAt).toBe('2026-09-20T04:30:00Z');
    const project = await service.createProject({ name: 'Research' });
    await expect(
      service.updateTask({
        projectId: project.id,
        taskId: task.id,
        expectedVersion: task.version,
        status: 'planned',
      }),
    ).rejects.toMatchObject({ code: 'cross_project_access_denied' });
  });
  it('uses a trusted task id once across concurrent creation and durable reload', async () => {
    const storage = new MemoryWorkspaceStorage(),
      service = new WorkspaceService(storage);
    const project = await service.createProject({ name: 'Reminder integration' });
    const id = '22222222-2222-4222-8222-222222222222',
      command = { projectId: project.id, title: 'Follow up' };
    const results = await Promise.allSettled([
      service.createTask(command, id),
      service.createTask(command, id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await new WorkspaceService(storage).snapshot()).tasks.map((t) => t.id)).toEqual([id]);
  });
  it('empties only recoverable Trash atomically and returns an idempotent preservation receipt', async () => {
    const storage = new MemoryWorkspaceStorage();
    const service = new WorkspaceService(storage);
    const active = await service.createProject({ name: 'Active Research' });
    const archived = await service.createProject({ name: 'Archived Research' });
    await service.setProjectArchived({
      projectId: archived.id,
      expectedVersion: archived.version,
      archived: true,
    });
    const doomed = await service.createProject({ name: 'Recoverable Draft' });
    await service.createTask({ projectId: doomed.id, title: 'Temporary task', status: 'backlog' });
    await service.trashProject({ projectId: doomed.id, expectedVersion: doomed.version });
    const before = await service.snapshot();
    const idempotencyKey = '11111111-1111-4111-8111-111111111111';

    const receipt = await service.emptyTrash({
      expectedWorkspaceRevision: before.revision,
      idempotencyKey,
      confirmation: 'EMPTY TRASH',
    });

    expect(receipt).toMatchObject({
      idempotencyKey,
      removedProjects: [{ id: doomed.id, name: doomed.name }],
      detachedLocalLinks: ['research-notes', 'ssh-workspace-grants'],
      recoverableInGosu: false,
    });
    expect(receipt.preservedExternalData).toEqual([
      'github-repositories',
      'local-git-worktrees',
      'obsidian-research-notes-files',
      'remote-server-data',
    ]);
    expect(receipt.preservedImmutableProvenance).toContain('experiment-lineage-and-metrics');
    const after = await service.snapshot();
    expect(after.projects.map((project) => project.id).sort()).toEqual(
      [active.id, archived.id].sort(),
    );
    expect(after.tasks.some((task) => task.projectId === doomed.id)).toBe(false);
    expect(storage.operations.at(-1)).toMatchObject({
      id: idempotencyKey,
      commandType: 'project.trash.empty',
      entityType: 'workspace',
    });

    await expect(
      service.emptyTrash({
        expectedWorkspaceRevision: 0,
        idempotencyKey,
        confirmation: 'EMPTY TRASH',
      }),
    ).resolves.toEqual(receipt);
    expect(storage.operations.filter((operation) => operation.id === idempotencyKey)).toHaveLength(
      1,
    );
  });

  it('treats a legacy project without archivedAt or trashedAt as active', async () => {
    const storage = new MemoryWorkspaceStorage();
    storage.state = {
      schemaVersion: 1,
      revision: 0,
      projects: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Legacy active project',
          slug: 'legacy-active-project',
          version: 1,
          createdAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-04T00:00:00.000Z',
        },
      ],
      tasks: [],
      objectives: [],
    };

    const service = new WorkspaceService(storage);
    const snapshot = await service.snapshot();
    expect(snapshot.projects[0]).not.toHaveProperty('archivedAt');
    expect(snapshot.projects[0]).not.toHaveProperty('trashedAt');
    await expect(
      service.renameProject({
        projectId: snapshot.projects[0]!.id,
        expectedVersion: snapshot.projects[0]!.version,
        name: 'Legacy project renamed',
      }),
    ).resolves.toMatchObject({ name: 'Legacy project renamed', version: 2 });
  });

  it('opens a legacy schema-v1 snapshot and gives newly created projects the full default Board', async () => {
    const storage = new MemoryWorkspaceStorage();
    storage.state = {
      schemaVersion: 1,
      revision: 0,
      projects: [],
      tasks: [],
      objectives: [],
    };
    const service = new WorkspaceService(storage);
    const project = await service.createProject({ name: 'Legacy Compatible' });
    const task = await service.createTask({ projectId: project.id, title: 'Legacy shaped task' });

    const snapshot = await new WorkspaceService(storage).snapshot();
    expect(snapshot.projects[0]?.board).toEqual(DEFAULT_WORKSPACE_BOARD_SETTINGS);
    expect(snapshot.tasks[0]).toEqual(task);
    expect(snapshot.tasks[0]).not.toHaveProperty('description');
    expect(resolveWorkspaceBoardSettings(snapshot.projects[0]?.board)).toEqual(
      DEFAULT_WORKSPACE_BOARD_SETTINGS,
    );
  });

  it('starts empty, creates projects, and derives stable unique slugs', async () => {
    const storage = new MemoryWorkspaceStorage();
    const service = new WorkspaceService(storage);

    expect(await service.snapshot()).toEqual({
      schemaVersion: 1,
      revision: 0,
      projects: [],
      tasks: [],
      objectives: [],
    });

    const first = await service.createProject({
      name: 'Vision Study',
      repository: 'research/vision-study',
    });
    const second = await service.createProject({ name: 'Vision Study' });

    expect(first).toMatchObject({ slug: 'vision-study', repository: 'research/vision-study' });
    expect(second.slug).toBe('vision-study-2');
    expect(first.board).toEqual(DEFAULT_WORKSPACE_BOARD_SETTINGS);
    expect(second.board).toEqual(DEFAULT_WORKSPACE_BOARD_SETTINGS);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await service.snapshot()).projects).toEqual([first, second]);
    expect(storage.operations[0]).toMatchObject({
      commandType: 'project.create',
      payload: { board: DEFAULT_WORKSPACE_BOARD_SETTINGS },
    });
  });

  it('updates a project repository with optimistic versioning and stores only an owner/repository label', async () => {
    const storage = new MemoryWorkspaceStorage();
    const service = new WorkspaceService(storage);
    const project = await service.createProject({ name: 'Repository project' });

    const updated = await service.updateProjectRepository({
      projectId: project.id,
      expectedVersion: project.version,
      repository: 'research-lab/paper-code',
    });

    expect(updated).toMatchObject({
      repository: 'research-lab/paper-code',
      version: project.version + 1,
    });
    expect(storage.operations.at(-1)).toMatchObject({
      commandType: 'project.repository.update',
      baseVersion: project.version,
      payload: {
        repository: 'research-lab/paper-code',
        newEntityVersion: project.version + 1,
      },
    });
    await expect(
      service.updateProjectRepository({
        projectId: project.id,
        expectedVersion: project.version,
        repository: 'research-lab/other-code',
      }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(
      service.createProject({
        name: 'Unsafe repository',
        repository: 'https://token@github.com/research/private.git',
      }),
    ).rejects.toThrow();
  });

  it('normalizes a supplied Board template into the project and its create outbox operation', async () => {
    const storage = new MemoryWorkspaceStorage();
    const service = new WorkspaceService(storage);
    const board = {
      title: '  Experiment pipeline  ',
      columnLabels: {
        backlog: '  Ideas ',
        planned: 'Queued',
        in_progress: 'Running',
        review: 'PI Review',
        done: 'Published',
      },
      columnOrder: ['backlog', 'planned', 'in_progress', 'review', 'done'] as const,
      wipLimits: {
        backlog: null,
        planned: 8,
        in_progress: 3,
        review: 2,
        done: null,
      },
    };

    const project = await service.createProject({ name: 'Template project', board });

    expect(project.board).toEqual({
      ...board,
      title: 'Experiment pipeline',
      columnLabels: { ...board.columnLabels, backlog: 'Ideas' },
    });
    expect(await new WorkspaceService(storage).snapshot()).toMatchObject({
      revision: 1,
      projects: [{ id: project.id, board: project.board }],
    });
    expect(storage.operations).toHaveLength(1);
    expect(storage.operations[0]).toMatchObject({
      commandType: 'project.create',
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      baseVersion: null,
      payload: {
        name: 'Template project',
        slug: 'template-project',
        board: project.board,
      },
    });
  });

  it('renames, trashes, and restores a project without changing its stable slug or children', async () => {
    const storage = new MemoryWorkspaceStorage();
    const service = new WorkspaceService(storage);
    const project = await service.createProject({ name: 'Lifecycle Project' });
    const task = await service.createTask({
      projectId: project.id,
      title: 'Preserve this task',
    });
    const objective = await service.saveObjective({
      projectId: project.id,
      expectedEntityVersion: 0,
      ...objectiveFields,
    });

    const renamed = await service.renameProject({
      projectId: project.id,
      expectedVersion: project.version,
      name: '  Renamed Lifecycle Project  ',
    });
    expect(renamed).toMatchObject({
      id: project.id,
      name: 'Renamed Lifecycle Project',
      slug: project.slug,
      version: 2,
    });
    expect(storage.operations.at(-1)).toMatchObject({
      commandType: 'project.rename',
      baseVersion: 1,
      payload: { name: 'Renamed Lifecycle Project', newEntityVersion: 2 },
    });

    const trashed = await service.trashProject({
      projectId: project.id,
      expectedVersion: renamed.version,
    });
    expect(trashed).toMatchObject({ id: project.id, slug: project.slug, version: 3 });
    expect(trashed.trashedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(storage.operations.at(-1)).toMatchObject({
      commandType: 'project.trash',
      baseVersion: 2,
      payload: { trashedAt: trashed.trashedAt, newEntityVersion: 3 },
    });
    expect(await service.snapshot()).toMatchObject({
      projects: [{ id: project.id, trashedAt: trashed.trashedAt }],
      tasks: [task],
      objectives: [objective],
    });

    const staleRestore = await service
      .restoreProject({ projectId: project.id, expectedVersion: renamed.version })
      .catch((caught: unknown) => caught);
    expectServiceError(staleRestore, 'version_conflict');

    const duplicateTrash = await service
      .trashProject({ projectId: project.id, expectedVersion: trashed.version })
      .catch((caught: unknown) => caught);
    expectServiceError(duplicateTrash, 'project_trashed');

    const restored = await service.restoreProject({
      projectId: project.id,
      expectedVersion: trashed.version,
    });
    expect(restored).toMatchObject({
      id: project.id,
      name: renamed.name,
      slug: project.slug,
      version: 4,
    });
    expect(restored).not.toHaveProperty('trashedAt');
    expect(storage.operations.at(-1)).toMatchObject({
      commandType: 'project.restore',
      baseVersion: 3,
      payload: { trashedAt: null, newEntityVersion: 4 },
    });
    expect(await new WorkspaceService(storage).snapshot()).toMatchObject({
      projects: [{ id: project.id, version: 4 }],
      tasks: [task],
      objectives: [objective],
    });

    const duplicateRestore = await service
      .restoreProject({ projectId: project.id, expectedVersion: restored.version })
      .catch((caught: unknown) => caught);
    expectServiceError(duplicateRestore, 'project_not_trashed');
  });

  it('archives with optimistic versions and preserves the prior archived state through Trash', async () => {
    const storage = new MemoryWorkspaceStorage();
    const service = new WorkspaceService(storage);
    const project = await service.createProject({ name: 'Recoverable Archive Project' });
    const task = await service.createTask({ projectId: project.id, title: 'Preserved task' });
    const objective = await service.saveObjective({
      projectId: project.id,
      expectedEntityVersion: 0,
      ...objectiveFields,
    });

    const archived = await service.setProjectArchived({
      projectId: project.id,
      expectedVersion: project.version,
      archived: true,
    });
    expect(archived).toMatchObject({ id: project.id, slug: project.slug, version: 2 });
    expect(archived.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(storage.operations.at(-1)).toMatchObject({
      commandType: 'project.archive',
      baseVersion: 1,
      payload: { archivedAt: archived.archivedAt, newEntityVersion: 2 },
    });

    const staleUnarchive = await service
      .setProjectArchived({
        projectId: project.id,
        expectedVersion: project.version,
        archived: false,
      })
      .catch((caught: unknown) => caught);
    expectServiceError(staleUnarchive, 'version_conflict');
    const duplicateArchive = await service
      .setProjectArchived({
        projectId: project.id,
        expectedVersion: archived.version,
        archived: true,
      })
      .catch((caught: unknown) => caught);
    expectServiceError(duplicateArchive, 'project_archived');
    await expect(
      service.createTask({ projectId: project.id, title: 'Archived write must fail' }),
    ).rejects.toMatchObject({ code: 'project_archived' });

    const restarted = new WorkspaceService(storage);
    expect(await restarted.snapshot()).toMatchObject({
      projects: [{ id: project.id, archivedAt: archived.archivedAt }],
      tasks: [task],
      objectives: [objective],
    });
    const trashed = await restarted.trashProject({
      projectId: project.id,
      expectedVersion: archived.version,
    });
    expect(trashed).toMatchObject({ version: 3, archivedAt: archived.archivedAt });
    const archiveChangeInTrash = await restarted
      .setProjectArchived({
        projectId: project.id,
        expectedVersion: trashed.version,
        archived: false,
      })
      .catch((caught: unknown) => caught);
    expectServiceError(archiveChangeInTrash, 'project_trashed');
    const restored = await restarted.restoreProject({
      projectId: project.id,
      expectedVersion: trashed.version,
    });
    expect(restored).toMatchObject({ version: 4, archivedAt: archived.archivedAt });
    expect(restored).not.toHaveProperty('trashedAt');

    const active = await restarted.setProjectArchived({
      projectId: project.id,
      expectedVersion: restored.version,
      archived: false,
    });
    expect(active).toMatchObject({ id: project.id, slug: project.slug, version: 5 });
    expect(active).not.toHaveProperty('archivedAt');
    expect(storage.operations.at(-1)).toMatchObject({
      commandType: 'project.unarchive',
      baseVersion: 4,
      payload: { archivedAt: null, newEntityVersion: 5 },
    });
    const duplicateUnarchive = await restarted
      .setProjectArchived({
        projectId: project.id,
        expectedVersion: active.version,
        archived: false,
      })
      .catch((caught: unknown) => caught);
    expectServiceError(duplicateUnarchive, 'project_not_archived');
  });

  it('rejects normal project mutations while preserving a trashed aggregate', async () => {
    const storage = new MemoryWorkspaceStorage();
    const service = new WorkspaceService(storage);
    const project = await service.createProject({ name: 'Read-only Trash Project' });
    const task = await service.createTask({ projectId: project.id, title: 'Preserved task' });
    const objective = await service.saveObjective({
      projectId: project.id,
      expectedEntityVersion: 0,
      ...objectiveFields,
    });
    const trashed = await service.trashProject({
      projectId: project.id,
      expectedVersion: project.version,
    });
    const revisionAfterTrash = (await service.snapshot()).revision;

    const mutations: Array<() => Promise<unknown>> = [
      () =>
        service.renameProject({
          projectId: project.id,
          expectedVersion: trashed.version,
          name: 'Must not rename',
        }),
      () =>
        service.updateBoardSettings({
          projectId: project.id,
          expectedVersion: trashed.version,
          board: DEFAULT_WORKSPACE_BOARD_SETTINGS,
        }),
      () => service.createTask({ projectId: project.id, title: 'Must not create' }),
      () =>
        service.updateTask({
          projectId: project.id,
          taskId: task.id,
          expectedVersion: task.version,
          status: 'planned',
        }),
      () =>
        service.setTaskArchived({
          projectId: project.id,
          taskId: task.id,
          expectedVersion: task.version,
          archived: true,
        }),
      () =>
        service.saveObjective({
          projectId: project.id,
          expectedEntityVersion: objective.entityVersion,
          ...objectiveFields,
        }),
      () =>
        service.lockObjective({
          projectId: project.id,
          expectedEntityVersion: objective.entityVersion,
        }),
      () =>
        service.startObjectiveVersion({
          projectId: project.id,
          expectedEntityVersion: objective.entityVersion,
        }),
    ];

    for (const mutate of mutations) {
      const error = await mutate().catch((caught: unknown) => caught);
      expectServiceError(error, 'project_trashed');
    }

    expect(await service.snapshot()).toMatchObject({
      revision: revisionAfterTrash,
      projects: [{ id: project.id, trashedAt: trashed.trashedAt }],
      tasks: [task],
      objectives: [objective],
    });
  });

  it('creates and moves a task with optimistic versions and rejects a stale move', async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStorage());
    const project = await service.createProject({ name: 'Task Project' });
    const task = await service.createTask({
      projectId: project.id,
      title: 'Run deterministic baseline',
      status: 'backlog',
    });

    const moved = await service.updateTask({
      projectId: project.id,
      taskId: task.id,
      expectedVersion: task.version,
      status: 'in_progress',
    });
    expect(moved).toMatchObject({ status: 'in_progress', version: 2 });

    const error = await service
      .updateTask({
        projectId: project.id,
        taskId: task.id,
        expectedVersion: task.version,
        status: 'done',
      })
      .catch((caught: unknown) => caught);
    expectServiceError(error, 'version_conflict');
    expect(error).toMatchObject({ details: { expectedVersion: 1, currentVersion: 2 } });
    expect((await service.snapshot()).tasks[0]).toEqual(moved);
  });

  it('does not allow a task to be addressed through another project', async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStorage());
    const first = await service.createProject({ name: 'First Project' });
    const second = await service.createProject({ name: 'Second Project' });
    const task = await service.createTask({
      projectId: first.id,
      title: 'Project-isolated task',
    });

    const error = await service
      .updateTask({
        projectId: second.id,
        taskId: task.id,
        expectedVersion: task.version,
        status: 'review',
      })
      .catch((caught: unknown) => caught);
    expectServiceError(error, 'cross_project_access_denied');
    expect((await service.snapshot()).tasks[0]?.projectId).toBe(first.id);
  });

  it('updates normalized project-specific Board settings with optimistic versions', async () => {
    const storage = new MemoryWorkspaceStorage();
    const service = new WorkspaceService(storage);
    const first = await service.createProject({ name: 'Board Alpha' });
    const second = await service.createProject({ name: 'Board Beta' });
    const board = {
      title: '  Experiment workflow  ',
      columnLabels: {
        backlog: '  Ideas ',
        planned: 'Queued',
        in_progress: 'Running',
        review: 'Validate',
        done: 'Published',
      },
      columnOrder: ['planned', 'backlog', 'in_progress', 'review', 'done'] as const,
      wipLimits: {
        backlog: null,
        planned: 8,
        in_progress: 3,
        review: 2,
        done: null,
      },
    };

    const updated = await service.updateBoardSettings({
      projectId: first.id,
      expectedVersion: first.version,
      board,
    });

    expect(updated).toMatchObject({
      id: first.id,
      version: 2,
      board: {
        title: 'Experiment workflow',
        columnLabels: { backlog: 'Ideas' },
        columnOrder: ['planned', 'backlog', 'in_progress', 'review', 'done'],
        wipLimits: { in_progress: 3 },
      },
    });
    const snapshot = await service.snapshot();
    expect(snapshot.projects.find((project) => project.id === second.id)?.board).toEqual(
      DEFAULT_WORKSPACE_BOARD_SETTINGS,
    );
    expect(storage.operations.at(-1)).toMatchObject({
      commandType: 'project.board.update',
      projectId: first.id,
      entityType: 'project',
      entityId: first.id,
      baseVersion: 1,
      payload: { board: updated.board, newEntityVersion: 2 },
    });

    const staleError = await service
      .updateBoardSettings({ projectId: first.id, expectedVersion: 1, board })
      .catch((caught: unknown) => caught);
    expectServiceError(staleError, 'version_conflict');
    expect(staleError).toMatchObject({ details: { currentVersion: 2 } });
  });

  it('normalizes task metadata, clears optional values, and restores it after restart', async () => {
    const storage = new MemoryWorkspaceStorage();
    const service = new WorkspaceService(storage);
    const project = await service.createProject({ name: 'Metadata Project' });
    const created = await service.createTask({
      projectId: project.id,
      title: '  Compare optimizers  ',
      status: 'planned',
      description: '  Run the fixed-seed comparison.  ',
      priority: 'high',
      dueDate: '2026-08-14',
      dueAt: '2026-08-14T04:30:00Z',
      labels: [' Baseline ', 'GPU', 'baseline', ' gpu '],
    });

    expect(created).toMatchObject({
      title: 'Compare optimizers',
      description: 'Run the fixed-seed comparison.',
      priority: 'high',
      dueDate: '2026-08-14',
      labels: ['Baseline', 'GPU'],
      version: 1,
    });
    expect((await new WorkspaceService(storage).snapshot()).tasks[0]).toEqual(created);

    const cleared = await service.updateTask({
      projectId: project.id,
      taskId: created.id,
      expectedVersion: created.version,
      description: '',
      priority: '',
      dueDate: null,
      labels: [],
    });
    expect(cleared).toMatchObject({ id: created.id, version: 2 });
    expect(cleared).not.toHaveProperty('description');
    expect(cleared).not.toHaveProperty('priority');
    expect(cleared).not.toHaveProperty('dueDate');
    expect(cleared).not.toHaveProperty('dueAt');
    expect(cleared).not.toHaveProperty('labels');
    expect(storage.operations.at(-1)).toMatchObject({
      commandType: 'task.update',
      baseVersion: 1,
      payload: {
        description: null,
        priority: null,
        dueDate: null,
        labels: [],
        newEntityVersion: 2,
      },
    });
    expect((await new WorkspaceService(storage).snapshot()).tasks[0]).toEqual(cleared);
  });

  it('archives and restores through project ownership and optimistic task versions', async () => {
    const storage = new MemoryWorkspaceStorage();
    const service = new WorkspaceService(storage);
    const first = await service.createProject({ name: 'Archive Alpha' });
    const second = await service.createProject({ name: 'Archive Beta' });
    const task = await service.createTask({ projectId: first.id, title: 'Preserve provenance' });

    const denied = await service
      .setTaskArchived({
        projectId: second.id,
        taskId: task.id,
        expectedVersion: task.version,
        archived: true,
      })
      .catch((caught: unknown) => caught);
    expectServiceError(denied, 'cross_project_access_denied');

    const archived = await service.setTaskArchived({
      projectId: first.id,
      taskId: task.id,
      expectedVersion: task.version,
      archived: true,
    });
    expect(archived).toMatchObject({ id: task.id, version: 2 });
    expect(archived.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(storage.operations.at(-1)).toMatchObject({
      commandType: 'task.archive',
      projectId: first.id,
      baseVersion: 1,
    });

    const stale = await service
      .setTaskArchived({
        projectId: first.id,
        taskId: task.id,
        expectedVersion: task.version,
        archived: false,
      })
      .catch((caught: unknown) => caught);
    expectServiceError(stale, 'version_conflict');

    const restored = await service.setTaskArchived({
      projectId: first.id,
      taskId: task.id,
      expectedVersion: archived.version,
      archived: false,
    });
    expect(restored).toMatchObject({ id: task.id, version: 3 });
    expect(restored).not.toHaveProperty('archivedAt');
    expect(storage.operations.at(-1)).toMatchObject({
      commandType: 'task.restore',
      projectId: first.id,
      baseVersion: 2,
      payload: { archivedAt: null, newEntityVersion: 3 },
    });
    expect((await new WorkspaceService(storage).snapshot()).tasks[0]).toEqual(restored);
  });

  it('keeps locked objective versions immutable and starts a separate draft explicitly', async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStorage());
    const project = await service.createProject({ name: 'Objective Project' });
    const draft = await service.saveObjective({
      projectId: project.id,
      expectedEntityVersion: 0,
      ...objectiveFields,
    });
    expect(draft).toMatchObject({ objectiveVersion: 1, entityVersion: 1, locked: false });

    const revised = await service.saveObjective({
      projectId: project.id,
      expectedEntityVersion: draft.entityVersion,
      ...objectiveFields,
      goal: 'Improve accuracy while retaining the exact evaluator and dataset lineage',
    });
    const locked = await service.lockObjective({
      projectId: project.id,
      expectedEntityVersion: revised.entityVersion,
    });
    expect(locked).toMatchObject({ objectiveVersion: 1, entityVersion: 3, locked: true });

    const lockedError = await service
      .saveObjective({
        projectId: project.id,
        expectedEntityVersion: locked.entityVersion,
        ...objectiveFields,
      })
      .catch((caught: unknown) => caught);
    expectServiceError(lockedError, 'objective_locked');

    const next = await service.startObjectiveVersion({
      projectId: project.id,
      expectedEntityVersion: locked.entityVersion,
    });
    expect(next).toMatchObject({ objectiveVersion: 2, entityVersion: 1, locked: false });
    expect(next.id).not.toBe(locked.id);

    const objectives = (await service.snapshot()).objectives;
    expect(objectives).toHaveLength(2);
    expect(objectives[0]).toEqual(locked);
    expect(objectives[1]).toEqual(next);
  });

  it('rejects stale manual save, freeze and revision requests after plan identity replacement', async () => {
    const storage = new MemoryWorkspaceStorage();
    const service = new WorkspaceService(storage);
    const project = await service.createProject({ name: 'Manual objective identity guard' });
    const first = await service.saveObjective({
      ...objectiveFields,
      projectId: project.id,
      expectedEntityVersion: 0,
      expectedObjectiveId: null,
      expectedObjectiveVersion: null,
    });
    const stale = {
      projectId: project.id,
      expectedEntityVersion: first.entityVersion,
      expectedObjectiveId: first.id,
      expectedObjectiveVersion: first.objectiveVersion,
    };
    const replacement = await service.applyResearchPlanObjective(
      {
        ...objectiveFields,
        ...stale,
        activate: false,
        goal: 'Preserve the newly requested plan against an older editor draft',
      },
      (state, operation) => storage.commit(state, operation),
    );
    expect(replacement.entityVersion).toBe(first.entityVersion);
    const before = await service.snapshot();
    const operations = structuredClone(storage.operations);
    await expect(service.saveObjective({ ...objectiveFields, ...stale })).rejects.toMatchObject({
      code: 'version_conflict',
    });
    await expect(service.lockObjective(stale)).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(service.startObjectiveVersion(stale)).rejects.toMatchObject({
      code: 'version_conflict',
    });
    expect(await service.snapshot()).toEqual(before);
    expect(storage.operations).toEqual(operations);

    const revised = await service.saveObjective({
      ...objectiveFields,
      projectId: project.id,
      expectedEntityVersion: replacement.entityVersion,
      expectedObjectiveId: replacement.id,
      expectedObjectiveVersion: replacement.objectiveVersion,
    });
    expect(revised.id).toBe(replacement.id);
    expect(revised).not.toHaveProperty('expectedObjectiveId');
    expect(revised).not.toHaveProperty('expectedObjectiveVersion');
    const frozen = await service.lockObjective({
      projectId: project.id,
      expectedEntityVersion: revised.entityVersion,
      expectedObjectiveId: revised.id,
      expectedObjectiveVersion: revised.objectiveVersion,
    });
    const next = await service.startObjectiveVersion({
      projectId: project.id,
      expectedEntityVersion: frozen.entityVersion,
      expectedObjectiveId: frozen.id,
      expectedObjectiveVersion: frozen.objectiveVersion,
    });
    expect(next).toMatchObject({ objectiveVersion: 3, entityVersion: 1, locked: false });
    expect((await service.snapshot()).objectives).toEqual([first, frozen, next]);
  });

  it.each(['id-only', 'version-only', 'wrong-version'] as const)(
    'rejects incomplete or mismatched manual objective identity: %s',
    async (kind) => {
      const storage = new MemoryWorkspaceStorage();
      const service = new WorkspaceService(storage);
      const project = await service.createProject({ name: 'Paired objective identity guard' });
      const objective = await service.saveObjective({
        ...objectiveFields,
        projectId: project.id,
        expectedEntityVersion: 0,
      });
      const command = {
        projectId: project.id,
        expectedEntityVersion: objective.entityVersion,
        ...(kind === 'id-only'
          ? { expectedObjectiveId: objective.id }
          : kind === 'version-only'
            ? { expectedObjectiveVersion: objective.objectiveVersion }
            : {
                expectedObjectiveId: objective.id,
                expectedObjectiveVersion: objective.objectiveVersion + 1,
              }),
      };
      const before = await service.snapshot();
      await expect(service.saveObjective({ ...objectiveFields, ...command })).rejects.toMatchObject(
        { code: 'version_conflict' },
      );
      await expect(service.lockObjective(command)).rejects.toMatchObject({
        code: 'version_conflict',
      });
      await expect(service.startObjectiveVersion(command)).rejects.toMatchObject({
        code: 'version_conflict',
      });
      expect(await service.snapshot()).toEqual(before);
      expect(storage.operations).toHaveLength(2);
    },
  );

  describe('applyResearchPlanObjective', () => {
    async function fixture() {
      const storage = new MemoryWorkspaceStorage();
      const service = new WorkspaceService(storage);
      const project = await service.createProject({ name: 'Research Plan Project' });
      const commit = vi.fn(
        (
          state: WorkspaceSnapshot,
          operation: WorkspaceOperation,
          objective: WorkspaceObjective,
        ) => {
          expect(state.objectives).toContainEqual(objective);
          expect(operation.entityId).toBe(objective.id);
          expect(operation.workspaceRevision).toBe(state.revision);
          storage.commit(state, operation);
        },
      );
      const input = {
        ...objectiveFields,
        projectId: project.id,
        expectedEntityVersion: 0,
        expectedObjectiveId: null,
        expectedObjectiveVersion: null,
        activate: false,
      };
      return { storage, service, project, commit, input };
    }

    it.each([false, true])(
      'creates a first objective with activate=%s and commits exactly once',
      async (activate) => {
        const { service, storage, commit, input } = await fixture();
        const objective = await service.applyResearchPlanObjective({ ...input, activate }, commit);
        expect(objective).toMatchObject({
          ...objectiveFields,
          objectiveVersion: 1,
          entityVersion: 1,
          locked: activate,
        });
        expect(commit).toHaveBeenCalledTimes(1);
        expect(storage.operations).toHaveLength(2);
        expect(storage.operations[1]).toMatchObject({
          commandType: 'research.plan.apply',
          baseVersion: null,
          workspaceRevision: 2,
          payload: {
            ...objectiveFields,
            objectiveVersion: 1,
            newEntityVersion: 1,
            previousObjectiveId: null,
            activationRequested: activate,
            locked: activate,
            needsIdentity: false,
          },
        });
        expect((await service.snapshot()).objectives).toEqual([objective]);
        expect(await new WorkspaceService(storage).snapshot()).toEqual(await service.snapshot());
      },
    );

    it('preserves a draft and activates a separate reviewed replacement objective', async () => {
      const { service, commit, input } = await fixture();
      const draft = await service.applyResearchPlanObjective(input, commit);
      commit.mockClear();
      const replacement = {
        ...input,
        expectedEntityVersion: draft.entityVersion,
        expectedObjectiveId: draft.id,
        expectedObjectiveVersion: draft.objectiveVersion,
        activate: true,
        goal: 'Compare the revised model under stricter compute limits',
        budget: { ...input.budget, maxTrials: 4 },
        guardrails: [],
      };
      const activated = await service.applyResearchPlanObjective(replacement, commit);
      expect(activated).toMatchObject({
        objectiveVersion: 2,
        entityVersion: 1,
        locked: true,
        goal: replacement.goal,
        budget: replacement.budget,
        guardrails: [],
      });
      expect(activated.id).not.toBe(draft.id);
      expect((await service.snapshot()).objectives).toEqual([draft, activated]);
      expect(commit).toHaveBeenCalledTimes(1);
    });

    it.each(['evaluatorHash', 'datasetHash', 'holdoutHash'] as const)(
      'keeps pending %s editable and rejects manual freeze until resolved',
      async (identity) => {
        const { service, storage, commit, input } = await fixture();
        const draft = await service.applyResearchPlanObjective(
          {
            ...input,
            activate: true,
            primaryMetric: { ...input.primaryMetric, [identity]: 'pending:research-plan' },
          },
          commit,
        );
        expect(draft.locked).toBe(false);
        expect(storage.operations.at(-1)?.payload).toMatchObject({
          activationRequested: true,
          needsIdentity: true,
          locked: false,
        });
        const before = await service.snapshot();
        await expect(
          service.lockObjective({
            projectId: input.projectId,
            expectedEntityVersion: draft.entityVersion,
          }),
        ).rejects.toMatchObject({ code: 'objective_identity_pending' });
        expect(await service.snapshot()).toEqual(before);
        expect(commit).toHaveBeenCalledTimes(1);
        const resolved = await service.saveObjective({
          ...objectiveFields,
          projectId: input.projectId,
          expectedEntityVersion: draft.entityVersion,
        });
        expect(
          (
            await service.lockObjective({
              projectId: input.projectId,
              expectedEntityVersion: resolved.entityVersion,
            })
          ).locked,
        ).toBe(true);
      },
    );

    it.each([false, true])(
      'preserves frozen history when creating a successor with activate=%s',
      async (activate) => {
        const { service, storage, commit, input } = await fixture();
        const frozen = await service.applyResearchPlanObjective(
          { ...input, activate: true },
          commit,
        );
        commit.mockClear();
        const next = await service.applyResearchPlanObjective(
          {
            ...input,
            expectedEntityVersion: frozen.entityVersion,
            expectedObjectiveId: frozen.id,
            expectedObjectiveVersion: frozen.objectiveVersion,
            activate,
            goal: 'Evaluate a different model under the same fixed metric lineage',
          },
          commit,
        );
        expect(next).toMatchObject({ objectiveVersion: 2, entityVersion: 1, locked: activate });
        expect(next.id).not.toBe(frozen.id);
        expect((await service.snapshot()).objectives).toEqual([frozen, next]);
        expect(storage.operations.at(-1)?.payload).toMatchObject({
          previousObjectiveId: frozen.id,
          newEntityVersion: 1,
        });
        expect(commit).toHaveBeenCalledTimes(1);
      },
    );

    it('rejects a stale v1/e1 identity after v2/e1 replaced the current objective', async () => {
      const { service, storage, commit, input } = await fixture();
      const first = await service.applyResearchPlanObjective({ ...input, activate: true }, commit);
      const nextInput = {
        ...input,
        expectedObjectiveId: first.id,
        expectedObjectiveVersion: first.objectiveVersion,
        expectedEntityVersion: first.entityVersion,
        activate: true,
      };
      const second = await service.applyResearchPlanObjective(nextInput, commit);
      expect(first.entityVersion).toBe(1);
      expect(second).toMatchObject({ objectiveVersion: 2, entityVersion: 1 });
      const before = await service.snapshot();
      commit.mockClear();
      await expect(service.applyResearchPlanObjective(nextInput, commit)).rejects.toMatchObject({
        code: 'version_conflict',
      });
      expect(commit).not.toHaveBeenCalled();
      expect(await service.snapshot()).toEqual(before);
      expect(storage.state).toEqual(before);
    });

    it.each(['id', 'objectiveVersion', 'entityVersion'] as const)(
      'rejects an independently stale %s before committing',
      async (field) => {
        const { service, commit, input } = await fixture();
        const current = await service.applyResearchPlanObjective(input, commit);
        const nextInput = {
          ...input,
          expectedObjectiveId: current.id as string | null,
          expectedObjectiveVersion: current.objectiveVersion,
          expectedEntityVersion: current.entityVersion,
        };
        if (field === 'id') nextInput.expectedObjectiveId = null;
        if (field === 'objectiveVersion') nextInput.expectedObjectiveVersion += 1;
        if (field === 'entityVersion') nextInput.expectedEntityVersion += 1;
        const before = await service.snapshot();
        commit.mockClear();
        await expect(service.applyResearchPlanObjective(nextInput, commit)).rejects.toMatchObject({
          code: 'version_conflict',
        });
        expect(commit).not.toHaveBeenCalled();
        expect(await service.snapshot()).toEqual(before);
      },
    );

    it.each([
      { expectedObjectiveId: '11111111-1111-4111-8111-111111111111' },
      { expectedObjectiveVersion: 1 },
    ])('requires null objective identity before the first plan: %j', async (identity) => {
      const { service, commit, input } = await fixture();
      const before = await service.snapshot();
      await expect(
        service.applyResearchPlanObjective({ ...input, ...identity }, commit),
      ).rejects.toMatchObject({ code: 'version_conflict' });
      expect(commit).not.toHaveBeenCalled();
      expect(await service.snapshot()).toEqual(before);
    });

    it('preserves both pending plan snapshots when a new activated plan resolves the latest one', async () => {
      const { service, storage, commit, input } = await fixture();
      const first = await service.applyResearchPlanObjective(
        {
          ...input,
          activate: true,
          primaryMetric: { ...input.primaryMetric, datasetHash: 'pending:dataset:first' },
        },
        commit,
      );
      const second = await service.applyResearchPlanObjective(
        {
          ...input,
          expectedObjectiveId: first.id,
          expectedObjectiveVersion: first.objectiveVersion,
          expectedEntityVersion: first.entityVersion,
          activate: true,
          goal: 'Compare an independent model with a separate unresolved dataset',
          primaryMetric: { ...input.primaryMetric, datasetHash: 'pending:dataset:second' },
          budget: { ...input.budget, maxTrials: 3 },
        },
        commit,
      );
      expect(first.locked).toBe(false);
      expect(second).toMatchObject({ locked: false, objectiveVersion: 2, entityVersion: 1 });
      expect(second.id).not.toBe(first.id);
      expect((await service.snapshot()).objectives).toEqual([first, second]);
      const activated = await service.applyResearchPlanObjective(
        {
          ...input,
          goal: second.goal,
          budget: second.budget,
          expectedObjectiveId: second.id,
          expectedObjectiveVersion: second.objectiveVersion,
          expectedEntityVersion: second.entityVersion,
          activate: true,
        },
        commit,
      );
      expect(activated).toMatchObject({ locked: true, objectiveVersion: 3, entityVersion: 1 });
      expect(new Set([first.id, second.id, activated.id]).size).toBe(3);
      expect((await service.snapshot()).objectives).toEqual([first, second, activated]);
      expect((await new WorkspaceService(storage).snapshot()).objectives).toEqual([
        first,
        second,
        activated,
      ]);
      expect(storage.operations.at(-1)?.payload).toMatchObject({
        previousObjectiveId: second.id,
        needsIdentity: false,
      });
      expect(commit).toHaveBeenCalledTimes(3);
    });

    it('serializes competing plan writes and rejects stale CAS before the callback', async () => {
      const { service, storage, commit, input } = await fixture();
      const results = await Promise.allSettled([
        service.applyResearchPlanObjective(input, commit),
        service.applyResearchPlanObjective(input, commit),
      ]);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1]).toMatchObject({
        status: 'rejected',
        reason: { code: 'version_conflict', details: { expectedVersion: 0, currentVersion: 1 } },
      });
      expect(commit).toHaveBeenCalledTimes(1);
      expect(storage.operations).toHaveLength(2);
      expect((await service.snapshot()).objectives).toHaveLength(1);
    });

    it('rolls back a failed callback without leaking its edits and recovers the queued mutation', async () => {
      const { service, storage, commit, input } = await fixture();
      const draft = await service.applyResearchPlanObjective(input, commit);
      const before = await service.snapshot();
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const failedCommit = vi.fn(
        async (
          state: WorkspaceSnapshot,
          _operation: WorkspaceOperation,
          objective: WorkspaceObjective,
        ) => {
          expect(storage.state).toEqual(before);
          Object.assign(state.projects[0]!, { name: 'Must not leak' });
          Object.assign(objective, { goal: 'Must not leak callback edits' });
          entered();
          await gate;
          throw new Error('research_plan_commit_failed');
        },
      );
      const failed = service.applyResearchPlanObjective(
        {
          ...input,
          expectedEntityVersion: draft.entityVersion,
          expectedObjectiveId: draft.id,
          expectedObjectiveVersion: draft.objectiveVersion,
          activate: true,
        },
        failedCommit,
      );
      const rejected = expect(failed).rejects.toThrow('research_plan_commit_failed');
      await started;
      const afterFailure = service.snapshot();
      const recovery = service.createTask({
        projectId: input.projectId,
        title: 'Continue after failed plan',
      });
      expect(storage.state).toEqual(before);
      release();
      await rejected;
      expect(await afterFailure).toEqual(before);
      const task = await recovery;
      expect(failedCommit).toHaveBeenCalledTimes(1);
      const after = await service.snapshot();
      expect(after.objectives).toEqual(before.objectives);
      expect(after.projects).toEqual(before.projects);
      expect(after.tasks).toEqual([task]);
      expect(after.revision).toBe(before.revision + 1);
      expect(storage.operations.map((operation) => operation.commandType)).toEqual([
        'project.create',
        'research.plan.apply',
        'task.create',
      ]);
    });

    it.each(['archived', 'trashed'] as const)(
      'rejects %s projects without invoking the callback',
      async (status) => {
        const { service, project, commit, input } = await fixture();
        if (status === 'archived') {
          await service.setProjectArchived({
            projectId: project.id,
            expectedVersion: project.version,
            archived: true,
          });
        } else {
          await service.trashProject({ projectId: project.id, expectedVersion: project.version });
        }
        const before = await service.snapshot();
        await expect(service.applyResearchPlanObjective(input, commit)).rejects.toMatchObject({
          code: `project_${status}`,
        });
        expect(commit).not.toHaveBeenCalled();
        expect(await service.snapshot()).toEqual(before);
      },
    );

    it.each([
      { activate: 'true' },
      { activate: undefined },
      { expectedObjectiveId: undefined },
      { expectedObjectiveId: 'invalid-id' },
      { expectedObjectiveVersion: undefined },
      { expectedObjectiveVersion: 0 },
      { unexpected: true },
      { budget: { ...objectiveFields.budget, maxTrials: 0 } },
    ])('rejects invalid input %j without committing', async (invalid) => {
      const { service, commit, input } = await fixture();
      const before = await service.snapshot();
      await expect(
        service.applyResearchPlanObjective(
          { ...input, ...invalid } as Parameters<WorkspaceService['applyResearchPlanObjective']>[0],
          commit,
        ),
      ).rejects.toThrow();
      expect(commit).not.toHaveBeenCalled();
      expect(await service.snapshot()).toEqual(before);
    });
  });

  it('refreshes a committed plan after a lost acknowledgment without dropping queued work', async () => {
    const storage = new MemoryWorkspaceStorage();
    const service = new WorkspaceService(storage);
    const project = await service.createProject({ name: 'Lost acknowledgment recovery' });
    const before = await service.snapshot();
    await expect(
      service.applyResearchPlanObjective(
        {
          ...objectiveFields,
          projectId: project.id,
          expectedEntityVersion: 0,
          expectedObjectiveId: null,
          expectedObjectiveVersion: null,
          activate: true,
        },
        (state, operation) => {
          storage.commit(state, operation);
          throw new Error('acknowledgment_lost');
        },
      ),
    ).rejects.toThrow('acknowledgment_lost');
    expect(await service.snapshot()).toEqual(before);
    const committed = storage.load()!;
    const operationsBeforeRefresh = structuredClone(storage.operations);
    const reload = vi.spyOn(storage, 'load');
    const refreshed = await service.refreshCommittedState();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(refreshed).toEqual(committed);
    expect(storage.operations).toEqual(operationsBeforeRefresh);
    expect(storage.state).toEqual(committed);
    Object.assign(refreshed.projects[0]!, { name: 'Caller cannot edit cache' });
    expect(await service.snapshot()).toEqual(committed);

    const first = service.createTask({ projectId: project.id, title: 'Queued before refresh' });
    const refreshBetween = service.refreshCommittedState();
    const second = service.createTask({ projectId: project.id, title: 'Queued after refresh' });
    const [firstTask, intermediate, secondTask] = await Promise.all([
      first,
      refreshBetween,
      second,
    ]);
    expect(intermediate.tasks).toEqual([firstTask]);
    expect(intermediate.revision).toBe(committed.revision + 1);
    const final = await service.snapshot();
    expect(final.objectives).toEqual(committed.objectives);
    expect(final.tasks).toEqual([firstTask, secondTask]);
    expect(final.revision).toBe(committed.revision + 2);
    expect(
      storage.operations
        .slice(operationsBeforeRefresh.length)
        .map((operation) => operation.commandType),
    ).toEqual(['task.create', 'task.create']);
  });

  it.each(['read-error', 'invalid-snapshot', 'missing-snapshot'] as const)(
    'preserves the previous cache after refresh %s and recovers its queue',
    async (failure) => {
      const storage = new MemoryWorkspaceStorage();
      const service = new WorkspaceService(storage);
      const project = await service.createProject({ name: 'Refresh failure recovery' });
      const before = await service.snapshot();
      const operations = structuredClone(storage.operations);
      const reload = vi.spyOn(storage, 'load').mockImplementationOnce(() => {
        if (failure === 'read-error') throw new Error('storage_read_failed');
        if (failure === 'missing-snapshot') return null;
        return { ...before, revision: -1 };
      });
      const refresh = service.refreshCommittedState();
      const rejection = expect(refresh).rejects.toThrow();
      const preserved = service.snapshot();
      const recovery = service.createTask({
        projectId: project.id,
        title: 'Queue survives refresh error',
      });
      await rejection;
      expect(await preserved).toEqual(before);
      expect(reload).toHaveBeenCalledTimes(1);
      const task = await recovery;
      expect((await service.snapshot()).tasks).toEqual([task]);
      expect((await service.snapshot()).revision).toBe(before.revision + 1);
      expect(storage.operations.slice(0, operations.length)).toEqual(operations);
      expect(storage.operations).toHaveLength(operations.length + 1);
      expect(storage.operations.at(-1)?.commandType).toBe('task.create');
    },
  );

  it('reloads durable state and exposes one pending operation per committed mutation', async () => {
    const storage = new MemoryWorkspaceStorage();
    const firstService = new WorkspaceService(storage);
    const project = await firstService.createProject({ name: 'Persistent Project' });
    await firstService.createTask({ projectId: project.id, title: 'Persist this task' });

    const reloaded = new WorkspaceService(storage);
    const snapshot = await reloaded.snapshot();
    expect(snapshot.projects[0]).toEqual(project);
    expect(snapshot.tasks[0]).toMatchObject({ title: 'Persist this task', projectId: project.id });
    expect(snapshot.revision).toBe(2);

    const pending = await reloaded.pendingChanges();
    expect(pending).toHaveLength(2);
    expect(pending.map((operation) => operation.commandType)).toEqual([
      'project.create',
      'task.create',
    ]);
    expect(pending.every((operation) => operation.id === operation.idempotencyKey)).toBe(true);
    expect(pending.every((operation) => operation.schemaVersion === 1)).toBe(true);
    expect(pending.map((operation) => operation.workspaceRevision)).toEqual([1, 2]);
    expect(pending.every((operation) => /^[0-9a-f-]{36}$/.test(operation.id))).toBe(true);
    expect(
      pending.every((operation) => operation.scope.startsWith(`workspace:${project.id}:`)),
    ).toBe(true);
    expect(await reloaded.pendingSummary()).toEqual({
      count: 2,
      latestWorkspaceRevision: 2,
    });

    storage.operations.reverse();
    expect(
      (await reloaded.pendingChanges()).map((operation) => operation.workspaceRevision),
    ).toEqual([1, 2]);
  });

  it('does not publish optimistic state when the atomic storage commit fails', async () => {
    const storage = new MemoryWorkspaceStorage();
    const service = new WorkspaceService({
      load: () => storage.load(),
      commit: () => {
        throw new Error('fixture_atomic_commit_failed');
      },
      pendingChanges: () => storage.pendingChanges(),
      pendingSummary: () => storage.pendingSummary(),
    });

    await expect(service.createProject({ name: 'Must roll back' })).rejects.toThrow(
      'fixture_atomic_commit_failed',
    );
    expect(await service.snapshot()).toEqual({
      schemaVersion: 1,
      revision: 0,
      projects: [],
      tasks: [],
      objectives: [],
    });
    expect(await service.pendingChanges()).toEqual([]);
  });
});
