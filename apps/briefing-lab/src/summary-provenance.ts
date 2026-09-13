import { z } from 'zod';

const presentation = {
  sourceMetadataDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  feedbackProfileRevision: z.number().int().nonnegative().nullable().optional(),
  reuseBasis: z.enum(['observed-input', 'paper-version']).optional(),
  personalizationStale: z.boolean().optional(),
};
export const SummaryProvenanceSchema = z.union([
  z
    .object({
      version: z.literal(1),
      sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
      contextDigest: z.string().regex(/^[a-f0-9]{64}$/),
      summarizedAt: z.string().datetime(),
      reused: z.boolean(),
      ...presentation,
    })
    .strict(),
  // An older saved paper has no complete input proof/time. Never manufacture those fields.
  z
    .object({
      version: z.literal(2),
      sourceDigest: z.null(),
      contextDigest: z.null(),
      summarizedAt: z.null(),
      savedAt: z.string().datetime().optional(),
      reused: z.literal(true),
      ...presentation,
    })
    .strict(),
]);
export type SummaryProvenance = z.infer<typeof SummaryProvenanceSchema>;
