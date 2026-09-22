import { setUiLanguage } from '@gosu/ui/language';
import { readFileSync } from 'node:fs';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TitlebarQuote } from '../src/renderer/src/titlebar-quote';
import {
  DAILY_QUOTE_REFRESH_LIMIT,
  type DailyQuoteHistory,
  type DailyQuoteView,
} from '../src/shared/daily-quote-contracts';

const quote = (overrides: Partial<DailyQuoteView> = {}): DailyQuoteView => ({
  date: '2026-09-22',
  language: 'en',
  text: 'All models are wrong, but some are useful.',
  author: 'George E. P. Box',
  tone: 'wisdom',
  source: 'model',
  failure: null,
  pending: false,
  createdAt: '2026-09-22T00:10:00.000Z',
  refreshesUsed: 0,
  refreshLimit: DAILY_QUOTE_REFRESH_LIMIT,
  capped: false,
  ...overrides,
});
const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('');
/** What the title bar itself shows, without the history panel that hangs off it. */
const shown = (ui: ReturnType<typeof create>) =>
  text(ui.root.findByProps({ className: 'titlebar-quote-line' }));
const refreshButton = (ui: ReturnType<typeof create>) =>
  ui.root.findByProps({ className: 'titlebar-quote-refresh' });

describe('title bar quote', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setUiLanguage('en');
  });

  it('shows the quote with its author, and asks again while the model line is still being written', async () => {
    const get = vi
      .fn<() => Promise<DailyQuoteView | null>>()
      .mockResolvedValueOnce(
        quote({ source: 'builtin', pending: true, author: null, text: 'Built-in line.' }),
      )
      .mockResolvedValue(quote());
    let ui!: ReturnType<typeof create>;
    await act(async () => {
      ui = create(<TitlebarQuote api={{ get }} />);
    });
    expect(shown(ui)).toBe('“Built-in line.”');
    // While AI writes, the same star the rest of GOSU shows stands in for the button.
    expect(ui.root.findAllByProps({ className: 'sidebar-ai-star is-running' })).toHaveLength(1);
    expect(ui.root.findAllByProps({ className: 'titlebar-quote-refresh' })).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(shown(ui)).toBe('“All models are wrong, but some are useful.” — George E. P. Box');
    expect(ui.root.findByProps({ className: 'titlebar-quote-line' }).props.title).toBe(
      '“All models are wrong, but some are useful.” — George E. P. Box',
    );
    expect(ui.root.findAllByProps({ className: 'sidebar-ai-star is-running' })).toHaveLength(0);
  });

  it('says quietly, in the tooltip only, why the line is a built-in one', async () => {
    setUiLanguage('ko');
    const get = vi.fn(async () =>
      quote({
        language: 'ko',
        text: '마감은 영감의 어머니다.',
        author: null,
        source: 'builtin',
        failure: 'daily_quote_model_unassigned',
      }),
    );
    let ui!: ReturnType<typeof create>;
    await act(async () => {
      ui = create(<TitlebarQuote api={{ get }} />);
    });

    expect(shown(ui)).toBe('“마감은 영감의 어머니다.”');
    expect(ui.root.findByProps({ className: 'titlebar-quote-line' }).props.title).toContain(
      '가벼운 작업',
    );
  });

  it('shows nothing when there is no quote or it is in the other language, and reloads on a language change', async () => {
    const get = vi.fn(async () =>
      quote({ language: 'ko', text: '한국어 문장입니다.', author: null }),
    );
    let ui!: ReturnType<typeof create>;
    await act(async () => {
      ui = create(<TitlebarQuote api={{ get }} />);
    });
    expect(ui.toJSON()).toBeNull();

    await act(async () => {
      setUiLanguage('ko');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(shown(ui)).toBe('“한국어 문장입니다.”');
  });

  it('asks for one more quote and shows the working star until it is written', async () => {
    const written = quote({ text: 'A fresh line.', author: null });
    const get = vi
      .fn<() => Promise<DailyQuoteView | null>>()
      .mockResolvedValueOnce(quote())
      .mockResolvedValueOnce(quote({ pending: true, refreshesUsed: 1 }))
      .mockResolvedValue({ ...written, refreshesUsed: 1 });
    const refresh = vi.fn(async () => quote({ pending: true, refreshesUsed: 1 }));
    let ui!: ReturnType<typeof create>;
    await act(async () => {
      ui = create(<TitlebarQuote api={{ get, refresh }} />);
    });
    expect(refreshButton(ui).props.title).toContain('10 left today');

    await act(async () => {
      await refreshButton(ui).props.onClick();
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(ui.root.findAllByProps({ className: 'sidebar-ai-star is-running' })).toHaveLength(1);

    // Someone is waiting for this one, so it is looked for every couple of seconds, not every 15.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(shown(ui)).toBe('“A fresh line.”');
  });

  it('refuses the eleventh quote of the day in the quote’s own place, and asks no model', async () => {
    const get = vi.fn(async () =>
      quote({ refreshesUsed: DAILY_QUOTE_REFRESH_LIMIT, capped: true }),
    );
    const refresh = vi.fn(async () => null);
    let ui!: ReturnType<typeof create>;
    await act(async () => {
      ui = create(<TitlebarQuote api={{ get, refresh }} />);
    });
    expect(refreshButton(ui).props['data-capped']).toBe('');

    await act(async () => {
      await refreshButton(ui).props.onClick();
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(shown(ui)).toContain('That’s today’s ten');

    // The quote comes back on its own; the refusal is a moment, not a new state.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(shown(ui)).toBe('“All models are wrong, but some are useful.” — George E. P. Box');
  });

  it('opens the history of every kept quote with the time each was written', async () => {
    const history: DailyQuoteHistory = {
      entries: [
        {
          date: '2026-09-22',
          language: 'en',
          text: 'Second line.',
          author: null,
          tone: 'humor',
          source: 'model',
          createdAt: '2026-09-22T01:20:00.000Z',
        },
        {
          date: '2026-09-21',
          language: 'en',
          text: 'First line.',
          author: 'Someone',
          tone: 'wisdom',
          source: 'model',
          createdAt: '2026-09-21T00:05:00.000Z',
        },
      ],
    };
    const get = vi.fn(async () => quote());
    let ui!: ReturnType<typeof create>;
    await act(async () => {
      ui = create(<TitlebarQuote api={{ get, history: async () => history }} />);
    });
    const line = ui.root.findByProps({ className: 'titlebar-quote-line' });
    expect(line.props.popoverTarget).toBe(
      ui.root.findByProps({ className: 'titlebar-quote-history' }).props.id,
    );

    await act(async () => {
      line.props.onClick();
    });
    const rows = ui.root.findAllByType('li').map((row) => text(row));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('“Second line.”');
    expect(rows[1]).toContain('“First line.” — Someone');
    // Every row says when it was written.
    expect(rows.every((row) => /\d/u.test(row.replace('“Second line.”', '')))).toBe(true);
  });

  it('replaces the subtitle in the header and keeps the quote from squeezing the right side', () => {
    const app = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );
    const header = app.slice(
      app.indexOf('<header className="titlebar">'),
      app.indexOf('</header>'),
    );
    expect(header).toContain('<TitlebarQuote />');
    expect(header).not.toContain('Local Research Workspace');
    expect(header.indexOf('<TitlebarQuote />')).toBeLessThan(header.indexOf('titlebar-spacer'));
    const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
    const rule = css.slice(css.indexOf('.titlebar .titlebar-quote {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('flex: 0 1 auto');
  });
});
