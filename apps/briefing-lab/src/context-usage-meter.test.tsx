import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { ContextUsageMeter } from './context-usage-meter';
import type { ContextUsage } from './context-usage';
it('starts compact, labels estimates and unknowns, and never substitutes cumulative input for current context', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const usage: ContextUsage = {
    windowTokens: 1050000,
    windowSource: 'configured',
    requestedWindowTokens: 1050000,
    modelMaximumWindowTokens: 872000,
    modelDefaultWindowTokens: 272000,
    estimatedInputTokens: 9000,
    outputReserveTokens: 128000,
    toolReserveTokens: 128000,
    totalMessages: 200,
    includedMessages: 200,
    compressedMessages: 0,
    omittedMessages: 0,
  };
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(<ContextUsageMeter usage={usage} busy />);
    });
    expect(ui.root.findByType('details').props.open).toBeUndefined();
    expect(JSON.stringify(ui.toJSON())).toContain('추정');
    expect(JSON.stringify(ui.toJSON())).toContain('미제공');
    expect(JSON.stringify(ui.toJSON())).toContain('요청한 문맥 한도');
    expect(JSON.stringify(ui.toJSON())).toContain('자동 감지된 제공자 최대값');
    expect(JSON.stringify(ui.toJSON())).toContain('제공자 보고 대기');
    await act(() =>
      ui.update(
        <ContextUsageMeter
          busy={false}
          usage={{
            ...usage,
            native: {
              inputTokens: 500000,
              outputTokens: 10000,
              totalTokens: 510000,
              cachedInputTokens: 400000,
              reasoningTokens: null,
              contextTokens: 12000,
              contextWindowTokens: 1050000,
            },
          }}
        />,
      ),
    );
    expect(
      JSON.stringify(
        ui.root
          .findByType('summary')
          .children.map((child) => (typeof child === 'string' ? child : child.children)),
      ),
    ).toContain('12,000');
    expect(JSON.stringify(ui.toJSON())).toContain('실측');
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});
