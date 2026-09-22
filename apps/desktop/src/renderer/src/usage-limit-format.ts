import { uiLocale, uiText } from '@gosu/ui/language';
import type { ProviderUsageLimits, UsageLimitWindow } from '../../shared/usage-limit-contracts';

export const usageLimitProviderName = (id: ProviderUsageLimits['providerId']) =>
  id === 'codex' ? 'Codex' : 'Claude';

/** "5-hour limit", "Weekly limit", "Weekly · Fable": named by the window's length, not its slot. */
export function usageLimitWindowName(window: UsageLimitWindow) {
  if (window.kind === 'weekly') return uiText('Weekly limit');
  if (window.kind === 'weekly-model')
    return uiText('Weekly · {name}', { name: window.label ?? '' });
  if (window.kind === 'session' && window.windowMinutes) {
    const hours = Math.round(window.windowMinutes / 60);
    return hours >= 1
      ? uiText('{hours}-hour limit', { hours })
      : uiText('{minutes}-minute limit', { minutes: window.windowMinutes });
  }
  return window.label ?? uiText('Plan limit');
}
/** The title bar label: "Codex weekly", "Claude 5h". */
export const usageLimitPillLabel = (name: string, window: UsageLimitWindow) =>
  window.kind === 'weekly' || window.kind === 'weekly-model'
    ? uiText('{name} weekly', { name })
    : window.kind === 'session' && window.windowMinutes
      ? uiText('{name} {hours}h', {
          name,
          hours: Math.max(1, Math.round(window.windowMinutes / 60)),
        })
      : uiText('{name} limit', { name });

/** How little is left: drives the color only, the number is always shown. */
export function usageLimitLevel(remaining: number): 'ok' | 'low' | 'critical' {
  return remaining <= 10 ? 'critical' : remaining <= 25 ? 'low' : 'ok';
}

export function formatPercent(value: number) {
  return `${new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: 1 }).format(value)}%`;
}

/** "in 2h 12m", "in 5d 3h", "in 40s": the largest two units, never negative. */
export function formatCountdown(resetsAt: string | null, now: number) {
  if (!resetsAt) return null;
  const seconds = Math.max(0, Math.round((Date.parse(resetsAt) - now) / 1000));
  if (!Number.isFinite(seconds)) return null;
  if (seconds === 0) return uiText('resetting now');
  const days = Math.floor(seconds / 86_400),
    hours = Math.floor((seconds % 86_400) / 3_600),
    minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return uiText('in {days}d {hours}h', { days, hours });
  if (hours) return uiText('in {hours}h {minutes}m', { hours, minutes });
  if (minutes) return uiText('in {minutes}m', { minutes });
  return uiText('in {seconds}s', { seconds });
}

export function formatResetTime(resetsAt: string | null, timeZone: string) {
  if (!resetsAt) return null;
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(uiLocale(), {
    timeZone,
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export const USAGE_LIMIT_ERROR_TEXT: Record<NonNullable<ProviderUsageLimits['error']>, string> = {
  usage_limits_unavailable: 'The CLI could not be started.',
  usage_limits_auth: 'The CLI is not logged in.',
  usage_limits_timeout: 'The CLI did not answer in time.',
  usage_limits_unsupported: 'This CLI version cannot report its limits. Update the CLI.',
  usage_limits_format: 'The CLI answered in a format GOSU does not know. Update GOSU.',
  usage_limits_failed: 'The CLI could not report its limits.',
};
