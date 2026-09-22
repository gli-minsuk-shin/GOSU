import type { ReactNode } from 'react';
/** Close only this disclosure. Keep its contents mounted and focus the visible title. */
export function collapseReadingBlock(button: HTMLElement) {
  const block = button.closest<HTMLDetailsElement>('details');
  if (!block?.open) return false;
  const summary = block.querySelector<HTMLElement>(':scope > summary');
  const scroller = block.closest<HTMLElement>('.briefing-main-scroll');
  summary?.focus({ preventScroll: true });
  block.open = false;
  block.dispatchEvent(new Event('toggle'));
  if (summary && scroller) {
    scroller.scrollTo({
      top: Math.max(
        0,
        scroller.scrollTop +
          summary.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          12,
      ),
      behavior: 'auto',
    });
  }
  return true;
}

/** The open section's left accent bar closes it too, like the − icon, and returns to its title. */
export function BriefingSectionRail({ label, className }: { label: string; className?: string }) {
  return (
    <button
      type="button"
      className={className ? `briefing-section-rail ${className}` : 'briefing-section-rail'}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        collapseReadingBlock(event.currentTarget);
      }}
    />
  );
}

export function BriefingBottomCollapse({
  label,
  leadingAction,
}: {
  label: string;
  leadingAction?: ReactNode;
}) {
  return (
    <div className="briefing-bottom-collapse">
      {leadingAction}
      <button
        type="button"
        aria-label={label}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          collapseReadingBlock(event.currentTarget);
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
          <path d="m7 14 5-5 5 5" />
        </svg>
        {label}
      </button>
    </div>
  );
}
