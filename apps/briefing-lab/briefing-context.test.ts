import { expect, it, vi } from 'vitest';
import { createCodexModelCatalog } from '@gosu/contracts';
import {
  historyPlan,
  prepareConversationContext,
  conversationDigest,
  searchConversationRecords,
} from './briefing-context';
import { codexTokenUsage, claudeTokenUsage } from './briefing-token-usage';
import { contextRemaining, type ContextUsage } from './src/context-usage';
const model = (window: number) =>
  createCodexModelCatalog([
    {
      id: 'test',
      model: 'test',
      displayName: 'Test',
      isDefault: true,
      contextWindowTokens: window,
    },
  ]).models[0]!;
const messages = Array.from({ length: 200 }, (_, i) => ({
  role: i % 2 ? ('assistant' as const) : ('user' as const),
  text: `Important exact fact ${i}`,
  createdAt: '2026-09-13T00:00:00Z',
}));
it('learns the effective expanded limit only from matching execution settings and discards stale capacity, not messages', () => {
  const selected = createCodexModelCatalog([
    {
      id: 'gpt-6-astra',
      model: 'gpt-6-astra',
      displayName: 'Astra',
      isDefault: true,
      nativeMaxContextWindowTokens: 872000,
      nativeEffectiveContextPercent: 95,
    },
  ]).models[0]!;
  const base = historyPlan(selected, [], 'test').report;
  const native = {
    inputTokens: 100,
    outputTokens: 10,
    totalTokens: 110,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    contextTokens: 110,
    contextWindowTokens: 997500,
  };
  const record = {
    ...messages[0]!,
    invocation: { providerId: 'codex' as const, model: 'gpt-6-astra', reasoning: null },
    contextUsage: { ...base, native },
  };
  const expanded = historyPlan(selected, [record], 'test');
  expect(expanded.report.windowTokens).toBe(997500);
  expect(expanded.report.requestedWindowTokens).toBe(1050000);
  expect(expanded.history).toHaveLength(1);
  expect(
    historyPlan(
      selected,
      [{ ...record, contextUsage: { ...base, contextConfigurationKey: 'old', native } }],
      'test',
    ).report.windowTokens,
  ).toBe(828400);
});
it('searches complete preserved text and lets the agent page beyond the visible excerpt', () => {
  const source = [{ ...messages[0]!, text: 'a'.repeat(13000) + 'exact-older-formula' }];
  const found = searchConversationRecords(source, 'exact-older-formula');
  expect(found.totalMatches).toBe(1);
  expect(found.messages[0]?.nextOffset).toBe(8000);
  expect(searchConversationRecords(source, '', '0', '8000').messages[0]?.text).toContain(
    'exact-older-formula',
  );
  expect(() => searchConversationRecords(source, '', '-1')).toThrow();
  expect(
    JSON.stringify(
      searchConversationRecords(
        Array.from({ length: 8 }, () => ({ ...source[0]!, text: '\u0001'.repeat(64000) })),
        '',
      ),
    ).length,
  ).toBeLessThan(80000);
});
it('uses a token budget instead of the six-message cap and does not compact a fitting conversation', async () => {
  const compact = vi.fn(),
    save = vi.fn();
  const result = await prepareConversationContext(
    model(1050000),
    messages,
    'fixed instructions',
    undefined,
    compact,
    save,
  );
  expect(result.history).toHaveLength(200);
  expect(result.history[0]?.text).toContain('fact 0');
  expect(result.report.omittedMessages).toBe(0);
  expect(compact).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
it('compacts only under pressure, preserves raw records, and resumes a validated checkpoint', async () => {
  const source = messages.map((m) => ({ ...m, text: m.text + ' evidence'.repeat(100) }));
  const original = JSON.stringify(source);
  const save = vi.fn();
  const result = await prepareConversationContext(
    model(32000),
    source,
    'fixed',
    undefined,
    async () => 'Remember exact fact 0. Prior hypotheses remain unverified.',
    save,
  );
  expect(save).toHaveBeenCalledOnce();
  expect(result.report.compressedMessages).toBeGreaterThan(0);
  expect(result.report.omittedMessages).toBe(0);
  expect(result.history.at(-1)?.text).toContain('fact 199');
  expect(JSON.stringify(source)).toBe(original);
  const checkpoint = save.mock.calls[0]![0];
  expect(checkpoint.digest).toBe(conversationDigest(source.slice(0, checkpoint.through)));
  const again = vi.fn();
  await prepareConversationContext(model(32000), source, 'fixed', checkpoint, again, save);
  expect(again).not.toHaveBeenCalled();
});
it('does not overwrite history/checkpoints when compression fails or reuse an invalid prefix', async () => {
  const source = messages.map((m) => ({ ...m, text: m.text.repeat(200) }));
  const save = vi.fn();
  await expect(
    prepareConversationContext(
      model(32000),
      source,
      'fixed',
      undefined,
      async () => {
        throw new Error('provider_unavailable');
      },
      save,
    ),
  ).rejects.toThrow('provider_unavailable');
  expect(save).not.toHaveBeenCalled();
  expect(
    historyPlan(model(1050000), messages, '', {
      through: 5,
      digest: 'a'.repeat(64),
      summary: 'wrong context',
      createdAt: '2026-09-13T00:00:00Z',
    }).report.compressedMessages,
  ).toBe(0);
});
it('keeps cumulative usage separate from current context and preserves missing values', () => {
  const native = codexTokenUsage({
    total: {
      inputTokens: 500000,
      outputTokens: 10000,
      cachedInputTokens: 300000,
      totalTokens: 510000,
    },
    last: { totalTokens: 12000 },
    modelContextWindow: 1050000,
  })!;
  expect(native.contextTokens).toBe(12000);
  expect(native.totalTokens).toBe(510000);
  expect(native.reasoningTokens).toBeNull();
  expect(claudeTokenUsage({ inputTokens: 500000, outputTokens: 10000 })?.contextTokens).toBeNull();
  expect(codexTokenUsage({ total: { inputTokens: -1, outputTokens: 0 } })).toBeUndefined();
  const usage: ContextUsage = { ...historyPlan(model(1050000), messages, '').report, native };
  expect(contextRemaining(usage)).toMatchObject({ used: 12000, limit: 1050000, reported: true });
  expect(
    contextRemaining({ ...usage, native: { ...native, contextTokens: null, contextStale: true } })
      .remaining,
  ).toBeNull();
  expect(
    contextRemaining({ ...usage, native: undefined, windowSource: 'fallback' }).limit,
  ).toBeNull();
});
