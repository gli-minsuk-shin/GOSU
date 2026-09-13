import { useEffect, useRef, useState } from 'react';
import { DEFAULT_MAIL_LIMIT, MAX_MAIL_LIMIT, type MailScope } from '@gosu/briefing-core';
import type { MailDiscovery, MailConnectionStatus } from './live-types';
import { sourceRequest } from './live-client';
import { MailAccountList } from './mail-account-list';

const emptyMail = (): MailScope => ({
  accountId: '',
  mailboxId: '',
  days: 3,
  limit: DEFAULT_MAIL_LIMIT,
  subject: '',
  sender: '',
  unreadOnly: false,
  bodyPreview: true,
});
const scopeKey = (scope: MailScope) =>
  JSON.stringify([
    scope.accountId,
    scope.mailboxId,
    scope.days,
    scope.limit,
    scope.subject,
    scope.sender,
    scope.unreadOnly,
    scope.bodyPreview,
  ]);
type CheckedConnection = MailConnectionStatus & { scopeKey: string; checkedAt: string };
type Phase =
  | 'idle'
  | 'loading'
  | 'prepared'
  | 'configured'
  | 'connecting'
  | 'disconnecting'
  | 'connected'
  | 'expired'
  | 'disconnected'
  | 'unknown';
export function MailConnectionCard({
  phase,
  accountName,
  mailboxName,
  scope,
  expiresAt,
  checkedAt,
}: {
  phase: Phase;
  accountName: string;
  mailboxName: string;
  scope: MailScope;
  expiresAt?: string | null;
  checkedAt?: string;
}) {
  const titles: Record<Phase, string> = {
    idle: 'Apple Mail 연결 준비',
    loading: '계정·메일함을 함께 불러오는 중',
    prepared: '계정·메일함 준비 완료',
    configured: '메일 설정 저장됨 · 조회 시 자동 연결',
    connecting: '메일 읽기 연결 승인 대기',
    disconnecting: '메일 연결 해제 중',
    connected: '메일 읽기 연결됨',
    expired: '메일 읽기 연결 만료',
    disconnected: '메일 읽기 연결 필요',
    unknown: '메일 연결 상태 확인 필요',
  };
  const connected = phase === 'connected';
  return (
    <div
      className={`briefing-mail-connection ${phase}`}
      role="status"
      aria-live="polite"
      data-connection-state={phase}
    >
      <div className="briefing-mail-connection-icon" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <rect x="3" y="6" width="26" height="20" rx="5" stroke="currentColor" strokeWidth="2" />
          <path d="m5 9 11 8 11-8" stroke="currentColor" strokeWidth="2" />
          {connected && (
            <>
              <circle cx="25" cy="24" r="7" fill="#527d0b" />
              <path d="m21.5 24 2.5 2.5 4-5" stroke="white" strokeWidth="2" />
            </>
          )}
        </svg>
      </div>
      <div className="briefing-mail-connection-copy">
        <div className="briefing-mail-connection-heading">
          <strong>{titles[phase]}</strong>
          <span className="briefing-mail-state-badge">
            {connected
              ? '✓ 읽기 권한 활성'
              : phase === 'configured'
                ? '설정 저장됨'
                : phase === 'prepared'
                  ? '읽기 승인 필요'
                  : phase === 'expired'
                    ? '재연결 필요'
                    : 'READ ONLY'}
          </span>
        </div>
        <p className="briefing-mail-selected">
          <b>{accountName || '계정 선택 전'}</b>
          <span aria-hidden="true"> › </span>
          {mailboxName || '메일함 선택 전'}
        </p>
        {connected ? (
          <>
            <p>
              최근 {scope.days}일 · 최대 {scope.limit}개 ·{' '}
              {scope.bodyPreview ? '본문 앞부분 포함' : '본문 제외 · 메타데이터만'}
            </p>
            <p>
              {expiresAt && (
                <>
                  유효 시각 <b>{new Date(expiresAt).toLocaleTimeString()}</b> ·{' '}
                </>
              )}
              {checkedAt && <>마지막 확인 {new Date(checkedAt).toLocaleTimeString()}</>}
            </p>
            <p>
              설정 저장 후 실제 브리핑에서 조회하세요. 메일 수신/동기화 성공을 뜻하지는 않습니다.
            </p>
          </>
        ) : (
          <p>
            {phase === 'loading'
              ? '메일 본문은 읽지 않습니다. 계정을 바꿔도 추가로 메일함을 불러올 필요가 없습니다.'
              : phase === 'connecting'
                ? '직접 요청한 macOS 확인창에서 허용해주세요. LLM 전송은 별도 동의입니다.'
                : phase === 'expired'
                  ? '허용 시간이 끝났습니다. 아래에서 읽기 연결을 다시 허용해주세요.'
                  : phase === 'configured'
                    ? '저장된 계정·메일함 범위를 실제 조회 시 자동으로 연결합니다.'
                    : phase === 'prepared'
                      ? '조회할 계정과 메일함을 선택하고 아래에서 읽기 연결을 허용해주세요.'
                      : '계정·메일함 목록과 실제 읽기 권한을 구분해 표시합니다.'}
          </p>
        )}
      </div>
    </div>
  );
}
type MailSettingsProps = {
  routineId: string;
  value: MailScope | null;
  onChange: (scope: MailScope | null) => void;
  managedBySettings?: boolean;
};
export function MailConnectionSettings(props: MailSettingsProps) {
  return props.managedBySettings ? (
    <MailAccountList {...props} />
  ) : (
    <SingleMailConnectionSettings {...props} />
  );
}
function SingleMailConnectionSettings({
  routineId,
  value,
  onChange,
  managedBySettings = false,
}: {
  routineId: string;
  value: MailScope | null;
  onChange: (scope: MailScope | null) => void;
  managedBySettings?: boolean;
}) {
  const [mail, setMail] = useState<MailScope>(value ?? emptyMail()),
    [catalog, setCatalog] = useState<MailDiscovery | null>(null),
    [connection, setConnection] = useState<CheckedConnection | null>(null);
  const [working, setWorking] = useState<'loading' | 'connecting' | 'disconnecting' | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(''),
    [checkError, setCheckError] = useState(false),
    [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null),
    change = useRef(onChange);
  change.current = onChange;
  const valueKey = value ? scopeKey(value) : '';
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!value) return;
    const scope = value;
    let alive = true,
      inFlight = false;
    const c = new AbortController();
    const check = async () => {
      if (inFlight || !alive) return;
      inFlight = true;
      try {
        const state = await sourceRequest<MailConnectionStatus>(
          '/mail/status',
          { routineId, scope },
          c.signal,
        );
        if (alive) {
          setConnection({
            ...state,
            scopeKey: scopeKey(scope),
            checkedAt: new Date().toISOString(),
          });
          setCheckError(false);
        }
      } catch {
        if (alive) setCheckError(true);
      } finally {
        inFlight = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 30000);
    if (typeof window !== 'undefined') window.addEventListener('focus', check);
    return () => {
      alive = false;
      c.abort();
      clearInterval(timer);
      if (typeof window !== 'undefined') window.removeEventListener('focus', check);
    };
  }, [routineId, valueKey]);
  useEffect(() => {
    if (connection?.state !== 'connected' || !connection.expiresAt) return;
    const wait = Date.parse(connection.expiresAt) - Date.now();
    const expire = () =>
      setConnection((current) =>
        current === connection ? { ...connection, state: 'expired' } : current,
      );
    if (!Number.isFinite(wait) || wait <= 0) {
      expire();
      return;
    }
    const timer = setTimeout(expire, Math.min(wait, 2147483647));
    return () => clearTimeout(timer);
  }, [connection]);
  const work = async <T,>(
    phase: 'loading' | 'connecting' | 'disconnecting',
    task: (signal: AbortSignal) => Promise<T>,
    accept: (data: T) => void,
  ) => {
    if (controller.current) return;
    const c = new AbortController();
    controller.current = c;
    setWorking(phase);
    setError('');
    setMessage('');
    try {
      const data = await task(c.signal);
      if (!c.signal.aborted && controller.current === c) accept(data);
    } catch (e) {
      if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : '메일 연결을 확인하지 못했습니다.');
    } finally {
      if (controller.current === c) {
        controller.current = null;
        setWorking(null);
      }
    }
  };
  const edit = (patch: Partial<MailScope>) => {
    const next = { ...mail, ...patch };
    setMail(next);
    setConnection(null);
    setConfirmed(false);
    setCheckError(false);
    change.current(managedBySettings && next.accountId && next.mailboxId ? next : null);
    setMessage(
      managedBySettings
        ? '조건을 수정했습니다. AI 비서 설정에서 메일 읽기를 켜고 설정 저장을 누르세요.'
        : '조건이 바뀌어 읽기 승인이 다시 필요합니다.',
    );
  };
  const selected = catalog?.accounts.find((a) => a.id === mail.accountId),
    boxes = selected?.mailboxes ?? [];
  const checked = connection?.scopeKey === scopeKey(mail) ? connection : null;
  const accountName = selected?.name ?? checked?.accountName ?? '',
    mailboxName = boxes.find((b) => b.id === mail.mailboxId)?.name ?? checked?.mailboxName ?? '';
  const phase: Phase =
    working ??
    (checkError
      ? 'unknown'
      : checked?.state === 'connected'
        ? 'connected'
        : checked?.state === 'configured'
          ? 'configured'
          : checked?.state === 'expired'
            ? 'expired'
            : checked?.state === 'disconnected' || checked?.state === 'scope-changed'
              ? 'disconnected'
              : catalog
                ? catalog.accounts.some(
                    (account) => !account.unavailable && account.mailboxes.length,
                  )
                  ? 'prepared'
                  : 'disconnected'
                : value
                  ? 'unknown'
                  : 'idle');
  const busy = working !== null;
  return (
    <fieldset className="briefing-mail-settings">
      <legend>이메일 · Apple Mail (읽기 전용)</legend>
      <MailConnectionCard
        phase={phase}
        accountName={accountName}
        mailboxName={mailboxName}
        scope={mail}
        expiresAt={checked?.expiresAt ?? null}
        {...(checked ? { checkedAt: checked.checkedAt } : {})}
      />
      <p>
        Mac에 등록된 계정·메일함 목록을 한 번에 가져옵니다. 메일 본문 읽기와 LLM 전송은 각각 별도
        허용이 필요합니다. 원본 변경·첨부 열기·보내기는 지원하지 않습니다.
      </p>
      <button
        type="button"
        className="briefing-button"
        disabled={busy}
        onClick={() =>
          void work(
            'loading',
            (signal) => sourceRequest<MailDiscovery>('/mail/discover', {}, signal),
            (data) => {
              setCatalog(data);
              setMessage(
                data.accounts.length
                  ? '계정·메일함 목록을 함께 불러왔습니다.'
                  : 'Apple Mail에 등록된 계정이 없습니다.',
              );
            },
          )
        }
      >
        {catalog ? '계정·메일함 새로고침' : 'Apple Mail 계정·메일함 불러오기'}
      </button>
      {catalog && (
        <p className="briefing-mail-catalog-summary">
          계정 {catalog.accounts.length}개 · 메일함{' '}
          {catalog.accounts.reduce((count, account) => count + account.mailboxes.length, 0)}개
          {catalog.accounts.some((account) => account.unavailable) && (
            <>
              {' '}
              · {catalog.accounts.filter((account) => account.unavailable).length}개 계정의 메일함
              조회 실패
            </>
          )}
        </p>
      )}
      {checked && (
        <p className="briefing-mail-permission-summary">
          Mail 읽기{' '}
          {checked.mailRead === false ? '차단' : checked.mailRead ? '허용' : '설정 확인 필요'} · AI
          전송 {checked.mailAi ? '허용' : '차단'} ·{' '}
          {checked.approved === false ? '저장된 권한 확인 필요' : '루틴 설정 권한 확인됨'}
        </p>
      )}
      {catalog?.limited && <p role="note">목록 크기 제한으로 일부만 표시합니다.</p>}
      <div className="briefing-form-grid">
        <label className="briefing-field">
          <span>메일 계정</span>
          <select
            value={mail.accountId}
            disabled={busy || !catalog?.accounts.length}
            onChange={(e) => edit({ accountId: e.target.value, mailboxId: '' })}
          >
            <option value="">계정 선택</option>
            {!selected && mail.accountId && (
              <option value={mail.accountId}>
                {accountName || '저장한 계정 · 목록 불러오기 필요'}
              </option>
            )}
            {catalog?.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.unavailable ? ' · 메일함 조회 실패' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="briefing-field">
          <span>메일함</span>
          <select
            value={mail.mailboxId}
            disabled={busy || !selected || selected.unavailable || !boxes.length}
            onChange={(e) => edit({ mailboxId: e.target.value })}
          >
            <option value="">메일함 선택</option>
            {!boxes.some((b) => b.id === mail.mailboxId) && mail.mailboxId && (
              <option value={mail.mailboxId}>
                {mailboxName || '저장한 메일함 · 목록 불러오기 필요'}
              </option>
            )}
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="briefing-field">
          <span>메일 검색 기간 (최근 일수)</span>
          <input
            type="number"
            min={1}
            max={30}
            value={mail.days}
            disabled={busy}
            onChange={(e) => edit({ days: Number(e.target.value) })}
          />
        </label>
        <label className="briefing-field">
          <span>메일 최대 표시 수</span>
          <input
            type="number"
            min={1}
            max={MAX_MAIL_LIMIT}
            value={mail.limit}
            disabled={busy}
            onChange={(e) => edit({ limit: Number(e.target.value) })}
          />
          <small>
            1~{MAX_MAIL_LIMIT}개 · 기본 {DEFAULT_MAIL_LIMIT}개
          </small>
        </label>
        <label className="briefing-field">
          <span>메일 제목 포함 (선택)</span>
          <input
            value={mail.subject}
            maxLength={200}
            disabled={busy}
            onChange={(e) => edit({ subject: e.target.value })}
          />
        </label>
        <label className="briefing-field">
          <span>메일 발신자 포함 (선택)</span>
          <input
            value={mail.sender}
            maxLength={200}
            disabled={busy}
            onChange={(e) => edit({ sender: e.target.value })}
          />
        </label>
      </div>
      {selected?.unavailable && (
        <p role="alert">
          이 계정의 메일함 목록을 읽지 못했습니다. 다른 계정의 결과는 유지됩니다. Mail 앱 상태를
          확인하고 목록을 새로고침해주세요.
        </p>
      )}
      {selected?.limited && (
        <p role="note">이 계정의 메일함은 개수/깊이 제한으로 일부만 표시됩니다.</p>
      )}
      {selected && !selected.unavailable && !boxes.length && (
        <p>이 계정에서 선택할 메일함을 찾지 못했습니다.</p>
      )}
      <label>
        <input
          type="checkbox"
          checked={mail.unreadOnly}
          disabled={busy}
          onChange={(e) => edit({ unreadOnly: e.target.checked })}
        />{' '}
        읽지 않은 메일만
      </label>
      <label>
        <input
          type="checkbox"
          checked={mail.bodyPreview}
          disabled={busy}
          onChange={(e) => edit({ bodyPreview: e.target.checked })}
        />{' '}
        본문 앞부분 최대 4,000자 조회 (LLM 요약은 별도 허용)
      </label>
      {!managedBySettings && (
        <>
          <label className="briefing-mail-consent">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{' '}
            선택한 계정·메일함과 위 기간/필터만 읽도록 허용합니다.
          </label>
          <div className="routine-compose-actions">
            <button
              type="button"
              className="briefing-button"
              disabled={
                busy ||
                !confirmed ||
                !mail.accountId ||
                !mail.mailboxId ||
                !boxes.some((b) => b.id === mail.mailboxId) ||
                Boolean(selected?.unavailable)
              }
              onClick={() =>
                void work(
                  'connecting',
                  (signal) =>
                    sourceRequest<{ expiresAt: string }>(
                      '/mail/authorize',
                      { routineId, scope: mail },
                      signal,
                    ),
                  (data) => {
                    setConnection({
                      state: 'connected',
                      expiresAt: data.expiresAt,
                      accountName,
                      mailboxName,
                      scopeKey: scopeKey(mail),
                      checkedAt: new Date().toISOString(),
                    });
                    setCheckError(false);
                    change.current(mail);
                    setMessage(
                      '메일 읽기 연결을 허용했습니다. 아래 설정 저장을 눌러 루틴에 적용하세요.',
                    );
                  },
                )
              }
            >
              이 조건으로 메일 읽기 연결
            </button>
            <button
              type="button"
              className="briefing-text-button danger"
              disabled={busy}
              onClick={() =>
                void work(
                  'disconnecting',
                  (signal) => sourceRequest('/mail/revoke', { routineId }, signal),
                  () => {
                    setConnection({
                      state: 'disconnected',
                      expiresAt: null,
                      scopeKey: scopeKey(mail),
                      checkedAt: new Date().toISOString(),
                    });
                    setCheckError(false);
                    setConfirmed(false);
                    change.current(null);
                    setMessage('메일 읽기 연결을 해제했습니다.');
                  },
                )
              }
            >
              메일 연결 해제
            </button>
          </div>
        </>
      )}
      {managedBySettings && (
        <p className="briefing-muted">
          연결·LLM 사용 권한은 아래 AI 비서 설정에서 관리합니다. 이곳에서는 메일 범위만 정합니다.
        </p>
      )}
      {message && <p className="briefing-muted">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {busy && (
        <button
          type="button"
          className="briefing-button"
          onClick={() => {
            controller.current?.abort();
            controller.current = null;
            setWorking(null);
            setMessage('메일 연결 요청을 중단했습니다.');
          }}
        >
          메일 요청 중단
        </button>
      )}
      <p className="briefing-muted">
        {managedBySettings
          ? '저장한 읽기 권한은 설정에서 끌 때까지 유지합니다.'
          : '읽기 권한은 최대 30분이며 상태를 자동으로 재확인합니다.'}{' '}
        GOSU는 원본 메일 본문을 자동 보관하지 않습니다. AI 분석을 허용하면 요약을 암호화된 backend에
        저장하며 선택한 LLM/CLI의 대화·로그 보관 정책이 적용됩니다. 필터와 불투명 계정·메일함 ID는
        루틴 설정에 보관합니다.
      </p>
    </fieldset>
  );
}
