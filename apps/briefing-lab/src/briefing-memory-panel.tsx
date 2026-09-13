import { useRef, useState, useEffect, type ChangeEvent } from 'react';
import {
  BriefingMemorySchema,
  BriefingProjectContextSchema,
  rememberBriefingEntry,
  type BriefingMemory,
  type BriefingMemoryEntry,
} from './briefing-intelligence';
import { openBriefingVault, saveBriefingVault } from './briefing-memory-vault';
export type BriefingMemorySession = {
  memory: BriefingMemory;
  remember: (entry: Omit<BriefingMemoryEntry, 'id' | 'createdAt'>) => Promise<void>;
};
export function BriefingMemoryPanel({
  routineId,
  onSession,
}: {
  routineId: string;
  onSession: (session: BriefingMemorySession | null) => void;
}) {
  const [password, setPassword] = useState(''),
    [note, setNote] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const vault = useRef<Awaited<ReturnType<typeof openBriefingVault>> | null>(null),
    chain = useRef(Promise.resolve());
  const file = useRef<HTMLInputElement | null>(null);
  useEffect(
    () => () => {
      vault.current = null;
    },
    [],
  );
  const update = (mutate: (memory: BriefingMemory) => BriefingMemory) => {
    const current = vault.current;
    if (!current) return Promise.reject(new Error('Memory를 먼저 열어주세요.'));
    const pending = chain.current.then(async () => {
      if (vault.current !== current) throw new Error('Memory가 잠겼습니다.');
      const next = BriefingMemorySchema.parse(mutate(current.memory));
      await saveBriefingVault(localStorage, current, next);
      if (vault.current !== current) return;
      current.memory = next;
      setRevision((n) => n + 1);
      publish();
    });
    chain.current = pending.catch(() => undefined);
    return pending;
  };
  const remember = async (entry: Omit<BriefingMemoryEntry, 'id' | 'createdAt'>) =>
    update((memory) =>
      rememberBriefingEntry(memory, {
        ...entry,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      }),
    );
  const publish = () =>
    onSession(vault.current ? { memory: vault.current.memory, remember } : null);
  const unlock = async () => {
    setBusy(true);
    setError('');
    try {
      const opened = await openBriefingVault(localStorage, password);
      await saveBriefingVault(localStorage, opened, opened.memory);
      vault.current = opened;
      setPassword('');
      setRevision((n) => n + 1);
      publish();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Memory 오류');
    } finally {
      setBusy(false);
    }
  };
  const importContext = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected) return;
    try {
      if (selected.size > 64000) throw new Error('프로젝트 context는 64KB 이하만 가져옵니다.');
      const value = BriefingProjectContextSchema.parse(JSON.parse(await selected.text()));
      if (
        !window.confirm(
          `${value.projectName}의 프로젝트 memory 요약을 이 루틴에 연결할까요? 이후 AI 요약 요청 시 선택한 LLM에 전달됩니다.\n\n${value.summary.slice(0, 1200)}`,
        )
      )
        return;
      await remember({
        routineId,
        kind: 'project',
        text: `${value.projectName} · memory r${value.memoryRevision} · ${value.exportedAt}\n${value.summary}`.slice(
          0,
          4000,
        ),
        sourceId: `project:${value.projectId}`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '프로젝트 context 오류');
    }
  };
  const entries =
    vault.current?.memory.entries.filter((entry) => entry.routineId === routineId) ?? [];
  return (
    <details className="briefing-memory-panel" data-memory-revision={revision}>
      <summary>
        Briefing memory{' '}
        <span>{vault.current ? `${entries.length}개 · 잠금 해제됨` : '암호화 저장소 · 잠김'}</span>
      </summary>
      <p>
        중요/관심 없음 피드백, 직접 기록한 선호와 승인한 프로젝트 요약을 다음 분석에 재사용합니다.
        LLM 자체를 재학습하는 기능은 아닙니다.
      </p>
      {!vault.current ? (
        <div className="briefing-live-actions">
          <input
            aria-label="Briefing memory 암호"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="12자 이상 · 잊으면 복구 불가"
          />
          <button
            className="briefing-button"
            type="button"
            disabled={busy || password.length < 12}
            onClick={() => void unlock()}
          >
            {busy ? 'Memory 열기 중…' : 'Memory 만들기 / 열기'}
          </button>
        </div>
      ) : (
        <>
          <div className="briefing-live-actions">
            <input
              aria-label="Briefing 선호 기억"
              value={note}
              maxLength={4000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 이론적 근거와 재현 가능한 구현을 우선"
            />
            <button
              type="button"
              className="briefing-button"
              disabled={!note.trim()}
              onClick={() =>
                void remember({
                  routineId,
                  kind: 'preference',
                  text: note.trim(),
                  sourceId: `preference:${crypto.randomUUID()}`,
                })
                  .then(() => setNote(''))
                  .catch((e) => setError(String(e)))
              }
            >
              기억하기
            </button>
          </div>
          <input
            hidden
            type="file"
            accept=".json"
            ref={file}
            onChange={(e) => void importContext(e)}
          />
          <button type="button" className="briefing-button" onClick={() => file.current?.click()}>
            GOSU 프로젝트 memory 가져오기
          </button>
          <p className="briefing-muted">
            GOSU Project Chat → Briefing context 내보내기의 JSON을 연결합니다. 선택한 snapshot만
            가져오며 자동 동기화하지 않습니다.
          </p>
          <ul>
            {entries.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.kind}</strong>
                <span>{entry.text}</span>
                <button
                  type="button"
                  aria-label={`Memory ${entry.id} 삭제`}
                  onClick={() =>
                    void update((memory) => ({
                      ...memory,
                      entries: memory.entries.filter((e) => e.id !== entry.id),
                    })).catch((e) => setError(String(e)))
                  }
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="briefing-text-button"
            onClick={() => {
              vault.current = null;
              onSession(null);
              setRevision((n) => n + 1);
            }}
          >
            Memory 잠그기
          </button>
        </>
      )}
      <small>
        암호는 서버에 보내거나 저장하지 않습니다. AES-GCM 암호문만 브라우저 저장소에 남습니다. 잠금
        해제된 화면/XSS/악성 확장까지 막는 보안 경계는 아닙니다.
      </small>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
