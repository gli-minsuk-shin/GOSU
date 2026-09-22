import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  SetSshAgentNoteInputSchema,
  SshAgentNotesSchema,
  emptySshAgentNotes,
  type SshAgentNotes,
} from '../shared/ssh-agent-notes-contracts';

/** Notes for the AI per registered SSH server. Plain user text; never credentials or host data. */
export class SshAgentNotesStore {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(): Promise<SshAgentNotes> {
    try {
      return SshAgentNotesSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptySshAgentNotes();
      // A damaged file is never replaced by an empty one: the user's text may still be recoverable.
      throw new Error('ssh_agent_notes_unreadable', { cause: error });
    }
  }

  // async, so that invalid input rejects like every other failure instead of throwing at the call.
  async set(input: unknown): Promise<SshAgentNotes> {
    const command = SetSshAgentNoteInputSchema.parse(input);
    const text = command.text.trim();
    return this.write((current) => {
      const notes = { ...current.notes };
      if (text) notes[command.connectionId] = { text, updatedAt: this.now().toISOString() };
      else delete notes[command.connectionId];
      return { version: 1, notes };
    });
  }

  /** Forgets notes of servers that were removed; called with the ids that still exist. */
  prune(existingConnectionIds: readonly string[]): Promise<SshAgentNotes> {
    const existing = new Set(existingConnectionIds);
    return this.write((current) => ({
      version: 1,
      notes: Object.fromEntries(Object.entries(current.notes).filter(([id]) => existing.has(id))),
    }));
  }

  private write(change: (current: SshAgentNotes) => SshAgentNotes): Promise<SshAgentNotes> {
    const operation = this.pending
      .catch(() => undefined)
      .then(async () => {
        const current = await this.get();
        const next = SshAgentNotesSchema.parse(change(current));
        if (JSON.stringify(next) === JSON.stringify(current)) return current;
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
          await rename(temporary, this.path);
        } finally {
          await rm(temporary, { force: true });
        }
        return next;
      });
    this.pending = operation;
    return operation;
  }
}
