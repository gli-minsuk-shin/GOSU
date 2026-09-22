import { uiText } from '@gosu/ui/language';

import type {
  LiteratureDiscoveryCoverage,
  LiteratureProviderFailure,
  LiteratureRecord,
  LiteratureSearchConflict,
  LiteratureSearchPlanQuery,
  LiteratureSearchReceipt,
} from '../../shared/literature-contracts';
import { LITERATURE_MAX_SEARCH_CONFLICT_PREVIEW } from '../../shared/literature-contracts';
import {
  LITERATURE_MAX_SEARCH_KEYWORD_TAGS,
  LITERATURE_MAX_SEARCH_TOPIC_TAGS,
} from '../../shared/literature-search-tags';

type DegradationReason = LiteratureDiscoveryCoverage['degradationReasons'][number];
type DiscoverySignal = LiteratureDiscoveryCoverage['availableSignals'][number];

const DEGRADATION_LABELS: Record<DegradationReason, string> = {
  'semantic-scholar-unavailable': 'Semantic Scholar did not respond',
  'semantic-scholar-no-eligible-results': 'Semantic Scholar had no matching paper',
  'semantic-scholar-insufficient-results': 'Semantic Scholar returned few papers',
  'citation-lane-unavailable': 'Semantic Scholar citation-sorted list missing',
  'recent-lane-unavailable': 'Semantic Scholar newest-first list missing',
  'author-metrics-unavailable': 'Author metrics missing',
  'author-metrics-partial': 'Author metrics incomplete',
  'crossref-supplement-unavailable': 'Crossref did not respond',
  'crossref-citation-lane-unavailable': 'Crossref citation-sorted list missing',
  'crossref-recent-lane-unavailable': 'Crossref newest-first list missing',
  'hugging-face-unavailable': 'Hugging Face Papers did not respond',
};

const SIGNAL_LABELS: Record<DiscoverySignal, string> = {
  relevance: 'Relevance',
  'citation-authority': 'Citation authority',
  'recent-momentum': 'Recent momentum',
  'author-impact': 'Author impact',
  'hugging-face-index': 'Hugging Face index',
};

const PROVIDER_NAMES: Record<LiteratureProviderFailure['provider'], string> = {
  'semantic-scholar': 'Semantic Scholar',
  crossref: 'Crossref',
  'hugging-face': 'Hugging Face Papers',
};

const FAILURE_TEMPLATES: Record<LiteratureProviderFailure['cause'], string> = {
  rate_limited: '{provider} answered that its request limit was exceeded ({attempts} attempts)',
  timeout: '{provider} did not answer within the time limit ({attempts} attempts)',
  unavailable: '{provider} answered with an error ({attempts} attempts)',
  invalid_response: '{provider} sent a response GOSU could not read ({attempts} attempts)',
};

export function literatureDegradationLabel(reason: DegradationReason) {
  return uiText(DEGRADATION_LABELS[reason]);
}

export function literatureSignalLabel(signal: DiscoverySignal) {
  return uiText(SIGNAL_LABELS[signal]);
}

export function literatureProviderFailureLabel(failure: LiteratureProviderFailure) {
  return uiText(FAILURE_TEMPLATES[failure.cause], {
    provider: PROVIDER_NAMES[failure.provider],
    attempts: failure.attempts,
  });
}

function conflictIdentifier(conflict: LiteratureSearchConflict) {
  const identities = [
    conflict.canonicalId ?? '',
    conflict.doi ? `DOI ${conflict.doi}` : '',
    conflict.providerRecordId && conflict.providerRecordId !== conflict.doi
      ? `${PROVIDER_NAMES[conflict.provider]} ${conflict.providerRecordId}`
      : '',
  ].filter(Boolean);
  return identities.length > 0
    ? identities.join(' / ')
    : `“${conflict.title.slice(0, 120)}${conflict.title.length > 120 ? '…' : ''}”`;
}

export function literatureConflictSummary(
  conflicts: readonly LiteratureSearchConflict[],
  conflictCount: number,
) {
  const identifiers = conflicts
    .slice(0, LITERATURE_MAX_SEARCH_CONFLICT_PREVIEW)
    .map(conflictIdentifier);
  if (identifiers.length === 0) return '';
  const omitted = Math.max(0, conflictCount - identifiers.length);
  return omitted > 0
    ? `${identifiers.join('; ')}; ${uiText('+{omitted} more', { omitted })}`
    : identifiers.join('; ');
}

/** One sentence about what a search could not use, for notices and tooltips. */
export function literatureCoverageSummary(
  coverage: LiteratureDiscoveryCoverage | undefined,
  failures: readonly LiteratureProviderFailure[] = [],
) {
  if (!coverage) return '';
  const available = coverage.availableSignals.map(literatureSignalLabel).join(', ');
  if (coverage.degradationReasons.length === 0 && failures.length === 0) {
    return uiText('Signals used: {available}.', { available });
  }
  const causes =
    failures.length > 0
      ? failures.map(literatureProviderFailureLabel)
      : coverage.degradationReasons.map(literatureDegradationLabel);
  const citationSignalsLost =
    !coverage.availableSignals.includes('citation-authority') ||
    coverage.degradationReasons.includes('semantic-scholar-unavailable');
  return [
    uiText('Partly missing: {causes}.', { causes: causes.join('; ') }),
    uiText('Signals used: {available}.', { available }),
    citationSignalsLost
      ? uiText('The citation-based layers (Core, Rising) may fill in when you search again.')
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

type SearchSummaryOptions = Readonly<{ plannedQueries?: readonly string[] | undefined }>;

/** The notice after one search, or after the several searches of one planned request. */
export function literatureSearchSummary(
  receipts: readonly LiteratureSearchReceipt[],
  options: SearchSummaryOptions = {},
) {
  const total = (pick: (receipt: LiteratureSearchReceipt) => number) =>
    receipts.reduce((sum, receipt) => sum + pick(receipt), 0);
  const screened = total((receipt) => receipt.retrievedCount ?? receipt.foundCount);
  const selected = total((receipt) => receipt.foundCount);
  const tiers = receipts.reduce(
    (sum, receipt) => {
      const counts = receipt.tierCounts ?? receipt.run.tierCounts;
      return counts
        ? {
            known: true,
            core: sum.core + counts.core,
            rising: sum.rising + counts.rising,
            broad: sum.broad + counts.broad,
          }
        : sum;
    },
    { known: false, core: 0, rising: 0, broad: 0 },
  );
  const failures = receipts.flatMap((receipt) => receipt.providerFailures ?? []);
  const coverage = receipts
    .map((receipt) => receipt.coverage ?? receipt.run.coverage)
    .find((item) => item !== undefined && (item.degradationReasons.length > 0 || true));
  const degraded = receipts
    .map((receipt) => receipt.coverage ?? receipt.run.coverage)
    .find((item) => item !== undefined && item.degradationReasons.length > 0);
  const parts: string[] = [];
  if ((options.plannedQueries?.length ?? 0) > 0) {
    parts.push(
      uiText('Searched as: {queries}.', {
        queries: options.plannedQueries!.map((query) => `“${query}”`).join(', '),
      }),
    );
  }
  if (selected === 0) {
    parts.push(
      screened > 0
        ? uiText(
            'None of the {screened} candidates mentions the search terms, so nothing was saved. Scholarly indexes match English keywords: try two to six of them, such as a method or model name.',
            { screened },
          )
        : uiText(
            'The providers returned no candidate for this search. Try two to six English keywords, such as a method or model name.',
          ),
    );
  } else {
    parts.push(
      uiText('Search complete: {screened} candidates screened, {selected} selected.', {
        screened,
        selected,
      }),
      uiText('{added} added, {updated} updated, {unchanged} already saved.', {
        added: total((receipt) => receipt.newCount),
        updated: total((receipt) => receipt.updatedCount),
        unchanged: total((receipt) => receipt.unchangedCount),
      }),
    );
    if (tiers.known) {
      parts.push(
        uiText('Layers: {core} core · {rising} rising · {broad} broad.', {
          core: tiers.core,
          rising: tiers.rising,
          broad: tiers.broad,
        }),
      );
    }
  }
  const coverageText = literatureCoverageSummary(degraded ?? coverage, failures);
  if (coverageText && (degraded || failures.length > 0)) parts.push(coverageText);
  const conflictCount = total((receipt) => receipt.conflictCount);
  if (conflictCount > 0) {
    const details = literatureConflictSummary(
      receipts.flatMap((receipt) => receipt.run.conflicts),
      conflictCount,
    );
    parts.push(
      uiText(
        conflictCount === 1
          ? '{conflictCount} ambiguous result was skipped without changing saved papers.'
          : '{conflictCount} ambiguous results were skipped without changing saved papers.',
        { conflictCount },
      ) + (details ? ` ${uiText('Skipped: {details}.', { details })}` : ''),
    );
  }
  return parts.join(' ');
}

export type PlannedLiteratureSearch = Readonly<{
  query: string;
  searchTags: Readonly<{ topics: readonly string[]; keywords: readonly string[] }>;
}>;

function mergedLabels(first: readonly string[], second: readonly string[], maximum: number) {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const label of [...first, ...second]) {
    const key = label.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(label.trim());
    if (labels.length === maximum) break;
  }
  return labels;
}

/** The user's own tags come first; planned tags only fill what is left of each limit. */
export function literaturePlannedSearches(
  queries: readonly LiteratureSearchPlanQuery[],
  userTags: Readonly<{ topics: readonly string[]; keywords: readonly string[] }>,
): PlannedLiteratureSearch[] {
  return queries.map((item) => ({
    query: item.query,
    searchTags: {
      topics: mergedLabels(userTags.topics, item.topics, LITERATURE_MAX_SEARCH_TOPIC_TAGS),
      keywords: mergedLabels(userTags.keywords, item.keywords, LITERATURE_MAX_SEARCH_KEYWORD_TAGS),
    },
  }));
}

/** Records that exist because of these searches: classified by the run and created when it ended. */
export function recordIdsCreatedBySearches(
  records: readonly LiteratureRecord[],
  runs: readonly Readonly<{ id: string; completedAt: string | null }>[],
) {
  const completedAtByRun = new Map(runs.map((run) => [run.id, run.completedAt]));
  return records
    .filter(
      (record) =>
        record.discovery !== null &&
        record.discovery !== undefined &&
        completedAtByRun.get(record.discovery.searchRunId) === record.createdAt,
    )
    .map(({ id }) => id);
}

/** Small turns finish inside the AI time limit; fifty abstracts in one turn usually did not. */
export function literatureOrganizeBatches(
  recordIds: readonly string[],
  options: Readonly<{ batchSize: number; maximum: number }>,
) {
  const bounded = recordIds.slice(0, Math.max(0, options.maximum));
  const batches: string[][] = [];
  for (let index = 0; index < bounded.length; index += Math.max(1, options.batchSize)) {
    batches.push(bounded.slice(index, index + Math.max(1, options.batchSize)));
  }
  return batches;
}
