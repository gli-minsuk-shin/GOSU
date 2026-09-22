import { readFileSync } from 'node:fs';
import { it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  BRIEFING_FEED_PAGE,
  BriefingHistoryFeed,
  BriefingHistoryView,
  groupBriefingHistory,
  runsToShow,
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
it('uses received time within each email priority and displays stored senders before expansion', () => {
  const history = batch('mail-order');
  const base = {
    ...paper,
    kind: 'email' as const,
    readScope: 'mail-preview',
    mailSender: 'Research Office <office@example.test>',
  };
  history.items = [
    {
      ...base,
      id: 'low-new',
      title: 'Low latest',
      importance: 'low',
      receivedAt: '2026-09-14T10:00:00Z',
    },
    {
      ...base,
      id: 'high-old',
      title: 'High older',
      receivedAt: '2026-09-12T10:00:00Z',
      addedAt: '2026-09-15T10:00:00Z',
    },
    {
      ...base,
      id: 'high-new',
      title: 'High latest',
      receivedAt: '2026-09-14T09:00:00Z',
      addedAt: day,
    },
  ];
  const html = renderToStaticMarkup(<BriefingHistoryFeed history={[history]} />);
  const summaries = [
    ...html.matchAll(/<summary class="briefing-email-summary"[^]*?<\/summary>/g),
  ].map((m) => m[0]);
  expect(summaries).toHaveLength(3);
  expect(summaries[0]).toContain('High latest');
  expect(summaries[1]).toContain('High older');
  expect(summaries[2]).toContain('Low latest');
  expect(summaries[0]).toContain('<b>Research Office</b>');
  expect(summaries[0]).toContain('office@example.test');
});
it('labels an unavailable paper lookup as incomplete rather than zero summaries', () => {
  const history = batch('failed-discovery');
  history.items = [];
  history.snapshot = {
    collectedAt: day,
    routineName: 'Fixture',
    timeZone: 'Asia/Seoul',
    sources: [{ kind: 'papers', status: 'failed', count: 0, error: 'Search unavailable' }],
  };
  const html = renderToStaticMarkup(<BriefingHistoryFeed history={[history]} />);
  expect(html).toContain('연구 논문 · 조회 미완료');
  expect(html).not.toContain('연구 논문 · 0개 요약');
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
  'keeps high-importance %s ahead of newer low-importance summaries',
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
    expect(summaries.indexOf('Older high')).toBeLessThan(summaries.indexOf('Newest low'));
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
it('drops the routine email read notice and the standing task explanation, keeping real warnings', () => {
  const routine =
    '이미 요약한 메일은 제외하고 전체 최대 100개를 조회합니다. 이전에 요약한 동일 메일 74개는 본문을 다시 읽지 않고 건너뛰었습니다.';
  const run = (limited: boolean) =>
    renderToStaticMarkup(
      <BriefingHistoryFeed
        history={[
          {
            ...snapshot,
            items: [
              { ...paper, id: 'mail', kind: 'email', readScope: 'mail-preview', title: 'Mail' },
            ],
            snapshot: {
              ...snapshot.snapshot!,
              sources: [{ kind: 'email', status: 'ready', count: 1, notice: routine }],
              todos: {
                items: [{ id: 't', title: 'Task', projectName: 'P', status: 'planned' }],
                limited,
                fetchedAt: day,
              },
            },
          },
        ]}
      />,
    );
  const html = run(false);
  expect(html).not.toContain('이미 요약한 메일은 제외하고');
  expect(html).not.toContain('최대 6개를 표시합니다');
  expect(html).not.toContain('일부 할 일만 조회했습니다');
  // An incomplete task read is still reported.
  expect(run(true)).toContain('일부 할 일만 조회했습니다');
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
it('tells email, agenda, paper and task cards apart by kind and colour', () => {
  const html = renderToStaticMarkup(
    <BriefingHistoryFeed
      history={[
        {
          ...snapshot,
          items: [
            paper,
            { ...paper, id: 'mail', kind: 'email', readScope: 'mail-preview', title: 'Mail title' },
          ],
          snapshot: {
            ...snapshot.snapshot!,
            calendar: [
              {
                title: 'Research meeting',
                start: day,
                end: '2026-09-09T01:00:00Z',
                allDay: false,
                timeZone: 'Asia/Seoul',
                location: 'Room',
              },
            ],
            todos: {
              items: [
                {
                  id: 't1',
                  title: 'Send the grant draft',
                  projectName: 'Grant',
                  status: 'in_progress',
                  priority: 'high',
                  dueDate: '2026-09-09',
                },
                { id: 'done', title: 'Finished', projectName: 'Grant', status: 'done' },
              ],
              limited: false,
              fetchedAt: day,
            },
          },
        },
      ]}
    />,
  );
  for (const kind of ['email', 'papers', 'calendar', 'task'])
    expect(html).toContain(`briefing-assistant-highlight ${kind}`);
  expect(html).toContain('할 일 · 기한순');
  expect(html).toContain('Send the grant draft');
  expect(html).toContain('2026-09-09 기한 · Grant');
  // A finished task is not something to check first.
  expect(html).not.toContain('Finished');
  const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  const accents = ['email', 'calendar', 'papers', 'task'].map(
    (kind) =>
      /--highlight-accent:\s*(#[0-9a-f]{6})/i.exec(
        css.split(`.briefing-assistant-highlight.${kind} {`)[1]?.split('}')[0] ?? '',
      )?.[1],
  );
  expect(accents.every(Boolean)).toBe(true);
  expect(new Set(accents).size).toBe(4);
  expect(css).toContain('border-left: 3px solid var(--highlight-accent');
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
  // Besides saved history it reads only the saved briefing guidance (for pinned mail).
  expect(
    vi
      .mocked(sourceRequest)
      .mock.calls.map((call) => call[0])
      .sort(),
  ).toEqual(['/assistant/guidance/list', '/history/list']);
  expect(JSON.stringify(renderer!.toJSON())).toContain('Saved Seoul');
  // The header is the title and search only; the standing usage paragraph was removed.
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('최신 브리핑부터 아래로 스크롤해');
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
  const pages = vi.mocked(sourceRequest).mock.calls.filter((call) => call[0] === '/history/list');
  expect(pages[1]?.[1]).toEqual({ routineId: 'r', offset: 600 });
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
  expect(
    vi
      .mocked(sourceRequest)
      .mock.calls.find((call) => call[0] === '/history/feedback')!
      .slice(0, 2),
  ).toEqual([
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
it('pins mail from a sender listed in the briefing guidance to the front of the highlights', () => {
  const history = batch('guidance-pin');
  const mail = (id: string, sender: string, importance: string) => ({
    ...paper,
    id,
    title: `Mail ${id}`,
    kind: 'email' as const,
    readScope: 'mail-preview',
    importance,
    mailSender: sender,
    receivedAt: '2026-09-14T10:00:00Z',
  });
  history.items = [
    paper,
    mail('a', 'A <a@example.test>', 'high'),
    mail('b', 'B <b@example.test>', 'high'),
    mail('c', 'C <c@example.test>', 'high'),
    mail('nrf', '한국연구재단 <noreply@mail.nrf.re.kr>', 'low'),
  ];
  const highlights = (html: string) =>
    [...html.matchAll(/<strong>(Mail [^<]+|Paper detail)<\/strong>/g)].map((m) => m[1]);
  const plain = renderToStaticMarkup(<BriefingHistoryFeed history={[history]} />);
  const plainSummary = plain.slice(0, plain.indexOf('briefing-assistant-highlights') + 2000);
  expect(highlights(plainSummary)).not.toContain('Mail nrf');
  const pinned = renderToStaticMarkup(
    <BriefingHistoryFeed
      history={[history]}
      guidance={{ r: [{ id: 'g', text: 'nrf.re.kr 메일은 반드시 포함' }] }}
    />,
  );
  const summary = pinned.slice(
    pinned.indexOf('briefing-assistant-highlights'),
    pinned.indexOf('</section>', pinned.indexOf('briefing-assistant-highlights')),
  );
  // The listed mail comes first although its importance is low; three other mails still fit.
  const shown = highlights(summary);
  expect(shown[0]).toBe('Mail nrf');
  expect(shown.slice(1).sort()).toEqual(['Mail a', 'Mail b', 'Paper detail']);
  expect(summary).toContain('지침');
  // Another routine's guidance never pins this routine's mail.
  const other = renderToStaticMarkup(
    <BriefingHistoryFeed
      history={[history]}
      guidance={{ other: [{ id: 'g', text: 'nrf.re.kr 메일은 반드시 포함' }] }}
    />,
  );
  expect(other).not.toContain('briefing-guidance-pinned');
});

// 2026-09-21 user request: "Briefing Lab 에서 안읽은 이메일만 보는 버튼 넣자".
it('shows only the mail that is still unread when asked, from the saved read state alone, and says what it hid', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const mail = (id: string, title: string, state: object) => ({
    ...paper,
    id,
    title,
    kind: 'email' as const,
    readScope: 'mail-preview',
    mailSender: 'Office <office@example.test>',
    receivedAt: '2026-09-14T10:00:00Z',
    ...state,
  });
  const history = batch('unread-filter');
  history.items = [
    mail('m1', 'Unread mail', { mailUnread: true }),
    mail('m2', 'Read mail', { mailUnread: false }),
    // Read from GOSU after the briefing: the stored flag is old, the mark is newer.
    mail('m3', 'Marked mail', { mailUnread: true, mailMarkedReadAt: '2026-09-14T11:00:00.000Z' }),
    mail('m4', 'Unknown mail', {}),
    paper,
  ];
  vi.mocked(sourceRequest).mockReset();
  vi.mocked(sourceRequest).mockResolvedValue({ history: [history] });
  await act(async () => {
    renderer = create(<BriefingHistoryView routineId="r" />);
  });
  const text = () => JSON.stringify(renderer!.toJSON());
  const button = () =>
    renderer!.root.findByProps({ className: 'briefing-button briefing-unread-filter' });
  const heading = () =>
    renderer!.root
      .findAll((node) => node.type === 'h3')
      .map((node) => node.children.filter((child) => typeof child === 'string').join(''))
      .find((value) => value.startsWith('이메일'));
  expect(button().props['aria-pressed']).toBe(false);
  expect(button().children.join('')).toBe('안 읽은 메일만');
  for (const title of ['Unread mail', 'Read mail', 'Marked mail', 'Unknown mail'])
    expect(text()).toContain(title);
  expect(heading()).toBe('이메일 · 4개 요약');
  const calls = vi.mocked(sourceRequest).mock.calls.length;
  await act(() => button().props.onClick());
  expect(button().props['aria-pressed']).toBe(true);
  expect(text()).toContain('Unread mail');
  for (const title of ['Read mail', 'Marked mail', 'Unknown mail'])
    expect(text()).not.toContain(title);
  // Papers are not mail: the filter leaves them alone.
  expect(text()).toContain('Paper detail');
  expect(heading()).toBe('이메일 · 안 읽은 1 / 4개');
  // Nothing disappears silently: a mail whose state was never recorded is counted.
  expect(text()).toContain('읽음 상태를 모르는 메일 1통은 숨겼습니다');
  // A display filter over saved state: no Mail lookup, no request at all.
  expect(vi.mocked(sourceRequest).mock.calls).toHaveLength(calls);
  await act(() => button().props.onClick());
  expect(text()).toContain('Read mail');
  expect(heading()).toBe('이메일 · 4개 요약');
});
it('says so when no mail of a briefing is unread, and offers no filter without any mail', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const history = batch('all-read');
  history.items = [
    {
      ...paper,
      id: 'm',
      title: 'Read mail',
      kind: 'email' as const,
      readScope: 'mail-preview',
      mailUnread: false,
    },
  ];
  vi.mocked(sourceRequest).mockReset();
  vi.mocked(sourceRequest).mockResolvedValue({ history: [history] });
  await act(async () => {
    renderer = create(<BriefingHistoryView routineId="r" />);
  });
  await act(() =>
    renderer!.root
      .findByProps({ className: 'briefing-button briefing-unread-filter' })
      .props.onClick(),
  );
  expect(JSON.stringify(renderer!.toJSON())).toContain('안 읽은 메일이 없습니다');
  await act(() => renderer!.unmount());
  vi.mocked(sourceRequest).mockResolvedValue({ history: [batch('papers-only')] });
  await act(async () => {
    renderer = create(<BriefingHistoryView routineId="r" />);
  });
  expect(
    renderer!.root.findAllByProps({ className: 'briefing-button briefing-unread-filter' }),
  ).toHaveLength(0);
});

// 2026-09-22 user request: a "mark all read" button per daily briefing.
it('offers "모두 읽음" in the email section of a briefing, for exactly its still-unread mail', () => {
  const history = batch('mark-all');
  const mail = (id: string, state: object) => ({
    ...paper,
    id,
    title: `Mail ${id}`,
    kind: 'email' as const,
    readScope: 'mail-preview',
    mailMessageUrl: `message://%3C${id}%40example.test%3E`,
    ...state,
  });
  history.items = [
    mail('u1', { mailUnread: true }),
    mail('u2', { mailUnread: true }),
    mail('r1', { mailUnread: false }),
    mail('r2', { mailUnread: true, mailMarkedReadAt: '2026-09-14T11:00:00.000Z' }),
    mail('x1', {}),
    paper,
  ];
  const html = renderToStaticMarkup(<BriefingHistoryFeed history={[history]} />);
  expect(html).toContain('모두 읽음 (2)');
  // In the email section's summary, not in the papers section.
  const emailSection = html.slice(html.indexOf('briefing-content-section email'));
  const summary = emailSection.slice(0, emailSection.indexOf('</summary>'));
  expect(summary).toContain('briefing-mark-all-read');
  expect(html.match(/briefing-mark-all-read/gu)).toHaveLength(1);
  // A briefing whose mail is all read has no such button.
  const read = batch('all-read-mail');
  read.items = [mail('r3', { mailUnread: false })];
  expect(renderToStaticMarkup(<BriefingHistoryFeed history={[read]} />)).not.toContain('모두 읽음');
});

it('keeps only the newest briefings in the page and brings the rest in as the reader reaches them', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const runs = Array.from({ length: BRIEFING_FEED_PAGE * 3 }, (_, index) =>
    batch(`run-${index}`, `2026-09-${String(1 + index).padStart(2, '0')}T00:00:00.000Z`),
  );
  let ui!: ReactTestRenderer;
  try {
    await act(() => {
      ui = create(<BriefingHistoryFeed history={runs} />);
    });
    const shownRuns = () => ui.root.findAllByProps({ className: 'briefing-history-run' }).length;
    const more = () => ui.root.findAllByProps({ className: 'briefing-history-more' });

    // Rendering every retained briefing at once is what made each re-render cost hundreds of ms.
    expect(shownRuns()).toBe(BRIEFING_FEED_PAGE);
    expect(JSON.stringify(ui.toJSON())).toContain(
      `이전 브리핑 ${runs.length - BRIEFING_FEED_PAGE}개 더 보기`,
    );

    await act(() => more()[0]!.findByType('button').props.onClick());
    expect(shownRuns()).toBe(BRIEFING_FEED_PAGE * 2);

    // A re-render with the same history keeps what the reader already opened.
    await act(() => {
      ui.update(<BriefingHistoryFeed history={runs} />);
    });
    expect(shownRuns()).toBe(BRIEFING_FEED_PAGE * 2);

    await act(() => more()[0]!.findByType('button').props.onClick());
    expect(shownRuns()).toBe(runs.length);
    expect(more()).toHaveLength(0);
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});

it('renders the briefing a notification points at even when it is far down the history', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const runs = Array.from({ length: BRIEFING_FEED_PAGE * 3 }, (_, index) =>
    batch(`run-${index}`, `2026-09-${String(1 + index).padStart(2, '0')}T00:00:00.000Z`),
  );
  // The oldest run: without this rule the notification would jump to a briefing that is not there.
  const target = { routineId: 'r', runId: 'run-0', requestId: 1 };
  // The jump looks the anchor up in the document; this renderer has none.
  vi.stubGlobal('document', { getElementById: () => null });
  let ui!: ReactTestRenderer;
  try {
    await act(() => {
      ui = create(<BriefingHistoryFeed history={runs} notificationTarget={target} />);
    });
    expect(ui.root.findAllByProps({ className: 'briefing-history-run' })).toHaveLength(runs.length);
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});

it('counts the runs to show without rendering, including the run a notification names', () => {
  const runs = Array.from({ length: 30 }, (_, index) => ({
    routineId: 'r',
    runId: `run-${index}`,
    id: `history-${index}`,
  }));
  expect(runsToShow(runs, BRIEFING_FEED_PAGE)).toBe(BRIEFING_FEED_PAGE);
  expect(runsToShow(runs.slice(0, 3), BRIEFING_FEED_PAGE)).toBe(3);
  expect(runsToShow(runs, 20)).toBe(20);
  expect(
    runsToShow(runs, BRIEFING_FEED_PAGE, { routineId: 'r', runId: 'run-11', requestId: 1 }),
  ).toBe(12);
  // Another routine's notification does not drag this feed open.
  expect(
    runsToShow(runs, BRIEFING_FEED_PAGE, { routineId: 'other', runId: 'run-11', requestId: 1 }),
  ).toBe(BRIEFING_FEED_PAGE);
  expect(runsToShow([], BRIEFING_FEED_PAGE)).toBe(0);
});
