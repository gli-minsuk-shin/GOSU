import { z } from 'zod';

/**
 * What the user wants an AI to keep in mind on one registered SSH server, for example the name to
 * run jobs under on a shared machine. It is kept apart from the connection profile on purpose: the
 * profile's version is part of every trusted-access approval, so editing a note there would revoke
 * the user's approvals for that server.
 */
export const SSH_AGENT_NOTES_CHANNELS = {
  get: 'gosu:ssh:agent-notes:get',
  set: 'gosu:ssh:agent-notes:set',
} as const;

export const SSH_AGENT_NOTE_MAX_LENGTH = 2_000;
export const SSH_AGENT_NOTES_MAX_ENTRIES = 200;

const TAB = 9;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const DELETE = 127;
/** Line breaks and tabs belong in a note; other control characters are not text a user types. */
function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      (code < 32 && code !== TAB && code !== LINE_FEED && code !== CARRIAGE_RETURN) ||
      code === DELETE
    );
  });
}

const connectionIdSchema = z.string().uuid();
const noteTextSchema = z
  .string()
  .max(SSH_AGENT_NOTE_MAX_LENGTH)
  .refine((value) => !hasControlCharacter(value), {
    message: 'Control characters are not allowed',
  });

export const SshAgentNotesSchema = z
  .object({
    version: z.literal(1),
    notes: z.record(
      connectionIdSchema,
      z.object({ text: noteTextSchema.min(1), updatedAt: z.string().datetime() }).strict(),
    ),
  })
  .strict()
  .refine((value) => Object.keys(value.notes).length <= SSH_AGENT_NOTES_MAX_ENTRIES, {
    message: 'Too many SSH agent notes',
  });

export const SetSshAgentNoteInputSchema = z
  .object({ connectionId: connectionIdSchema, text: noteTextSchema })
  .strict();

export type SshAgentNotes = z.infer<typeof SshAgentNotesSchema>;
export type SetSshAgentNoteInput = z.infer<typeof SetSshAgentNoteInputSchema>;

export function emptySshAgentNotes(): SshAgentNotes {
  return { version: 1, notes: {} };
}
