import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Apple Mail's own message index, read-only. A scripted `whose` date query makes Mail check every
 * message of the mailbox: 2m20s+ with Mail at 93% CPU for the 117,181-message Gmail All Mail on
 * 2026-09-17, while this index returned the same three days (161 messages) in 7ms. The index row id
 * is the message id Mail scripting uses, so bodies, links and read state still come from Mail.
 * The index lives under ~/Library/Mail, which macOS lets GOSU read only with Full Disk Access.
 */
export type MailIndexWindow = {
  /** Exclusive lower bound (received after). */
  after: number;
  /** Inclusive lower bound, for searches. */
  from?: number;
  /** Exclusive upper bound, for searches. */
  before?: number;
  /**
   * Search prefilter: every term must appear in the sender or the subject. The result may hold more
   * than Mail would report (the reader checks each message again) but never less, so a term whose
   * case SQLite cannot fold is not used here.
   */
  terms?: MailIndexTerms;
  limit: number;
};
export type MailIndexTerms = {
  sender: readonly string[];
  subject: readonly string[];
  any: readonly string[];
};
export type MailIndexRead = { messages: { id: string; date: string }[]; total: number };
export type MailIndexReader = (
  accountId: string,
  path: readonly string[],
  window: MailIndexWindow,
  file?: string,
) => MailIndexRead;

export function mailIndexPath(home = homedir()) {
  const root = join(home, 'Library', 'Mail');
  let versions: string[];
  try {
    versions = readdirSync(root).filter((name) => /^V\d+$/.test(name));
  } catch (error) {
    throw indexError(error);
  }
  const latest = versions.sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))[0];
  if (!latest) throw new Error('mail_index_unavailable');
  return join(root, latest, 'MailData', 'Envelope Index');
}

function indexError(error: unknown) {
  const text = `${(error as NodeJS.ErrnoException)?.code ?? ''} ${(error as Error)?.message ?? ''}`;
  if (/EPERM|EACCES|not authorized|unable to open|authorization denied/i.test(text))
    return new Error('mail_index_permission_required');
  if (/ENOENT/.test(text)) return new Error('mail_index_unavailable');
  return new Error('mail_index_unreadable');
}

/** Mail shows Gmail's "[Gmail]/All Mail" as "All Mail"; everything else must match exactly. */
export function matchIndexMailbox(
  mailboxes: readonly { ROWID: number; url: string }[],
  accountId: string,
  path: readonly string[],
) {
  const wanted = path.join('/').normalize('NFC');
  const decoded = mailboxes.flatMap((box) => {
    const match = /^[a-z]+:\/\/([^/]+)\/(.+)$/i.exec(box.url);
    if (!match || match[1] !== accountId) return [];
    try {
      return [{ id: box.ROWID, path: decodeURIComponent(match[2]!).normalize('NFC') }];
    } catch {
      return [];
    }
  });
  const exact = decoded.filter((box) => box.path === wanted);
  const candidates = exact.length
    ? exact
    : decoded.filter(
        (box) =>
          /^\[(?:Gmail|Google Mail)\]\//.test(box.path) &&
          box.path.replace(/^\[[^\]]+\]\//, '') === wanted,
      );
  return candidates.length === 1 ? candidates[0]!.id : null;
}

/**
 * SQLite's LIKE folds case for ASCII letters only. A term is safe to match there when each of its
 * characters is ASCII or has no case at all (Hangul, CJK, digits); "école" is left to the reader.
 */
const foldable = (term: string) =>
  [...term].every((ch) => ch <= '\x7e' || ch.toLowerCase() === ch.toUpperCase());

export const readMailIndex: MailIndexReader = (accountId, path, window, file = mailIndexPath()) => {
  let db: DatabaseSync;
  try {
    // A missing file must not read as a permission problem: SQLite reports both as "unable to open".
    statSync(file);
    db = new DatabaseSync(file, { readOnly: true });
  } catch (error) {
    throw indexError(error);
  }
  try {
    let mailboxes: { ROWID: number; url: string }[];
    try {
      mailboxes = db
        .prepare('select ROWID, url from mailboxes where url like ?')
        .all(`%://${accountId}/%`) as { ROWID: number; url: string }[];
    } catch (error) {
      const wrapped = indexError(error);
      throw wrapped.message === 'mail_index_unreadable'
        ? new Error('mail_index_schema_changed')
        : wrapped;
    }
    const mailbox = matchIndexMailbox(mailboxes, accountId, path);
    if (mailbox === null) throw new Error('mail_index_mailbox_unmatched');
    const conditions = ['mailbox = ?', 'deleted = 0', 'date_received > ?'];
    const values: number[] = [mailbox, window.after / 1000];
    if (window.from !== undefined) {
      conditions.push('date_received >= ?');
      values.push(window.from / 1000);
    }
    if (window.before !== undefined) {
      conditions.push('date_received < ?');
      values.push(window.before / 1000);
    }
    // Mail keeps "Re: " apart from the subject text, and the sender as an address plus a name.
    const SUBJECT = "(coalesce(messages.subject_prefix, '') || coalesce(subjects.subject, ''))";
    const SENDER = "(coalesce(addresses.address, '') || ' ' || coalesce(addresses.comment, ''))";
    const texts: string[] = [];
    const like = (column: string, term: string) => {
      texts.push(`%${term.replace(/[\\%_]/g, '\\$&')}%`);
      return `${column} like ? escape '\\'`;
    };
    const sender = (window.terms?.sender ?? []).filter(foldable),
      subject = (window.terms?.subject ?? []).filter(foldable),
      any = (window.terms?.any ?? []).filter(foldable);
    for (const term of sender) conditions.push(like(SENDER, term));
    for (const term of subject) conditions.push(like(SUBJECT, term));
    for (const term of any) conditions.push(`(${like(SENDER, term)} or ${like(SUBJECT, term)})`);
    const source = texts.length
      ? 'messages left join subjects on subjects.ROWID = messages.subject left join addresses on addresses.ROWID = messages.sender'
      : 'messages';
    const where = conditions
      .map((condition) => condition.replace(/^(mailbox|deleted|date_received)\b/, 'messages.$1'))
      .join(' and ');
    try {
      const total = Number(
        (
          db
            .prepare(`select count(*) as n from ${source} where ${where}`)
            .get(...values, ...texts) as {
            n: number;
          }
        ).n,
      );
      const rows = db
        .prepare(
          `select messages.ROWID as id, messages.date_received as received from ${source} where ${where} order by messages.date_received desc, messages.ROWID desc limit ?`,
        )
        .all(...values, ...texts, window.limit) as { id: number; received: number }[];
      return {
        total,
        messages: rows.map((row) => ({
          id: String(row.id),
          date: new Date(row.received * 1000).toISOString(),
        })),
      };
    } catch (error) {
      const wrapped = indexError(error);
      throw wrapped.message === 'mail_index_unreadable'
        ? new Error('mail_index_schema_changed')
        : wrapped;
    }
  } finally {
    db.close();
  }
};
