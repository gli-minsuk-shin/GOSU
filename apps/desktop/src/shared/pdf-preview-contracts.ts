import { z } from 'zod';

const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const sha256DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

/**
 * Neutral, ephemeral PDF payload rendered by the sandboxed desktop Renderer.
 *
 * The bytes are intentionally not a filesystem path: Main validates and bounds the
 * generated document, then the sandboxed Renderer consumes only this opaque receipt.
 */
export const PdfPreviewDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    artifactId: uuidSchema,
    title: z.string().trim().min(1).max(256),
    fileName: z
      .string()
      .trim()
      .min(5)
      .max(256)
      .regex(/^[^/\\]+\.pdf$/iu),
    compilerDisplayName: z.string().trim().min(1).max(128),
    sourceDescription: z.string().trim().min(1).max(512),
    pdfSha256: sha256DigestSchema,
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(32 * 1024 * 1024),
    compiledAt: isoDateTimeSchema,
    pdfBase64: z
      .string()
      .min(8)
      .max(45 * 1024 * 1024),
  })
  .strict();

export type PdfPreviewDocument = z.infer<typeof PdfPreviewDocumentSchema>;
