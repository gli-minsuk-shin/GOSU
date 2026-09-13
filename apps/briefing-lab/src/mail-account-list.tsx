import { useEffect, useRef, useState } from 'react';
import {
  mailTargets,
  withMailTargets,
  DEFAULT_MAIL_LIMIT,
  MAX_MAIL_LIMIT,
  type MailScope,
  type MailTarget,
} from '@gosu/briefing-core';
import { sourceRequest } from './live-client';
import type { MailConnectionStatus, MailDiscovery } from './live-types';
import './mail-account-list.css';

const defaults: MailScope = {
  accountId: '',
  mailboxId: '',
  days: 3,
  limit: DEFAULT_MAIL_LIMIT,
  subject: '',
  sender: '',
  unreadOnly: false,
  bodyPreview: true,
};
const accountLabel = (account: MailDiscovery['accounts'][number]) =>
  (account.addresses?.[0] ? `${account.name} · ${account.addresses[0]}` : account.name).slice(
    0,
    200,
  );
export function MailAccountList({
  routineId,
  value,
  onChange,
}: {
  routineId: string;
  value: MailScope | null;
  onChange: (scope: MailScope | null) => void;
}) {
  const [catalog, setCatalog] = useState<MailDiscovery | null>(null);
  const [adding, setAdding] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState<{ key: string; status: MailConnectionStatus } | null>(
    null,
  );
  const [checkFailed, setCheckFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const lastFilters = useRef(value ?? defaults);
  if (value) lastFilters.current = value;
  const mail = value ?? lastFilters.current;
  const targets = mailTargets(value);
  const key = JSON.stringify(value);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!value) return;
    const controller = new AbortController();
    let inFlight = false;
    const check = async () => {
      if (controller.signal.aborted || inFlight) return;
      inFlight = true;
      try {
        const status = await sourceRequest<MailConnectionStatus>(
          '/mail/status',
          { routineId, scope: value },
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setChecked({ key, status });
          setCheckFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setCheckFailed(true);
      } finally {
        inFlight = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 30_000);
    if (typeof window !== 'undefined') window.addEventListener('focus', check);
    return () => {
      controller.abort();
      clearInterval(timer);
      if (typeof window !== 'undefined') window.removeEventListener('focus', check);
    };
  }, [routineId, key]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const expiresAt = checked?.status.expiresAt;
    if (!expiresAt) return;
    const delay = Date.parse(expiresAt) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(delay + 1, 2147483647));
    return () => clearTimeout(timer);
  }, [checked, tick]);
  const state = checked?.key === key && !checkFailed ? checked.status : null;
  const active =
    state?.state === 'connected' &&
    Boolean(state.expiresAt && Date.parse(state.expiresAt) > Date.now());
  const labelFor = (target: MailTarget) => {
    const account = catalog?.accounts.find((a) => a.id === target.accountId);
    return (
      (account ? accountLabel(account) : '') ||
      target.accountName ||
      (target.accountId === value?.accountId ? state?.accountName : '') ||
      `저장한 계정 · ${target.accountId.slice(0, 8)}`
    );
  };
  const update = (next: MailTarget[]) => {
    const labelled = next.map((target) => {
      const account = catalog?.accounts.find((a) => a.id === target.accountId);
      const box = account?.mailboxes.find((b) => b.id === target.mailboxId);
      return {
        ...target,
        ...(account ? { accountName: accountLabel(account) } : {}),
        ...(box ? { mailboxName: box.name } : {}),
      };
    });
    onChange(withMailTargets(mail, labelled));
  };
  const discover = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const result = await sourceRequest<MailDiscovery>('/mail/discover', {}, controller.signal);
      if (!controller.signal.aborted) setCatalog(result);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : '계정 목록을 확인하지 못했습니다.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  };
  const remaining =
    catalog?.accounts.filter((a) => !targets.some((t) => t.accountId === a.id)) ?? [];
  return (
    <fieldset className="briefing-mail-settings briefing-mail-account-settings">
      <legend>이메일 · Apple Mail (읽기 전용)</legend>
      <div className="mail-account-toolbar">
        <div>
          <strong>{`연결할 계정 ${targets.length}개`}</strong>
          <p>
            계정별 메일함을 선택하세요. 변경 사항은 아래 <b>설정 저장</b>으로 적용됩니다.
          </p>
        </div>
        <div className="mail-account-actions">
          <button
            type="button"
            className="briefing-button"
            aria-label="계정 목록 새로고침"
            disabled={loading}
            onClick={() => void discover()}
          >
            ↻ 새로고침
          </button>
          <button
            type="button"
            className="briefing-button"
            aria-label="계정 추가"
            aria-expanded={adding}
            disabled={loading || targets.length >= 5}
            onClick={() => {
              setAdding(true);
              if (!catalog) void discover();
            }}
          >
            ＋ 계정 추가
          </button>
        </div>
      </div>
      <ul className="mail-account-list" aria-label="Briefing에 연결할 이메일 계정">
        {targets.map((target) => {
          const account = catalog?.accounts.find((a) => a.id === target.accountId);
          const box = account?.mailboxes.find((b) => b.id === target.mailboxId);
          const name = labelFor(target);
          const unavailable = account?.unavailable;
          const missing =
            catalog &&
            ((!account && !catalog.limited) ||
              (account && !unavailable && !account.limited && !box));
          const status = unavailable
            ? '메일함 조회 실패'
            : missing
              ? '목록에서 찾을 수 없음'
              : checkFailed
                ? '권한 확인 실패'
                : !state
                  ? '권한 확인 중'
                  : state.mailRead === false
                    ? '읽기 꺼짐'
                    : !state.approved
                      ? '저장·권한 확인 필요'
                      : active
                        ? '읽기 권한 활성'
                        : '저장됨 · 조회 시 자동 연결';
          return (
            <li key={target.accountId} className="mail-account-row">
              <span className="mail-account-symbol" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <rect x="3" y="5" width="18" height="14" rx="3" />
                  <path d="m4 7 8 6 8-6" />
                </svg>
              </span>
              <div className="mail-account-identity">
                <strong>{name}</strong>
                <span
                  className={`mail-account-status ${unavailable || missing || checkFailed ? 'warning' : state?.approved ? 'saved' : ''}`}
                >
                  {status}
                </span>
                {!catalog && <small>저장한 연결 · 목록 확인 전</small>}
                {account?.limited && <small>메일함 목록 일부만 표시</small>}
              </div>
              <label className="mail-account-mailbox">
                <span>연결 메일함</span>
                <select
                  aria-label={`${name} 연결 메일함`}
                  value={target.mailboxId}
                  disabled={!account || unavailable || loading}
                  onChange={(e) =>
                    update(
                      targets.map((t) =>
                        t.accountId === target.accountId ? { ...t, mailboxId: e.target.value } : t,
                      ),
                    )
                  }
                >
                  {!box && (
                    <option value={target.mailboxId}>
                      {target.mailboxName ||
                        (target.accountId === value?.accountId ? state?.mailboxName : '') ||
                        '저장한 메일함'}
                    </option>
                  )}
                  {account?.mailboxes.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="mail-account-remove"
                aria-label={`${name} 연결 삭제`}
                title="Briefing 연결에서 삭제 · Apple Mail 계정은 유지"
                onClick={() => update(targets.filter((t) => t.accountId !== target.accountId))}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7m4-7v7" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
      {!targets.length && (
        <div className="mail-account-empty">
          연결한 계정이 없습니다. <b>계정 추가</b>에서 Apple Mail에 등록된 계정을 선택하세요.
        </div>
      )}
      {loading && (
        <p role="status">
          계정·메일함 목록 확인 중 · 메일 내용은 읽지 않습니다.{' '}
          <button
            type="button"
            className="briefing-text-button"
            onClick={() => {
              request.current?.abort();
              request.current = null;
              setLoading(false);
            }}
          >
            취소
          </button>
        </p>
      )}
      {adding && (
        <div className="mail-account-picker" aria-label="추가 가능한 Apple Mail 계정">
          <div className="mail-account-toolbar">
            <strong>추가할 계정 선택</strong>
            <button type="button" className="briefing-text-button" onClick={() => setAdding(false)}>
              닫기
            </button>
          </div>
          {remaining.map((account) => (
            <div className="mail-account-candidate" key={account.id}>
              <div>
                <strong>{accountLabel(account)}</strong>
                <small>{account.unavailable ? '메일함 조회 실패' : '이 루틴에 연결 안 됨'}</small>
              </div>
              <select
                aria-label={`${account.name} 추가할 메일함`}
                value={choices[account.id] ?? ''}
                disabled={account.unavailable || loading || !account.mailboxes.length}
                onChange={(e) => setChoices({ ...choices, [account.id]: e.target.value })}
              >
                <option value="">메일함 선택</option>
                {account.mailboxes.map((box) => (
                  <option key={box.id} value={box.id}>
                    {box.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="briefing-button"
                aria-label={`${account.name} 연결 추가`}
                disabled={
                  loading ||
                  targets.length >= 5 ||
                  account.unavailable ||
                  !account.mailboxes.some((b) => b.id === choices[account.id])
                }
                onClick={() =>
                  update([...targets, { accountId: account.id, mailboxId: choices[account.id]! }])
                }
              >
                추가
              </button>
            </div>
          ))}
          {catalog && !remaining.length && (
            <p>
              {catalog.accounts.length
                ? '목록의 모든 계정을 연결했습니다.'
                : 'Apple Mail에 등록된 계정을 찾지 못했습니다.'}
            </p>
          )}
          <p className="briefing-muted">
            Mac에 새 계정을 등록하려면 Apple Mail → 설정 → 계정에서 추가한 뒤 이 목록을
            새로고침하세요.
          </p>
        </div>
      )}
      {catalog?.limited && (
        <p role="note">
          목록 크기 제한으로 일부 계정만 표시됩니다. 목록에 없는 저장된 연결은 유지합니다.
        </p>
      )}
      {error && <p role="alert">{error} 기존 연결은 유지됩니다.</p>}
      {targets.length > 0 && (
        <section className="mail-account-filters" aria-label="공통 조회 조건">
          <h4>
            공통 조회 조건 · 최근 {mail.days}일 · 전체 최대 {mail.limit}개
          </h4>
          <div className="briefing-form-grid">
            <label className="briefing-field">
              <span>메일 검색 기간 (최근 일수)</span>
              <input
                type="number"
                min={1}
                max={30}
                value={mail.days}
                onChange={(e) => onChange({ ...mail, days: Number(e.target.value) })}
              />
            </label>
            <label className="briefing-field">
              <span>전체 계정 최대 표시 수</span>
              <input
                type="number"
                min={1}
                max={MAX_MAIL_LIMIT}
                value={mail.limit}
                onChange={(e) => onChange({ ...mail, limit: Number(e.target.value) })}
              />
              <small>
                1~{MAX_MAIL_LIMIT}개 · 기본 {DEFAULT_MAIL_LIMIT}개
              </small>
            </label>
            <label className="briefing-field">
              <span>메일 제목 포함 (선택)</span>
              <input
                maxLength={200}
                value={mail.subject}
                onChange={(e) => onChange({ ...mail, subject: e.target.value })}
              />
            </label>
            <label className="briefing-field">
              <span>메일 발신자 포함 (선택)</span>
              <input
                maxLength={200}
                value={mail.sender}
                onChange={(e) => onChange({ ...mail, sender: e.target.value })}
              />
            </label>
          </div>
          {mail.limit !== DEFAULT_MAIL_LIMIT && (
            <button
              type="button"
              className="briefing-text-button"
              onClick={() => onChange({ ...mail, limit: DEFAULT_MAIL_LIMIT })}
            >
              기본값 50개로 변경
            </button>
          )}
          <label>
            <input
              type="checkbox"
              checked={mail.unreadOnly}
              onChange={(e) => onChange({ ...mail, unreadOnly: e.target.checked })}
            />{' '}
            읽지 않은 메일만
          </label>
          <label>
            <input
              type="checkbox"
              checked={mail.bodyPreview}
              onChange={(e) => onChange({ ...mail, bodyPreview: e.target.checked })}
            />{' '}
            본문 앞부분 최대 4,000자 조회 · LLM 전송은 별도 허용
          </label>
        </section>
      )}
      <p className="briefing-muted">
        기본 조회는 이미 요약한 메일을 제외한 전체 최대 50개입니다. 첫 연결 확인 때는 전체 최대
        3개만 가져오고, 이후 설정한 개수로 늘어납니다. 기존에 저장한 개수는 유지되며 공통 조회
        조건에서 변경할 수 있습니다.
      </p>
      <p className="briefing-muted">
        최대 5개 계정 · 계정마다 메일함 1개. 삭제는 이 루틴의 연결만 제거하며 Apple Mail 계정과 원본
        메일은 유지합니다. 읽기 권한과 AI 전송은 아래 AI 비서 설정에서 관리합니다. 권한 활성은 메일
        서버 동기화 성공을 뜻하지 않습니다.
      </p>
      <p className="briefing-muted">
        선택한 계정·메일함의 이름과 ID, 필터는 루틴 설정에 저장합니다. 원본 메일 본문은 자동
        보관하지 않습니다. AI 분석을 허용하면 요약은 암호화해 보관하며 선택한 LLM/CLI의 대화·로그
        보관 정책이 적용됩니다.
      </p>
    </fieldset>
  );
}
