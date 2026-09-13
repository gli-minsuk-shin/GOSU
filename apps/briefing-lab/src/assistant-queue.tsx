import { useEffect, useRef, useState } from 'react';
import './assistant-queue.css';
import { sourceRequest } from './live-client';
import type { AssistantQueueState, AssistantQueuedMessage } from './assistant-queue-contract';

export function useAssistantQueue(
  routineId: string,
  ready: boolean,
  busy: boolean,
  execute: (item: AssistantQueuedMessage) => Promise<void>,
  report: (message: string) => void,
) {
  const [state, setState] = useState<AssistantQueueState>({
    items: [],
    active: false,
    canSteer: false,
    canAttach: false,
  });
  const refs = useRef({ execute, report, busy, state });
  refs.current = { execute, report, busy, state };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pumping = useRef(false);
  const refresh = async () => {
    const result = await sourceRequest<AssistantQueueState>('/assistant/queue/list', { routineId });
    if (result?.items) setState(result);
  };
  useEffect(() => {
    const c = new AbortController();
    const poll = async () => {
      try {
        const result = await sourceRequest<AssistantQueueState>(
          '/assistant/queue/list',
          { routineId },
          c.signal,
        );
        if (!c.signal.aborted && result?.items) setState(result);
      } catch {
        /* A failed poll must never replay a claimed question. Explicit actions show errors. */
      }
    };
    void poll();
    let lastPoll = Date.now();
    const timer = setInterval(() => {
      const current = refs.current;
      if (
        current.busy ||
        current.state.active ||
        current.state.items.length ||
        Date.now() - lastPoll >= 30000
      ) {
        lastPoll = Date.now();
        void poll();
      }
    }, 2000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [routineId]);
  useEffect(() => {
    if (
      !ready ||
      busy ||
      state.active ||
      pumping.current ||
      !state.items.some((q) => q.state === 'queued')
    )
      return;
    pumping.current = true;
    void (async () => {
      try {
        const result = await sourceRequest<{ item: AssistantQueuedMessage | null }>(
          '/assistant/queue/claim',
          { routineId },
        );
        if (result.item && mounted.current && !refs.current.busy)
          await refs.current.execute(result.item);
      } catch (e) {
        refs.current.report(e instanceof Error ? e.message : '대기 질문 실행 실패');
      } finally {
        pumping.current = false;
        if (mounted.current) await refresh().catch(() => undefined);
      }
    })();
  }, [state, ready, busy, routineId]);
  const action = async (action: string, item: AssistantQueuedMessage, prompt?: string) => {
    try {
      const result = await sourceRequest<{ prompt?: string }>(`/assistant/queue/${action}`, {
        routineId,
        id: item.id,
        revision: item.revision,
        ...(prompt ? { prompt } : {}),
      });
      if (action === 'steer') report(`현재 작업에 보충했습니다: ${result.prompt ?? item.prompt}`);
    } catch (e) {
      report(e instanceof Error ? e.message : '대기 질문 변경 실패');
    } finally {
      await refresh().catch(() => undefined);
    }
  };
  return { state, refresh, action };
}

export function AssistantQueue({
  state,
  action,
}: {
  state: AssistantQueueState;
  action: (action: string, item: AssistantQueuedMessage, prompt?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string>();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  if (!state.items.length) return null;
  const change = async (name: string, item: AssistantQueuedMessage, prompt?: string) => {
    setPending(true);
    try {
      await action(name, item, prompt);
      setEditing(undefined);
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="assistant-message-queue" aria-label="대기 질문">
      <small>대기 질문 · 순서대로 실행 · 앱 실행 중 처리</small>
      {state.items.map((item) => (
        <div key={item.id} className="assistant-queue-item">
          {editing === item.id ? (
            <>
              <textarea
                aria-label="대기 질문 수정"
                value={text}
                maxLength={6000}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                type="button"
                disabled={pending || !text.trim()}
                onClick={() => void change('edit', item, text)}
              >
                저장
              </button>
              <button type="button" onClick={() => setEditing(undefined)}>
                취소
              </button>
            </>
          ) : (
            <>
              <p>{item.prompt}</p>
              <small>
                {item.state === 'claimed'
                  ? '실행 중'
                  : item.state === 'failed'
                    ? item.error
                    : `대기${item.attachmentIds.length ? ` · 첨부 ${item.attachmentIds.length}개` : ''}`}
              </small>
              <div>
                {item.state === 'queued' && (
                  <>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setEditing(item.id);
                        setText(item.prompt);
                      }}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      title="현재 작업을 중단하고 이 질문을 다음으로 실행"
                      onClick={() => void change('next', item)}
                    >
                      먼저 실행
                    </button>
                    {state.canSteer && !item.attachmentIds.length && !item.paperReference && (
                      <button
                        type="button"
                        disabled={pending}
                        title="현재 Codex 작업에 텍스트 보충 · 이미 수행한 작업은 취소하지 않음"
                        onClick={() => void change('steer', item)}
                      >
                        현재 작업에 보충
                      </button>
                    )}
                  </>
                )}
                {item.state !== 'claimed' && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void change('delete', item)}
                  >
                    삭제
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
