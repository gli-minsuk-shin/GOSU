import { savedPaperKey } from './paper-library-index';
export function deduplicateHistoryPapers<
  T extends {
    id: string;
    sourceUrl?: string | undefined;
    kind?: string | undefined;
    readScope: string;
  },
>(items: readonly T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!(
      item.kind === 'papers' ||
      (!item.kind && /^(abstract|paper-|html-)/.test(item.readScope))
    ))
      return true;
    const key = savedPaperKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
