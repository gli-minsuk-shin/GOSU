import { BriefingWorkspaceStore } from '../briefing-workspace-store';
import { createPaperSearcher, parseArxiv } from '../live-public-sources';
import { publicSourceText } from '../live-public-http';
import { auditPaperCandidates } from '../paper-discovery-audit';
import { summarizedPaperKeys } from '../new-paper-results';

// Explicit read-only diagnosis: one bounded public request, no mail/LLM calls or settings writes.
const store = new BriefingWorkspaceStore();
const profile = await store.profile('personal-research');
if (!profile) throw Error('Profile missing');
const history = await store.summaryHistory(profile.routineId);
console.log(
  JSON.stringify({
    savedSourceStatuses: (await store.history(profile.routineId, '', 20))
      .filter((h) => h.snapshot)
      .slice(0, 1)
      .map((h) => h.snapshot!.sources),
    paperDays: profile.live.papers.days,
    paperLimit: profile.live.papers.limit,
    scholarEnabled: profile.live.papers.scholarAlerts !== false,
    mailDays: profile.live.mail?.days,
    mailRead: profile.preferences.mailRead,
    bodyPreview: profile.live.mail?.bodyPreview,
  }),
);
let xml = '';
const search = createPaperSearcher(async (url, signal) => {
  xml = await publicSourceText(url, signal);
  return xml;
});
const now = new Date().toISOString();
try {
  const items = await search(
    profile.interest,
    profile.live.papers,
    AbortSignal.timeout(25000),
    now,
    summarizedPaperKeys(history),
  );
  const candidates = parseArxiv(
    xml,
    profile.interest,
    { ...profile.live.papers, limit: Math.min(60, profile.live.papers.limit * 3) },
    now,
  );
  console.log(
    JSON.stringify(
      auditPaperCandidates(
        {
          kind: 'papers',
          status: items.length ? 'ready' : 'empty',
          items,
          fetchedAt: now,
          note: '',
        },
        candidates,
        history,
      ),
    ),
  );
} catch (e) {
  console.log(
    JSON.stringify({ status: 'unverified', error: e instanceof Error ? e.message : 'unknown' }),
  );
  process.exitCode = 1;
}
