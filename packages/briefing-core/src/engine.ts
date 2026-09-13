import type { BriefingEvidence, BriefingRoutine, BriefingRun } from './types.js';
import { BriefingEvidenceSchema, BriefingRoutineSchema, isInstant } from './schema.js';
import { rankEvidence } from './ranking.js';
import { briefingSectionOrder } from './sections.js';

function canonical(item: BriefingEvidence) {
  if (!item.url) return `${item.kind}:id:${item.id}`;
  const url = new URL(item.url);
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^utm_|^(fbclid|gclid)$/u.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return `${item.kind}:url:${url.toString().replace(/\/$/u, '')}`;
}

/** Deterministic demo only. User-provided sources are reported unsupported, never fetched. */
export function generateFixtureRun(
  routine: BriefingRoutine,
  evidence: readonly BriefingEvidence[],
  input: Readonly<{ id: string; scheduledFor: string; completedAt: string }>,
): BriefingRun {
  const validation = BriefingRoutineSchema.safeParse(routine);
  if (!validation.success) throw new Error('Invalid briefing routine');
  routine = validation.data;
  if (
    !input.id.trim() ||
    input.id.length > 128 ||
    !isInstant(input.scheduledFor) ||
    !isInstant(input.completedAt)
  )
    throw new Error('Invalid fixture run identity or timestamp');
  const sources = routine.sources.filter((source) => source.origin === 'fixture');
  const collected = evidence.slice(0, 10_000).flatMap((candidate) => {
    const parsed = BriefingEvidenceSchema.safeParse(candidate);
    if (!parsed.success) return [];
    const item = parsed.data;
    const source = sources.find(
      (source) => source.id === item.sourceId && source.kind === item.kind,
    );
    if (
      !source ||
      (item.kind === 'funding') !== (routine.kind === 'funding') ||
      (item.kind === 'todo' && !item.deadline)
    )
      return [];
    if (
      item.kind === 'funding' &&
      routine.countries.length &&
      !routine.countries.includes(item.country ?? source.country ?? '')
    )
      return [];
    return [item];
  });
  const sourceResults = routine.sources.map((source) => ({
    sourceId: source.id,
    label: source.label,
    status: source.origin === 'fixture' ? ('ready' as const) : ('unsupported' as const),
    count:
      source.origin === 'fixture'
        ? collected.filter((item) => item.sourceId === source.id).length
        : 0,
  }));
  const seenIds = new Set<string>(),
    seenCanonical = new Set<string>();
  const deduplicated = [...collected]
    .sort(
      (a, b) =>
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) ||
        (JSON.stringify(a) < JSON.stringify(b)
          ? -1
          : JSON.stringify(a) > JSON.stringify(b)
            ? 1
            : 0),
    )
    .filter((item) => {
      const key = canonical(item);
      if (seenIds.has(item.id) || seenCanonical.has(key)) return false;
      seenIds.add(item.id);
      seenCanonical.add(key);
      return true;
    });
  const items = rankEvidence(deduplicated, routine.interest).slice(0, 1000);
  const ready = sourceResults.filter((source) => source.status === 'ready').length;
  return structuredClone({
    id: input.id,
    routineId: routine.id,
    routineName: routine.name,
    scheduledFor: new Date(input.scheduledFor).toISOString(),
    completedAt: new Date(input.completedAt).toISOString(),
    mode: 'fixture',
    status: ready === 0 ? 'failed' : ready === sourceResults.length ? 'ready' : 'partial',
    items,
    hiddenItemIds: [],
    sourceResults,
    progress: [
      { stage: 'collect', count: collected.length },
      { stage: 'deduplicate', count: deduplicated.length },
      { stage: 'rank', count: items.length },
      { stage: 'deliver', count: items.length },
    ],
    scheduleSnapshot: routine.schedule,
    interestSnapshot: routine.interest,
    sectionOrderSnapshot: briefingSectionOrder(routine.sectionOrder),
  });
}
