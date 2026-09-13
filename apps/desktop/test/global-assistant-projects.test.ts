import { expect, it, vi } from 'vitest';
import { createGlobalAssistantProjects } from '../src/main/global-assistant-projects';
import { LocalDatabase } from '../src/main/local-database';
vi.mock('electron', () => ({ app: {}, safeStorage: {} }));
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
it('reads Model Lab through the exact active project with scope recheck and no project work dispatch', async () => {
  const { deps, bridge, signal } = setup();
  const recheck = vi.fn(async () => undefined);
  const result = await bridge(
    'model-lab',
    a,
    JSON.stringify({ section: 'conversation', modelId: 'saved-model', revision: 2, offset: 16000 }),
    signal,
    recheck,
  );
  expect(result).toMatchObject({ projectId: a });
  expect(deps.modelLab).toHaveBeenCalledWith(a, {
    section: 'conversation',
    modelId: 'saved-model',
    revision: 2,
    offset: 16000,
  });
  expect(recheck).toHaveBeenCalledOnce();
  expect(deps.send).not.toHaveBeenCalled();
  expect(deps.remember).not.toHaveBeenCalled();
  await expect(
    bridge('model-lab', a, JSON.stringify({ path: '/private' }), signal),
  ).rejects.toThrow();
  deps.projects.mockResolvedValueOnce([]);
  await expect(bridge('model-lab', b, '', signal)).rejects.toThrow('project_unavailable');
});
it('stores confirmed memory through the existing project-scoped database and rejects credentials', () => {
  const run = vi.fn();
  const prepare = vi.fn(() => ({ run }));
  const storage = { require: () => ({ prepare }) } as unknown as LocalDatabase;
  const save = (text: string) =>
    LocalDatabase.prototype.rememberGlobalAssistantContext.call(storage, a, text);
  expect(save('Use a held-out validation set for this project.')).toBe(true);
  expect(run.mock.calls[0]?.[2]).toBe(a);
  expect(run.mock.calls[1]?.slice(0, 2)).toEqual([a, a]);
  expect(JSON.stringify(run.mock.calls)).not.toContain(b);
  run.mockClear();
  expect(save('password: super-secret-password')).toBe(false);
  expect(run).not.toHaveBeenCalled();
});
function setup() {
  const deps = {
    modelLab: vi.fn(async (projectId: string, input: unknown) => ({
      projectId,
      section: 'catalog',
      models: [],
      note: 'Saved only',
      input,
    })),
    projects: vi.fn(async () => [
      { id: a, name: 'A' },
      { id: b, name: 'B' },
    ]),
    sessions: vi.fn(async (projectId: string) => [
      { id: projectId, title: 'Session', updatedAt: '2026-09-13' },
    ]),
    read: vi.fn(async (projectId: string) => ({
      messages: [{ role: 'assistant', content: `Only ${projectId}`, createdAt: '2026-09-13' }],
    })),
    memory: vi.fn((projectId: string) => [{ projectId }]),
    remember: vi.fn(() => true),
    send: vi.fn(async () => ({ status: 'starting' })),
    confirm: vi.fn(async () => {}),
  };
  return {
    deps,
    bridge: createGlobalAssistantProjects(deps),
    signal: new AbortController().signal,
  };
}
it('lists all projects but reads one project at a time without sharing their conversations', async () => {
  const { deps, bridge, signal } = setup();
  expect(await bridge('list', '', '', signal)).toMatchObject({ projects: [{ id: a }, { id: b }] });
  const result = await bridge('read', a, '', signal);
  expect(JSON.stringify(result)).toContain(a);
  expect(JSON.stringify(result)).not.toContain(b);
  expect(deps.read).toHaveBeenCalledWith(a, a);
  expect(deps.memory).toHaveBeenCalledWith(a);
  expect(deps.send).not.toHaveBeenCalled();
  expect(deps.remember).not.toHaveBeenCalled();
  await expect(bridge('read', a, b, signal)).rejects.toThrow('session_unavailable');
});
it('shares only the confirmed target note and submits work to only that project session', async () => {
  const { deps, bridge, signal } = setup();
  expect(await bridge('remember', a, 'A decision', signal)).toMatchObject({
    saved: true,
    projectId: a,
  });
  expect(deps.confirm.mock.invocationCallOrder[0]).toBeLessThan(
    deps.remember.mock.invocationCallOrder[0]!,
  );
  expect(deps.remember).toHaveBeenCalledExactlyOnceWith(a, 'A decision');
  expect(await bridge('request', b, 'B task', signal)).toMatchObject({
    submitted: true,
    projectId: b,
  });
  expect(deps.send).toHaveBeenCalledExactlyOnceWith(b, b, expect.stringContaining('B task'));
});
it('does not write after denied consent or late cancellation', async () => {
  const { deps, bridge, signal } = setup();
  deps.confirm.mockRejectedValueOnce(new Error('denied'));
  await expect(bridge('request', a, 'change', signal)).rejects.toThrow('denied');
  const c = new AbortController();
  deps.confirm.mockImplementationOnce(async () => {
    c.abort();
  });
  await expect(bridge('remember', a, 'note', c.signal)).rejects.toThrow('source_cancelled');
  expect(deps.send).not.toHaveBeenCalled();
  expect(deps.remember).not.toHaveBeenCalled();
  await expect(
    bridge('request', a, 'change', signal, async () => {
      throw new Error('scope revoked');
    }),
  ).rejects.toThrow('scope revoked');
  expect(deps.send).not.toHaveBeenCalled();
});
it('rechecks deletion after confirmation and rejects foreign projects before reads', async () => {
  const { deps, bridge, signal } = setup();
  await expect(bridge('read', '33333333-3333-4333-8333-333333333333', '', signal)).rejects.toThrow(
    'project_unavailable',
  );
  expect(deps.read).not.toHaveBeenCalled();
  deps.confirm.mockImplementationOnce(async () => {
    deps.projects.mockResolvedValue([]);
  });
  await expect(bridge('request', a, 'change', signal)).rejects.toThrow('project_unavailable');
  expect(deps.send).not.toHaveBeenCalled();
});
