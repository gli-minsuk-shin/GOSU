import { readFileSync } from 'node:fs';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { ContextUsageMeter, contextDetailPlacement } from './context-usage-meter';
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
    // Closed at rest: the details are a popover that the chip opens, not an open block.
    expect(ui.root.findByProps({ className: 'briefing-context-chip' }).props['aria-expanded']).toBe(
      false,
    );
    expect(ui.root.findByProps({ className: 'briefing-context-detail' }).props.popover).toBe(
      'auto',
    );
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
    // The summary is a short chip ("문맥 1%"); the exact current-context size is in its tooltip and
    // at the top of the details, never the cumulative 500,000 input tokens.
    const summary = ui.root.findByProps({ className: 'briefing-context-chip' });
    expect(summary.props.title).toContain('12,000');
    expect(summary.props.title).not.toContain('500,000');
    expect(JSON.stringify(summary.findAllByType('span')[0]!.children)).toContain('1%');
    expect(ui.root.findByType('strong').children.join('')).toContain('12,000');
    expect(JSON.stringify(ui.toJSON())).toContain('실측');
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});

const sample: ContextUsage = {
  windowTokens: 1050000,
  windowSource: 'configured',
  estimatedInputTokens: 9000,
  outputReserveTokens: 128000,
  toolReserveTokens: 128000,
  totalMessages: 12,
  includedMessages: 12,
  compressedMessages: 0,
  omittedMessages: 0,
};

// 2026-09-21 user report: "AI 비서나 project AI chat 에서 context 사용량 버튼을 눌러도 추가 정보가
// 안나옴". The details were `position: absolute` against whatever positioned ancestor the host
// happened to have: the assistant's input box (`overflow: hidden`, so they were clipped away) and the
// whole Project Chat shell (so they were laid out above the window). They now open in the top layer
// and are placed from the chip itself, which no container can clip.
it('opens its details in the top layer, placed from the chip, so no chat container can clip them', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const listeners: string[] = [];
  vi.stubGlobal('window', {
    innerWidth: 680,
    innerHeight: 843,
    addEventListener: (type: string) => listeners.push(`+${type}`),
    removeEventListener: (type: string) => listeners.push(`-${type}`),
  });
  const style: Record<string, string> = {};
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(<ContextUsageMeter usage={sample} busy={false} />, {
        createNodeMock: (element) =>
          element.type === 'button'
            ? { getBoundingClientRect: () => ({ left: 500, right: 580, top: 700, bottom: 722 }) }
            : { style },
      });
    });
    const chip = () => ui.root.findByProps({ className: 'briefing-context-chip' });
    const panel = () => ui.root.findByProps({ className: 'briefing-context-detail' });
    // The browser toggles the popover from the chip itself (light dismiss and Escape included).
    expect(chip().props.type).toBe('button');
    expect(chip().props.popoverTarget).toBe(panel().props.id);
    expect(chip().props['aria-controls']).toBe(panel().props.id);
    expect(panel().props.popover).toBe('auto');
    expect(panel().props.role).toBe('dialog');
    // Placed just before it is shown: above the chip, inside the window, never wider than it.
    await act(() => panel().props.onBeforeToggle({ newState: 'open' }));
    expect(style).toEqual({
      width: '380px',
      left: '292px',
      top: 'auto',
      bottom: '149px',
      maxHeight: '420px',
    });
    await act(() => panel().props.onToggle({ newState: 'open' }));
    expect(chip().props['aria-expanded']).toBe(true);
    expect(listeners).toEqual(['+resize']);
    await act(() => panel().props.onToggle({ newState: 'closed' }));
    expect(chip().props['aria-expanded']).toBe(false);
    expect(listeners).toEqual(['+resize', '-resize']);
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});

it('places the details above the chip when there is room, below it otherwise, always inside the window', () => {
  const viewport = { width: 680, height: 843 };
  expect(
    contextDetailPlacement({ left: 500, right: 580, top: 700, bottom: 722 }, viewport),
  ).toEqual({ width: 380, left: 292, top: null, bottom: 149, maxHeight: 420 });
  // A chip at the top of a short window opens downward.
  expect(contextDetailPlacement({ left: 12, right: 92, top: 20, bottom: 42 }, viewport)).toEqual({
    width: 380,
    left: 12,
    top: 48,
    bottom: null,
    maxHeight: 420,
  });
  // A narrow panel: the details take the width that is there and keep an 8px margin.
  expect(
    contextDetailPlacement(
      { left: 200, right: 280, top: 500, bottom: 522 },
      { width: 300, height: 600 },
    ),
  ).toEqual({ width: 284, left: 8, top: null, bottom: 106, maxHeight: 420 });
});

it('keeps the details out of every host layout: fixed in the top layer, hidden until opened', () => {
  const css = readFileSync(new URL('./context-usage-meter.css', import.meta.url), 'utf8');
  const detail = css.split('.briefing-context-detail {')[1]!.split('}')[0]!;
  expect(detail).toContain('position: fixed');
  expect(detail).toContain('inset: auto');
  expect(detail).toContain('margin: 0');
  // The component sets the width in pixels; padding and border must be inside it.
  expect(detail).toContain('box-sizing: border-box');
  // A popover takes the system text color unless it is given one.
  expect(detail).toMatch(/\n {2}color: /u);
  expect(css).not.toContain('position: absolute');
  expect(css).toMatch(/\.briefing-context-detail:not\(:popover-open\) \{\s*display: none;/u);
});
it('tells the reader, where the context size is shown, how to shorten it', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(
        <ContextUsageMeter
          busy={false}
          usage={{
            windowTokens: 272000,
            windowSource: 'provider',
            estimatedInputTokens: 210000,
            outputReserveTokens: 8000,
            toolReserveTokens: 8000,
            totalMessages: 120,
            includedMessages: 120,
            compressedMessages: 0,
            omittedMessages: 0,
          }}
        />,
      );
    });
    const hint = ui.root.findByProps({ className: 'briefing-context-commands-hint' });
    const text = hint.children.flatMap((child) =>
      typeof child === 'string' ? [child] : child.children.map(String),
    );
    expect(text.join('')).toContain('/compact');
    expect(text.join('')).toContain('/new');
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});
