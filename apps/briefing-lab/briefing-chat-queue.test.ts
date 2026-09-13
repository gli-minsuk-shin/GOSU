import { expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { briefingClientContext } from './briefing-client-context';
import { BriefingChatQueue } from './briefing-chat-queue';

async function fixture(
  run: (store: BriefingWorkspaceStore, queue: BriefingChatQueue, dir: string) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), 'gosu-chat-queue-'));
  try {
    await briefingClientContext.run('a'.repeat(64), async () => {
      const store = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 7));
      await store.save(
        {
          routineId: 'r',
          name: 'fixture',
          timeZone: 'Asia/Seoul',
          live: defaultLiveSettings(),
          interest: { keywords: [], excluded: [] },
          preferences: defaultAssistantPreferences(),
        },
        async () => undefined,
      );
      await run(store, new BriefingChatQueue(store, () => undefined), dir);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
it('persists FIFO, edits with revision CAS and deletes before execution; claims exactly once', async () =>
  fixture(async (store, queue, dir) => {
    const id = randomUUID(),
      second = randomUUID();
    await queue.handle('/enqueue', { routineId: 'r', id, prompt: 'first' });
    await queue.handle('/enqueue', { routineId: 'r', id: second, prompt: 'second' });
    await queue.handle('/edit', { routineId: 'r', id, revision: 0, prompt: 'edited' });
    await expect(queue.handle('/delete', { routineId: 'r', id, revision: 0 })).rejects.toThrow(
      'assistant_queue_conflict',
    );
    const restarted = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 7));
    const profile = (await restarted.profile('r'))!;
    expect((await restarted.chatQueue(profile, false)).map((q) => q.prompt)).toEqual([
      'edited',
      'second',
    ]);
    const claimed = await Promise.all([
      restarted.claimChatQueue(profile),
      restarted.claimChatQueue(profile),
    ]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
    await expect(restarted.changeChatQueue(profile, id, 2, 'delete')).rejects.toThrow(
      'assistant_queue_conflict',
    );
    await restarted.finishChatQueue(profile, id, claimed.find(Boolean)!.token!, 'uncertain');
    expect((await restarted.chatQueue(profile, false))[0]?.state).toBe('failed');
    expect((await restarted.claimChatQueue(profile))?.id).toBe(second);
    expect(await readFile(join(dir, 'workspace.v1.enc.json'), 'utf8')).not.toContain('edited');
    await expect(
      briefingClientContext.run('b'.repeat(64), () => queue.handle('/list', { routineId: 'r' })),
    ).rejects.toThrow('assistant_client_required');
  }));
it('never replays an uncertain steer, records its text and rejects native steer with attachments', async () =>
  fixture(async (store, queue) => {
    const profile = (await store.profile('r'))!,
      id = randomUUID();
    const active = queue.begin(profile, new AbortController().signal),
      steer = vi.fn().mockRejectedValue(new Error('uncertain'));
    active.onActiveTurn(steer);
    await queue.handle('/enqueue', { routineId: 'r', id, prompt: 'check assumptions' });
    await expect(queue.handle('/steer', { routineId: 'r', id, revision: 0 })).rejects.toThrow(
      'uncertain',
    );
    expect(steer).toHaveBeenCalledOnce();
    expect(await store.chatQueue(profile, true)).toEqual([]);
    expect((await store.conversation(profile))[0]?.text).toContain('check assumptions');
    await expect(queue.handle('/steer', { routineId: 'r', id, revision: 0 })).rejects.toThrow();
    expect(steer).toHaveBeenCalledOnce();
    const fileId = randomUUID(),
      qid = randomUUID();
    await store.enqueueChat(profile, qid, 'file', [fileId]);
    await expect(queue.handle('/steer', { routineId: 'r', id: qid, revision: 0 })).rejects.toThrow(
      'assistant_steer_text_only',
    );
    active.finish();
  }));
it('stop-and-next is distinct from steer and retains queued work', async () =>
  fixture(async (store, queue) => {
    const profile = (await store.profile('r'))!,
      first = randomUUID(),
      next = randomUUID();
    await store.enqueueChat(profile, first, 'first', []);
    await store.enqueueChat(profile, next, 'next', []);
    const active = queue.begin(profile, new AbortController().signal);
    await queue.handle('/next', { routineId: 'r', id: next, revision: 0 });
    expect(active.signal.aborted).toBe(true);
    active.finish();
    expect((await store.claimChatQueue(profile))?.id).toBe(next);
  }));
