import { z } from 'zod';
import { MailAccountContextSchema } from './mail-account';
export const MailContentProofSchema = z.object({
  version: z.literal(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  length: z.number().int().min(1).max(262144),
});
export const MailCopySchema = z.object({
  id: z.string().max(160),
  title: z.string().max(1000),
  receivedAt: z.string().datetime(),
  account: MailAccountContextSchema,
});
export type MailCopy = z.infer<typeof MailCopySchema>;
export type DuplicateMail = {
  id: string;
  title: string;
  kind?: string | undefined;
  mailAccount?: z.infer<typeof MailAccountContextSchema> | undefined;
  publishedAt?: string | undefined;
  receivedAt?: string | undefined;
  mailContentProof?: z.infer<typeof MailContentProofSchema> | undefined;
  mailCopies?: MailCopy[] | undefined;
  mailMessageUrl?: string | undefined;
  mailDuplicateCheckedAt?: string | undefined;
};
export function pendingMailRechecks<T extends DuplicateMail>(
  items: readonly T[],
  accountIds: readonly string[],
) {
  const latest = new Map<string, T>();
  for (const item of items) {
    const old = latest.get(item.id);
    if (!old || item.mailContentProof || item.mailDuplicateCheckedAt) latest.set(item.id, item);
  }
  const covered = new Set(
    items.filter((i) => i.mailContentProof).flatMap((i) => (i.mailCopies ?? []).map((c) => c.id)),
  );
  const groups = new Map<string, T[]>();
  for (const item of latest.values())
    if (item.mailMessageUrl && item.mailAccount && accountIds.includes(item.mailAccount.id)) {
      const group = groups.get(item.mailMessageUrl) ?? [];
      group.push(item);
      groups.set(item.mailMessageUrl, group);
    }
  return [...groups.values()]
    .filter(
      (group) =>
        new Set(group.map((i) => i.mailAccount!.id)).size > 1 &&
        group.some((i) => !i.mailContentProof && !i.mailDuplicateCheckedAt && !covered.has(i.id)),
    )
    .flat();
}
export function sameVerifiedMail(a: DuplicateMail, b: DuplicateMail) {
  const x = a.mailContentProof,
    y = b.mailContentProof;
  return Boolean(
    a.kind === 'email' &&
    b.kind === 'email' &&
    a.mailAccount &&
    b.mailAccount &&
    a.mailAccount.id !== b.mailAccount.id &&
    a.title === b.title &&
    x &&
    y &&
    x.version === 1 &&
    y.version === 1 &&
    x.digest === y.digest &&
    x.previewDigest === y.previewDigest &&
    x.length === y.length,
  );
}
export function deduplicateVerifiedMail<T extends DuplicateMail>(items: readonly T[]): T[] {
  const out: T[] = [];
  const identity = (copy: MailCopy) =>
    JSON.stringify([copy.id, copy.title, copy.receivedAt, copy.account.id]);
  const covered = new Map<string, T>();
  for (const item of items)
    if (item.mailContentProof && (item.mailCopies?.length ?? 0) > 1)
      for (const copy of item.mailCopies!)
        if (!covered.has(identity(copy))) covered.set(identity(copy), item);
  const copies = (item: T): MailCopy[] =>
    item.mailCopies ??
    (item.mailAccount && (item.receivedAt || item.publishedAt)
      ? [
          {
            id: item.id,
            title: item.title,
            receivedAt: (item.receivedAt || item.publishedAt)!,
            account: item.mailAccount,
          },
        ]
      : []);
  for (const item of items) {
    const own =
      item.mailAccount && (item.receivedAt || item.publishedAt)
        ? identity({
            id: item.id,
            title: item.title,
            receivedAt: (item.receivedAt || item.publishedAt)!,
            account: item.mailAccount,
          })
        : '';
    const representative = covered.get(own);
    if (representative && representative !== item && representative.id !== item.id) continue;
    const index = out.findIndex(
      (other) =>
        sameVerifiedMail(other, item) &&
        copies(other).length + copies(item).length <= 5 &&
        !copies(other).some((a) => copies(item).some((b) => a.account.id === b.account.id)),
    );
    if (index < 0) out.push(item);
    else {
      const previous = out[index]!;
      out[index] = { ...previous, mailCopies: [...copies(previous), ...copies(item)].slice(0, 5) };
    }
  }
  return out;
}

// Self-contained for the fixed native reader. Preserve authored headers and every body character;
// only known delivery/signature headers vary between account deliveries. Attachments are excluded
// by the caller: unverifiable or oversized originals are never eligible for deduplication.
export function canonicalMailSource(raw: string, messageId: string): string | null {
  if (!raw || raw.length > 262144 || !messageId) return null;
  const match = /\r?\n\r?\n/.exec(raw);
  if (!match || match.index < 1) return null;
  const body = raw.slice(match.index + match[0].length);
  if (!body.trim()) return null;
  const fields = raw
    .slice(0, match.index)
    .replace(/\r?\n[ \t]+/g, ' ')
    .split(/\r?\n/);
  const headers: string[] = [];
  let seenId = false,
    from = false,
    date = false;
  for (const field of fields) {
    const colon = field.indexOf(':');
    if (colon < 1) return null;
    const name = field.slice(0, colon).toLowerCase(),
      value = field.slice(colon + 1).trim();
    if (name === 'message-id') {
      if (value.replace(/^<|>$/g, '') !== messageId.replace(/^<|>$/g, '')) return null;
      seenId = true;
    }
    if (name === 'from') from = Boolean(value);
    if (name === 'date') date = Boolean(value);
    // Multipart/attachments require a separate completeness verifier; keep them separate for now.
    if (name === 'content-type' && /multipart\//i.test(value)) return null;
    if (
      /^(received|return-path|delivered-to|x-original-to|authentication-results|received-spf|dkim-signature|arc-seal|arc-message-signature|arc-authentication-results)$/.test(
        name,
      )
    )
      continue;
    headers.push(name + ':' + value);
  }
  return seenId && from && date ? JSON.stringify([headers.sort(), body]) : null;
}
