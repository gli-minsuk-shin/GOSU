import { estimateAgentContextTokens } from '@gosu/contracts';
/** Deliberately narrow: short approvals/follow-ups and factual status queries are NOT greetings. */
export function isMinimalConversationRequest(query: string) {
  const text = query
    .normalize('NFKC')
    .trim()
    .replace(/[.!?~。？！]+$/gu, '')
    .trim()
    .toLowerCase();
  return /^(안녕(?:하세요)?|하이|고마워(?:요)?|감사합니다|살아있(?:나|니|어|냐)|hello|hi|hey|thanks|thank you|are you there)$/u.test(
    text,
  );
}
export function selectRequestContext(
  messages: readonly { role: 'user' | 'assistant'; text: string }[],
  query: string,
  budget = 32000,
) {
  if (isMinimalConversationRequest(query))
    return { indices: [] as number[], mode: 'minimal' as const };
  if (
    /전체\s*(?:대화|이력|기록)|모든\s*(?:대화|기록)|full\s+(?:history|conversation)|entire\s+conversation/iu.test(
      query,
    )
  )
    return { indices: messages.map((_, i) => i), mode: 'full' as const };
  const sizes = messages.map((m) =>
    estimateAgentContextTokens(JSON.stringify({ role: m.role, text: m.text })),
  );
  if (sizes.reduce((a, b) => a + b, 0) <= budget)
    return { indices: messages.map((_, i) => i), mode: 'full' as const };
  // Select complete user-led turns, never split a question from its response.
  const groups: { indices: number[]; size: number; score: number }[] = [];
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])].slice(0, 40);
  for (let i = 0; i < messages.length; i++) {
    if (!groups.length || messages[i]!.role === 'user')
      groups.push({ indices: [], size: 0, score: 0 });
    const group = groups[groups.length - 1]!;
    group.indices.push(i);
    group.size += sizes[i]!;
    group.score += terms.filter((t) => messages[i]!.text.toLowerCase().includes(t)).length;
  }
  const selected = new Set<number>();
  let remaining = budget;
  if ((groups.at(-1)?.size ?? 0) > budget)
    return { indices: messages.map((_, i) => i), mode: 'full' as const };
  const take = (index: number) => {
    const group = groups[index]!;
    if (group.size > remaining) return false;
    selected.add(index);
    remaining -= group.size;
    return true;
  };
  for (let i = groups.length - 1; i >= 0 && remaining > budget * 0.6; i--) {
    if (!take(i)) break;
  }
  for (const { index } of groups
    .map((g, index) => ({ ...g, index }))
    .filter((g) => g.score > 0 && !selected.has(g.index))
    .sort((a, b) => b.score - a.score || a.index - b.index))
    take(index);
  for (let i = groups.length - 1; i >= 0; i--) if (!selected.has(i)) take(i);
  return {
    indices: [...selected].sort((a, b) => a - b).flatMap((i) => groups[i]!.indices),
    mode: 'focused' as const,
  };
}
