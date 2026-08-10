import { z } from 'zod';

export const ResearchNotesTimestampSchema = z.string().datetime({ offset: true });
const nullableBoundedText = (maximum: number) => z.string().trim().min(1).max(maximum).nullable();

function containsControlCharacter(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 31 || codePoint === 127;
  });
}

export const ResearchNotesRelatedDocumentSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine((value) => {
    const segments = value.split('/');
    return (
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      !value.includes('?') &&
      !value.includes('#') &&
      value.toLowerCase().endsWith('.md') &&
      segments.every(
        (segment) =>
          segment.length > 0 &&
          segment !== '.' &&
          segment !== '..' &&
          !containsControlCharacter(segment),
      )
    );
  }, 'Related documents must be safe project-relative Markdown paths');

export const ResearchNotesRelatedPaperSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '';
    } catch {
      return false;
    }
  }, 'Related paper links must be credential-free HTTPS URLs');

export const ResearchNotesProvenanceValueSchema = z.union([
  z.string().max(2_048),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const ResearchNotesDocumentEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(2),
    documentId: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^[\p{L}\p{N}][\p{L}\p{N}._:/-]*$/u),
    kind: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9][a-z0-9-]*$/u),
    managed: z.boolean(),
    createdAt: ResearchNotesTimestampSchema,
    modifiedAt: ResearchNotesTimestampSchema,
    tags: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(120)
          .refine((value) => !/[\r\n\0]/u.test(value)),
      )
      .max(64),
    projectId: z.string().uuid(),
    projectName: z.string().trim().min(1).max(160),
    origin: z.enum(['project-workspace', 'literature-library', 'project-chat', 'lecture-studio']),
    originSessionId: z.string().uuid().nullable(),
    originSessionName: nullableBoundedText(256),
    creatorId: nullableBoundedText(512),
    creatorName: nullableBoundedText(256),
    relatedDocuments: z.array(ResearchNotesRelatedDocumentSchema).max(128),
    relatedPapers: z.array(ResearchNotesRelatedPaperSchema).max(128),
    provenance: z
      .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u), ResearchNotesProvenanceValueSchema)
      .refine((value) => Object.keys(value).length <= 64, 'Provenance has too many fields'),
  })
  .strict()
  .superRefine((document, context) => {
    if (Date.parse(document.modifiedAt) < Date.parse(document.createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['modifiedAt'],
        message: 'modifiedAt cannot precede createdAt',
      });
    }
    for (const [path, values] of [
      ['tags', document.tags],
      ['relatedDocuments', document.relatedDocuments],
      ['relatedPapers', document.relatedPapers],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: 'custom',
          path: [path],
          message: `${path} must not contain duplicates`,
        });
      }
    }
    if (
      (document.originSessionId === null) !== (document.originSessionName === null) &&
      document.origin === 'project-chat'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['originSessionId'],
        message: 'Project Chat documents require both session ID and session name',
      });
    }
    if (
      document.origin !== 'project-chat' &&
      (document.originSessionId !== null || document.originSessionName !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['originSessionId'],
        message: 'Only Project Chat documents can claim an originating project session',
      });
    }
  });

export type ResearchNotesDocumentEnvelope = z.infer<typeof ResearchNotesDocumentEnvelopeSchema>;
