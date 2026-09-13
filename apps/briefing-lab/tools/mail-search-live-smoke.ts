// Explicit, user-authorized diagnostic only. Requires a receiving address, exact date range and
// literal sender/topic. Reads matching metadata only, never bodies, grants, settings or read flags.
import { z } from 'zod';
import { runAppleMail } from '../live-mail';
import { resolveMailSearch } from '../briefing-mail-search';
const [address, from, to, query] = z
  .tuple([z.email(), z.iso.date(), z.iso.date(), z.string().min(2).max(100)])
  .parse(process.argv.slice(2));
const c = new AbortController();
const began = Date.now();
const discovery = z
  .object({
    accounts: z.array(
      z.object({
        id: z.string(),
        addresses: z.array(z.string()).optional(),
        mailboxes: z.array(z.object({ name: z.string(), path: z.array(z.string()) })),
      }),
    ),
  })
  .parse(await runAppleMail({ action: 'discover' }, c.signal));
const accounts = discovery.accounts.filter((a) =>
  a.addresses?.some((v) => v.toLowerCase() === address.toLowerCase()),
);
if (accounts.length !== 1) throw new Error('diagnostic_account_ambiguous');
const account = accounts[0]!;
const boxes = account.mailboxes.filter((b) =>
  /^(All Mail|전체보관함|전체 보관함)$/i.test(b.path.at(-1)!),
);
if (boxes.length !== 1) throw new Error('diagnostic_all_mail_ambiguous');
const scope = {
  accountId: 'diagnostic',
  mailboxId: 'diagnostic',
  days: 10,
  limit: 10,
  sender: '',
  subject: '',
  unreadOnly: false,
  bodyPreview: false,
};
const search = resolveMailSearch({ query, from, to }, scope, 'Asia/Seoul')!;
const result = z
  .object({
    messages: z.array(z.object({ date: z.string(), preview: z.string() })),
    scanned: z.number(),
    capped: z.boolean(),
    partial: z.boolean().optional(),
  })
  .parse(
    await runAppleMail(
      {
        action: 'read',
        accountId: account.id,
        path: boxes[0]!.path,
        since: new Date(Date.now() - scope.days * 86400000).toISOString(),
        scope,
        search,
      },
      c.signal,
    ),
  );
if (result.messages.some((m) => m.preview)) throw new Error('diagnostic_body_read');
console.log(
  JSON.stringify({
    elapsedMs: Date.now() - began,
    matchingMessages: result.messages.length,
    scannedMatches: result.scanned,
    capped: result.capped,
    partial: result.partial ?? false,
    localDates: [
      ...new Set(
        result.messages.map((m) =>
          new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(m.date)),
        ),
      ),
    ],
    bodiesRead: 0,
    grantsCreated: 0,
    mutations: 0,
  }),
);
