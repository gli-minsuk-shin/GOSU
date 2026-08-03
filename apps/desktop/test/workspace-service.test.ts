import { describe, expect, it } from 'vitest';

import {
  WorkspaceService,
  WorkspaceServiceError,
  type WorkspaceStorage,
} from '../src/main/workspace-service';
import {
  DEFAULT_WORKSPACE_BOARD_SETTINGS,
  resolveWorkspaceBoardSettings,
  type WorkspaceOperation,
  type WorkspaceSnapshot,
} from '../src/shared/workspace-contracts';

class MemoryWorkspaceStorage implements WorkspaceStorage {
  state: WorkspaceSnapshot | null = null;
  operations: WorkspaceOperation[] = [];

  load() {
    return this.state === null ? null : structuredClone(this.state);
  }

  commit(state: WorkspaceSnapshot, operation: WorkspaceOperation) {
    this.state = structuredClone(state);
    this.operations.push(structuredClone(operation));
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
  it('treats a legacy project without trashedAt as active', async () => {
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
