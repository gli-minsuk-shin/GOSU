import { z } from 'zod';
import { IsoDateTimeSchema } from './common.js';

export const AGENT_PERMANENT_MEMORY_MAX_ENTRIES_PER_SCOPE = 1_000;
export const AGENT_PERMANENT_MEMORY_MAX_RETRIEVED = 12;
export const AGENT_PERMANENT_MEMORY_MAX_RETRIEVED_CHARACTERS = 12_000;
export const AGENT_PERMANENT_MEMORY_MAX_REQUEST_CHARACTERS = 400;
export const AGENT_PERMANENT_MEMORY_MAX_OUTCOME_CHARACTERS = 1_200;
export const AGENT_PERMANENT_MEMORY_MAX_KEYWORDS = 16;
export const AGENT_CONTEXT_FALLBACK_WINDOW_TOKENS = 32_000;

export const AgentContextBudgetSchema = z
  .object({
    schemaVersion: z.literal(1),
    contextWindowTokens: z.number().int().positive().max(2_000_000),
    contextWindowSource: z.enum(['provider', 'configured', 'fallback']),
    outputReserveTokens: z.number().int().nonnegative(),
    safetyMarginTokens: z.number().int().nonnegative(),
    runtimeReserveTokens: z.number().int().nonnegative(),
    availableInputTokens: z.number().int().positive(),
    recentHistoryBudgetTokens: z.number().int().nonnegative(),
    permanentMemoryBudgetTokens: z.number().int().nonnegative(),
    sourceEvidenceBudgetTokens: z.number().int().nonnegative(),
  })
  .strict();

export type AgentContextBudget = z.infer<typeof AgentContextBudgetSchema>;

export function planAgentContextBudget(
  input: Readonly<{
    contextWindowTokens?: number;
    contextWindowSource?: 'provider' | 'configured' | 'fallback';
    outputReserveTokens?: number;
  }> = {},
): AgentContextBudget {
  const suppliedWindow = input.contextWindowTokens;
  const contextWindowTokens = Math.max(
    1,
    Math.min(suppliedWindow ?? AGENT_CONTEXT_FALLBACK_WINDOW_TOKENS, 2_000_000),
  );
  const outputReserveTokens = Math.max(
    0,
    Math.min(
      input.outputReserveTokens ?? Math.max(512, Math.ceil(contextWindowTokens * 0.08)),
      64_000,
      Math.floor(contextWindowTokens / 3),
    ),
  );
  const safetyMarginTokens = Math.floor(contextWindowTokens * 0.05);
  const runtimeReserveTokens = Math.max(
    0,
    Math.min(
      48_000,
      Math.max(8_000, Math.ceil(contextWindowTokens * 0.08)),
      Math.floor(contextWindowTokens * 0.2),
    ),
  );
  const availableInputTokens = Math.max(
    1,
    contextWindowTokens - outputReserveTokens - safetyMarginTokens - runtimeReserveTokens,
  );
  const permanentMemoryBudgetTokens = Math.min(
    12_000,
    availableInputTokens,
    Math.max(128, Math.floor(availableInputTokens * 0.08)),
  );
  const recentHistoryBudgetTokens = Math.min(
    800_000,
    Math.max(0, availableInputTokens - permanentMemoryBudgetTokens),
    Math.max(256, Math.floor(availableInputTokens * 0.42)),
  );
  const sourceEvidenceBudgetTokens = Math.max(
    0,
    availableInputTokens - permanentMemoryBudgetTokens - recentHistoryBudgetTokens,
  );
  return AgentContextBudgetSchema.parse({
    schemaVersion: 1,
    contextWindowTokens,
    contextWindowSource:
      input.contextWindowSource ?? (suppliedWindow === undefined ? 'fallback' : 'provider'),
    outputReserveTokens,
    safetyMarginTokens,
    runtimeReserveTokens,
    availableInputTokens,
    recentHistoryBudgetTokens,
    permanentMemoryBudgetTokens,
    sourceEvidenceBudgetTokens,
  });
}

export const AgentPermanentMemoryEntrySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().trim().min(1).max(128),
    scopeType: z.enum(['project', 'model']),
    scopeId: z.string().trim().min(1).max(160),
    kind: z.enum(['decision', 'constraint', 'preference', 'finding', 'workflow']),
    userRequest: z.string().trim().min(1).max(AGENT_PERMANENT_MEMORY_MAX_REQUEST_CHARACTERS),
    outcome: z.string().trim().min(1).max(AGENT_PERMANENT_MEMORY_MAX_OUTCOME_CHARACTERS),
    keywords: z.array(z.string().trim().min(2).max(64)).max(AGENT_PERMANENT_MEMORY_MAX_KEYWORDS),
    importance: z.number().int().min(0).max(100),
    sourceId: z.string().trim().min(1).max(160),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export type AgentPermanentMemoryEntry = z.infer<typeof AgentPermanentMemoryEntrySchema>;

const IMPORTANT_PATTERNS = [
  /\b(?:remember|decision|decided|prefer|preference|selected|chosen|adopted|important|from now on|permanent memory)\b/iu,
  /(?:기억|명심|결정|선택했|채택했|규칙|선호|원해|중요|앞으로|영구\s*메모리)/u,
  /^\s*(?:always|never|must|required)\s+[\p{L}\p{N}_-]+/iu,
  /^\s*(?:항상|절대|반드시|필수)\s*/u,
];

const EXPLICIT_REMEMBER_PATTERNS = [
  /\b(?:please\s+)?remember\s+(?:this|that|my|the|to)\b/iu,
  /\b(?:save|store)\s+(?:this|that)\s+(?:in|to)\s+(?:permanent\s+)?memory\b/iu,
  /(?:기억해|기억해\s*줘|기억하세요|영구\s*메모리에|메모리에\s*(?:저장|넣어))/u,
];

const NEGATED_MEMORY_PATTERNS = [
  /^\s*never\s+mind[.!]?\s*$/iu,
  /\b(?:do\s+not|don['’]t|never)(?:\s+(?:ever|again|please)){0,2}\s+(?:remember|save|store)\b/iu,
  /\bforget\s+(?:this|that|the\s+previous|everything)\b/iu,
  /(?:기억하지\s*마|기억하지\s*말|저장하지\s*마|저장하지\s*말|잊어\s*줘|메모리에서\s*(?:지워|삭제))/u,
];

const CONSTRAINT_PATTERNS = [
  /\b(?:must|required|constraint|rule|never|always)\b/iu,
  /(?:반드시|필수|제약|규칙|절대|항상)/u,
];

const PREFERENCE_PATTERNS = [
  /\b(?:prefer|preference|style)\b/iu,
  /(?:선호|스타일|좋겠|원함|원해)/u,
];

const DECISION_PATTERNS = [
  /\b(?:decision|decided|choose|selected|adopt)\b/iu,
  /(?:결정|선택|채택|하기로)/u,
];

const FINDING_PATTERNS = [
  /\b(?:finding|result|conclusion|root cause|verified|evidence)\b/iu,
  /(?:발견|결과|결론|원인|검증|증거)/u,
];

const GLOBAL_MEMORY_PATTERNS = [
  /\b(?:always|never|every|all|from now on|global|standing)\b/iu,
  /(?:항상|절대|모든|매번|앞으로|전역|상시)/u,
];

const SENSITIVE_MEMORY_PATTERNS = [
  /-----BEGIN [^-\n]*PRIVATE KEY-----/iu,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}/iu,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/iu,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/iu,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bAIza[0-9A-Za-z_-]{30,}\b/u,
  /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/u,
  /\bhf_[0-9A-Za-z]{20,}\b/u,
  /\bglpat-[0-9A-Za-z_-]{20,}\b/u,
  /\bwhsec_[0-9A-Za-z]{20,}\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /(?:^|[\s{,"'])(?:[A-Z0-9]+_)*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|TOKEN|PASSWORD|PASSWD|SECRET)["']?\s*[:=]\s*["']?[^\s"',;}]{8,}/imu,
  /https?:\/\/[^\s/:@]+:[^\s/@]+@/iu,
];

const PROMPTWARE_MEMORY_PATTERNS = [
  /\b(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|messages?|prompts?)\b/iu,
  /<(?:system|developer|assistant)>|\[(?:system|developer|assistant)\]/iu,
  /\b(?:system|developer)\s+(?:prompt|message)\b/iu,
  /\b(?:act\s+as|you\s+are\s+now)\s+(?:the\s+)?(?:system|developer|assistant)\b/iu,
  /\b(?:reveal|show|expose|print)\s+(?:the\s+)?(?:hidden|system|developer)\s+(?:instructions?|prompts?|messages?)\b/iu,
  /(?:이전|시스템|개발자).{0,12}(?:지시|명령|프롬프트).{0,8}(?:무시|따라)/u,
];

const STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'and',
  'are',
  'for',
  'from',
  'have',
  'into',
  'model',
  'that',
  'the',
  'this',
  'with',
  '그리고',
  '그런데',
  '대한',
  '에서',
  '으로',
  '이거',
]);

export function agentContextKeywords(...values: readonly string[]) {
  return [
    ...new Set(
      values
        .join(' ')
        .normalize('NFC')
        .toLowerCase()
        .match(/[\p{L}\p{N}_-]{2,64}/gu)
        ?.filter((token) => !STOPWORDS.has(token)) ?? [],
    ),
  ].slice(0, AGENT_PERMANENT_MEMORY_MAX_KEYWORDS);
}

export function redactAgentMemoryText(value: string) {
  return value
    .replace(
      /-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/giu,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}/giu, 'Bearer [REDACTED]')
    .replace(
      /\b(api[_ -]?key|access[_ -]?token|password|passwd|secret)\b\s*[:=]\s*([^\s,;]+)/giu,
      '$1=[REDACTED]',
    )
    .replace(/(https?:\/\/[^\s/:@]+:)[^\s/@]+@/giu, '$1[REDACTED]@');
}

export function agentMemoryKind(text: string): AgentPermanentMemoryEntry['kind'] {
  if (CONSTRAINT_PATTERNS.some((pattern) => pattern.test(text))) return 'constraint';
  if (PREFERENCE_PATTERNS.some((pattern) => pattern.test(text))) return 'preference';
  if (DECISION_PATTERNS.some((pattern) => pattern.test(text))) return 'decision';
  if (FINDING_PATTERNS.some((pattern) => pattern.test(text))) return 'finding';
  return 'workflow';
}

export function agentMemoryImportance(userRequest: string, outcome: string) {
  let importance = 20;
  const explicitRemember = EXPLICIT_REMEMBER_PATTERNS.some((pattern) => pattern.test(userRequest));
  const questionLike = /[?？]\s*$/u.test(userRequest.trim());
  if (
    explicitRemember ||
    (!questionLike && IMPORTANT_PATTERNS.some((pattern) => pattern.test(userRequest)))
  ) {
    importance += 50;
  }
  if (CONSTRAINT_PATTERNS.some((pattern) => pattern.test(userRequest))) importance += 15;
  if (FINDING_PATTERNS.some((pattern) => pattern.test(userRequest))) importance += 10;
  if (outcome.length >= 300) importance += 5;
  return Math.min(100, importance);
}

export function agentMemoryIsStanding(entry: AgentPermanentMemoryEntry) {
  return (
    entry.kind === 'preference' ||
    GLOBAL_MEMORY_PATTERNS.some((pattern) => pattern.test(entry.userRequest))
  );
}

export function createAgentPermanentMemoryEntry(input: {
  id: string;
  scopeType: AgentPermanentMemoryEntry['scopeType'];
  scopeId: string;
  sourceId: string;
  userRequest: string;
  outcome: string;
  createdAt: string;
  force?: boolean;
}): AgentPermanentMemoryEntry | null {
  if (NEGATED_MEMORY_PATTERNS.some((pattern) => pattern.test(input.userRequest))) return null;
  if (
    SENSITIVE_MEMORY_PATTERNS.some(
      (pattern) => pattern.test(input.userRequest) || pattern.test(input.outcome),
    )
  ) {
    return null;
  }
  if (
    PROMPTWARE_MEMORY_PATTERNS.some(
      (pattern) => pattern.test(input.userRequest) || pattern.test(input.outcome),
    )
  ) {
    return null;
  }
  const userRequest = redactAgentMemoryText(input.userRequest)
    .trim()
    .slice(0, AGENT_PERMANENT_MEMORY_MAX_REQUEST_CHARACTERS);
  const outcome = redactAgentMemoryText(input.outcome)
    .trim()
    .slice(0, AGENT_PERMANENT_MEMORY_MAX_OUTCOME_CHARACTERS);
  if (!userRequest || !outcome) return null;
  const importance = input.force ? 100 : agentMemoryImportance(userRequest, outcome);
  if (!input.force && importance < 50) return null;
  return AgentPermanentMemoryEntrySchema.parse({
    schemaVersion: 1,
    id: input.id,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    kind: agentMemoryKind(userRequest),
    userRequest,
    outcome,
    keywords: agentContextKeywords(userRequest, outcome),
    importance,
    sourceId: input.sourceId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function estimateAgentContextTokens(value: string) {
  let ascii = 0;
  let nonAscii = 0;
  for (const character of value) {
    if (character.codePointAt(0)! <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 3 + nonAscii * 2);
}

export function selectAgentPermanentMemories(
  entries: readonly AgentPermanentMemoryEntry[],
  query: string,
  options: Readonly<{ maxEntries?: number; maxCharacters?: number; maxTokens?: number }> = {},
) {
  const maxEntries = Math.max(
    0,
    Math.min(options.maxEntries ?? AGENT_PERMANENT_MEMORY_MAX_RETRIEVED, 64),
  );
  const maxCharacters = Math.max(
    0,
    Math.min(options.maxCharacters ?? AGENT_PERMANENT_MEMORY_MAX_RETRIEVED_CHARACTERS, 64_000),
  );
  const queryKeywords = new Set(agentContextKeywords(query));
  const ranked = entries
    .map((entry) => {
      const overlap = entry.keywords.filter((keyword) => queryKeywords.has(keyword)).length;
      return {
        entry,
        overlap,
        score: entry.importance * 10 + overlap * 100,
      };
    })
    .filter(({ entry, overlap }) => overlap > 0 || agentMemoryIsStanding(entry))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.entry.updatedAt.localeCompare(left.entry.updatedAt) ||
        left.entry.id.localeCompare(right.entry.id),
    );
  const selected: AgentPermanentMemoryEntry[] = [];
  let characters = 0;
  let estimatedTokens = 0;
  for (const { entry } of ranked) {
    if (selected.length >= maxEntries) break;
    const entryCharacters = JSON.stringify(entry).length;
    const entryTokens = estimateAgentContextTokens(JSON.stringify(entry));
    if (characters + entryCharacters > maxCharacters) continue;
    if (estimatedTokens + entryTokens > (options.maxTokens ?? Number.POSITIVE_INFINITY)) continue;
    selected.push(entry);
    characters += entryCharacters;
    estimatedTokens += entryTokens;
  }
  return {
    entries: selected,
    candidateCount: entries.length,
    omittedCount: Math.max(0, entries.length - selected.length),
    serializedCharacters: characters,
    estimatedTokens,
  } as const;
}
