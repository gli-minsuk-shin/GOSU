// Real answers of both CLIs, used by the contract, service and UI tests.

/** `account/rateLimits/read`, Codex CLI 0.153.4, Pro plan, 2026-09-21 (account id removed). */
export const CODEX_RATE_LIMITS = {
  rateLimits: {
    limitId: 'codex',
    limitName: null,
    primary: { usedPercent: 13, windowDurationMins: 10080, resetsAt: 1790556720 },
    secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: '0' },
    individualLimit: null,
    spendControlReached: false,
    planType: 'pro',
    rateLimitReachedType: null,
  },
  rateLimitsByLimitId: {
    codex: {
      limitId: 'codex',
      limitName: null,
      primary: { usedPercent: 13, windowDurationMins: 10080, resetsAt: 1790556720 },
      secondary: null,
    },
  },
  rateLimitResetCredits: { availableCount: 0, credits: [] },
  rateLimitUpsell: null,
};

/** `get_usage` control response, Claude Code CLI 2.1.272, Max plan, 2026-09-21 (trimmed). */
export const CLAUDE_USAGE = {
  session: { total_cost_usd: 0, model_usage: {} },
  subscription_type: 'max',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 31, resets_at: '2026-09-21T14:20:00.395737+00:00' },
    seven_day: { utilization: 32, resets_at: '2026-09-26T18:00:00.395758+00:00' },
    seven_day_opus: null,
    seven_day_sonnet: null,
    extra_usage: { is_enabled: false, user_disabled: true },
    model_scoped: [
      { display_name: 'Fable', utilization: 47, resets_at: '2026-09-26T18:00:00.395924+00:00' },
    ],
  },
};
