import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, it, expect, vi } from 'vitest';
import { AutomaticSummary, mergeAnalyses } from './automatic-summary';
import {
  startAutomaticSummary,
  automaticSummaryStatus,
  cancelAutomaticSummary,
} from './automatic-summary-client';
import { initialWorkspace } from './fixtures';
import { defaultLiveSettings, defaultAssistantPreferences } from '@gosu/briefing-core';
import type { AnalysisResult } from './briefing-analysis-client';
vi.mock('./automatic-summary-client', () => ({
  startAutomaticSummary: vi.fn(async () => ({
    id: 'job-0000-0000-0000-000000000001',
    routineId: 'r',
    receiptId: 'receipt',
    state: 'complete',
    percent: 100,
    completed: 8,
    total: 8,
    kind: 'done',
    range: '8/8',
    detail: '완료',
    results: [],
    error: null,
    updatedAt: 1,
  })),
  automaticSummaryStatus: vi.fn(async () => ({
    id: 'job-0000-0000-0000-000000000001',
    routineId: 'r',
    receiptId: 'receipt',
    state: 'complete',
    percent: 100,
    completed: 8,
    total: 8,
    kind: 'done',
    range: '8/8',
    detail: '완료',
    results: [],
    error: null,
    updatedAt: 1,
  })),
  cancelAutomaticSummary: vi.fn(async () => undefined),
}));
let renderer: ReactTestRenderer;
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const routine = () => ({
  ...initialWorkspace().routines[0]!,
  live: { ...defaultLiveSettings(), assistant: defaultAssistantPreferences() },
});
const results = [
  {
    kind: 'papers' as const,
    status: 'ready' as const,
    receiptId: 'receipt',
    fetchedAt: 'now',
    note: 'arXiv',
    items: Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      title: 'paper',
      kind: 'papers' as const,
      text: 'evidence',
      source: 'arXiv',
      readScope: 'abstract' as const,
      details: [],
    })),
  },
];
it('starts one backend-owned job and does not restart it on unrelated renders', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const r = routine(),
    emit = vi.fn();
  await act(() => {
    renderer = create(<AutomaticSummary routine={r} results={results} onResult={emit} />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(startAutomaticSummary).toHaveBeenCalledOnce();
  expect(automaticSummaryStatus).not.toHaveBeenCalled();
  await act(() =>
    renderer.update(<AutomaticSummary routine={r} results={results} onResult={emit} />),
  );
  expect(startAutomaticSummary).toHaveBeenCalledOnce();
});
it('turning auto-paper off makes no backend job request', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const r = routine();
  r.live.assistant.mailRead = true;
  r.live.assistant.mailAi = true;
  r.live.assistant.autoPaperSummary = false;
  await act(() => {
    renderer = create(<AutomaticSummary routine={r} results={results} onResult={vi.fn()} />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(startAutomaticSummary).not.toHaveBeenCalled();
});
it('does not report a successful 100% summary when source collection failed', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const progress = vi.fn();
  await act(() => {
    renderer = create(
      <AutomaticSummary
        routine={routine()}
        results={results.map((r) => ({ ...r, status: 'failed', items: [] }))}
        onResult={vi.fn()}
        onProgress={progress}
      />,
    );
  });
  expect(startAutomaticSummary).not.toHaveBeenCalled();
  expect(progress).toHaveBeenCalledWith(
    expect.objectContaining({
      percent: 0,
      total: 0,
      detail: expect.stringContaining('조회가 실패'),
    }),
  );
});
it('reconnects after a tab remount and never treats unmount as user cancellation', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const r = routine();
  r.live.assistant.mailRead = true;
  r.live.assistant.mailAi = true;
  vi.mocked(startAutomaticSummary).mockResolvedValue({
    id: 'job-0000-0000-0000-000000000001',
    routineId: r.id,
    receiptId: 'receipt',
    state: 'running',
    percent: 25,
    completed: 1,
    total: 4,
    kind: 'email',
    range: '1/4',
    detail: '이메일 요약 중',
    results: [],
    error: null,
    updatedAt: 1,
  });
  vi.mocked(automaticSummaryStatus).mockImplementation(async () => new Promise(() => {}));
  const mixed = [
    {
      ...results[0]!,
      items: [
        { ...results[0]!.items[0]!, kind: 'email' as const, readScope: 'mail-preview' as const },
      ],
    },
  ];
  await act(() => {
    renderer = create(<AutomaticSummary routine={r} results={mixed} onResult={vi.fn()} />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(startAutomaticSummary).toHaveBeenCalledOnce();
  await act(() => renderer.unmount());
  expect(cancelAutomaticSummary).not.toHaveBeenCalled();
  expect(automaticSummaryStatus).not.toHaveBeenCalled();
  await act(() => {
    renderer = create(<AutomaticSummary routine={r} results={mixed} onResult={vi.fn()} />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(startAutomaticSummary).toHaveBeenCalledTimes(2);
});
it('merges separate email/paper summary results without discarding earlier source receipts', () => {
  const a = { items: [{ id: 'a' }], evidence: [{ id: 'a' }] } as AnalysisResult,
    b = { items: [{ id: 'b' }], evidence: [{ id: 'b' }] } as AnalysisResult;
  expect(mergeAnalyses(a, b).items.map((i) => i.id)).toEqual(['a', 'b']);
  expect(mergeAnalyses(a, b).evidence.map((i) => i.id)).toEqual(['a', 'b']);
});
