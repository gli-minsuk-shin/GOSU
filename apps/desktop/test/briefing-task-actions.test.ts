import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopBriefingTaskActions } from '../src/main/briefing-task-actions';
import type { WorkspaceTask } from '../src/shared/workspace-contracts';
import type { WorkspaceService } from '../src/main/workspace-service';
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const projectId = '11111111-1111-4111-8111-111111111111';
const input = {
  routineId: 'r',
  sourceKey: 'mail:fixture',
  requestId: '22222222-2222-4222-8222-222222222222',
  projectId,
  title: 'Review the proposal',
  notes: 'Private source summary',
  dueDate: '2026-09-20',
  reminderListId: 'icloud',
};
const signal = () => new AbortController().signal;
it('persists the selected Reminders default across service restart without repeated authorization', async () => {
  const f = await fixture();
  await f.make().configure({ enabled: true, listId: 'icloud' }, signal(), async () => undefined);
  const next = await f.make().options(signal());
  expect(next.reminderDefaults).toEqual({ enabled: true, listId: 'icloud' });
  expect(
    f.native.mock.calls.every((c) => (c[0] as { action: string }).action === 'reminders_catalog'),
  ).toBe(true);
  await expect(
    f.make().configure({ enabled: true, listId: 'missing' }, signal(), async () => undefined),
  ).rejects.toThrow('list_unavailable');
  expect((await f.make().options(signal())).reminderDefaults).toEqual({
    enabled: true,
    listId: 'icloud',
  });
});
it('never stores approval when macOS authorization is absent', async () => {
  const f = await fixture();
  f.native.mockResolvedValue({ authorized: false, lists: [], defaultListId: '' });
  await expect(
    f.make().configure({ enabled: true, listId: 'icloud' }, signal(), async () => undefined),
  ).rejects.toThrow('permission_required');
  expect((await f.make().options(signal())).reminderDefaults?.enabled).toBe(false);
});
it('persists the exact timed deadline and passes it to Reminders without another model call', async () => {
  const f = await fixture();
  const timed = { ...input, dueAt: '2026-09-20T04:30:00Z' };
  await f.make().create(timed, signal(), async () => undefined);
  expect(f.tasks[0]?.dueAt).toBe(timed.dueAt);
  expect(f.native).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'reminders_create', dueAt: timed.dueAt }),
    expect.any(AbortSignal),
  );
  await f.make().create(timed, signal(), async () => undefined);
  expect(f.create).toHaveBeenCalledOnce();
  await expect(
    f.make().create({ ...timed, dueAt: '2026-09-20T05:00:00Z' }, signal(), async () => undefined),
  ).rejects.toThrow('request_changed');
});
it('creates and reuses a projectless task and exports it without creating a project', async () => {
  const f = await fixture();
  f.projects.length = 0;
  const first = await f
    .make()
    .create({ ...input, projectId: null }, signal(), async () => undefined);
  const again = await f
    .make()
    .create({ ...input, projectId: null }, signal(), async () => undefined);
  expect(first.reminderState).toBe('created');
  expect(again.taskId).toBe(first.taskId);
  expect(f.tasks[0]?.projectId).toBeNull();
  expect(f.projects).toEqual([]);
  expect(f.create).toHaveBeenCalledOnce();
  expect(f.writes()).toBe(1);
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'gosu-task-actions-'));
  dirs.push(dir);
  const tasks: WorkspaceTask[] = [],
    projects = [{ id: projectId, name: 'Research', archivedAt: undefined, trashedAt: undefined }];
  const snapshot = vi.fn(async () => structuredClone({ projects, tasks }));
  const create = vi.fn(async (command: Record<string, unknown>, id: string) => {
    const task = {
      ...command,
      id,
      version: 1,
      createdAt: '2026-09-14T00:00:00Z',
      updatedAt: '2026-09-14T00:00:00Z',
    } as WorkspaceTask;
    tasks.push(task);
    return task;
  });
  const workspace = {
    snapshot,
    createTask: create,
    refreshCommittedState: snapshot,
  } as unknown as Pick<WorkspaceService, 'snapshot' | 'createTask' | 'refreshCommittedState'>;
  const reminders = new Map<string, string>();
  let writes = 0;
  const native = vi.fn(async (raw: unknown) => {
    const q = raw as Record<string, string>;
    if (q.action !== 'reminders_create')
      return {
        authorized: true,
        lists: [{ id: 'icloud', name: 'Tasks', source: 'iCloud', writable: true }],
        defaultListId: 'icloud',
      };
    const key = `${q.listId}:${q.taskId}`,
      existing = reminders.has(key);
    if (!existing) {
      writes++;
      reminders.set(key, 'native-id');
    }
    return { id: reminders.get(key), existing };
  });
  const make = () =>
    new DesktopBriefingTaskActions(workspace, dir, native, async () => Buffer.alloc(32, 7));
  return { dir, tasks, projects, workspace, create, native, make, reminders, writes: () => writes };
}
it('creates once across concurrent clicks and restart, using exact full content rather than title alone', async () => {
  const f = await fixture(),
    service = f.make();
  const results = await Promise.all([
    service.create(input, signal(), async () => undefined),
    service.create(input, signal(), async () => undefined),
  ]);
  expect(results.map((r) => r.reminderState)).toEqual(['created', 'existing']);
  expect(f.create).toHaveBeenCalledOnce();
  expect(f.writes()).toBe(1);
  const restart = await f
    .make()
    .create(
      { ...input, requestId: '33333333-3333-4333-8333-333333333333' },
      signal(),
      async () => undefined,
    );
  expect(restart.taskId).toBe(input.requestId);
  expect(f.create).toHaveBeenCalledOnce();
  expect(f.writes()).toBe(1);
  await f.make().create(
    {
      ...input,
      requestId: '44444444-4444-4444-8444-444444444444',
      notes: 'Different exact content',
    },
    signal(),
    async () => undefined,
  );
  expect(f.create).toHaveBeenCalledTimes(2);
  expect(f.writes()).toBe(2);
  await f
    .make()
    .create(
      { ...input, sourceKey: 'mail:another', requestId: '55555555-5555-4555-8555-555555555555' },
      signal(),
      async () => undefined,
    );
  expect(f.create).toHaveBeenCalledTimes(3);
  expect(await readFile(join(f.dir, 'task-links.v1.enc.json'), 'utf8')).not.toContain(input.notes);
});
it('recovers a lost Reminders acknowledgement without creating another GOSU task or reminder', async () => {
  const f = await fixture(),
    implementation = f.native.getMockImplementation()!;
  f.native.mockImplementationOnce(async (q) => {
    await implementation(q);
    throw Error('calendar_timeout');
  });
  const service = f.make();
  expect((await service.create(input, signal(), async () => undefined)).reminderState).toBe(
    'uncertain',
  );
  expect((await service.create(input, signal(), async () => undefined)).reminderState).toBe(
    'existing',
  );
  expect(f.create).toHaveBeenCalledOnce();
  expect(f.writes()).toBe(1);
});
it('recovers durable local creation after an acknowledgement loss before writing to Reminders', async () => {
  const f = await fixture(),
    implementation = f.create.getMockImplementation()!;
  f.create.mockImplementationOnce(async (c, id) => {
    await implementation(c, id);
    throw Error('lost acknowledgement');
  });
  expect((await f.make().create(input, signal(), async () => undefined)).reminderState).toBe(
    'created',
  );
  expect(f.create).toHaveBeenCalledOnce();
  expect(f.tasks).toHaveLength(1);
});
it('does not authorize Reminders implicitly while listing options', async () => {
  const f = await fixture(),
    service = f.make();
  await service.options(signal(), false);
  expect(f.native).toHaveBeenLastCalledWith(
    { action: 'reminders_catalog' },
    expect.any(AbortSignal),
  );
  await service.options(signal(), true);
  expect(f.native).toHaveBeenLastCalledWith(
    { action: 'reminders_authorize' },
    expect.any(AbortSignal),
  );
});
it('reports partial success on denied reminder permission and supports explicit GOSU-only creation', async () => {
  const f = await fixture();
  f.native.mockRejectedValueOnce(Error('reminders_permission_required'));
  expect((await f.make().create(input, signal(), async () => undefined)).reminderState).toBe(
    'failed',
  );
  expect(f.tasks).toHaveLength(1);
  expect(
    (await f.make().create({ ...input, reminderListId: null }, signal(), async () => undefined))
      .reminderState,
  ).toBe('skipped');
  expect(f.create).toHaveBeenCalledOnce();
});
it('blocks revoked permission before writes and refuses changed payloads or archived targets', async () => {
  const f = await fixture(),
    service = f.make();
  await expect(
    service.create(input, signal(), async () => {
      throw Error('revoked');
    }),
  ).rejects.toThrow('revoked');
  expect(f.create).not.toHaveBeenCalled();
  expect(f.native).not.toHaveBeenCalled();
  await service.create(input, signal(), async () => undefined);
  await expect(
    service.create({ ...input, title: 'Changed' }, signal(), async () => undefined),
  ).rejects.toThrow('request_changed');
  f.tasks[0] = { ...f.tasks[0]!, archivedAt: '2026-09-14T01:00:00Z' };
  await expect(service.create(input, signal(), async () => undefined)).rejects.toThrow('archived');
  expect(f.writes()).toBe(1);
});
it('never exports task text edited elsewhere without reviewing the changed content', async () => {
  const f = await fixture();
  f.native.mockRejectedValueOnce(Error('reminders_permission_required'));
  const service = f.make();
  await service.create(input, signal(), async () => undefined);
  f.tasks[0] = { ...f.tasks[0]!, description: 'New confidential text' };
  await expect(service.create(input, signal(), async () => undefined)).rejects.toThrow(
    'request_changed',
  );
  expect(f.native).toHaveBeenCalledOnce();
});
