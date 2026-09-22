import { safeAppleMailUrl } from './apple-mail-url';
import { useEffect, useRef, useState } from 'react';
import { sourceRequest } from './live-client';
import { MailOpenRequestSchema, type MailOpenTarget } from './mail-open-contract';
export { appleMailMessageUrl, safeAppleMailUrl } from './apple-mail-url';

export function AppleMailLink({
  url,
  target,
  onOpened,
}: {
  url?: string | undefined;
  target?: MailOpenTarget | undefined;
  /** Called once Apple Mail accepted the open request. */
  onOpened?: (() => void) | undefined;
}) {
  const available = Boolean(
    safeAppleMailUrl(url) && MailOpenRequestSchema.safeParse(target).success,
  );
  const [pending, setPending] = useState(false),
    [notice, setNotice] = useState(''),
    [failed, setFailed] = useState(false);
  const lock = useRef(false),
    controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const icon = (
    <svg
      data-mail-icon="open-in-app"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3h7v7M10 14 21 3" />
      <path d="M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
    </svg>
  );
  return available ? (
    <span className="briefing-mail-open-control">
      <button
        type="button"
        className="briefing-mail-open"
        aria-label="Apple Mail에서 원본 메일 열기"
        title={notice || 'Apple Mail에서 이 메일 열기'}
        disabled={pending}
        aria-busy={pending}
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (lock.current) return;
          lock.current = true;
          setPending(true);
          setFailed(false);
          setNotice('Apple Mail에 열기 요청을 보내는 중…');
          const cancel = new AbortController();
          controller.current = cancel;
          try {
            const result = await sourceRequest<{ status: string }>(
              '/mail/open',
              target,
              cancel.signal,
            );
            if (result.status !== 'requested')
              throw new Error('열기 요청의 전달 여부를 확인하지 못했습니다.');
            if (!cancel.signal.aborted) setNotice('Apple Mail에 열기 요청을 전달했습니다.');
            onOpened?.();
          } catch (error) {
            if (!cancel.signal.aborted) {
              setFailed(true);
              setNotice(error instanceof Error ? error.message : 'Apple Mail을 열지 못했습니다.');
            }
          } finally {
            lock.current = false;
            if (!cancel.signal.aborted) setPending(false);
          }
        }}
      >
        {icon}
      </button>
      {failed ? (
        <small className="briefing-mail-open-error" role="alert" title={notice}>
          {notice}
        </small>
      ) : (
        <span className="briefing-sr-only" role="status">
          {notice}
        </span>
      )}
    </span>
  ) : (
    <button
      type="button"
      className="briefing-mail-open"
      disabled
      aria-label="원본 메일 연결 정보 없음"
      title="이 요약에는 원본 메일 연결 정보가 없습니다. 자료를 다시 조회하면 연결할 수 있습니다."
    >
      {icon}
    </button>
  );
}
