import { createHash } from 'node:crypto';
import { mailTargets, type MailScope } from '@gosu/briefing-core';

export const mailSummaryKey = (id: string, receivedAt: string, title: string) =>
  createHash('sha256')
    .update(JSON.stringify([id, new Date(receivedAt).toISOString(), title]))
    .digest('hex');

export type MailReadPlan = {
  recheckCount?: number;
  budgets: { accountId: string; limit: number }[];
  firstAccountIds: string[];
  initial: boolean;
  excludeKeys: string[];
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
export function mailReadNotice(plan: MailReadPlan, scope: MailScope, skipped: number) {
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
