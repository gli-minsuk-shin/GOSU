import {
  verifiablePaperLink,
  type PaperSummaryRecord,
} from '../../../briefing-lab/src/paper-summary-contract';
import {
  ImportPaperSummariesInputSchema,
  ImportPaperSummariesReceiptSchema,
  PAPER_LIBRARY_MAX_ENTRIES,
  PaperLibraryListSchema,
  type ImportPaperSummariesInput,
  type ImportPaperSummariesReceipt,
  type PaperLibraryEntry,
  type PaperLibraryList,
} from '../shared/paper-library-contracts';

function publishedYear(publishedAt: string | undefined) {
  const year = Number(/^(\d{4})-/u.exec(publishedAt ?? '')?.[1]);
  return Number.isInteger(year) && year >= 1000 && year <= 3000 ? year : null;
}

function entryOf(record: PaperSummaryRecord): PaperLibraryEntry | null {
  const sourceUrl = record.sourceUrls[0];
  // Only a verified paper has a bibliography worth importing; a saved chat analysis does not.
  if (!record.paper || !sourceUrl || !verifiablePaperLink(sourceUrl)) return null;
  const insight = record.paper.insight;
  return {
    id: record.id,
    title: record.title.trim().slice(0, 240),
    authors: (record.paper.bibliography?.authors ?? []).slice(0, 30),
    venue: record.paper.bibliography?.venue?.trim() || null,
    year: publishedYear(record.paper.publishedAt),
    sourceUrl,
    savedAt: record.savedAt,
    summary: insight.summary.trim().slice(0, 600),
    keywords: (insight.keywords ?? []).slice(0, 6),
    tags: (insight.tags ?? []).slice(0, 3),
  };
}

/** The saved paper summaries in the shape the Literature view lists and imports. */
export function paperLibraryEntries(records: readonly PaperSummaryRecord[]): PaperLibraryList {
  const entries = records.map(entryOf);
  const verified = entries.filter((entry): entry is PaperLibraryEntry => entry !== null);
  return PaperLibraryListSchema.parse({
    entries: verified.slice(0, PAPER_LIBRARY_MAX_ENTRIES),
    unverifiedCount: entries.length - verified.length,
  });
}

type LibraryReader = Readonly<{ list(): Promise<readonly PaperSummaryRecord[]> }>;
type LiteratureWriter = Readonly<{
  addLibraryPapers(input: {
    projectId: string;
    papers: readonly PaperLibraryEntry[];
  }): Promise<{ projectId: string; importedCount: number; alreadySavedCount: number }>;
}>;

/**
 * Adds chosen saved papers to a project's Literature table. The library is read again in Main, so
 * the renderer names papers by id only and cannot supply bibliography of its own.
 */
export async function importPaperSummariesToLiterature(
  dependencies: Readonly<{ library: LibraryReader; literature: LiteratureWriter }>,
  input: ImportPaperSummariesInput,
): Promise<ImportPaperSummariesReceipt> {
  const command = ImportPaperSummariesInputSchema.parse(input);
  const chosen = new Set(command.paperIds);
  const papers = paperLibraryEntries(await dependencies.library.list()).entries.filter(({ id }) =>
    chosen.has(id),
  );
  const added =
    papers.length > 0
      ? await dependencies.literature.addLibraryPapers({ projectId: command.projectId, papers })
      : { importedCount: 0, alreadySavedCount: 0 };
  return ImportPaperSummariesReceiptSchema.parse({
    projectId: command.projectId,
    importedCount: added.importedCount,
    alreadySavedCount: added.alreadySavedCount,
    missingCount: command.paperIds.length - papers.length,
  });
}
