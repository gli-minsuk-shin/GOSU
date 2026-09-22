/**
 * Opening a chat at the place the reader left it.
 *
 * Setting `scrollTop` once, in the commit that first renders the messages, lands in the wrong place:
 * math, web fonts, code blocks and tool panes are still growing the transcript, so a saved offset is
 * clamped short and "the bottom" is the bottom of a transcript that is not complete yet. A pane that
 * was hidden (`display: none`, or an iframe whose host was hidden) has no size at all and its
 * scroll position was reset to the top. So the target is held for a short while: it is applied
 * again whenever the layout changes, until the layout is quiet, the reader scrolls, or time is up.
 */
export type ScrollTarget = Readonly<{ kind: 'bottom' } | { kind: 'offset'; top: number }>;

export type ScrollSettleElement = {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
};

export type ScrollSettleReason = 'quiet' | 'timeout' | 'interrupted';

export type ScrollSettleOptions = Readonly<{
  /** Stop once the layout has not changed for this long. */
  quietMs?: number;
  /** Never hold longer than this. */
  maxMs?: number;
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  onSettled?: (reason: ScrollSettleReason) => void;
}>;

export function scrollTopForTarget(
  target: ScrollTarget,
  element: Pick<ScrollSettleElement, 'scrollHeight' | 'clientHeight'>,
) {
  const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
  if (target.kind === 'bottom' || !Number.isFinite(target.top)) return maximum;
  return Math.min(maximum, Math.max(0, target.top));
}

export function holdScrollTarget(
  element: ScrollSettleElement,
  target: ScrollTarget,
  options: ScrollSettleOptions = {},
) {
  const quietMs = options.quietMs ?? 400;
  const maxMs = options.maxMs ?? 4_000;
  const now = options.now ?? (() => performance.now());
  // Test renderers and workers have no animation frames; a timer keeps the same behavior there.
  const hasFrames = typeof requestAnimationFrame === 'function';
  const requestFrame =
    options.requestFrame ??
    ((callback: () => void) =>
      hasFrames ? requestAnimationFrame(callback) : Number(setTimeout(callback, 16)));
  const cancelFrame =
    options.cancelFrame ??
    ((handle: number) => (hasFrames ? cancelAnimationFrame(handle) : clearTimeout(handle)));
  const startedAt = now();
  let lastChangeAt = startedAt;
  let seenHeight = -1;
  let seenViewport = -1;
  let frame: number | null = null;
  let active = true;

  const apply = () => {
    seenHeight = element.scrollHeight;
    seenViewport = element.clientHeight;
    // A pane without a size cannot be scrolled; the first real size counts as a layout change.
    if (element.clientHeight > 0) element.scrollTop = scrollTopForTarget(target, element);
  };
  const stop = (reason: ScrollSettleReason = 'interrupted') => {
    if (!active) return;
    active = false;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    options.onSettled?.(reason);
  };
  const step = () => {
    frame = null;
    if (!active) return;
    const time = now();
    if (element.scrollHeight !== seenHeight || element.clientHeight !== seenViewport) {
      apply();
      lastChangeAt = time;
    }
    if (time - startedAt >= maxMs) return stop('timeout');
    // Quiet only counts once the pane has a size: a hidden pane is waited for, up to maxMs.
    if (element.clientHeight > 0 && time - lastChangeAt >= quietMs) return stop('quiet');
    frame = requestFrame(step);
  };

  apply();
  frame = requestFrame(step);
  return {
    stop,
    get active() {
      return active;
    },
  };
}

type ResizeObserverLike = new (callback: () => void) => {
  observe(target: unknown): void;
  disconnect(): void;
};

export type ShownScrollElement = ScrollSettleElement & {
  addEventListener(type: string, listener: () => void, options?: unknown): void;
  removeEventListener(type: string, listener: () => void): void;
};

const READER_INPUT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/**
 * A chat that stays mounted while its pane is hidden loses its scroll position: without a box the
 * browser resets `scrollTop`, and nothing re-renders when the pane comes back. This watches the
 * scroller's size and, on the step from "no size" to "has a size", holds the position that
 * `readTarget` returns (null: leave the view alone). The reader's own input ends the hold.
 */
export function restoreScrollWhenShown(
  element: ShownScrollElement,
  readTarget: () => ScrollTarget | null,
  options: ScrollSettleOptions &
    Readonly<{ ResizeObserverCtor?: ResizeObserverLike | undefined }> = {},
) {
  const Observer =
    'ResizeObserverCtor' in options
      ? options.ResizeObserverCtor
      : typeof ResizeObserver === 'function'
        ? (ResizeObserver as unknown as ResizeObserverLike)
        : undefined;
  let hold: ReturnType<typeof holdScrollTarget> | null = null;
  let hadSize = element.clientHeight > 0;
  const release = () => hold?.stop('interrupted');
  const observer = Observer
    ? new Observer(() => {
        const hasSize = element.clientHeight > 0;
        if (hasSize && !hadSize) {
          const target = readTarget();
          if (target) {
            hold?.stop('interrupted');
            hold = holdScrollTarget(element, target, { maxMs: 2_000, ...options });
          }
        }
        hadSize = hasSize;
      })
    : null;
  observer?.observe(element);
  if (observer) {
    for (const type of READER_INPUT_EVENTS)
      element.addEventListener(type, release, { passive: true });
  }
  return {
    get holding() {
      return hold?.active ?? false;
    },
    dispose() {
      observer?.disconnect();
      hold?.stop('interrupted');
      if (observer)
        for (const type of READER_INPUT_EVENTS) element.removeEventListener(type, release);
    },
  };
}
