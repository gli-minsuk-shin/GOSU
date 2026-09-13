import type { BriefingHistory } from './briefing-workspace-store';
import type { LiveSourceResult } from './src/live-types';
import { savedPaperKey } from './src/paper-library-index';
export function summarizedPaperKeys(history: BriefingHistory[]) {
  return new Set(
    history.flatMap((h) =>
      h.kind === 'briefing'
        ? h.items
            .filter(
              (i) =>
                i.summary.trim() &&
                (i.kind === 'papers' || (!i.kind && /^(abstract|paper-|html-)/.test(i.readScope))),
            )
            .map(savedPaperKey)
        : [],
    ),
  );
}
export function newPaperResults(results: LiveSourceResult[], history: BriefingHistory[]) {
  const seen = summarizedPaperKeys(history);
  return results.map((result) => {
    if (result.kind !== 'papers') return result;
    let previous = 0,
      repeated = 0;
    const incoming = new Set<string>();
    const items = result.items.filter((item) => {
      const key = savedPaperKey(item);
      if (seen.has(key)) {
        previous++;
        return false;
      }
      if (incoming.has(key)) {
        repeated++;
        return false;
      }
      incoming.add(key);
      return true;
    });
    for (const key of incoming) seen.add(key);
    const excluded = result.items.length - items.length;
    const failed = result.status === 'failed' || Boolean(result.error);
    const notice = items.length
      ? `새 논문 ${items.length}개를 찾았습니다.`
      : failed
        ? '조회 실패로 새 논문 여부를 확인하지 못했습니다.'
        : '이번 조회 범위에 새 논문이 없습니다.';
    return {
      ...result,
      notice: `${notice}${previous ? ` 이전에 요약했거나 앞선 결과에 있는 ${previous}개는 새 요약 대상에서 제외했습니다.` : ''}${repeated ? ` 이번 조회에서 동일 식별자·버전으로 확인한 중복 ${repeated}개를 합쳤습니다.` : ''}`,
      items,
      status: items.length
        ? result.status
        : result.status === 'ready'
          ? ('empty' as const)
          : result.status,
      note: `${result.note} ${items.length ? `새 논문 ${items.length}개` : failed ? '조회 실패로 새 논문 여부를 확인하지 못했습니다.' : '이번 조회 범위에 새 논문이 없습니다.'}${excluded ? ` · 동일 식별자·버전 중복 ${excluded}개는 새 요약 대상에서 제외했습니다. 저장된 요약·이력은 유지합니다.` : ''}`,
    };
  });
}
