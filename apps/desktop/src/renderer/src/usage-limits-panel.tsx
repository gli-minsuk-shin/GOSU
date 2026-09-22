import { uiLocale, uiText } from '@gosu/ui/language';
import {
  remainingPercent,
  USAGE_LIMIT_REFRESH_SECONDS,
  type ProviderUsageLimits,
  type UsageLimitSettings,
  type UsageLimitStatus,
} from '../../shared/usage-limit-contracts';
import {
  formatCountdown,
  formatPercent,
  formatResetTime,
  USAGE_LIMIT_ERROR_TEXT,
  usageLimitLevel,
  usageLimitProviderName,
  usageLimitWindowName,
} from './usage-limit-format';
import './usage-limits.css';

const intervalLabel = (seconds: number) =>
  seconds < 60
    ? uiText('{seconds} seconds', { seconds })
    : uiText('{minutes} minutes', { minutes: seconds / 60 });

/** Usage screen: every limit window of each CLI, its reset time, and how often GOSU asks. */
export function UsageLimitsPanel({
  status,
  now,
  timeZone,
  failure = null,
  onRefresh,
  onConfigure,
}: Readonly<{
  status: UsageLimitStatus;
  now: number;
  timeZone: string;
  /** Why the last "refresh now" or settings change did not go through, in the app's own words. */
  failure?: string | null;
  onRefresh: () => void;
  onConfigure: (settings: UsageLimitSettings) => void;
}>) {
  const { settings } = status;
  return (
    <section className="usage-limits-panel" aria-label={uiText('Plan limits')}>
      <header>
        <div>
          <span className="eyebrow">{uiText('SUBSCRIPTION LIMITS')}</span>
          <h3>{uiText('Remaining plan limits')}</h3>
        </div>
        <div className="usage-limits-controls">
          <label>
            <span>{uiText('Refresh every')}</span>
            <select
              aria-label={uiText('Refresh every')}
              value={settings.refreshSeconds}
              onChange={(event) =>
                onConfigure({
                  ...settings,
                  refreshSeconds: Number(
                    event.target.value,
                  ) as UsageLimitSettings['refreshSeconds'],
                })
              }
            >
              {USAGE_LIMIT_REFRESH_SECONDS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {intervalLabel(seconds)}
                </option>
              ))}
            </select>
          </label>
          <label className="usage-limits-toggle">
            <input
              type="checkbox"
              checked={settings.showInTitleBar}
              onChange={(event) =>
                onConfigure({ ...settings, showInTitleBar: event.target.checked })
              }
            />
            <span>{uiText('Show in the title bar')}</span>
          </label>
          <button
            type="button"
            className="ghost-button"
            disabled={status.refreshing}
            onClick={onRefresh}
          >
            {status.refreshing ? uiText('Refreshing…') : uiText('Refresh now')}
          </button>
        </div>
      </header>
      {status.settingsError && (
        <p className="usage-limits-error" role="alert">
          {uiText(
            'The saved limit settings could not be read ({code}), so the defaults are in use. Changing a setting saves them again.',
            { code: status.settingsError },
          )}
        </p>
      )}
      {failure && (
        <p className="usage-limits-error" role="alert">
          {uiText('The plan limits request failed: {reason}', { reason: failure })}
        </p>
      )}
      <div className="usage-limits-grid">
        {status.providers.map((provider) => (
          <ProviderLimits
            key={provider.providerId}
            provider={provider}
            now={now}
            timeZone={timeZone}
          />
        ))}
      </div>
      <p className="usage-limits-note">
        {uiText(
          'GOSU asks each CLI for its own numbers (Codex: account limits, Claude Code: usage), using the CLI’s login. No model request is sent, so refreshing spends nothing. It refreshes only while the GOSU window is showing.',
        )}
      </p>
    </section>
  );
}

function ProviderLimits({
  provider,
  now,
  timeZone,
}: Readonly<{ provider: ProviderUsageLimits; now: number; timeZone: string }>) {
  const name = usageLimitProviderName(provider.providerId);
  return (
    <article className="usage-limits-card" data-connected={provider.connected ? '' : undefined}>
      <header>
        <strong>{name}</strong>
        {provider.plan && <span className="usage-limits-plan">{provider.plan}</span>}
        {provider.fetchedAt && (
          <small>
            {uiText('Updated')}{' '}
            {new Intl.DateTimeFormat(uiLocale(), {
              timeZone,
              hour: 'numeric',
              minute: '2-digit',
              second: '2-digit',
            }).format(new Date(provider.fetchedAt))}
          </small>
        )}
      </header>
      {!provider.connected && !provider.windows.length ? (
        <p className="usage-limits-empty">
          {provider.error && provider.error !== 'usage_limits_auth'
            ? `${uiText(USAGE_LIMIT_ERROR_TEXT[provider.error])} (${provider.error})`
            : uiText('Not connected in GOSU, so it is not shown in the title bar.')}
        </p>
      ) : (
        <>
          {provider.windows.map((window, index) => {
            const remaining = remainingPercent(window),
              reset = formatResetTime(window.resetsAt, timeZone),
              countdown = formatCountdown(window.resetsAt, now);
            return (
              <div
                className="usage-limits-window"
                key={`${window.kind}:${window.label ?? ''}:${index}`}
                data-level={usageLimitLevel(remaining)}
              >
                <div className="usage-limits-window-head">
                  <span>{usageLimitWindowName(window)}</span>
                  <strong>
                    {uiText('{remaining} left', { remaining: formatPercent(remaining) })}
                  </strong>
                </div>
                <span
                  className="usage-limit-meter wide"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={remaining}
                  aria-label={uiText('{name} {window}: {remaining} left', {
                    name,
                    window: usageLimitWindowName(window),
                    remaining: formatPercent(remaining),
                  })}
                >
                  <i style={{ width: `${remaining}%` }} />
                </span>
                <small>
                  {uiText('{used} used', { used: formatPercent(window.usedPercent) })}
                  {' · '}
                  {reset
                    ? `${uiText('resets {time}', { time: reset })}${countdown ? ` (${countdown})` : ''}`
                    : uiText('reset time not reported')}
                </small>
              </div>
            );
          })}
          {!provider.windows.length && (
            <p className="usage-limits-empty">{uiText('This plan reports no limit windows.')}</p>
          )}
          {provider.extraUsage !== null && (
            <small className="usage-limits-extra">
              {provider.extraUsage
                ? uiText(
                    'Extra usage or credits are on: work continues past these limits, billed separately.',
                  )
                : uiText('Extra usage and credits are off: work stops at these limits.')}
            </small>
          )}
          {provider.error && (
            <p className="usage-limits-error" role="status">
              {uiText(USAGE_LIMIT_ERROR_TEXT[provider.error])} ({provider.error}){' '}
              {uiText('These are the last known numbers.')}
            </p>
          )}
        </>
      )}
    </article>
  );
}
