import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { sourceRequest } from './live-client';
import type { StoredMemoryEntry } from '../briefing-memory-store';
import { BriefingProjectContextSchema } from './briefing-intelligence';
import {
  BriefingMemoryPanel as LegacyMemoryPanel,
  type BriefingMemorySession,
} from './briefing-memory-panel';
type Status = {
  state: 'ready';
  count: number;
  automatic: number;
  feedbackImportant?: number;
  feedbackNotInterested?: number;
  revision: number;
  lastSavedAt: string | null;
};
type Review = { entries: StoredMemoryEntry[]; revision: number; token: string };
export function BackendMemoryPanel({ routineId, refresh }: { routineId: string; refresh: number }) {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<Review | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [text, setText] = useState(''),
    [legacy, setLegacy] = useState<BriefingMemorySession | null>(null),
    [showLegacy, setShowLegacy] = useState(false);
  const controller = useRef<AbortController | null>(null),
    file = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void sourceRequest<Status>('/memory/status', { routineId }, c.signal)
      .then((value) => {
        if (!c.signal.aborted) {
          setStatus(value);
          setError('');
        }
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError('자동 기억 상태를 확인하지 못했습니다. 요약은 현재 자료로 계속할 수 있습니다.');
      });
    return () => c.abort();
  }, [routineId, refresh]);
  useEffect(() => () => controller.current?.abort(), []);
  const work = async (task: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current) return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError('');
    try {
      await task(c.signal);
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : 'Memory 오류');
    } finally {
      if (controller.current === c) {
        controller.current = null;
        setBusy(false);
      }
    }
  };
  const getReview = async (signal: AbortSignal) => {
    const value = await sourceRequest<Review>(
      '/memory/review',
      { routineId, ...(review ? { token: review.token } : {}) },
      signal,
    );
    if (!signal.aborted) setReview(value);
    return value;
  };
  const refreshStatus = async (signal: AbortSignal) => {
    const value = await sourceRequest<Status>('/memory/status', { routineId }, signal);
    if (!signal.aborted) setStatus(value);
  };
  const edit = async (id: string, value: string | null) =>
    work(async (signal) => {
      if (!review) return;
      const next = await sourceRequest<Review>(
        '/memory/edit',
        { routineId, token: review.token, id, revision: review.revision, text: value },
        signal,
      );
      if (!signal.aborted) {
        setReview(next);
        setEditing(null);
      }
      await refreshStatus(signal);
    });
  const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected) return;
    await work(async (signal) => {
      if (selected.size > 64000) throw new Error('프로젝트 context는 64KB 이하만 가져옵니다.');
      const data = BriefingProjectContextSchema.parse(JSON.parse(await selected.text()));
      const session = await getReview(signal);
      const next = await sourceRequest<Review>(
        '/memory/import',
        {
          routineId,
          token: session.token,
          entries: [
            {
              id: crypto.randomUUID(),
              routineId,
              kind: 'project',
              text: `${data.projectName} · memory r${data.memoryRevision}\n${data.summary}`.slice(
                0,
                4000,
              ),
              sourceId: `project:${data.projectId}`,
              createdAt: new Date().toISOString(),
            },
          ],
        },
        signal,
      );
      if (!signal.aborted) setReview(next);
      await refreshStatus(signal);
    });
  };
  return (
    <details
      className="briefing-memory-panel briefing-backend-memory"
      data-memory-mode="backend-auto"
    >
      <summary>
        Briefing memory{' '}
        <span>
          {status
            ? `${status.count}개 · backend 자동 저장 · 중요 ${status.feedbackImportant ?? 0} · 관심 없음 ${status.feedbackNotInterested ?? 0}`
            : 'backend 자동 저장 · 상태 확인 중'}
        </span>
      </summary>
      <p>
        <strong>기억을 직접 적거나 매번 암호를 입력할 필요가 없습니다.</strong> 요약이 끝나면 필요한
        맥락을 자동 저장하고, 다음 분석에서 관련 기억을 불러옵니다.
      </p>
      <p>
        {status?.lastSavedAt
          ? `마지막 저장 ${new Date(status.lastSavedAt).toLocaleString()} · 자동 기억 ${status.automatic}개 · 선호 피드백은 다음 요약의 우선순위 신호로 사용됩니다.`
          : '첫 요약이 완료되면 자동 기억이 생깁니다.'}
      </p>
      <p className="briefing-muted">
        로컬 backend의 AES-GCM 암호화 파일 · 키는 macOS Keychain 보관. 이전 AI 요약은 검증된 사실로
        취급하지 않습니다. 원문 전체·인증 코드는 자동 저장하지 않습니다.
      </p>
      <div className="briefing-live-actions">
        <button
          className="briefing-button"
          type="button"
          disabled={busy}
          onClick={() =>
            void work(async (signal) => {
              await getReview(signal);
            })
          }
        >
          기억 확인 · 수정/삭제
        </button>
        <button
          className="briefing-button"
          type="button"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          GOSU 프로젝트 요약 연결
        </button>
      </div>
      <input hidden ref={file} type="file" accept=".json" onChange={(e) => void importProject(e)} />
      {review && (
        <ul>
          {review.entries.map((entry) => (
            <li key={entry.id}>
              <strong>
                {entry.origin === 'automatic'
                  ? '자동 기억'
                  : entry.origin === 'feedback'
                    ? '선호 피드백'
                    : '검토한 기억'}{' '}
                · {entry.kind}
                {entry.feedbackDecision === 'important' && ' · ★ 중요함'}
                {entry.feedbackDecision === 'not-interested' && ' · ⊘ 관심 없음'}
              </strong>
              {editing === entry.id ? (
                <>
                  <textarea
                    aria-label="기억 수정"
                    value={text}
                    maxLength={4000}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={busy || !text.trim()}
                    onClick={() => void edit(entry.id, text)}
                  >
                    수정 저장
                  </button>
                </>
              ) : (
                <>
                  <span>{entry.text}</span>
                  <div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditing(entry.id);
                        setText(entry.text);
                      }}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm('이 기억을 삭제하고 동일 항목의 자동 재저장을 막을까요?')
                        )
                          void edit(entry.id, null);
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">자동 기억 처리 중 · macOS 확인창이 있으면 직접 확인해주세요.</p>}
      <details>
        <summary>이전 브라우저 기억 가져오기 (선택)</summary>
        <p>기존 암호화 기억은 지우지 않았습니다. 이전할 때만 기존 암호가 필요합니다.</p>
        <button type="button" onClick={() => setShowLegacy(true)}>
          이전 기억 열기
        </button>
        {showLegacy && <LegacyMemoryPanel routineId={routineId} onSession={setLegacy} />}
        <button
          type="button"
          disabled={busy || !legacy}
          onClick={() =>
            void work(async (signal) => {
              if (!legacy) return;
              let session = await getReview(signal);
              const entries = legacy.memory.entries.filter((e) => e.routineId === routineId);
              for (let i = 0; i < entries.length; i += 3)
                session = await sourceRequest<Review>(
                  '/memory/import',
                  { routineId, token: session.token, entries: entries.slice(i, i + 3) },
                  signal,
                );
              if (!signal.aborted) setReview(session);
              await refreshStatus(signal);
            })
          }
        >
          열어 둔 기존 기억을 backend로 가져오기
        </button>
      </details>
    </details>
  );
}
