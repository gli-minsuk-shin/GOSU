import { useEffect, useId, useRef, useState } from 'react';

export type BriefingJumpTarget = { kind: 'calendar' | 'email' | 'papers'; id: string };
export const briefingTargetId = (scope: string, kind: BriefingJumpTarget['kind'], id: string) =>
  `briefing-${scope}-${encodeURIComponent(JSON.stringify([kind, id]))}`;

export function revealBriefingTarget(root: HTMLElement, id: string, behavior: ScrollBehavior) {
  // Match literal IDs inside this view; never build a selector from source-controlled text.
  const target = Array.from(root.querySelectorAll<HTMLElement>('[data-briefing-jump-target]')).find(
    (element) => element.id === id,
  );
  const scroller = root.closest<HTMLElement>('.briefing-main-scroll');
  if (!target || !scroller) return null;
  if (target.tagName === 'DETAILS') (target as HTMLDetailsElement).open = true;
  for (
    let parent = target.parentElement;
    parent && root.contains(parent);
    parent = parent.parentElement
  ) {
    if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true;
    if (parent === root) break;
  }
  const disclosure = target.querySelector<HTMLDetailsElement>(
    ':scope > .briefing-email-disclosure, :scope > .briefing-paper-disclosure',
  );
  if (disclosure) disclosure.open = true;
  target.focus({ preventScroll: true });
  scroller.scrollTo({
    top: Math.max(
      0,
      scroller.scrollTop +
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        12,
    ),
    behavior,
  });
  return target;
}

export function useBriefingJump() {
  const scope = useId(),
    root = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLElement | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notice, setNotice] = useState('');
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    active.current?.removeAttribute('data-briefing-jump-active');
    active.current = null;
  };
  useEffect(() => clear, []);
  const jump = (item: BriefingJumpTarget) => {
    clear();
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const target = root.current
      ? revealBriefingTarget(
          root.current,
          briefingTargetId(scope, item.kind, item.id),
          reduced ? 'auto' : 'smooth',
        )
      : null;
    if (!target) {
      setNotice(
        '현재 화면에서 해당 항목을 찾지 못했습니다. 새로 조회된 요약에서 다시 선택해주세요.',
      );
      return;
    }
    setNotice('');
    active.current = target;
    target.setAttribute('data-briefing-jump-active', 'true');
    timer.current = setTimeout(clear, 2500);
  };
  return { scope, root, jump, notice };
}
