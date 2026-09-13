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
