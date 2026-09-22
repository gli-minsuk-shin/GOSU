import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BriefingGenerationControls } from './briefing-generation-controls';
import {
  BriefingHistoryFeed,
  BriefingHistoryItem,
  groupBriefingHistory,
} from './briefing-history-view';
import { sourceRequest } from './live-client';
import type { BriefingHistory } from '../briefing-workspace-store';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let ui: ReactTestRenderer;
it("keeps the idle header compact, with the last run's recorded reason one click away", async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    intervalHours: 4,
    nextDueAt: '2026-09-14T07:00:00Z',
    scheduleError: null,
    job: {
      id: 'j',
      state: 'complete',
      newCount: 0,
      detail: '일부 자료 확인 필요 · 0개 추가 · 기존 브리핑 유지',
      error: '공개 논문 출처 일부가 응답하지 않았습니다.',
    },
  });
  await act(() => {
    ui = create(<BriefingGenerationControls routineId="r" />);
  });
  expect(ui.root.findByType('select').props.value).toBe(4);
  expect(ui.root.findAllByProps({ className: 'briefing-generation-status' })).toHaveLength(0);
  // 2026-09-21: a completed run whose only problem was a source that failed showed nothing, so
  // the user could not learn why the email section stayed empty. The reason is now a collapsed
  // line, never the old completion or next-run text.
  expect(ui.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
  expect(JSON.stringify(ui.toJSON())).toContain('최근 브리핑 · 확인할 내용 있음');
  expect(JSON.stringify(ui.toJSON())).toContain('공개 논문 출처');
  expect(JSON.stringify(ui.toJSON())).not.toContain('기존 브리핑 유지');
});
it('names an unread email source in the collapsed reason of a completed run', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    intervalHours: 4,
    nextDueAt: null,
    scheduleError: null,
    job: {
      id: 'j',
      state: 'complete',
      newCount: 0,
      emailSourceState: 'failed',
      detail: '일부 자료 확인 필요 · 0개 추가 · 기존 브리핑 유지',
      error: 'Apple Mail이 5분 동안 응답하지 않아 메일을 읽지 못했습니다.',
    },
  });
  await act(() => {
    ui = create(<BriefingGenerationControls routineId="r" />);
  });
  expect(JSON.stringify(ui.toJSON())).toContain('최근 브리핑 · 이메일 조회 실패');
  expect(JSON.stringify(ui.toJSON())).toContain('5분 동안 응답하지 않아');
});
it('shows why the most recent generation failed after its progress view closes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    intervalHours: 4,
    nextDueAt: null,
    scheduleError: null,
    job: {
      id: 'j',
      state: 'failed',
      newCount: 0,
      detail: '브리핑 생성 중 일부 작업을 완료하지 못했습니다.',
      error: 'AI 요약 응답 시간이 초과됐습니다.',
    },
  });
  await act(() => {
    ui = create(<BriefingGenerationControls routineId="r" />);
  });
  const alerts = ui.root.findAllByProps({ role: 'alert' });
  expect(alerts).toHaveLength(1);
  expect(JSON.stringify(ui.toJSON())).toContain('최근 브리핑 실패');
  expect(JSON.stringify(ui.toJSON())).toContain('AI 요약 응답 시간이 초과됐습니다.');
});
it('reports failed AI summary batches of a run that otherwise completed', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    intervalHours: 4,
    nextDueAt: null,
    scheduleError: null,
    job: {
      id: 'j',
      state: 'complete',
      newCount: 6,
      summaryFailures: 1,
      detail: '일부 자료 확인 필요 · 6개 추가 · 기존 브리핑 유지',
      error: '논문 7–10번째 요약 실패: AI 요약 응답 시간이 초과됐습니다.',
    },
  });
  await act(() => {
    ui = create(<BriefingGenerationControls routineId="r" />);
  });
  expect(ui.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
  expect(JSON.stringify(ui.toJSON())).toContain('AI 요약');
  expect(JSON.stringify(ui.toJSON())).toContain('논문 7–10번째 요약 실패');
});
it('reports mailbox intervals a completed run could not examine', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    intervalHours: 4,
    nextDueAt: null,
    scheduleError: null,
    job: {
      id: 'j',
      state: 'complete',
      newCount: 3,
      mailCoverageGaps: 1,
      detail: '일부 자료 확인 필요 · 3개 추가 · 기존 브리핑 유지',
      error: '메일 미확인 구간 · Gmail 9/17 09:00–13:00 · 다음 브리핑에서 이어서 확인합니다.',
    },
  });
  await act(() => {
    ui = create(<BriefingGenerationControls routineId="r" />);
  });
  expect(ui.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
  expect(JSON.stringify(ui.toJSON())).toContain('메일 미확인 구간 1곳');
  expect(JSON.stringify(ui.toJSON())).toContain('Gmail 9/17 09:00–13:00');
});
it('reports a run that read Mail the slow way because its index was unavailable', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    intervalHours: 4,
    nextDueAt: null,
    scheduleError: null,
    job: {
      id: 'j',
      state: 'complete',
      newCount: 3,
      mailIndexFallback: true,
      detail: '3개 추가',
      error:
        'Apple Mail 색인을 읽을 권한이 없어 메일함 전체를 확인하는 느린 방식으로 조회했습니다.',
    },
  });
  await act(() => {
    ui = create(<BriefingGenerationControls routineId="r" />);
  });
  expect(ui.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
  expect(JSON.stringify(ui.toJSON())).toContain('메일 빠른 조회 불가');
  expect(JSON.stringify(ui.toJSON())).toContain('색인을 읽을 권한이 없어');
});
it('reports summaries rejected by validation in a run that saved the rest', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    intervalHours: 4,
    nextDueAt: null,
    scheduleError: null,
    job: {
      id: 'j',
      state: 'complete',
      newCount: 5,
      summaryRejectedItems: 1,
      detail: '5개 추가',
      error: '이메일 1–6번째 중 1통 요약 검증 실패',
    },
  });
  await act(() => {
    ui = create(<BriefingGenerationControls routineId="r" />);
  });
  expect(ui.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
  expect(JSON.stringify(ui.toJSON())).toContain('요약 검증 실패 1개');
});
it('keeps long run warnings and a paused schedule to one closed line until opened', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const long = Array.from(
    { length: 12 },
    (_, i) => `논문 ${i * 6 + 1}–${i * 6 + 6}번째 요약 실패: 이유 ${i}.`,
  ).join(' ');
  vi.mocked(sourceRequest).mockResolvedValue({
    intervalHours: 4,
    nextDueAt: null,
    scheduleError:
      '설정 또는 권한 확인이 필요해 자동 생성을 일시 중지했습니다. 바뀐 설정으로 계속하려면 같은 간격을 다시 선택해주세요.',
    job: {
      id: 'j',
      state: 'complete',
      newCount: 3,
      summaryFailures: 4,
      mailIndexFallback: true,
      detail: '3개 추가',
      error: long,
    },
  });
  await act(() => {
    ui = create(<BriefingGenerationControls routineId="r" />);
  });
  const alerts = ui.root.findAll(
    (node) =>
      node.type === 'details' && String(node.props.className).includes('briefing-generation-alert'),
  );
  expect(alerts).toHaveLength(2);
  // Closed by default: only the summary line shows until the user opens it.
  for (const alert of alerts) expect(alert.props.open).toBeFalsy();
  const [run, schedule] = alerts;
  expect(run!.findByType('summary').props.role).toBe('alert');
  expect(run!.findByType('summary').findByType('span').props.children).toContain(
    '최근 브리핑 · AI 요약 4묶음 실패 · 메일 빠른 조회 불가',
  );
  expect(run!.findByType('summary').findByType('span').props.children).not.toContain('이유 11');
  // The opened reason is a div, never a <p>: inside the main header every <p> is hidden by the
  // compact layout, which left the reason invisible after the click (2026-09-21).
  expect(run!.findAllByType('p')).toHaveLength(0);
  expect(run!.findByProps({ className: 'briefing-generation-alert-detail' }).props.children).toBe(
    long,
  );
  expect(schedule!.findByType('summary').findByType('span').props.children).toContain(
    '자동 브리핑 일시 중지 · 설정 확인 필요',
  );
  expect(
    schedule!.findByProps({ className: 'briefing-generation-alert-detail' }).props.children,
  ).toContain('같은 간격을 다시 선택');
});
it('still reports a failed explicit generation request instead of hiding action failures', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest)
    .mockResolvedValueOnce({ intervalHours: 4, nextDueAt: null, scheduleError: null, job: null })
    .mockRejectedValueOnce(Error('생성 요청 실패'));
  await act(() => {
    ui = create(<BriefingGenerationControls routineId="r" />);
  });
  await act(() => ui.root.findByProps({ 'aria-label': '브리핑 생성' }).props.onClick());
  expect(ui.root.findByProps({ role: 'alert' }).children.join('')).toContain('생성 요청 실패');
});
it('keeps collapse and generation actions together in one row above the progress disclosure', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    intervalHours: 4,
    nextDueAt: null,
    scheduleError: null,
    job: null,
  });
  await act(async () => {
    ui = create(
      <BriefingGenerationControls
        routineId="r"
        leadingControls={<button aria-label="모두 접기" />}
      />,
    );
  });
  const row = ui.root.findByProps({ className: 'briefing-generation-buttons' });
  expect(row.findByProps({ 'aria-label': '모두 접기' })).toBeDefined();
  expect(row.findByProps({ 'aria-label': '브리핑 생성' })).toBeDefined();
  expect(row.findByType('select')).toBeDefined();
});
it('shows loading rather than off until the persisted interval is restored', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let resolve!: (value: unknown) => void;
  vi.mocked(sourceRequest).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await act(async () => {
    ui = create(<BriefingGenerationControls routineId="r" />);
  });
  expect(ui.root.findByType('select').props.value).toBe('');
  expect(ui.root.findByType('select').props.disabled).toBe(true);
  await act(async () =>
    resolve({
      intervalHours: 4,
      nextDueAt: '2026-09-14T08:00:00Z',
      scheduleError: null,
      job: null,
    }),
  );
  expect(ui.root.findByType('select').props.value).toBe(4);
  expect(sourceRequest).toHaveBeenCalledTimes(1);
});
it('keeps an updated daily briefing above newer legacy runs without changing its original daily header date', () => {
  const base = { routineId: 'r', kind: 'briefing' as const, private: false, answer: '', items: [] };
  const groups = groupBriefingHistory([
    {
      ...base,
      id: 'daily',
      createdAt: '2026-09-10T00:00:00Z',
      snapshot: {
        collectedAt: '2026-09-10T00:00:00Z',
        routineName: 'Fixture',
        timeZone: 'Asia/Seoul',
        sources: [],
        daily: { date: '2026-09-10', updatedAt: '2026-09-10T08:00:00Z' },
      },
    },
    { ...base, id: 'legacy', createdAt: '2026-09-10T06:00:00Z' },
  ]);
  expect(groups[0]?.batches[0]?.id).toBe('daily');
  expect(groups[0]?.createdAt).toBe('2026-09-10T00:00:00Z');
});
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('updates elapsed time locally, polls progress at two seconds and hides it after completion', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const job = {
    id: 'j',
    routineId: 'r',
    runId: null,
    state: 'running',
    detail: '요약 중',
    newCount: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    progress: { stage: 'summarize', completed: 0, total: 6 },
  };
  const view = { intervalHours: 0, nextDueAt: null, scheduleError: null, job };
  vi.mocked(sourceRequest).mockResolvedValue(view);
  await act(() => {
    ui = create(<BriefingGenerationControls routineId="r" />);
  });
  expect(ui.root.findByType('progress').props.value).toBe(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(ui.root.findAllByType('span').some((node) => node.children.join('') === '경과 1초')).toBe(
    true,
  );
  expect(sourceRequest).toHaveBeenCalledTimes(1);
  vi.mocked(sourceRequest).mockResolvedValue({
    ...view,
    job: { ...job, state: 'complete', detail: '6개 완료' },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(sourceRequest).toHaveBeenCalledTimes(2);
  expect(ui.root.findAllByType('progress')).toHaveLength(0);
});
it('reloads the history as soon as the quick first briefing is saved, before any summary count changes', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const dispatched: string[] = [];
  vi.stubGlobal('window', {
    dispatchEvent: (event: Event) => dispatched.push(event.type),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  const job = {
    id: 'j',
    routineId: 'r',
    runId: null,
    state: 'running',
    detail: '요약 중',
    newCount: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    progress: { stage: 'summarize', completed: 0, total: 6 },
  };
  const view = { intervalHours: 0, nextDueAt: null, scheduleError: null, job };
  vi.mocked(sourceRequest).mockResolvedValue(view);
  await act(() => {
    ui = create(<BriefingGenerationControls routineId="r" />);
  });
  const before = dispatched.length;
  vi.mocked(sourceRequest).mockResolvedValue({
    ...view,
    job: { ...job, quickBriefingAt: new Date().toISOString() },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(dispatched.length).toBe(before + 1);
  vi.unstubAllGlobals();
});
it('starts generation directly with one icon click, rejects double clicks, and configures hour intervals without starting on mount', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    intervalHours: 0,
    nextDueAt: null,
    scheduleError: null,
    job: null,
  });
  await act(() => {
    ui = create(<BriefingGenerationControls routineId="r" />);
  });
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual(['/generation/status']);
  const start = ui.root.findByProps({ 'aria-label': '브리핑 생성' });
  expect(start.findAllByType('svg')).toHaveLength(1);
  await act(() => {
    start.props.onClick();
    start.props.onClick();
  });
  expect(
    vi.mocked(sourceRequest).mock.calls.filter(([p]) => p === '/generation/start'),
  ).toHaveLength(1);
  expect(vi.mocked(sourceRequest).mock.calls.some(([p]) => p === '/collect')).toBe(false);
  await act(() =>
    ui.root
      .findByProps({ 'aria-label': '자동 브리핑 간격' })
      .props.onChange({ target: { value: '4' } }),
  );
  expect(sourceRequest).toHaveBeenCalledWith(
    '/generation/schedule',
    { routineId: 'r', intervalHours: 4 },
    expect.any(AbortSignal),
  );
  expect(
    ui.root
      .findByType('select')
      .findAllByType('option')
      .map((n) => n.props.value),
  ).toEqual([0, 1, 2, 4, 6, 12, 24]);
});
it('shows New on added email/papers, preserves existing items and persists explicit acknowledgement without clearing later additions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const values = new Map<string, string>();
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  });
  const item = {
    id: 'new',
    title: 'New paper',
    readScope: 'abstract',
    kind: 'papers' as const,
    summary: 'Summary',
    importance: 'medium',
    relevance: '',
    addedAt: '2026-09-10T04:00:00Z',
  };
  const history: BriefingHistory[] = [
    {
      id: 'h',
      routineId: 'r',
      runId: '11111111-1111-4111-8111-111111111111',
      createdAt: '2026-09-10T00:00:00Z',
      kind: 'briefing',
      private: false,
      answer: '',
      items: [item, { ...item, id: 'old', title: 'Old paper', addedAt: undefined }],
      snapshot: {
        collectedAt: '2026-09-10T00:00:00Z',
        timeZone: 'Asia/Seoul',
        routineName: 'Fixture',
        daily: { date: '2026-09-10', updatedAt: '2026-09-10T04:00:00Z' },
        sources: [],
      },
    },
  ];
  await act(() => {
    ui = create(<BriefingHistoryFeed history={history} />);
  });
  expect(ui.root.findAllByType(BriefingHistoryItem).map((n) => n.props.isNew)).toEqual([
    true,
    false,
  ]);
  await act(() => ui.root.findByProps({ className: 'briefing-new-ack' }).props.onClick());
  expect(ui.root.findAllByType(BriefingHistoryItem).every((n) => !n.props.isNew)).toBe(true);
  expect(values.size).toBe(1);
  await act(() => ui.unmount());
  const more = structuredClone(history);
  more[0]!.items.push({
    ...item,
    id: 'new-mail',
    title: 'New mail',
    kind: 'email',
    readScope: 'mail-metadata',
    addedAt: '2026-09-10T06:00:00Z',
  });
  await act(() => {
    ui = create(<BriefingHistoryFeed history={more} />);
  });
  expect(
    ui.root
      .findAllByType(BriefingHistoryItem)
      .filter((n) => n.props.isNew)
      .map((n) => n.props.item.id),
  ).toEqual(['new-mail']);
  // A subsequent generation with no additions expires the previous New badges without a click.
  more[0]!.snapshot!.newItemsSince = '2026-09-10T08:00:00Z';
  await act(() => ui.update(<BriefingHistoryFeed history={structuredClone(more)} />));
  expect(ui.root.findAllByType(BriefingHistoryItem).every((n) => !n.props.isNew)).toBe(true);
  expect(ui.root.findAllByProps({ className: 'briefing-new-ack' })).toHaveLength(0);
  more[0]!.items.push({ ...item, id: 'latest', addedAt: '2026-09-10T08:00:00Z' });
  await act(() => ui.update(<BriefingHistoryFeed history={structuredClone(more)} />));
  expect(
    ui.root
      .findAllByType(BriefingHistoryItem)
      .filter((n) => n.props.isNew)
      .map((n) => n.props.item.id),
  ).toEqual(['latest']);
  await act(() => ui.unmount());
  await act(() => {
    ui = create(<BriefingHistoryFeed history={structuredClone(more)} />);
  });
  expect(
    ui.root
      .findAllByType(BriefingHistoryItem)
      .filter((n) => n.props.isNew)
      .map((n) => n.props.item.id),
  ).toEqual(['latest']);
});

const routineSchedule = {
  frequency: 'daily' as const,
  interval: 1,
  anchorDate: '2026-09-01',
  timeZone: 'Asia/Seoul',
  times: ['08:00', '18:00'],
  weekdays: [],
  monthDay: 1,
};

it('offers the routine delivery times beside the interval and keeps the saved times current', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // The fake server answers with what the last schedule request saved, as the real one does.
  let saved: unknown = null;
  vi.mocked(sourceRequest).mockImplementation(async (path: string, body?: unknown) => {
    if (path === '/generation/schedule')
      saved = (body as { routineSchedule?: unknown }).routineSchedule ?? null;
    return {
      intervalHours: 4,
      routineSchedule: saved,
      nextDueAt: '2026-09-14T07:00:00Z',
      scheduleError: null,
      job: null,
    };
  });
  await act(() => {
    ui = create(<BriefingGenerationControls routineId="r" routineSchedule={routineSchedule} />);
  });
  const toggle = ui.root.findByType('input');
  expect(toggle.props.type).toBe('checkbox');
  expect(toggle.props.checked).toBe(false);
  expect(JSON.stringify(ui.toJSON())).toContain('루틴 시각 (');
  expect(JSON.stringify(ui.toJSON())).toContain('08:00, 18:00');
  // The idle header stays compact: the next run is a tooltip, not another line.
  expect(JSON.stringify(ui.toJSON())).not.toContain('다음 자동 브리핑');
  expect(JSON.stringify(ui.toJSON())).toContain('다음 실행');

  // Ticking it saves the routine's own schedule next to the interval.
  await act(async () => toggle.props.onChange({ target: { checked: true } }));
  expect(vi.mocked(sourceRequest).mock.calls.at(-1)).toEqual([
    '/generation/schedule',
    { routineId: 'r', intervalHours: 4, routineSchedule },
    expect.anything(),
  ]);

  // Editing the routine times in settings updates what runs, without another click.
  const edited = { ...routineSchedule, times: ['07:30'] };
  await act(async () => {
    ui.update(<BriefingGenerationControls routineId="r" routineSchedule={edited} />);
  });
  await act(async () => undefined);
  expect(vi.mocked(sourceRequest).mock.calls.at(-1)?.[1]).toEqual({
    routineId: 'r',
    intervalHours: 4,
    routineSchedule: edited,
  });

  // Unticking removes only the times.
  await act(async () => ui.root.findByType('input').props.onChange({ target: { checked: false } }));
  expect(vi.mocked(sourceRequest).mock.calls.at(-1)?.[1]).toMatchObject({
    intervalHours: 4,
    routineSchedule: null,
  });
});
