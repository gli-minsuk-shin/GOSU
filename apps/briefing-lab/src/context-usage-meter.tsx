import { useEffect, useId, useRef, useState } from 'react';
import { contextRemaining, type ContextUsage } from './context-usage';
import './context-usage-meter.css';
const n = (value: number | null | undefined) =>
  value === null || value === undefined ? '미제공' : value.toLocaleString('ko-KR');

/**
 * Where the details go, in window coordinates: above the chip when there is room (the chip sits at
 * the bottom of a chat), below it otherwise, never wider than the window and always 8px inside it.
 */
export function contextDetailPlacement(
  chip: Readonly<{ left: number; right: number; top: number; bottom: number }>,
  viewport: Readonly<{ width: number; height: number }>,
) {
  const margin = 8,
    gap = 6;
  const width = Math.min(380, viewport.width - margin * 2);
  const left = Math.max(margin, Math.min(chip.left, viewport.width - width - margin));
  const above = chip.top - gap - margin;
  const below = viewport.height - chip.bottom - gap - margin;
  const height = (room: number) => Math.max(120, Math.min(420, room));
  return above >= 200 || above >= below
    ? { width, left, top: null, bottom: viewport.height - chip.top + gap, maxHeight: height(above) }
    : { width, left, top: chip.bottom + gap, bottom: null, maxHeight: height(below) };
}

/**
 * The context chip of a chat composer and its details. The details are a popover: they open in the
 * browser's top layer and are placed from the chip's own position, because every host wraps the
 * chip differently (the assistant's input box clips its content, Project Chat's shell is the only
 * positioned ancestor) and an absolutely positioned panel was clipped away or laid out above the
 * window there. The chip is the popover's declared invoker, so the browser handles toggling, light
 * dismiss and Escape.
 */
export function ContextUsageMeter({
  usage,
  busy,
}: {
  usage?: ContextUsage | undefined;
  busy: boolean;
}) {
  const id = `context-usage-${useId().replaceAll(':', '')}`;
  const chip = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const place = () => {
    if (typeof window === 'undefined' || !chip.current || !panel.current) return;
    const spot = contextDetailPlacement(chip.current.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    const style = panel.current.style;
    style.width = `${spot.width}px`;
    style.left = `${spot.left}px`;
    style.top = spot.top === null ? 'auto' : `${spot.top}px`;
    style.bottom = spot.bottom === null ? 'auto' : `${spot.bottom}px`;
    style.maxHeight = `${spot.maxHeight}px`;
  };
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const target = window;
    target.addEventListener?.('resize', place);
    return () => target.removeEventListener?.('resize', place);
    // `place` only reads refs, so the listener of the render that opened the details stays valid.
  }, [open]);
  if (!usage)
    return (
      <small className="briefing-context-empty" title="토큰 사용량은 요청 후 표시됩니다">
        문맥 · 요청 후 표시
      </small>
    );
  const { limit, used, remaining, reported } = contextRemaining(usage);
  const percent = limit && used !== null ? Math.min(100, Math.round((used / limit) * 100)) : null;
  const full = `${busy ? '현재 요청' : '최근 요청'} ${reported ? '문맥 ' : '시작 문맥 추정 약 '}${n(used)} / ${limit ? n(limit) : '한도 미확인'}${percent !== null ? ` · ${percent}%` : ''}`;
  const basis = used === null ? '재측정 대기' : reported ? '실측' : '추정';
  // A small chip in the composer's action row; the full numbers are in its tooltip and details.
  return (
    <span className="briefing-context-meter" data-open={open ? '' : undefined}>
      <button
        ref={chip}
        type="button"
        className="briefing-context-chip"
        title={`${full} · ${basis}`}
        popoverTarget={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
      >
        <span>문맥 {percent !== null ? `${percent}%` : used === null ? '' : n(used)}</span>
        <span>{basis} ⌄</span>
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="문맥 사용량 상세"
        className="briefing-context-detail"
        onBeforeToggle={(event) => {
          if (event.newState === 'open') place();
        }}
        onToggle={(event) => setOpen(event.newState === 'open')}
      >
        <strong>{full}</strong>
        {percent !== null && <progress aria-label="문맥 사용률" value={percent} max={100} />}
        <dl>
          {usage.selectionMode && (
            <div>
              <dt>문맥 선택</dt>
              <dd>
                {usage.selectionMode === 'minimal'
                  ? '인사 · 최소 문맥'
                  : usage.selectionMode === 'focused'
                    ? '관련 이력 선택 · 원본 보존'
                    : '전체 이력'}
              </dd>
            </div>
          )}
          {usage.requestedWindowTokens && (
            <div>
              <dt>요청한 문맥 한도</dt>
              <dd>{n(usage.requestedWindowTokens)} 토큰</dd>
            </div>
          )}
          {usage.modelMaximumWindowTokens && (
            <div>
              <dt>자동 감지된 제공자 최대값</dt>
              <dd>{n(usage.modelMaximumWindowTokens)} 토큰</dd>
            </div>
          )}
          {usage.modelDefaultWindowTokens && (
            <div>
              <dt>모델 기본 문맥</dt>
              <dd>{n(usage.modelDefaultWindowTokens)} 토큰</dd>
            </div>
          )}
          {usage.requestedWindowTokens && (
            <div>
              <dt>실행에 적용된 한도</dt>
              <dd>
                {n(usage.native?.contextWindowTokens)}
                {usage.native?.contextWindowTokens ? ' 토큰' : ' · 제공자 보고 대기'}
              </dd>
            </div>
          )}
          {usage.maintenance && (
            <div>
              <dt>문맥 정리 {usage.maintenance.calls}회 · 입력 / 출력</dt>
              <dd>
                {n(usage.maintenance.inputTokens)} / {n(usage.maintenance.outputTokens)}
              </dd>
            </div>
          )}
          <div>
            <dt>응답 여유분 제외 잔여</dt>
            <dd>{n(remaining)} 토큰</dd>
          </div>
          <div>
            <dt>한도 기준</dt>
            <dd>
              {usage.native?.contextWindowTokens
                ? '실행 제공자 보고'
                : usage.windowSource === 'fallback'
                  ? '미확인 · 안전 예산 사용'
                  : '모델/실행 설정 · 실제 보고 우선'}
            </dd>
          </div>
          <div>
            <dt>대화 문맥</dt>
            <dd>
              원문 {usage.includedMessages} / 전체 {usage.totalMessages}개 · 요약{' '}
              {usage.compressedMessages}개 · 생략 {usage.omittedMessages}개
            </dd>
          </div>
          <div>
            <dt>답변 호출 입력 / 출력</dt>
            <dd>
              {n(usage.native?.inputTokens)} / {n(usage.native?.outputTokens)}
            </dd>
          </div>
          <div>
            <dt>캐시 입력 / 추론 출력</dt>
            <dd>
              {n(usage.native?.cachedInputTokens)} / {n(usage.native?.reasoningTokens)}
            </dd>
          </div>
          <div>
            <dt>응답 / 도구 여유분</dt>
            <dd>
              {n(usage.outputReserveTokens)} / {n(usage.toolReserveTokens)}
            </dd>
          </div>
        </dl>
        {/* The one place that shows how long the context is also says how to shorten it. */}
        <small className="briefing-context-commands-hint">
          문맥이 길어지면 입력창에 <code>/compact</code>(이전 대화를 지금 요약) 또는{' '}
          <code>/new</code>(새 문맥으로 시작)를 입력하세요. 대화 기록은 지워지지 않습니다.
        </small>
        <small>
          누적 호출 토큰은 현재 문맥 크기와 다릅니다. 구독 잔여량이 아닙니다. 문맥 정리의 추가 모델
          호출은 별도 행에 표시하며, 미제공 값을 0으로 계산하지 않습니다.
        </small>
      </div>
    </span>
  );
}
