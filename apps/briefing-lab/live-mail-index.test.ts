import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { matchIndexMailbox, readMailIndex } from './live-mail-index';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const ACCOUNT = '786D119C-1A89-4B37-89D3-ADADEDF98025';
const hour = 3_600_000;
const now = Date.parse('2026-09-17T12:00:00Z');

/** A minimal copy of the Envelope Index tables GOSU reads; everything else in it is ignored. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gosu-mail-index-'));
  dirs.push(dir);
  const file = join(dir, 'Envelope Index');
  const db = new DatabaseSync(file);
  db.exec(`create table mailboxes (ROWID integer primary key, url text);
    create table messages (ROWID integer primary key, mailbox integer, deleted integer, date_received integer, subject integer);`);
  const box = db.prepare('insert into mailboxes (ROWID, url) values (?, ?)');
  box.run(15, `imap://${ACCOUNT}/%5BGmail%5D/All%20Mail`);
  box.run(16, `imap://${ACCOUNT}/INBOX`);
  box.run(17, 'imap://OTHER-ACCOUNT/%5BGmail%5D/All%20Mail');
  const message = db.prepare(
    'insert into messages (ROWID, mailbox, deleted, date_received) values (?, ?, ?, ?)',
  );
  message.run(100, 15, 0, (now - 5 * hour) / 1000);
  message.run(101, 15, 0, (now - 1 * hour) / 1000);
  message.run(102, 15, 1, (now - 2 * hour) / 1000);
  message.run(103, 16, 0, (now - 1 * hour) / 1000);
  message.run(104, 17, 0, (now - 1 * hour) / 1000);
  message.run(105, 15, 0, (now - 80 * hour) / 1000);
  db.close();
  return file;
}

describe("Apple Mail's index", () => {
  it('lists the mailbox window newest first with Mail ids, excluding deleted and other mailboxes', () => {
    const file = fixture();
    const read = readMailIndex(
      ACCOUNT,
      ['All Mail'],
      { after: now - 72 * hour, limit: 2000 },
      file,
    );
    expect(read).toEqual({
      total: 2,
      messages: [
        { id: '101', date: new Date(now - hour).toISOString() },
        { id: '100', date: new Date(now - 5 * hour).toISOString() },
      ],
    });
    const capped = readMailIndex(ACCOUNT, ['All Mail'], { after: now - 72 * hour, limit: 1 }, file);
    expect(capped).toMatchObject({ total: 2, messages: [{ id: '101' }] });
    const search = readMailIndex(
      ACCOUNT,
      ['All Mail'],
      { after: now - 72 * hour, from: now - 6 * hour, before: now - 2 * hour, limit: 2000 },
      file,
    );
    expect(search.messages.map((m) => m.id)).toEqual(['100']);
  });

  it('matches Gmail folders shown without their [Gmail] prefix and Korean names in any normalization', () => {
    const boxes = [
      { ROWID: 1, url: `imap://${ACCOUNT}/%5BGmail%5D/All%20Mail` },
      { ROWID: 2, url: `imap://${ACCOUNT}/INBOX` },
      {
        ROWID: 3,
        url: `imap://${ACCOUNT}/${encodeURIComponent('[Gmail]/전체보관함'.normalize('NFD'))}`,
      },
      { ROWID: 4, url: `imap://${ACCOUNT}/Work/Projects` },
      { ROWID: 5, url: `imap://${ACCOUNT}/%5BGmail%5D/Work` },
      { ROWID: 6, url: `imap://${ACCOUNT}/%5BGoogle%20Mail%5D/Work` },
    ];
    expect(matchIndexMailbox(boxes, ACCOUNT, ['All Mail'])).toBe(1);
    expect(matchIndexMailbox(boxes, ACCOUNT, ['INBOX'])).toBe(2);
    expect(matchIndexMailbox(boxes, ACCOUNT, ['전체보관함'])).toBe(3);
    expect(matchIndexMailbox(boxes, ACCOUNT, ['Work', 'Projects'])).toBe(4);
    // Two folders could be "Work": an ambiguous match is refused, never guessed.
    expect(matchIndexMailbox(boxes, ACCOUNT, ['Work'])).toBeNull();
    expect(matchIndexMailbox(boxes, 'OTHER', ['All Mail'])).toBeNull();
  });

  it('names a missing index, an unmatched mailbox and a changed schema distinctly', () => {
    const file = fixture();
    expect(() =>
      readMailIndex(
        ACCOUNT,
        ['All Mail'],
        { after: 0, limit: 10 },
        join(tmpdir(), 'no-such-index'),
      ),
    ).toThrow('mail_index_unavailable');
    expect(() => readMailIndex(ACCOUNT, ['Nope'], { after: 0, limit: 10 }, file)).toThrow(
      'mail_index_mailbox_unmatched',
    );
    const db = new DatabaseSync(file);
    db.exec('alter table messages rename column date_received to received_at');
    db.close();
    expect(() => readMailIndex(ACCOUNT, ['All Mail'], { after: 0, limit: 10 }, file)).toThrow(
      'mail_index_schema_changed',
    );
  });
  // 2026-09-22: a search wider than the briefing window must not make Mail scan the whole mailbox,
  // so the index narrows the candidates by sender and subject first. It may return too much (the
  // reader checks every message again) but never too little.
  it('narrows a search by sender and subject terms in the index, as a superset of the true matches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gosu-mail-index-'));
    dirs.push(dir);
    const file = join(dir, 'Envelope Index');
    const db = new DatabaseSync(file);
    db.exec(`create table mailboxes (ROWID integer primary key, url text);
      create table subjects (ROWID integer primary key, subject text);
      create table addresses (ROWID integer primary key, address text, comment text);
      create table messages (ROWID integer primary key, mailbox integer, deleted integer,
        date_received integer, sender integer, subject_prefix text, subject integer);`);
    db.prepare('insert into mailboxes (ROWID, url) values (?, ?)').run(
      15,
      `imap://${ACCOUNT}/%5BGmail%5D/All%20Mail`,
    );
    const subject = db.prepare('insert into subjects (ROWID, subject) values (?, ?)');
    subject.run(1, 'New articles in your profile');
    subject.run(2, '과제 계획서 제출 안내');
    subject.run(3, '100% coverage report');
    subject.run(4, 'Résumé ÉCOLE');
    const address = db.prepare('insert into addresses (ROWID, address, comment) values (?, ?, ?)');
    address.run(1, 'scholaralerts-noreply@google.com', 'Google Scholar Alerts');
    address.run(2, 'office@example.test', '연구지원팀');
    const message = db.prepare(
      'insert into messages (ROWID, mailbox, deleted, date_received, sender, subject_prefix, subject) values (?, ?, 0, ?, ?, ?, ?)',
    );
    const day = 86_400_000;
    message.run(200, 15, (now - 400 * day) / 1000, 1, '', 1);
    message.run(201, 15, (now - 300 * day) / 1000, 2, 'Re: ', 2);
    message.run(202, 15, (now - 200 * day) / 1000, 2, '', 3);
    message.run(203, 15, (now - 100 * day) / 1000, 2, '', 4);
    db.close();
    const ids = (terms: { sender?: string[]; subject?: string[]; any?: string[] }) =>
      readMailIndex(
        ACCOUNT,
        ['All Mail'],
        {
          after: 0,
          limit: 2000,
          terms: { sender: [], subject: [], any: [], ...terms },
        },
        file,
      ).messages.map((m) => m.id);
    // Any-term: sender address, sender name or subject; ASCII case does not matter.
    expect(ids({ any: ['SCHOLAR'] })).toEqual(['200']);
    expect(ids({ any: ['연구지원팀'] })).toEqual(['203', '202', '201']);
    expect(ids({ subject: ['계획서'] })).toEqual(['201']);
    // Mail reports "Re: 과제…": the prefix lives in its own column.
    expect(ids({ subject: ['re: 과제'] })).toEqual(['201']);
    expect(ids({ sender: ['office@'], subject: ['report'] })).toEqual(['202']);
    // LIKE wildcards in a term are literal text.
    expect(ids({ subject: ['100%'] })).toEqual(['202']);
    expect(ids({ subject: ['1_0'] })).toEqual([]);
    // SQLite folds case for ASCII only. A term whose case it cannot fold is left to the reader
    // rather than risk losing a match: everything in the window comes back.
    expect(ids({ subject: ['école'] })).toEqual(['203', '202', '201', '200']);
    // All terms must hold.
    expect(ids({ any: ['scholar', 'articles'] })).toEqual(['200']);
    expect(ids({ any: ['scholar', '계획서'] })).toEqual([]);
  });

  it('reports a changed schema when the tables a term search needs are missing', () => {
    const file = fixture();
    expect(() =>
      readMailIndex(
        ACCOUNT,
        ['All Mail'],
        { after: 0, limit: 10, terms: { sender: [], subject: [], any: ['x'] } },
        file,
      ),
    ).toThrow('mail_index_schema_changed');
    // Without terms the plain window query still works on the same file.
    expect(readMailIndex(ACCOUNT, ['All Mail'], { after: 0, limit: 10 }, file).total).toBe(3);
  });
});
