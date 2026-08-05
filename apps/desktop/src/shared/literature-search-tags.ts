import { z } from 'zod';

export const LITERATURE_MAX_SEARCH_TOPIC_TAGS = 12;
export const LITERATURE_MAX_SEARCH_KEYWORD_TAGS = 24;
export const LITERATURE_MAX_ACCUMULATED_TOPIC_TAGS = 100;
export const LITERATURE_MAX_ACCUMULATED_KEYWORD_TAGS = 100;
export const LITERATURE_MAX_SEARCH_TAG_LENGTH = 120;

const searchTagLabelSchema = z.string().trim().min(1).max(LITERATURE_MAX_SEARCH_TAG_LENGTH);

export const LiteratureSearchInputTagsSchema = z
  .object({
    topics: z.array(searchTagLabelSchema).max(LITERATURE_MAX_SEARCH_TOPIC_TAGS).default([]),
    keywords: z.array(searchTagLabelSchema).max(LITERATURE_MAX_SEARCH_KEYWORD_TAGS).default([]),
  })
  .strict();

export const LiteratureSearchTagsSchema = z
  .object({
    topics: z.array(searchTagLabelSchema).max(LITERATURE_MAX_ACCUMULATED_TOPIC_TAGS),
    keywords: z.array(searchTagLabelSchema).max(LITERATURE_MAX_ACCUMULATED_KEYWORD_TAGS),
  })
  .strict();

export type LiteratureSearchInputTags = z.infer<typeof LiteratureSearchInputTagsSchema>;
export type LiteratureSearchTags = z.infer<typeof LiteratureSearchTagsSchema>;
export type LiteratureSearchTagKind = keyof LiteratureSearchTags;

export const EMPTY_LITERATURE_SEARCH_TAGS: LiteratureSearchTags = { topics: [], keywords: [] };

export function normalizeLiteratureSearchTagLabel(value: string) {
  return value.normalize('NFKC').replace(/^#+/u, '').replace(/\s+/gu, ' ').trim();
}

function normalizedTagKey(value: string) {
  return normalizeLiteratureSearchTagLabel(value).toLocaleLowerCase('en-US');
}

function uniqueLabels(values: readonly string[], maximum: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const label = normalizeLiteratureSearchTagLabel(value);
    if (!label || label.length > LITERATURE_MAX_SEARCH_TAG_LENGTH) continue;
    const key = normalizedTagKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(label);
    if (result.length >= maximum) break;
  }
  return result;
}

function boundedQueryTag(query: string) {
  const normalized = normalizeLiteratureSearchTagLabel(query);
  if (normalized.length <= LITERATURE_MAX_SEARCH_TAG_LENGTH) return normalized;
  return `${normalized.slice(0, LITERATURE_MAX_SEARCH_TAG_LENGTH - 1).trimEnd()}…`;
}

export function resolveLiteratureSearchTags(
  query: string,
  input?: Partial<LiteratureSearchInputTags> | null,
): LiteratureSearchInputTags {
  const topics = uniqueLabels(input?.topics ?? [], LITERATURE_MAX_SEARCH_TOPIC_TAGS);
  const keywords = uniqueLabels(input?.keywords ?? [], LITERATURE_MAX_SEARCH_KEYWORD_TAGS);
  if (topics.length === 0 && keywords.length === 0) {
    const fallback = boundedQueryTag(query);
    if (fallback) topics.push(fallback);
  }
  return LiteratureSearchInputTagsSchema.parse({ topics, keywords });
}

export function mergeLiteratureSearchTags(
  ...groups: ReadonlyArray<Partial<LiteratureSearchTags> | null | undefined>
): LiteratureSearchTags {
  return LiteratureSearchTagsSchema.parse({
    topics: uniqueLabels(
      groups.flatMap((group) => group?.topics ?? []),
      LITERATURE_MAX_ACCUMULATED_TOPIC_TAGS,
    ),
    keywords: uniqueLabels(
      groups.flatMap((group) => group?.keywords ?? []),
      LITERATURE_MAX_ACCUMULATED_KEYWORD_TAGS,
    ),
  });
}

export function parseLiteratureSearchTagText(value: string) {
  return uniqueLabels(value.split(/[,;\n]+/u), LITERATURE_MAX_ACCUMULATED_KEYWORD_TAGS);
}

export function literatureSearchTagKey(kind: LiteratureSearchTagKind, label: string) {
  return `${kind}:${normalizedTagKey(label)}`;
}
