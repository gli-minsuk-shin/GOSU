import { describe, expect, it } from 'vitest';

import {
  WorkspaceService,
  WorkspaceServiceError,
  type WorkspaceStorage,
} from '../src/main/workspace-service';
import type { WorkspaceOperation, WorkspaceSnapshot } from '../src/shared/workspace-contracts';

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
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await service.snapshot()).projects).toEqual([first, second]);
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
