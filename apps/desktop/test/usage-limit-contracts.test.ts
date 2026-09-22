import { describe, expect, it } from 'vitest';
import {
  defaultUsageLimitSettings,
  headlineWindow,
  parseClaudeUsage,
  parseCodexRateLimits,
  remainingPercent,
  UsageLimitSettingsSchema,
  UsageLimitStatusSchema,
  USAGE_LIMIT_REFRESH_SECONDS,
} from '../src/shared/usage-limit-contracts';
import { CLAUDE_USAGE, CODEX_RATE_LIMITS } from './usage-limit-fixtures';

describe('usage limit contracts', () => {
  it('names a Codex window by its length: a Pro plan reports only the weekly window, as primary', () => {
    const parsed = parseCodexRateLimits(CODEX_RATE_LIMITS)!;
    expect(parsed.plan).toBe('pro');
    expect(parsed.extraUsage).toBe(false);
    expect(parsed.windows).toEqual([
      {
        kind: 'weekly',
        label: null,
        usedPercent: 13,
        windowMinutes: 10080,
        resetsAt: new Date(1790556720 * 1000).toISOString(),
      },
    ]);
    expect(remainingPercent(parsed.windows[0]!)).toBe(87);
    // Plans with both windows: the 5-hour one is a session whichever slot it arrives in.
    const both = parseCodexRateLimits({
      rateLimits: {
        primary: { usedPercent: 40.26, windowDurationMins: 300, resetsAt: 1790000400 },
        secondary: { usedPercent: 120, windowDurationMins: 10080, resetsAt: null },
        credits: { hasCredits: true, unlimited: false },
        planType: 'plus',
      },
      rateLimitsByLimitId: {
        other: { limitName: 'Spark', primary: { usedPercent: 5, windowDurationMins: 10080 } },
      },
    })!;
    expect(both.windows.map((w) => [w.kind, w.label, w.usedPercent, w.resetsAt])).toEqual([
      ['session', null, 40.26, new Date(1790000400 * 1000).toISOString()],
      ['weekly', null, 100, null],
      ['weekly-model', 'Spark', 5, null],
    ]);
    expect(both.extraUsage).toBe(true);
    expect(remainingPercent(both.windows[0]!)).toBe(59.7);
    for (const bad of [null, 'text', {}, { rateLimits: 5 }])
      expect(parseCodexRateLimits(bad)).toBeNull();
  });

  it('reads both Claude windows, their reset times and the per-model weekly limit', () => {
    const parsed = parseClaudeUsage(CLAUDE_USAGE)!;
    expect(parsed.plan).toBe('max');
    expect(parsed.extraUsage).toBe(false);
    expect(parsed.windows.map((w) => [w.kind, w.label, w.usedPercent, w.windowMinutes])).toEqual([
      ['session', null, 31, 300],
      ['weekly', null, 32, 10080],
      ['weekly-model', 'Fable', 47, 10080],
    ]);
    expect(parsed.windows[0]!.resetsAt).toBe('2026-09-21T14:20:00.395Z');
    // Older shape without `model_scoped`: the named weekly keys are used instead.
    const older = parseClaudeUsage({
      subscription_type: 'pro',
      rate_limits: {
        five_hour: { utilization: 5, resets_at: null },
        seven_day_opus: { utilization: 90, resets_at: 'not a date' },
      },
    })!;
    expect(older.windows.map((w) => [w.kind, w.label, w.resetsAt])).toEqual([
      ['session', null, null],
      ['weekly-model', 'Opus', null],
    ]);
    // An API-key login has no plan limits: that is an empty answer, not a format error.
    expect(parseClaudeUsage({ rate_limits_available: false, subscription_type: null })).toEqual({
      plan: null,
      windows: [],
      extraUsage: null,
    });
    for (const bad of [null, [], { subscription_type: 'max' }])
      expect(parseClaudeUsage(bad)).toBeNull();
  });

  it('shows the weekly window in the title bar, or the only window a plan reports', () => {
    const provider = (windows: ReturnType<typeof parseClaudeUsage>) => ({
      providerId: 'claude-code' as const,
      connected: true,
      plan: null,
      windows: windows!.windows,
      extraUsage: null,
      fetchedAt: null,
      error: null,
    });
    expect(headlineWindow(provider(parseClaudeUsage(CLAUDE_USAGE)))!.kind).toBe('weekly');
    expect(
      headlineWindow(
        provider(parseClaudeUsage({ rate_limits: { five_hour: { utilization: 1 } } })),
      )!.kind,
    ).toBe('session');
    expect(headlineWindow(provider({ plan: null, windows: [], extraUsage: null }))).toBeNull();
  });

  it('accepts only the offered refresh intervals and a complete status', () => {
    expect(USAGE_LIMIT_REFRESH_SECONDS).toEqual([10, 30, 60, 300, 600, 1800]);
    expect(defaultUsageLimitSettings()).toEqual({
      version: 1,
      refreshSeconds: 600,
      showInTitleBar: true,
    });
    for (const refreshSeconds of USAGE_LIMIT_REFRESH_SECONDS)
      expect(
        UsageLimitSettingsSchema.safeParse({ version: 1, refreshSeconds, showInTitleBar: false })
          .success,
      ).toBe(true);
    for (const refreshSeconds of [0, 1, 5, 45, 3600, '60'])
      expect(
        UsageLimitSettingsSchema.safeParse({ version: 1, refreshSeconds, showInTitleBar: true })
          .success,
      ).toBe(false);
    expect(
      UsageLimitStatusSchema.safeParse({
        settings: defaultUsageLimitSettings(),
        providers: [],
        refreshing: false,
        settingsError: null,
        command: 'rm -rf',
      }).success,
    ).toBe(false);
  });
});
