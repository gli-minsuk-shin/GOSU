import { z } from 'zod';
import { EmailPreparedActionsSchema } from './email-prepared-actions';
import { compareEmails } from './email-presentation';
export const BriefingMemoryEntrySchema = z
  .object({
    id: z.string().max(128),
    routineId: z.string().max(128),
    kind: z.enum(['preference', 'feedback', 'project', 'finding']),
    text: z.string().trim().min(1).max(4000),
    sourceId: z.string().max(256),
    createdAt: z.string().datetime(),
  })
  .strict();
export type BriefingMemoryEntry = z.infer<typeof BriefingMemoryEntrySchema>;
export const BriefingMemorySchema = z
  .object({ version: z.literal(1), entries: z.array(BriefingMemoryEntrySchema).max(300) })
  .strict();
export type BriefingMemory = z.infer<typeof BriefingMemorySchema>;
export function rememberBriefingEntry(
  memory: BriefingMemory,
  entry: BriefingMemoryEntry,
): BriefingMemory {
  const entries = memory.entries.filter(
    (item) =>
      !(
        item.routineId === entry.routineId &&
        item.sourceId === entry.sourceId &&
        item.kind === entry.kind
      ),
  );
  if (entries.length >= 300)
    throw new Error(
      'Memory가 300개에 도달했습니다. 보존할 항목을 확인하고 불필요한 기억을 삭제해주세요. 기존 기억은 지우지 않았습니다.',
    );
  return BriefingMemorySchema.parse({ version: 1, entries: [...entries, entry] });
}
export const PaperInsightSchema = z
  .object({
    preparedActions: EmailPreparedActionsSchema.nullable().optional(),
    id: z.string().max(160),
    summary: z.string().min(1).max(1400),
    keywords: z.array(z.string().trim().min(1).max(80)).max(6).optional(),
    tags: z.array(z.string().trim().min(1).max(48)).max(3).optional(),
    detail: z.string().max(6000).optional(),
    // Optional only so older encrypted history remains readable. Fresh paper
    // generations are checked separately against the five-section contract.
    researchQuestion: z.string().max(1200).optional(),
    strengths: z.string().max(1600).optional(),
    limitations: z.string().max(1600).optional(),
    methodsAndAssumptions: z.string().max(2200).optional(),
    reportedResults: z.string().max(2200).optional(),
    importance: z.enum(['high', 'medium', 'low', 'uncertain']),
    importanceReason: z.string().max(600),
    relevance: z.string().max(900),
    action: z.string().max(400),
    evidenceQuote: z.string().min(1).max(350),
    equationIds: z.array(z.string().max(160)).max(4),
    equationExplanations: z
      .array(
        z
          .object({ equationId: z.string().max(160), explanation: z.string().min(1).max(600) })
          .strict(),
      )
      .max(4)
      .optional(),
    figureIds: z.array(z.string().max(160)).max(2),
    memorySuggestion: z.string().max(500).nullable(),
  })
  .strict();
export type PaperInsight = z.infer<typeof PaperInsightSchema>;
export const PAPER_TEMPLATE_FIELDS = [
  'researchQuestion',
  'strengths',
  'limitations',
  'methodsAndAssumptions',
  'reportedResults',
] as const;
export const BriefingInsightSchema = z
  .object({ overview: z.string().max(800), items: z.array(PaperInsightSchema).max(15) })
  .strict();
export type BriefingInsight = z.infer<typeof BriefingInsightSchema>;
// Provider strict structured output requires every property, including paper-only fields.
// Email supplies empty strings for those fields; the legacy/history reader stays optional.
export const BriefingGenerationSchema = BriefingInsightSchema.extend({
  items: z.array(PaperInsightSchema.omit({ tags: true, preparedActions: true }).required()).max(15),
});
export function prioritizeBriefingItems<
  T extends { id: string; kind?: string; publishedAt?: string },
>(items: readonly T[], insight: BriefingInsight | null): T[] {
  const priority = { high: 0, medium: 1, uncertain: 2, low: 3 };
  const rank = (item: T) => {
    const found = insight?.items.find((i) => i.id === item.id);
    if (item.kind === 'papers')
      return found ? { high: 0, medium: 1, low: 2, uncertain: 3 }[found.importance] : 4;
    return found ? priority[found.importance] : 4;
  };
  return [...items].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.kind === 'email' && b.kind === 'email'
        ? compareEmails({ receivedAt: a.publishedAt }, { receivedAt: b.publishedAt })
        : 0),
  );
}
export const BriefingProjectContextSchema = z
  .object({
    type: z.literal('gosu-project-briefing-context'),
    version: z.literal(1),
    projectId: z.string().max(128),
    projectName: z.string().min(1).max(240),
    summary: z.string().min(1).max(3500),
    memoryRevision: z.number().int().nonnegative(),
    exportedAt: z.string().datetime(),
  })
  .strict();
export function relatedBriefingMemory(memory: BriefingMemory, routineId: string, query: string) {
  const terms = query
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);
  return memory.entries
    .filter((entry) => entry.routineId === routineId)
    .map((entry) => ({
      entry,
      score:
        terms.filter((term) => entry.text.toLowerCase().includes(term)).length +
        (entry.kind === 'project' ? 4 : entry.kind === 'preference' ? 3 : 0),
    }))
    .sort((a, b) => b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt))
    .slice(0, 12)
    .map(({ entry }) => entry);
}
