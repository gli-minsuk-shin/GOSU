import { createHash } from 'node:crypto';
import { savedPaperKey, type SavedPaper } from './src/paper-library-index';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const classificationKey = (routineId: string, paper: SavedPaper) =>
  digest(
    paper.historyId.startsWith('shared:')
      ? ['shared', paper.item.id]
      : ['routine', routineId, Boolean(paper.private), savedPaperKey(paper.item)],
  );
export function classificationText(item: SavedPaper['item']) {
  return {
    title: item.title,
    summary: item.summary,
    researchQuestion: item.researchQuestion ?? '',
    strengths: item.strengths ?? '',
    limitations: item.limitations ?? '',
    methodsAndAssumptions: item.methodsAndAssumptions ?? '',
    reportedResults: item.reportedResults ?? '',
    detail: item.detail ?? '',
    keywords: item.keywords ?? [],
    readScope: item.readScope,
  };
}
export const classificationDigest = (item: SavedPaper['item']) => digest(classificationText(item));
export function classificationInput(item: SavedPaper['item']) {
  const full = classificationText(item);
  let remaining = 22000,
    inputTruncated = false;
  const bounded = Object.fromEntries(
    Object.entries(full).map(([key, value]) => {
      if (typeof value !== 'string') return [key, value];
      const limit = Math.min(remaining, key === 'detail' ? 12000 : 3200);
      const text = value.slice(0, limit);
      remaining -= text.length;
      inputTruncated ||= text.length !== value.length;
      return [key, text];
    }),
  );
  return { ...bounded, inputTruncated };
}
