import { z } from 'zod';

export const PROJECT_CHAT_MAX_ATTACHMENTS = 5;
export const PROJECT_CHAT_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const PROJECT_CHAT_MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const PROJECT_CHAT_MAX_ATTACHMENT_UNITS = 500;
export const PROJECT_CHAT_MAX_ATTACHMENT_EXTRACTED_CHARACTERS = 60_000;
export const PROJECT_CHAT_MAX_ATTACHMENT_UNITS_PER_TOOL_CALL = 8;
export const PROJECT_CHAT_MAX_ATTACHMENT_CHARACTERS_PER_TOOL_CALL = 24_000;
export const PROJECT_CHAT_MAX_NORMALIZED_IMAGE_BYTES = 4 * 1024 * 1024;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

export const ProjectChatAttachmentFormatSchema = z.enum([
  'pdf',
  'docx',
  'pptx',
  'hwpx',
  'text',
  'markdown',
  'csv',
  'json',
  'latex',
  'png',
  'jpeg',
  'gif',
  'webp',
  'tiff',
  'bmp',
  'avif',
]);

export const ProjectChatAttachmentKindSchema = z.enum(['document', 'presentation', 'image']);

export const ProjectChatAttachmentUnitLabelSchema = z.enum([
  'page',
  'slide',
  'section',
  'part',
  'image',
]);

export const ProjectChatAttachmentSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    sessionId: uuidSchema,
    kind: ProjectChatAttachmentKindSchema,
    format: ProjectChatAttachmentFormatSchema,
    mediaType: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(255),
    byteSize: z.number().int().positive().max(PROJECT_CHAT_MAX_ATTACHMENT_BYTES),
    sha256: sha256Schema,
    unitLabel: ProjectChatAttachmentUnitLabelSchema,
    unitCount: z.number().int().positive().max(PROJECT_CHAT_MAX_ATTACHMENT_UNITS),
    extractedCharacters: z
      .number()
      .int()
      .nonnegative()
      .max(PROJECT_CHAT_MAX_ATTACHMENT_EXTRACTED_CHARACTERS),
    truncated: z.boolean(),
    textAvailable: z.boolean(),
    visualAvailable: z.boolean(),
    reconstructionNotice: z.string().trim().min(1).max(240).optional(),
    imageWidth: z.number().int().positive().max(16_384).optional(),
    imageHeight: z.number().int().positive().max(16_384).optional(),
    expiresAt: timestampSchema,
  })
  .strict()
  .superRefine((attachment, context) => {
    const imageFormats = new Set(['png', 'jpeg', 'gif', 'webp', 'tiff', 'bmp', 'avif']);
    const presentationFormats = new Set(['pptx']);
    const isImageFormat = imageFormats.has(attachment.format);
    const isImage = attachment.kind === 'image';
    const expectedKind = isImageFormat
      ? 'image'
      : presentationFormats.has(attachment.format)
        ? 'presentation'
        : 'document';
    if (attachment.kind !== expectedKind) {
      context.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'Attachment kind must match its format',
      });
    }
    if (isImage !== attachment.visualAvailable) {
      context.addIssue({
        code: 'custom',
        path: ['visualAvailable'],
        message: 'Only normalized image attachments are visual inputs',
      });
    }
    if (isImage !== (attachment.unitLabel === 'image')) {
      context.addIssue({
        code: 'custom',
        path: ['unitLabel'],
        message: 'Image attachments must use image units',
      });
    }
    const hasBothImageDimensions =
      attachment.imageWidth !== undefined && attachment.imageHeight !== undefined;
    const hasEitherImageDimension =
      attachment.imageWidth !== undefined || attachment.imageHeight !== undefined;
    if ((isImage && !hasBothImageDimensions) || (!isImage && hasEitherImageDimension)) {
      context.addIssue({
        code: 'custom',
        path: ['imageWidth'],
        message: 'Image dimensions are required only for image attachments',
      });
    }
    if (
      isImage &&
      (attachment.textAvailable ||
        attachment.extractedCharacters !== 0 ||
        attachment.unitCount !== 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['textAvailable'],
        message: 'Normalized image attachments cannot expose reconstructed text units',
      });
    }
    const expectedUnitLabel =
      attachment.format === 'pdf'
        ? 'page'
        : attachment.format === 'pptx'
          ? 'slide'
          : attachment.format === 'hwpx'
            ? 'section'
            : isImageFormat
              ? 'image'
              : 'part';
    if (attachment.unitLabel !== expectedUnitLabel) {
      context.addIssue({
        code: 'custom',
        path: ['unitLabel'],
        message: 'Attachment unit label must match its format',
      });
    }
  });

export const ChooseProjectChatAttachmentsInputSchema = z
  .object({ projectId: uuidSchema, sessionId: uuidSchema })
  .strict();

export const ReleaseProjectChatAttachmentInputSchema = z
  .object({ projectId: uuidSchema, sessionId: uuidSchema, attachmentId: uuidSchema })
  .strict();

export const ProjectChatAttachmentIdsSchema = z
  .array(uuidSchema)
  .max(PROJECT_CHAT_MAX_ATTACHMENTS)
  .refine((ids) => new Set(ids).size === ids.length, 'Attachment IDs must be unique');

export type ProjectChatAttachmentFormat = z.infer<typeof ProjectChatAttachmentFormatSchema>;
export type ProjectChatAttachmentKind = z.infer<typeof ProjectChatAttachmentKindSchema>;
export type ProjectChatAttachmentUnitLabel = z.infer<typeof ProjectChatAttachmentUnitLabelSchema>;
export type ProjectChatAttachment = z.infer<typeof ProjectChatAttachmentSchema>;
export type ChooseProjectChatAttachmentsInput = z.infer<
  typeof ChooseProjectChatAttachmentsInputSchema
>;
export type ReleaseProjectChatAttachmentInput = z.infer<
  typeof ReleaseProjectChatAttachmentInputSchema
>;

export const PROJECT_CHAT_ATTACHMENT_ACCEPTED_EXTENSIONS = [
  'pdf',
  'docx',
  'pptx',
  'hwpx',
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'tex',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'tif',
  'tiff',
  'bmp',
  'avif',
] as const;
