import { useEffect, useRef, useState } from 'react';
import { PAPER_CATEGORIES, paperCategoryLabel, type PaperCategory } from './paper-classification';
import type { SavedPaper } from './paper-library-index';
import { sourceRequest } from './live-client';

type Props = { routineId: string; onChanged: (signal: AbortSignal) => Promise<void> };
const target = (paper: SavedPaper) => ({
  key: paper.classificationKey!,
  expectedRevision: paper.item.classification?.revision ?? 0,
});
export function PaperClassificationActions({
  routineId,
  papers,
  onChanged,
}: Props & { papers: SavedPaper[] }) {
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [routineId],
  );
  const eligible = papers.filter(
    (p) => p.classificationKey && p.item.classification?.source !== 'user',
  );
  const pending = eligible.filter((p) => !p.item.classification || p.item.classification.stale);
  const classify = async (refresh: boolean) => {
    if (controller.current) return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    const selected = refresh ? eligible : pending;
    let saved = 0,
      skipped = 0;
    try {
      for (let start = 0; start < selected.length; start += 6) {
        setStatus(
          `${start + 1}–${Math.min(start + 6, selected.length)} / ${selected.length}편 분류 중…`,
        );
        const response = await sourceRequest<{ saved: string[]; skipped: number }>(
          '/papers/classify',
          { routineId, targets: selected.slice(start, start + 6).map(target), refresh },
          c.signal,
        );
        if (!Array.isArray(response.saved))
          throw new Error('분류 저장 결과를 확인하지 못했습니다.');
        saved += response.saved.length;
        skipped += response.skipped;
        await onChanged(c.signal);
      }
      setStatus(
        `${saved}편 분류 저장됨${skipped ? ` · 변경된 ${skipped}편은 덮어쓰지 않았습니다.` : ''}`,
      );
    } catch (error) {
      setStatus(
        c.signal.aborted
          ? `중단됨 · 완료된 분류는 저장되어 있습니다.`
          : error instanceof Error
            ? error.message
            : '분류하지 못했습니다. 기존 요약은 유지됩니다.',
      );
    } finally {
      controller.current = null;
      setBusy(false);
    }
  };
  return (
    <div className="briefing-classification-actions">
      <div>
        <button
          type="button"
          className="briefing-button"
          disabled={busy || !pending.length}
          onClick={() => void classify(false)}
        >
          분류 대기 논문 AI 분류{pending.length ? ` (${pending.length})` : ''}
        </button>
        <button
          type="button"
          className="briefing-classification-link"
          disabled={busy || !eligible.length}
          onClick={() => void classify(true)}
        >
          다시 AI 분류
        </button>
        {busy && (
          <button
            type="button"
            className="briefing-classification-link"
            onClick={() => controller.current?.abort()}
          >
            분류 중단
          </button>
        )}
      </div>
      <small className="briefing-muted">
        현재 목록에 적용 · 저장 요약만 사용 · arXiv 재조회 없음 · 분류 실행 시 AI 사용량 발생 ·
        사용자 지정 분류 유지
      </small>
      {status && <small role="status">{status}</small>}
    </div>
  );
}

export function PaperClassificationControl({
  routineId,
  paper,
  onChanged,
}: Props & { paper: SavedPaper }) {
  const value = paper.item.classification;
  const [editing, setEditing] = useState(false),
    [category, setCategory] = useState<PaperCategory>(value?.categoryId ?? 'other');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [editTarget, setEditTarget] = useState(() => target(paper));
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [routineId, paper.classificationKey],
  );
  const save = async () => {
    if (controller.current) return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError('');
    try {
      const result = await sourceRequest<{ saved: string[] }>(
        '/papers/classification/edit',
        { routineId, target: editTarget, categoryId: category },
        c.signal,
      );
      if (!result.saved?.includes(paper.classificationKey!))
        throw new Error('분류 저장 결과를 확인하지 못했습니다.');
      await onChanged(c.signal);
      setEditing(false);
    } catch (e) {
      if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : '분류를 저장하지 못했습니다.');
    } finally {
      controller.current = null;
      setBusy(false);
    }
  };
  const date = value
    ? new Intl.DateTimeFormat('ko-KR', {
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(value.classifiedAt))
    : '';
  return (
    <div className="briefing-paper-classification" aria-label={`${paper.item.title} 분류`}>
      <div className="briefing-paper-classification-row">
        <span
          className="briefing-category-badge"
          data-source={value?.source ?? 'pending'}
          title={
            value
              ? `${value.reason}\n${date} 분류${value.inputTruncated ? ' · 긴 저장본의 일부로 분류' : ''}`
              : '아직 AI 분류를 실행하지 않은 저장 요약입니다.'
          }
        >
          {value ? paperCategoryLabel(value.categoryId) : '분류 대기'}
        </span>
        {value && (
          <small className="briefing-muted">
            {value.source === 'user' ? '사용자 지정 · 저장됨' : 'AI 분류 · 저장됨'}
            {value.stale ? ' · 요약 변경됨' : ''}
          </small>
        )}
        {paper.classificationKey && !editing && (
          <button
            type="button"
            className="briefing-classification-link"
            aria-label={`${paper.item.title} 분류 수정`}
            onClick={() => {
              setCategory(value?.categoryId ?? 'other');
              setEditTarget(target(paper));
              setEditing(true);
            }}
          >
            분류 수정
          </button>
        )}
      </div>
      {editing && (
        <div className="briefing-paper-classification-editor">
          <select
            aria-label={`${paper.item.title} 연구 분야`}
            value={category}
            disabled={busy}
            onChange={(e) => setCategory(e.target.value as PaperCategory)}
          >
            {PAPER_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="briefing-classification-link"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? '저장 중…' : '분류 저장'}
          </button>
          <button
            type="button"
            className="briefing-classification-link"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            취소
          </button>
          <small className="briefing-muted">직접 수정한 분류는 AI가 덮어쓰지 않습니다.</small>
        </div>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
