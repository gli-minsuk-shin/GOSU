import { useEffect, useRef, useState } from 'react';
import './paper-summary-offer.css';
import { BriefingHistoryItem } from './briefing-history-view';
import { importanceFirst } from './paper-chat-reference';
import type { FeedbackDecision } from './briefing-insight-card';
import { sourceRequest } from './live-client';
import { refreshBriefingSummary } from './briefing-analysis-client';
import { matchesSavedPaper, paperLabels, type SavedPaper } from './paper-library-index';
import { paperBibtexFileName, paperLibraryBibtex } from './paper-library-bibtex';
import { paperTagKey } from './paper-tags';
import { PaperTagFilter } from './paper-tag-filter';
import { PAPER_CATEGORIES } from './paper-classification';
import {
  emptyPaperDates,
  matchesPaperDates,
  paperCalendarDay,
  paperDateError,
} from './paper-date-filters';
import { PaperDateControls } from './paper-date-controls';
import {
  PaperClassificationActions,
  PaperClassificationControl,
} from './paper-classification-controls';
export function SavedPaperSummaries({ routineId }: { routineId: string }) {
  const loadRevision = useRef(0);
  const activeRoutine = useRef(routineId);
  activeRoutine.current = routineId;
  const [selection, setSelection] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exportNotice, setExportNotice] = useState<{ failed: boolean; text: string } | null>(null);
  const paperKey = (p: SavedPaper) => JSON.stringify([p.historyId, p.item.id]);
  const [dates, setDates] = useState(emptyPaperDates);
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [selectedTags, setSelectedTags] = useState<string[]>([]),
    [limit, setLimit] = useState(30);
  const [papers, setPapers] = useState<SavedPaper[]>([]),
    [feedback, setFeedback] = useState<Record<string, FeedbackDecision>>({}),
    [status, setStatus] = useState('저장된 논문 요약 확인 중…');
  const load = async (signal: AbortSignal) => {
    if (activeRoutine.current !== routineId) return;
    const revision = ++loadRevision.current;
    const result = await sourceRequest<{
      papers: SavedPaper[];
      feedback: Record<string, FeedbackDecision>;
      privateOmitted?: boolean;
      warning?: string;
    }>('/papers/saved', { routineId }, signal);
    if (signal.aborted || revision !== loadRevision.current || activeRoutine.current !== routineId)
      return;
    if (!Array.isArray(result.papers)) throw new Error('저장된 요약 응답을 확인하지 못했습니다.');
    setPapers(result.papers);
    setFeedback(result.feedback ?? {});
    setStatus(
      result.warning ||
        (result.privateOmitted
          ? '일부 비공개 요약은 현재 권한에서 표시하지 않습니다.'
          : result.papers.length
            ? ''
            : '아직 저장된 논문 요약이 없습니다.'),
    );
  };
  useEffect(() => {
    setPapers([]);
    setSelection([]);
    setConfirmDelete(false);
    setExportNotice(null);
    const c = new AbortController();
    const reload = () => {
      void load(c.signal).catch(() => {
        if (!c.signal.aborted)
          setStatus('저장된 논문 요약을 불러오지 못했습니다. 기존 기록은 유지됩니다.');
      });
    };
    reload();
    if (typeof window !== 'undefined') {
      window.addEventListener?.('gosu-paper-library-updated', reload);
      window.addEventListener?.('focus', reload);
    }
    return () => {
      c.abort();
      loadRevision.current++;
      if (typeof window !== 'undefined') {
        window.removeEventListener?.('gosu-paper-library-updated', reload);
        window.removeEventListener?.('focus', reload);
      }
    };
  }, [routineId]);
  const dateError = paperDateError(dates);
  const visible = papers.filter(
    (p) => matchesSavedPaper(p, query, category, selectedTags) && matchesPaperDates(p, dates),
  );
  const missingSummaryDates = papers.filter(
    (p) => !paperCalendarDay(p.item.provenance?.summarizedAt),
  ).length;
  const missingPublicationDates = papers.filter(
    (p) => !paperCalendarDay(p.item.paperPublishedAt),
  ).length;
  const categories = ['분류 대기', ...PAPER_CATEGORIES.map((c) => c.label)];
  const tags = [
    ...new Map(
      papers.flatMap((p) => paperLabels(p.item).tags).map((tag) => [paperTagKey(tag), tag]),
    ).values(),
  ].sort();
  const tagCounts = new Map<string, number>();
  for (const paper of papers) {
    for (const tag of new Set(paperLabels(paper.item).tags.map(paperTagKey))) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const changeTags = (tags: string[]) => {
    setSelectedTags(tags);
    setLimit(30);
  };
  const exportTargets = selection.length
    ? papers.filter((p) => selection.includes(paperKey(p)))
    : visible;
  /** Export never calls a source or a model: the saved text alone becomes the .bib file. */
  const exportBibtex = () => {
    try {
      const { text, entryCount, incompleteCount } = paperLibraryBibtex(exportTargets);
      const blob = new Blob([text], { type: 'application/x-bibtex' }),
        url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = paperBibtexFileName(new Date());
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportNotice({
        failed: false,
        text: `${entryCount}편을 BibTeX 파일로 내보냈습니다.${
          incompleteCount ? ` 이 중 ${incompleteCount}편은 저자나 연도 정보가 없습니다.` : ''
        }`,
      });
    } catch (error) {
      setExportNotice({
        failed: true,
        text: `BibTeX 파일을 만들지 못했습니다. ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };
  return (
    <section className="briefing-saved-papers" aria-label="저장된 논문 요약">
      <div className="briefing-paper-filters">
        <input
          type="search"
          aria-label="저장 논문 검색"
          placeholder="제목, 키워드, 요약 내용 검색"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(30);
          }}
        />
        <select
          aria-label="자동 분류"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setLimit(30);
          }}
        >
          <option value="">모든 분류</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <PaperTagFilter
          tags={tags.map((label) => ({ label, count: tagCounts.get(paperTagKey(label)) ?? 0 }))}
          selected={selectedTags}
          onChange={changeTags}
        />
      </div>
      <PaperDateControls
        value={dates}
        onChange={(next) => {
          setDates(next);
          setLimit(30);
        }}
      />
      <small className="briefing-muted">
        한국 시간 · 시작일과 종료일 포함 · 두 기간은 함께 적용됩니다.
        {missingSummaryDates ? ` 요약일 미기록 ${missingSummaryDates}편.` : ''}
        {missingPublicationDates ? ` 공개일 미기록 ${missingPublicationDates}편.` : ''}
        {missingSummaryDates || missingPublicationDates
          ? ' 해당 날짜가 없는 논문은 그 기간 검색에서 제외됩니다.'
          : ''}
      </small>
      {dateError && (
        <p role="alert" className="briefing-alert">
          {dateError}
        </p>
      )}
      {selectedTags.length > 0 && (
        <div className="briefing-paper-selected-tags" aria-label="선택한 태그">
          {selectedTags.map((tag) => (
            <button
              type="button"
              key={tag}
              aria-label={`${tag} 태그 해제`}
              onClick={() => changeTags(selectedTags.filter((t) => t !== tag))}
            >
              {tag}
              <span aria-hidden="true">×</span>
            </button>
          ))}
          <button
            type="button"
            className="briefing-paper-tags-clear"
            aria-label="선택한 태그 모두 해제"
            onClick={() => changeTags([])}
          >
            초기화
          </button>
        </div>
      )}
      <p className="briefing-muted" role="status">
        {visible.length} / {papers.length}편 · 최신 요약순 · 저장본 검색은 추가 AI 호출 없음
      </p>
      <small className="briefing-muted">
        표준 태그 {tags.length}개 · 논문당 최대 3개 · 기존 태그 우선 재사용 · 원래 키워드도 검색할
        수 있습니다.
      </small>
      {status && (
        <p role="status" className="briefing-muted">
          {status}
        </p>
      )}
      <PaperClassificationActions
        key={routineId}
        routineId={routineId}
        papers={visible}
        onChanged={load}
      />
      <div className="briefing-paper-selection">
        <button
          type="button"
          disabled={deleting || !visible.length}
          onClick={() => {
            setSelection(visible.slice(0, 100).map(paperKey));
            setConfirmDelete(false);
          }}
        >
          검색 결과 선택 (최대 100편)
        </button>
        <button
          type="button"
          disabled={deleting || !selection.length}
          onClick={() => setSelection([])}
        >
          선택 해제
        </button>
        <button
          type="button"
          disabled={deleting || !selection.length}
          onClick={() => setConfirmDelete(true)}
        >
          선택 삭제 ({selection.length})
        </button>
        {exportTargets.length > 0 && (
          <button type="button" disabled={deleting} onClick={exportBibtex}>
            BibTeX 내보내기 ({exportTargets.length})
          </button>
        )}
      </div>
      {exportNotice && (
        <p
          role={exportNotice.failed ? 'alert' : 'status'}
          className={exportNotice.failed ? 'briefing-alert' : 'briefing-muted'}
        >
          {exportNotice.text}
        </p>
      )}
      {confirmDelete && (
        <div role="alertdialog" aria-label="선택 논문 삭제 확인" className="briefing-alert">
          <strong>선택한 {selection.length}개 항목을 보관함에서 삭제할까요?</strong>
          <p>원문과 과거 브리핑은 유지됩니다. 공용 보관함 항목은 GOSU 전체에서 제외됩니다.</p>
          <button type="button" disabled={deleting} onClick={() => setConfirmDelete(false)}>
            취소
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                const targets = papers
                  .filter((p) => selection.includes(paperKey(p)))
                  .map((p) => ({ historyId: p.historyId, itemId: p.item.id }));
                const result = await sourceRequest<{ deleted: number }>(
                  '/papers/saved/delete',
                  { routineId, confirmed: true, targets },
                  new AbortController().signal,
                );
                if (result.deleted !== targets.length) throw new Error('delete_unconfirmed');
                setSelection([]);
                setConfirmDelete(false);
                await load(new AbortController().signal);
              } catch {
                setStatus('삭제 결과를 확인하지 못했습니다. 목록을 새로고침해 확인해주세요.');
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? '삭제 중…' : '삭제 확인'}
          </button>
        </div>
      )}
      <div className="briefing-reading-list">
        {importanceFirst(visible, (p) => p.item.importance)
          .slice(0, limit)
          .map((p) => (
            <BriefingHistoryItem
              key={`${routineId}:${p.classificationKey ?? `${p.item.id}:${p.item.sourceUrl}`}`}
              classificationControl={
                <div className="briefing-paper-row-tools">
                  <label className="briefing-paper-select">
                    <input
                      type="checkbox"
                      aria-label={`${p.item.title} 선택`}
                      checked={selection.includes(paperKey(p))}
                      disabled={deleting}
                      onChange={(event) => {
                        setSelection((current) =>
                          event.target.checked
                            ? [...new Set([...current, paperKey(p)])].slice(0, 100)
                            : current.filter((key) => key !== paperKey(p)),
                        );
                        setConfirmDelete(false);
                      }}
                    />
                    선택
                  </label>
                  <PaperClassificationControl routineId={routineId} paper={p} onChanged={load} />
                </div>
              }
              item={{
                ...p.item,
                ...(p.item.provenance
                  ? { provenance: { ...p.item.provenance, reused: true } }
                  : {}),
              }}
              savedAt={p.savedAt}
              paperReference={{
                routineId,
                historyId: p.historyId,
                paperId: p.item.id,
                title: p.item.title,
              }}
              feedbackChoice={feedback[p.item.id] ?? null}
              onFeedback={
                p.historyId.startsWith('shared:')
                  ? undefined
                  : async (decision) => {
                      const reply = await sourceRequest<{ decision: FeedbackDecision }>(
                        '/history/feedback',
                        { routineId, historyId: p.historyId, itemId: p.item.id, decision },
                        new AbortController().signal,
                      );
                      if (reply.decision !== decision)
                        throw new Error('선택 저장 결과를 확인하지 못했습니다.');
                      setFeedback((current) => ({ ...current, [p.item.id]: decision }));
                    }
              }
              onRefresh={
                p.historyId.startsWith('shared:')
                  ? undefined
                  : async (progress) => {
                      const refreshed = await refreshBriefingSummary(
                        { routineId, historyId: p.historyId, itemId: p.item.id },
                        new AbortController().signal,
                        progress,
                        'papers',
                      );
                      if (!refreshed.historyId)
                        throw new Error('새 요약을 저장하지 못해 이전 요약을 유지합니다.');
                      await load(new AbortController().signal);
                    }
              }
            />
          ))}
      </div>
      {!status && !visible.length && <p role="status">검색 조건에 맞는 저장 논문이 없습니다.</p>}
      {visible.length > limit && (
        <button type="button" className="briefing-button" onClick={() => setLimit((n) => n + 30)}>
          논문 더 보기 ({visible.length - limit}편)
        </button>
      )}
    </section>
  );
}
