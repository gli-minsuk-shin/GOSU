import { useEffect, useRef, useState } from 'react';
import { type BriefingRoutine } from '@gosu/briefing-core';
import { type ModelDescriptor } from '@gosu/contracts';
import { createRoutineClient, type RoutineClient, type RoutineConnection } from './routine-client';
import {
  materializeProposal,
  routineErrorMessage,
  type RoutineRequest,
  type RoutineResult,
} from './routine-builder';

export function RoutineCopilot({
  onCreate,
  client: suppliedClient,
}: {
  onCreate: (routine: BriefingRoutine) => void;
  client?: RoutineClient;
}) {
  const [client] = useState(() => suppliedClient ?? createRoutineClient());
  const [connections, setConnections] = useState<RoutineConnection[]>([]);
  const [modelKey, setModelKey] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [history, setHistory] = useState<RoutineRequest['history']>([]);
  const [result, setResult] = useState<RoutineResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const requestRef = useRef<AbortController | null>(null);
  const chatEnd = useRef<HTMLDivElement | null>(null);
  const models = connections.flatMap((item) => item.catalog?.models ?? []);
  const key = (model: ModelDescriptor) => `${model.providerId}/${model.modelId}`;
  const model = models.find((item) => key(item) === modelKey);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    chatEnd.current?.scrollIntoView?.({ block: 'nearest' });
  }, [history, events]);
  const reportError = (error: unknown) => {
    const message = error instanceof Error ? error.message : 'routine_failed';
    setError(/[가-힣]/u.test(message) ? message : routineErrorMessage(message));
  };
  const connect = async () => {
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setConnecting(true);
    setError('');
    try {
      const available = await client.models(controller.signal);
      if (controller.signal.aborted) return;
      setConnections(available);
      const choices = available.flatMap((item) => item.catalog?.models ?? []);
      const selected =
        choices.find((item) => key(item) === modelKey) ??
        choices.find((item) => item.isDefault) ??
        choices[0];
      setModelKey(selected ? key(selected) : '');
      setReasoning('');
      if (!selected) setError(routineErrorMessage('subscription_unavailable'));
    } catch (error) {
      if (!controller.signal.aborted) reportError(error);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setConnecting(false);
      }
    }
  };
  const ask = async () => {
    if (busy || connecting || !model || !prompt.trim()) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const message = prompt.trim();
    const recent = applied ? [] : history.slice(-6);
    setHistory([...recent, { role: 'user', text: message }]);
    setBusy(true);
    setError('');
    setEvents(['GOSU 엔진에 루틴 설계 요청을 보내는 중']);
    setApplied(false);
    setPrompt('');
    const previousProposal = applied ? null : (result?.proposal ?? null);
    setResult(null); // Never leave an old proposal actionable after a newer request fails.
    try {
      const response = await client.run(
        {
          prompt: message,
          providerId: model.providerId as RoutineRequest['providerId'],
          modelId: model.modelId,
          reasoning: reasoning || null,
          history: recent,
          previousProposal,
        },
        controller.signal,
        (event) => {
          if (!controller.signal.aborted) setEvents((items) => [...items.slice(-7), event.detail]);
        },
      );
      if (controller.signal.aborted) return;
      if (response.proposal)
        materializeProposal(response.proposal, 'preview', new Date().toISOString());
      setResult(response);
      setHistory((items) => [...items.slice(-5), { role: 'assistant', text: response.answer }]);
      setEvents((items) => [
        ...items.slice(-7),
        response.proposal
          ? '검증된 제안 준비 완료 · 검토 후 저장해주세요'
          : '조건 확인이 필요합니다 · 아래에서 이어서 답해주세요',
      ]);
    } catch (error) {
      if (!controller.signal.aborted) {
        reportError(error);
        setPrompt(message);
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  };
  const stop = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    setBusy(false);
    setConnecting(false);
    setResult(null);
    setEvents(['사용자가 중단했습니다 · 저장된 루틴 없음']);
  };
  const apply = () => {
    if (!result?.proposal || busy || applied) return;
    try {
      onCreate(materializeProposal(result.proposal, crypto.randomUUID(), new Date().toISOString()));
      setApplied(true);
      setEvents(['새 루틴을 초안으로 추가했습니다 · 실제 예약 실행은 연결되지 않았습니다']);
    } catch (error) {
      reportError(error);
    }
  };
  const proposal = result?.proposal;
  return (
    <section className="routine-copilot" aria-label="AI 루틴 만들기">
      <span className="briefing-section-caption">BRIEFING COPILOT · GOSU ENGINE</span>
      <h2>대화로 새 루틴 만들기</h2>
      <p className="briefing-muted">
        GOSU의 Codex / Claude Code 구독과 실행 엔진을 사용합니다. 요청·최근 대화·미저장 제안을
        선택한 LLM에 보냅니다. 메일 본문이나 기존 프로젝트는 읽지 않습니다.
      </p>
      <button
        type="button"
        className="briefing-button"
        disabled={busy || connecting}
        onClick={() => void connect()}
      >
        {connecting ? '연결 확인 중…' : models.length ? '모델 목록 새로고침' : 'GOSU 엔진 연결'}
      </button>
      {connections.map((item) => (
        <small className="routine-provider-state" key={item.providerId}>
          {item.providerId === 'codex' ? 'Codex' : 'Claude Code'} ·{' '}
          {item.catalog?.models.length ? '구독 설정 감지' : '연결 안 됨 · GOSU 로그인 확인'}
        </small>
      ))}
      {models.length > 0 && (
        <div className="routine-model-picker">
          <label>
            Model
            <select
              aria-label="루틴 생성 Model"
              value={modelKey}
              disabled={busy || connecting}
              onChange={(event) => {
                setModelKey(event.target.value);
                setReasoning('');
              }}
            >
              {models.map((item) => (
                <option key={key(item)} value={key(item)}>
                  {item.providerId === 'codex' ? `Codex · ${item.displayName}` : item.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reasoning
            <select
              aria-label="루틴 생성 Reasoning"
              value={reasoning}
              disabled={busy || connecting}
              onChange={(event) => setReasoning(event.target.value)}
            >
              <option value="">모델 기본값</option>
              {model?.reasoningOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.isDefault ? ' · 기본' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="routine-chat-log" aria-label="루틴 설계 대화">
        {history.map((message, index) => (
          <article key={index} className={`routine-message ${message.role}`}>
            <strong>{message.role === 'user' ? 'YOU' : 'GOSU'}</strong>
            <p>{message.text}</p>
          </article>
        ))}
        <div ref={chatEnd} />
      </div>
      {events.length > 0 && (
        <details className="routine-progress" open={busy}>
          <summary role="status">{events.at(-1)}</summary>
          <ol>
            {events.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ol>
          <small>실제 실행·검증 상태입니다. 내부 추론은 표시하지 않습니다.</small>
        </details>
      )}
      {error && (
        <p className="briefing-alert" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="routine-receipt">
          {result.providerId} · {result.model} · {result.reasoning ?? '기본 reasoning'}
        </p>
      )}
      {proposal && (
        <div className="routine-proposal" aria-label="새 루틴 제안 검토">
          <span className="briefing-section-caption">
            {applied ? '초안 추가 완료' : '검토 · 아직 저장되지 않음'}
          </span>
          <h3>{proposal.name}</h3>
          <dl>
            <dt>종류</dt>
            <dd>{proposal.kind === 'funding' ? '연구과제' : '개인 · 연구'}</dd>
            <dt>시간표</dt>
            <dd>
              {proposal.schedule.interval}
              {
                ({ daily: '일', weekly: '주', monthly: '개월' } as const)[
                  proposal.schedule.frequency
                ]
              }
              마다 · {proposal.schedule.times.join(', ')} · {proposal.schedule.timeZone}
              <br />
              {proposal.schedule.frequency === 'weekly'
                ? proposal.schedule.weekdays
                    .map((day) => ['일', '월', '화', '수', '목', '금', '토'][day])
                    .join(' · ')
                : proposal.schedule.frequency === 'monthly'
                  ? `${proposal.schedule.monthDay}일 (짧은 달은 말일)`
                  : ''}
            </dd>
            <dt>키워드</dt>
            <dd>
              {proposal.interest.keywords
                .map(
                  (item) =>
                    `${item.term} (×${item.weight}${item.synonyms.length ? `; ${item.synonyms.join(', ')}` : ''})`,
                )
                .join(' · ') || '없음'}
            </dd>
            <dt>제외</dt>
            <dd>{proposal.interest.excluded.join(', ') || '없음'}</dd>
            <dt>국가</dt>
            <dd>{proposal.countries.join(', ') || '제한 없음'}</dd>
            <dt>소스 연결</dt>
            <dd>루틴 저장 후 설정에서 실제 소스를 연결하세요.</dd>
          </dl>
          <details>
            <summary>다음 5회 · 계산 미리보기</summary>
            <ol>
              {result.nextDates.map((date) => (
                <li key={date}>
                  {new Intl.DateTimeFormat('ko-KR', {
                    timeZone: proposal.schedule.timeZone,
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(date))}
                </li>
              ))}
            </ol>
          </details>
          <p className="briefing-muted">
            검토 후 초안으로 저장합니다. 연결 권한을 부여하거나 수집·예약을 실행하지 않습니다.
          </p>
          <button
            type="button"
            className="briefing-button primary"
            disabled={busy || applied}
            onClick={apply}
          >
            {applied ? '초안으로 추가됨' : '검토한 루틴 추가'}
          </button>
        </div>
      )}
      <label className="routine-composer">
        루틴 요청
        <textarea
          aria-label="AI 루틴 요청"
          maxLength={6000}
          value={prompt}
          disabled={connecting}
          placeholder="예: 매주 월·수·금 오전 8시, 서울 시간으로 diffusion model 논문과 마감일 있는 할 일을 정리해줘"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void ask();
            }
          }}
        />
      </label>
      <div className="routine-compose-actions">
        <button
          type="button"
          className="briefing-button primary"
          disabled={busy || connecting || !model || !prompt.trim()}
          onClick={() => void ask()}
        >
          루틴 제안 요청
        </button>
        {(busy || connecting) && (
          <button type="button" className="briefing-button" onClick={stop}>
            중단
          </button>
        )}
      </div>
      <small className="briefing-muted">
        Shift + Enter 줄바꿈 · 대화는 이 화면에서만 유지 · 저장한 루틴은 브라우저에 보관
      </small>
    </section>
  );
}
