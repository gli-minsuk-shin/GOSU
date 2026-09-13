import { expect, it, vi } from 'vitest';
import { briefingTargetId, revealBriefingTarget, useBriefingJump } from './briefing-jump';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

it('distinguishes kinds and briefing instances without interpolating source IDs into selectors', () => {
  const id = 'same"]#source';
  expect(briefingTargetId('one', 'email', id)).not.toBe(briefingTargetId('one', 'papers', id));
  expect(briefingTargetId('one', 'email', id)).not.toBe(briefingTargetId('two', 'email', id));
});
function fixture() {
  const scroller = {
    scrollTop: 100,
    getBoundingClientRect: () => ({ top: 40 }),
    scrollTo: vi.fn(),
  };
  const inner = { open: false };
  const root = {
    querySelectorAll: vi.fn(),
    closest: vi.fn(() => scroller),
    contains: vi.fn((node) => node === outer || node === target || node === root),
  };
  const outer = { tagName: 'DETAILS', open: false, parentElement: root };
  const target = {
    id: 'target',
    parentElement: outer,
    querySelector: vi.fn(() => inner),
    getBoundingClientRect: () => ({ top: 350 }),
    focus: vi.fn(),
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
  };
  root.querySelectorAll.mockReturnValue([target]);
  return { root, target, outer, inner, scroller };
}
it('reveals collapsed sections and the item, then focuses and scrolls only the briefing scroller', () => {
  const f = fixture();
  expect(revealBriefingTarget(f.root as unknown as HTMLElement, 'target', 'smooth')).toBe(f.target);
  expect(f.outer.open).toBe(true);
  expect(f.inner.open).toBe(true);
  expect(f.target.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(f.scroller.scrollTo).toHaveBeenCalledWith({ top: 398, behavior: 'smooth' });
  expect(f.root.querySelectorAll).toHaveBeenCalledWith('[data-briefing-jump-target]');
});
it('handles missing targets without opening other items and allows reduced-motion scrolling', () => {
  const f = fixture();
  expect(revealBriefingTarget(f.root as unknown as HTMLElement, 'gone', 'auto')).toBeNull();
  expect(f.scroller.scrollTo).not.toHaveBeenCalled();
  expect(f.outer.open).toBe(false);
  revealBriefingTarget(f.root as unknown as HTMLElement, 'target', 'auto');
  expect(f.scroller.scrollTo).toHaveBeenCalledWith({ top: 398, behavior: 'auto' });
});
it('opens a collapsed source block itself when jumping directly to the section', () => {
  const f = fixture();
  const block = Object.assign(f.target, { tagName: 'DETAILS', open: false });
  revealBriefingTarget(f.root as unknown as HTMLElement, 'target', 'auto');
  expect(block.open).toBe(true);
  expect(f.scroller.scrollTo).toHaveBeenCalled();
});
it('honors reduced motion, removes the transient highlight, and cleans up on unmount', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
  const f = fixture();
  let ui!: ReactTestRenderer;
  function Harness() {
    const nav = useBriefingJump();
    return createElement(
      'div',
      { ref: nav.root, 'data-dest': briefingTargetId(nav.scope, 'email', 'm') },
      createElement('button', { onClick: () => nav.jump({ kind: 'email', id: 'm' }) }, 'Jump'),
    );
  }
  try {
    await act(() => {
      ui = create(createElement(Harness), {
        createNodeMock: (node) => {
          f.target.id = (node.props as { 'data-dest': string })['data-dest'];
          return f.root;
        },
      });
    });
    await act(() => ui.root.findByType('button').props.onClick());
    expect(f.scroller.scrollTo).toHaveBeenCalledWith({ top: 398, behavior: 'auto' });
    expect(f.target.setAttribute).toHaveBeenCalledWith('data-briefing-jump-active', 'true');
    await act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(f.target.removeAttribute).toHaveBeenCalledWith('data-briefing-jump-active');
    await act(() => ui.root.findByType('button').props.onClick());
    await act(() => ui.unmount());
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
