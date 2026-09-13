import { useEffect, useRef, useState } from 'react';
import { briefingCacheLabel } from './briefing-cache';
import type { BriefingRoutine } from '@gosu/briefing-core';
import { createRoutineClient, type RoutineConnection } from './routine-client';
import { relatedBriefingMemory } from './briefing-intelligence';
import type { BriefingMemorySession } from './briefing-memory-panel';
import { requestBriefingAnalysis, type AnalysisResult } from './briefing-analysis-client';
import type { LiveSourceResult } from './live-types';
export function BriefingAnalysisPanel({
  routine,
  results,
  memory,
  onResult,
}: {
  routine: BriefingRoutine;
  results: LiveSourceResult[];
  memory: BriefingMemorySession | null;
  onResult: (result: AnalysisResult | null) => void;
}) {
  const [client] = useState(createRoutineClient),
    [connections, setConnections] = useState<RoutineConnection[]>([]),
    [modelKey, setModelKey] = useState(''),
    [reasoning, setReasoning] = useState(''),
    [includeMail, setIncludeMail] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(0);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started.current) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);
  const controller = useRef<AbortController | null>(null);
  const operation = useRef<'connect' | 'analyze' | null>(null);
  const items = results.flatMap((r) => r.items).filter((i) => i.kind !== 'weather');
  const models = connections.flatMap((c) => c.catalog?.models ?? []);
  const key = (item: { providerId: string; modelId: string }) =>
    `${item.providerId}/${item.modelId}`;
  const model = models.find((m) => key(m) === modelKey);
  useEffect(() => {
    if (operation.current === 'analyze') {
      controller.current?.abort();
      operation.current = null;
      setBusy(false);
    }
    setSelected(
      results
        .flatMap((r) => r.items)
        .filter(
          (i) => i.kind !== 'weather' && (includeMail || (i.kind === 'papers' && !i.privateOrigin)),
        )
        .slice(0, 6)
        .map((i) => i.id),
    );
    onResult(null);
  }, [results]);
  useEffect(() => () => controller.current?.abort(), []);
  const connect = async () => {
    started.current = Date.now();
    setElapsed(0);
    setBusy(true);
    const c = new AbortController();
    operation.current = 'connect';
    controller.current = c;
    try {
      const result = await client.models(c.signal);
      if (c.signal.aborted || controller.current !== c) return;
      setConnections(result);
      const choices = result.flatMap((c) => c.catalog?.models ?? []);
      const chosen = choices.find((m) => m.isDefault) ?? choices[0];
      setModelKey(chosen ? key(chosen) : '');
      setStatus(chosen ? 'GOSU 모델 목록을 확인했습니다.' : '연결된 구독 모델이 없습니다.');
    } catch {
      if (!c.signal.aborted) setStatus('GOSU 구독 연결을 확인해주세요.');
    } finally {
      if (controller.current === c) {
        controller.current = null;
        operation.current = null;
        setBusy(false);
      }
    }
  };
  const analyze = async () => {
    if (!model || !results[0]?.receiptId || !selected.length || busy) return;
    started.current = Date.now();
    setElapsed(0);
    const c = new AbortController();
    operation.current = 'analyze';
    controller.current = c;
    setBusy(true);
    onResult(null);
    setStatus('요약 요청을 준비 중입니다.');
    try {
      const entries = memory
        ? relatedBriefingMemory(
            memory.memory,
            routine.id,
            items
              .filter((i) => selected.includes(i.id))
              .map((i) => i.title)
              .join(' '),
          )
        : [];
      const result = await requestBriefingAnalysis(
        {
          routineId: routine.id,
          receiptId: results[0].receiptId,
          itemIds: selected,
          providerId: model.providerId as 'codex' | 'claude-code',
          modelId: model.modelId,
          reasoning: reasoning || null,
          includeMail,
          memory: entries,
        },
        c.signal,
        (detail) => {
          if (!c.signal.aborted) setStatus(detail);
        },
      );
      if (!c.signal.aborted) {
        onResult(result);
        setStatus(
          `${briefingCacheLabel(result) || `${result.invocation.model} · ${result.invocation.reasoning ?? '기본'}`} · ${result.items.length}건 요약 · memory ${result.memoryUsed.length}개 참조${result.memorySave?.state === 'saved' ? ` · 기억 ${result.memorySave.saved}개 자동 저장/갱신` : ''}${result.memorySave?.warning ? ` · ${result.memorySave.warning}` : ''}`,
        );
      }
    } catch (e) {
      if (!c.signal.aborted) setStatus(e instanceof Error ? e.message : '분석 실패');
    } finally {
      if (controller.current === c) {
        controller.current = null;
        operation.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <section className="briefing-analysis-panel">
      <div className="briefing-analysis-heading">
        <strong>AI 요약 · 중요도 · 연구 연관성</strong>
        <button
          className="briefing-text-button"
          type="button"
          disabled={busy}
          onClick={() => void connect()}
        >
          {models.length ? '모델 새로고침' : 'GOSU LLM 연결'}
        </button>
      </div>
      {models.length > 0 && (
        <div className="briefing-form-grid">
          <label className="briefing-field">
            <span>Briefing 요약 Model</span>
            <select
              value={modelKey}
              disabled={busy}
              onChange={(e) => {
                setModelKey(e.target.value);
                setReasoning('');
              }}
            >
              {models.map((m) => (
                <option key={key(m)} value={key(m)}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="briefing-field">
            <span>Briefing 요약 Reasoning</span>
            <select
              value={reasoning}
              disabled={busy}
              onChange={(e) => setReasoning(e.target.value)}
            >
              <option value="">모델 기본값</option>
              {model?.reasoningOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p>
        선택한 자료와 backend가 불러온 관련 memory를 이 모델에 전달합니다. 메일/프로젝트 memory가
        포함되면 macOS 확인창에서도 허용해야 합니다. 원문 전문을 모두 읽은 것으로 간주하지 않습니다.
      </p>
      <label>
        <input
          type="checkbox"
          checked={includeMail}
          disabled={busy}
          onChange={(e) => {
            setIncludeMail(e.target.checked);
            if (e.target.checked)
              setSelected((ids) =>
                [
                  ...new Set([
                    ...ids,
                    ...items
                      .filter((item) => item.kind === 'email' || item.privateOrigin === 'mail')
                      .slice(0, 6)
                      .map((item) => item.id),
                  ]),
                ].slice(0, 15),
              );
            if (!e.target.checked)
              setSelected((ids) =>
                ids.filter(
                  (id) =>
                    !items.some(
                      (item) =>
                        item.id === id && (item.kind === 'email' || item.privateOrigin === 'mail'),
                    ),
                ),
              );
          }}
        />{' '}
        메일·Scholar 알림 내용을 선택한 LLM에 전달하는 분석 허용 (최대 6개 자동 선택)
      </label>
      {items.length > 0 && (
        <details className="briefing-analysis-selection">
          <summary>분석할 항목 {selected.length}개 선택 · 최대 15개</summary>
          {items.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                disabled={
                  busy || ((item.kind === 'email' || item.privateOrigin === 'mail') && !includeMail)
                }
                onChange={(e) =>
                  setSelected((ids) =>
                    e.target.checked
                      ? [...ids, item.id].slice(0, 15)
                      : ids.filter((id) => id !== item.id),
                  )
                }
              />
              {item.title}
              {item.privateOrigin === 'mail' ? ' · 메일 유래' : ''}
            </label>
          ))}
        </details>
      )}
      <div className="briefing-live-actions">
        <button
          type="button"
          className="briefing-button primary"
          disabled={busy || !model || !selected.length}
          onClick={() => void analyze()}
        >
          선택한 자료 AI 요약
        </button>
        {busy && (
          <button
            type="button"
            className="briefing-button"
            onClick={() => {
              controller.current?.abort();
              controller.current = null;
              operation.current = null;
              setBusy(false);
              setStatus('분석을 중단했습니다.');
            }}
          >
            분석 중단
          </button>
        )}
      </div>
      <p role="status">{status}</p>
      {busy && (
        <p className="routine-receipt" data-analysis-elapsed={elapsed}>
          처리 중 · 경과 {elapsed}초 · {model?.displayName ?? '모델 연결'} ·{' '}
          {reasoning || '모델 기본 reasoning'}
          {operation.current === 'analyze'
            ? ' · 높은 reasoning/여러 항목은 시간이 더 걸릴 수 있습니다.'
            : ''}
        </p>
      )}
    </section>
  );
}
