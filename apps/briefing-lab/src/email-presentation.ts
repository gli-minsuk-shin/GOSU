/** Preserve the existing mail triage buckets; unknown priority is not an invented low score. */
export function emailPriority(level: string | undefined) {
  return ({ high: 0, medium: 1, uncertain: 2, low: 3 } as Record<string, number>)[level ?? ''] ?? 4;
}
export function emailReceivedTime(value: string | undefined) {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? timestamp : -Infinity;
}
export function compareEmails(
  a: { importance?: string | undefined; receivedAt?: string | undefined },
  b: { importance?: string | undefined; receivedAt?: string | undefined },
) {
  const rank = emailPriority(a.importance) - emailPriority(b.importance);
  if (rank) return rank;
  const left = emailReceivedTime(a.receivedAt),
    right = emailReceivedTime(b.receivedAt);
  return left === right ? 0 : left > right ? -1 : 1;
}
export function sortEmails<T>(
  items: readonly T[],
  metadata: (item: T) => { importance?: string | undefined; receivedAt?: string | undefined },
) {
  return [...items].sort((a, b) => compareEmails(metadata(a), metadata(b)));
}

/** Header metadata only; never infer a sender from a summary, subject or receiving account. */
export function normalizedMailSender(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    // Header controls are intentionally removed before display/storage.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return text && text.length <= 1000 ? text : undefined;
}
export function mailSenderLabel(value: string | undefined) {
  const sender = normalizedMailSender(value);
  if (!sender) return '보낸 사람 미기록';
  const named = sender
    .match(/^(.+?)\s*<[^<>]+>$/u)?.[1]
    ?.trim()
    .replace(/^"(.*)"$/u, '$1')
    .trim();
  return named || sender.replace(/^<([^<>]+)>$/u, '$1');
}
