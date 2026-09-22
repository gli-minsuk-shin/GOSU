import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerSshAgentNotesIpc } from '../src/main/ssh-agent-notes-ipc';
import { SshAgentNotesStore } from '../src/main/ssh-agent-notes-store';
import { SSH_AGENT_NOTES_CHANNELS } from '../src/shared/ssh-agent-notes-contracts';

const SERVER = '11111111-1111-4111-8111-111111111111';
const GONE = '22222222-2222-4222-8222-222222222222';

describe('SSH agent notes IPC', () => {
  let directory = '';
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'gosu-ssh-notes-ipc-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function fixture(store: SshAgentNotesStore | undefined, connectionIds: readonly string[]) {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    registerSshAgentNotesIpc(
      (channel, handler) => handlers.set(channel, handler),
      () => store,
      async () => connectionIds,
    );
    return {
      get: () => handlers.get(SSH_AGENT_NOTES_CHANNELS.get)!(undefined),
      set: (input: unknown) => handlers.get(SSH_AGENT_NOTES_CHANNELS.set)!(input),
    };
  }

  it('saves a note only for a registered server and forgets notes of removed servers on read', async () => {
    const store = new SshAgentNotesStore(join(directory, 'notes.json'));
    await store.set({ connectionId: GONE, text: 'left over' });
    const ipc = fixture(store, [SERVER]);

    await expect(ipc.set({ connectionId: GONE, text: 'x' })).resolves.toEqual({
      ok: false,
      error: { code: 'ssh_connection_not_found' },
    });
    await expect(ipc.set({ connectionId: SERVER, text: 'run as minsuk' })).resolves.toMatchObject({
      ok: true,
    });
    const read = (await ipc.get()) as { ok: true; value: { notes: Record<string, unknown> } };
    expect(Object.keys(read.value.notes)).toEqual([SERVER]);
  });

  it('answers with bounded codes for bad input, a missing store and an unreadable file', async () => {
    const ipc = fixture(new SshAgentNotesStore(join(directory, 'notes.json')), [SERVER]);
    await expect(ipc.set({ connectionId: SERVER, text: 'x', extra: true })).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_ssh_agent_note' },
    });
    await expect(fixture(undefined, [SERVER]).get()).resolves.toEqual({
      ok: false,
      error: { code: 'ssh_agent_notes_unavailable' },
    });
    const broken = new SshAgentNotesStore(directory);
    await expect(fixture(broken, [SERVER]).get()).resolves.toEqual({
      ok: false,
      error: { code: 'ssh_agent_notes_unreadable' },
    });
  });
});
