import { readFileSync } from 'node:fs';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseClaudeUsage,
  parseCodexRateLimits,
  type ProviderUsageLimits,
  type UsageLimitStatus,
} from '../src/shared/usage-limit-contracts';
import { UsageLimitPills } from '../src/renderer/src/usage-limit-pills';
import { UsageLimitsPanel } from '../src/renderer/src/usage-limits-panel';
import { formatCountdown } from '../src/renderer/src/usage-limit-format';
import { CLAUDE_USAGE, CODEX_RATE_LIMITS } from './usage-limit-fixtures';

const NOW = Date.parse('2026-09-21T12:00:00Z');
const provider = (
  providerId: ProviderUsageLimits['providerId'],
  extra: Partial<ProviderUsageLimits> = {},
): ProviderUsageLimits => ({
  providerId,
  connected: true,
  fetchedAt: '2026-09-21T11:59:30.000Z',
  error: null,
  ...(providerId === 'codex'
    ? parseCodexRateLimits(CODEX_RATE_LIMITS)!
    : parseClaudeUsage(CLAUDE_USAGE)!),
  ...extra,
});
const status = (
  providers: ProviderUsageLimits[],
  settings: Partial<UsageLimitStatus['settings']> = {},
): UsageLimitStatus => ({
  settings: { version: 1, refreshSeconds: 600, showInTitleBar: true, ...settings },
  providers,
  refreshing: false,
  settingsError: null,
});
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe('title bar limit pills', () => {
  it('shows what is left of the weekly limit for connected services only', () => {
    const html = renderToStaticMarkup(
      <UsageLimitPills
        status={status([provider('codex'), provider('claude-code', { connected: false })])}
        now={NOW}
        timeZone="Asia/Seoul"
        onOpen={vi.fn()}
      />,
    );
    expect(html).toContain('Codex weekly');
    expect(html).toContain('87%');
    expect(html).toContain('aria-label="Codex Weekly limit: 87% left"');
    expect(html).not.toContain('Claude');
    // Both connected: Claude shows its weekly window (68% left), not the 5-hour one.
    const both = renderToStaticMarkup(
      <UsageLimitPills
        status={status([provider('codex'), provider('claude-code')])}
        now={NOW}
        timeZone="Asia/Seoul"
        onOpen={vi.fn()}
      />,
    );
    expect(both).toContain('Claude weekly');
    expect(both).toContain('68%');
    // The tooltip carries every window with its reset time.
    expect(both).toContain('5-hour limit: 69% left (31% used)');
    expect(both).toContain('Weekly · Fable: 53% left (47% used)');
    expect(both).toContain('in 2h 20m');
  });

  it('is absent when turned off, before the first answer, and when nothing is connected', () => {
    const render = (value: UsageLimitStatus | null) =>
      renderToStaticMarkup(
        <UsageLimitPills status={value} now={NOW} timeZone="Asia/Seoul" onOpen={vi.fn()} />,
      );
    expect(render(null)).toBe('');
    expect(render(status([provider('codex')], { showInTitleBar: false }))).toBe('');
    expect(render(status([provider('codex', { connected: false, windows: [] })]))).toBe('');
  });

  it('marks low and stale numbers and opens the Usage screen on click', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const onOpen = vi.fn();
    const low = provider('claude-code', {
      error: 'usage_limits_timeout',
      windows: [
        { kind: 'weekly', label: null, usedPercent: 93, windowMinutes: 10080, resetsAt: null },
      ],
    });
    await act(() => {
      renderer = create(
        <UsageLimitPills status={status([low])} now={NOW} timeZone="Asia/Seoul" onOpen={onOpen} />,
      );
    });
    const pill = renderer!.root.findByType('button');
    expect(pill.props['data-level']).toBe('critical');
    expect(pill.props['data-stale']).toBe('');
    expect(pill.props.title).toContain('usage_limits_timeout');
    await act(() => pill.props.onClick());
    expect(onOpen).toHaveBeenCalledOnce();
    // Clickable inside the draggable title bar.
    const css = readFileSync(
      new URL('../src/renderer/src/usage-limits.css', import.meta.url),
      'utf8',
    );
    expect(css).toMatch(/\.usage-limit-pill \{[^}]*-webkit-app-region: no-drag;/u);
  });

  it('counts down in the two largest units and never below zero', () => {
    expect(formatCountdown('2026-09-26T18:00:00Z', NOW)).toBe('in 5d 6h');
    expect(formatCountdown('2026-09-21T12:40:30Z', NOW)).toBe('in 40m');
    expect(formatCountdown('2026-09-21T12:00:20Z', NOW)).toBe('in 20s');
    expect(formatCountdown('2026-09-21T11:00:00Z', NOW)).toBe('resetting now');
    expect(formatCountdown(null, NOW)).toBeNull();
  });
});

describe('Usage screen limits panel', () => {
  it('lists every window with used, left and reset time, and explains a service that is missing', () => {
    const html = renderToStaticMarkup(
      <UsageLimitsPanel
        status={status([
          provider('codex'),
          provider('claude-code', {
            connected: false,
            windows: [],
            plan: null,
            extraUsage: null,
            fetchedAt: null,
          }),
        ])}
        now={NOW}
        timeZone="Asia/Seoul"
        onRefresh={vi.fn()}
        onConfigure={vi.fn()}
      />,
    );
    expect(html).toContain('Weekly limit');
    expect(html).toContain('87% left');
    expect(html).toContain('13% used');
    expect(html).toContain('pro');
    expect(html).toContain('Extra usage and credits are off');
    expect(html).toContain('Not connected in GOSU, so it is not shown in the title bar.');
    expect(html).toContain('No model request is sent, so refreshing spends nothing.');
  });

  it('keeps the last numbers next to the reason when a refresh failed', () => {
    const html = renderToStaticMarkup(
      <UsageLimitsPanel
        status={status([provider('claude-code', { error: 'usage_limits_unsupported' })])}
        now={NOW}
        timeZone="Asia/Seoul"
        onRefresh={vi.fn()}
        onConfigure={vi.fn()}
      />,
    );
    expect(html).toContain('5-hour limit');
    expect(html).toContain('Weekly · Fable');
    expect(html).toContain('This CLI version cannot report its limits. Update the CLI.');
    expect(html).toContain('(usage_limits_unsupported)');
    expect(html).toContain('These are the last known numbers.');
  });

  it('says why a refresh or a settings change did not go through, keeping the numbers on screen', () => {
    const html = renderToStaticMarkup(
      <UsageLimitsPanel
        status={status([provider('codex')])}
        now={NOW}
        timeZone="Asia/Seoul"
        failure="EACCES: permission denied, open usage-limits.v1.json"
        onRefresh={vi.fn()}
        onConfigure={vi.fn()}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('The plan limits request failed: EACCES: permission denied');
    expect(html).not.toContain('could not be read');
    expect(
      renderToStaticMarkup(
        <UsageLimitsPanel
          status={{
            ...status([provider('codex')]),
            settingsError: 'usage_limit_settings_unreadable',
          }}
          now={NOW}
          timeZone="Asia/Seoul"
          onRefresh={vi.fn()}
          onConfigure={vi.fn()}
        />,
      ),
    ).toContain('The saved limit settings could not be read (usage_limit_settings_unreadable)');
    expect(html).toContain('87% left');
    const hook = readFileSync(
      new URL('../src/renderer/src/use-usage-limits.ts', import.meta.url),
      'utf8',
    );
    // No request of the hook drops its error.
    expect(hook).not.toContain('.catch(() => undefined)');
    expect(hook.match(/setFailure\(describeError\(error\)\)/gu)?.length).toBe(2);
  });

  it('offers the refresh intervals, the title bar switch and "refresh now"', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const onConfigure = vi.fn(),
      onRefresh = vi.fn();
    await act(() => {
      renderer = create(
        <UsageLimitsPanel
          status={status([provider('codex')])}
          now={NOW}
          timeZone="Asia/Seoul"
          onRefresh={onRefresh}
          onConfigure={onConfigure}
        />,
      );
    });
    const select = renderer!.root.findByType('select');
    expect(select.findAllByType('option').map((o) => o.props.value)).toEqual([
      10, 30, 60, 300, 600, 1800,
    ]);
    await act(() => select.props.onChange({ target: { value: '30' } }));
    expect(onConfigure).toHaveBeenLastCalledWith({
      version: 1,
      refreshSeconds: 30,
      showInTitleBar: true,
    });
    await act(() =>
      renderer!.root
        .findByProps({ type: 'checkbox' })
        .props.onChange({ target: { checked: false } }),
    );
    expect(onConfigure).toHaveBeenLastCalledWith({
      version: 1,
      refreshSeconds: 600,
      showInTitleBar: false,
    });
    await act(() => renderer!.root.findByProps({ className: 'ghost-button' }).props.onClick());
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
