import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { CalendarEventEditor } from './calendar-event-editor';
import { BriefingChat } from './briefing-chat';
import { sourceRequest } from './live-client';
import { workspaceStream } from './workspace-client';
import { initialEvent } from './calendar-dates';
import { initialWorkspace } from './fixtures';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantSettings } from './assistant-settings';
import { defaultLiveSettings, defaultAssistantPreferences } from '@gosu/briefing-core';

it.each([true, false])(
  'shows email refresh availability separately from private AI consent (read=%s)',
  (mailRead) => {
    const routine = {
      ...initialWorkspace().routines[0]!,
      live: {
        ...defaultLiveSettings(),
        assistant: { ...defaultAssistantPreferences(), mailAi: true, mailRead },
      },
    };
    const html = renderToStaticMarkup(<AssistantSettings routine={routine} onChange={vi.fn()} />);
    expect(html.includes('메일 읽기가 꺼져 있어 이메일 조회·다시 요약은 실행되지 않습니다.')).toBe(
      !mailRead,
    );
  },
);
vi.mock('./live-client', () => ({
  sourceRequest: vi.fn(async (path: string) =>
    path === '/calendar/catalog'
      ? {
          calendars: [
            { id: 'c', name: 'Research', source: 'Local', writable: true, color: '#527d0b' },
          ],
        }
      : { action: { id: 'action' } },
  ),
}));
vi.mock('./workspace-client', () => ({
  workspaceStream: vi.fn(async () => ({
    answer: '검토 필요',
    events: [],
    tasks: [],
    sources: [],
    invocation: { providerId: 'codex', model: 'resolved', reasoning: 'high' },
    writesPerformed: 0,
  })),
}));
let renderer: ReactTestRenderer;
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const button = (name: string) =>
  renderer.root.findAllByType('button').find((b) => b.children.join('') === name)!;
it.each(['최근 메일 중 중요한 내용 찾아줘', '오늘과 내일 일정 알려줘'])(
  'sends suggestion %s immediately exactly once, not the existing composer draft',
  async (suggestion) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    await act(() => {
      renderer = create(
        <BriefingChat routine={initialWorkspace().routines[0]!} onSettings={vi.fn()} />,
      );
    });
    await act(() =>
      renderer.root.findByType('textarea').props.onChange({ target: { value: 'Unsent draft' } }),
    );
    await act(() =>
      renderer.root.findByProps({ 'aria-label': '추천 질문', type: 'button' }).props.onClick(),
    );
    const submit = button(suggestion).props.onClick;
    await act(async () => {
      submit();
      submit();
    });
    expect(workspaceStream).toHaveBeenCalledTimes(1);
    expect(vi.mocked(workspaceStream).mock.calls[0]?.[1]).toMatchObject({ prompt: suggestion });
    expect(renderer.root.findByType('textarea').props.value).toBe('');
    expect(JSON.stringify(renderer.toJSON())).toContain('검토 필요');
  },
);
it('existing event metadata does not corrupt the draft and a direct Save executes once', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const event = {
    ...initialEvent('Asia/Seoul', 'c'),
    title: 'Review',
    id: 'e',
    fingerprint: 'fingerprint',
    hasAttendees: false,
    recurring: false,
  };
  await act(() => {
    renderer = create(
      <CalendarEventEditor
        routineId="r"
        initial={event}
        event={event}
        calendarIds={['c']}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
  });
  expect(vi.mocked(sourceRequest).mock.calls.some((c) => c[0] === '/calendar/apply')).toBe(false);
  await act(() => button('저장').props.onClick());
  const call = vi.mocked(sourceRequest).mock.calls.find((c) => c[0] === '/calendar/prepare');
  expect(call?.[1]).toMatchObject({ kind: 'update', eventId: 'e' });
  expect((call?.[1] as { draft: object }).draft).not.toHaveProperty('id');
  expect(
    vi.mocked(sourceRequest).mock.calls.filter((c) => c[0] === '/calendar/apply'),
  ).toHaveLength(1);
  expect(button('이 내용으로 저장 승인')).toBeUndefined();
});
it('invitations cannot expose editable/delete actions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const event = {
    ...initialEvent('Asia/Seoul', 'c'),
    title: 'Invitation',
    id: 'e',
    fingerprint: 'f',
    hasAttendees: true,
    recurring: false,
  };
  await act(() => {
    renderer = create(
      <CalendarEventEditor
        routineId="r"
        initial={event}
        event={event}
        calendarIds={['c']}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
  });
  expect(button('삭제')).toBeUndefined();
  expect(button('저장')).toBeUndefined();
});
it('chat uses the shared backend agent endpoint, respects IME and does not create actions itself', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const routine = initialWorkspace().routines[0]!;
  await act(() => {
    renderer = create(<BriefingChat routine={routine} onSettings={vi.fn()} />);
  });
  const textarea = renderer.root.findByType('textarea');
  await act(() => textarea.props.onChange({ target: { value: '논문 찾아줘' } }));
  await act(() =>
    textarea.props.onKeyDown({
      key: 'Enter',
      shiftKey: false,
      nativeEvent: { isComposing: true },
      preventDefault: vi.fn(),
    }),
  );
  expect(workspaceStream).not.toHaveBeenCalled();
  await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  expect(vi.mocked(workspaceStream).mock.calls[0]?.[0]).toBe('/assistant/chat');
  expect(vi.mocked(workspaceStream).mock.calls[0]?.[1]).toMatchObject({
    routineId: routine.id,
    prompt: '논문 찾아줘',
    history: [],
  });
  expect(vi.mocked(sourceRequest).mock.calls.map((call) => call[0])).toEqual([
    '/assistant/conversation/get',
    '/assistant/queue/list',
  ]);
  expect(JSON.stringify(renderer.toJSON())).toContain('resolved');
});
it('compact styles win the cascade and chat owns a bounded independent vertical scroller', () => {
  const app = readFileSync(new URL('./briefing-app.tsx', import.meta.url), 'utf8'),
    main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8'),
    css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  expect(app.indexOf("import './workspace.css'")).toBeGreaterThan(
    app.indexOf("import './styles.css'"),
  );
  expect(main).not.toContain("import './styles.css'");
  expect(css).toMatch(/\.briefing-chat-log\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto;/);
  expect(css).toMatch(/\.briefing-topbar\s*\{[^}]*min-height: 48px;/);
  expect(css).toContain('@container (min-width: 500px)');
});
it('renders referenced email/paper/news titles in bold in both assistant prose and source labels', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const titles = ['행사 참석 요청', 'GraphNet study', 'Funding news'];
  vi.mocked(workspaceStream).mockResolvedValueOnce({
    answer: `${titles.join(', ')}을 확인하세요.`,
    events: [],
    tasks: [],
    sources: titles.map((title, index) => ({
      id: String(index),
      title,
      kind: ['email', 'paper', 'news'][index],
    })),
    invocation: { providerId: 'codex', model: 'test', reasoning: 'low' },
    writesPerformed: 0,
  });
  await act(() => {
    renderer = create(
      <BriefingChat routine={initialWorkspace().routines[0]!} onSettings={vi.fn()} />,
    );
  });
  await act(() =>
    renderer.root
      .findByType('textarea')
      .props.onChange({ target: { value: '최근 소식 정리해줘' } }),
  );
  await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  const bold = renderer.root.findAllByType('strong').map((node) => node.children.join(''));
  for (const title of titles) expect(bold.filter((value) => value === title)).toHaveLength(2);
});
it('renders calendar preparation emphasis and confirmed time without bolding the whole explanation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(workspaceStream).mockResolvedValueOnce({
    answer: '미팅 전에 **초안 검토**가 필요합니다.',
    events: [
      {
        title: 'Review',
        reason: '미팅 전에 **자료 준비**가 필요합니다.',
        start: '2026-09-09T01:00:00Z',
        end: '2026-09-09T02:00:00Z',
        timeZone: 'Asia/Seoul',
        allDay: false,
        sourceId: 'paper',
        evidence: 'literal **source**',
      },
    ],
    tasks: [],
    sources: [],
    invocation: { providerId: 'codex', model: 'test', reasoning: 'low' },
    writesPerformed: 0,
  });
  await act(() => {
    renderer = create(
      <BriefingChat routine={initialWorkspace().routines[0]!} onSettings={vi.fn()} />,
    );
  });
  await act(() =>
    renderer.root.findByType('textarea').props.onChange({ target: { value: '일정 추천해줘' } }),
  );
  await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  const strong = renderer.root.findAllByType('strong').map((node) => node.children.join(''));
  expect(strong).toContain('자료 준비');
  expect(strong).toContain('초안 검토');
  expect(strong.some((text) => text.includes('10:00') && text.includes('11:00'))).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain('literal **source**');
  expect(vi.mocked(sourceRequest).mock.calls.map((call) => call[0])).toEqual([
    '/assistant/conversation/get',
    '/assistant/queue/list',
  ]);
});
it('bundles Korean/Latin typography locally and keeps reading text inset from card borders', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  expect(css).toContain("font-family: 'Pretendard Variable'");
  expect(css).toContain("url('./assets/fonts/PretendardVariable.woff2')");
  expect(
    readFileSync(new URL('./assets/fonts/PretendardVariable.woff2', import.meta.url)).toString(
      'ascii',
      0,
      4,
    ),
  ).toBe('wOF2');
  expect(
    readFileSync(new URL('../public/fonts/Pretendard-LICENSE.txt', import.meta.url), 'utf8'),
  ).toContain('SIL OPEN FONT LICENSE');
  expect(layout).toMatch(/\.briefing-reading-body\s*\{[^}]*line-height: 1.8/);
  expect(layout).toMatch(/\.briefing-email-expanded\s*\{[^}]*padding: 14px 16px/);
  expect(layout).toMatch(
    /\.briefing-paper-expanded,\s*\.briefing-email-expanded\s*\{[^}]*padding: 14px 16px/,
  );
  expect(layout).toMatch(/\.briefing-email-preview\s*\{[^}]*-webkit-line-clamp: 2/);
});
it('Calendar fills remaining height and uses stable compact toolbar hooks instead of a fixed minimum', () => {
  const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  const view = readFileSync(new URL('./calendar-view.tsx', import.meta.url), 'utf8');
  expect(css).toMatch(/\.briefing-calendar-view\s*\{[^}]*min-height: 0;/);
  expect(css).toMatch(/\.briefing-calendar-grid\s*\{[^}]*flex: 1;[^}]*min-height: 0;/);
  expect(css).toMatch(
    /\.briefing-main-calendar > \.briefing-main-scroll\s*\{[^}]*padding: 6px 8px;/,
  );
  expect(css).toMatch(
    /\.briefing-calendar-grid \.briefing-calendar-toolbar\s*\{[^}]*padding: 6px 8px;/,
  );
  expect(view).toContain('className="briefing-calendar-grid"');
  expect(view).toContain('headerToolbarClass="briefing-calendar-toolbar"');
  expect(view).toContain('toolbarTitleClass="briefing-calendar-title"');
  expect(view).toContain('height="100%"');
  expect(css).toContain('@container (max-width: 540px)');
});
