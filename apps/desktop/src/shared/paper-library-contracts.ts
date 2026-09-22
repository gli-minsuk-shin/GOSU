import { z } from 'zod';

/** What the project Literature view needs to show and import a saved paper summary. */
export const PAPER_LIBRARY_IPC_CHANNELS = {
  list: 'gosu:paper-summary:list',
  importToLiterature: 'gosu:paper-summary:import-to-literature',
} as const;

export const PAPER_LIBRARY_MAX_ENTRIES = 1_000;
export const PAPER_LIBRARY_MAX_IMPORT = 50;

const paperIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const PaperLibraryEntrySchema = z
  .object({
    id: paperIdSchema,
    title: z.string().trim().min(1).max(240),
    authors: z.array(z.string().trim().min(1).max(300)).max(30),
    venue: z.string().trim().max(1_000).nullable(),
    year: z.number().int().min(1000).max(3000).nullable(),
    sourceUrl: z
      .string()
      .url()
      .max(2_000)
      .refine((value) => value.startsWith('https://')),
    savedAt: z.string().datetime(),
    summary: z.string().trim().max(600),
    keywords: z.array(z.string().trim().min(1).max(80)).max(6),
    tags: z.array(z.string().trim().min(1).max(48)).max(3),
  })
  .strict();

export const PaperLibraryListSchema = z
  .object({
    entries: z.array(PaperLibraryEntrySchema).max(PAPER_LIBRARY_MAX_ENTRIES),
    /** Saved analyses without a verified paper behind them; they carry no bibliography to import. */
    unverifiedCount: z.number().int().nonnegative(),
  })
  .strict();

export const ImportPaperSummariesInputSchema = z
  .object({
    projectId: z.string().uuid(),
    paperIds: z.array(paperIdSchema).min(1).max(PAPER_LIBRARY_MAX_IMPORT),
  })
  .strict()
  .refine((input) => new Set(input.paperIds).size === input.paperIds.length, {
    message: 'paperIds must be unique',
  });

export const ImportPaperSummariesReceiptSchema = z
  .object({
    projectId: z.string().uuid(),
    importedCount: z.number().int().nonnegative(),
    alreadySavedCount: z.number().int().nonnegative(),
    missingCount: z.number().int().nonnegative(),
  })
  .strict();

export type PaperLibraryEntry = z.infer<typeof PaperLibraryEntrySchema>;
export type PaperLibraryList = z.infer<typeof PaperLibraryListSchema>;
export type ImportPaperSummariesInput = z.infer<typeof ImportPaperSummariesInputSchema>;
export type ImportPaperSummariesReceipt = z.infer<typeof ImportPaperSummariesReceiptSchema>;
