import { expect, it, vi } from 'vitest';
import { classifySavedPaperTexts } from './paper-classification';
import {
  classificationDigest,
  classificationInput,
  classificationKey,
} from './paper-classification-data';
import type { runRoutineWithGosuLanguage } from './briefing-native';
const item = {
  id: 'p',
  title: 'A new method',
  summary: '요약',
  readScope: 'abstract',
  importance: 'medium',
  relevance: '',
  researchQuestion: '인과 추론에서 추정의 불확실성을 다룹니다.',
  methodsAndAssumptions: '조건부 독립과 베이지안 추정',
  detail: 'Detailed saved analysis',
};
const selection = { providerId: 'codex' as const, modelId: 'fixture', reasoning: 'medium' };
it('classifies from stored scientific summary fields using one zero-tool job and a fixed category enum', async () => {
  const run = vi.fn<typeof runRoutineWithGosuLanguage>().mockResolvedValue({
    answer: JSON.stringify({
      items: [
        { id: 'p0', categoryId: 'statistics', reason: '저장 요약의 핵심이 인과 추론입니다.' },
      ],
    }),
    providerId: 'codex',
    model: 'fixture',
    reasoning: 'medium',
    proposal: null,
    nextDates: [],
  });
  const guard = vi.fn(async () => undefined);
  const result = await classifySavedPaperTexts(
    [item],
    selection,
    new AbortController().signal,
    () => undefined,
    guard,
    run,
  );
  expect(result.items[0]?.categoryId).toBe('statistics');
  expect(run).toHaveBeenCalledOnce();
  const job = run.mock.calls[0]?.[3]?.structuredJob;
  expect(job?.prompt).toContain(item.methodsAndAssumptions);
  expect(job?.prompt).toContain(item.detail);
  expect(job?.tools).toBeUndefined();
  expect(job?.instructions).toContain('UNTRUSTED');
  expect(guard).toHaveBeenCalledTimes(2);
});
it('rejects invented categories or missing/mismatched ids without an automatic second inference', async () => {
  const run = vi.fn<typeof runRoutineWithGosuLanguage>().mockResolvedValue({
    answer: JSON.stringify({ items: [{ id: 'other', categoryId: 'invented', reason: '' }] }),
    providerId: 'codex',
    model: 'fixture',
    reasoning: null,
    proposal: null,
    nextDates: [],
  });
  await expect(
    classifySavedPaperTexts(
      [item],
      selection,
      new AbortController().signal,
      () => undefined,
      async () => undefined,
      run,
    ),
  ).rejects.toThrow();
  expect(run).toHaveBeenCalledOnce();
});
it('classification identity ignores cosmetic tags and importance but detects changed saved scientific content', () => {
  const original = classificationDigest(item);
  expect(classificationDigest({ ...item, importance: 'high', tags: ['New tag'] })).toBe(original);
  expect(classificationDigest({ ...item, reportedResults: 'A new saved result' })).not.toBe(
    original,
  );
});
it('keeps routine, private and exact paper-version classification identities isolated', () => {
  const paper = {
    historyId: 'h',
    savedAt: '2026-09-10',
    item: { ...item, sourceUrl: 'https://arxiv.org/abs/2609.00001v1' },
  };
  const key = classificationKey('r', paper);
  expect(classificationKey('other', paper)).not.toBe(key);
  expect(classificationKey('r', { ...paper, private: true })).not.toBe(key);
  expect(
    classificationKey('r', {
      ...paper,
      item: { ...paper.item, sourceUrl: 'https://arxiv.org/abs/2609.00001v2' },
    }),
  ).not.toBe(key);
});
it('bounds long saved analysis input, marks truncation and hashes the entire untruncated summary', () => {
  const long = { ...item, detail: 'x'.repeat(64000) };
  const input = classificationInput(long);
  expect(input.inputTruncated).toBe(true);
  expect(JSON.stringify(input).length).toBeLessThan(25000);
  expect(classificationDigest({ ...long, detail: long.detail + 'changed tail' })).not.toBe(
    classificationDigest(long),
  );
  expect(
    JSON.stringify(
      classificationInput({
        ...item,
        relevance: 'Private preference',
        action: 'Private action',
        importanceReason: 'Private context',
      }),
    ),
  ).not.toContain('Private');
});
it('does not invoke the provider after cancellation or a failed permission guard', async () => {
  const run = vi.fn<typeof runRoutineWithGosuLanguage>();
  const c = new AbortController();
  c.abort();
  await expect(
    classifySavedPaperTexts(
      [item],
      selection,
      c.signal,
      () => undefined,
      async () => undefined,
      run,
    ),
  ).rejects.toThrow('source_cancelled');
  await expect(
    classifySavedPaperTexts(
      [item],
      selection,
      new AbortController().signal,
      () => undefined,
      async () => {
        throw new Error('revoked');
      },
      run,
    ),
  ).rejects.toThrow('revoked');
  expect(run).not.toHaveBeenCalled();
});
