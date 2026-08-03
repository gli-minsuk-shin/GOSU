import { describe, expect, it } from 'vitest';

import { registerWorkspaceIpc } from '../src/main/workspace-ipc';
import { WorkspaceService, type WorkspaceStorage } from '../src/main/workspace-service';
import { WORKSPACE_IPC_CHANNELS } from '../src/shared/workspace-channels';
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

function handlersFor(workspace: WorkspaceService) {
  const handlers = new Map<string, (...arguments_: unknown[]) => unknown>();
  registerWorkspaceIpc((channel, listener) => handlers.set(channel, listener), workspace);
  return handlers;
}

describe('workspace IPC boundary', () => {
  it('registers only the fixed workspace command surface', () => {
    const handlers = handlersFor(new WorkspaceService(new MemoryStorage()));

    expect([...handlers.keys()].sort()).toEqual(Object.values(WORKSPACE_IPC_CHANNELS).sort());
    expect([...handlers.keys()]).not.toContain('gosu:cache:get');
  });

  it('rejects invalid renderer payloads without reflecting their contents', async () => {
    const handlers = handlersFor(new WorkspaceService(new MemoryStorage()));
    const createProject = handlers.get(WORKSPACE_IPC_CHANNELS.createProject)!;
    const privateText = 'too-short-private-input';

    const error = await Promise.resolve(
      createProject({ name: 'x', repository: privateText }),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: 'invalid_workspace_input' });
    expect(String(error)).not.toContain(privateText);
  });

  it('returns a bounded conflict code and current version', async () => {
    const handlers = handlersFor(new WorkspaceService(new MemoryStorage()));
    const createProject = handlers.get(WORKSPACE_IPC_CHANNELS.createProject)!;
    const createTask = handlers.get(WORKSPACE_IPC_CHANNELS.createTask)!;
    const updateTask = handlers.get(WORKSPACE_IPC_CHANNELS.updateTask)!;
    const project = (await createProject({ name: 'IPC project' })) as { id: string };
    const task = (await createTask({ projectId: project.id, title: 'Versioned task' })) as {
      id: string;
      version: number;
    };

    await updateTask({
      projectId: project.id,
      taskId: task.id,
      expectedVersion: task.version,
      status: 'planned',
    });
    const error = await Promise.resolve(
      updateTask({
        projectId: project.id,
        taskId: task.id,
        expectedVersion: task.version,
        status: 'done',
      }),
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: 'version_conflict:2' });
  });

  it('exposes a bounded pending summary instead of operation payloads', async () => {
    const handlers = handlersFor(new WorkspaceService(new MemoryStorage()));
    await handlers.get(WORKSPACE_IPC_CHANNELS.createProject)!({ name: 'Summary project' });

    const summary = await handlers.get(WORKSPACE_IPC_CHANNELS.pendingSummary)!();

    expect(summary).toEqual({ count: 1, latestWorkspaceRevision: 1 });
    expect(Object.keys(summary as object)).toEqual(['count', 'latestWorkspaceRevision']);
  });

  it('keeps a valid snapshot available when the pending summary is invalid', async () => {
    const workspace = new WorkspaceService({
      load: () => ({ schemaVersion: 1, revision: 0, projects: [], tasks: [], objectives: [] }),
      commit: () => undefined,
      pendingChanges: () => [],
      pendingSummary: () => ({ count: 1, latestWorkspaceRevision: null }),
    });
    const handlers = handlersFor(workspace);

    await expect(handlers.get(WORKSPACE_IPC_CHANNELS.snapshot)!()).resolves.toMatchObject({
      revision: 0,
    });
    await expect(handlers.get(WORKSPACE_IPC_CHANNELS.pendingSummary)!()).rejects.toMatchObject({
      message: 'invalid_workspace_input',
    });
  });

  it('does not expose storage failures or local paths', async () => {
    const workspace = new WorkspaceService({
      load: () => {
        throw new Error('/private/local/path/gosu.db could not be opened');
      },
      commit: () => undefined,
      pendingChanges: () => [],
      pendingSummary: () => ({ count: 0, latestWorkspaceRevision: null }),
    });
    const snapshot = handlersFor(workspace).get(WORKSPACE_IPC_CHANNELS.snapshot)!;

    const error = await Promise.resolve(snapshot()).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: 'workspace_unavailable' });
    expect(String(error)).not.toContain('/private/local/path');
  });
});
