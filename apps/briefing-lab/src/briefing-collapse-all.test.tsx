import { expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { BriefingCollapseAll, collapseBriefingBlocks } from './briefing-collapse-all';

it('closes nested open blocks in the target pane and synchronizes native toggle state', () => {
  const blocks = Array.from({ length: 4 }, () => ({
    open: true,
    closest: vi.fn(() => null),
    dispatchEvent: vi.fn(),
  }));
  const alreadyClosed = { open: false, dispatchEvent: vi.fn() },
    chat = { open: true };
  const root = {
    querySelectorAll: vi.fn(() => blocks.filter((b) => b.open)),
    scrollTo: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  expect(collapseBriefingBlocks(root as unknown as HTMLElement)).toBe(4);
  expect(blocks.every((b) => !b.open)).toBe(true);
  for (const block of blocks) expect(block.dispatchEvent.mock.calls[0]?.[0].type).toBe('toggle');
  expect(root.querySelectorAll).toHaveBeenCalledWith('details[open]');
  expect(root.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  expect(chat.open).toBe(true);
  expect(alreadyClosed.dispatchEvent).not.toHaveBeenCalled();
  expect(collapseBriefingBlocks(root as unknown as HTMLElement)).toBe(0);
  expect(root.scrollTo).toHaveBeenCalledTimes(1);
  expect(collapseBriefingBlocks(null)).toBe(0);
});
it('preserves the History AI summary and its expanded narrative while closing everything else', () => {
  const summary = { open: true, closest: vi.fn(() => ({})), dispatchEvent: vi.fn() };
  const panels = ['weather', 'calendar', 'email', 'papers'].map(() => ({
    open: true,
    closest: vi.fn(() => null),
    dispatchEvent: vi.fn(),
  }));
  const root = {
    querySelectorAll: vi.fn(() => [summary, ...panels]),
    dispatchEvent: vi.fn(),
    scrollTo: vi.fn(),
  };
  expect(collapseBriefingBlocks(root as unknown as HTMLElement)).toBe(4);
  expect(summary.open).toBe(true);
  expect(summary.dispatchEvent).not.toHaveBeenCalled();
  expect(panels.every((p) => !p.open)).toBe(true);
});
it('is a keyboard-accessible icon action with local completion feedback and safe focus', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = {
    querySelectorAll: vi.fn(() => [
      { open: true, closest: vi.fn(() => null), dispatchEvent: vi.fn() },
    ]),
    scrollTo: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  const target = { current: root as unknown as HTMLDivElement };
  const html = renderToStaticMarkup(<BriefingCollapseAll target={target} />);
  expect(html).toContain('type="button"');
  expect(html).toContain('aria-label="모두 접기"');
  expect(html).toContain('<svg');
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(<BriefingCollapseAll target={target} />);
    });
    const focus = vi.fn();
    await act(() => ui.root.findByType('button').props.onClick({ currentTarget: { focus } }));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(ui.root.findByProps({ role: 'status' }).children.join('')).toContain(
      '1개를 모두 접었습니다',
    );
  } finally {
    await act(() => ui.unmount());
    vi.unstubAllGlobals();
  }
});
