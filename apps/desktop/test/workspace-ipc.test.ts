import { describe, expect, it } from 'vitest';

import { registerWorkspaceIpc } from '../src/main/workspace-ipc';
import { WorkspaceService, type WorkspaceStorage } from '../src/main/workspace-service';
import { WorkspaceDataRecoveryError } from '../src/main/workspace-storage-error';
import { WORKSPACE_IPC_CHANNELS } from '../src/shared/workspace-channels';
import type { WorkspaceIpcResult } from '../src/shared/workspace-ipc-result';
import type { WorkspaceOperation, WorkspaceSnapshot } from '../src/shared/workspace-contracts';

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

function handlersFor(workspace: WorkspaceService, reportUnexpected?: (error: unknown) => void) {
  const handlers = new Map<string, (...arguments_: unknown[]) => unknown>();
  registerWorkspaceIpc(
    (channel, listener) => handlers.set(channel, listener),
    workspace,
    reportUnexpected,
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
