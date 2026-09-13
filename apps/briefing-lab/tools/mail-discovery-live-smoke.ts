// Explicit metadata-only smoke. Never calls read/authorize and never logs account/mailbox names.
import { AppleMailConnection, runAppleMail } from '../live-mail';
const actions: string[] = [];
const mail = new AppleMailConnection(async (input, signal) => {
  actions.push(input.action);
  return runAppleMail(input, signal);
});
const result = await mail.discover(new AbortController().signal);
if (actions.join(',') !== 'discover') throw new Error('mail_metadata_smoke_unexpected_action');
console.log(
  JSON.stringify({
    passed: true,
    actions,
    accounts: result.accounts.length,
    mailboxes: result.accounts.reduce((n, a) => n + a.mailboxes.length, 0),
    unavailableAccounts: result.accounts.filter((a) => a.unavailable).length,
    limited: result.limited || result.accounts.some((a) => a.limited),
    messageBodiesRead: 0,
    grantsCreated: 0,
  }),
);
mail.close();
