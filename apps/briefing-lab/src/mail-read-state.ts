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

/**
 * Whether a saved mail is still unread: unread when the briefing read it from Mail, and not marked
 * read from GOSU since. `undefined` when its state was never recorded (older saved briefings).
 * Saved state only: Mail is not asked again.
 */
export function mailStillUnread(item: {
  mailUnread?: boolean | undefined;
  mailMarkedReadAt?: string | undefined;
  details?: readonly string[];
}): boolean | undefined {
  if (item.mailMarkedReadAt) return false;
  return observedMailUnread({ ...item, kind: 'email' });
}
