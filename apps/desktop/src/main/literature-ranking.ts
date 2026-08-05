import type {
  LiteratureDiscoveryReason,
  LiteratureDiscoveryTier,
  LiteratureRankingSignals,
  LiteratureTierCounts,
} from '../shared/literature-contracts';
import {
  BALANCED_LITERATURE_POLICY_ID,
  BALANCED_LITERATURE_POLICY_VERSION,
  LITERATURE_CANONICAL_MIN_AGE_YEARS,
  LITERATURE_CORE_MIN_CITATIONS,
  LITERATURE_CORE_MIN_INFLUENTIAL_CITATIONS,
  LITERATURE_CORE_MIN_RELEVANCE_SCORE,
  LITERATURE_RISING_MAX_AGE_YEARS,
  LITERATURE_RISING_MIN_CITATIONS_PER_YEAR,
  LITERATURE_RISING_MIN_INFLUENTIAL_CITATIONS,
  LITERATURE_RISING_MIN_RELEVANCE_SCORE,
} from '../shared/literature-ranking-policy';
import { literatureFingerprint, type LiteratureProviderCandidate } from './literature-crossref';

export { BALANCED_LITERATURE_POLICY_ID, BALANCED_LITERATURE_POLICY_VERSION };
const CANONICAL_CORE_SHARE = 0.25;

export type LiteratureRankingCandidate = Readonly<{
  candidate: LiteratureProviderCandidate;
  relevanceRank?: number | undefined;
  relevancePoolSize?: number | undefined;
  recentRank?: number | undefined;
  recentPoolSize?: number | undefined;
  citationRank?: number | undefined;
  citationPoolSize?: number | undefined;
  influentialCitationCount?: number | null | undefined;
  maxAuthorHIndex?: number | null | undefined;
  signalSources: readonly ('crossref' | 'semantic-scholar')[];
}>;

export type RankedLiteratureSearch = Readonly<{
  candidates: readonly LiteratureProviderCandidate[];
  retrievedCount: number;
  selectedCount: number;
  tierCounts: LiteratureTierCounts;
}>;

type ScoredCandidate = Readonly<{
  input: LiteratureRankingCandidate;
  stableKey: string;
  relevanceScore: number;
  authorityScore: number;
  momentumScore: number;
  coreScore: number;
  risingScore: number;
  broadScore: number;
  citationVelocityProxy: number | null;
  recent: boolean;
  publicationYearEligible: boolean;
  bibliographicEligible: boolean;
  citationImpactEligible: boolean;
  relevantCoreEligible: boolean;
  canonicalCoreEligible: boolean;
  risingEligible: boolean;
}>;

const excludedWorkTypes = new Set([
  'dataset',
  'editorial',
  'news',
  'lettersandcomments',
  'peerreview',
  'component',
  'grant',
  'referenceentry',
]);

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundedScore(value: number) {
  return Math.round(clampScore(value) * 10_000) / 10_000;
}

function roundedRate(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? null
    : Math.round(Math.max(0, value) * 1_000) / 1_000;
}

function rankScore(rank: number | undefined, poolSize: number | undefined) {
  if (!rank || rank < 1) return 0;
  const boundedPool = Math.max(1, poolSize ?? rank);
  if (rank > boundedPool) return 0;
  if (boundedPool === 1) return 1;
  return clampScore(1 - (rank - 1) / boundedPool);
}

function minimumDefined(left: number | undefined, right: number | undefined) {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

function fixedLogarithmicScore(value: number | null | undefined, referenceMaximum: number) {
  if (value === null || value === undefined || value <= 0 || referenceMaximum <= 0) return 0;
  return clampScore(Math.log1p(value) / Math.log1p(referenceMaximum));
}

function maximumKnown(
  left: number | null | undefined,
  right: number | null | undefined,
): number | null | undefined {
  if (typeof left === 'number' && typeof right === 'number') return Math.max(left, right);
  if (typeof left === 'number') return left;
  if (typeof right === 'number') return right;
  return left === null || right === null ? null : undefined;
}

const providerPreference: Record<LiteratureProviderCandidate['provider'], number> = {
  import: 0,
  crossref: 1,
  'semantic-scholar': 2,
};

const signalSourcePreference: Record<LiteratureRankingCandidate['signalSources'][number], number> =
  {
    crossref: 0,
    'semantic-scholar': 1,
  };

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function richerText(left: string | undefined, right: string | undefined) {
  if (!left) return right;
  if (!right) return left;
  if (left.length !== right.length) return left.length > right.length ? left : right;
  return compareText(left, right) <= 0 ? left : right;
}

function listPreferenceKey(values: readonly string[]) {
  return values.join('\u0000');
}

function richerList(left: readonly string[], right: readonly string[], maximum: number) {
  const leftLength = left.reduce((length, value) => length + value.length, 0);
  const rightLength = right.reduce((length, value) => length + value.length, 0);
  const primary =
    left.length !== right.length
      ? left.length > right.length
        ? left
        : right
      : leftLength !== rightLength
        ? leftLength > rightLength
          ? left
          : right
        : compareText(listPreferenceKey(left), listPreferenceKey(right)) <= 0
          ? left
          : right;
  const secondary = primary === left ? right : left;
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of [...primary, ...secondary]) {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
    if (merged.length === maximum) break;
  }
  return merged;
}

function candidateRichness(candidate: LiteratureProviderCandidate) {
  return (
    candidate.title.length +
    candidate.authors.length * 100 +
    candidate.topics.length * 20 +
    (candidate.containerTitle?.length ?? 0) +
    (candidate.workType?.length ?? 0) +
    (candidate.publishedYear === undefined ? 0 : 100) +
    (candidate.citationCount === undefined ? 0 : 100) +
    (candidate.sourceUrl?.length ?? 0)
  );
}

function candidatePreferenceKey(candidate: LiteratureProviderCandidate) {
  return JSON.stringify([
    candidate.provider,
    candidate.providerId ?? '',
    candidate.doi ?? '',
    candidate.title,
    candidate.authors,
    candidate.containerTitle ?? '',
    candidate.publishedYear ?? 0,
    candidate.topics,
    candidate.workType ?? '',
    candidate.citationCount ?? -1,
    candidate.sourceUrl ?? '',
  ]);
}

function preferredCandidate(left: LiteratureProviderCandidate, right: LiteratureProviderCandidate) {
  const providerDifference = providerPreference[right.provider] - providerPreference[left.provider];
  if (providerDifference !== 0) return providerDifference > 0 ? right : left;
  const richnessDifference = candidateRichness(right) - candidateRichness(left);
  if (richnessDifference !== 0) return richnessDifference > 0 ? right : left;
  return compareText(candidatePreferenceKey(left), candidatePreferenceKey(right)) <= 0
    ? left
    : right;
}

function mergeCandidateMetadata(
  left: LiteratureProviderCandidate,
  right: LiteratureProviderCandidate,
) {
  const preferred = preferredCandidate(left, right);
  const alternate = preferred === left ? right : left;
  const title = richerText(left.title, right.title)!;
  const authors = richerList(left.authors, right.authors, 100);
  const topics = richerList(left.topics, right.topics, 50);
  const publishedYear =
    left.publishedYear === undefined
      ? right.publishedYear
      : right.publishedYear === undefined
        ? left.publishedYear
        : Math.min(left.publishedYear, right.publishedYear);
  const containerTitle = richerText(left.containerTitle, right.containerTitle);
  const workType = richerText(left.workType, right.workType);
  const citationCount = maximumKnown(left.citationCount, right.citationCount);
  const sourceUrl = preferred.sourceUrl ?? alternate.sourceUrl;
  const doi = left.doi ?? right.doi;

  return {
    ...preferred,
    ...(doi ? { doi } : {}),
    fingerprint: literatureFingerprint(title, authors, publishedYear),
    title,
    authors,
    ...(containerTitle ? { containerTitle } : {}),
    ...(publishedYear === undefined ? {} : { publishedYear }),
    topics,
    ...(workType ? { workType } : {}),
    ...(citationCount === undefined || citationCount === null ? {} : { citationCount }),
    ...(sourceUrl ? { sourceUrl } : {}),
  } satisfies LiteratureProviderCandidate;
}

function mergedSignalSources(
  left: LiteratureRankingCandidate['signalSources'],
  right: LiteratureRankingCandidate['signalSources'],
) {
  return [...left, ...right]
    .filter((source, index, all) => all.indexOf(source) === index)
    .sort((leftSource, rightSource) =>
      Math.sign(signalSourcePreference[leftSource] - signalSourcePreference[rightSource]),
    );
}

function mergeRankingInputs(
  left: LiteratureRankingCandidate,
  right: LiteratureRankingCandidate,
): LiteratureRankingCandidate {
  return {
    candidate: mergeCandidateMetadata(left.candidate, right.candidate),
    relevanceRank: minimumDefined(left.relevanceRank, right.relevanceRank),
    relevancePoolSize: Math.max(left.relevancePoolSize ?? 0, right.relevancePoolSize ?? 0),
    recentRank: minimumDefined(left.recentRank, right.recentRank),
    recentPoolSize: Math.max(left.recentPoolSize ?? 0, right.recentPoolSize ?? 0),
    citationRank: minimumDefined(left.citationRank, right.citationRank),
    citationPoolSize: Math.max(left.citationPoolSize ?? 0, right.citationPoolSize ?? 0),
    influentialCitationCount: maximumKnown(
      left.influentialCitationCount,
      right.influentialCitationCount,
    ),
    maxAuthorHIndex: maximumKnown(left.maxAuthorHIndex, right.maxAuthorHIndex),
    signalSources: mergedSignalSources(left.signalSources, right.signalSources),
  };
}

function stableCandidateKey(candidate: LiteratureProviderCandidate) {
  return candidate.doi
    ? `doi:${candidate.doi.toLowerCase()}`
    : candidate.providerId
      ? `${candidate.provider}:${candidate.providerId}`
      : `fingerprint:${candidate.fingerprint}`;
}

function isResearchWork(candidate: LiteratureProviderCandidate) {
  const normalized = candidate.workType?.replace(/[^A-Za-z]/gu, '').toLocaleLowerCase();
  return !normalized || !excludedWorkTypes.has(normalized);
}

function compareDescending(
  score: (candidate: ScoredCandidate) => number,
  left: ScoredCandidate,
  right: ScoredCandidate,
) {
  const difference = score(right) - score(left);
  if (Math.abs(difference) > Number.EPSILON) return difference;
  const citationDifference =
    (right.input.candidate.citationCount ?? -1) - (left.input.candidate.citationCount ?? -1);
  if (citationDifference !== 0) return citationDifference;
  const yearDifference =
    (right.input.candidate.publishedYear ?? -1) - (left.input.candidate.publishedYear ?? -1);
  if (yearDifference !== 0) return yearDifference;
  return left.stableKey.localeCompare(right.stableKey);
}

function quotas(limit: number) {
  if (limit <= 1) return { core: limit, rising: 0, broad: 0 };
  if (limit === 2) return { core: 1, rising: 1, broad: 0 };
  const core = Math.max(1, Math.floor(limit * 0.4));
  const rising = Math.max(1, Math.floor(limit * 0.3));
  return { core, rising, broad: Math.max(1, limit - core - rising) };
}

function reasonsFor(candidate: ScoredCandidate, tier: LiteratureDiscoveryTier) {
  const reasons: LiteratureDiscoveryReason[] = [];
  if (candidate.relevanceScore >= 0.55) reasons.push('high-query-relevance');
  if (candidate.citationImpactEligible) {
    reasons.push('high-citation-impact');
  }
  if (candidate.canonicalCoreEligible) {
    reasons.push('established-classic');
  }
  if ((candidate.input.maxAuthorHIndex ?? 0) >= 40) reasons.push('prominent-author-signal');
  if (candidate.recent) reasons.push('recent-publication');
  if (candidate.risingEligible && candidate.momentumScore >= 0.35) {
    reasons.push('estimated-citation-momentum');
  }
  if ((candidate.input.influentialCitationCount ?? 0) > 0) {
    reasons.push('influential-citation-signal');
  }
  if (tier !== 'core') {
    if (
      candidate.input.candidate.publishedYear !== undefined &&
      !candidate.publicationYearEligible
    ) {
      reasons.push('future-publication-year');
    } else if (!candidate.bibliographicEligible) {
      reasons.push('incomplete-bibliographic-metadata');
    } else if (!candidate.citationImpactEligible) {
      reasons.push('core-impact-threshold-not-met');
    } else if (!candidate.relevantCoreEligible && !candidate.canonicalCoreEligible) {
      reasons.push('core-relevance-threshold-not-met');
    }
  }
  if (tier === 'broad') reasons.push('broad-recall');
  if (reasons.length === 0) {
    reasons.push(tier === 'broad' ? 'broad-recall' : 'query-match-candidate');
  }
  return reasons.slice(0, 8);
}

function matchedLayers(candidate: ScoredCandidate, primary: LiteratureDiscoveryTier) {
  const matches: LiteratureDiscoveryTier[] = [];
  if (
    (candidate.relevantCoreEligible || candidate.canonicalCoreEligible) &&
    candidate.coreScore >= 0.48
  ) {
    matches.push('core');
  }
  if (candidate.risingEligible && candidate.risingScore >= 0.42) matches.push('rising');
  matches.push('broad');
  if (!matches.includes(primary)) matches.unshift(primary);
  return matches.filter((tier, index, all) => all.indexOf(tier) === index).slice(0, 3);
}

function withDiscovery(scored: ScoredCandidate, tier: LiteratureDiscoveryTier, tierRank: number) {
  const score =
    tier === 'core' ? scored.coreScore : tier === 'rising' ? scored.risingScore : scored.broadScore;
  const discovery: LiteratureRankingSignals = {
    tier,
    matchedLayers: matchedLayers(scored, tier),
    tierRank,
    overallScore: roundedScore(score),
    relevanceScore: roundedScore(scored.relevanceScore),
    authorityScore: roundedScore(scored.authorityScore),
    momentumScore: roundedScore(scored.momentumScore),
    citationVelocityProxy: roundedRate(scored.citationVelocityProxy),
    influentialCitationCount: scored.input.influentialCitationCount ?? null,
    maxAuthorHIndex: scored.input.maxAuthorHIndex ?? null,
    reasons: reasonsFor(scored, tier),
    signalSources: scored.input.signalSources
      .filter((source, index, all) => all.indexOf(source) === index)
      .slice(0, 2),
  };
  return { ...scored.input.candidate, discovery } satisfies LiteratureProviderCandidate;
}

export function rankLiteratureCandidates(
  inputs: readonly LiteratureRankingCandidate[],
  requestedLimit: number,
  referenceYear = new Date().getUTCFullYear(),
): RankedLiteratureSearch {
  const limit = Math.max(1, Math.min(Math.trunc(requestedLimit), 50));
  const deduplicated = new Map<string, LiteratureRankingCandidate>();
  for (const input of inputs) {
    if (!isResearchWork(input.candidate)) continue;
    const key = stableCandidateKey(input.candidate);
    const existing = deduplicated.get(key);
    if (!existing) {
      deduplicated.set(key, input);
      continue;
    }
    deduplicated.set(key, {
      ...mergeRankingInputs(existing, input),
    });
  }

  const unique = [...deduplicated.values()];
  const velocity = (input: LiteratureRankingCandidate) => {
    const year = input.candidate.publishedYear;
    const citations = input.candidate.citationCount;
    if (year === undefined || citations === undefined) return null;
    const age = Math.max(0, referenceYear - year);
    return citations / Math.max(1, age + 1);
  };
  const recentFloor = referenceYear - LITERATURE_RISING_MAX_AGE_YEARS;
  const scored: ScoredCandidate[] = unique.map((input) => {
    const relevanceScore =
      input.relevanceRank === undefined
        ? 0.12
        : rankScore(input.relevanceRank, input.relevancePoolSize);
    const citationScore = fixedLogarithmicScore(input.candidate.citationCount, 1_000);
    const influentialScore = fixedLogarithmicScore(input.influentialCitationCount, 100);
    const authorScore = clampScore((input.maxAuthorHIndex ?? 0) / 100);
    const citationLaneScore = rankScore(input.citationRank, input.citationPoolSize);
    const authorityScore =
      0.65 * citationScore + 0.2 * influentialScore + 0.1 * citationLaneScore + 0.05 * authorScore;
    const publishedYear = input.candidate.publishedYear;
    const age = publishedYear === undefined ? null : Math.max(0, referenceYear - publishedYear);
    const recencyScore = age === null ? 0 : clampScore(1 - age / 4);
    const citationVelocityProxy = velocity(input);
    const velocityScore = fixedLogarithmicScore(citationVelocityProxy, 50);
    const recentLaneScore = rankScore(input.recentRank, input.recentPoolSize);
    const publicationYearEligible = publishedYear !== undefined && publishedYear <= referenceYear;
    const recent =
      publishedYear !== undefined && publishedYear <= referenceYear && publishedYear >= recentFloor;
    const bibliographicEligible =
      publicationYearEligible &&
      input.candidate.authors.length > 0 &&
      Boolean(input.candidate.doi || input.candidate.providerId);
    const citationImpactEligible =
      (input.candidate.citationCount ?? 0) >= LITERATURE_CORE_MIN_CITATIONS ||
      (input.influentialCitationCount ?? 0) >= LITERATURE_CORE_MIN_INFLUENTIAL_CITATIONS;
    const established =
      publishedYear !== undefined &&
      publishedYear <= referenceYear - LITERATURE_CANONICAL_MIN_AGE_YEARS;
    const relevantCoreEligible =
      bibliographicEligible &&
      input.relevanceRank !== undefined &&
      relevanceScore >= LITERATURE_CORE_MIN_RELEVANCE_SCORE &&
      citationImpactEligible;
    const canonicalCoreEligible =
      bibliographicEligible &&
      established &&
      input.citationRank !== undefined &&
      citationImpactEligible;
    const risingEligible =
      bibliographicEligible &&
      recent &&
      input.relevanceRank !== undefined &&
      relevanceScore >= LITERATURE_RISING_MIN_RELEVANCE_SCORE &&
      ((citationVelocityProxy ?? 0) >= LITERATURE_RISING_MIN_CITATIONS_PER_YEAR ||
        (input.influentialCitationCount ?? 0) >= LITERATURE_RISING_MIN_INFLUENTIAL_CITATIONS);
    const momentumScore =
      0.35 * recencyScore +
      0.4 * velocityScore +
      0.15 * influentialScore +
      0.07 * recentLaneScore +
      0.03 * authorScore;
    const coreScore = 0.68 * relevanceScore + 0.27 * authorityScore + 0.05 * authorScore;
    const risingScore = 0.55 * relevanceScore + 0.4 * momentumScore + 0.05 * authorityScore;
    const broadScore = 0.85 * relevanceScore + 0.1 * authorityScore + 0.05 * recencyScore;
    return {
      input,
      stableKey: stableCandidateKey(input.candidate),
      relevanceScore,
      authorityScore,
      momentumScore,
      coreScore,
      risingScore,
      broadScore,
      citationVelocityProxy,
      recent,
      publicationYearEligible,
      bibliographicEligible,
      citationImpactEligible,
      relevantCoreEligible,
      canonicalCoreEligible,
      risingEligible,
    };
  });

  const target = quotas(Math.min(limit, scored.length));
  const selected = new Set<string>();
  const choose = (
    candidates: readonly ScoredCandidate[],
    count: number,
    tier: LiteratureDiscoveryTier,
    score: (candidate: ScoredCandidate) => number,
    tierRankOffset = 0,
  ) => {
    const chosen = candidates
      .filter(({ stableKey }) => !selected.has(stableKey))
      .sort((left, right) => compareDescending(score, left, right))
      .slice(0, count);
    chosen.forEach(({ stableKey }) => selected.add(stableKey));
    return chosen.map((candidate, index) =>
      withDiscovery(candidate, tier, tierRankOffset + index + 1),
    );
  };

  const canonicalCoreTarget =
    target.core === 0 ? 0 : Math.max(1, Math.floor(target.core * CANONICAL_CORE_SHARE));
  const canonicalCore = choose(
    scored.filter(({ canonicalCoreEligible }) => canonicalCoreEligible),
    canonicalCoreTarget,
    'core',
    ({ authorityScore }) => authorityScore,
  );
  const relevanceCore = choose(
    scored.filter(({ relevantCoreEligible }) => relevantCoreEligible),
    target.core - canonicalCore.length,
    'core',
    ({ coreScore }) => coreScore,
    canonicalCore.length,
  );
  const core = [...canonicalCore, ...relevanceCore];
  const rising = choose(
    scored.filter(({ risingEligible }) => risingEligible),
    target.rising,
    'rising',
    ({ risingScore }) => risingScore,
  );
  const broad = choose(scored, target.broad, 'broad', ({ broadScore }) => broadScore);
  const initial = [...core, ...rising, ...broad];
  const remainingSlots = limit - initial.length;
  const fill =
    remainingSlots > 0
      ? choose(scored, remainingSlots, 'broad', ({ broadScore }) => broadScore).map(
          (candidate, index) => ({
            ...candidate,
            discovery: {
              ...candidate.discovery!,
              tierRank: broad.length + index + 1,
            },
          }),
        )
      : [];
  const candidates = [...initial, ...fill];
  const tierCounts = candidates.reduce<LiteratureTierCounts>(
    (counts, candidate) => ({
      ...counts,
      [candidate.discovery!.tier]: counts[candidate.discovery!.tier] + 1,
    }),
    { core: 0, rising: 0, broad: 0 },
  );

  return {
    candidates,
    retrievedCount: scored.length,
    selectedCount: candidates.length,
    tierCounts,
  };
}
