import type { BriefingWorkspaceStore } from './briefing-workspace-store';
import { indexSavedPapers, matchesSavedPaper } from './src/paper-library-index';
import { curateHistoryTags } from './briefing-paper-tags';

/** Host-injected store; no browser tokens, global grants or provider-specific implementation.
 * A future GOSU host must establish its own trusted owner context and retain these checks.
 */
export async function readSavedPaperLibrary(
  workspace: BriefingWorkspaceStore,
  routineId: string,
  signal: AbortSignal,
  query = '',
) {
  const profile = await workspace.profile(routineId);
  if (!profile || !workspace.owns(profile)) throw new Error('assistant_client_required');
  const privateAllowed =
    !workspace.requiresPerRequestConfirmation(profile) &&
    (await workspace.canPrivateAi(routineId, profile.preferences.providerId));
  const history = await workspace.summaryHistory(routineId);
  const papers = await workspace.visibleLibraryPapers(
    routineId,
    indexSavedPapers(curateHistoryTags(history.filter((h) => !h.private || privateAllowed))).filter(
      (p) => matchesSavedPaper(p, query),
    ),
  );
  if (signal.aborted) throw new Error('source_cancelled');
  const current = await workspace.profile(routineId);
  if (!current || !workspace.owns(current) || JSON.stringify(current) !== JSON.stringify(profile))
    throw new Error('assistant_settings_changed');
  return {
    papers,
    privateOmitted:
      !privateAllowed && history.some((h) => h.private && indexSavedPapers([h]).length > 0),
  };
}
