import type { BriefingHistory } from './briefing-workspace-store';
import { indexSavedPapers } from './src/paper-library-index';
import { assignPaperTags, buildPaperTagCatalog } from './src/paper-tags';
export function catalogForHistory(
  history: BriefingHistory[],
  routineId: string,
  includePrivate = false,
) {
  return buildPaperTagCatalog(
    indexSavedPapers(
      history.filter((h) => h.routineId === routineId && (includePrivate || !h.private)),
    ).map((p) => p.item),
  );
}
/** Public records never acquire private tag vocabulary while being projected for a reader. */
export function curateHistoryTags(
  history: BriefingHistory[],
  vocabulary = history,
): BriefingHistory[] {
  const catalogs = new Map<string, ReturnType<typeof catalogForHistory>>();
  return history.map((h) => {
    const key = JSON.stringify([h.routineId, h.private]);
    if (!catalogs.has(key))
      catalogs.set(key, catalogForHistory(vocabulary, h.routineId, h.private));
    return {
      ...h,
      items: h.items.map((i) =>
        i.kind === 'papers' || (!i.kind && /^(abstract|paper-|html-)/.test(i.readScope))
          ? { ...i, tags: assignPaperTags(i.tags ?? i.keywords ?? [], catalogs.get(key)!, false) }
          : i,
      ),
    };
  });
}
