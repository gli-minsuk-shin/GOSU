import { useState, type MouseEvent } from 'react';
import { mailMarkedThisSession, markAllMailRead, type MailBatchTarget } from './mail-read-status';

/**
 * "모두 읽음" for the unread mail of one saved briefing. It sits inside the email section's
 * <summary>, so its click must not fold the section. Nothing is shown without unread mail.
 */
export function MarkAllMailRead({
  routineId,
  mails,
}: {
  routineId: string;
  /** The still-unread mails of this briefing, by their saved ids and Mail links. */
  mails: readonly MailBatchTarget[];
}) {
  const [pending, setPending] = useState(false),
    [outcome, setOutcome] = useState<{ marked: number; failures: string[] } | null>(null),
    [error, setError] = useState('');
  const left = mails.filter((mail) => !mailMarkedThisSession(routineId, mail));
  // An error only matters while there is mail left to retry; a finished result stays as feedback.
  if (!left.length && !outcome) return null;
  const run = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;
    setPending(true);
    setError('');
    setOutcome(null);
    try {
      const result = await markAllMailRead(routineId, left);
      setOutcome({ marked: result.marked, failures: result.failures.map((f) => f.error) });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '읽음 처리 요청에 실패했습니다.');
    } finally {
      setPending(false);
    }
  };
  return (
    <span className="briefing-mark-all">
      {left.length > 0 && (
        <button
          type="button"
          className="briefing-button briefing-mark-all-read"
          disabled={pending}
          title={`이 브리핑의 안 읽은 메일 ${left.length}통을 Apple Mail에서 읽음으로 표시합니다. 메일을 열거나 보내거나 삭제하지 않습니다.`}
          onClick={(event) => void run(event)}
        >
          {`모두 읽음 (${left.length})`}
        </button>
      )}
      {pending && <span role="status">{`읽음 처리 중… ${left.length}통`}</span>}
      {outcome && (
        <span role="status">
          {`${outcome.marked}통 읽음 처리`}
          {outcome.failures.length > 0 &&
            ` · ${outcome.failures.length}통 실패: ${[...new Set(outcome.failures)].join(' / ')}`}
        </span>
      )}
      {error && left.length > 0 && <span role="alert">{error}</span>}
    </span>
  );
}
