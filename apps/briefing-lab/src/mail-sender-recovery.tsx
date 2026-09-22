import { useEffect, useRef, useState } from 'react';
import { sourceRequest } from './live-client';
import type { MailOpenTarget } from './mail-open-contract';
import { mailSenderLabel, normalizedMailSender } from './email-presentation';

/** Explicit one-message header recovery for histories saved before sender metadata existed. */
export function MailSenderRecovery({ target }: { target: MailOpenTarget }) {
  const [sender, setSender] = useState(''),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const key = JSON.stringify(target);
  useEffect(() => {
    setSender('');
    setPending(false);
    setError('');
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [key]);
  if (sender) return <b title={`보낸 사람: ${sender}`}>{mailSenderLabel(sender)}</b>;
  return (
    <button
      type="button"
      className="briefing-sender-recover"
      disabled={pending}
      title={
        error ||
        'Apple Mail에서 이 메일의 발신자 헤더만 확인합니다. 재요약·읽음 변경 없이 저장합니다.'
      }
      aria-label={error || '보낸 사람 확인'}
      onClick={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (active.current) return;
        const controller = new AbortController();
        active.current = controller;
        setPending(true);
        setError('');
        try {
          const result = await sourceRequest<{ sender: string }>(
            '/mail/read-sender',
            target,
            controller.signal,
          );
          const name = normalizedMailSender(result.sender);
          if (!name)
            throw new Error('발신자 정보를 확인하지 못했습니다. 원문 메일에서 확인해주세요.');
          if (!controller.signal.aborted) setSender(name);
        } catch (cause) {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : '발신자 확인 실패');
        } finally {
          if (!controller.signal.aborted) {
            active.current = null;
            setPending(false);
          }
        }
      }}
    >
      {pending ? '발신자 확인 중…' : error ? '발신자 재확인' : '보낸 사람 확인'}
    </button>
  );
}
