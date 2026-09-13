import type { BriefingEvidence, InterestProfile, RankedEvidence } from './types.js';
import { BriefingEvidenceSchema, InterestProfileSchema } from './schema.js';

export const BRIEFING_RANKING_POLICY_VERSION = 'keyword-title3-abstract1-v1';
const normalize = (value: string) =>
  value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
function matches(haystack: string, needle: string) {
  const term = normalize(needle);
  if (!/[a-z0-9]/u.test(term)) return haystack.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(haystack);
}
export function rankEvidence(
  evidence: readonly BriefingEvidence[],
  interest: InterestProfile,
): RankedEvidence[] {
  const profile = InterestProfileSchema.safeParse(interest);
  if (!profile.success) return [];
  return evidence
    .flatMap((candidate): RankedEvidence[] => {
      const parsed = BriefingEvidenceSchema.safeParse(candidate);
      if (!parsed.success) return [];
      const item = parsed.data;
      const title = normalize(item.title),
        abstract = normalize(item.abstract);
      if (profile.data.excluded.some((term) => matches(title, term) || matches(abstract, term)))
        return [];
      let score = 0;
      const matchedKeywords: string[] = [];
      for (const keyword of profile.data.keywords) {
        const terms = [keyword.term, ...keyword.synonyms];
        const titleMatch = terms.some((term) => matches(title, term));
        const abstractMatch = terms.some((term) => matches(abstract, term));
        if (!titleMatch && !abstractMatch) continue;
        score += keyword.weight * ((titleMatch ? 3 : 0) + (abstractMatch ? 1 : 0));
        matchedKeywords.push(keyword.term);
      }
      return [{ evidence: structuredClone(item), score, matchedKeywords }];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        Date.parse(right.evidence.publishedAt) - Date.parse(left.evidence.publishedAt) ||
        (left.evidence.id < right.evidence.id ? -1 : left.evidence.id > right.evidence.id ? 1 : 0),
    );
}
