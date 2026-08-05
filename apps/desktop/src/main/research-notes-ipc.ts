import { ZodError } from 'zod';

import { RESEARCH_NOTES_IPC_CHANNELS } from '../shared/research-notes-channels';
import {
  CreateResearchPaperNoteInputSchema,
  ReadResearchNoteAttachmentInputSchema,
  ReadResearchNoteInputSchema,
  ResearchNotesProjectInputSchema,
} from '../shared/research-notes-contracts';
import type { ResearchNotesIpcResult } from '../shared/research-notes-ipc-result';
import { ResearchNotesServiceError, type ResearchNotesService } from './research-notes-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;
type InputSchema<T> = Readonly<{
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}>;

export function registerResearchNotesIpc(
  register: RegisterHandler,
  service: ResearchNotesService,
  chooseVault: (projectId: string) => Promise<unknown>,
  reportUnexpected: (error: unknown) => void = () => undefined,
) {
  register(RESEARCH_NOTES_IPC_CHANNELS.current, (input) =>
    withInput(
      input,
      ResearchNotesProjectInputSchema,
      (command) => service.current(command),
      reportUnexpected,
    ),
  );
  register(RESEARCH_NOTES_IPC_CHANNELS.chooseVault, (input) =>
    withInput(
      input,
      ResearchNotesProjectInputSchema,
      (command) => chooseVault(command.projectId),
      reportUnexpected,
    ),
  );
  register(RESEARCH_NOTES_IPC_CHANNELS.read, (input) =>
    withInput(
      input,
      ReadResearchNoteInputSchema,
      (command) => service.read(command),
      reportUnexpected,
    ),
  );
  register(RESEARCH_NOTES_IPC_CHANNELS.readAttachment, (input) =>
    withInput(
      input,
      ReadResearchNoteAttachmentInputSchema,
      (command) => service.readAttachment(command),
      reportUnexpected,
    ),
  );
  register(RESEARCH_NOTES_IPC_CHANNELS.syncLiterature, (input) =>
    withInput(
      input,
      ResearchNotesProjectInputSchema,
      async (command) => ({ syncedAt: await service.syncLiterature(command.projectId) }),
      reportUnexpected,
    ),
  );
  register(RESEARCH_NOTES_IPC_CHANNELS.createPaperNote, (input) =>
    withInput(
      input,
      CreateResearchPaperNoteInputSchema,
      (command) => service.createPaperNote(command),
      reportUnexpected,
    ),
  );
}

function withInput<TInput, TOutput>(
  input: unknown,
  schema: InputSchema<TInput>,
  operation: (input: TInput) => Promise<TOutput>,
  reportUnexpected: (error: unknown) => void,
): Promise<ResearchNotesIpcResult<TOutput>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return Promise.resolve({ ok: false, error: { code: 'invalid_research_notes_input' } });
  }
  return safely(() => operation(parsed.data), reportUnexpected);
}

async function safely<T>(
  operation: () => Promise<T>,
  reportUnexpected: (error: unknown) => void,
): Promise<ResearchNotesIpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (error instanceof ResearchNotesServiceError) {
      return { ok: false, error: { code: error.code } };
    }
    if (error instanceof ZodError) {
      return { ok: false, error: { code: 'invalid_research_notes_input' } };
    }
    try {
      reportUnexpected(error);
    } catch {
      // Diagnostics must not reject a bounded IPC response.
    }
    return { ok: false, error: { code: 'research_notes_unavailable' } };
  }
}
