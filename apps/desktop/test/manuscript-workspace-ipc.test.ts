import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { registerManuscriptWorkspaceIpc } from '../src/main/manuscript-workspace-ipc';
import {
  ManuscriptWorkspaceServiceError,
  type ManuscriptWorkspaceService,
} from '../src/main/manuscript-workspace-service';
import { MANUSCRIPT_WORKSPACE_IPC_CHANNELS } from '../src/shared/manuscript-workspace-channels';

type Handler = (...arguments_: unknown[]) => unknown;

function fixture(service: Record<string, unknown>, reportUnexpected = vi.fn()) {
  const handlers = new Map<string, Handler>();
  registerManuscriptWorkspaceIpc(
    (channel, listener) => handlers.set(channel, listener),
    service as unknown as ManuscriptWorkspaceService,
    reportUnexpected,
  );
  return { handlers, reportUnexpected };
}

describe('Manuscript workspace IPC', () => {
  it('exposes only fixed provider-neutral operations and one typed Overleaf connection command', () => {
    const { handlers } = fixture({});
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(MANUSCRIPT_WORKSPACE_IPC_CHANNELS).sort(),
    );
    expect([...handlers.keys()]).not.toContain('gosu:manuscript-workspace:git');
    expect([...handlers.keys()]).not.toContain('gosu:shell:exec');
  });

  it('rejects unsafe roots before service use and forwards only the typed connection shape', async () => {
    const create = vi.fn();
    const connectOverleafGit = vi.fn(async () => ({ schemaVersion: 1 }));
    const { handlers } = fixture({ create, connectOverleafGit });
    const projectId = randomUUID();
    const manuscriptId = randomUUID();

    await expect(
      handlers.get(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.create)?.({
        projectId,
        title: 'Paper',
        rootDocument: '../paper.tex',
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_manuscript_workspace_input' },
    });
    const command = {
      projectId,
      manuscriptId,
      expectedManuscriptVersion: 1,
      providerId: 'overleaf_git' as const,
      remoteUrl: 'https://git.overleaf.com/0123456789abcdef01234567',
      accessToken: 'token',
    };
    await expect(
      handlers.get(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.connectOverleafGit)?.({
        ...command,
        ignored: true,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_manuscript_workspace_input' },
    });
    await expect(
      handlers.get(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.connectOverleafGit)?.(command),
    ).resolves.toEqual({ ok: true, value: { schemaVersion: 1 } });
    expect(create).not.toHaveBeenCalled();
    expect(connectOverleafGit).toHaveBeenCalledExactlyOnceWith(command);
  });

  it('validates and forwards only a typed optimistic manuscript update', async () => {
    const update = vi.fn(async () => ({ schemaVersion: 1 }));
    const { handlers } = fixture({ update });
    const command = {
      projectId: randomUUID(),
      manuscriptId: randomUUID(),
      expectedVersion: 3,
      title: 'Corrected manuscript',
      rootDocument: 'paper/main.tex',
    };

    await expect(
      handlers.get(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.update)?.({
        ...command,
        rootDocument: '../private.tex',
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_manuscript_workspace_input' },
    });
    await expect(
      handlers.get(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.update)?.({ ...command, ignored: true }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_manuscript_workspace_input' },
    });
    await expect(
      handlers.get(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.update)?.(command),
    ).resolves.toEqual({ ok: true, value: { schemaVersion: 1 } });
    expect(update).toHaveBeenCalledExactlyOnceWith(command);
  });

  it('never reflects tokens or private diagnostics in a service failure', async () => {
    const secret = 'private-overleaf-token';
    const connectOverleafGit = vi.fn(async () => {
      throw new Error(`/Users/researcher/paper:${secret}`);
    });
    const { handlers, reportUnexpected } = fixture({ connectOverleafGit });
    const result = await handlers.get(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.connectOverleafGit)?.({
      projectId: randomUUID(),
      manuscriptId: randomUUID(),
      expectedManuscriptVersion: 1,
      providerId: 'overleaf_git',
      remoteUrl: 'https://git.overleaf.com/0123456789abcdef01234567',
      accessToken: secret,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'manuscript_workspace_unavailable' },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(reportUnexpected).toHaveBeenCalledOnce();
  });

  it('preserves bounded provider errors', async () => {
    const inspect = vi.fn(async () => {
      throw new ManuscriptWorkspaceServiceError('overleaf_git_auth_required');
    });
    const { handlers, reportUnexpected } = fixture({ inspect });
    const result = await handlers.get(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.inspect)?.({
      projectId: randomUUID(),
      manuscriptId: randomUUID(),
      bindingId: randomUUID(),
      expectedBindingVersion: 1,
    });

    expect(result).toEqual({ ok: false, error: { code: 'overleaf_git_auth_required' } });
    expect(reportUnexpected).not.toHaveBeenCalled();
  });
});
