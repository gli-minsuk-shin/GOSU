import { z } from 'zod';

export const ReadVaultAttachmentInputSchema = z
  .object({
    notePath: z.string().trim().min(1).max(1_000),
    source: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type ReadVaultAttachmentInput = z.input<typeof ReadVaultAttachmentInputSchema>;

export type VaultAttachment = Readonly<{
  path: string;
  mimeType: string;
  dataBase64: string;
}>;

export type VaultSelection = Readonly<{
  id: string;
  name: string;
  root: string;
  files: string[];
}>;

export type AgentVaultNoteSummary = Readonly<{
  noteId: string;
  title: string;
}>;

export type AgentVaultNoteList = Readonly<{
  notes: AgentVaultNoteSummary[];
  truncated: boolean;
}>;

export type AgentVaultNoteChunk = Readonly<{
  noteId: string;
  title: string;
  content: string;
  contentSha256: string;
  offset: number;
  nextOffset: number | null;
  totalCharacters: number;
  truncated: boolean;
}>;
