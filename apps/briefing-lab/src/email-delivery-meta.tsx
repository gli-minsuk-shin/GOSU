import { receivedTimeLabel, receivingAccountLabel, type MailAccountContext } from './mail-account';
import { mailSenderLabel, normalizedMailSender } from './email-presentation';
import { MailSenderRecovery } from './mail-sender-recovery';
import type { MailOpenTarget } from './mail-open-contract';

export function EmailDeliveryMeta({
  account,
  sender,
  senderTarget,
  receivedAt,
  timeZone = 'Asia/Seoul',
}: {
  account?: MailAccountContext | undefined;
  sender?: string | undefined;
  senderTarget?: MailOpenTarget | undefined;
  receivedAt?: string | undefined;
  timeZone?: string | undefined;
}) {
  const time = receivedTimeLabel(receivedAt, timeZone);
  return (
    <span className="briefing-mail-delivery" aria-label="이메일 수신 정보">
      <span
        className="briefing-mail-sender"
        aria-label={`보낸 사람: ${mailSenderLabel(sender)}`}
        title={
          normalizedMailSender(sender)
            ? `보낸 사람: ${normalizedMailSender(sender)}`
            : '발신자 정보가 수집·저장되지 않았습니다. 원문 메일에서 확인해주세요.'
        }
      >
        {!normalizedMailSender(sender) && senderTarget ? (
          <MailSenderRecovery target={senderTarget} />
        ) : (
          <b>{mailSenderLabel(sender)}</b>
        )}
      </span>
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
            <span aria-hidden="true">→ </span>
            <b>{receivingAccountLabel(account)}</b>
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
