import { useState, type RefObject } from 'react';
export const BRIEFING_COLLAPSE_EVENT = 'briefing-collapse-all';

/** Close only this reading pane, including nested evidence; never remount or discard its data. */
export function collapseBriefingBlocks(root: HTMLElement | null) {
  if (!root) return 0;
  const expanded = Array.from(root.querySelectorAll<HTMLDetailsElement>('details[open]')).filter(
    (block) => !block.closest('.briefing-history-summary'),
  );
  for (const block of expanded.reverse()) {
    block.open = false;
    // Synchronize React-owned section state before a later render can restore the old value.
    block.dispatchEvent(new Event('toggle'));
  }
  root.dispatchEvent(new Event(BRIEFING_COLLAPSE_EVENT));
  if (expanded.length) root.scrollTo({ top: 0, behavior: 'auto' });
  return expanded.length;
}

export function BriefingCollapseAll({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const [notice, setNotice] = useState('');
  return (
    <span className="briefing-collapse-control">
      <button
        type="button"
        className="briefing-icon-button briefing-collapse-all"
        aria-label="모두 접기"
        title="History의 AI 요약은 유지하고 나머지 블록 모두 접기"
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          const count = collapseBriefingBlocks(target.current);
          setNotice(
            count ? `펼친 블록 ${count}개를 모두 접었습니다.` : '이미 모든 블록이 접혀 있습니다.',
          );
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m7 4 5 5 5-5M5 12h14m-12 8 5-5 5 5" />
        </svg>
      </button>
      <span className="briefing-collapse-notice" role="status">
        {notice}
      </span>
    </span>
  );
}
