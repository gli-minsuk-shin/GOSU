import { z } from 'zod';

export const LECTURE_STUDIO_MAX_ATTACHMENTS = 5;
export const LECTURE_STUDIO_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const LECTURE_STUDIO_MAX_ATTACHMENT_UNITS = 500;
export const LECTURE_STUDIO_MAX_ATTACHMENT_EXTRACTED_CHARACTERS = 60_000;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

export const LectureStudioAttachmentFormatSchema = z.enum(['latex', 'markdown', 'pdf']);
export const LectureStudioAttachmentUnitLabelSchema = z.enum(['part', 'page']);

/**
 * Renderer-safe metadata for one ephemeral Lecture Assistant attachment.
 *
 * Local paths and reconstructed source bodies deliberately never cross this boundary.
 */
export const LectureStudioAttachmentCardSchema = z
  .object({
    id: uuidSchema,
    displayName: z.string().trim().min(1).max(255),
    format: LectureStudioAttachmentFormatSchema,
    byteSize: z.number().int().positive().max(LECTURE_STUDIO_MAX_ATTACHMENT_BYTES),
    sha256: sha256Schema,
    unitLabel: LectureStudioAttachmentUnitLabelSchema,
    unitCount: z.number().int().positive().max(LECTURE_STUDIO_MAX_ATTACHMENT_UNITS),
    extractedCharacters: z
      .number()
      .int()
      .positive()
      .max(LECTURE_STUDIO_MAX_ATTACHMENT_EXTRACTED_CHARACTERS),
    truncated: z.boolean(),
    textAvailable: z.literal(true),
    reconstructionNotice: z.string().trim().min(1).max(240).optional(),
    expiresAt: timestampSchema,
  })
  .strict()
  .superRefine((attachment, context) => {
    const expectedUnitLabel = attachment.format === 'pdf' ? 'page' : 'part';
    if (attachment.unitLabel !== expectedUnitLabel) {
      context.addIssue({
        code: 'custom',
        path: ['unitLabel'],
        message: 'Attachment unit label must match its format',
      });
    }
  });

export const ChooseLectureStudioAttachmentsInputSchema = z
  .object({ studioId: uuidSchema })
  .strict();

export const ReleaseLectureStudioAttachmentInputSchema = z
  .object({ studioId: uuidSchema, attachmentId: uuidSchema })
  .strict();

export const LectureStudioAttachmentIdsSchema = z
  .array(uuidSchema)
  .max(LECTURE_STUDIO_MAX_ATTACHMENTS)
  .refine((ids) => new Set(ids).size === ids.length, 'Attachment IDs must be unique');

export type LectureStudioAttachmentFormat = z.infer<typeof LectureStudioAttachmentFormatSchema>;
export type LectureStudioAttachmentUnitLabel = z.infer<
  typeof LectureStudioAttachmentUnitLabelSchema
>;
export type LectureStudioAttachmentCard = z.infer<typeof LectureStudioAttachmentCardSchema>;
export type ChooseLectureStudioAttachmentsInput = z.infer<
  typeof ChooseLectureStudioAttachmentsInputSchema
>;
export type ReleaseLectureStudioAttachmentInput = z.infer<
  typeof ReleaseLectureStudioAttachmentInputSchema
>;

export const LECTURE_STUDIO_ATTACHMENT_ACCEPTED_EXTENSIONS = [
  'tex',
  'md',
  'markdown',
  'pdf',
] as const;
