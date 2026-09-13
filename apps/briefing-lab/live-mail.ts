import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  canonicalMailSource,
  deduplicateVerifiedMail,
  MailContentProofSchema,
} from './src/mail-duplicates';
import { z } from 'zod';
import {
  MailScopeSchema,
  mailTargets,
  MAX_MAIL_LIMIT,
  type MailScope,
  type MailTarget,
} from '@gosu/briefing-core';
import { appleMailMessageUrl } from './src/apple-mail-url';
import { MailAccountContextSchema } from './src/mail-account';
import { MailNativeIdSchema } from './src/mail-open-contract';
import {
  nativeMailSearchPredicate,
  matchesMailSearch,
  type MailSearch,
} from './briefing-mail-search';
import {
  nativeMailHash,
  mailSummaryKey,
  mailReadNotice,
  planMailRead,
  type MailReadPlan,
} from './briefing-mail-ingestion';
import type {
  LiveItem,
  MailAccount,
  Mailbox,
  MailDiscovery,
  MailConnectionStatus,
} from './src/live-types';

export const APPLE_MAIL_READ_TIMEOUT_MS = 60_000;
export const APPLE_MAIL_READ_MAX_BYTES = 8_000_000;
const MailMessageSchema = z.object({
  id: z.string(),
  title: z.string().max(1000),
  sender: z.string().max(500),
  date: z.string().datetime(),
  unread: z.boolean(),
  preview: z.string().max(4000),
  bodyUnavailable: z.boolean(),
  messageId: z.string().max(998).optional(),
  contentProof: MailContentProofSchema.optional(),
  verificationAttempted: z.boolean().optional(),
});
const ReadAccountSchema = MailAccountContextSchema.extend({ id: z.string().min(1).max(500) });
const MailReadResultSchema = z.object({
  account: ReadAccountSchema.optional(),
  messages: z.array(MailMessageSchema).max(MAX_MAIL_LIMIT),
  scanned: z.number().int().min(0).max(250),
  capped: z.boolean(),
  partial: z.boolean().optional(),
  skipped: z.number().int().min(0).max(250).optional(),
});

// Fixed read-only JXA program. Every user value is argv JSON, never executable script text.
export const APPLE_MAIL_READER = String.raw`
function run(argv) {
  var q=JSON.parse(argv[0]), excluded=Object.create(null);
  var hashMail=${nativeMailHash.toString()};
  if(q.hasExclusions){ObjC.import('Foundation');var payload=ObjC.unwrap($.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile,$.NSUTF8StringEncoding));JSON.parse(payload).forEach(function(key){excluded[key]=true;});}
  var mail=Application('Mail');
  function bounded(s,n){return String(s||'').slice(0,n);}
  function emit(value){ObjC.import('Foundation');$.NSFileHandle.fileHandleWithStandardOutput.writeData($(JSON.stringify(value)+'\n').dataUsingEncoding($.NSUTF8StringEncoding));}
  function progress(stage,scanned){if(q.action==='read')emit({type:'progress',stage:stage,scanned:scanned||0});}
  progress('account',0);
  var accounts=mail.accounts();
  function listBoxes(account){
    var result=[],limited=false;
    function walk(boxes,path,depth){if(depth>5){if(boxes.length)limited=true;return;}if(boxes.length>200)limited=true;boxes.slice(0,200).forEach(function(box){if(result.length>=200){limited=true;return;}var next=path.concat([box.name()]);result.push({path:next,name:bounded(next.join(' / '),500)});walk(box.mailboxes(),next,depth+1);});}
    walk(account.mailboxes(),[],0);return {mailboxes:result,limited:limited};
  }
  if(q.action==='discover'){
    var budget=0,limited=accounts.length>30;
    return JSON.stringify({accounts:accounts.slice(0,30).map(function(a){
      var record={id:a.id(),name:bounded(a.name(),200),addresses:[],mailboxes:[],limited:false,unavailable:false};
      try{record.addresses=a.emailAddresses().slice(0,10).map(function(v){return bounded(v,320);}).filter(Boolean);}catch(e){}
      try{var found=listBoxes(a);record.limited=found.limited;found.mailboxes.forEach(function(box){var size=JSON.stringify(box).length;if(budget+size>200000){record.limited=true;limited=true;return;}budget+=size;record.mailboxes.push(box);});}catch(e){record.unavailable=true;}
      return record;
    }),limited:limited});
  }
  if(q.action==='accounts')return JSON.stringify({accounts:accounts.slice(0,30).map(function(a){return {id:a.id(),name:bounded(a.name(),200)};})});
  var account=accounts.filter(function(a){return a.id()===q.accountId;})[0];
  if(!account)throw Error('mail_account_missing');
  if(q.action==='mailboxes'){
    return JSON.stringify(listBoxes(account));
  }
  if(q.action!=='read')throw Error('mail_action_denied');
  progress('mailbox',0);
  var boxes=account.mailboxes(),box;
  q.path.forEach(function(name){box=boxes.filter(function(b){return b.name()===name;})[0];if(!box)throw Error('mail_mailbox_missing');boxes=box.mailboxes();});
  if(!box)throw Error('mail_mailbox_missing');
  progress('metadata',0);
  // Do not run whose(dateReceived) over an entire All Mail mailbox before bounding it.
  var scanned=0, skipped=0, filtered=[], began=Date.now(), exhausted=false;
  var cutoff=new Date(q.since).getTime(), timedOut=false;
  function snapshot(){return {messages:filtered.slice().sort(function(a,b){return b.date.localeCompare(a.date);}).slice(0,q.scope.limit),scanned:scanned,skipped:skipped,capped:!exhausted||filtered.length>q.scope.limit};}
  emit({type:'checkpoint',result:snapshot()});
  // Targeted chat lookup filters in Mail BEFORE applying the candidate/result limit.
  // Ordinary briefing collection retains the cheap bounded scan and never uses whose.
  var matches=null;
  if(q.search){var predicate=${nativeMailSearchPredicate.toString()};matches=box.messages.whose(predicate(q.search,q.scope),{ignoring:'case'})();began=Date.now();}
  for(var n=0;n<250;n++){
    if(Date.now()-began>15000){timedOut=true;break;}
    var m=q.search?matches[n]:box.messages[n]();if(!m||!m.exists()){exhausted=true;break;}
    var date=m.dateReceived(), stamp=date.getTime();
    scanned++;
    if(stamp<=cutoff||stamp>Date.now()+60000)continue;
    if(q.search&&(stamp<new Date(q.search.from).getTime()||stamp>=new Date(q.search.to).getTime()))continue;
    var unread=!m.readStatus();
    if(q.scope.unreadOnly&&!unread)continue;
    var subject=bounded(m.subject(),1000),sender=bounded(m.sender(),500);
    if(subject.toLowerCase().indexOf(q.scope.subject.toLowerCase())<0||sender.toLowerCase().indexOf(q.scope.sender.toLowerCase())<0)continue;
    if(q.search){var searchMatch=${matchesMailSearch.toString()};if(!searchMatch({title:subject,sender:sender,date:date.toISOString()},q.search))continue;}
    var nativeId=String(m.id());
    if(q.hasExclusions){var sourceId=hashMail(JSON.stringify([q.accountId,q.path,nativeId]));if(excluded[hashMail(JSON.stringify([sourceId,date.toISOString(),subject||'(제목 없음)']))]){skipped++;continue;}}
    var candidate={id:nativeId,title:subject,sender:sender,date:date.toISOString(),unread:unread,preview:'',bodyUnavailable:!!q.scope.bodyPreview,index:n};
    filtered.push(candidate);
    emit({type:'candidate',item:candidate,scanned:scanned,skipped:skipped});
    progress('metadata',scanned);
    if(filtered.length>=q.scope.limit)break;
  }
  if(timedOut&&!filtered.length)throw Error('mail_timeout_metadata');
  var result=snapshot();
  result.partial=timedOut;
  emit({type:'checkpoint',result:result});
  // Resolve only the selected receiving account, after preserving the message checkpoint.
  try{
    result.account={id:q.accountId,name:bounded(account.name(),200),addresses:[]};
    emit({type:'account-context',account:result.account});
    result.account.addresses=account.emailAddresses().slice(0,10).map(function(value){return String(value).trim();}).filter(function(value){return value.length>0&&value.length<=320;});
    emit({type:'account-context',account:result.account});
  }catch(e){}
  // Optional navigation IDs cannot reduce the metadata scan's 15-second candidate budget.
  // The checkpoint above survives a stalled Message-ID lookup or body read.
  for(var i=0;i<result.messages.length;i++){
    var item=result.messages[i];
    progress('metadata',scanned);
    try{
      var ref=q.search?matches[item.index]:box.messages[item.index]();
      if(String(ref.id())===item.id){
        try{var messageId=String(ref.messageId()||'');if(messageId.length<=998){item.messageId=messageId;emit({type:'message-link',id:item.id,messageId:messageId});}}catch(e){}
        if(q.scope.bodyPreview){progress('body',scanned);item.preview=bounded(ref.content(),4000);item.bodyUnavailable=false;emit({type:'body',id:item.id,preview:item.preview,bodyUnavailable:false});
          item.verificationAttempted=true;emit({type:'duplicate-check',id:item.id});
          try { if(item.messageId && ref.mailAttachments().length===0) { var canonical=(${canonicalMailSource.toString()})(String(ref.source()||''),item.messageId); if(canonical && canonical.length<=262144) { item.contentProof={version:1,digest:(${nativeMailHash.toString()})(canonical),previewDigest:(${nativeMailHash.toString()})(item.preview),length:canonical.length};emit({type:'content-proof',id:item.id,proof:item.contentProof}); } } } catch(e) {}
        }
      }
    }catch(e){}
    if(q.scope.bodyPreview && item.bodyUnavailable)emit({type:'body',id:item.id,preview:item.preview,bodyUnavailable:item.bodyUnavailable});
  }
  return JSON.stringify(result);
}`;
type ReaderInput =
  | { action: 'accounts' }
  | { action: 'discover' }
  | { action: 'mailboxes'; accountId: string }
  | {
      action: 'read';
      accountId: string;
      path: string[];
      since: string;
      scope: MailScope;
      excludeKeys?: string[];
      search?: MailSearch;
    };
export type MailReadProgress = {
  stage: 'account' | 'mailbox' | 'metadata' | 'body';
  scanned: number;
};
export async function runAppleMail(
  input: ReaderInput,
  signal: AbortSignal,
  progress?: (value: MailReadProgress) => void,
): Promise<unknown> {
  if (process.platform !== 'darwin') throw new Error('mail_macos_required');
  if (signal.aborted) throw new Error('source_cancelled');
  return new Promise((resolve, reject) => {
    const exclusions = input.action === 'read' ? (input.excludeKeys ?? []) : [];
    if (exclusions.length > 150000 || exclusions.some((key) => !/^[a-f0-9]{64}$/.test(key))) {
      reject(new Error('mail_scope_response_invalid'));
      return;
    }
    const request =
      input.action === 'read'
        ? { ...input, excludeKeys: undefined, hasExclusions: exclusions.length > 0 }
        : input;
    const child = spawn(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', APPLE_MAIL_READER, JSON.stringify(request)],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '',
      bytes = 0,
      stderr = '',
      settled = false;
    const stream = new MailReadStream(progress);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (error) {
        child.kill('SIGTERM');
        reject(error);
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('mail_invalid_response'));
        }
      }
    };
    const cancel = () => finish(new Error('source_cancelled'));
    const timer = setTimeout(() => {
      const partial = input.action === 'read' ? stream.partial() : null;
      if (partial && !signal.aborted) {
        stdout = JSON.stringify(partial);
        child.kill('SIGTERM');
        finish();
      } else finish(new Error(`mail_timeout_${stream.stage}`));
    }, APPLE_MAIL_READ_TIMEOUT_MS);
    signal.addEventListener('abort', cancel, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (settled) return;
      stdout += chunk;
      bytes += Buffer.byteLength(chunk);
      if (bytes > APPLE_MAIL_READ_MAX_BYTES) {
        finish(new Error('mail_response_limit'));
        return;
      }
      let at: number;
      while ((at = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, at);
        if (!stream.accept(line)) break;
        stdout = stdout.slice(at + 1);
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on('error', () => finish(new Error('mail_unavailable')));
    child.stdin?.on('error', () => finish(new Error('mail_unavailable')));
    child.stdin?.end(exclusions.length ? JSON.stringify(exclusions) : undefined);
    child.on('close', (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(
              /mail_timeout_metadata/.test(stderr)
                ? 'mail_timeout_metadata'
                : /-1743|not authorized|not permitted/i.test(stderr)
                  ? 'mail_permission_denied'
                  : 'mail_unavailable',
            ),
      ),
    );
    if (signal.aborted) cancel();
  });
}
/** Pipe checkpoints stay in memory; only stage/count is exposed as progress. */
export class MailReadStream {
  stage: MailReadProgress['stage'] = 'account';
  private checkpoint: z.infer<typeof MailReadResultSchema> | null = null;
  constructor(private readonly progress?: (value: MailReadProgress) => void) {}
  accept(line: string) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return false;
    }
    if (value.type === 'progress') {
      if (!['account', 'mailbox', 'metadata', 'body'].includes(value.stage)) return false;
      if (!Number.isInteger(value.scanned) || value.scanned < 0 || value.scanned > 250)
        return false;
      this.stage = value.stage;
      this.progress?.({ stage: this.stage, scanned: value.scanned });
    } else if (value.type === 'checkpoint') {
      const checked = MailReadResultSchema.safeParse(value.result);
      if (!checked.success) return false;
      this.checkpoint = checked.data;
    } else if (value.type === 'candidate') {
      const item = MailMessageSchema.safeParse(value.item);
      if (
        !item.success ||
        !this.checkpoint ||
        this.checkpoint.messages.length >= MAX_MAIL_LIMIT ||
        !Number.isInteger(value.scanned) ||
        value.scanned < 0 ||
        value.scanned > 250 ||
        !Number.isInteger(value.skipped) ||
        value.skipped < 0 ||
        value.skipped > 250
      )
        return false;
      this.checkpoint.messages.push(item.data);
      this.checkpoint.scanned = value.scanned;
      this.checkpoint.skipped = value.skipped;
    } else if (value.type === 'account-context') {
      const checked = ReadAccountSchema.safeParse(value.account);
      if (!checked.success) return false;
      if (this.checkpoint) this.checkpoint.account = checked.data;
    } else if (value.type === 'message-link') {
      const item = this.checkpoint?.messages.find((item) => item.id === value.id);
      if (typeof value.messageId !== 'string' || value.messageId.length > 998) return false;
      if (item) item.messageId = value.messageId;
    } else if (value.type === 'duplicate-check') {
      const item = this.checkpoint?.messages.find((item) => item.id === value.id);
      if (item) item.verificationAttempted = true;
    } else if (value.type === 'content-proof') {
      const checked = MailContentProofSchema.safeParse(value.proof);
      if (!checked.success) return false;
      const item = this.checkpoint?.messages.find((item) => item.id === value.id);
      if (item) item.contentProof = checked.data;
    } else if (value.type === 'body') {
      const item = this.checkpoint?.messages.find((item) => item.id === value.id);
      if (item) {
        if (
          typeof value.preview !== 'string' ||
          value.preview.length > 4000 ||
          typeof value.bodyUnavailable !== 'boolean'
        )
          return false;
        item.preview = value.preview;
        item.bodyUnavailable = value.bodyUnavailable;
      }
    } else return false;
    return true;
  }
  partial() {
    return this.checkpoint?.messages.length
      ? { ...this.checkpoint, capped: true, partial: true, stalledStage: this.stage }
      : null;
  }
}
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class AppleMailConnection {
  private accounts = new Map<string, string>();
  private accountNames = new Map<string, string>();
  private accountAddresses = new Map<string, string[]>();
  private boxes = new Map<string, { accountId: string; path: string[] }>();
  private grants = new Map<
    string,
    { scope: MailScope; expiresAt: number; controllers: Set<AbortController> }
  >();
  constructor(
    private readonly read = runAppleMail,
    private readonly clock = Date.now,
  ) {}
  async listAccounts(signal: AbortSignal): Promise<MailAccount[]> {
    const data = z
      .object({
        accounts: z.array(z.object({ id: z.string().max(500), name: z.string().max(200) })).max(30),
      })
      .parse(await this.read({ action: 'accounts' }, signal));
    return data.accounts.map((account) => {
      const id = fingerprint(account.id);
      this.accounts.set(id, account.id);
      this.accountNames.set(id, account.name);
      return { id, name: account.name };
    });
  }
  async discover(signal: AbortSignal): Promise<MailDiscovery> {
    const boxSchema = z.object({
      path: z.array(z.string().max(500)).min(1).max(6),
      name: z.string().max(500),
    });
    const data = z
      .object({
        accounts: z
          .array(
            z.object({
              id: z.string().max(500),
              name: z.string().max(200),
              addresses: z.array(z.string().max(320)).max(10).optional(),
              mailboxes: z.array(boxSchema).max(200),
              limited: z.boolean(),
              unavailable: z.boolean(),
            }),
          )
          .max(30),
        limited: z.boolean(),
      })
      .parse(await this.read({ action: 'discover' }, signal));
    if (signal.aborted) throw new Error('source_cancelled');
    return {
      limited: data.limited,
      accounts: data.accounts.map((account) => {
        const id = fingerprint(account.id);
        this.accounts.set(id, account.id);
        this.accountNames.set(id, account.name);
        this.accountAddresses.set(id, account.addresses ?? []);
        return {
          id,
          name: account.name,
          ...(account.addresses ? { addresses: account.addresses } : {}),
          limited: account.limited,
          unavailable: account.unavailable,
          mailboxes: account.mailboxes.map((box) => {
            const mailboxId = fingerprint([account.id, box.path]);
            this.boxes.set(mailboxId, { accountId: id, path: box.path });
            return { id: mailboxId, name: box.name };
          }),
        };
      }),
    };
  }
  status(routineId: string, value: MailScope): MailConnectionStatus {
    const scope = MailScopeSchema.parse(value),
      grant = this.grants.get(routineId);
    if (!grant) return { state: 'disconnected', expiresAt: null };
    if (fingerprint(grant.scope) !== fingerprint(scope))
      return { state: 'scope-changed', expiresAt: null };
    const expiresAt = new Date(grant.expiresAt).toISOString();
    if (grant.expiresAt <= this.clock()) return { state: 'expired', expiresAt };
    return {
      state: 'connected',
      expiresAt,
      accountName: this.accountNames.get(scope.accountId) ?? '선택한 계정',
      mailboxName: this.boxes.get(scope.mailboxId)?.path.join(' / ') ?? '선택한 메일함',
    };
  }
  async restorePolicyGrant(routineId: string, scope: MailScope, signal: AbortSignal) {
    if (
      mailTargets(scope).some(
        (target) => !this.accounts.has(target.accountId) || !this.boxes.has(target.mailboxId),
      )
    )
      await this.discover(signal);
    if (signal.aborted) throw new Error('source_cancelled');
    // The caller has already checked the saved exact policy. A missing account must not
    // discard readable accounts; collect reports partial failures without widening scope.
    this.authorize(routineId, scope, true);
  }
  async resolveMailbox(scope: MailScope, signal: AbortSignal) {
    if (!this.accounts.has(scope.accountId) || !this.boxes.has(scope.mailboxId))
      await this.discover(signal);
    const accountId = this.accounts.get(scope.accountId),
      box = this.boxes.get(scope.mailboxId);
    if (signal.aborted) throw new Error('source_cancelled');
    if (!accountId || !box || box.accountId !== scope.accountId)
      throw new Error('mail_account_refresh_required');
    return { accountId, path: [...box.path] };
  }
  async listMailboxes(accountId: string, signal: AbortSignal): Promise<Mailbox[]> {
    const rawId = this.accounts.get(accountId);
    if (!rawId) throw new Error('mail_account_refresh_required');
    const data = z
      .object({
        mailboxes: z
          .array(
            z.object({
              path: z.array(z.string().max(500)).min(1).max(6),
              name: z.string().max(500),
            }),
          )
          .max(200),
      })
      .parse(await this.read({ action: 'mailboxes', accountId: rawId }, signal));
    return data.mailboxes.map((box) => {
      const id = fingerprint([rawId, box.path]);
      this.boxes.set(id, { accountId, path: box.path });
      return { id, name: box.name };
    });
  }
  authorize(routineId: string, value: unknown, restoredPolicy = false) {
    const scope = MailScopeSchema.parse(value);
    if (
      !restoredPolicy &&
      mailTargets(scope).some(
        (target) =>
          !this.accounts.has(target.accountId) ||
          this.boxes.get(target.mailboxId)?.accountId !== target.accountId,
      )
    )
      throw new Error('mail_account_refresh_required');
    this.revoke(routineId);
    for (const [id, grant] of this.grants) if (grant.expiresAt <= this.clock()) this.revoke(id);
    if (this.grants.size >= 32) throw new Error('mail_grant_limit');
    const expiresAt = this.clock() + 30 * 60_000;
    this.grants.set(routineId, { scope, expiresAt, controllers: new Set() });
    return { expiresAt: new Date(expiresAt).toISOString() };
  }
  revoke(routineId: string) {
    const grant = this.grants.get(routineId);
    for (const controller of grant?.controllers ?? []) controller.abort();
    this.grants.delete(routineId);
  }
  close() {
    for (const id of this.grants.keys()) this.revoke(id);
  }
  assertScope(routineId: string, value: MailScope) {
    const scope = MailScopeSchema.parse(value),
      grant = this.grants.get(routineId);
    if (
      !grant ||
      grant.expiresAt <= this.clock() ||
      fingerprint(grant.scope) !== fingerprint(scope)
    )
      throw new Error('mail_scope_required');
  }
  async collect(
    routineId: string,
    value: MailScope,
    signal: AbortSignal,
    progress?: (value: MailReadProgress) => void,
    plan?: MailReadPlan,
    search?: MailSearch,
  ): Promise<{ items: LiveItem[]; note: string; notice?: string; completedAccounts?: string[] }> {
    const scope = MailScopeSchema.parse(value);
    this.assertScope(routineId, scope);
    if (
      search?.account &&
      mailTargets(scope).some((t) => !this.accountAddresses.has(t.accountId))
    ) {
      await this.discover(signal);
      this.assertScope(routineId, scope);
    }
    const readPlan =
      plan ??
      planMailRead(
        scope,
        mailTargets(scope).map((t) => t.accountId),
      );
    const selected = mailTargets(scope).filter(
      (t) =>
        !search?.account ||
        [
          t.accountId,
          this.accountNames.get(t.accountId),
          ...(this.accountAddresses.get(t.accountId) ?? []),
        ].some((name) => name?.toLowerCase() === search.account),
    );
    if (!selected.length) throw new Error('mail_search_account_not_connected');
    if (search && plan) throw new Error('mail_scope_response_invalid');
    if (search) {
      // Allocate the same total read budget only among the requested connected accounts.
      readPlan.budgets = selected.map((t, i) => ({
        accountId: t.accountId,
        limit:
          Math.floor(scope.limit / selected.length) + (i < scope.limit % selected.length ? 1 : 0),
      }));
    }
    const targets = selected.filter((t) =>
      readPlan.budgets.some((b) => b.accountId === t.accountId && b.limit > 0),
    );
    if (targets.length === 1 && !plan)
      return this.collectTarget(routineId, scope, targets[0]!, signal, progress, undefined, search);
    // At most five fixed native readers, each with the existing 60-second deadline.
    // Keep a global result limit, not five times the configured display/LLM budget.
    const results = await Promise.allSettled(
      targets.map((target) =>
        this.collectTarget(routineId, scope, target, signal, progress, readPlan, search),
      ),
    );
    if (signal.aborted) throw new Error('source_cancelled');
    this.assertScope(routineId, scope);
    const failed = results.filter((r) => r.status === 'rejected');
    const unsafe = failed.find(
      (r) =>
        r.status === 'rejected' &&
        !/^mail_(timeout_(account|mailbox|metadata|body)|unavailable|account_refresh_required)$/.test(
          r.reason instanceof Error ? r.reason.message : '',
        ),
    );
    if (unsafe?.status === 'rejected') throw unsafe.reason;
    const ready = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (!ready.length && failed[0]?.status === 'rejected') throw failed[0].reason;
    return {
      items: deduplicateVerifiedMail(
        ready
          .flatMap((r) => r.items)
          .sort(
            (a, b) =>
              (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.id.localeCompare(b.id),
          )
          .slice(0, scope.limit),
      ),
      note: `연결 계정 ${targets.length}개 중 ${ready.length}개 조회 · 전체 최대 ${scope.limit}개${failed.length ? ` · ${failed.length}개 계정 조회 실패 (결과 0건과 다릅니다)` : ''}. ${search ? '검색 조건을 먼저 적용한 후보를 받은 시간순으로 합쳤습니다.' : '각 메일함 앞부분의 제한된 후보를 받은 시간순으로 합쳤습니다.'} 전체 받은편지함의 최신 메일을 보장하지 않습니다. ${ready.map((r) => r.note).join(' ')}`,
      ...(plan
        ? {
            notice: mailReadNotice(
              plan,
              scope,
              ready.reduce((n, r) => n + (r.skipped ?? 0), 0),
            ),
            completedAccounts: results.flatMap((r, index) =>
              r.status === 'fulfilled' ? [targets[index]!.accountId] : [],
            ),
          }
        : {}),
    };
  }
  private async collectTarget(
    routineId: string,
    value: MailScope,
    target: MailTarget,
    signal: AbortSignal,
    progress?: (value: MailReadProgress) => void,
    plan?: MailReadPlan,
    search?: MailSearch,
  ): Promise<{ items: LiveItem[]; note: string; skipped?: number }> {
    const { additionalAccounts: _others, ...base } = value;
    const scope = { ...base, ...target },
      grant = this.grants.get(routineId);
    if (plan)
      scope.limit = Math.min(
        scope.limit,
        plan.budgets.find((b) => b.accountId === target.accountId)?.limit ?? 0,
      );
    if (scope.limit < 1) throw new Error('mail_scope_required');
    this.assertScope(routineId, value);
    if (!grant) throw new Error('mail_scope_required');
    const accountId = this.accounts.get(scope.accountId),
      box = this.boxes.get(scope.mailboxId);
    if (!accountId || !box || box.accountId !== scope.accountId)
      throw new Error('mail_account_refresh_required');
    const controller = new AbortController(),
      cancel = () => controller.abort();
    grant.controllers.add(controller);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (signal.aborted) throw new Error('source_cancelled');
      const raw = await this.read(
        {
          action: 'read',
          accountId,
          path: box.path,
          since: new Date(this.clock() - scope.days * 86400000).toISOString(),
          scope,
          ...(plan ? { excludeKeys: plan.excludeKeys } : {}),
          ...(search ? { search } : {}),
        },
        controller.signal,
        progress,
      );
      if (controller.signal.aborted || this.grants.get(routineId) !== grant)
        throw new Error('source_cancelled');
      const data = MailReadResultSchema.parse(raw);
      if (data.account && data.account.id !== accountId)
        throw new Error('mail_scope_response_invalid');
      const since = this.clock() - scope.days * 86400000;
      if (
        data.messages.length > scope.limit ||
        data.messages.some(
          (item) =>
            Date.parse(item.date) < since ||
            Date.parse(item.date) > this.clock() + 60000 ||
            (scope.unreadOnly && !item.unread) ||
            !item.title.toLowerCase().includes(scope.subject.toLowerCase()) ||
            !item.sender.toLowerCase().includes(scope.sender.toLowerCase()),
        )
      )
        throw new Error('mail_scope_response_invalid');
      if (search && data.messages.some((item) => !matchesMailSearch(item, search)))
        throw new Error('mail_scope_response_invalid');
      const excluded = new Set(plan?.excludeKeys ?? []);
      if (
        data.messages.some((item) =>
          excluded.has(
            mailSummaryKey(
              fingerprint([accountId, box.path, item.id]),
              item.date,
              item.title || '(제목 없음)',
            ),
          ),
        )
      )
        throw new Error('mail_scope_response_invalid');
      return {
        items: data.messages.map((item) => ({
          ...(scope.bodyPreview && item.verificationAttempted
            ? { mailDuplicateCheckedAt: new Date(this.clock()).toISOString() }
            : {}),
          ...(scope.bodyPreview && !item.bodyUnavailable && item.contentProof
            ? { mailContentProof: item.contentProof }
            : {}),
          id: fingerprint([accountId, box.path, item.id]),
          ...(MailNativeIdSchema.safeParse(item.id).success ? { mailNativeId: item.id } : {}),
          kind: 'email',
          title: item.title || '(제목 없음)',
          text: scope.bodyPreview
            ? item.bodyUnavailable
              ? '본문 미리보기를 읽지 못했습니다.'
              : item.preview
            : '본문을 읽지 않았습니다.',
          source: 'Apple Mail · 읽기 전용',
          ...(appleMailMessageUrl(item.messageId)
            ? { mailMessageUrl: appleMailMessageUrl(item.messageId)! }
            : {}),
          publishedAt: item.date,
          mailUnread: item.unread,
          mailAccount: {
            id: scope.accountId,
            name: data.account?.name || this.accountNames.get(scope.accountId) || '',
            addresses: data.account?.addresses ?? [],
          },
          readScope: scope.bodyPreview && !item.bodyUnavailable ? 'mail-preview' : 'mail-metadata',
          details: [
            item.sender,
            item.unread ? '읽지 않음' : '읽음',
            ...(scope.bodyPreview && item.bodyUnavailable
              ? ['본문 읽기가 늦어 제목·발신자만 표시합니다.']
              : []),
          ],
        })),
        note: `선택한 메일함 · 최근 ${scope.days}일 · ${data.scanned}개 검사 · 최대 ${scope.limit}개${search ? ' · 발신자/제목/수신일 조건을 Mail 조회 전에 적용 (본문 전체 검색 아님)' : ''}${data.capped ? (search ? ' · 일치 후보 중 제한된 일부 결과' : ' · 메일함 앞부분에서 조건에 맞는 일부 결과') : ''}${data.partial ? ' · 읽기가 지연되어 확보한 목록을 먼저 표시합니다' : ''}${scope.unreadOnly ? ' · 읽지 않은 메일만 허용됨' : ''}. 읽음 상태·메일 원본은 변경하지 않았습니다.`,
        ...(plan ? { skipped: data.skipped ?? 0 } : {}),
      };
    } finally {
      grant.controllers.delete(controller);
      signal.removeEventListener('abort', cancel);
    }
  }
}
