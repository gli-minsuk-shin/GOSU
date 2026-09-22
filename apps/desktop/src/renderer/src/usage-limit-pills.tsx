import { uiText } from '@gosu/ui/language';
import {
  headlineWindow,
  remainingPercent,
  type UsageLimitStatus,
} from '../../shared/usage-limit-contracts';
import {
  formatCountdown,
  formatPercent,
  formatResetTime,
  usageLimitLevel,
  usageLimitPillLabel,
  usageLimitProviderName,
  usageLimitWindowName,
} from './usage-limit-format';
import './usage-limits.css';

/**
 * Title bar: what is left of each connected CLI's weekly limit (or of the only window its plan
 * reports). A service that is not connected, or has reported nothing yet, is not shown.
 */
export function UsageLimitPills({
  status,
  now,
  timeZone,
  onOpen,
}: Readonly<{
  status: UsageLimitStatus | null;
  now: number;
  timeZone: string;
  onOpen: () => void;
}>) {
  if (!status?.settings.showInTitleBar) return null;
  const shown = status.providers.flatMap((provider) => {
    const window = provider.connected ? headlineWindow(provider) : null;
    return window ? [{ provider, window }] : [];
  });
  if (!shown.length) return null;
  return (
    <div className="usage-limit-pills" role="group" aria-label={uiText('Remaining plan limits')}>
      {shown.map(({ provider, window }) => {
        const remaining = remainingPercent(window),
          name = usageLimitProviderName(provider.providerId);
        const details = provider.windows
          .map((item) => {
            const reset = formatResetTime(item.resetsAt, timeZone),
              countdown = formatCountdown(item.resetsAt, now);
            return `${usageLimitWindowName(item)}: ${uiText('{remaining} left ({used} used)', {
              remaining: formatPercent(remainingPercent(item)),
              used: formatPercent(item.usedPercent),
            })}${reset ? ` · ${uiText('resets {time}', { time: reset })}` : ''}${countdown ? ` (${countdown})` : ''}`;
          })
          .join('\n');
        return (
          <button
            key={provider.providerId}
            type="button"
            className="usage-limit-pill"
            data-level={usageLimitLevel(remaining)}
            data-stale={provider.error ? '' : undefined}
            aria-label={uiText('{name} {window}: {remaining} left', {
              name,
              window: usageLimitWindowName(window),
              remaining: formatPercent(remaining),
            })}
            title={`${name}${provider.plan ? ` · ${provider.plan}` : ''}\n${details}${provider.error ? `\n${uiText('Last refresh failed ({code}); these are the last known numbers.', { code: provider.error })}` : ''}`}
            onClick={onOpen}
          >
            <span className="usage-limit-pill-name">{usageLimitPillLabel(name, window)}</span>
            <span className="usage-limit-meter" aria-hidden="true">
              <i style={{ width: `${remaining}%` }} />
            </span>
            <span className="usage-limit-pill-value">{formatPercent(Math.round(remaining))}</span>
          </button>
        );
      })}
    </div>
  );
}
