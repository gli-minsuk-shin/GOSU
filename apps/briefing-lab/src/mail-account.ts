import { z } from 'zod';

export const MailAccountContextSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().max(200),
    addresses: z.array(z.string().min(1).max(320)).max(10),
  })
  .strict();
export type MailAccountContext = z.infer<typeof MailAccountContextSchema>;
export const MailReceivedAtSchema = z.string().datetime({ offset: true });
export function receivingAccountLabel(account: MailAccountContext | undefined) {
  if (!account) return '수신 계정 미기록';
  const parts = [...new Set([account.name, account.addresses[0]].filter(Boolean))];
  return (
    (parts.join(' · ') || '계정 이름 미확인') +
    (account.addresses.length > 1 ? ` 외 ${account.addresses.length - 1}개 주소` : '')
  );
}
export function emailDeliveryForPrompt(source: {
  mailAccount?: MailAccountContext | undefined;
  publishedAt?: string | undefined;
  receivedAt?: string | undefined;
}) {
  const time = source.receivedAt ?? source.publishedAt;
  return {
    receivedAt: MailReceivedAtSchema.safeParse(time).success ? time : null,
    receivingAccount: source.mailAccount
      ? { name: source.mailAccount.name, addresses: source.mailAccount.addresses }
      : null,
  };
}
export function receivedTimeLabel(
  value: string | undefined,
  timeZone = 'Asia/Seoul',
  full = false,
) {
  if (!MailReceivedAtSchema.safeParse(value).success) return null;
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone,
      ...(full ? { year: 'numeric' as const } : {}),
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value!));
  } catch {
    return null;
  }
}
