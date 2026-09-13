import { it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  BriefingHistoryFeed,
  BriefingHistoryView,
  groupBriefingHistory,
} from './briefing-history-view';
import type { BriefingHistory } from '../briefing-workspace-store';
import { sourceRequest } from './live-client';
import { agendaDays } from './briefing-agenda-days';
import { BRIEFING_COLLAPSE_EVENT } from './briefing-collapse-all';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn(async () => ({ history: [] })) }));
const day = '2026-09-09T00:00:00.000Z';
const paper = {
  id: 'paper',
  title: 'Paper detail',
  kind: 'papers' as const,
  readScope: 'abstract',
  summary: 'Paper summary',
  importance: 'high',
  relevance: '',
  keywords: ['optimization'],
  detail: 'Extended method',
  researchQuestion: 'Research question',
  strengths: 'Strength',
  limitations: 'Limitation',
  methodsAndAssumptions: 'Method',
  reportedResults: 'Reported result',
  equations: [{ latex: 'x^2', explanation: 'Loss' }],
};
const batch = (id: string, createdAt = day): BriefingHistory => ({
  id,
  routineId: 'r',
  createdAt,
  kind: 'briefing',
  answer: `Overview ${id}`,
  private: false,
  items: [paper],
});
it.each(['empty', 'failed'] as const)(
  'keeps saved papers and emails when the next discovery is %s, including legacy visibility hints',
  (status) => {
    const history = batch('update');
    history.items = [paper, { ...paper, id: 'mail', kind: 'email', readScope: 'mail-preview' }];
    history.snapshot = {
      collectedAt: day,
      routineName: 'Fixture',
      timeZone: 'Asia/Seoul',
      sources: [
        {
          kind: 'papers',
          status,
          count: 0,
          notice: status === 'empty' ? '이번 조회 범위에 새 논문이 없습니다.' : '새 논문 조회 실패',
          ...(status === 'failed' ? { error: 'arXiv 요청 제한' } : {}),
        },
      ],
      visiblePaperKeys: [],
    };
    expect(groupBriefingHistory([history])[0]?.items.map((i) => i.id)).toEqual([paper.id, 'mail']);
    expect(history.items).toHaveLength(2);
    expect(renderToStaticMarkup(<BriefingHistoryFeed history={[history]} />)).toContain(
      status === 'empty' ? '새 논문이 없습니다' : 'arXiv 요청 제한',
    );
  },
);
it.each(['papers', 'email'] as const)(
  'shows recently summarized %s before older high importance items',
  (kind) => {
    const history = batch('order');
    history.items = [
      { ...paper, kind, id: 'old', title: 'Older high', addedAt: day },
      {
        ...paper,
        kind,
        id: 'new',
        title: 'Newest low',
        importance: 'low',
        addedAt: '2026-09-10T00:00:00Z',
      },
    ];
    const html = renderToStaticMarkup(<BriefingHistoryFeed history={[history]} />);
    const summaries = [
      ...html.matchAll(/<summary class="briefing-(?:paper|email)-summary"[^]*?<\/summary>/g),
    ]
      .map((m) => m[0])
      .join('');
    expect(summaries.indexOf('Newest low')).toBeGreaterThanOrEqual(0);
    if (kind === 'papers')
      expect(summaries.indexOf('Older high')).toBeLessThan(summaries.indexOf('Newest low'));
    else expect(summaries.indexOf('Newest low')).toBeLessThan(summaries.indexOf('Older high'));
  },
);
const snapshot: BriefingHistory = {
  ...batch('snapshot'),
  runId: '8c5c6888-f981-4f9e-bda8-5f6d0de59572',
  answer: '',
  items: [],
  snapshot: {
    collectedAt: day,
    routineName: 'Research',
    timeZone: 'Asia/Seoul',
    sources: [{ kind: 'weather', status: 'ready', count: 1 }],
    weather: {
      city: 'Saved Seoul',
      timeZone: 'Asia/Seoul',
      localDate: '2026-09-09',
      currentTime: day,
      temperature: 20,
      code: 3,
      wind: 5,
      hours: Array.from({ length: 24 }, (_, i) => ({
        time: Date.parse(day) / 1000 + i * 3600,
        temperature: 20,
        apparent: 20,
        precipitation: i,
        code: 3,
      })),
    },
  },
};
it('keeps the first-connection explanation visible with an empty historical email section', () => {
  const notice = '첫 연결에서는 전체 최대 3개만 가져옵니다. 다음부터 최대 50개를 조회합니다.';
  const html = renderToStaticMarkup(
    <BriefingHistoryFeed
      history={[
        {
          ...snapshot,
          snapshot: {
            ...snapshot.snapshot!,
            sources: [{ kind: 'email', status: 'empty', count: 0, notice }],
          },
        },
      ]}
    />,
  );
  expect(html).toContain(notice);
  expect(html).toContain('briefing-mail-collection-notice');
});
it('emphasizes the stored calendar time, not its entire metadata line or Markdown-looking source title', () => {
  const html = renderToStaticMarkup(
    <BriefingHistoryFeed
      history={[
        {
          ...snapshot,
          snapshot: {
            ...snapshot.snapshot!,
            calendar: [
              {
                title: 'Literal **review**',
                start: day,
                end: '2026-09-09T01:00:00Z',
                allDay: false,
                timeZone: 'Asia/Seoul',
                location: 'Room',
              },
            ],
          },
        },
      ]}
    />,
  );
  expect(html).toContain('<strong>Literal **review**</strong>');
  expect(html).toContain('오늘 일정 (2026년 9월 9일');
  expect(html).toContain('내일 일정 (2026년 9월 10일');
  expect(html).not.toContain('당시 일정');
  expect(html).toContain('2026년 9월 9일');
  expect(html).toContain('오전 9:00');
  expect(html).toContain('오전 10:00');
  expect(html).toContain('Room');
  expect(html).toContain('briefing-history-calendar');
});
let renderer: ReactTestRenderer | undefined;
it('keeps history arriving after collapse minimized while the AI summary stays outside disclosure blocks', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const pane = new EventTarget();
  await act(() => {
    renderer = create(<BriefingHistoryFeed history={[]} />, {
      createNodeMock: () => ({ closest: () => pane }),
    });
  });
  await act(() => {
    pane.dispatchEvent(new Event(BRIEFING_COLLAPSE_EVENT));
  });
  await act(() => {
    renderer!.update(
      <BriefingHistoryFeed history={[snapshot, { ...batch('later'), runId: snapshot.runId }]} />,
    );
  });
  const panels = renderer!.root
    .findAllByType('details')
    .filter((n) => String(n.props.className).includes('briefing-content-section'));
  expect(panels).toHaveLength(2);
  expect(panels.every((p) => p.props.open === false)).toBe(true);
  const summary = renderer!.root.findByProps({
    className: 'briefing-assistant-summary briefing-history-summary',
  });
  expect(summary.type).toBe('section');
  expect(summary.findAllByProps({ className: 'briefing-assistant-highlights' })).toHaveLength(1);
});
afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('groups batches into one expanded briefing, newest first, with complete stored weather and paper math', () => {
  const sameRun = { ...batch('new-batch'), runId: snapshot.runId };
  const older = batch('older', '2026-09-08T00:00:00.000Z');
  const history = [older, sameRun, snapshot];
  const groups = groupBriefingHistory(history);
  expect(groups).toHaveLength(2);
  expect(groups[0]!.items).toHaveLength(1);
  const html = renderToStaticMarkup(<BriefingHistoryFeed history={history} />);
  expect(html.indexOf('Overview new-batch')).toBeLessThan(html.indexOf('Overview older'));
  expect(html.match(/<details class="briefing-paper-disclosure"/g)).toHaveLength(2);
  expect(html).not.toMatch(/<details class="briefing-paper-disclosure"[^>]*\sopen(?:[\s=>])/);
  expect(html).toContain('briefing-content-section');
  expect(html).toContain('briefing-history-weather');
  expect(html).toContain('당시 시간별 기온');
  expect(html).toContain('24개 시간대');
  expect(html).toContain('Research question');
  expect(html).toContain('Optimization');
  expect(html).toContain('연구 우선순위');
  expect(html).toContain('katex');
  expect(html).not.toContain('TODAY');
  expect(html).toContain('당시 날씨가 저장되어 있지 않습니다');
});
it('restores collapsible source blocks and priority-ordered summary cards with run-specific destinations', () => {
  const h = {
    ...batch('blocks'),
    items: [
      {
        ...paper,
        id: 'm',
        kind: 'email' as const,
        readScope: 'mail-preview',
        title: 'Low mail',
        importance: 'low',
        summary: 'Routine FYI',
      },
      { ...paper, title: 'High paper', importance: 'high', summary: 'Scientific result' },
    ],
  };
  const html = renderToStaticMarkup(
    <BriefingHistoryFeed history={[h, { ...h, id: 'older', createdAt: '2026-09-08T00:00:00Z' }]} />,
  );
  expect(html).toContain('briefing-content-section email');
  expect(html).toContain('briefing-content-section papers');
  expect(html).toContain('논문 바로 보기');
  expect(html).toContain('이메일 바로 보기');
  expect(html).toContain('briefing-assistant-highlight papers');
  expect(html.indexOf('High paper')).toBeLessThan(html.indexOf('Low mail'));
  const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]!);
  expect(controls.length).toBeGreaterThanOrEqual(8);
  for (const id of controls) expect(html).toContain(`id="${id}"`);
  expect(new Set(controls).size).toBe(controls.length);
});
it('opening the scroll feed reads saved history only, without fetching live sources or generating summaries', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({ history: [snapshot] });
  await act(async () => {
    renderer = create(<BriefingHistoryView routineIds={['r', 'r']} />);
  });
  expect(vi.mocked(sourceRequest).mock.calls.map((call) => call[0])).toEqual(['/history/list']);
  expect(JSON.stringify(renderer!.toJSON())).toContain('Saved Seoul');
});
it('loads older history pages and keeps previous entries visible while a new briefing refreshes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockImplementation(async (_path, input) =>
    (input as { offset?: number }).offset
      ? { history: [batch('old', '2026-09-08T00:00:00Z')], nextOffset: null }
      : { history: [snapshot], nextOffset: 600 },
  );
  await act(async () => {
    renderer = create(<BriefingHistoryView routineId="r" refreshKey="first" />);
  });
  expect(vi.mocked(sourceRequest).mock.calls[1]?.[1]).toEqual({ routineId: 'r', offset: 600 });
  expect(JSON.stringify(renderer!.toJSON())).toContain('Overview old');
  let resolve!: (value: unknown) => void;
  vi.mocked(sourceRequest).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await act(async () => {
    renderer!.update(<BriefingHistoryView routineId="r" refreshKey="new" />);
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain('Overview old');
  await act(async () => {
    resolve({
      history: [
        batch('new', '2026-09-10T00:00:00Z'),
        snapshot,
        batch('old', '2026-09-08T00:00:00Z'),
      ],
    });
  });
  const text = JSON.stringify(renderer!.toJSON());
  expect(text.indexOf('Overview new')).toBeLessThan(text.indexOf('Overview old'));
});
it('anchors today/tomorrow to the saved date, handles year rollover and exclusive multi-day ends', () => {
  const days = agendaDays('2026-12-31T14:00:00Z', 'Asia/Seoul', [
    {
      title: 'Today only',
      start: '2026-12-30T15:00:00Z',
      end: '2026-12-31T15:00:00Z',
      timeZone: 'Asia/Seoul',
      allDay: true,
      location: '',
    },
    {
      title: 'Spanning',
      start: '2026-12-31T14:00:00Z',
      end: '2026-12-31T16:00:00Z',
      timeZone: 'Asia/Seoul',
      allDay: false,
      location: '',
    },
  ]);
  expect(days[0]?.label).toContain('오늘 일정 (2026년 12월 31일');
  expect(days[1]?.label).toContain('내일 일정 (2027년 1월 1일');
  expect(days[0]?.events.map((e) => e.title)).toEqual(['Today only', 'Spanning']);
  expect(days[1]?.events.map((e) => e.title)).toEqual(['Spanning']);
  expect(agendaDays('2026-03-08T05:00:00Z', 'America/New_York', []).map((d) => d.date)).toEqual([
    '2026-03-08',
    '2026-03-09',
  ]);
});
it('restores saved choices and saves history feedback using only server-owned item identifiers', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockImplementation(async (path) =>
    path === '/history/list'
      ? { history: [batch('h1')], feedback: { paper: 'not-interested' } }
      : { decision: 'important' },
  );
  await act(async () => {
    renderer = create(<BriefingHistoryView routineIds={['r']} />);
  });
  const control = (label: string) => renderer!.root.findByProps({ 'aria-label': label });
  expect(control('관심 없음').props['aria-pressed']).toBe(true);
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  await act(async () => control('관심 있음').props.onClick(event));
  expect(event.preventDefault).toHaveBeenCalled();
  expect(event.stopPropagation).toHaveBeenCalled();
  expect(vi.mocked(sourceRequest).mock.calls[1]!.slice(0, 2)).toEqual([
    '/history/feedback',
    { routineId: 'r', historyId: 'h1', itemId: 'paper', decision: 'important' },
  ]);
  expect(control('관심 있음').props['aria-pressed']).toBe(true);
  expect(control('관심 없음').props['aria-pressed']).toBe(false);
  vi.mocked(sourceRequest).mockRejectedValueOnce(new Error('저장 실패'));
  await act(async () => control('관심 없음').props.onClick(event));
  expect(control('관심 있음').props['aria-pressed']).toBe(true);
  expect(JSON.stringify(renderer!.toJSON())).toContain('저장 실패');
});
