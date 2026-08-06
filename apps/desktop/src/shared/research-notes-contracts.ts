import { z } from 'zod';

export const RESEARCH_NOTES_DEFAULT_FOLDERS = Object.freeze([
  'Literature',
  'Papers',
  'Experiments',
  'Project Progress',
  'Idea Development',
] as const);

export const ResearchNotesAttentionCodeSchema = z.enum([
  'folder_name_conflict',
  'folder_missing',
  'folder_ownership_changed',
  'vault_unavailable',
]);

export type ResearchNotesAttentionCode = z.infer<typeof ResearchNotesAttentionCodeSchema>;

export const ResearchNotesWorkspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().uuid(),
    projectName: z.string().trim().min(1).max(120),
    bindingId: z.string().regex(/^[0-9a-f]{64}$/u),
    vaultId: z.string().regex(/^[0-9a-f]{64}$/u),
    vaultName: z.string().trim().min(1).max(256),
    displayRoot: z.string().trim().min(1).max(1_024),
    files: z.array(z.string().trim().min(1).max(1_000)).max(5_000),
    folders: z
      .array(z.enum(RESEARCH_NOTES_DEFAULT_FOLDERS))
      .length(RESEARCH_NOTES_DEFAULT_FOLDERS.length),
    status: z.enum(['ready', 'rename-pending']),
    attentionCode: ResearchNotesAttentionCodeSchema.nullable(),
    lastLiteratureSyncAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export type ResearchNotesWorkspace = z.infer<typeof ResearchNotesWorkspaceSchema>;

export const ResearchNotesProjectInputSchema = z.object({ projectId: z.string().uuid() }).strict();

export type ResearchNotesProjectInput = z.input<typeof ResearchNotesProjectInputSchema>;

export const ReadResearchNoteInputSchema = z
  .object({
    projectId: z.string().uuid(),
    path: z.string().trim().min(1).max(1_000),
  })
  .strict();

export type ReadResearchNoteInput = z.input<typeof ReadResearchNoteInputSchema>;

export const ReadResearchNoteAttachmentInputSchema = z
  .object({
    projectId: z.string().uuid(),
    notePath: z.string().trim().min(1).max(1_000),
    source: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type ReadResearchNoteAttachmentInput = z.input<typeof ReadResearchNoteAttachmentInputSchema>;

export const CreateResearchPaperNoteInputSchema = z
  .object({
    projectId: z.string().uuid(),
    recordId: z.string().uuid(),
  })
  .strict();

export type CreateResearchPaperNoteInput = z.input<typeof CreateResearchPaperNoteInputSchema>;

export const ResearchPaperNoteReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().uuid(),
    recordId: z.string().uuid(),
    path: z.string().trim().min(1).max(1_000),
    created: z.boolean(),
  })
  .strict();

export type ResearchPaperNoteReceipt = z.infer<typeof ResearchPaperNoteReceiptSchema>;

export const RESEARCH_NOTES_IPC_ERROR_CODES = [
  'invalid_research_notes_input',
  'research_notes_project_not_found',
  'research_notes_project_unavailable',
  'research_notes_vault_not_selected',
  'research_notes_vault_changed',
  'research_notes_folder_conflict',
  'research_notes_folder_unavailable',
  'research_notes_note_not_found',
  'research_notes_record_not_found',
  'research_notes_save_commit_uncertain',
  'research_notes_markdown_too_large',
  'research_notes_unavailable',
] as const;

export type ResearchNotesIpcErrorCode = (typeof RESEARCH_NOTES_IPC_ERROR_CODES)[number];
