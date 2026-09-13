import { z } from 'zod';
import { LiveSettingsSchema, MAIL_LIMIT_ERROR } from './live-settings.js';
import type { BriefingRoutine, BriefingWorkspace } from './types.js';

const id = z.string().trim().min(1).max(128);
const text = z.string().trim().min(1);
const unique = (values: readonly string[]) => new Set(values).size === values.length;
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function isTimeZone(value: string): boolean {
  try {
    if (/^[+-]/u.test(value)) return false;
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}
export function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/u, '');
    const credentialParameter =
      /^(?:token|api[_-]?key|key|password|authorization|access[_-]?token|code)$/iu;
    if (
      [...url.searchParams.keys()].some((name) => credentialParameter.test(name.normalize('NFKC')))
    )
      return false;
    const fragment = decodeURIComponent(url.hash);
    if (
      /(?:^|[?&#])(?:token|api[_-]?key|key|password|authorization|access[_-]?token|code)=/iu.test(
        fragment,
      )
    )
      return false;
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      host.includes('.') &&
      !host.includes(':') &&
      !/^\d+(?:\.\d+){3}$/u.test(host) &&
      !['localhost', 'local', 'internal', 'test', 'invalid'].some(
        (suffix) => host === suffix || host.endsWith(`.${suffix}`),
      )
    );
  } catch {
    return false;
  }
}
const iso = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), 'Use a valid ISO instant');
export const isInstant = (value: unknown): value is string =>
  iso.safeParse(value).success && typeof value === 'string' && Number.isFinite(Date.parse(value));
const date = z.string().refine(isCalendarDate, 'Use a real YYYY-MM-DD date');
const url = z
  .string()
  .max(2048)
  .refine(isPublicHttpsUrl, 'Use a public HTTPS URL without credentials');
const sourceKind = z.enum([
  'email',
  'calendar',
  'todo',
  'papers',
  'weather',
  'ai-news',
  'news',
  'conference',
  'funding',
]);
export const BriefingScheduleSchema = z
  .object({
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    interval: z.number().int().min(1).max(99),
    anchorDate: date,
    timeZone: text.max(100).refine(isTimeZone, 'Use an IANA timezone'),
    times: z
      .array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u))
      .min(1)
      .max(24)
      .refine(unique, 'Delivery times must be unique'),
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .refine((days) => new Set(days).size === days.length, 'Weekdays must be unique'),
    monthDay: z.number().int().min(1).max(31),
  })
  .strict()
  .refine(
    (schedule) => schedule.frequency !== 'weekly' || schedule.weekdays.length > 0,
    'Choose at least one weekday',
  );

export const InterestProfileSchema = z
  .object({
    keywords: z
      .array(
        z
          .object({
            term: text.max(120),
            weight: z.number().int().min(1).max(5),
            synonyms: z.array(text.max(120)).max(12).refine(unique),
          })
          .strict(),
      )
      .max(40)
      .refine(
        (keywords) => unique(keywords.map(({ term }) => term.normalize('NFKC').toLowerCase())),
        'Keywords must be distinct',
      ),
    excluded: z.array(text.max(120)).max(40).refine(unique),
  })
  .strict();
export const BriefingSourceSchema = z
  .object({
    id,
    kind: sourceKind,
    label: text.max(240),
    url: url.optional(),
    country: text.max(80).optional(),
    origin: z.enum(['fixture', 'user']),
  })
  .strict()
  .transform(({ url, country, ...source }) => ({
    ...source,
    ...(url === undefined ? {} : { url }),
    ...(country === undefined ? {} : { country }),
  }));
export const BriefingRoutineSchema = z
  .object({
    id,
    name: text.max(160),
    suggestedQuestions: z
      .array(text.max(300))
      .max(12)
      .refine(unique, 'Suggested questions must be unique')
      .optional(),
    kind: z.enum(['personal', 'funding']),
    state: z.enum(['draft', 'enabled', 'paused']),
    schedule: BriefingScheduleSchema,
    interest: InterestProfileSchema,
    sources: z
      .array(BriefingSourceSchema)
      .max(40)
      .refine((sources) => unique(sources.map((source) => source.id)), 'Source IDs must be unique'),
    countries: z.array(text.max(80)).max(30).refine(unique),
    live: LiveSettingsSchema.optional(),
    sectionOrder: z
      .array(sourceKind)
      .max(9)
      .refine(unique, 'Section kinds must be unique')
      .optional(),
    createdAt: iso,
    updatedAt: iso,
  })
  .strict()
  .superRefine((routine, context) => {
    if (Date.parse(routine.updatedAt) < Date.parse(routine.createdAt))
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'Updated time precedes creation',
      });
    if (
      routine.sources.some((source) => (source.kind === 'funding') !== (routine.kind === 'funding'))
    )
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'Keep funding and personal sources in separate routines',
      });
  });
export const BriefingEvidenceSchema = z
  .object({
    id,
    sourceId: id,
    kind: sourceKind,
    title: text.max(500),
    abstract: z.string().max(30_000),
    summary: z.string().max(12_000),
    publishedAt: iso,
    deadline: z.union([date, iso]).optional(),
    url: url.optional(),
    country: text.max(80).optional(),
    readScope: z.literal('fixture'),
  })
  .strict()
  .transform(({ deadline, url, country, ...evidence }) => ({
    ...evidence,
    ...(deadline === undefined ? {} : { deadline }),
    ...(url === undefined ? {} : { url }),
    ...(country === undefined ? {} : { country }),
  }));
const ranked = z
  .object({
    evidence: BriefingEvidenceSchema,
    score: z.number().int().min(0).max(800),
    matchedKeywords: z.array(text.max(120)).max(40).refine(unique),
  })
  .strict();
const BriefingRunSchema = z
  .object({
    id,
    routineId: id,
    routineName: text.max(160),
    scheduledFor: iso,
    completedAt: iso,
    mode: z.literal('fixture'),
    status: z.enum(['ready', 'partial', 'failed']),
    items: z.array(ranked).max(1000),
    hiddenItemIds: z.array(id).max(1000).refine(unique),
    sourceResults: z
      .array(
        z
          .object({
            sourceId: id,
            label: text.max(240),
            status: z.enum(['ready', 'unsupported']),
            count: z.number().int().min(0).max(10_000),
          })
          .strict(),
      )
      .max(40),
    progress: z
      .array(
        z
          .object({
            stage: z.enum(['collect', 'deduplicate', 'rank', 'deliver']),
            count: z.number().int().min(0).max(10_000),
          })
          .strict(),
      )
      .length(4),
    scheduleSnapshot: BriefingScheduleSchema,
    interestSnapshot: InterestProfileSchema,
    sectionOrderSnapshot: z.array(sourceKind).max(9).refine(unique).optional(),
  })
  .strict()
  .superRefine((run, context) => {
    const fail = (message: string) => context.addIssue({ code: 'custom', message });
    if (!unique(run.items.map(({ evidence }) => evidence.id))) fail('Run item IDs must be unique');
    if (!unique(run.sourceResults.map(({ sourceId }) => sourceId)))
      fail('Run sources must be unique');
    if (
      run.hiddenItemIds.some((itemId) => !run.items.some(({ evidence }) => evidence.id === itemId))
    )
      fail('Hidden items must belong to this run');
    if (
      run.items.some(
        ({ evidence }) =>
          !run.sourceResults.some(
            (source) => source.sourceId === evidence.sourceId && source.status === 'ready',
          ) ||
          (evidence.kind === 'todo' && !evidence.deadline),
      )
    )
      fail('Run items require an available source and explicit task deadlines');
    const stages = ['collect', 'deduplicate', 'rank', 'deliver'];
    if (run.progress.some((entry, index) => entry.stage !== stages[index]))
      fail('Run progress order is invalid');
    if (
      run.progress[0]!.count < run.progress[1]!.count ||
      run.progress[1]!.count < run.progress[2]!.count ||
      run.progress[2]!.count !== run.items.length ||
      run.progress[3]!.count !== run.items.length
    )
      fail('Run progress counts disagree with items');
    if (run.sourceResults.some((source) => source.status === 'unsupported' && source.count !== 0))
      fail('Unsupported sources cannot have collected items');
    const ready = run.sourceResults.filter((source) => source.status === 'ready').length;
    const expected =
      ready === 0 ? 'failed' : ready === run.sourceResults.length ? 'ready' : 'partial';
    if (run.status !== expected) fail('Run status disagrees with source outcomes');
  });
const BriefingWorkspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    routines: z.array(BriefingRoutineSchema).max(100),
    runs: z.array(BriefingRunSchema).max(500),
    selectedRoutineId: z.string().max(128),
  })
  .strict()
  .superRefine((workspace, context) => {
    if (
      !unique(workspace.routines.map(({ id: routineId }) => routineId)) ||
      !unique(workspace.runs.map(({ id: runId }) => runId))
    )
      context.addIssue({ code: 'custom', message: 'Routine and run IDs must be unique' });
    if (
      workspace.routines.length === 0
        ? workspace.selectedRoutineId !== ''
        : !workspace.routines.some(({ id: routineId }) => routineId === workspace.selectedRoutineId)
    )
      context.addIssue({
        code: 'custom',
        path: ['selectedRoutineId'],
        message: 'Select an existing routine',
      });
  });

export function validateRoutine(routine: BriefingRoutine): string[] {
  const parsed = BriefingRoutineSchema.safeParse(routine);
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) =>
        issue.path.join('.') === 'live.mail.limit'
          ? MAIL_LIMIT_ERROR
          : `${issue.path.join('.') || 'routine'}: ${issue.message}`,
      );
}
export function parseBriefingWorkspace(value: unknown): BriefingWorkspace | null {
  try {
    const result = BriefingWorkspaceSchema.safeParse(value);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
