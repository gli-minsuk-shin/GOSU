import type { BriefingHistory } from './briefing-workspace-store';
import type { LiveItem } from './src/live-types';
import type { SummaryProvenance } from './src/summary-provenance';
import { versionedPaperId } from './src/paper-identity';
import { summarySourceDigest } from './briefing-summary-cache';
export function paperMetadataDigest(item: LiveItem) {
  const { paper: _paper, ...metadata } = item;
  return summarySourceDigest(metadata);
}
export function findSavedPaper(item: LiveItem, history: readonly BriefingHistory[]) {
  const identity = versionedPaperId(item.sourceUrl);
  if (item.kind !== 'papers' || !identity) return null;
  for (const entry of [...history].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )) {
    const cached = entry.items.find(
      (c) =>
        (c.kind === 'papers' || (!c.kind && !c.readScope.startsWith('mail'))) &&
        c.id === item.id &&
        c.title === item.title &&
        versionedPaperId(c.sourceUrl) === identity,
    );
    if (!cached) continue;
    // New records compare every observed metadata byte; legacy reuse is explicitly version-only.
    if (
      cached.provenance?.sourceMetadataDigest &&
      cached.provenance.sourceMetadataDigest !== paperMetadataDigest(item)
    )
      return null;
    if (item.paper && cached.provenance?.sourceDigest !== summarySourceDigest(item)) return null;
    return { entry, cached };
  }
  return null;
}
export function restorePaperEvidence(
  item: LiveItem,
  cached: BriefingHistory['items'][number],
): LiveItem {
  return {
    ...item,
    paper: {
      readScope: 'abstract',
      excerpt: '',
      sourceUrl: item.sourceUrl!,
      note: '같은 논문 버전에 저장된 요약·수식·그림입니다. 현재 원문을 다시 조회하지 않았습니다.',
      equations: (cached.equations ?? []).map((e, index) => ({
        id: `saved-eq-${index}`,
        latex: e.latex,
      })),
      figures: (cached.figures ?? []).map(({ imageData, ...f }) => ({
        ...f,
        ...(imageData ? { imageData } : {}),
      })),
    },
  };
}
export function savedPaperProvenance(
  match: NonNullable<ReturnType<typeof findSavedPaper>>,
  contextDigest: string,
  revision: number | null,
): SummaryProvenance {
  const old = match.cached.provenance;
  const originalRevision =
    old && 'feedbackProfileRevision' in old
      ? (old.feedbackProfileRevision ?? null)
      : (match.entry.feedbackProfileRevision ?? null);
  const common = {
    reused: true as const,
    reuseBasis: 'paper-version' as const,
    feedbackProfileRevision: originalRevision,
    personalizationStale:
      old?.contextDigest !== contextDigest ||
      originalRevision === null ||
      revision === null ||
      originalRevision !== revision,
  };
  return old
    ? { ...old, ...common }
    : {
        version: 2,
        sourceDigest: null,
        contextDigest: null,
        summarizedAt: null,
        ...(Number.isFinite(Date.parse(match.entry.createdAt))
          ? { savedAt: new Date(match.entry.createdAt).toISOString() }
          : {}),
        ...common,
      };
}
