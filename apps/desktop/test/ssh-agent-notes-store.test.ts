import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SshAgentNotesStore } from '../src/main/ssh-agent-notes-store';

const SERVER_A = '11111111-1111-4111-8111-111111111111';
const SERVER_B = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-09-22T00:00:00.000Z';
const BELL = String.fromCharCode(7);

describe('SSH agent notes store', () => {
  let directory = '';
  let path = '';
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'gosu-ssh-notes-'));
    path = join(directory, 'nested', 'ssh-agent-notes.v1.json');
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('starts empty, keeps a trimmed note per server in a private file and survives a restart', async () => {
    const store = new SshAgentNotesStore(path, () => new Date(NOW));
    expect(await store.get()).toEqual({ version: 1, notes: {} });

    const saved = await store.set({
      connectionId: SERVER_A,
      text: `  실험은 minsuk 이름으로 실행하고 작업 이름에 minsuk을 붙여라.
`,
    });

    expect(saved.notes[SERVER_A]).toEqual({
      text: '실험은 minsuk 이름으로 실행하고 작업 이름에 minsuk을 붙여라.',
      updatedAt: NOW,
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await new SshAgentNotesStore(path).get()).toEqual(saved);
  });

  it('removes a note when the text is emptied and leaves the other servers alone', async () => {
    const store = new SshAgentNotesStore(path, () => new Date(NOW));
    await store.set({ connectionId: SERVER_A, text: 'use account minsuk' });
    await store.set({ connectionId: SERVER_B, text: 'GPU 2 and 3 only' });

    const after = await store.set({ connectionId: SERVER_A, text: '   ' });

    expect(Object.keys(after.notes)).toEqual([SERVER_B]);
  });

  it('drops notes of servers that no longer exist', async () => {
    const store = new SshAgentNotesStore(path, () => new Date(NOW));
    await store.set({ connectionId: SERVER_A, text: 'a' });
    await store.set({ connectionId: SERVER_B, text: 'b' });

    const pruned = await store.prune([SERVER_B]);

    expect(Object.keys(pruned.notes)).toEqual([SERVER_B]);
    const onDisk = JSON.parse(await readFile(path, 'utf8')) as { notes: Record<string, unknown> };
    expect(onDisk.notes[SERVER_A]).toBeUndefined();
  });

  it('refuses control characters, oversized text and unknown ids without touching the file', async () => {
    const store = new SshAgentNotesStore(path, () => new Date(NOW));
    await store.set({ connectionId: SERVER_A, text: 'kept' });

    await expect(store.set({ connectionId: SERVER_A, text: `bad${BELL}bell` })).rejects.toThrow();
    await expect(store.set({ connectionId: SERVER_A, text: 'x'.repeat(2_001) })).rejects.toThrow();
    await expect(store.set({ connectionId: 'not-a-uuid', text: 'x' })).rejects.toThrow();
    expect((await store.get()).notes[SERVER_A]?.text).toBe('kept');
  });

  it('says that the file is unreadable instead of silently starting over', async () => {
    const store = new SshAgentNotesStore(path, () => new Date(NOW));
    await store.set({ connectionId: SERVER_A, text: 'kept' });
    await writeFile(path, '{broken');

    await expect(store.get()).rejects.toThrow('ssh_agent_notes_unreadable');
    await expect(store.set({ connectionId: SERVER_B, text: 'new' })).rejects.toThrow(
      'ssh_agent_notes_unreadable',
    );
    expect(await readFile(path, 'utf8')).toBe('{broken');
  });
});
