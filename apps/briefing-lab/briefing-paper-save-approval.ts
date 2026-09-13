import { paperSaveReply } from './src/paper-summary-contract';
import type { LiveItem } from './src/live-types';

const plain = (value: string) => value.replace(/```[\s\S]*?```/g, '').replace(/^>.*$/gm, '');
const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
/** Only current user input authorizes a write. History must come from the owned server store. */
export function approvedPaperSaveScope(
  prompt: string,
  history: readonly { role: string; text: string; hasOtherPendingActions?: boolean | undefined }[],
  isImmediateReply = true,
) {
  if (!isImmediateReply) return;
  const explicit =
    /^(?:(?:이|위|두|해당|분석한)\s*)?논문(?:들)?(?:\s*요약|\s*분석)?(?:을|를)?\s*(?:(?:Briefing\s*Lab|보관함|라이브러리)(?:에)?\s*)?(?:저장|추가)(?:해\s*줘|해\s*주세요|해주세요)[.!]?$/i.test(
      prompt.trim(),
    ) || paperSaveReply(prompt, false) === 'save';
  if (!explicit && paperSaveReply(prompt) !== 'save') return;
  const latest = history.at(-1);
  const candidates = explicit ? history.slice(-8).reverse() : latest ? [latest] : [];
  const offer = candidates.find(
    (m) =>
      m.role === 'assistant' &&
      /(?:Briefing\s*Lab|논문\s*요약\s*(?:보관함|라이브러리))[^\n]{0,100}(?:추가|저장)할까요[?？]/i.test(
        plain(m.text),
      ),
  );
  if (!offer) return;
  if (!explicit && offer.hasOtherPendingActions) return;
  // A bare yes cannot choose between a paper save and another pending write.
  if (
    !explicit &&
    /(?:일정|할\s*일|설정|메일)[^\n]{0,60}(?:등록|추가|저장|변경|삭제|전송)할까요[?？]/.test(
      plain(offer.text),
    )
  )
    return;
  return plain(offer.text);
}
export function paperWithinSaveScope(item: LiveItem, scope: string) {
  if (item.kind !== 'papers' || !item.sourceUrl || !item.title.trim()) return false;
  return (
    scope.includes(item.sourceUrl) || ` ${normalize(scope)} `.includes(` ${normalize(item.title)} `)
  );
}
