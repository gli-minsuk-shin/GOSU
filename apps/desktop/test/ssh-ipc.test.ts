import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { registerSshIpc } from '../src/main/ssh-ipc';
import {
  SshConnectionServiceError,
  type SshConnectionService,
} from '../src/main/ssh-connection-service';
import { SSH_IPC_CHANNELS } from '../src/shared/ssh-channels';
import { unwrapSshIpcResult } from '../src/shared/ssh-ipc-result';
import type { WorkspaceService } from '../src/main/workspace-service';

type Handler = (...arguments_: unknown[]) => unknown;

function registerFixture(
  service: Partial<SshConnectionService>,
  reportUnexpected = vi.fn(),
  workspace?: Partial<WorkspaceService>,
) {
  const handlers = new Map<string, Handler>();
  registerSshIpc(
    (channel, handler) => handlers.set(channel, handler),
    service as SshConnectionService,
    reportUnexpected,
    workspace as WorkspaceService | undefined,
  );
  return { handlers, reportUnexpected };
}

describe('SSH IPC boundary', () => {
  it('registers the bounded connection and approval surface', () => {
    const { handlers } = registerFixture({});
    expect([...handlers.keys()]).toEqual([
      SSH_IPC_CHANNELS.listConnections,
      SSH_IPC_CHANNELS.createConnection,
      SSH_IPC_CHANNELS.importCommand,
      SSH_IPC_CHANNELS.updateConnection,
      SSH_IPC_CHANNELS.removeConnection,
      SSH_IPC_CHANNELS.testConnection,
      SSH_IPC_CHANNELS.readResourceSnapshot,
      SSH_IPC_CHANNELS.readProjectResourceSnapshot,
      SSH_IPC_CHANNELS.listProjectResourceSnapshots,
      SSH_IPC_CHANNELS.listWorkspaceGrants,
      SSH_IPC_CHANNELS.createWorkspaceGrant,
      SSH_IPC_CHANNELS.updateWorkspaceGrant,
      SSH_IPC_CHANNELS.removeWorkspaceGrant,
      SSH_IPC_CHANNELS.resolveApproval,
      SSH_IPC_CHANNELS.cancelScope,
    ]);
  });

  it('validates the global fixed resource snapshot request before invoking Main', async () => {
    const connectionId = randomUUID();
    const readResourceSnapshot = vi.fn(async () => ({
      schemaVersion: 1 as const,
      connectionId,
      capturedAt: '2026-08-06T00:00:00.000Z',
      status: 'unavailable' as const,
      cpu: { state: 'unavailable' as const },
      memory: { state: 'unavailable' as const },
      gpu: { state: 'unavailable' as const },
      issues: ['connection_unavailable' as const],
    }));
    const { handlers } = registerFixture({ readResourceSnapshot });

    await expect(
      handlers.get(SSH_IPC_CHANNELS.readResourceSnapshot)?.({ connectionId, force: true }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      handlers.get(SSH_IPC_CHANNELS.readResourceSnapshot)?.({
        connectionId,
        force: true,
        command: 'private arbitrary command',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_ssh_input' } });
    expect(readResourceSnapshot).toHaveBeenCalledExactlyOnceWith({ connectionId, force: true });
  });

  it('passes a bounded SSH command string only to the Main-process importer', async () => {
    const importCommand = vi.fn(async () => ({
      schemaVersion: 1 as const,
      id: randomUUID(),
      label: 'Fixture GPU',
      hostAlias: 'direct-203.0.113.10-2222',
      directTarget: null,
      version: 1,
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
    }));
    const { handlers } = registerFixture({ importCommand });
    const input = {
      label: 'Fixture GPU',
      command: 'ssh -p 2222 researcher@203.0.113.10 -L 8080:localhost:8080',
    };

    await expect(handlers.get(SSH_IPC_CHANNELS.importCommand)?.(input)).resolves.toMatchObject({
      ok: true,
    });
    expect(importCommand).toHaveBeenCalledExactlyOnceWith(input);
    await expect(
      handlers.get(SSH_IPC_CHANNELS.importCommand)?.({ ...input, extra: 'not-allowed' }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_ssh_input' } });
  });

  it('authorizes every workspace grant IPC against an active project in Main', async () => {
    const projectId = randomUUID();
    const listWorkspaceGrants = vi.fn(async () => []);
    const listProjectResourceSnapshots = vi.fn(async () => []);
    const readProjectResourceSnapshot = vi.fn(async () => ({
      schemaVersion: 1 as const,
      connectionId: randomUUID(),
      capturedAt: '2026-08-06T00:00:00.000Z',
      status: 'unavailable' as const,
      cpu: { state: 'unavailable' as const },
      memory: { state: 'unavailable' as const },
      gpu: { state: 'unavailable' as const },
      issues: ['connection_unavailable' as const],
    }));
    const connectionId = randomUUID();
    const snapshot = vi.fn(async () => ({
      projects: [
        {
          id: projectId,
          name: 'Active project',
          version: 1,
        },
      ],
    }));
    const { handlers } = registerFixture(
      { listWorkspaceGrants, listProjectResourceSnapshots, readProjectResourceSnapshot },
      vi.fn(),
      // This boundary test intentionally supplies only the WorkspaceService method used by IPC.
      { snapshot } as unknown as Partial<WorkspaceService>,
    );

    await expect(
      handlers.get(SSH_IPC_CHANNELS.listWorkspaceGrants)?.({ projectId }),
    ).resolves.toEqual({ ok: true, value: [] });
    await expect(
      handlers.get(SSH_IPC_CHANNELS.listWorkspaceGrants)?.({ projectId: randomUUID() }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'ssh_workspace_project_unavailable' },
    });
    await expect(
      handlers.get(SSH_IPC_CHANNELS.listProjectResourceSnapshots)?.({
        projectId,
        force: true,
      }),
    ).resolves.toEqual({ ok: true, value: [] });
    await expect(
      handlers.get(SSH_IPC_CHANNELS.listProjectResourceSnapshots)?.({
        projectId: randomUUID(),
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'ssh_workspace_project_unavailable' },
    });
    await expect(
      handlers.get(SSH_IPC_CHANNELS.readProjectResourceSnapshot)?.({
        projectId,
        connectionId,
        force: true,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      handlers.get(SSH_IPC_CHANNELS.readProjectResourceSnapshot)?.({
        projectId: randomUUID(),
        connectionId,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'ssh_workspace_project_unavailable' },
    });
    expect(listWorkspaceGrants).toHaveBeenCalledExactlyOnceWith(projectId);
    expect(listProjectResourceSnapshots).toHaveBeenCalledExactlyOnceWith({
      projectId,
      force: true,
    });
    expect(readProjectResourceSnapshot).toHaveBeenCalledExactlyOnceWith({
      projectId,
      connectionId,
      force: true,
    });
  });

  it('validates and cancels only the declared SSH navigation scope', async () => {
    const cancelSession = vi.fn(() => 2);
    const cancelProject = vi.fn(() => 3);
    const { handlers } = registerFixture({ cancelSession, cancelProject });
    const projectId = randomUUID();
    const sessionId = randomUUID();

    await expect(
      handlers.get(SSH_IPC_CHANNELS.cancelScope)?.({ projectId, sessionId }),
    ).resolves.toEqual({ ok: true, value: { cancelled: 2 } });
    await expect(handlers.get(SSH_IPC_CHANNELS.cancelScope)?.({ projectId })).resolves.toEqual({
      ok: true,
      value: { cancelled: 3 },
    });
    await expect(
      handlers.get(SSH_IPC_CHANNELS.cancelScope)?.({ projectId, unexpected: true }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_ssh_input' } });

    expect(cancelSession).toHaveBeenCalledExactlyOnceWith(projectId, sessionId);
    expect(cancelProject).toHaveBeenCalledExactlyOnceWith(projectId);
  });

  it('rejects malformed aliases before invoking the service', async () => {
    const createConnection = vi.fn();
    const { handlers } = registerFixture({ createConnection });

    await expect(
      handlers.get(SSH_IPC_CHANNELS.createConnection)?.({
        label: 'Fixture server',
        hostAlias: 'user@fixture.invalid -o ProxyCommand=bad',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_ssh_input' } });
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('returns known service failures without leaking implementation details', async () => {
    const updateConnection = vi.fn(async () => {
      throw new SshConnectionServiceError('ssh_connection_version_conflict');
    });
    const { handlers, reportUnexpected } = registerFixture({ updateConnection });

    const result = await handlers.get(SSH_IPC_CHANNELS.updateConnection)?.({
      connectionId: randomUUID(),
      expectedVersion: 1,
      label: 'Fixture server',
      hostAlias: 'fixture-gpu',
    });
    expect(result).toEqual({
      ok: false,
      error: { code: 'ssh_connection_version_conflict' },
    });
    expect(reportUnexpected).not.toHaveBeenCalled();
  });

  it('maps unexpected private output to a generic bounded failure', async () => {
    const testConnection = vi.fn(async () => {
      throw new Error('Permission denied for /Users/researcher/.ssh/private-fixture');
    });
    const { handlers, reportUnexpected } = registerFixture({ testConnection });

    const result = await handlers.get(SSH_IPC_CHANNELS.testConnection)?.({
      connectionId: randomUUID(),
    });
    expect(result).toEqual({ ok: false, error: { code: 'ssh_unavailable' } });
    expect(JSON.stringify(result)).not.toContain('.ssh');
    expect(reportUnexpected).toHaveBeenCalledOnce();
  });

  it('unwraps only the declared result envelope and rejects unknown error text', () => {
    expect(unwrapSshIpcResult({ ok: true, value: { removed: true } })).toEqual({ removed: true });
    expect(() =>
      unwrapSshIpcResult({ ok: false, error: { code: 'private-key:/fixture/secret' } }),
    ).toThrow('ssh_unavailable');
  });
});
