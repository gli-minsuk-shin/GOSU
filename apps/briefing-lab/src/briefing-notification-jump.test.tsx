import { afterEach, expect, it, vi } from 'vitest';
import { createElement, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useBriefingNotificationJump } from './briefing-notification-jump';
import { scrollBriefingElement } from './briefing-jump';
const target = { routineId: 'r', runId: '11111111-1111-4111-8111-111111111111', requestId: 1 };
let ui: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.unstubAllGlobals();
});
function setup() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++id, fn);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  const outer = { scrollTop: 0 },
    scroller = { scrollTop: 100, getBoundingClientRect: () => ({ top: 50 }), scrollTo: vi.fn() };
  const element = {
    getBoundingClientRect: () => ({ top: 450 }),
    focus: vi.fn(),
    scrollIntoView: vi.fn(() => {
      outer.scrollTop = 200;
    }),
  };
  const root = { contains: (e: unknown) => e === element, closest: () => scroller };
  const lookup = vi.fn(() => element);
  vi.stubGlobal('document', { getElementById: lookup });
  function Harness({ requestId = 1, revision = 0 }: { requestId?: number; revision?: number }) {
    const ref = useRef<HTMLDivElement>(null);
    useBriefingNotificationJump(ref, { ...target, requestId }, revision);
    return createElement('div', { ref });
  }
  const tick = async () => {
    const next = frames.entries().next().value;
    if (next) {
      frames.delete(next[0]);
      await act(() => next[1](0));
    }
  };
  return { frames, outer, scroller, element, root, lookup, Harness, tick };
}
it('waits for layout, scrolls only the inner pane, and does not replay a handled alert after history refresh', async () => {
  const f = setup();
  await act(() => {
    ui = create(<f.Harness />, { createNodeMock: () => f.root });
  });
  await f.tick();
  expect(f.scroller.scrollTo).not.toHaveBeenCalled();
  await f.tick();
  expect(f.scroller.scrollTo).toHaveBeenCalledWith({ top: 488, behavior: 'auto' });
  expect(f.element.scrollIntoView).not.toHaveBeenCalled();
  expect(f.outer.scrollTop).toBe(0);
  expect(f.element.focus).toHaveBeenCalledWith({ preventScroll: true });
  await act(() => ui!.update(<f.Harness revision={1} />));
  await f.tick();
  await f.tick();
  expect(f.scroller.scrollTo).toHaveBeenCalledTimes(1);
  await act(() => ui!.update(<f.Harness requestId={2} revision={1} />));
  await f.tick();
  await f.tick();
  expect(f.scroller.scrollTo).toHaveBeenCalledTimes(2);
});
it('retries a missing target after loading and cancels scheduled navigation on unmount', async () => {
  const f = setup();
  f.lookup.mockReturnValueOnce(null as never);
  await act(() => {
    ui = create(<f.Harness />, { createNodeMock: () => f.root });
  });
  await f.tick();
  await f.tick();
  expect(f.scroller.scrollTo).not.toHaveBeenCalled();
  await act(() => ui!.update(<f.Harness revision={1} />));
  await f.tick();
  await f.tick();
  expect(f.scroller.scrollTo).toHaveBeenCalledTimes(1);
  await act(() => ui!.update(<f.Harness requestId={3} />));
  await f.tick();
  await act(() => ui!.unmount());
  ui = undefined;
  expect(f.frames.size).toBe(0);
});
it('does not scroll foreign targets or fall back to document scrolling when a pane is missing', () => {
  const f = setup();
  expect(
    scrollBriefingElement(f.root as unknown as HTMLElement, {} as HTMLElement, 'auto'),
  ).toBeNull();
  expect(
    scrollBriefingElement(
      { ...f.root, closest: () => null } as unknown as HTMLElement,
      f.element as unknown as HTMLElement,
      'auto',
    ),
  ).toBeNull();
  expect(f.scroller.scrollTo).not.toHaveBeenCalled();
});
