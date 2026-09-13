import type { BriefingHistory } from './briefing-workspace-store';
import type { LiveSourceResult, LiveItem } from './src/live-types';
import { newPaperResults } from './new-paper-results';
/** Read-only diagnostic: compare the returned shortlist with the same response's full candidate pool. */
export function auditPaperCandidates(
  result: LiveSourceResult,
  candidates: LiveItem[],
  history: BriefingHistory[],
) {
  const shortlisted = newPaperResults([result], history)[0]!;
  const pool = newPaperResults([{ ...result, items: candidates }], history)[0]!;
  const failed = result.status === 'failed' || Boolean(result.error);
  return {
    status: failed
      ? 'unverified'
      : pool.items.length > 0 && shortlisted.items.length === 0
        ? 'shortlist_hides_new'
        : 'checked_window',
    returnedCount: result.items.length,
    candidateCount: candidates.length,
    newInShortlist: shortlisted.items.length,
    newInCandidateWindow: pool.items.length,
    hiddenNewCount: Math.max(0, pool.items.length - shortlisted.items.length),
    noNewConfirmedInWindow: !failed && pool.items.length === 0,
  };
}
