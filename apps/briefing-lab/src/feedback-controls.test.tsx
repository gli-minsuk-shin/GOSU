import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedbackControls, BriefingInsightCard } from './briefing-insight-card';
import { BriefingHistoryItem } from './briefing-history-view';
let ui: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.unstubAllGlobals();
});
const clickEvent = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
it.each(['important', 'not-interested'] as const)(
  'shows a filled thumb and an explicit saved receipt for %s',
  (decision) => {
    const html = renderToStaticMarkup(
      <FeedbackControls choice={decision} onChoose={vi.fn()} compact />,
    );
    expect(html).toContain('data-feedback-icon="thumb-up"');
    expect(html).toContain('data-feedback-icon="thumb-down"');
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain(`${decision === 'important' ? '관심 있음' : '관심 없음'} · 저장됨`);
    expect(html).not.toContain('m12 3 2.8 5.7');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  },
);
it.each(['live', 'history'] as const)(
  'only marks %s feedback saved after success and keeps the last saved selection on failure',
  async (mode) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let finish!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const item = {
      id: 'm',
      kind: 'email' as const,
      title: 'Fixture',
      readScope: 'mail-preview' as const,
      summary: 'Summary',
      importance: 'high',
      relevance: '',
    };
    await act(() => {
      ui = create(
        mode === 'live' ? (
          <BriefingInsightCard
            item={{ ...item, text: '', source: 'Mail', details: [] }}
            memory={null}
            routineId="r"
            onFeedback={save}
          />
        ) : (
          <BriefingHistoryItem item={item} onFeedback={save} />
        ),
      );
    });
    const button = (label: string) => ui!.root.findByProps({ 'aria-label': label });
    const choose = button('관심 있음').props.onClick;
    await act(() => {
      choose(clickEvent());
      choose(clickEvent());
    });
    expect(save).toHaveBeenCalledOnce();
    expect(button('관심 있음').props['aria-pressed']).toBe(false);
    expect(button('관심 없음').props.disabled).toBe(true);
    expect(JSON.stringify(ui!.toJSON())).toContain('저장 중…');
    expect(JSON.stringify(ui!.toJSON())).not.toContain('· 저장됨');
    await act(async () => finish());
    expect(button('관심 있음').props['aria-pressed']).toBe(true);
    expect(JSON.stringify(ui!.toJSON())).toContain('관심 있음 · 저장됨');
    save.mockRejectedValueOnce(new Error('저장 실패'));
    await act(async () => button('관심 있음').props.onClick(clickEvent()));
    expect(save).toHaveBeenLastCalledWith(null, ...(mode === 'live' ? [[]] : []));
    expect(button('관심 있음').props['aria-pressed']).toBe(true);
    save.mockResolvedValueOnce(undefined);
    await act(async () => button('관심 있음').props.onClick(clickEvent()));
    expect(button('관심 있음').props['aria-pressed']).toBe(false);
    expect(button('관심 없음').props['aria-pressed']).toBe(false);
    save.mockResolvedValueOnce(undefined);
    await act(async () => button('관심 없음').props.onClick(clickEvent()));
    expect(button('관심 없음').props['aria-pressed']).toBe(true);
    save.mockResolvedValueOnce(undefined);
    await act(async () => button('관심 없음').props.onClick(clickEvent()));
    expect(button('관심 없음').props['aria-pressed']).toBe(false);
    expect(button('관심 있음').props['aria-pressed']).toBe(false);
    expect(JSON.stringify(ui!.toJSON())).not.toContain('· 저장됨');
  },
);
