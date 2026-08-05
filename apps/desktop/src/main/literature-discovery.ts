import type {
  LiteratureDiscoveryCoverage,
  LiteratureDiscoveryDegradationReason,
  LiteratureDiscoveryPolicy,
  LiteratureSearchProvider,
} from '../shared/literature-contracts';
import {
  CrossrefLiteratureProvider,
  LiteratureProviderError,
  type CrossrefSearchOptions,
  type LiteratureProviderCandidate,
} from './literature-crossref';
import {
  BALANCED_LITERATURE_POLICY_ID,
  BALANCED_LITERATURE_POLICY_VERSION,
  rankLiteratureCandidates,
  type LiteratureRankingCandidate,
  type RankedLiteratureSearch,
} from './literature-ranking';
import {
  SemanticScholarLiteratureProvider,
  type SemanticScholarCandidate,
  type SemanticScholarSearchOptions,
} from './literature-semantic-scholar';

const DISCOVERY_POOL_SIZE = 100;
const MAX_DISCOVERY_AUTHOR_IDS = 30_000;
const MAX_AUTHOR_METRIC_IDS = 200;

export type LiteratureProviderSearchResult = RankedLiteratureSearch &
  Readonly<{ coverage: LiteratureDiscoveryCoverage }>;

export interface LiteratureDiscoveryProvider {
  readonly providerId: LiteratureSearchProvider;
  readonly policyId: LiteratureDiscoveryPolicy;
  readonly policyVersion: number;
  search(
    query: string,
    limit: number,
    options?: CrossrefSearchOptions,
  ): Promise<readonly LiteratureProviderCandidate[] | LiteratureProviderSearchResult>;
}

type BalancedLiteratureProviderOptions = Readonly<{
  semanticScholar?: SemanticScholarLiteratureProvider;
  crossref?: CrossrefLiteratureProvider;
  now?: () => Date;
}>;

type LiteratureDiscoveryPool = Readonly<{
  inputs: readonly LiteratureRankingCandidate[];
  coverage: LiteratureDiscoveryCoverage;
}>;

function strongKey(candidate: LiteratureProviderCandidate) {
  return candidate.doi
    ? `doi:${candidate.doi}`
    : candidate.providerId
      ? `${candidate.provider}:${candidate.providerId}`
      : `fingerprint:${candidate.fingerprint}`;
}

function paperKey(paper: SemanticScholarCandidate) {
  return strongKey(paper.candidate);
}

function isCancellation(error: unknown) {
  return error instanceof LiteratureProviderError && error.code === 'cancelled';
}

function uniqueValues<Value>(values: readonly Value[]) {
  return [...new Set(values)];
}

type BoundedAuthorPool = Readonly<{
  uniqueIds: readonly string[];
  firstAuthorIds: readonly string[];
  lastAuthorIds: readonly string[];
  otherAuthorIds: readonly string[];
  truncated: boolean;
}>;

function collectBoundedAuthorPool(papers: readonly SemanticScholarCandidate[]): BoundedAuthorPool {
  const uniqueIds: string[] = [];
  const firstAuthorIds: string[] = [];
  const lastAuthorIds: string[] = [];
  const otherAuthorIds: string[] = [];
  const uniqueSeen = new Set<string>();
  const roleSeen = {
    first: new Set<string>(),
    last: new Set<string>(),
    other: new Set<string>(),
  };
  let inspected = 0;
  let truncated = false;

  outer: for (const paper of papers) {
    for (let position = 0; position < paper.authorIds.length; position += 1) {
      if (inspected === MAX_DISCOVERY_AUTHOR_IDS) {
        truncated = true;
        break outer;
      }
      inspected += 1;
      const authorId = paper.authorIds[position];
      if (!authorId) continue;
      if (!uniqueSeen.has(authorId)) {
        uniqueSeen.add(authorId);
        uniqueIds.push(authorId);
      }

      const role =
        position === 0 ? 'first' : position === paper.authorIds.length - 1 ? 'last' : 'other';
      if (roleSeen[role].has(authorId)) continue;
      roleSeen[role].add(authorId);
      if (role === 'first') firstAuthorIds.push(authorId);
      else if (role === 'last') lastAuthorIds.push(authorId);
      else otherAuthorIds.push(authorId);
    }
  }

  return {
    uniqueIds,
    firstAuthorIds,
    lastAuthorIds,
    otherAuthorIds,
    truncated,
  };
}

function evenlySpacedValues<Value>(values: readonly Value[], count: number) {
  const target = Math.min(Math.max(0, count), values.length);
  if (target === 0) return [];
  if (target === values.length) return [...values];
  if (target === 1) return [values[Math.floor((values.length - 1) / 2)] as Value];
  return Array.from({ length: target }, (_, index) => {
    const sourceIndex = Math.round((index * (values.length - 1)) / (target - 1));
    return values[sourceIndex] as Value;
  });
}

function sampleAuthorMetricIds(pool: BoundedAuthorPool) {
  if (pool.uniqueIds.length <= MAX_AUTHOR_METRIC_IDS) return [...pool.uniqueIds];
  const rolePools = [pool.firstAuthorIds, pool.lastAuthorIds, pool.otherAuthorIds].filter(
    (ids) => ids.length > 0,
  );
  const baseQuota = Math.floor(MAX_AUTHOR_METRIC_IDS / rolePools.length);
  const quotaRemainder = MAX_AUTHOR_METRIC_IDS % rolePools.length;
  const roleSamples = rolePools.map((ids, index) =>
    evenlySpacedValues(ids, baseQuota + (index < quotaRemainder ? 1 : 0)),
  );
  const selected: string[] = [];
  const selectedSet = new Set<string>();
  const longestSample = Math.max(...roleSamples.map((ids) => ids.length));
  for (let index = 0; index < longestSample; index += 1) {
    for (const sample of roleSamples) {
      const authorId = sample[index];
      if (!authorId || selectedSet.has(authorId)) continue;
      selectedSet.add(authorId);
      selected.push(authorId);
    }
  }

  if (selected.length < MAX_AUTHOR_METRIC_IDS) {
    const remaining = pool.uniqueIds.filter((authorId) => !selectedSet.has(authorId));
    for (const authorId of evenlySpacedValues(remaining, MAX_AUTHOR_METRIC_IDS - selected.length)) {
      selectedSet.add(authorId);
      selected.push(authorId);
    }
  }
  return selected;
}

export class BalancedLiteratureProvider implements LiteratureDiscoveryProvider {
  readonly providerId = 'balanced' as const;
  readonly policyId = BALANCED_LITERATURE_POLICY_ID;
  readonly policyVersion = BALANCED_LITERATURE_POLICY_VERSION;
  private readonly semanticScholar: SemanticScholarLiteratureProvider;
  private readonly crossref: CrossrefLiteratureProvider;
  private readonly now: () => Date;

  constructor(options: BalancedLiteratureProviderOptions = {}) {
    this.semanticScholar = options.semanticScholar ?? new SemanticScholarLiteratureProvider();
    this.crossref = options.crossref ?? new CrossrefLiteratureProvider();
    this.now = options.now ?? (() => new Date());
  }

  async search(
    query: string,
    limit: number,
    options: SemanticScholarSearchOptions = {},
  ): Promise<LiteratureProviderSearchResult> {
    const currentYear = this.now().getUTCFullYear();
    const referenceYear = Math.min(options.toYear ?? currentYear, currentYear);
    const target = Math.max(1, Math.min(Math.trunc(limit), 50));
    let semanticPool: LiteratureDiscoveryPool;
    try {
      semanticPool = await this.semanticScholarPool(query, options, referenceYear);
    } catch (error) {
      if (isCancellation(error)) throw error;
      return await this.crossrefSearch(query, target, options, referenceYear, [
        'semantic-scholar-unavailable',
      ]);
    }

    const semantic = rankLiteratureCandidates(semanticPool.inputs, target, referenceYear);
    if (semantic.selectedCount === 0) {
      return await this.crossrefSearch(query, target, options, referenceYear, [
        'semantic-scholar-no-eligible-results',
      ]);
    }

    const missingSortedLane = semanticPool.coverage.degradationReasons.some(
      (reason) => reason === 'citation-lane-unavailable' || reason === 'recent-lane-unavailable',
    );
    const insufficient = semantic.selectedCount < target;
    if (!missingSortedLane && !insufficient) {
      return { ...semantic, coverage: semanticPool.coverage };
    }

    const supplementReasons: LiteratureDiscoveryDegradationReason[] = insufficient
      ? ['semantic-scholar-insufficient-results']
      : [];
    try {
      const crossrefPool = await this.crossrefPool(query, target, options, referenceYear);
      if (crossrefPool.inputs.length === 0) {
        return {
          ...semantic,
          coverage: {
            ...semanticPool.coverage,
            degradationReasons: uniqueValues([
              ...semanticPool.coverage.degradationReasons,
              ...supplementReasons,
              ...crossrefPool.coverage.degradationReasons,
            ]),
          },
        };
      }
      const combined = rankLiteratureCandidates(
        [...semanticPool.inputs, ...crossrefPool.inputs],
        target,
        referenceYear,
      );
      return {
        ...combined,
        coverage: {
          source: 'combined',
          availableSignals: uniqueValues([
            ...semanticPool.coverage.availableSignals,
            ...crossrefPool.coverage.availableSignals,
          ]),
          degradationReasons: uniqueValues([
            ...semanticPool.coverage.degradationReasons,
            ...supplementReasons,
            ...crossrefPool.coverage.degradationReasons,
          ]),
        },
      };
    } catch (error) {
      if (isCancellation(error)) throw error;
      return {
        ...semantic,
        coverage: {
          ...semanticPool.coverage,
          degradationReasons: uniqueValues([
            ...semanticPool.coverage.degradationReasons,
            ...supplementReasons,
            'crossref-supplement-unavailable',
          ]),
        },
      };
    }
  }

  private async semanticScholarPool(
    query: string,
    options: SemanticScholarSearchOptions,
    referenceYear: number,
  ): Promise<LiteratureDiscoveryPool> {
    const risingFromYear = Math.max(options.fromYear ?? 1000, referenceYear - 3);
    const overall = await this.semanticScholar.search(query, DISCOVERY_POOL_SIZE, options);
    let cited: readonly SemanticScholarCandidate[] = [];
    let citationLaneAvailable = false;
    try {
      cited = await this.semanticScholar.search(query, DISCOVERY_POOL_SIZE, {
        ...options,
        sort: 'citation',
      });
      citationLaneAvailable = true;
    } catch (error) {
      if (isCancellation(error)) throw error;
    }
    let recent: readonly SemanticScholarCandidate[] = [];
    let recentLaneAvailable = false;
    if (risingFromYear <= (options.toYear ?? 3000)) {
      try {
        recent = await this.semanticScholar.search(query, DISCOVERY_POOL_SIZE, {
          ...options,
          fromYear: risingFromYear,
          toYear: options.toYear ?? referenceYear,
          sort: 'published',
        });
        recentLaneAvailable = true;
      } catch (error) {
        if (isCancellation(error)) throw error;
        recent = overall.filter(
          ({ candidate }) => (candidate.publishedYear ?? 0) >= risingFromYear,
        );
      }
    }

    const uniquePapers = new Map<string, SemanticScholarCandidate>();
    const lanes = [overall, cited, recent] as const;
    const longestLane = Math.max(...lanes.map((lane) => lane.length));
    for (let index = 0; index < longestLane; index += 1) {
      for (const lane of lanes) {
        const paper = lane[index];
        if (paper) uniquePapers.set(paperKey(paper), paper);
      }
    }
    const papers = [...uniquePapers.values()];
    const authorPool = collectBoundedAuthorPool(papers);
    const authorIds = sampleAuthorMetricIds(authorPool);
    let authorMetrics = new Map<string, { hIndex: number | null }>();
    let authorMetricsAvailable = false;
    let authorMetricsPartial = false;
    if (authorIds.length > 0) {
      try {
        authorMetrics = await this.semanticScholar.authorMetrics(authorIds, options.signal);
        authorMetricsAvailable = [...authorMetrics.values()].some(
          ({ hIndex }) => typeof hIndex === 'number',
        );
      } catch (error) {
        if (isCancellation(error)) throw error;
      }
    }

    if (authorMetricsAvailable) {
      authorMetricsPartial =
        authorPool.truncated ||
        authorIds.length < authorPool.uniqueIds.length ||
        authorIds.some((authorId) => typeof authorMetrics.get(authorId)?.hIndex !== 'number');
    }

    const overallRanks = new Map(overall.map((paper, index) => [paperKey(paper), index + 1]));
    const citationRanks = new Map(cited.map((paper, index) => [paperKey(paper), index + 1]));
    const recentRanks = new Map(recent.map((paper, index) => [paperKey(paper), index + 1]));
    const rankingInputs: LiteratureRankingCandidate[] = papers.map((paper) => {
      const hIndexes = paper.authorIds
        .map((authorId) => authorMetrics.get(authorId)?.hIndex ?? null)
        .filter((value): value is number => value !== null);
      const relevanceRank = overallRanks.get(paperKey(paper));
      const citationRank = citationRanks.get(paperKey(paper));
      const recentRank = recentRanks.get(paperKey(paper));
      return {
        candidate: paper.candidate,
        ...(relevanceRank === undefined
          ? {}
          : { relevanceRank, relevancePoolSize: overall.length }),
        ...(recentRank === undefined ? {} : { recentRank, recentPoolSize: recent.length }),
        ...(citationRank === undefined ? {} : { citationRank, citationPoolSize: cited.length }),
        influentialCitationCount: paper.influentialCitationCount,
        maxAuthorHIndex: hIndexes.length > 0 ? Math.max(...hIndexes) : null,
        signalSources: ['semantic-scholar'],
      };
    });
    const citationSignalAvailable =
      citationLaneAvailable ||
      papers.some(
        ({ candidate, influentialCitationCount }) =>
          candidate.citationCount !== undefined || influentialCitationCount !== null,
      );
    const recentSignalAvailable =
      recentLaneAvailable || papers.some(({ candidate }) => candidate.publishedYear !== undefined);
    return {
      inputs: rankingInputs,
      coverage: {
        source: 'semantic-scholar',
        availableSignals: [
          'relevance',
          ...(citationSignalAvailable ? (['citation-authority'] as const) : []),
          ...(recentSignalAvailable ? (['recent-momentum'] as const) : []),
          ...(authorMetricsAvailable ? (['author-impact'] as const) : []),
        ],
        degradationReasons: [
          ...(citationLaneAvailable ? [] : (['citation-lane-unavailable'] as const)),
          ...(recentLaneAvailable ? [] : (['recent-lane-unavailable'] as const)),
          ...(authorMetricsAvailable ? [] : (['author-metrics-unavailable'] as const)),
          ...(authorMetricsPartial ? (['author-metrics-partial'] as const) : []),
        ],
      },
    };
  }

  private async crossrefPool(
    query: string,
    limit: number,
    options: SemanticScholarSearchOptions,
    referenceYear: number,
    initialReasons: readonly LiteratureDiscoveryDegradationReason[] = [],
  ): Promise<LiteratureDiscoveryPool> {
    const poolSize = Math.min(50, Math.max(limit, 25));
    const relevance = await this.crossref.search(query, poolSize, {
      ...options,
      sort: 'relevance',
    });
    let cited: readonly LiteratureProviderCandidate[] = [];
    let recent: readonly LiteratureProviderCandidate[] = [];
    let citationLaneAvailable = false;
    let recentLaneAvailable = false;
    try {
      cited = await this.crossref.search(query, poolSize, { ...options, sort: 'citation' });
      citationLaneAvailable = true;
    } catch (error) {
      if (isCancellation(error)) throw error;
    }
    try {
      const risingFromYear = Math.max(options.fromYear ?? 1000, referenceYear - 3);
      recent = await this.crossref.search(query, poolSize, {
        ...options,
        fromYear: risingFromYear,
        toYear: options.toYear ?? referenceYear,
        sort: 'published',
      });
      recentLaneAvailable = true;
    } catch (error) {
      if (isCancellation(error)) throw error;
      recent = relevance.filter(({ publishedYear }) => (publishedYear ?? 0) >= referenceYear - 3);
    }
    const inputs: LiteratureRankingCandidate[] = [
      ...relevance.map((candidate, index) => ({
        candidate,
        relevanceRank: index + 1,
        relevancePoolSize: relevance.length,
        signalSources: ['crossref'] as const,
      })),
      ...cited.map((candidate, index) => ({
        candidate,
        citationRank: index + 1,
        citationPoolSize: cited.length,
        signalSources: ['crossref'] as const,
      })),
      ...recent.map((candidate, index) => ({
        candidate,
        recentRank: index + 1,
        recentPoolSize: recent.length,
        signalSources: ['crossref'] as const,
      })),
    ];
    const allCandidates = [...relevance, ...cited, ...recent];
    const citationSignalAvailable =
      citationLaneAvailable ||
      allCandidates.some(({ citationCount }) => citationCount !== undefined);
    const recentSignalAvailable =
      recentLaneAvailable || allCandidates.some(({ publishedYear }) => publishedYear !== undefined);
    return {
      inputs,
      coverage: {
        source: 'crossref',
        availableSignals: [
          'relevance',
          ...(citationSignalAvailable ? (['citation-authority'] as const) : []),
          ...(recentSignalAvailable ? (['recent-momentum'] as const) : []),
        ],
        degradationReasons: [
          ...initialReasons,
          ...(citationLaneAvailable ? [] : (['crossref-citation-lane-unavailable'] as const)),
          ...(recentLaneAvailable ? [] : (['crossref-recent-lane-unavailable'] as const)),
        ],
      },
    };
  }

  private async crossrefSearch(
    query: string,
    limit: number,
    options: SemanticScholarSearchOptions,
    referenceYear: number,
    initialReasons: readonly LiteratureDiscoveryDegradationReason[],
  ): Promise<LiteratureProviderSearchResult> {
    const pool = await this.crossrefPool(query, limit, options, referenceYear, initialReasons);
    return {
      ...rankLiteratureCandidates(pool.inputs, limit, referenceYear),
      coverage: pool.coverage,
    };
  }
}
