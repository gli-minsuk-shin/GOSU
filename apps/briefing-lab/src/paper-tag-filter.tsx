import { useEffect, useId, useRef, useState } from 'react';
import { paperTagKey } from './paper-tags';

export function PaperTagFilter({
  tags,
  selected,
  onChange,
}: {
  tags: { label: string; count: number }[];
  selected: readonly string[];
  onChange: (tags: string[]) => void;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = (restoreFocus = false) => {
    setOpen(false);
    setSearch('');
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const key = paperTagKey(search).toLocaleLowerCase();
  const visible = tags.filter((tag) => paperTagKey(tag.label).toLocaleLowerCase().includes(key));
  return (
    <div
      ref={root}
      className="briefing-paper-tag-filter"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          close(true);
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="briefing-paper-tag-trigger"
        aria-label="논문 태그 선택"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-selected={selected.length > 0}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M3 4h8l10 10-7 7L3 10V4Z" strokeLinejoin="round" />
          <circle cx="7.5" cy="8" r="1" />
        </svg>
        <span>태그</span>
        {selected.length > 0 && (
          <span className="briefing-paper-tag-count">{selected.length}개 선택</span>
        )}
        <svg
          className="briefing-paper-tag-chevron"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <section className="briefing-paper-tag-panel" id={id} aria-label="논문 태그 목록">
          <header>
            <strong>
              태그로 찾기{' '}
              <small>{selected.length ? `${selected.length}개 선택` : `${tags.length}개`}</small>
            </strong>
            <button
              type="button"
              aria-label="태그 선택 닫기"
              className="briefing-paper-tag-close"
              onClick={() => close(true)}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="m4 4 8 8m0-8-8 8" />
              </svg>
            </button>
          </header>
          <p>여러 개 선택 가능 · 선택한 태그 중 하나라도 포함</p>
          <input
            type="search"
            autoFocus
            aria-label="태그 검색"
            placeholder="태그 검색 · LLM, 최적화…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="briefing-paper-tag-grid" role="group" aria-label="선택할 태그">
            {visible.map(({ label, count }) => {
              const checked = selected.some((tag) => paperTagKey(tag) === paperTagKey(label));
              return (
                <label
                  key={paperTagKey(label)}
                  className="briefing-paper-tag-option"
                  data-selected={checked}
                >
                  <input
                    type="checkbox"
                    aria-label={`태그: ${label}`}
                    checked={checked}
                    onChange={(event) =>
                      onChange(
                        event.target.checked
                          ? [...selected, label]
                          : selected.filter((tag) => paperTagKey(tag) !== paperTagKey(label)),
                      )
                    }
                  />
                  <span>{label}</span>
                  <small title={`이 태그가 있는 저장 논문 ${count}편`}>{count}</small>
                </label>
              );
            })}
            {!visible.length && (
              <p className="briefing-paper-tag-empty">
                {tags.length ? '검색한 태그가 없습니다.' : '저장된 태그가 없습니다.'}
              </p>
            )}
          </div>
          <footer>
            <span>기존 태그에서 선택 · 논문 수 표시</span>
            <button type="button" disabled={!selected.length} onClick={() => onChange([])}>
              선택 초기화
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
