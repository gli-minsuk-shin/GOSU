import { describe, expect, it } from 'vitest';

import { ProjectChatServiceError } from '../src/main/project-chat-service';
import { registerWorkspaceIpc } from '../src/main/workspace-ipc';
import { WorkspaceService, type WorkspaceStorage } from '../src/main/workspace-service';
import { WorkspaceDataRecoveryError } from '../src/main/workspace-storage-error';
import { WORKSPACE_IPC_CHANNELS } from '../src/shared/workspace-channels';
import type { WorkspaceIpcResult } from '../src/shared/workspace-ipc-result';
import {
  DEFAULT_WORKSPACE_BOARD_SETTINGS,
  type WorkspaceOperation,
  type WorkspaceSnapshot,
} from '../src/shared/workspace-contracts';

class MemoryStorage implements WorkspaceStorage {
  state: WorkspaceSnapshot | null = null;
  operations: WorkspaceOperation[] = [];

  load() {
    return this.state;
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

function handlersFor(
  workspace: WorkspaceService,
  reportUnexpected?: (error: unknown) => void,
  projectChatIdleGuard?: Readonly<{
    runWhenProjectChatIdle<T>(projectId: string, operation: () => Promise<T>): Promise<T>;
  }>,
) {
  const handlers = new Map<string, (...arguments_: unknown[]) => unknown>();
  registerWorkspaceIpc(
    (channel, listener) => handlers.set(channel, listener),
    workspace,
    reportUnexpected,
    projectChatIdleGuard,
  );
  return handlers;
}

async function successful<T>(
  handler: (...arguments_: unknown[]) => unknown,
  ...arguments_: unknown[]
) {
  const result = (await handler(...arguments_)) as WorkspaceIpcResult<T>;
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function invalidBoardTemplates() {
  return [
    {
      ...DEFAULT_WORKSPACE_BOARD_SETTINGS,
      columnLabels: {
        ...DEFAULT_WORKSPACE_BOARD_SETTINGS.columnLabels,
        backlog: 'Duplicate',
        planned: ' duplicate ',
      },
    },
    {
      ...DEFAULT_WORKSPACE_BOARD_SETTINGS,
      columnOrder: ['backlog', 'backlog', 'in_progress', 'review', 'done'],
    },
    {
      ...DEFAULT_WORKSPACE_BOARD_SETTINGS,
      wipLimits: { ...DEFAULT_WORKSPACE_BOARD_SETTINGS.wipLimits, review: 0 },
    },
  ];
}

describe('workspace IPC boundary', () => {
  it('registers only the fixed workspace command surface', () => {
    const handlers = handlersFor(new WorkspaceService(new MemoryStorage()));

    expect([...handlers.keys()].sort()).toEqual(Object.values(WORKSPACE_IPC_CHANNELS).sort());
    expect([...handlers.keys()]).not.toContain('gosu:cache:get');
  });

  it('returns a bounded failure for invalid payloads without reflecting their contents', async () => {
    const handlers = handlersFor(new WorkspaceService(new MemoryStorage()));
    const createProject = handlers.get(WORKSPACE_IPC_CHANNELS.createProject)!;
    const privateText = 'too-short-private-input';

    const result = await createProject({ name: 'x', repository: privateText });

    expect(result).toEqual({ ok: false, error: { code: 'invalid_workspace_input' } });
    expect(String(result)).not.toContain(privateText);
  });

  it('returns a bounded conflict code and current version', async () => {
    const handlers = handlersFor(new WorkspaceService(new MemoryStorage()));
    const createProject = handlers.get(WORKSPACE_IPC_CHANNELS.createProject)!;
    const createTask = handlers.get(WORKSPACE_IPC_CHANNELS.createTask)!;
    const updateTask = handlers.get(WORKSPACE_IPC_CHANNELS.updateTask)!;
    const project = await successful<{ id: string }>(createProject, { name: 'IPC project' });
    const task = await successful<{ id: string; version: number }>(createTask, {
      projectId: project.id,
      title: 'Versioned task',
    });

    await successful(updateTask, {
      projectId: project.id,
      taskId: task.id,
      expectedVersion: task.version,
      status: 'planned',
    });
    const result = await updateTask({
      projectId: project.id,
      taskId: task.id,
      expectedVersion: task.version,
      status: 'done',
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'version_conflict', currentVersion: 2 },
    });
  });

  it('routes explicit versioned project rename, archive, Trash, and restore commands', async () => {
    const storage = new MemoryStorage();
    const handlers = handlersFor(new WorkspaceService(storage));
    const project = await successful<{ id: string; slug: string; version: number }>(
      handlers.get(WORKSPACE_IPC_CHANNELS.createProject)!,
      { name: 'Lifecycle IPC project' },
    );
    const renamed = await successful<{
      id: string;
      name: string;
      slug: string;
      version: number;
    }>(handlers.get(WORKSPACE_IPC_CHANNELS.renameProject)!, {
      projectId: project.id,
      expectedVersion: project.version,
      name: '  Renamed IPC project  ',
    });
    expect(renamed).toMatchObject({
      name: 'Renamed IPC project',
      slug: project.slug,
      version: 2,
    });

    const archived = await successful<{ version: number; archivedAt?: string }>(
      handlers.get(WORKSPACE_IPC_CHANNELS.setProjectArchived)!,
      { projectId: project.id, expectedVersion: renamed.version, archived: true },
    );
    expect(archived).toMatchObject({ version: 3 });
    expect(archived.archivedAt).toBeTypeOf('string');
    await expect(
      handlers.get(WORKSPACE_IPC_CHANNELS.createTask)!({
        projectId: project.id,
        title: 'Must stay out of Archive',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'project_archived' } });
    const unarchived = await successful<{ version: number; archivedAt?: string }>(
      handlers.get(WORKSPACE_IPC_CHANNELS.setProjectArchived)!,
      { projectId: project.id, expectedVersion: archived.version, archived: false },
    );
    expect(unarchived).toMatchObject({ version: 4 });
    expect(unarchived).not.toHaveProperty('archivedAt');

    const trashed = await successful<{ version: number; trashedAt?: string }>(
      handlers.get(WORKSPACE_IPC_CHANNELS.trashProject)!,
      { projectId: project.id, expectedVersion: unarchived.version },
    );
    expect(trashed).toMatchObject({ version: 5 });
    expect(trashed.trashedAt).toBeTypeOf('string');
    await expect(
      handlers.get(WORKSPACE_IPC_CHANNELS.createTask)!({
        projectId: project.id,
        title: 'Must stay out of Trash',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'project_trashed' } });
    await expect(
      handlers.get(WORKSPACE_IPC_CHANNELS.trashProject)!({
        projectId: project.id,
        expectedVersion: trashed.version,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'project_trashed' } });

    const restored = await successful<{ version: number; trashedAt?: string }>(
      handlers.get(WORKSPACE_IPC_CHANNELS.restoreProject)!,
      { projectId: project.id, expectedVersion: trashed.version },
    );
    expect(restored).toMatchObject({ version: 6 });
    expect(restored).not.toHaveProperty('trashedAt');
    await expect(
      handlers.get(WORKSPACE_IPC_CHANNELS.restoreProject)!({
        projectId: project.id,
        expectedVersion: restored.version,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'project_not_trashed' } });
    expect(storage.operations.slice(-5).map((operation) => operation.commandType)).toEqual([
      'project.rename',
      'project.archive',
      'project.unarchive',
      'project.trash',
      'project.restore',
    ]);
  });

  it('rejects malformed project lifecycle commands without reflecting input', async () => {
    const handlers = handlersFor(new WorkspaceService(new MemoryStorage()));
    const privateName = 'x-private-project-name';

    await expect(
      handlers.get(WORKSPACE_IPC_CHANNELS.renameProject)!({
        projectId: 'not-a-project-id',
        expectedVersion: 0,
        name: privateName,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_workspace_input' } });
    const result = await handlers.get(WORKSPACE_IPC_CHANNELS.trashProject)!({
      projectId: privateName,
      expectedVersion: 1,
    });
    expect(result).toEqual({ ok: false, error: { code: 'invalid_workspace_input' } });
    expect(String(result)).not.toContain(privateName);
  });

  it('returns a bounded busy result when Project Chat holds the Trash gate', async () => {
    const storage = new MemoryStorage();
    const workspace = new WorkspaceService(storage);
    const idleGuard = {
      async runWhenProjectChatIdle<T>(_projectId: string, _operation: () => Promise<T>) {
        throw new ProjectChatServiceError('chat_busy');
      },
    };
    const handlers = handlersFor(workspace, undefined, idleGuard);
    const project = await successful<{ id: string; version: number }>(
      handlers.get(WORKSPACE_IPC_CHANNELS.createProject)!,
      { name: 'Busy chat project' },
    );

    await expect(
      handlers.get(WORKSPACE_IPC_CHANNELS.trashProject)!({
        projectId: project.id,
        expectedVersion: project.version,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'chat_busy' } });
    expect((await workspace.snapshot()).projects[0]).not.toHaveProperty('trashedAt');
  });

  it('uses the Project Chat idle gate for archive transitions', async () => {
    const storage = new MemoryStorage();
    const workspace = new WorkspaceService(storage);
    const idleGuard = {
      async runWhenProjectChatIdle<T>(_projectId: string, _operation: () => Promise<T>) {
        throw new ProjectChatServiceError('chat_busy');
      },
    };
    const handlers = handlersFor(workspace, undefined, idleGuard);
    const project = await successful<{ id: string; version: number }>(
      handlers.get(WORKSPACE_IPC_CHANNELS.createProject)!,
      { name: 'Busy archive project' },
    );

    await expect(
      handlers.get(WORKSPACE_IPC_CHANNELS.setProjectArchived)!({
        projectId: project.id,
        expectedVersion: project.version,
        archived: true,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'chat_busy' } });
    expect((await workspace.snapshot()).projects[0]).not.toHaveProperty('archivedAt');
  });

  it('rejects invalid default Board templates on project creation without committing state', async () => {
    const storage = new MemoryStorage();
    const createProject = handlersFor(new WorkspaceService(storage)).get(
      WORKSPACE_IPC_CHANNELS.createProject,
    )!;

    for (const [index, board] of invalidBoardTemplates().entries()) {
      await expect(
        createProject({ name: `Invalid template ${index + 1}`, board }),
      ).resolves.toEqual({ ok: false, error: { code: 'invalid_workspace_input' } });
    }
    expect(storage.state).toBeNull();
    expect(storage.operations).toEqual([]);
  });

  it('rejects invalid Board labels, order, and WIP limits at the fixed IPC boundary', async () => {
    const storage = new MemoryStorage();
    const handlers = handlersFor(new WorkspaceService(storage));
    const project = await successful<{ id: string; version: number }>(
      handlers.get(WORKSPACE_IPC_CHANNELS.createProject)!,
      { name: 'Board validation project' },
    );
    const updateBoard = handlers.get(WORKSPACE_IPC_CHANNELS.updateBoardSettings)!;

    for (const board of invalidBoardTemplates()) {
      await expect(
        updateBoard({ projectId: project.id, expectedVersion: project.version, board }),
      ).resolves.toEqual({ ok: false, error: { code: 'invalid_workspace_input' } });
    }
    expect(storage.state).toMatchObject({ revision: 1, projects: [{ version: 1 }] });
    expect(storage.operations).toHaveLength(1);
  });

  it('routes normalized Board, metadata, archive, and restore commands without generic IPC', async () => {
    const handlers = handlersFor(new WorkspaceService(new MemoryStorage()));
    const project = await successful<{
      id: string;
      version: number;
      board: { title: string };
    }>(handlers.get(WORKSPACE_IPC_CHANNELS.createProject)!, {
      name: 'Operational Board',
      board: { ...DEFAULT_WORKSPACE_BOARD_SETTINGS, title: '  Lab default workflow  ' },
    });
    expect(project.board.title).toBe('Lab default workflow');
    const updatedProject = await successful<{ version: number; board?: { title: string } }>(
      handlers.get(WORKSPACE_IPC_CHANNELS.updateBoardSettings)!,
      {
        projectId: project.id,
        expectedVersion: project.version,
        board: { ...DEFAULT_WORKSPACE_BOARD_SETTINGS, title: '  Evaluation queue  ' },
      },
    );
    expect(updatedProject).toMatchObject({ version: 2, board: { title: 'Evaluation queue' } });

    const task = await successful<{
      id: string;
      version: number;
      labels?: readonly string[];
      priority?: string;
    }>(handlers.get(WORKSPACE_IPC_CHANNELS.createTask)!, {
      projectId: project.id,
      title: 'Track metadata',
      priority: 'urgent',
      labels: [' Reproducibility ', 'reproducibility'],
    });
    expect(task).toMatchObject({ version: 1, priority: 'urgent', labels: ['Reproducibility'] });

    const archived = await successful<{ version: number; archivedAt?: string }>(
      handlers.get(WORKSPACE_IPC_CHANNELS.setTaskArchived)!,
      {
        projectId: project.id,
        taskId: task.id,
        expectedVersion: task.version,
        archived: true,
      },
    );
    expect(archived).toMatchObject({ version: 2 });
    expect(archived.archivedAt).toBeTypeOf('string');

    const restored = await successful<{ version: number; archivedAt?: string }>(
      handlers.get(WORKSPACE_IPC_CHANNELS.setTaskArchived)!,
      {
        projectId: project.id,
        taskId: task.id,
        expectedVersion: archived.version,
        archived: false,
      },
    );
    expect(restored).toMatchObject({ version: 3 });
    expect(restored).not.toHaveProperty('archivedAt');
  });

  it('returns bounded invalid input for malformed metadata and archive payloads', async () => {
    const handlers = handlersFor(new WorkspaceService(new MemoryStorage()));
    const createTask = handlers.get(WORKSPACE_IPC_CHANNELS.createTask)!;
    const archive = handlers.get(WORKSPACE_IPC_CHANNELS.setTaskArchived)!;

    await expect(
      createTask({
        projectId: 'not-a-project-id',
        title: 'Invalid due date',
        dueDate: '2026-02-30',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_workspace_input' } });
    await expect(archive({ projectId: 'private-project-value', archived: true })).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_workspace_input' },
    });
  });

  it('exposes a bounded pending summary instead of operation payloads', async () => {
    const handlers = handlersFor(new WorkspaceService(new MemoryStorage()));
    await successful(handlers.get(WORKSPACE_IPC_CHANNELS.createProject)!, {
      name: 'Summary project',
    });

    const summary = await successful<{
      count: number;
      latestWorkspaceRevision: number | null;
    }>(handlers.get(WORKSPACE_IPC_CHANNELS.pendingSummary)!);

    expect(summary).toEqual({ count: 1, latestWorkspaceRevision: 1 });
    expect(Object.keys(summary)).toEqual(['count', 'latestWorkspaceRevision']);
  });

  it('keeps a valid snapshot available when the pending summary needs recovery', async () => {
    const workspace = new WorkspaceService({
      load: () => ({ schemaVersion: 1, revision: 0, projects: [], tasks: [], objectives: [] }),
      commit: () => undefined,
      pendingChanges: () => [],
      pendingSummary: () => ({ count: 1, latestWorkspaceRevision: null }),
    });
    const handlers = handlersFor(workspace);

    await expect(
      successful<WorkspaceSnapshot>(handlers.get(WORKSPACE_IPC_CHANNELS.snapshot)!),
    ).resolves.toMatchObject({ revision: 0 });
    await expect(handlers.get(WORKSPACE_IPC_CHANNELS.pendingSummary)!()).resolves.toEqual({
      ok: false,
      error: { code: 'workspace_data_requires_recovery' },
    });
  });

  it('classifies persisted snapshot validation failures as recovery errors', async () => {
    const workspace = new WorkspaceService({
      load: () => ({
        schemaVersion: 1,
        revision: -1,
        projects: [],
        tasks: [],
        objectives: [],
      }),
      commit: () => undefined,
      pendingChanges: () => [],
      pendingSummary: () => ({ count: 0, latestWorkspaceRevision: null }),
    });
    const createProject = handlersFor(workspace).get(WORKSPACE_IPC_CHANNELS.createProject)!;

    await expect(createProject({ name: 'Valid command' })).resolves.toEqual({
      ok: false,
      error: { code: 'workspace_data_requires_recovery' },
    });
  });

  it('returns a recovery code for an outbox recovery boundary', async () => {
    const workspace = new WorkspaceService({
      load: () => ({ schemaVersion: 1, revision: 0, projects: [], tasks: [], objectives: [] }),
      commit: () => undefined,
      pendingChanges: () => [],
      pendingSummary: () => {
        throw new WorkspaceDataRecoveryError();
      },
    });
    const pendingSummary = handlersFor(workspace).get(WORKSPACE_IPC_CHANNELS.pendingSummary)!;

    await expect(pendingSummary()).resolves.toEqual({
      ok: false,
      error: { code: 'workspace_data_requires_recovery' },
    });
  });

  it('reports storage failures once without rejecting or exposing local paths', async () => {
    const workspace = new WorkspaceService({
      load: () => {
        throw new Error('/private/local/path/gosu.db could not be opened');
      },
      commit: () => undefined,
      pendingChanges: () => [],
      pendingSummary: () => ({ count: 0, latestWorkspaceRevision: null }),
    });
    const reported: unknown[] = [];
    const snapshot = handlersFor(workspace, (error) => reported.push(error)).get(
      WORKSPACE_IPC_CHANNELS.snapshot,
    )!;

    const result = await snapshot();

    expect(result).toEqual({ ok: false, error: { code: 'workspace_unavailable' } });
    expect(String(result)).not.toContain('/private/local/path');
    expect(reported).toHaveLength(1);
  });

  it('keeps diagnostic reporter failures out of the IPC response', async () => {
    const workspace = new WorkspaceService({
      load: () => {
        throw new Error('storage_failure');
      },
      commit: () => undefined,
      pendingChanges: () => [],
      pendingSummary: () => ({ count: 0, latestWorkspaceRevision: null }),
    });
    const snapshot = handlersFor(workspace, () => {
      throw new Error('reporter_failure');
    }).get(WORKSPACE_IPC_CHANNELS.snapshot)!;

    await expect(snapshot()).resolves.toEqual({
      ok: false,
      error: { code: 'workspace_unavailable' },
    });
  });
});
