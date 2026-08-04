import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { registerSshIpc } from '../src/main/ssh-ipc';
import {
  SshConnectionServiceError,
  type SshConnectionService,
} from '../src/main/ssh-connection-service';
import { SSH_IPC_CHANNELS } from '../src/shared/ssh-channels';
import { unwrapSshIpcResult } from '../src/shared/ssh-ipc-result';

type Handler = (...arguments_: unknown[]) => unknown;

function registerFixture(service: Partial<SshConnectionService>, reportUnexpected = vi.fn()) {
  const handlers = new Map<string, Handler>();
  registerSshIpc(
    (channel, handler) => handlers.set(channel, handler),
    service as SshConnectionService,
    reportUnexpected,
  );
  return { handlers, reportUnexpected };
}

describe('SSH IPC boundary', () => {
  it('registers the bounded connection and approval surface', () => {
    const { handlers } = registerFixture({});
    expect([...handlers.keys()]).toEqual([
      SSH_IPC_CHANNELS.listConnections,
      SSH_IPC_CHANNELS.createConnection,
      SSH_IPC_CHANNELS.updateConnection,
      SSH_IPC_CHANNELS.removeConnection,
      SSH_IPC_CHANNELS.testConnection,
      SSH_IPC_CHANNELS.resolveApproval,
      SSH_IPC_CHANNELS.cancelScope,
    ]);
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
