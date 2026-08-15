import { z } from 'zod';

import {
  ManuscriptRecordSchema,
  ManuscriptRootDocumentSchema,
} from './manuscript-workspace-contracts';

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });

/** Token-free connector input. Main mints a workspace-bound credential snapshot from Settings. */
export const ImportLectureOverleafSourceInputSchema = z
  .object({
    projectId: uuidSchema,
    title: z.string().trim().min(1).max(160),
    rootDocument: ManuscriptRootDocumentSchema,
    remoteUrl: z.string().trim().min(1).max(2_048),
  })
  .strict();
export type ImportLectureOverleafSourceInput = z.infer<
  typeof ImportLectureOverleafSourceInputSchema
>;

export const LectureOverleafReadyCandidateSchema = z
  .object({
    manuscript: ManuscriptRecordSchema,
    availability: z.literal('ready'),
    checkpointId: uuidSchema,
    providerRevision: z.string().trim().min(1).max(512),
    observedAt: timestampSchema,
  })
  .strict();

/**
 * Safe renderer-facing result. Provider locators and credentials are intentionally absent. The
 * normal Lecture manuscript selection can consume `selection` without widening its source model.
 */
export const LectureOverleafSourceReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: uuidSchema,
    manuscriptId: uuidSchema,
    selection: z.object({ projectId: uuidSchema, manuscriptId: uuidSchema }).strict(),
    candidate: LectureOverleafReadyCandidateSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.selection.projectId !== receipt.projectId ||
      receipt.selection.manuscriptId !== receipt.manuscriptId ||
      receipt.candidate.manuscript.projectId !== receipt.projectId ||
      receipt.candidate.manuscript.id !== receipt.manuscriptId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['candidate'],
        message: 'The ready candidate must match the imported project and manuscript',
      });
    }
  });
export type LectureOverleafSourceReceipt = z.infer<typeof LectureOverleafSourceReceiptSchema>;
