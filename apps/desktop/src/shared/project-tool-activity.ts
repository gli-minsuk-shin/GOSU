import { z } from 'zod';

/** Presentation-only metadata. Raw arguments and tool content never cross this boundary. */
export const ProjectToolActivitySchema = z
  .object({
    section: z.enum(['summary', 'board', 'objective']).optional(),
    target: z.string().trim().min(1).max(240).optional(),
    query: z.string().trim().min(1).max(160).optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().nonnegative().optional(),
    counts: z
      .array(
        z
          .object({
            kind: z.enum([
              'tasks',
              'notes',
              'files',
              'characters',
              'attachments',
              'papers',
              'runs',
              'matches',
            ]),
            value: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(8)
      .optional(),
    truncated: z.boolean().optional(),
    errorCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,79}$/u)
      .optional(),
  })
  .strict();

export type ProjectToolActivity = z.infer<typeof ProjectToolActivitySchema>;

export const ProjectToolProgressMetadataSchema = z
  .object({
    activity: ProjectToolActivitySchema.optional(),
    occurredAt: z.string().datetime().optional(),
    elapsedMs: z.number().int().nonnegative().optional(),
  })
  .strict();
