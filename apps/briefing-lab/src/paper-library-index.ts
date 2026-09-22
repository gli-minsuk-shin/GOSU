import type { BriefingHistory } from '../briefing-workspace-store';
import { versionedPaperId } from './paper-identity';
import { cleanPaperTags, paperTagAliases, paperTagKey } from './paper-tags';
import { paperCategoryLabel } from './paper-classification';
/** Counts only; the conversation itself is read on the 논문 요약 screen, never in this list. */
export type PaperConversationCount = {
  turns: number;
  lastAskedAt: string;
  lastQuestion: string;
};

export type SavedPaper = {
  historyId: string;
  savedAt: string;
  classificationKey?: string;
  private?: boolean;
  /**
   * What the 논문 요약 AI was asked about this paper, from that paper's own conversation. Every
   * paper in the list can have one, not only the few that are shared-library records.
   */
  conversation?: PaperConversationCount;
  item: BriefingHistory['items'][number];
};
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
export function paperLabels(item: SavedPaper['item']) {
  const tags = cleanPaperTags([item])[0]!.tags;
  return {
    tags,
    categories: [
      item.classification ? paperCategoryLabel(item.classification.categoryId) : '분류 대기',
    ],
  };
}
export function savedPaperKey(item: Pick<SavedPaper['item'], 'id' | 'sourceUrl'>) {
  return versionedPaperId(item.sourceUrl) ?? JSON.stringify([item.id, item.sourceUrl ?? null]);
}
export function indexSavedPapers(history: BriefingHistory[]): SavedPaper[] {
  const seen = new Set<string>();
  return [...history]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .flatMap((h) =>
      h.kind === 'briefing'
        ? h.items
            .filter(
              (i) =>
                i.kind === 'papers' || (!i.kind && /^(abstract|paper-|html-)/.test(i.readScope)),
            )
            .map((item) => ({ historyId: h.id, savedAt: h.createdAt, private: h.private, item }))
        : [],
    )
    .filter(({ item }) => {
      const key = savedPaperKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        Date.parse(b.item.provenance?.summarizedAt ?? b.savedAt) -
        Date.parse(a.item.provenance?.summarizedAt ?? a.savedAt),
    );
}
export function matchesSavedPaper(
  paper: SavedPaper,
  query: string,
  category = '',
  tag: string | readonly string[] = '',
) {
  const labels = paperLabels(paper.item);
  const selectedTags = typeof tag === 'string' ? (tag ? [tag] : []) : tag;
  const i = paper.item;
  const searchable = normalize(
    [
      i.title,
      i.sourceUrl,
      i.summary,
      i.detail,
      i.researchQuestion,
      i.strengths,
      i.limitations,
      i.methodsAndAssumptions,
      i.reportedResults,
      ...labels.tags,
      ...labels.tags.flatMap(paperTagAliases),
      ...(i.keywords ?? []),
      ...labels.categories,
    ]
      .filter(Boolean)
      .join(' '),
  );
  return (
    (!category || labels.categories.includes(category)) &&
    (!selectedTags.length ||
      labels.tags.some((t) =>
        selectedTags.some((selected) => paperTagKey(t) === paperTagKey(selected)),
      )) &&
    normalize(paperTagKey(query))
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => searchable.includes(term))
  );
}
