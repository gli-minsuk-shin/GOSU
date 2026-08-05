import { z } from 'zod';

export const PROJECT_CHAT_MAX_PDF_ATTACHMENTS = 3;
export const PROJECT_CHAT_MAX_PDF_BYTES = 20 * 1024 * 1024;
export const PROJECT_CHAT_MAX_PDF_PAGES = 200;
export const PROJECT_CHAT_MAX_PDF_EXTRACTED_CHARACTERS = 60_000;
export const PROJECT_CHAT_MAX_PDF_PAGES_PER_TOOL_CALL = 8;
export const PROJECT_CHAT_MAX_PDF_CHARACTERS_PER_TOOL_CALL = 24_000;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

export const ProjectChatPdfAttachmentSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    sessionId: uuidSchema,
    kind: z.literal('pdf'),
    displayName: z.string().trim().min(1).max(255),
    byteSize: z.number().int().positive().max(PROJECT_CHAT_MAX_PDF_BYTES),
    sha256: sha256Schema,
    pageCount: z.number().int().positive().max(PROJECT_CHAT_MAX_PDF_PAGES),
    extractedCharacters: z
      .number()
      .int()
      .nonnegative()
      .max(PROJECT_CHAT_MAX_PDF_EXTRACTED_CHARACTERS),
    truncated: z.boolean(),
    textAvailable: z.boolean(),
    expiresAt: timestampSchema,
  })
  .strict();

export const ChooseProjectChatPdfAttachmentsInputSchema = z
  .object({ projectId: uuidSchema, sessionId: uuidSchema })
  .strict();

export const ReleaseProjectChatPdfAttachmentInputSchema = z
  .object({ projectId: uuidSchema, sessionId: uuidSchema, attachmentId: uuidSchema })
  .strict();

export const ProjectChatPdfAttachmentIdsSchema = z
  .array(uuidSchema)
  .max(PROJECT_CHAT_MAX_PDF_ATTACHMENTS)
  .refine((ids) => new Set(ids).size === ids.length, 'Attachment IDs must be unique');

export type ProjectChatPdfAttachment = z.infer<typeof ProjectChatPdfAttachmentSchema>;
export type ChooseProjectChatPdfAttachmentsInput = z.infer<
  typeof ChooseProjectChatPdfAttachmentsInputSchema
>;
export type ReleaseProjectChatPdfAttachmentInput = z.infer<
  typeof ReleaseProjectChatPdfAttachmentInputSchema
>;
