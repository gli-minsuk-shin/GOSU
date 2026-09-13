import type { BriefingRun, RankedEvidence, SourceKind } from './types.js';

export const DEFAULT_BRIEFING_SECTION_ORDER: readonly SourceKind[] = [
  'weather',
  'email',
  'papers',
  'todo',
  'calendar',
  'ai-news',
  'news',
  'conference',
  'funding',
];

/** Missing fields in older routines/runs keep working. New source kinds are appended. */
export function briefingSectionOrder(order?: readonly SourceKind[]): SourceKind[] {
  return [...new Set([...(order ?? []), ...DEFAULT_BRIEFING_SECTION_ORDER])].filter((kind) =>
    DEFAULT_BRIEFING_SECTION_ORDER.includes(kind),
  );
}

export function moveBriefingSection(
  order: readonly SourceKind[] | undefined,
  kind: SourceKind,
  target: SourceKind,
): SourceKind[] {
  const next = briefingSectionOrder(order);
  const from = next.indexOf(kind),
    to = next.indexOf(target);
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(from, 1);
  next.splice(to, 0, kind);
  return next;
}

export type BriefingSection = Readonly<{
  kind: SourceKind;
  items: readonly RankedEvidence[];
  hiddenCount: number;
}>;

/** Partition, do not re-score: relevance order remains stable within each category. */
export function groupBriefingSections(
  run: BriefingRun,
  order = run.sectionOrderSnapshot,
): BriefingSection[] {
  const hidden = new Set(run.hiddenItemIds);
  return briefingSectionOrder(order).flatMap((kind) => {
    const all = run.items.filter((item) => item.evidence.kind === kind);
    if (!all.length) return [];
    const items = all.filter((item) => !hidden.has(item.evidence.id));
    return [{ kind, items, hiddenCount: all.length - items.length }];
  });
}
