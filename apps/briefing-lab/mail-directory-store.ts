import { z } from 'zod';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { SealedStateStore } from './sealed-state-store';
import { systemBriefingKey } from './briefing-system-key';

export const MAX_MAIL_DIRECTORY_ENTRIES = 64;
const EntrySchema = z
  .object({
    /** Mail's own account id, as its scripting interface reports it. */
    accountId: z.string().min(1).max(500),
    path: z.array(z.string().max(500)).min(1).max(6),
  })
  .strict();
const Schema = z
  .object({
    version: z.literal(1),
    revision: z.number(),
    mailboxes: z.array(EntrySchema).max(MAX_MAIL_DIRECTORY_ENTRIES),
  })
  .strict();
export type MailDirectoryEntry = z.infer<typeof EntrySchema>;
export type MailDirectory = {
  load(): Promise<MailDirectoryEntry[]>;
  save(entries: MailDirectoryEntry[]): Promise<void>;
};

/**
 * Where Mail keeps the mailboxes a routine was approved to read: Mail's account id and the mailbox
 * path. A saved scope holds only fingerprints of these, so without this file every restart had to
 * ask Mail for every mailbox of every account before the first read. Sealed like the other briefing
 * files because a mailbox path can be a private label name; an older GOSU simply ignores the file.
 */
export class MailDirectoryStore implements MailDirectory {
  private state: SealedStateStore<z.infer<typeof Schema>>;
  constructor(
    directory = join(homedir(), 'Library', 'Application Support', 'GOSU', 'briefing-lab'),
    key = systemBriefingKey,
  ) {
    this.state = new SealedStateStore(
      directory,
      {
        file: 'mail-directory.v1.enc.json',
        version: 1,
        aad: 'gosu-briefing-mail-directory-v1',
        empty: () => ({ version: 1, revision: 0, mailboxes: [] }),
        parse: (v) => Schema.parse(v),
        maxBytes: 1_000_000,
      },
      key,
    );
  }
  async load() {
    return (await this.state.read()).mailboxes;
  }
  async save(entries: MailDirectoryEntry[]) {
    const mailboxes = z.array(EntrySchema).parse(entries).slice(-MAX_MAIL_DIRECTORY_ENTRIES);
    await this.state.mutate((state) => {
      state.mailboxes = mailboxes;
    });
  }
}
