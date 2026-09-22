import {
  SSH_AGENT_NOTES_CHANNELS,
  SetSshAgentNoteInputSchema,
  type SshAgentNotes,
} from '../shared/ssh-agent-notes-contracts';
import type { SshAgentNotesStore } from './ssh-agent-notes-store';

export type SshAgentNotesIpcErrorCode =
  | 'invalid_ssh_agent_note'
  | 'ssh_agent_notes_unavailable'
  | 'ssh_agent_notes_unreadable'
  | 'ssh_connection_not_found';
export type SshAgentNotesIpcResult =
  | Readonly<{ ok: true; value: SshAgentNotes }>
  | Readonly<{ ok: false; error: Readonly<{ code: SshAgentNotesIpcErrorCode }> }>;

function failure(code: SshAgentNotesIpcErrorCode): SshAgentNotesIpcResult {
  return { ok: false, error: { code } };
}

function codeOf(error: unknown): SshAgentNotesIpcErrorCode {
  return error instanceof Error && error.message === 'ssh_agent_notes_unreadable'
    ? 'ssh_agent_notes_unreadable'
    : 'ssh_agent_notes_unavailable';
}

/**
 * Notes are only kept for servers that are registered right now: reading prunes the rest, and a
 * note for an unknown server is refused, so the file cannot grow from stale renderer state.
 */
export function registerSshAgentNotesIpc(
  register: (channel: string, handler: (input: unknown) => Promise<SshAgentNotesIpcResult>) => void,
  store: () => SshAgentNotesStore | undefined,
  listConnectionIds: () => Promise<readonly string[]>,
) {
  register(SSH_AGENT_NOTES_CHANNELS.get, async () => {
    const current = store();
    if (!current) return failure('ssh_agent_notes_unavailable');
    try {
      return { ok: true, value: await current.prune(await listConnectionIds()) };
    } catch (error) {
      return failure(codeOf(error));
    }
  });
  register(SSH_AGENT_NOTES_CHANNELS.set, async (raw) => {
    const parsed = SetSshAgentNoteInputSchema.safeParse(raw);
    if (!parsed.success) return failure('invalid_ssh_agent_note');
    const current = store();
    if (!current) return failure('ssh_agent_notes_unavailable');
    try {
      if (!(await listConnectionIds()).includes(parsed.data.connectionId)) {
        return failure('ssh_connection_not_found');
      }
      return { ok: true, value: await current.set(parsed.data) };
    } catch (error) {
      return failure(codeOf(error));
    }
  });
}
