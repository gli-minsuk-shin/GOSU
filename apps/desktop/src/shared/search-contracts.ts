import { z } from 'zod';

export const SEARCH_CATEGORIES = Object.freeze([
  'project-chat',
  'research-notes',
  'experiments',
  'goal-metrics',
  'board',
  'literature',
  'repository',
] as const);

export const SearchCategorySchema = z.enum(SEARCH_CATEGORIES);
export type SearchCategory = z.infer<typeof SearchCategorySchema>;

export const SearchScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('project'), projectId: z.string().uuid() }).strict(),
]);

export type SearchScope = z.infer<typeof SearchScopeSchema>;

export const SearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(256),
    scope: SearchScopeSchema,
    categories: z.array(SearchCategorySchema).max(SEARCH_CATEGORIES.length).optional(),
    limitPerCategory: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export type SearchInput = z.input<typeof SearchInputSchema>;

const RelativeSearchPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
    'path_must_be_project_relative',
  );

const SearchTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('project-chat'),
      sessionId: z.string().uuid(),
      messageId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('research-note'),
      path: RelativeSearchPathSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('experiment'),
      ideaId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('objective'),
      objectiveId: z.string().uuid(),
      objectiveVersion: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal('board-task'), taskId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('literature'), recordId: z.string().uuid() }).strict(),
  z
    .object({
      kind: z.literal('repository-file'),
      path: RelativeSearchPathSchema,
    })
    .strict(),
]);

export type SearchTarget = z.infer<typeof SearchTargetSchema>;

export const SearchHitSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    category: SearchCategorySchema,
    projectId: z.string().uuid(),
    projectName: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(512),
    snippet: z.string().max(1_200),
    updatedAt: z.string().datetime({ offset: true }).nullable(),
    matchedFields: z.array(z.string().trim().min(1).max(64)).max(12),
    target: SearchTargetSchema,
  })
  .strict();

export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchGroupSchema = z
  .object({
    category: SearchCategorySchema,
    items: z.array(SearchHitSchema).max(50),
    truncated: z.boolean(),
    incomplete: z.boolean().default(false),
    unavailableReason: z.string().trim().min(1).max(240).nullable(),
  })
  .strict();

export type SearchGroup = z.infer<typeof SearchGroupSchema>;

export const SearchResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    query: z.string().trim().min(1).max(256),
    scope: SearchScopeSchema,
    groups: z.array(SearchGroupSchema).max(SEARCH_CATEGORIES.length),
    searchedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const SEARCH_IPC_ERROR_CODES = [
  'invalid_search_input',
  'search_project_not_found',
  'search_unavailable',
] as const;

export type SearchIpcErrorCode = (typeof SEARCH_IPC_ERROR_CODES)[number];
