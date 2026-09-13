/** Only the fixed reader's status field/legacy metadata slot is evidence, never mail prose. */
export function observedMailUnread(item: {
  kind?: string;
  mailUnread?: boolean | undefined;
  details?: readonly string[];
}): boolean | undefined {
  if (item.kind !== 'email') return undefined;
  if (typeof item.mailUnread === 'boolean') return item.mailUnread;
  if (item.details?.[1] === '읽지 않음') return true;
  if (item.details?.[1] === '읽음') return false;
  return undefined;
}
