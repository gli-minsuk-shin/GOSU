/** High-precision guard for status-only boilerplate, not a general semantic quality score. */
export function isPriorityOnlyEmailSummary(value: string) {
  const text = value.replace(/[*_`#]/g, '').trim();
  if (!text) return true;
  if (text.length > 500) return false;
  const sentences = text
    .split(/[.!?。\n·]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const priority =
    /^(?:(?:현재|제공된|이|해당|메일|이메일|미리보기|정보|자료|내용|내용이|없어|없어서|만으로는|로는|에서는|의|은|는|만|으로|아직|확인된|부족하여|부족해|불충분하여)\s*)*(?:중요도|우선순위)(?:를|는|가|의)?\s*(?:판단|판별|평가|분류|확인)?\s*(?:이|은|는|을|하기|할)?\s*(?:보류(?:입니다)?|불명(?:입니다)?|미확인(?:입니다)?|판단불가|판별불가|불가능(?:합니다)?|어렵습니다|수\s*없습니다|안\s*(?:됩니다|됨)|되지\s*않았습니다|할\s*수\s*없습니다|근거가\s*(?:부족합니다|없습니다|불충분합니다))$/;
  const english =
    /^(?:(?:email|message)\s+)?(?:importance|priority)(?:\s+(?:is|cannot be|could not be|was not))?\s*(?:unknown|uncertain|undetermined|not determined|determined|assessed|unavailable)(?:\s+(?:from|with|due to)\s+(?:the\s+)?(?:available|insufficient|limited)\s+(?:information|preview|content))?$/i;
  const limitation =
    /^(?:(?:메일|이메일)\s*)?(?:본문|내용|정보|근거)(?:이|가|은|는)?\s*(?:부족합니다|없습니다|확인되지 않았습니다|제공되지 않았습니다)$/;
  return (
    sentences.some((s) => priority.test(s) || english.test(s)) &&
    sentences.every((s) => priority.test(s) || english.test(s) || limitation.test(s))
  );
}
export function latestSummaryItems<
  T extends {
    id: string;
    kind?: string | undefined;
    readScope: string;
    provenance?: { summarizedAt?: string | null | undefined } | undefined;
  },
>(history: readonly { createdAt: string; items: readonly T[] }[]): T[] {
  const map = new Map<string, { item: T; at: number }>();
  for (const h of history)
    for (const item of h.items) {
      const key = `${item.kind ?? (item.readScope.startsWith('mail') ? 'email' : 'papers')}:${item.id}`;
      const at = Date.parse(item.provenance?.summarizedAt ?? '') || Date.parse(h.createdAt) || 0;
      if (!map.has(key) || at > map.get(key)!.at) map.set(key, { item, at });
    }
  return [...map.values()].map((v) => v.item);
}
