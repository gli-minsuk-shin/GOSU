import { z } from 'zod';

/**
 * Remaining subscription limits of the connected CLIs (Codex, Claude Code): what `/status` and
 * `/usage` show in those tools. GOSU asks the CLI itself; it never reads a login or a token.
 */
export const USAGE_LIMIT_IPC_CHANNELS = {
  status: 'gosu:usage-limits:status',
  refresh: 'gosu:usage-limits:refresh',
  configure: 'gosu:usage-limits:configure',
  changed: 'gosu:usage-limits:changed',
} as const;

export const USAGE_LIMIT_REFRESH_SECONDS = [10, 30, 60, 300, 600, 1800] as const;
export type UsageLimitRefreshSeconds = (typeof USAGE_LIMIT_REFRESH_SECONDS)[number];
export const DEFAULT_USAGE_LIMIT_REFRESH_SECONDS: UsageLimitRefreshSeconds = 600;

export const UsageLimitSettingsSchema = z
  .object({
    version: z.literal(1),
    refreshSeconds: z
      .number()
      .refine((value): value is UsageLimitRefreshSeconds =>
        (USAGE_LIMIT_REFRESH_SECONDS as readonly number[]).includes(value),
      ),
    showInTitleBar: z.boolean(),
  })
  .strict();
export type UsageLimitSettings = z.infer<typeof UsageLimitSettingsSchema>;
export const defaultUsageLimitSettings = (): UsageLimitSettings => ({
  version: 1,
  refreshSeconds: DEFAULT_USAGE_LIMIT_REFRESH_SECONDS,
  showInTitleBar: true,
});

export const UsageLimitWindowSchema = z
  .object({
    /** `session` is the short window (5 hours today), `weekly` the 7-day one. */
    kind: z.enum(['session', 'weekly', 'weekly-model', 'other']),
    /** Model or limit name of a scoped window, for example "Fable". */
    label: z.string().max(120).nullable(),
    usedPercent: z.number().min(0).max(100),
    windowMinutes: z.number().int().positive().nullable(),
    resetsAt: z.string().datetime().nullable(),
  })
  .strict();
export type UsageLimitWindow = z.infer<typeof UsageLimitWindowSchema>;

export const USAGE_LIMIT_ERRORS = [
  'usage_limits_unavailable',
  'usage_limits_auth',
  'usage_limits_timeout',
  'usage_limits_unsupported',
  'usage_limits_format',
  'usage_limits_failed',
] as const;
export type UsageLimitError = (typeof USAGE_LIMIT_ERRORS)[number];

export const ProviderUsageLimitsSchema = z
  .object({
    providerId: z.enum(['codex', 'claude-code']),
    /** False hides the provider from the title bar: not logged in, not connected in GOSU. */
    connected: z.boolean(),
    plan: z.string().max(64).nullable(),
    windows: z.array(UsageLimitWindowSchema).max(12),
    /** Credits (Codex) or extra usage (Claude): whether work continues past the plan limits. */
    extraUsage: z.boolean().nullable(),
    fetchedAt: z.string().datetime().nullable(),
    /** A stable code, never provider text. The last good windows stay while this is set. */
    error: z.enum(USAGE_LIMIT_ERRORS).nullable(),
  })
  .strict();
export type ProviderUsageLimits = z.infer<typeof ProviderUsageLimitsSchema>;

export const UsageLimitStatusSchema = z
  .object({
    settings: UsageLimitSettingsSchema,
    providers: z.array(ProviderUsageLimitsSchema).max(2),
    refreshing: z.boolean(),
    /** The saved settings could not be read, so the defaults are in use until they are saved again. */
    settingsError: z.literal('usage_limit_settings_unreadable').nullable(),
  })
  .strict();
export type UsageLimitStatus = z.infer<typeof UsageLimitStatusSchema>;

export type ParsedUsageLimits = Pick<ProviderUsageLimits, 'plan' | 'windows' | 'extraUsage'>;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const percent = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/** Unix seconds (Codex) or an ISO string (Claude) to ISO; anything else is "unknown". */
function instant(value: unknown): string | null {
  const date =
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? new Date(value * 1000)
      : typeof value === 'string' && value
        ? new Date(value)
        : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

/** The plan decides which windows exist, so the length of a window names it, not its position. */
function kindOf(minutes: number | null): UsageLimitWindow['kind'] {
  if (minutes === null) return 'other';
  if (minutes <= 24 * 60) return 'session';
  return minutes >= 6 * 24 * 60 && minutes <= 8 * 24 * 60 ? 'weekly' : 'other';
}

function codexWindow(value: unknown, label: string | null): UsageLimitWindow | null {
  const source = record(value);
  const used = percent(source?.usedPercent);
  if (!source || used === null) return null;
  const minutes =
    typeof source.windowDurationMins === 'number' && source.windowDurationMins > 0
      ? Math.round(source.windowDurationMins)
      : null;
  const kind = kindOf(minutes);
  return {
    kind: label && kind === 'weekly' ? 'weekly-model' : kind,
    label,
    usedPercent: used,
    windowMinutes: minutes,
    resetsAt: instant(source.resetsAt),
  };
}

/**
 * `account/rateLimits/read` of the Codex app-server. Observed on 2026-09-21 (CLI 0.153.4, Pro): only
 * `primary`, and it was the weekly window (10,080 minutes); `secondary` was null.
 */
export function parseCodexRateLimits(raw: unknown): ParsedUsageLimits | null {
  const snapshot = record(record(raw)?.rateLimits);
  if (!snapshot) return null;
  const windows: UsageLimitWindow[] = [];
  for (const key of ['primary', 'secondary']) {
    const window = codexWindow(snapshot[key], null);
    if (window) windows.push(window);
  }
  const mainId = text(snapshot.limitId, 120);
  for (const [id, value] of Object.entries(record(record(raw)?.rateLimitsByLimitId) ?? {})) {
    if (id === mainId || windows.length >= 12) continue;
    const other = record(value);
    const label = text(other?.limitName, 120) ?? id.slice(0, 120);
    for (const key of ['primary', 'secondary']) {
      const window = codexWindow(other?.[key], label);
      if (window && windows.length < 12) windows.push(window);
    }
  }
  const credits = record(snapshot.credits);
  return {
    plan: text(snapshot.planType, 64),
    windows,
    extraUsage: credits ? credits.hasCredits === true || credits.unlimited === true : null,
  };
}

function claudeWindow(
  value: unknown,
  kind: UsageLimitWindow['kind'],
  label: string | null,
  minutes: number | null,
): UsageLimitWindow | null {
  const source = record(value);
  const used = percent(source?.utilization);
  if (!source || used === null) return null;
  return {
    kind,
    label,
    usedPercent: used,
    windowMinutes: minutes,
    resetsAt: instant(source.resets_at),
  };
}

/**
 * The `get_usage` control response of the Claude Code CLI: the data behind its `/usage` screen,
 * answered without a model request. Observed on 2026-09-21 (CLI 2.1.272, Max): `utilization` is a
 * percentage, `resets_at` an ISO time, and `model_scoped` holds the per-model weekly limits.
 */
export function parseClaudeUsage(raw: unknown): ParsedUsageLimits | null {
  const source = record(raw);
  const limits = record(source?.rate_limits);
  if (!source || (!limits && source.rate_limits_available !== false)) return null;
  const windows: UsageLimitWindow[] = [];
  const session = claudeWindow(limits?.five_hour, 'session', null, 300);
  if (session) windows.push(session);
  const weekly = claudeWindow(limits?.seven_day, 'weekly', null, 10_080);
  if (weekly) windows.push(weekly);
  const scoped = Array.isArray(limits?.model_scoped) ? limits.model_scoped : [];
  for (const entry of scoped) {
    const window = claudeWindow(
      entry,
      'weekly-model',
      text(record(entry)?.display_name, 120),
      10_080,
    );
    if (window?.label && windows.length < 12) windows.push(window);
  }
  if (!scoped.length)
    for (const [key, label] of [
      ['seven_day_opus', 'Opus'],
      ['seven_day_sonnet', 'Sonnet'],
    ] as const) {
      const window = claudeWindow(limits?.[key], 'weekly-model', label, 10_080);
      if (window) windows.push(window);
    }
  const extra = record(limits?.extra_usage);
  return {
    plan: text(source.subscription_type, 64),
    windows,
    extraUsage: extra ? extra.is_enabled === true : null,
  };
}

export const remainingPercent = (window: Pick<UsageLimitWindow, 'usedPercent'>) =>
  Math.max(0, Math.round((100 - window.usedPercent) * 10) / 10);

/** The window the title bar shows: the weekly one, or the only one the plan reports. */
export function headlineWindow(provider: ProviderUsageLimits): UsageLimitWindow | null {
  return (
    provider.windows.find((w) => w.kind === 'weekly') ??
    provider.windows.find((w) => w.kind === 'session') ??
    provider.windows[0] ??
    null
  );
}
