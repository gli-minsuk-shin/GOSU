import { describe, expect, it } from 'vitest';
import { holdScrollTarget, restoreScrollWhenShown, scrollTopForTarget } from './scroll-settle.js';

function fakeElement(scrollHeight: number, clientHeight: number) {
  return { scrollTop: 0, scrollHeight, clientHeight };
}

function clock() {
  let now = 0;
  let next = 1;
  const frames = new Map<number, () => void>();
  return {
    now: () => now,
    requestFrame: (callback: () => void) => {
      const handle = next++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle: number) => void frames.delete(handle),
    /** Runs one animation frame, `ms` later. */
    tick(ms = 16) {
      now += ms;
      const due = [...frames.entries()];
      frames.clear();
      for (const [, callback] of due) callback();
    },
    pending: () => frames.size,
  };
}

describe('scroll target', () => {
  it('resolves the bottom and clamps a saved offset to what can be scrolled', () => {
    expect(scrollTopForTarget({ kind: 'bottom' }, fakeElement(1_000, 400))).toBe(600);
    expect(scrollTopForTarget({ kind: 'offset', top: 250 }, fakeElement(1_000, 400))).toBe(250);
    expect(scrollTopForTarget({ kind: 'offset', top: 900 }, fakeElement(1_000, 400))).toBe(600);
    expect(scrollTopForTarget({ kind: 'offset', top: -5 }, fakeElement(1_000, 400))).toBe(0);
    expect(scrollTopForTarget({ kind: 'bottom' }, fakeElement(300, 400))).toBe(0);
  });
});

describe('holding a scroll target while content settles', () => {
  it('re-applies a saved offset that was clamped short because the content had not grown yet', () => {
    const time = clock();
    const element = fakeElement(700, 400);
    const settled: string[] = [];
    const hold = holdScrollTarget(
      element,
      { kind: 'offset', top: 900 },
      {
        ...time,
        onSettled: (reason) => settled.push(reason),
      },
    );

    expect(element.scrollTop).toBe(300);
    element.scrollHeight = 1_500;
    time.tick();
    expect(element.scrollTop).toBe(900);
    expect(hold.active).toBe(true);

    for (let frame = 0; frame < 40; frame += 1) time.tick();
    expect(hold.active).toBe(false);
    expect(settled).toEqual(['quiet']);
    expect(time.pending()).toBe(0);
  });

  it('keeps following the true bottom while messages, math and fonts are still laying out', () => {
    const time = clock();
    const element = fakeElement(800, 400);
    holdScrollTarget(element, { kind: 'bottom' }, time);

    expect(element.scrollTop).toBe(400);
    element.scrollHeight = 2_000;
    time.tick();
    expect(element.scrollTop).toBe(1_600);
    element.scrollHeight = 2_300;
    time.tick();
    expect(element.scrollTop).toBe(1_900);
  });

  it('lets go the moment the user scrolls, and never moves the view again', () => {
    const time = clock();
    const element = fakeElement(800, 400);
    const settled: string[] = [];
    const hold = holdScrollTarget(
      element,
      { kind: 'bottom' },
      {
        ...time,
        onSettled: (reason) => settled.push(reason),
      },
    );

    hold.stop('interrupted');
    element.scrollTop = 120;
    element.scrollHeight = 5_000;
    time.tick();

    expect(element.scrollTop).toBe(120);
    expect(hold.active).toBe(false);
    expect(settled).toEqual(['interrupted']);
  });

  it('waits for a hidden pane to get a size before it applies anything, then settles', () => {
    const time = clock();
    const element = fakeElement(0, 0);
    const hold = holdScrollTarget(element, { kind: 'offset', top: 137 }, time);

    expect(element.scrollTop).toBe(0);
    time.tick();
    element.scrollHeight = 2_000;
    element.clientHeight = 500;
    time.tick();

    expect(element.scrollTop).toBe(137);
    expect(hold.active).toBe(true);
  });

  it('gives up after the maximum time even when the layout never stops changing', () => {
    const time = clock();
    const element = fakeElement(800, 400);
    const settled: string[] = [];
    holdScrollTarget(
      element,
      { kind: 'bottom' },
      {
        ...time,
        maxMs: 1_000,
        onSettled: (reason) => settled.push(reason),
      },
    );

    for (let frame = 0; frame < 80; frame += 1) {
      element.scrollHeight += 10;
      time.tick();
    }

    expect(settled).toEqual(['timeout']);
    expect(time.pending()).toBe(0);
  });
});

describe('restoring a chat when its hidden pane is shown again', () => {
  function observed() {
    let callback: () => void = () => undefined;
    let disconnected = false;
    class FakeResizeObserver {
      constructor(listener: () => void) {
        callback = listener;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    }
    return {
      ResizeObserverCtor: FakeResizeObserver,
      resize: () => callback(),
      disconnected: () => disconnected,
    };
  }
  function pane(scrollHeight: number, clientHeight: number) {
    const listeners = new Map<string, () => void>();
    return {
      scrollTop: 0,
      scrollHeight,
      clientHeight,
      addEventListener: (type: string, listener: () => void) => void listeners.set(type, listener),
      removeEventListener: (type: string) => void listeners.delete(type),
      fire: (type: string) => listeners.get(type)?.(),
      listenerCount: () => listeners.size,
    };
  }

  it('puts the reader back where they were once a hidden pane has a size again', () => {
    const time = clock();
    const fake = observed();
    const element = pane(3_000, 600);
    const restorer = restoreScrollWhenShown(element, () => ({ kind: 'offset', top: 1_200 }), {
      ...time,
      ResizeObserverCtor: fake.ResizeObserverCtor,
    });

    // The host hides the frame: no box, and the browser resets the scroll position.
    element.clientHeight = 0;
    element.scrollTop = 0;
    fake.resize();
    expect(restorer.holding).toBe(false);

    element.clientHeight = 600;
    fake.resize();
    expect(element.scrollTop).toBe(1_200);
    expect(restorer.holding).toBe(true);

    restorer.dispose();
    expect(fake.disconnected()).toBe(true);
    expect(element.listenerCount()).toBe(0);
  });

  it('does nothing for an ordinary resize, when there is no position, or after the reader scrolls', () => {
    const time = clock();
    const fake = observed();
    const element = pane(3_000, 600);
    let target: { kind: 'bottom' } | null = { kind: 'bottom' };
    const restorer = restoreScrollWhenShown(element, () => target, {
      ...time,
      ResizeObserverCtor: fake.ResizeObserverCtor,
    });

    element.clientHeight = 500;
    fake.resize();
    expect(element.scrollTop).toBe(0);

    element.clientHeight = 0;
    fake.resize();
    target = null;
    element.clientHeight = 500;
    fake.resize();
    expect(element.scrollTop).toBe(0);

    element.clientHeight = 0;
    fake.resize();
    target = { kind: 'bottom' };
    element.clientHeight = 500;
    fake.resize();
    expect(element.scrollTop).toBe(2_500);
    element.fire('wheel');
    expect(restorer.holding).toBe(false);
  });

  it('is inert where ResizeObserver does not exist', () => {
    const element = pane(3_000, 600);
    const restorer = restoreScrollWhenShown(element, () => ({ kind: 'bottom' }), {
      ResizeObserverCtor: undefined,
    });

    expect(restorer.holding).toBe(false);
    restorer.dispose();
  });
});
