import { receivedTimeLabel, receivingAccountLabel, type MailAccountContext } from './mail-account';

export function EmailDeliveryMeta({
  account,
  receivedAt,
  timeZone = 'Asia/Seoul',
}: {
  account?: MailAccountContext | undefined;
  receivedAt?: string | undefined;
  timeZone?: string | undefined;
}) {
  const time = receivedTimeLabel(receivedAt, timeZone);
  return (
    <span className="briefing-mail-delivery" aria-label="이메일 수신 정보">
      <span
        className="briefing-mail-account"
        title={
          account
            ? `받은 계정: ${account.name}\n등록 주소: ${account.addresses.join(', ') || '미확인'}\n메일 헤더의 To 주소가 아닌 Mail 수신 계정입니다.`
            : undefined
        }
      >
        {account ? (
          <>
            받은 계정 · <b>{receivingAccountLabel(account)}</b>
          </>
        ) : (
          '수신 계정 미기록'
        )}
      </span>
      {time ? (
        <time
          dateTime={receivedAt}
          title={`${receivedTimeLabel(receivedAt, timeZone, true)} · ${timeZone}`}
        >
          {time} 수신
        </time>
      ) : (
        <span>받은 시간 미기록</span>
      )}
    </span>
  );
}
