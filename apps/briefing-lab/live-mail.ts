import { spawn } from 'node:child_process';
import { mailLinksFromSource, type MailLink } from './src/mail-html-links';
import { isScholarAlertMessage } from './briefing-scholar-alerts';
import { readMailIndex, type MailIndexRead, type MailIndexReader } from './live-mail-index';
import {
  MailDirectoryStore,
  type MailDirectory,
  type MailDirectoryEntry,
} from './mail-directory-store';
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
  mailSearchIndexTerms,
  nativeMailSearchPredicate,
  matchesMailSearch,
  type MailSearch,
} from './briefing-mail-search';
import {
  nativeMailHash,
  mailDeliveryKey,
  mailMessageKey,
  mailSummaryKey,
  type MailTargetCoverage,
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

export const APPLE_MAIL_READ_TIMEOUT_MS = 160_000;
// Mail's first answer is not part of the read. On a Mac that is out of memory a Mail that has sat in
// the background for days is mostly swapped out, and took about three minutes to answer one Apple
// Event (2026-09-21) while GOSU gave up after 160 seconds. The work deadline starts at that answer.
export const APPLE_MAIL_FIRST_RESPONSE_MS = 300_000;
/** A mailbox walk has no budget of its own: it may run this long while Mail keeps answering. */
export const APPLE_MAIL_DISCOVERY_DEADLINE_MS = 420_000;
/** How often a reader that is still waiting for Mail's first answer says so. */
export const APPLE_MAIL_WAIT_NOTICE_MS = 15_000;
// Metadata scan budget inside the reader. A busy Mac can slow each Mail Apple Event to seconds (Gmail
// measured ~0.6s per message), so the scan gets 100s and the process deadline leaves time for the
// link and body passes; the checkpoint still returns earlier candidates.
export const APPLE_MAIL_METADATA_BUDGET_MS = 100_000;
export const APPLE_MAIL_READ_MAX_BYTES = 8_000_000;
/** Messages newer than the floor examined in one read; known ones are skipped cheaply. */
export const APPLE_MAIL_SCAN_CAP = 2000;
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
  // Web links read from the raw HTML source (Scholar alerts); the plain-text body drops them.
  links: z
    .array(z.object({ text: z.string().max(500), href: z.string().max(2048) }))
    .max(100)
    .optional(),
});
const ReadAccountSchema = MailAccountContextSchema.extend({ id: z.string().min(1).max(500) });
// How far one read examined the mailbox, so a run can prove it saw every message down to the
// previous coverage or record exactly which interval it could not reach.
export const MailReadCoverageSchema = z.object({
  ordered: z.boolean(),
  floorReached: z.boolean(),
  stoppedBy: z.enum(['floor', 'end', 'limit', 'budget', 'scan']),
  newest: z.string().datetime().nullable(),
  oldest: z.string().datetime().nullable(),
  floor: z.string().datetime(),
  examined: z.number().int().min(0).max(APPLE_MAIL_SCAN_CAP),
  known: z.number().int().min(0).max(APPLE_MAIL_SCAN_CAP),
  /** New messages beyond the per-run limit, left for the next briefing. */
  pending: z.number().int().min(0).max(APPLE_MAIL_SCAN_CAP).default(0),
  pendingComplete: z.boolean().default(true),
});
export type MailReadCoverage = z.infer<typeof MailReadCoverageSchema>;
const MailReadResultSchema = z.object({
  coverage: MailReadCoverageSchema.optional(),
  bodiesDeferred: z.boolean().optional(),
  account: ReadAccountSchema.optional(),
  messages: z.array(MailMessageSchema).max(MAX_MAIL_LIMIT),
  scanned: z.number().int().min(0).max(APPLE_MAIL_SCAN_CAP),
  capped: z.boolean(),
  partial: z.boolean().optional(),
  skipped: z.number().int().min(0).max(APPLE_MAIL_SCAN_CAP).optional(),
});

// Fixed read-only JXA program. Every user value is argv JSON, never executable script text.
export const APPLE_MAIL_READER = String.raw`
function run(argv) {
  var q=JSON.parse(argv[0]), excluded=Object.create(null), deliveries=Object.create(null);
  var hashMail=${nativeMailHash.toString()};
  if(q.hasExclusions){ObjC.import('Foundation');var payload=JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile,$.NSUTF8StringEncoding)));(Array.isArray(payload)?payload:payload.keys||[]).forEach(function(key){excluded[key]=true;});(Array.isArray(payload)?[]:payload.deliveries||[]).forEach(function(key){deliveries[key]=true;});}
  var mail=Application('Mail');
  function bounded(s,n){return String(s||'').slice(0,n);}
  function emit(value){ObjC.import('Foundation');$.NSFileHandle.fileHandleWithStandardOutput.writeData($(JSON.stringify(value)+'\n').dataUsingEncoding($.NSUTF8StringEncoding));}
  function progress(stage,scanned){if(q.action==='read')emit({type:'progress',stage:stage,scanned:scanned||0});}
  progress('account',0);
  var accounts=mail.accounts();
  // Mail has answered its first Apple Event: the host stops waiting for Mail to wake up and starts
  // the deadline of the work itself. A mailbox walk reports every mailbox it has walked, so the
  // host stops it only when Mail goes silent, not while Mail answers slowly.
  var listing=q.action==='discover'||q.action==='accounts'||q.action==='mailboxes', walked=0;
  if(q.action!=='bodies')emit({type:'answered'});
  function listBoxes(account){
    var result=[],limited=false;
    function walk(boxes,path,depth){if(depth>5){if(boxes.length)limited=true;return;}if(boxes.length>200)limited=true;boxes.slice(0,200).forEach(function(box){if(result.length>=200){limited=true;return;}var next=path.concat([box.name()]);result.push({path:next,name:bounded(next.join(' / '),500)});walked++;if(listing)emit({type:'progress',stage:'mailbox',scanned:Math.min(walked,${APPLE_MAIL_SCAN_CAP})});walk(box.mailboxes(),next,depth+1);});}
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
  if(q.action!=='read'&&q.action!=='bodies')throw Error('mail_action_denied');
  progress('mailbox',0);
  var boxes=account.mailboxes(),box;
  q.path.forEach(function(name){box=boxes.filter(function(b){return b.name()===name;})[0];if(!box)throw Error('mail_mailbox_missing');boxes=box.mailboxes();});
  if(!box)throw Error('mail_mailbox_missing');
  // Bodies are read in their own supervised process: a message whose body Mail must still download
  // from the server can block for about a minute, so the host announces each message first and
  // moves on when one stalls instead of waiting.
  if(q.action==='bodies'){
    q.items.forEach(function(it){
      emit({type:'body-start',id:it.id});
      var preview='', unavailable=true, ref=null;
      try{ref=box.messages.byId(Number(it.id));if(String(ref.id())===it.id){preview=bounded(ref.content(),4000);unavailable=!preview.trim();}}catch(e){}
      emit({type:'body',id:it.id,preview:preview,bodyUnavailable:unavailable});
      // A Scholar alert links each paper only from its HTML title: the host reads the hrefs from
      // the raw source, bounded by the same 262KB used for source proofs.
      if(!unavailable&&ref&&it.html){try{if(ref.messageSize()<=262144){var raw=String(ref.source()||'');if(raw.length<=262144)emit({type:'mail-source',id:it.id,source:raw});}}catch(e){}}
      if(!unavailable&&ref){
        emit({type:'duplicate-check',id:it.id});
        try { if(it.messageId && ref.messageSize()<=262144 && ref.mailAttachments().length===0) { var canonical=(${canonicalMailSource.toString()})(String(ref.source()||''),it.messageId); if(canonical && canonical.length<=262144) { emit({type:'content-proof',id:it.id,proof:{version:1,digest:(${nativeMailHash.toString()})(canonical),previewDigest:(${nativeMailHash.toString()})(preview),length:canonical.length}}); } } } catch(e) {}
      }
    });
    return JSON.stringify({done:true});
  }
  progress('metadata',0);
  var scanned=0, skipped=0, filtered=[], began=Date.now(), exhausted=false, descending=true, previousStamp=Infinity;
  // The floor is the previous verified coverage (minus overlap) when known, else the days window.
  // It never goes below the approved days window: an older gap is reported, not read.
  var cutoff=new Date(q.since).getTime(), floor=q.stopAt&&!q.search?Math.max(cutoff,new Date(q.stopAt).getTime()):cutoff, timedOut=false, stoppedBy='scan', newest=null, oldest=null, known=0, limitReached=false, pending=0;
  function snapshot(){return {messages:filtered.slice().sort(function(a,b){return b.date.localeCompare(a.date);}).slice(0,q.scope.limit),scanned:scanned,skipped:skipped,capped:!exhausted||filtered.length>q.scope.limit};}
  emit({type:'checkpoint',result:snapshot()});
  // Targeted chat lookup filters in Mail BEFORE applying the candidate/result limit.
  // Ordinary collection asks Mail once for messages received after the floor. Index access
  // (box.messages[n]) makes Mail resolve each position in the whole mailbox: measured ~1s per
  // message in a 117k-message Gmail All Mail, while properties of the id-based references a
  // whose query returns cost ~1ms each (44 messages: ~60s before, 14s query + 0.05s after).
  var matches=null, refs=[];
  // GOSU read Mail's own index (newest first, already bounded to the window): no whose query, which
  // makes Mail check every message of the mailbox (2m20s+ for the 117k-message Gmail All Mail).
  if(q.indexed){for(var k=0;k<q.indexed.length;k++)refs.push({m:box.messages.byId(Number(q.indexed[k].id)),date:null,indexed:new Date(q.indexed[k].date).getTime()});matches={length:q.indexedTotal};began=Date.now();}
  else if(q.search){var predicate=${nativeMailSearchPredicate.toString()};matches=box.messages.whose(predicate(q.search,q.scope),{ignoring:'case'})();began=Date.now();for(var k=0;k<Math.min(matches.length,${APPLE_MAIL_SCAN_CAP});k++)refs.push({m:matches[k],date:null});}
  else{
    matches=box.messages.whose({dateReceived:{_greaterThan:new Date(floor)}})();began=Date.now();
    // Received times are cheap on these references; sort newest first so coverage is contiguous.
    for(var k=0;k<Math.min(matches.length,${APPLE_MAIL_SCAN_CAP});k++){if(Date.now()-began>${APPLE_MAIL_METADATA_BUDGET_MS}){timedOut=true;descending=false;break;}refs.push({m:matches[k],date:matches[k].dateReceived()});}
    refs.sort(function(a,b){return b.date.getTime()-a.date.getTime();});
  }
  for(var n=0;n<refs.length;n++){
    if(Date.now()-began>${APPLE_MAIL_METADATA_BUDGET_MS}){timedOut=true;if(!limitReached)stoppedBy='budget';break;}
    var m=refs[n].m, date;
    // A message deleted after the index was read is gone, not an error; a received time that
    // disagrees with the index means the index is not Mail's view, and GOSU reads again without it.
    try{date=refs[n].date||m.dateReceived();}catch(e){if(refs[n].indexed!==undefined)continue;throw e;}
    if(refs[n].indexed!==undefined&&Math.abs(date.getTime()-refs[n].indexed)>2000)throw Error('mail_index_mismatch');
    var stamp=date.getTime();
    scanned++;
    // Mail lists newest first; once that order holds, an older message ends the window without
    // reading further. Any out-of-order date falls back to the bounded full scan.
    if(stamp>previousStamp)descending=false;
    previousStamp=stamp;
    if(!q.search&&descending&&scanned>=2&&stamp<=floor){exhausted=true;stoppedBy='floor';break;}
    if(!limitReached){if(newest===null||stamp>newest)newest=stamp;if(oldest===null||stamp<oldest)oldest=stamp;}
    if(stamp<=floor||stamp>Date.now()+60000)continue;
    if(q.search&&(stamp<new Date(q.search.from).getTime()||stamp>=new Date(q.search.to).getTime()))continue;
    var nativeId=String(m.id()), sourceId='';
    // An already summarized delivery is skipped after two cheap properties (id, received time),
    // so the budget reaches further down instead of re-reading subjects and senders.
    if(q.hasExclusions){sourceId=hashMail(JSON.stringify([q.accountId,q.path,nativeId]));if(deliveries[hashMail(JSON.stringify([sourceId,date.toISOString()]))]){skipped++;known++;continue;}}
    var unread=!m.readStatus();
    if(q.scope.unreadOnly&&!unread)continue;
    var subject=bounded(m.subject(),1000),sender=bounded(m.sender(),500);
    if(subject.toLowerCase().indexOf(q.scope.subject.toLowerCase())<0||sender.toLowerCase().indexOf(q.scope.sender.toLowerCase())<0)continue;
    if(q.search){var searchMatch=${matchesMailSearch.toString()};if(!searchMatch({title:subject,sender:sender,date:date.toISOString()},q.search))continue;}
    if(q.hasExclusions){if(excluded[hashMail(JSON.stringify([sourceId,date.toISOString(),subject||'(제목 없음)']))]){skipped++;known++;continue;}}
    // Past the limit, new messages are only counted: the run reports how many wait for the next
    // briefing, and coverage stays at the last loaded message so they are read then.
    if(limitReached){pending++;continue;}
    var candidate={id:nativeId,title:subject,sender:sender,date:date.toISOString(),unread:unread,preview:'',bodyUnavailable:!!q.scope.bodyPreview,index:n};
    filtered.push(candidate);
    emit({type:'candidate',item:candidate,scanned:scanned,skipped:skipped});
    progress('metadata',scanned);
    if(filtered.length>=q.scope.limit&&!limitReached){stoppedBy='limit';limitReached=true;if(q.search)break;}
  }
  // Every reference after the floor was examined: the floor (or the search set's end) is reached.
  if(!limitReached&&!timedOut&&n>=refs.length){if(matches.length>refs.length)stoppedBy='scan';else{exhausted=true;stoppedBy=q.search?'end':'floor';}}
  if(!limitReached&&timedOut&&stoppedBy==='scan')stoppedBy='budget';
  var pendingComplete=limitReached&&!timedOut&&n>=refs.length&&matches.length<=refs.length;
  if(timedOut&&!filtered.length)throw Error('mail_timeout_metadata');
  var result=snapshot();
  result.partial=timedOut&&!limitReached;
  result.coverage={ordered:descending,floorReached:stoppedBy==='floor'||stoppedBy==='end',stoppedBy:stoppedBy,newest:newest===null?null:new Date(newest).toISOString(),oldest:oldest===null?null:new Date(oldest).toISOString(),floor:new Date(floor).toISOString(),examined:scanned,known:known,pending:pending,pendingComplete:pendingComplete};
  emit({type:'checkpoint',result:result});
  // Resolve only the selected receiving account, after preserving the message checkpoint.
  try{
    result.account={id:q.accountId,name:bounded(account.name(),200),addresses:[]};
    emit({type:'account-context',account:result.account});
    result.account.addresses=account.emailAddresses().slice(0,10).map(function(value){return String(value).trim();}).filter(function(value){return value.length>0&&value.length<=320;});
    emit({type:'account-context',account:result.account});
  }catch(e){}
  // Preserve every available preview before optional navigation or duplicate-proof reads.
  // Message-ID first: it is one cheap Apple Event per message (measured 0.02-0.8s), while content()
  // can stall for about 60s while Mail downloads a body. Reading every body first let the process
  // time out before any original-message link existed, disabling every Apple Mail button.
  for(var i=0;i<result.messages.length;i++){
    var item=result.messages[i];
    try{
      var ref=refs[item.index].m;
      if(String(ref.id())===item.id){var messageId=String(ref.messageId()||'');if(messageId.length<=998){item.messageId=messageId;emit({type:'message-link',id:item.id,messageId:messageId});}}
    }catch(e){}
  }
  if(q.deferBodies&&q.scope.bodyPreview){result.bodiesDeferred=true;return JSON.stringify(result);}
  // A stalled source() lookup must not starve later messages of body content. The source proof only
  // accepts up to 262KB, so larger messages are skipped by size before source() is read at all
  // (a 4MB newsletter source took 12s only to be discarded).
  for(var i=0;i<result.messages.length;i++){
    var item=result.messages[i];
    try{
      var ref=refs[item.index].m;
      if(String(ref.id())===item.id){
        if(q.scope.bodyPreview){progress('body',scanned);item.preview=bounded(ref.content(),4000);item.bodyUnavailable=!item.preview.trim();emit({type:'body',id:item.id,preview:item.preview,bodyUnavailable:item.bodyUnavailable});}
      }
    }catch(e){}
    if(q.scope.bodyPreview && item.bodyUnavailable)emit({type:'body',id:item.id,preview:item.preview,bodyUnavailable:item.bodyUnavailable});
  }
  for(var i=0;i<result.messages.length;i++){
    var item=result.messages[i];
    try{
      var ref=refs[item.index].m;
      if(String(ref.id())===item.id){
        if(q.scope.bodyPreview && !item.bodyUnavailable){
          item.verificationAttempted=true;emit({type:'duplicate-check',id:item.id});
          try { if(item.messageId && ref.messageSize()<=262144 && ref.mailAttachments().length===0) { var canonical=(${canonicalMailSource.toString()})(String(ref.source()||''),item.messageId); if(canonical && canonical.length<=262144) { item.contentProof={version:1,digest:(${nativeMailHash.toString()})(canonical),previewDigest:(${nativeMailHash.toString()})(item.preview),length:canonical.length};emit({type:'content-proof',id:item.id,proof:item.contentProof}); } } } catch(e) {}
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
      stopAt?: string;
      /** Message ids and received times from Mail's index, newest first, replacing the whose query. */
      indexed?: { id: string; date: string }[];
      indexedTotal?: number;
      deferBodies?: boolean;
      scope: MailScope;
      excludeKeys?: string[];
      excludeDeliveries?: string[];
      search?: MailSearch;
    };
export type MailReadProgress = {
  stage: 'account' | 'mailbox' | 'metadata' | 'body';
  scanned: number;
  /** Set while Mail has not answered anything yet: how long the reader has waited for it. */
  waitedSeconds?: number;
};
/** The reader names its own failures on stderr; anything else is Mail being unavailable. */
function readerFailure(stderr: string) {
  const code = /mail_(?:timeout_metadata|index_mismatch|account_missing|mailbox_missing)/.exec(
    stderr,
  )?.[0];
  if (code) return code;
  return /-1743|not authorized|not permitted/i.test(stderr)
    ? 'mail_permission_denied'
    : 'mail_unavailable';
}
export async function runAppleMail(
  input: ReaderInput,
  signal: AbortSignal,
  progress?: (value: MailReadProgress) => void,
): Promise<unknown> {
  if (process.platform !== 'darwin') throw new Error('mail_macos_required');
  if (signal.aborted) throw new Error('source_cancelled');
  return new Promise((resolve, reject) => {
    const exclusions = input.action === 'read' ? (input.excludeKeys ?? []) : [];
    const deliveries = input.action === 'read' ? (input.excludeDeliveries ?? []) : [];
    if (
      exclusions.length > 150000 ||
      deliveries.length > 150000 ||
      [...exclusions, ...deliveries].some((key) => !/^[a-f0-9]{64}$/.test(key))
    ) {
      reject(new Error('mail_scope_response_invalid'));
      return;
    }
    const request =
      input.action === 'read'
        ? {
            ...input,
            excludeKeys: undefined,
            excludeDeliveries: undefined,
            hasExclusions: exclusions.length + deliveries.length > 0,
          }
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
    const startedAt = Date.now();
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      clearInterval(waiting);
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
    const expire = () => {
      const partial = input.action === 'read' ? stream.partial() : null;
      if (partial && !signal.aborted) {
        stdout = JSON.stringify(partial);
        child.kill('SIGTERM');
        finish();
      } else finish(new Error(`mail_timeout_${stream.stage}`));
    };
    // Until Mail answers anything, only the wait for Mail runs. Its first answer starts the
    // deadline of the work: the whole read, or for a mailbox walk the time Mail may stay silent.
    let timer = setTimeout(expire, APPLE_MAIL_FIRST_RESPONSE_MS),
      deadline: ReturnType<typeof setTimeout> | undefined,
      answered = false;
    const waiting = setInterval(() => {
      if (!answered && !settled)
        progress?.({
          stage: 'account',
          scanned: 0,
          waitedSeconds: Math.round((Date.now() - startedAt) / 1000),
        });
    }, APPLE_MAIL_WAIT_NOTICE_MS);
    const heard = () => {
      if (!stream.answered || (answered && input.action === 'read')) return;
      if (!answered && input.action !== 'read')
        deadline = setTimeout(expire, APPLE_MAIL_DISCOVERY_DEADLINE_MS);
      answered = true;
      clearInterval(waiting);
      clearTimeout(timer);
      timer = setTimeout(expire, APPLE_MAIL_READ_TIMEOUT_MS);
    };
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
        heard();
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on('error', () => finish(new Error('mail_unavailable')));
    child.stdin?.on('error', () => finish(new Error('mail_unavailable')));
    child.stdin?.end(
      exclusions.length + deliveries.length
        ? JSON.stringify({ keys: exclusions, deliveries })
        : undefined,
    );
    child.on('close', (code) => finish(code === 0 ? undefined : new Error(readerFailure(stderr))));
    if (signal.aborted) cancel();
  });
}
export const APPLE_MAIL_BODY_STALL_MS = 8_000;
export const APPLE_MAIL_BODY_START_GRACE_MS = 20_000;
export const APPLE_MAIL_BODIES_DEADLINE_MS = 120_000;
export type MailBodyRequest = {
  accountId: string;
  path: string[];
  items: { id: string; messageId?: string; html?: boolean }[];
};
export type MailBodyResult = {
  bodies: Record<string, { preview: string; bodyUnavailable: boolean }>;
  proofs: Record<string, z.infer<typeof MailContentProofSchema>>;
  /** Links from the raw HTML source of messages requested with `html`. */
  links?: Record<string, MailLink[]>;
  checked: string[];
  stalled: string[];
};
/**
 * Reads opted-in bodies without waiting on Mail's server downloads. The reader announces each
 * message; when one produces nothing for a few seconds it is recorded as unavailable (read again by
 * the next briefing, after Mail has downloaded it in the background) and a fresh reader continues
 * with the remaining messages.
 */
export async function runAppleMailBodies(
  input: MailBodyRequest,
  signal: AbortSignal,
  timing = {
    stallMs: APPLE_MAIL_BODY_STALL_MS,
    startGraceMs: APPLE_MAIL_BODY_START_GRACE_MS,
    deadlineMs: APPLE_MAIL_BODIES_DEADLINE_MS,
  },
): Promise<MailBodyResult> {
  if (process.platform !== 'darwin') throw new Error('mail_macos_required');
  const result: MailBodyResult = { bodies: {}, proofs: {}, links: {}, checked: [], stalled: [] };
  const known = new Set(input.items.map((item) => item.id));
  let remaining = input.items.slice(0, MAX_MAIL_LIMIT);
  const deadline = Date.now() + timing.deadlineMs;
  while (remaining.length && !signal.aborted && Date.now() < deadline) {
    const outcome = await new Promise<{ stalledId: string | null; closed: boolean }>((resolve) => {
      const child = spawn(
        '/usr/bin/osascript',
        [
          '-l',
          'JavaScript',
          '-e',
          APPLE_MAIL_READER,
          JSON.stringify({
            action: 'bodies',
            accountId: input.accountId,
            path: input.path,
            items: remaining,
          }),
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let buffer = '',
        bytes = 0,
        current: string | null = null,
        settled = false;
      const settle = (value: { stalledId: string | null; closed: boolean }) => {
        if (settled) return;
        settled = true;
        clearTimeout(stall);
        clearTimeout(overall);
        signal.removeEventListener('abort', abort);
        child.kill('SIGTERM');
        resolve(value);
      };
      let stall = setTimeout(
        () => settle({ stalledId: current, closed: false }),
        timing.startGraceMs,
      );
      const overall = setTimeout(
        () => settle({ stalledId: current, closed: false }),
        Math.max(0, deadline - Date.now()),
      );
      const abort = () => settle({ stalledId: null, closed: false });
      signal.addEventListener('abort', abort, { once: true });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > APPLE_MAIL_READ_MAX_BYTES) return settle({ stalledId: current, closed: false });
        buffer += chunk;
        let at: number;
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          let value: Record<string, unknown>;
          try {
            value = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          const id = typeof value.id === 'string' && known.has(value.id) ? value.id : null;
          if (!id) continue;
          clearTimeout(stall);
          stall = setTimeout(() => settle({ stalledId: current, closed: false }), timing.stallMs);
          if (value.type === 'body-start') current = id;
          else if (
            value.type === 'body' &&
            typeof value.preview === 'string' &&
            value.preview.length <= 4000 &&
            typeof value.bodyUnavailable === 'boolean'
          )
            result.bodies[id] = { preview: value.preview, bodyUnavailable: value.bodyUnavailable };
          else if (value.type === 'duplicate-check') result.checked.push(id);
          else if (
            value.type === 'mail-source' &&
            typeof value.source === 'string' &&
            value.source.length <= 262144
          ) {
            const links = mailLinksFromSource(value.source);
            if (links.length) result.links![id] = links;
          } else if (value.type === 'content-proof') {
            const proof = MailContentProofSchema.safeParse(value.proof);
            if (proof.success) result.proofs[id] = proof.data;
          }
        }
      });
      child.stderr.on('data', () => undefined);
      child.on('error', () => settle({ stalledId: null, closed: true }));
      child.on('close', () => settle({ stalledId: null, closed: true }));
    });
    if (outcome.closed || !outcome.stalledId) break;
    if (!result.bodies[outcome.stalledId]) result.stalled.push(outcome.stalledId);
    const stalledId = outcome.stalledId;
    remaining = remaining.filter((item) => !result.bodies[item.id] && item.id !== stalledId);
  }
  for (const item of input.items) result.bodies[item.id] ??= { preview: '', bodyUnavailable: true };
  return result;
}
/** Pipe checkpoints stay in memory; only stage/count is exposed as progress. */
export class MailReadStream {
  stage: MailReadProgress['stage'] = 'account';
  /** Mail has answered at least one Apple Event; before that the reader only waits for Mail. */
  answered = false;
  private checkpoint: z.infer<typeof MailReadResultSchema> | null = null;
  constructor(private readonly progress?: (value: MailReadProgress) => void) {}
  accept(line: string) {
    const accepted = this.read(line);
    // The reader announces the account stage before it asks Mail anything; every later line was
    // produced from an answer of Mail.
    if (accepted && !(accepted === 'progress' && this.stage === 'account')) this.answered = true;
    return Boolean(accepted);
  }
  private read(line: string): string | false {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return false;
    }
    if (value.type === 'answered') return 'answered';
    if (value.type === 'progress') {
      if (!['account', 'mailbox', 'metadata', 'body'].includes(value.stage)) return false;
      if (
        !Number.isInteger(value.scanned) ||
        value.scanned < 0 ||
        value.scanned > APPLE_MAIL_SCAN_CAP
      )
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
        value.scanned > APPLE_MAIL_SCAN_CAP ||
        !Number.isInteger(value.skipped) ||
        value.skipped < 0 ||
        value.skipped > APPLE_MAIL_SCAN_CAP
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
    return String(value.type);
  }
  partial() {
    return this.checkpoint?.messages.length
      ? { ...this.checkpoint, capped: true, partial: true, stalledStage: this.stage }
      : null;
  }
}
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Why Mail's index was not used; the scripted query that ran instead is correct but slow. */
export function mailIndexWarning(code: string) {
  const slow = '메일함 전체를 확인하는 느린 방식으로 조회했습니다';
  if (code === 'mail_index_permission_required')
    return `Apple Mail 색인을 읽을 권한이 없어 ${slow}. 시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한에서 GOSU를 켜면 메일 조회가 빨라집니다.`;
  if (code === 'mail_index_mismatch') return `Apple Mail 색인의 받은 시각이 Mail과 달라 ${slow}.`;
  if (code === 'mail_index_mailbox_unmatched')
    return `Apple Mail 색인에서 선택한 메일함을 찾지 못해 ${slow}.`;
  return `Apple Mail 색인을 읽지 못해(macOS 업데이트로 구조가 바뀌었을 수 있습니다) ${slow} (오류 코드: ${code || 'mail_index_unreadable'}).`;
}
export class AppleMailConnection {
  private accounts = new Map<string, string>();
  private accountNames = new Map<string, string>();
  private accountAddresses = new Map<string, string[]>();
  private boxes = new Map<string, { accountId: string; path: string[] }>();
  private grants = new Map<
    string,
    { scope: MailScope; expiresAt: number; controllers: Set<AbortController> }
  >();
  /** Mailboxes known only from the saved locations: Mail has not confirmed them in this session. */
  private unconfirmed = new Set<string>();
  private saved: MailDirectoryEntry[] = [];
  private directoryLoaded: Promise<void> | undefined;
  constructor(
    private readonly read = runAppleMail,
    private readonly clock = Date.now,
    private readonly readBodies = runAppleMailBodies,
    // Only the real Mail reader uses the real index; injected test readers never touch ~/Library/Mail.
    private readonly readIndex: MailIndexReader | null = read === runAppleMail
      ? readMailIndex
      : null,
    // Likewise only the real reader keeps the real saved mailbox locations.
    private readonly directory: MailDirectory | null = read === runAppleMail
      ? new MailDirectoryStore()
      : null,
  ) {}
  /**
   * Where Mail keeps the approved mailboxes, as saved by an earlier session. The account and
   * mailbox maps live in memory, so every restart used to begin with a walk of every mailbox of
   * every account (about eighty Apple Events for three accounts): the slowest request GOSU makes,
   * at the moment a Mac that has just started GOSU is busiest. Fingerprints are computed again
   * from the saved values, so an entry can only ever stand for the mailbox it names.
   */
  private restoreDirectory() {
    return (this.directoryLoaded ??= (async () => {
      if (!this.directory) return;
      try {
        this.saved = await this.directory.load();
      } catch {
        // Unreadable saved locations only make this start slower: Mail is asked again.
        return;
      }
      for (const entry of this.saved) {
        const accountId = fingerprint(entry.accountId),
          mailboxId = fingerprint([entry.accountId, entry.path]);
        if (this.boxes.has(mailboxId)) continue;
        if (!this.accounts.has(accountId)) this.accounts.set(accountId, entry.accountId);
        this.boxes.set(mailboxId, { accountId, path: entry.path });
        this.unconfirmed.add(mailboxId);
      }
    })());
  }
  private async saveDirectory(entries: MailDirectoryEntry[]) {
    if (!this.directory || JSON.stringify(entries) === JSON.stringify(this.saved)) return;
    try {
      await this.directory.save(entries);
      this.saved = entries;
    } catch {
      // Not saved: the next start asks Mail for its mailboxes again, as before.
    }
  }
  /** Saves where the mailboxes of an approved scope are, once they are known. */
  private async rememberDirectory(scope: MailScope) {
    const entries = [...this.saved];
    for (const target of mailTargets(scope)) {
      const accountId = this.accounts.get(target.accountId),
        box = this.boxes.get(target.mailboxId);
      if (!accountId || !box || box.accountId !== target.accountId) continue;
      if (!entries.some((e) => fingerprint([e.accountId, e.path]) === target.mailboxId))
        entries.push({ accountId, path: [...box.path] });
    }
    await this.saveDirectory(entries);
  }
  /**
   * A reader that could not find its account or mailbox. When the location came from the saved
   * file, Mail is asked for its mailboxes: a renamed mailbox or removed account is then reported as
   * the settings mismatch it is; a location Mail confirms keeps the ordinary failure.
   */
  private async locationFailure(error: unknown, target: MailTarget, signal: AbortSignal) {
    if (!(error instanceof Error) || !/^mail_(?:account|mailbox)_missing$/.test(error.message))
      return error;
    if (this.unconfirmed.has(target.mailboxId)) {
      await this.discover(signal);
      if (this.boxes.get(target.mailboxId)?.accountId !== target.accountId)
        return new Error('mail_account_refresh_required');
    }
    return new Error('mail_unavailable');
  }
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
    // Mail's own list settles every saved location: listed ones are confirmed, and one that a
    // complete list of its account does not contain is forgotten (renamed mailbox, removed account).
    const listed = new Set(
      data.accounts.flatMap((account) =>
        account.mailboxes.map((box) => fingerprint([account.id, box.path])),
      ),
    );
    for (const mailboxId of this.unconfirmed) {
      const box = this.boxes.get(mailboxId),
        account = data.accounts.find((a) => box && fingerprint(a.id) === box.accountId);
      const complete = account ? !account.limited && !account.unavailable : !data.limited;
      if (listed.has(mailboxId)) this.unconfirmed.delete(mailboxId);
      else if (complete) {
        this.unconfirmed.delete(mailboxId);
        this.boxes.delete(mailboxId);
      }
    }
    await this.saveDirectory(
      this.saved.filter((entry) => this.boxes.has(fingerprint([entry.accountId, entry.path]))),
    );
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
    await this.restoreDirectory();
    if (
      mailTargets(scope).some(
        (target) => !this.accounts.has(target.accountId) || !this.boxes.has(target.mailboxId),
      )
    )
      await this.discover(signal);
    if (signal.aborted) throw new Error('source_cancelled');
    await this.rememberDirectory(scope);
    // A reader of the same approved scope may already be at work: a briefing run reading mail
    // while the assistant or Project Chat searches it. Authorizing again revokes the grant and
    // aborts that read, so an unexpired grant of this exact scope is kept and only extended.
    const existing = this.grants.get(routineId);
    if (
      existing &&
      existing.expiresAt > this.clock() &&
      fingerprint(existing.scope) === fingerprint(MailScopeSchema.parse(scope))
    ) {
      existing.expiresAt = this.clock() + 30 * 60_000;
      return;
    }
    // The caller has already checked the saved exact policy. A missing account must not
    // discard readable accounts; collect reports partial failures without widening scope.
    this.authorize(routineId, scope, true);
  }
  async resolveMailbox(scope: MailScope, signal: AbortSignal) {
    await this.restoreDirectory();
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
  ): Promise<{
    items: LiveItem[];
    note: string;
    notice?: string;
    completedAccounts?: string[];
    /** Why Mail's index was not used for some target; the items were still read. */
    warning?: string;
    mailCoverage?: MailTargetCoverage[];
    /** Accounts left unread because Mail answered too slowly or not at all. */
    delayedAccounts?: number;
  }> {
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
    // At most five fixed native readers, each with the existing 60-second deadline, run one after
    // another. Mail answers Apple Events one at a time, so concurrent readers queued behind a slow
    // account (about 0.6s per Gmail message, bodies that stall for a minute) and every reader's
    // deadline expired while waiting: a fast account kept links but lost bodies, a slow one lost
    // both. Keep a global result limit, not five times the configured display/LLM budget.
    const results: PromiseSettledResult<{
      items: LiveItem[];
      note: string;
      skipped?: number;
      coverage?: MailTargetCoverage;
      warning?: string;
    }>[] = [];
    let silent: unknown;
    for (const target of targets) {
      if (signal.aborted) break;
      // Mail did not answer one reader for its whole waiting time: the other accounts would each
      // wait for the same silent Mail, so they are left for the next read.
      if (silent) {
        results.push({ status: 'rejected', reason: silent });
        continue;
      }
      try {
        results.push({
          status: 'fulfilled',
          value: await this.collectTarget(
            routineId,
            scope,
            target,
            signal,
            progress,
            readPlan,
            search,
          ),
        });
      } catch (reason) {
        results.push({ status: 'rejected', reason });
        if (reason instanceof Error && reason.message === 'mail_timeout_account') silent = reason;
      }
    }
    if (signal.aborted) throw new Error('source_cancelled');
    this.assertScope(routineId, scope);
    const failed = results.filter((r) => r.status === 'rejected');
    const delayedAccounts = failed.filter(
      (r) =>
        r.status === 'rejected' &&
        /^mail_(?:timeout_(?:account|mailbox|metadata|body)|unavailable)$/.test(
          r.reason instanceof Error ? r.reason.message : '',
        ),
    ).length;
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
    const items = deduplicateVerifiedMail(
      ready
        .flatMap((r) => r.items)
        .sort(
          (a, b) =>
            (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.id.localeCompare(b.id),
        )
        .slice(0, scope.limit),
    );
    // A copy merged into another account's row is handled when that row is summarized.
    const representative = new Map<string, string>();
    for (const item of items)
      for (const copy of item.mailCopies ?? []) representative.set(copy.id, item.id);
    const warnings = [...new Set(ready.flatMap((r) => (r.warning ? [r.warning] : [])))];
    return {
      items,
      ...(warnings.length ? { warning: warnings.join(' ') } : {}),
      ...(delayedAccounts ? { delayedAccounts } : {}),
      ...(plan
        ? {
            mailCoverage: results.map((r, index) => {
              const target = targets[index]!;
              if (r.status === 'fulfilled' && r.value.coverage)
                return {
                  ...r.value.coverage,
                  items: r.value.coverage.items.map((i) => ({
                    ...i,
                    copyIds: representative.has(i.id) ? [representative.get(i.id)!] : [],
                  })),
                };
              return {
                accountId: target.accountId,
                mailboxId: target.mailboxId,
                accountName: this.accountNames.get(target.accountId) || '연결 계정',
                since: new Date(this.clock() - scope.days * 86400000).toISOString(),
                startedAt: new Date(this.clock()).toISOString(),
                read: null,
                failed: true,
                items: [],
              };
            }),
          }
        : {}),
      note: `연결 계정 ${targets.length}개 중 ${ready.length}개 조회 · 전체 최대 ${scope.limit}개${failed.length ? ` · ${failed.length}개 계정 조회 실패 (결과 0건과 다릅니다)` : ''}. ${search ? '검색 조건을 먼저 적용한 후보를 받은 시간순으로 합쳤습니다.' : '각 메일함 앞부분의 제한된 후보를 받은 시간순으로 합쳤습니다.'} 전체 받은편지함의 최신 메일을 보장하지 않습니다. ${ready.map((r) => r.note).join(' ')}`,
      ...(plan &&
      mailReadNotice(
        plan,
        scope,
        ready.reduce((n, r) => n + (r.skipped ?? 0), 0),
      )
        ? {
            notice: mailReadNotice(
              plan,
              scope,
              ready.reduce((n, r) => n + (r.skipped ?? 0), 0),
            ),
          }
        : {}),
      ...(plan
        ? {
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
  ): Promise<{
    items: LiveItem[];
    note: string;
    skipped?: number;
    coverage?: MailTargetCoverage;
    /** Set when Mail's index could not be used and the slow scripted query ran instead. */
    warning?: string;
  }> {
    let warning = '';
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
      const startedAt = new Date(this.clock()).toISOString();
      const stopAt = plan?.coverage?.find(
        (c) => c.accountId === target.accountId && c.mailboxId === target.mailboxId,
      )?.stopAt;
      // The saved days bound a briefing. A search may name an earlier date (user decision,
      // 2026-09-22); then the window starts where the search does.
      const briefingStart = this.clock() - scope.days * 86400000;
      const windowStart = search
        ? Math.min(briefingStart, Date.parse(search.from) - 1)
        : briefingStart;
      const wide = windowStart < briefingStart;
      let indexed: MailIndexRead | null = null,
        indexFailure = '';
      if (this.readIndex)
        try {
          const read = this.readIndex(
            accountId,
            box.path,
            search
              ? {
                  after: windowStart,
                  from: Date.parse(search.from),
                  before: Date.parse(search.to),
                  limit: APPLE_MAIL_SCAN_CAP,
                  // Sender and subject words narrow the candidates in the index itself, so a long
                  // window stays a small read. The reader still checks every message.
                  terms: mailSearchIndexTerms(search, scope),
                }
              : {
                  after: Math.max(windowStart, stopAt ? Date.parse(stopAt) : windowStart),
                  limit: APPLE_MAIL_SCAN_CAP,
                },
          );
          // A search must see every candidate; past the cap, Mail's own query keeps it exact.
          indexed = search && read.total > read.messages.length ? null : read;
          if (wide && !indexed) indexFailure = 'mail_search_too_broad';
        } catch (error) {
          indexFailure = error instanceof Error ? error.message : 'mail_index_unreadable';
          warning = mailIndexWarning(indexFailure);
        }
      else if (wide) indexFailure = 'mail_index_unavailable';
      // Without the index Mail would check every message of the mailbox for such a search: minutes
      // at full load for a large one. It is refused with what to do instead.
      if (wide && !indexed)
        throw new Error(
          indexFailure === 'mail_search_too_broad'
            ? 'mail_search_too_broad'
            : 'mail_search_index_required',
          { cause: new Error(indexFailure) },
        );
      const request = {
        action: 'read' as const,
        accountId,
        path: box.path,
        since: new Date(windowStart).toISOString(),
        ...(stopAt ? { stopAt } : {}),
        ...(scope.bodyPreview ? { deferBodies: true } : {}),
        scope,
        ...(plan ? { excludeKeys: plan.excludeKeys } : {}),
        ...(plan?.excludeDeliveries?.length ? { excludeDeliveries: plan.excludeDeliveries } : {}),
        ...(search ? { search } : {}),
      };
      let raw: unknown;
      try {
        try {
          raw = await this.read(
            indexed
              ? { ...request, indexed: indexed.messages, indexedTotal: indexed.total }
              : request,
            controller.signal,
            progress,
          );
        } catch (error) {
          if (!indexed || !(error instanceof Error) || error.message !== 'mail_index_mismatch')
            throw error;
          warning = mailIndexWarning('mail_index_mismatch');
          raw = await this.read(request, controller.signal, progress);
        }
      } catch (error) {
        throw await this.locationFailure(error, target, controller.signal);
      }
      if (controller.signal.aborted || this.grants.get(routineId) !== grant)
        throw new Error('source_cancelled');
      const data = MailReadResultSchema.parse(raw);
      if (data.account && data.account.id !== accountId)
        throw new Error('mail_scope_response_invalid');
      const since = windowStart;
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
      const excluded = new Set(plan?.excludeKeys ?? []),
        knownDeliveries = new Set(plan?.excludeDeliveries ?? []);
      if (
        data.messages.some(
          (item) =>
            excluded.has(
              mailSummaryKey(
                fingerprint([accountId, box.path, item.id]),
                item.date,
                item.title || '(제목 없음)',
              ),
            ) ||
            knownDeliveries.has(
              mailDeliveryKey(fingerprint([accountId, box.path, item.id]), item.date),
            ),
        )
      )
        throw new Error('mail_scope_response_invalid');
      // The exclusion Mail itself applies is keyed by the mailbox path and Mail's per-mailbox
      // message number, so the same mail read from a second selected mailbox -- or after Mail moved
      // or re-indexed it -- is not recognised and gets summarized again, identically. The Message-ID
      // does not move. Dropping these here, before bodies are read, also saves reading them.
      //
      // Deliberately conservative: a message with no usable Message-ID is never skipped, and one
      // that has one is skipped only when its received time and subject match the summary too.
      const knownMessages = new Set(plan?.excludeMessages ?? []);
      if (knownMessages.size) {
        data.messages = data.messages.filter((item) => {
          const url = appleMailMessageUrl(item.messageId);
          return (
            !url || !knownMessages.has(mailMessageKey(url, item.date, item.title || '(제목 없음)'))
          );
        });
      }
      if (data.bodiesDeferred && scope.bodyPreview && data.messages.length) {
        progress?.({ stage: 'body', scanned: data.scanned });
        const bodies = await this.readBodies(
          {
            accountId,
            path: box.path,
            items: data.messages.map((m) => ({
              id: m.id,
              ...(m.messageId ? { messageId: m.messageId } : {}),
              ...(isScholarAlertMessage(m.sender, m.title) ? { html: true } : {}),
            })),
          },
          controller.signal,
        );
        if (controller.signal.aborted || this.grants.get(routineId) !== grant)
          throw new Error('source_cancelled');
        for (const message of data.messages) {
          const body = bodies.bodies[message.id];
          if (body) {
            message.preview = body.preview;
            message.bodyUnavailable = body.bodyUnavailable;
          }
          if (bodies.checked.includes(message.id)) message.verificationAttempted = true;
          const proof = bodies.proofs[message.id];
          if (proof && !message.bodyUnavailable) message.contentProof = proof;
          const links = bodies.links?.[message.id];
          if (links?.length && !message.bodyUnavailable) message.links = links;
        }
      }
      const coverage = data.coverage;
      const bodyWaiting = scope.bodyPreview
        ? data.messages.filter((m) => m.bodyUnavailable).length
        : 0;
      return {
        ...(warning ? { warning } : {}),
        ...(plan
          ? {
              coverage: {
                accountId: target.accountId,
                mailboxId: target.mailboxId,
                accountName:
                  data.account?.name || this.accountNames.get(scope.accountId) || '연결 계정',
                since: new Date(since).toISOString(),
                startedAt,
                read: coverage ?? null,
                ...(data.partial && !coverage ? { partial: true } : {}),
                items: data.messages.map((item) => ({
                  id: fingerprint([accountId, box.path, item.id]),
                  receivedAt: item.date,
                  bodyUnavailable: scope.bodyPreview && item.bodyUnavailable,
                  copyIds: [],
                })),
              },
            }
          : {}),
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
          ...(scope.bodyPreview && !item.bodyUnavailable && item.links?.length
            ? { mailLinks: item.links }
            : {}),
          details: [
            item.sender,
            item.unread ? '읽지 않음' : '읽음',
            ...(scope.bodyPreview && item.bodyUnavailable
              ? ['본문 읽기가 늦어 제목·발신자만 표시합니다.']
              : []),
          ],
        })),
        note: `선택한 메일함 · ${search ? `검색 기간 ${search.from} ~ ${search.to}` : `최근 ${scope.days}일`} · ${data.scanned}개 검사${coverage?.known ? ` · 이미 요약한 ${coverage.known}개 빠르게 건너뜀` : ''}${plan && coverage ? ` · 새 메일 ${data.messages.length + coverage.pending}${coverage.pendingComplete ? '' : '+'}통 중 ${data.messages.length}통 요약 대상${coverage.pending ? ` · 나머지 ${coverage.pending}${coverage.pendingComplete ? '' : '+'}통은 다음 브리핑에서 이어서 요약` : ''}` : ''}${bodyWaiting ? ` · 본문을 아직 받지 못한 ${bodyWaiting}통은 제목으로 먼저 요약(다음 브리핑에서 본문으로 다시 요약)` : ''}${plan && coverage ? (coverage.floorReached && coverage.ordered ? ' · 이전 확인 지점까지 모두 확인' : ' · 이전 확인 지점까지 닿지 못함(다음 실행에서 이어서 확인)') : ''} · 최대 ${scope.limit}개${search ? ' · 발신자/제목/수신일 조건을 Mail 조회 전에 적용 (본문 전체 검색 아님)' : ''}${data.capped ? (search ? ' · 일치 후보 중 제한된 일부 결과' : ' · 메일함 앞부분에서 조건에 맞는 일부 결과') : ''}${data.partial ? ' · 읽기가 지연되어 확보한 목록을 먼저 표시합니다' : ''}${scope.unreadOnly ? ' · 읽지 않은 메일만 허용됨' : ''}. 읽음 상태·메일 원본은 변경하지 않았습니다.`,
        ...(plan ? { skipped: data.skipped ?? 0 } : {}),
      };
    } finally {
      grant.controllers.delete(controller);
      signal.removeEventListener('abort', cancel);
    }
  }
}
