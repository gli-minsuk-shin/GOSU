import { it, expect, vi } from 'vitest';
import { isMinimalConversationRequest, selectRequestContext } from './request-context-selection';
import { prepareConversationContext, historyPlan } from './briefing-context';
import { createCodexModelCatalog } from '@gosu/contracts';
const model = createCodexModelCatalog([
  { id: 'test', model: 'test', displayName: 'Test', isDefault: true, contextWindowTokens: 1000000 },
]).models[0]!;
const messages = Array.from({ length: 160 }, (_, i) => ({
  role: i % 2 ? ('assistant' as const) : ('user' as const),
  text:
    (i === 4 ? 'Hessian special derivation ' : 'Old experiment notes ') + 'evidence '.repeat(500),
  createdAt: '2026-09-14T00:00:00Z',
}));
it('recognizes only literal greetings, never short approvals or substantive status requests', () => {
  for (const query of ['안녕', '살아있나?', 'Hello!', '고마워'])
    expect(isMinimalConversationRequest(query)).toBe(true);
  for (const query of [
    '응',
    '계속',
    '서버 살아있나?',
    '진행 상황',
    'Hi, explain the model',
    '아까 그 논문',
    '고마워. 이제 실행해',
  ])
    expect(isMinimalConversationRequest(query)).toBe(false);
});
it('keeps original messages and checkpoints untouched while omitting history for a greeting without extra LLM work', async () => {
  const before = structuredClone(messages),
    compact = vi.fn(),
    save = vi.fn();
  const full = historyPlan(model, messages, 'fixed safety instructions');
  const light = await prepareConversationContext(
    model,
    messages,
    'fixed safety instructions',
    undefined,
    compact,
    save,
    '살아있나?',
  );
  expect(light.history).toEqual([]);
  expect(light.report.omittedMessages).toBe(160);
  expect(light.report.selectionMode).toBe('minimal');
  expect(light.report.estimatedInputTokens).toBeLessThan(full.report.estimatedInputTokens * 0.01);
  expect(compact).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(messages).toEqual(before);
  console.info(
    JSON.stringify({
      syntheticHistoryEstimateBefore: full.report.estimatedInputTokens,
      after: light.report.estimatedInputTokens,
    }),
  );
});
it('keeps complete recent turns and relevant older evidence within budget in original order', () => {
  const selected = selectRequestContext(messages, 'Hessian special derivation');
  expect(selected.mode).toBe('focused');
  expect(selected.indices).toContain(4);
  expect(selected.indices).toContain(5);
  expect(selected.indices).toContain(158);
  expect(selected.indices).toContain(159);
  expect(selected.indices.length).toBeLessThan(160);
  expect(selected.indices).toEqual([...selected.indices].sort((a, b) => a - b));
  for (const i of selected.indices) expect(selected.indices).toContain(i % 2 ? i - 1 : i + 1);
  expect(selectRequestContext(messages, '전체 대화 분석').mode).toBe('full');
});
it('does not drop an oversized most-recent turn or select irrelevant old context instead', () => {
  const recent = [
    ...messages,
    { role: 'user' as const, text: 'x'.repeat(150000), createdAt: '2026-09-14T00:00:00Z' },
  ];
  expect(selectRequestContext(recent, '이것 분석해줘').mode).toBe('full');
});
