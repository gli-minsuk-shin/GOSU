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
/**
 * One message delivered to several of the user's accounts: a verified source match, or the same
 * Message-ID (the canonical `message://` link) and subject in different accounts. Many copies never
 * get a source proof (attachments, bodies Mail has not downloaded, a read cut short), which left
 * identical rows side by side. Copies whose verified sources differ are never merged.
 */
export function sameDeliveredMail(a: DuplicateMail, b: DuplicateMail) {
  if (sameVerifiedMail(a, b)) return true;
  const x = a.mailContentProof,
    y = b.mailContentProof;
  return Boolean(
    a.kind === 'email' &&
    b.kind === 'email' &&
    a.mailAccount &&
    b.mailAccount &&
    a.mailAccount.id !== b.mailAccount.id &&
    a.title === b.title &&
    a.mailMessageUrl &&
    a.mailMessageUrl === b.mailMessageUrl &&
    !(x && y && (x.digest !== y.digest || x.previewDigest !== y.previewDigest)),
  );
}
/**
 * One message seen twice inside ONE account: the same mail sitting in the inbox and in an archive,
 * or found again after Mail moved it. `sameDeliveredMail` is about the opposite case -- one message
 * delivered to several accounts, which keeps a copy per account -- and it refuses same-account
 * pairs, so this one had nowhere to be recognised and showed up as two identical rows.
 *
 * Stricter than the cross-account rule on purpose. The Message-ID, the subject AND the received
 * time must all agree: a sender that reuses a Message-ID across two real sends differs in time, and
 * hiding a mail the user has not seen is worse than showing it twice. No Message-ID, no match.
 */
export function sameMessageTwice(a: DuplicateMail, b: DuplicateMail) {
  const when = (mail: DuplicateMail) => mail.receivedAt || mail.publishedAt;
  const x = a.mailContentProof,
    y = b.mailContentProof;
  return Boolean(
    a.kind === 'email' &&
    b.kind === 'email' &&
    a.mailAccount &&
    b.mailAccount &&
    a.mailAccount.id === b.mailAccount.id &&
    a.mailMessageUrl &&
    a.mailMessageUrl === b.mailMessageUrl &&
    a.title === b.title &&
    when(a) &&
    when(a) === when(b) &&
    !(x && y && (x.digest !== y.digest || x.previewDigest !== y.previewDigest)),
  );
}

/**
 * Which surviving row stands in for each read row, so coverage bookkeeping can advance.
 *
 * A row merged as a cross-account copy is already named by `mailCopies`. A row collapsed by
 * `sameMessageTwice` is not, and it must not be: `mailCopies` is what the card counts when it says
 * "같은 메일 · n개 계정 수신", so putting a same-account twin in there would make the screen claim
 * two accounts where there is one. Without a stand-in, `nextMailCoverage` treats that row as
 * unhandled, refuses to mark the mailbox read past it and re-reads from that message on every run.
 */
export function mailRowRepresentatives<T extends DuplicateMail>(
  read: readonly T[],
  kept: readonly T[],
): Map<string, string> {
  const byId = new Map<string, string>();
  for (const row of kept) for (const copy of row.mailCopies ?? []) byId.set(copy.id, row.id);
  const survives = new Set(kept.map((row) => row.id));
  for (const row of read) {
    if (survives.has(row.id) || byId.has(row.id)) continue;
    const survivor = kept.find((candidate) => sameMessageTwice(candidate, row));
    if (survivor) byId.set(row.id, survivor.id);
  }
  return byId;
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
    // The same message twice in one account is one row, not a copy pair: dropped rather than folded
    // into mailCopies, which means one copy per account and still does. Whichever of the two
    // actually has a body is the one kept, so collapsing never costs the reader the content.
    const twin = out.findIndex((other) => sameMessageTwice(other, item));
    if (twin >= 0) {
      if (!out[twin]!.mailContentProof && item.mailContentProof) out[twin] = item;
      continue;
    }
    const index = out.findIndex(
      (other) =>
        sameDeliveredMail(other, item) &&
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
