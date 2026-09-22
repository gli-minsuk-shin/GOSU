import { createHash } from 'node:crypto';
import { mailTargets, type MailScope } from '@gosu/briefing-core';

export const mailSummaryKey = (id: string, receivedAt: string, title: string) =>
  createHash('sha256')
    .update(JSON.stringify([id, new Date(receivedAt).toISOString(), title]))
    .digest('hex');

/** A delivery known by its source id and received time, checkable before subject or sender. */
export const mailDeliveryKey = (id: string, receivedAt: string) =>
  createHash('sha256')
    .update(JSON.stringify([id, new Date(receivedAt).toISOString()]))
    .digest('hex');
/** Re-read this much below the previous coverage: Mail can sync a message after its received time. */
export const MAIL_COVERAGE_OVERLAP_MS = 6 * 3_600_000;

export type MailReadPlan = {
  recheckCount?: number;
  budgets: { accountId: string; limit: number }[];
  firstAccountIds: string[];
  initial: boolean;
  excludeKeys: string[];
  excludeDeliveries?: string[];
  /** Per selected mailbox: read down to here (never below the approved days window). */
  coverage?: { accountId: string; mailboxId: string; stopAt: string }[];
};
/** What one mailbox read examined, for the run to commit after summaries are saved. */
export type MailTargetCoverage = {
  accountId: string;
  mailboxId: string;
  accountName: string;
  since: string;
  startedAt: string;
  /** The mailbox read failed, or returned a partial result without coverage information. */
  failed?: boolean;
  partial?: boolean;
  read: {
    ordered: boolean;
    floorReached: boolean;
    stoppedBy: 'floor' | 'end' | 'limit' | 'budget' | 'scan';
    newest: string | null;
    oldest: string | null;
    floor: string;
    examined: number;
    known: number;
    pending?: number;
    pendingComplete?: boolean;
  } | null;
  items: { id: string; receivedAt: string; bodyUnavailable: boolean; copyIds: string[] }[];
};
export function planMailRead(
  scope: MailScope,
  completed: string[],
  excludeKeys: string[] = [],
): MailReadPlan {
  const targets = mailTargets(scope);
  const firstAccountIds = targets
    .filter((t) => !completed.includes(t.accountId))
    .map((t) => t.accountId);
  const initial = firstAccountIds.length === targets.length;
  let remaining = initial ? Math.min(3, scope.limit) : scope.limit;
  const budgets = targets.map((t) => ({ accountId: t.accountId, limit: 0 }));
  while (remaining > 0) {
    let assigned = false;
    for (const b of budgets) {
      const cap = firstAccountIds.includes(b.accountId) ? 3 : scope.limit;
      if (remaining && b.limit < cap) {
        b.limit++;
        remaining--;
        assigned = true;
      }
    }
    if (!assigned) break;
  }
  return { budgets, firstAccountIds, initial, excludeKeys };
}
/**
 * A notice only when the read range is not the usual one (the first connection or a newly added
 * account read only three messages). The routine "이미 요약한 메일은 제외하고 …" paragraph was removed at
 * the user's request: it restated the settings on every run.
 */
export function mailReadNotice(plan: MailReadPlan, scope: MailScope, skipped: number) {
  if (!plan.initial && !plan.firstAccountIds.length) return '';
  const start = plan.initial
    ? `첫 연결에서는 한꺼번에 많은 메일이 표시되지 않도록 전체 최대 ${Math.min(3, scope.limit)}개만 가져옵니다. 연결 확인 후 다음 브리핑부터 설정한 전체 최대 ${scope.limit}개를 조회합니다.`
    : plan.firstAccountIds.length
      ? `새로 연결한 계정은 첫 조회에서 최대 3개만 가져옵니다. 기존 계정을 포함해 전체 최대 ${scope.limit}개입니다.`
      : `이미 요약한 메일은 제외하고 전체 최대 ${scope.limit}개를 조회합니다.`;
  return `${start}${plan.recheckCount ? ` 예전 요약의 계정 간 중복 후보 ${plan.recheckCount}개는 현재 허용된 조회 범위에서 원문을 한 번 재확인합니다. 확인할 수 없으면 따로 유지합니다.` : ''}${skipped ? ` 이전에 요약한 동일 메일 ${skipped}개는 본문을 다시 읽지 않고 건너뛰었습니다.` : ''} 기존 요약은 Briefing History에서 볼 수 있습니다.`;
}

/** Self-contained SHA-256 for the fixed JXA reader (no Node APIs or external code).
 * Only JSON-encoded identity metadata is hashed; parity with node:crypto is regression-tested.
 */
export function nativeMailHash(value: string): string {
  const bytes = unescape(encodeURIComponent(value));
  const constants: number[] = [],
    state: number[] = [];
  for (let p = 2; constants.length < 64; p++) {
    let prime = true;
    for (let d = 2; d * d <= p; d++)
      if (p % d === 0) {
        prime = false;
        break;
      }
    if (prime) {
      if (state.length < 8) state.push((Math.sqrt(p) * 4294967296) | 0);
      constants.push((Math.pow(p, 1 / 3) * 4294967296) | 0);
    }
  }
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++)
    words[i >> 2] = (words[i >> 2] || 0) | (bytes.charCodeAt(i) << (24 - (i % 4) * 8));
  words[bytes.length >> 2] =
    (words[bytes.length >> 2] || 0) | (128 << (24 - (bytes.length % 4) * 8));
  const length = (((bytes.length + 8) >> 6) + 1) * 16;
  words[length - 1] = bytes.length * 8;
  const rotate = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < length; offset += 16) {
    const w: number[] = [],
      v = state.slice();
    for (let i = 0; i < 64; i++) {
      if (i < 16) w[i] = words[offset + i] || 0;
      else {
        const a = w[i - 15]!,
          b = w[i - 2]!;
        w[i] =
          (w[i - 16]! +
            (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) +
            w[i - 7]! +
            (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) |
          0;
      }
      const e = v[4]!,
        a = v[0]!;
      const t1 =
        (v[7]! +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          ((e & v[5]!) ^ (~e & v[6]!)) +
          constants[i]! +
          w[i]!) |
        0;
      const t2 =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) +
          ((a & v[1]!) ^ (a & v[2]!) ^ (v[1]! & v[2]!))) |
        0;
      v.pop();
      v.unshift((t1 + t2) | 0);
      v[4] = (v[4]! + t1) | 0;
    }
    for (let i = 0; i < 8; i++) state[i] = (state[i]! + v[i]!) | 0;
  }
  return state.map((n) => ('00000000' + (n >>> 0).toString(16)).slice(-8)).join('');
}

/** A saved email whose body was requested but could not be read must be read again. */
export function needsMailReread(
  item: { kind?: string | undefined; readScope: string },
  scope: { bodyPreview: boolean } | null | undefined,
) {
  return Boolean(
    scope?.bodyPreview &&
    (item.kind === 'email' || (!item.kind && item.readScope.startsWith('mail'))) &&
    item.readScope === 'mail-metadata',
  );
}

type CoverageRecord = { coveredFrom: string; coveredTo: string; gapFrom: string | null };
/**
 * Advances one mailbox's verified coverage from a read. Coverage only extends through messages that
 * were examined in received-time order and then handled (summarized, merged into a summarized copy,
 * or filtered out by the user's settings); the first unhandled message, an out-of-order mailbox or a
 * read that stopped early leaves a gap for the next run. Returns null when the read failed.
 */
export function nextMailCoverage(
  previous: CoverageRecord | null,
  report: MailTargetCoverage,
  handled: ReadonlySet<string>,
) {
  const read = report.read;
  if (!read) return null;
  const since = Date.parse(report.since),
    startedAt = Date.parse(report.startedAt),
    floor = Date.parse(read.floor);
  const unhandled = report.items.filter(
    (item) =>
      item.bodyUnavailable || !(handled.has(item.id) || item.copyIds.some((id) => handled.has(id))),
  );
  let reached = read.ordered ? read.floorReached : read.stoppedBy === 'end';
  let lower = read.ordered && read.oldest ? Date.parse(read.oldest) : startedAt;
  if (unhandled.length) {
    reached = false;
    lower = Math.max(lower, ...unhandled.map((item) => Date.parse(item.receivedAt)));
  }
  const priorGap = previous?.gapFrom ? Date.parse(previous.gapFrom) : null;
  let agedOutFrom = priorGap !== null && priorGap < since ? priorGap : null;
  let coveredFrom: number, gapFrom: number | null;
  if (reached) {
    coveredFrom =
      previous && !previous.gapFrom ? Math.min(Date.parse(previous.coveredFrom), floor) : floor;
    gapFrom = null;
  } else {
    coveredFrom = Math.min(lower, startedAt);
    const needed = previous ? Date.parse(previous.gapFrom ?? previous.coveredTo) : since;
    if (needed < since && agedOutFrom === null) agedOutFrom = needed;
    gapFrom = Math.max(needed, since);
    if (gapFrom >= coveredFrom) gapFrom = null;
  }
  // Why a gap remains, so the warning can say what the user should expect.
  const reason: 'limit' | 'body' | 'incomplete' | null =
    gapFrom === null
      ? null
      : read.stoppedBy === 'limit'
        ? 'limit'
        : unhandled.length && unhandled.every((item) => item.bodyUnavailable)
          ? 'body'
          : 'incomplete';
  return {
    coveredFrom: new Date(coveredFrom).toISOString(),
    coveredTo: new Date(startedAt).toISOString(),
    gapFrom: gapFrom === null ? null : new Date(gapFrom).toISOString(),
    agedOutFrom: agedOutFrom === null ? null : new Date(agedOutFrom).toISOString(),
    reason,
    pending: read.pending ?? 0,
    pendingComplete: read.pendingComplete ?? true,
    bodyWaiting: report.items.filter((item) => item.bodyUnavailable).length,
  };
}
