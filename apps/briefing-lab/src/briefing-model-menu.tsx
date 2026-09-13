import { useEffect, useId, useRef, useState } from 'react';
import type { defaultAssistantPreferences, BriefingRoutine } from '@gosu/briefing-core';
import { selectCatalogModelFromList } from '@gosu/contracts';
import { createRoutineClient, type RoutineConnection } from './routine-client';
import { sourceRequest } from './live-client';
import {
  BriefingModelSelectionSchema,
  modelSelection,
  type BriefingModelSelection,
} from './briefing-model-selection';

export function BriefingModelMenu({
  routine,
  busy = false,
  onSaved,
  onSavingChange,
  onSettings,
}: {
  routine: BriefingRoutine;
  busy?: boolean;
  onSaved: (selection: BriefingModelSelection) => void;
  onSavingChange: (saving: boolean) => void;
  onSettings: () => void;
}) {
  const current = modelSelection(routine.live?.assistant);
  const [effective, setEffective] = useState<{
    modelId: string;
    displayName: string;
    reasoning: string | null;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let revision = 0;
    const refresh = () => {
      const expected = ++revision;
      setEffective(null);
      void sourceRequest<NonNullable<typeof effective>>(
        '/assistant/model/current',
        { routineId: routine.id },
        controller.signal,
      )
        .then((value) => {
          if (!controller.signal.aborted && expected === revision) setEffective(value);
        })
        .catch(() => {});
    };
    refresh();
    if (typeof window !== 'undefined') window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      if (typeof window !== 'undefined') window.removeEventListener('focus', refresh);
    };
  }, [routine.id, current.providerId, current.modelId, current.reasoning, busy]);
  const [open, setOpen] = useState(false),
    [connections, setConnections] = useState<RoutineConnection[]>([]);
  const [draft, setDraft] = useState(current),
    [baseline, setBaseline] = useState(current);
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null),
    lock = useRef(false);
  const id = useId();
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const outside = (e: PointerEvent) => {
      if (!lock.current && e.target instanceof Node && !root.current?.contains(e.target))
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const models = connections.flatMap((c) => c.catalog?.models ?? []);
  const selected = selectCatalogModelFromList(models, {
    providerId: draft.providerId,
    requestedModelId: draft.modelId,
  });
  const unavailable = Boolean(draft.modelId && !selected);
  const missingReasoning = Boolean(
    draft.reasoning && !selected?.reasoningOptions.some((r) => r.id === draft.reasoning),
  );
  const load = async () => {
    request.current?.abort();
    const c = new AbortController();
    request.current = c;
    setLoading(true);
    setError('');
    try {
      const [catalogs, profile] = await Promise.all([
        createRoutineClient().models(c.signal),
        sourceRequest<{ preferences: ReturnType<typeof defaultAssistantPreferences> }>(
          '/assistant/settings/get',
          { routineId: routine.id },
          c.signal,
        ),
      ]);
      if (c.signal.aborted) return;
      setConnections(catalogs);
      const saved = modelSelection(profile.preferences ?? routine.live?.assistant);
      setDraft(saved);
      setBaseline(saved);
    } catch (e) {
      if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : '모델 목록을 확인하지 못했습니다.');
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  };
  const apply = async () => {
    if (busy || lock.current || loading || !selected || missingReasoning) return;
    lock.current = true;
    setSaving(true);
    onSavingChange(true);
    setError('');
    const c = new AbortController();
    request.current = c;
    try {
      const result = await sourceRequest<{ saved: boolean; selection: BriefingModelSelection }>(
        '/assistant/model/save',
        { routineId: routine.id, selection: draft, expectedSelection: baseline },
        c.signal,
      );
      if (c.signal.aborted) return;
      if (!result.saved) throw new Error('모델 설정 저장을 확인하지 못했습니다.');
      const saved = BriefingModelSelectionSchema.parse(result.selection);
      onSaved(saved);
      setOpen(false);
      trigger.current?.focus();
    } catch (e) {
      if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : '모델 변경을 저장하지 못했습니다.');
    } finally {
      lock.current = false;
      if (!c.signal.aborted) setSaving(false);
      onSavingChange(false);
    }
  };
  return (
    <div
      className="briefing-title-model"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !saving) {
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        className="briefing-title-model-trigger"
        type="button"
        ref={trigger}
        aria-label="Briefing 모델 변경"
        aria-expanded={open}
        aria-controls={id}
        disabled={busy || saving}
        title={busy ? '답변 완료 후 모델 변경' : '엔진·모델·reasoning 변경'}
        onClick={() => {
          setOpen(!open);
          if (!open) {
            setDraft(current);
            setBaseline(current);
            void load();
          }
        }}
      >
        <span>{effective?.displayName ?? current.modelId ?? 'Auto · 설정 따름'}</span>
        <small>{effective?.reasoning ?? current.reasoning ?? '기본'}</small>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <form
          id={id}
          className="briefing-model-popover"
          role="dialog"
          aria-label="Briefing 모델 선택"
          onSubmit={(e) => {
            e.preventDefault();
            void apply();
          }}
        >
          <strong>AI 모델</strong>
          <label>
            엔진
            <select
              aria-label="Briefing 엔진"
              value={draft.providerId}
              disabled={saving || loading || busy}
              onChange={(e) =>
                setDraft({
                  providerId: e.target.value as BriefingModelSelection['providerId'],
                  modelId: null,
                  reasoning: null,
                })
              }
            >
              <option value="codex">OpenAI · Codex</option>
              <option value="claude-code">Anthropic · Claude Code</option>
            </select>
          </label>
          <label>
            모델
            <select
              aria-label="Briefing 모델"
              value={draft.modelId ?? ''}
              disabled={saving || loading || busy}
              onChange={(e) =>
                setDraft({ ...draft, modelId: e.target.value || null, reasoning: null })
              }
            >
              <option value="">Auto · GOSU 역할별 설정 / 제공자 기본값</option>
              {unavailable && (
                <option value={draft.modelId!} disabled>
                  {draft.modelId} · 연결 확인 필요
                </option>
              )}
              {models
                .filter((m) => m.providerId === draft.providerId)
                .map((m) => (
                  <option key={m.modelId} value={m.modelId}>
                    {m.displayName}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Reasoning
            <select
              aria-label="Briefing reasoning"
              value={draft.reasoning ?? ''}
              disabled={saving || loading || busy || !selected}
              onChange={(e) => setDraft({ ...draft, reasoning: e.target.value || null })}
            >
              <option value="">모델 기본값</option>
              {missingReasoning && (
                <option value={draft.reasoning!} disabled>
                  {draft.reasoning} · 지원 확인 필요
                </option>
              )}
              {selected?.reasoningOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <small>다음 요청부터 적용 · 자동 요약에도 같은 설정 사용</small>
          {loading && <small role="status">GOSU 모델 목록 확인 중…</small>}
          {!loading && !selected && (
            <small role="status">
              이 엔진의 선택한 모델에 연결할 수 없습니다. 목록을 새로고침하거나 다른 모델을
              선택해주세요.
            </small>
          )}
          {error && <small role="alert">{error}</small>}
          <div className="briefing-model-menu-actions">
            <button type="button" disabled={saving || loading} onClick={() => void load()}>
              목록 새로고침
            </button>
            <button
              type="submit"
              disabled={saving || busy || loading || !selected || missingReasoning}
            >
              {saving ? '저장 중…' : '적용'}
            </button>
          </div>
          <button
            className="briefing-text-button"
            type="button"
            disabled={saving}
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
          >
            전체 모델·권한 설정
          </button>
        </form>
      )}
    </div>
  );
}
