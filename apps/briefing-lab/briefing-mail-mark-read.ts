import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { normalizedMailSender } from './src/email-presentation';
import { homedir } from 'node:os';
import { safeAppleMailUrl } from './src/apple-mail-url';
import { MailNativeIdSchema } from './src/mail-open-contract';
import { nativeMailHash } from './briefing-mail-ingestion';

const MailboxSchema = z
  .object({
    accountId: z.string().min(1).max(500),
    path: z.array(z.string().min(1).max(500)).min(1).max(6),
  })
  .strict();
const RequestSchema = MailboxSchema.extend({
  action: z.enum(['locate', 'mark-read', 'read-status', 'read-sender']),
  messageId: z.string().min(1).max(998),
  nativeId: MailNativeIdSchema.optional(),
  itemId: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
}).strict();
export const APPLE_MAIL_MARK_READ = String.raw`
function run(argv) {
  var q=JSON.parse(argv[0]), mail=Application('Mail');
  if(q.action!=='locate'&&q.action!=='mark-read'&&q.action!=='read-status'&&q.action!=='read-sender')throw Error('mail_mark_invalid');
  var accounts=mail.accounts().filter(function(a){return a.id()===q.accountId;});
  if(accounts.length!==1)throw Error('mail_mark_target_missing');
  var boxes=accounts[0].mailboxes(), box;
  q.path.forEach(function(name){var found=boxes.filter(function(b){return b.name()===name;});if(found.length!==1)throw Error('mail_mark_target_missing');box=found[0];boxes=box.mailboxes();});
  if(!box)throw Error('mail_mark_target_missing');
  function normalized(value){var s=String(value||'');return s.charAt(0)==='<'&&s.slice(-1)==='>'?s.slice(1,-1):s;}
  if(q.action==='locate'){
    if(!/^[a-f0-9]{64}$/.test(q.itemId||''))throw Error('mail_mark_invalid');
    var hash=${nativeMailHash.toString()}, began=Date.now();
    for(var n=0;n<250;n++){
      if(Date.now()-began>10000)throw Error('mail_mark_locate_timeout');
      var candidate=box.messages[n]();if(!candidate||!candidate.exists())break;
      var id=String(candidate.id());
      if(hash(JSON.stringify([q.accountId,q.path,id]))===q.itemId){
        if(normalized(candidate.messageId())!==q.messageId)throw Error('mail_mark_target_missing');
        return JSON.stringify({ids:[id]});
      }
    }
    throw Error('mail_mark_target_missing');
  }
  if(!/^\d+$/.test(q.nativeId||''))throw Error('mail_mark_invalid');
  function resolve(){var m=box.messages.byId(Number(q.nativeId));if(!m.exists()||String(m.id())!==q.nativeId||normalized(m.messageId())!==q.messageId)throw Error('mail_mark_target_missing');return m;}
  var m=resolve();
  if(q.action==='read-sender')return JSON.stringify({sender:String(m.sender()||''),id:q.nativeId});
  var initial=m.readStatus();
  if(q.action==='read-status'){
    if(typeof initial!=='boolean')throw Error('mail_mark_unconfirmed');
    return JSON.stringify({status:initial?'read':'unread',id:q.nativeId});
  }
  if(initial===true)return JSON.stringify({status:'read',id:q.nativeId});
  m.readStatus=true;
  // Re-resolve after the setter: native object references may retain a stale property result.
  // Poll only the flag; never repeat the write.
  try{
    for(var attempt=0;attempt<6;attempt++){
      if(resolve().readStatus()===true)return JSON.stringify({status:'read',id:q.nativeId});
      if(attempt<5){ObjC.import('Foundation');$.NSThread.sleepForTimeInterval(0.2);}
    }
  }catch(e){throw Error('mail_mark_unconfirmed');}
  throw Error('mail_mark_unconfirmed');
}`;

export async function runMailMarkRead(
  input: z.infer<typeof RequestSchema>,
  signal: AbortSignal,
  run = spawn,
  platform = process.platform,
): Promise<unknown> {
  const request = RequestSchema.parse(input);
  if (platform !== 'darwin') throw new Error('mail_macos_required');
  if (signal.aborted) throw new Error('source_cancelled');
  return new Promise((resolve, reject) => {
    const uncertain = () =>
      new Error(request.action === 'locate' ? 'mail_mark_locate_failed' : 'mail_mark_unconfirmed');
    const child = run(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', APPLE_MAIL_MARK_READ, JSON.stringify(request)],
      {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin', HOME: homedir() },
      },
    );
    let output = '',
      errorText = '',
      done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (error) {
        child.kill('SIGTERM');
        reject(error);
      } else {
        try {
          resolve(JSON.parse(output));
        } catch {
          reject(uncertain());
        }
      }
    };
    const cancel = () => finish(new Error('source_cancelled'));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            request.action === 'locate' ? 'mail_mark_locate_timeout' : 'mail_mark_unconfirmed',
          ),
        ),
      request.action === 'locate' ? 30000 : 15000,
    );
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (done) return;
      output += chunk;
      if (output.length > 10000) finish(uncertain());
    });
    child.stderr?.on('data', (chunk: string) => {
      if (!done) errorText = (errorText + chunk).slice(-1000);
    });
    child.once('error', () => finish(uncertain()));
    child.once('close', (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(
              /-1743|not authorized|not permitted/i.test(errorText)
                ? 'mail_permission_denied'
                : /mail_mark_locate_timeout/.test(errorText)
                  ? 'mail_mark_locate_timeout'
                  : /mail_mark_target_missing/.test(errorText)
                    ? 'mail_mark_target_missing'
                    : uncertain().message,
            ),
      ),
    );
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

async function resolveTarget(
  mailbox: z.infer<typeof MailboxSchema>,
  itemId: string,
  url: string,
  signal: AbortSignal,
  beforeWrite: () => Promise<void>,
  run = runMailMarkRead,
  nativeIdHint?: string,
) {
  const scope = MailboxSchema.parse(mailbox),
    canonical = safeAppleMailUrl(url);
  if (!canonical) throw new Error('mail_mark_target_missing');
  const messageId = decodeURIComponent(canonical.slice('message://'.length)).slice(1, -1);
  await beforeWrite();
  const matches = (id: string) =>
    createHash('sha256')
      .update(JSON.stringify([scope.accountId, scope.path, id]))
      .digest('hex') === itemId;
  if (nativeIdHint !== undefined) {
    if (!MailNativeIdSchema.safeParse(nativeIdHint).success || !matches(nativeIdHint))
      throw new Error('mail_mark_target_missing');
    return { scope, messageId, nativeId: nativeIdHint };
  }
  const located = z
    .object({ ids: z.array(z.string().regex(/^\d+$/)).max(20) })
    .strict()
    .safeParse(await run({ ...scope, action: 'locate', messageId, itemId }, signal));
  if (!located.success) throw new Error('mail_mark_locate_failed');
  const ids = [...new Set(located.data.ids)].filter(matches);
  if (ids.length !== 1) throw new Error('mail_mark_target_missing');
  return { scope, messageId, nativeId: ids[0]! };
}
const stateSchema = (id: string) =>
  z.object({ status: z.enum(['read', 'unread']), id: z.literal(id) }).strict();

/** Recover only a verified message's From header. Never reads its body or changes read status. */
export async function readOriginalMailSender(
  mailbox: z.infer<typeof MailboxSchema>,
  itemId: string,
  url: string,
  signal: AbortSignal,
  beforeRead: () => Promise<void>,
  run = runMailMarkRead,
  nativeIdHint?: string,
) {
  const { scope, messageId, nativeId } = await resolveTarget(
    mailbox,
    itemId,
    url,
    signal,
    beforeRead,
    run,
    nativeIdHint,
  );
  await beforeRead();
  if (signal.aborted) throw new Error('source_cancelled');
  const result = z
    .object({ id: z.literal(nativeId), sender: z.string().max(1000) })
    .strict()
    .parse(await run({ ...scope, action: 'read-sender', messageId, nativeId }, signal));
  const sender = normalizedMailSender(result.sender);
  if (!sender) throw new Error('mail_sender_unavailable');
  await beforeRead();
  if (signal.aborted) throw new Error('source_cancelled');
  return sender;
}

/** Only explicit user mark requests reach the one setter; reconciliation never repeats it. */
export async function markOriginalMailRead(
  mailbox: z.infer<typeof MailboxSchema>,
  itemId: string,
  url: string,
  signal: AbortSignal,
  beforeWrite: () => Promise<void>,
  run = runMailMarkRead,
  nativeIdHint?: string,
) {
  const { scope, messageId, nativeId } = await resolveTarget(
    mailbox,
    itemId,
    url,
    signal,
    beforeWrite,
    run,
    nativeIdHint,
  );
  await beforeWrite();
  if (signal.aborted) throw new Error('source_cancelled');
  try {
    const result = stateSchema(nativeId).safeParse(
      await run({ ...scope, action: 'mark-read', messageId, nativeId }, signal),
    );
    if (!result.success || result.data.status !== 'read') throw new Error('mail_mark_unconfirmed');
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'mail_mark_unconfirmed') throw error;
    await beforeWrite();
    if (signal.aborted) throw new Error('source_cancelled', { cause: error });
    let checked: unknown;
    try {
      checked = await run({ ...scope, action: 'read-status', messageId, nativeId }, signal);
    } catch (checkError) {
      if (signal.aborted) throw new Error('source_cancelled', { cause: checkError });
      throw new Error('mail_mark_unconfirmed', { cause: checkError });
    }
    const status = stateSchema(nativeId).safeParse(checked);
    if (!status.success) throw new Error('mail_mark_unconfirmed', { cause: error });
    if (status.data.status === 'unread') throw new Error('mail_mark_not_applied', { cause: error });
  }
  if (signal.aborted) throw new Error('source_cancelled');
  await beforeWrite();
  return { status: 'read' as const, markedAt: new Date().toISOString() };
}

/** Read-only recovery for an uncertain previous mark; never opens a message or sets a flag. */
export async function readOriginalMailStatus(
  mailbox: z.infer<typeof MailboxSchema>,
  itemId: string,
  url: string,
  signal: AbortSignal,
  beforeRead: () => Promise<void>,
  run = runMailMarkRead,
  nativeIdHint?: string,
) {
  const { scope, messageId, nativeId } = await resolveTarget(
    mailbox,
    itemId,
    url,
    signal,
    beforeRead,
    run,
    nativeIdHint,
  );
  await beforeRead();
  if (signal.aborted) throw new Error('source_cancelled');
  const result = stateSchema(nativeId).safeParse(
    await run({ ...scope, action: 'read-status', messageId, nativeId }, signal),
  );
  if (!result.success) throw new Error('mail_mark_unconfirmed');
  if (signal.aborted) throw new Error('source_cancelled');
  await beforeRead();
  return result.data.status === 'read'
    ? { status: 'read' as const, markedAt: new Date().toISOString() }
    : { status: 'unread' as const };
}
