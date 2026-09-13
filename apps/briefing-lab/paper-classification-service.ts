import type { AssistantProfile, BriefingWorkspaceStore } from './briefing-workspace-store';
import { classificationDigest } from './paper-classification-data';
import type { classifySavedPaperTexts } from './paper-classification';
import type { SavedPaper } from './src/paper-library-index';
import { PAPER_TAXONOMY_VERSION, type PaperCategory } from './src/paper-classification';

export async function classificationGuard(
  workspace: BriefingWorkspaceStore,
  profile: AssistantProfile,
  signal: AbortSignal,
  privateAi = false,
) {
  if (signal.aborted) throw new Error('source_cancelled');
  const current = await workspace.profile(profile.routineId);
  if (!current || !workspace.owns(current) || JSON.stringify(current) !== JSON.stringify(profile))
    throw new Error('assistant_settings_changed');
  if (
    privateAi &&
    !(await workspace.canPrivateAi(profile.routineId, profile.preferences.providerId))
  )
    throw new Error('assistant_private_ai_required');
}
export async function classifyResolvedPapers(
  workspace: BriefingWorkspaceStore,
  profile: AssistantProfile,
  papers: SavedPaper[],
  selection: Parameters<typeof classifySavedPaperTexts>[1],
  classifier: typeof classifySavedPaperTexts,
  signal: AbortSignal,
  progress: (detail: string) => void,
) {
  const guard = () =>
    classificationGuard(
      workspace,
      profile,
      signal,
      papers.some((p) => p.private || p.historyId.startsWith('shared:')),
    );
  await guard();
  const output = await classifier(
    papers.map((p) => p.item),
    selection,
    signal,
    progress,
    guard,
  );
  await guard();
  if (output.items.length !== papers.length) throw new Error('paper_classification_invalid');
  return workspace.savePaperClassifications(
    profile,
    papers.map((paper, n) => ({
      paper,
      expectedRevision: paper.item.classification?.revision ?? 0,
      value: {
        taxonomyVersion: PAPER_TAXONOMY_VERSION,
        categoryId: output.items[n]!.categoryId,
        source: 'ai',
        reason: output.items[n]!.reason,
        summaryDigest: classificationDigest(paper.item),
        classifiedAt: new Date().toISOString(),
        inputTruncated: output.items[n]!.inputTruncated,
        invocation: output.invocation,
      },
    })),
    signal,
  );
}
export async function editResolvedPaper(
  workspace: BriefingWorkspaceStore,
  profile: AssistantProfile,
  paper: SavedPaper,
  expectedRevision: number,
  categoryId: PaperCategory,
  signal: AbortSignal,
) {
  await classificationGuard(workspace, profile, signal);
  return workspace.savePaperClassifications(
    profile,
    [
      {
        paper,
        expectedRevision,
        value: {
          taxonomyVersion: PAPER_TAXONOMY_VERSION,
          categoryId,
          source: 'user',
          reason: '사용자가 직접 선택한 분류입니다.',
          summaryDigest: classificationDigest(paper.item),
          classifiedAt: new Date().toISOString(),
        },
      },
    ],
    signal,
  );
}
