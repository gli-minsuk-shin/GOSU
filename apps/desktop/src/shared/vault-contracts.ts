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
