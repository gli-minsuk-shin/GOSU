import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveBriefingView } from './live-briefing-view';
import { BriefingRunDelete } from './briefing-history-delete';
import { initialWorkspace } from './fixtures';
import { defaultLiveSettings } from '@gosu/briefing-core';
import { defaultAssistantPreferences } from '@gosu/briefing-core';
import type { collectSources } from './live-client';
import type * as LiveClientModule from './live-client';
import { sourceRequest } from './live-client';
vi.mock('./live-client', async (importOriginal) => ({
  ...(await importOriginal<typeof LiveClientModule>()),
  sourceRequest: vi.fn(async () => ({
    state: 'ready',
    count: 0,
    automatic: 0,
    revision: 0,
    lastSavedAt: null,
  })),
}));
const renderers: ReactTestRenderer[] = [];
it('does not clear a newer live briefing when deletion of an older receipt finishes late', async () => {
  const oldId = '11111111-1111-4111-8111-111111111111',
    newId = '22222222-2222-4222-8222-222222222222';
  const routine = {
    ...initialWorkspace().routines[0]!,
    live: {
      ...defaultLiveSettings(),
      assistant: { ...defaultAssistantPreferences(), autoPaperSummary: false },
    },
  };
  const item = {
    kind: 'papers' as const,
    status: 'empty' as const,
    fetchedAt: '2026-09-10T00:00:00Z',
    items: [],
    note: '',
  };
  const collect = vi.fn<typeof collectSources>().mockResolvedValue([{ ...item, receiptId: newId }]);
  let ui!: ReactTestRenderer;
  await act(() => {
    ui = create(
      <LiveBriefingView
        routine={routine}
        onSettings={vi.fn()}
        initialResults={[{ ...item, receiptId: oldId }]}
        collect={collect}
      />,
    );
  });
  renderers.push(ui);
  const lateDelete = ui.root.findByType(BriefingRunDelete).props.onDeleted;
  await act(() =>
    ui.root
      .findAllByType('button')
      .find((b) => b.children.includes('지금 실제 자료 조회'))!
      .props.onClick(),
  );
  await act(() =>
    lateDelete({ deletionId: oldId, routineId: routine.id, runId: oldId, historyIds: [] }),
  );
  expect(ui.root.findByType(BriefingRunDelete).props.target.runId).toBe(newId);
});
it('shows the first-connection limit explanation beside the live email results', async () => {
  const routine = {
    ...initialWorkspace().routines[0]!,
    live: {
      ...defaultLiveSettings(),
      assistant: { ...defaultAssistantPreferences(), autoPaperSummary: false },
    },
  };
  const notice = '첫 연결 확인을 위해 최대 3개만 가져옵니다. 다음부터 최대 50개.';
  const collect = vi.fn<typeof collectSources>().mockResolvedValue([
    {
      kind: 'email',
      fetchedAt: '2026-09-10T00:00:00Z',
      status: 'empty',
      items: [],
      note: '',
      notice,
    },
  ]);
  let ui!: ReactTestRenderer;
  await act(() => {
    ui = create(<LiveBriefingView routine={routine} onSettings={vi.fn()} collect={collect} />);
  });
  renderers.push(ui);
  await act(() =>
    ui.root
      .findAllByType('button')
      .find((b) => b.children.includes('지금 실제 자료 조회'))!
      .props.onClick(),
  );
  expect(JSON.stringify(ui.toJSON())).toContain(notice);
});
it('places the new briefing date first and retains previous briefings below the new collection', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockImplementation(async (path) =>
    path === '/history/list'
      ? {
          history: [
            {
              id: 'old',
              routineId: 'r',
              createdAt: '2026-09-08T00:00:00Z',
              kind: 'briefing',
              answer: 'Previous briefing must remain',
              items: [],
              private: false,
            },
          ],
        }
      : { choices: {}, state: 'ready' },
  );
  const routine = {
    ...initialWorkspace().routines[0]!,
    id: 'r',
    live: {
      ...defaultLiveSettings(),
      assistant: { ...defaultAssistantPreferences(), autoPaperSummary: false, calendarRead: false },
    },
  };
  const collect = vi.fn<typeof collectSources>().mockResolvedValue([
    {
      kind: 'papers',
      fetchedAt: '2026-09-10T00:00:00Z',
      status: 'empty',
      items: [],
      note: '',
      receiptId: 'new-run',
    },
  ]);
  let ui!: ReactTestRenderer;
  await act(async () => {
    ui = create(<LiveBriefingView routine={routine} onSettings={vi.fn()} collect={collect} />);
  });
  renderers.push(ui);
  expect(JSON.stringify(ui.toJSON())).toContain('Previous briefing must remain');
  await act(async () =>
    ui.root
      .findAllByType('button')
      .find((b) => b.children.includes('지금 실제 자료 조회'))!
      .props.onClick(),
  );
  const html = JSON.stringify(ui.toJSON());
  expect(html).toContain('Previous briefing must remain');
  expect(html).toContain('2026년 9월 10일');
  expect(html).toContain('2026년 9월 8일');
  expect(html.indexOf('2026년 9월 10일')).toBeLessThan(html.indexOf('AI ASSISTANT SUMMARY'));
  expect(html).not.toContain('화면 결과 지우기');
});
it('keeps the live briefing unobstructed by the separate saved paper library even when arXiv fails', async () => {
  vi.mocked(sourceRequest).mockImplementationOnce(async () => ({
    papers: [
      {
        historyId: 'h',
        savedAt: '2026-09-08T00:00:00Z',
        item: {
          id: 'p',
          kind: 'papers',
          title: 'Offline saved paper',
          summary: 'Readable cached result',
          importance: 'high',
          relevance: '',
          readScope: 'abstract',
        },
      },
    ],
    feedback: {},
  }));
  const routine = {
    ...initialWorkspace().routines[0]!,
    live: {
      ...defaultLiveSettings(),
      assistant: { ...defaultAssistantPreferences(), autoPaperSummary: false, mailAi: false },
    },
  };
  const collect = vi.fn<typeof collectSources>();
  let ui!: ReactTestRenderer;
  await act(() => {
    ui = create(
      <LiveBriefingView
        routine={routine}
        onSettings={vi.fn()}
        collect={collect}
        initialResults={[
          {
            kind: 'papers',
            status: 'failed',
            fetchedAt: '2026-09-09T00:00:00Z',
            items: [],
            note: 'Discovery failed',
            error: 'arXiv 요청 제한',
          },
        ]}
      />,
    );
  });
  renderers.push(ui);
  const html = JSON.stringify(ui.toJSON());
  expect(html).toContain('arXiv 요청 제한');
  expect(html).not.toContain('Offline saved paper');
  expect(html).not.toContain('저장된 논문 요약');
  expect(vi.mocked(sourceRequest).mock.calls.some(([path]) => path === '/papers/saved')).toBe(
    false,
  );
  expect(collect).not.toHaveBeenCalled();
});
afterEach(async () => {
  await act(() => {
    renderers.splice(0).forEach((r) => r.unmount());
  });
  vi.unstubAllGlobals();
});
it('does not auto-fetch; uses saved routine filters and renders empty and failure separately', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const storage = vi.fn();
  vi.stubGlobal('localStorage', { setItem: storage });
  const routine = { ...initialWorkspace().routines[0]!, live: defaultLiveSettings() };
  const collect = vi.fn<typeof collectSources>(async () => [
    {
      kind: 'papers',
      status: 'empty',
      fetchedAt: new Date().toISOString(),
      items: [],
      note: 'arXiv 실제 검색 결과',
    },
  ]);
  let renderer!: ReactTestRenderer;
  await act(() => {
    renderer = create(
      <LiveBriefingView routine={routine} onSettings={vi.fn()} collect={collect} />,
    );
  });
  renderers.push(renderer);
  expect(collect).not.toHaveBeenCalled();
  await act(() =>
    renderer.root
      .findAllByType('button')
      .find((b) => b.children.join('') === '지금 실제 자료 조회')!
      .props.onClick(),
  );
  expect(collect.mock.calls[0]![0]).toEqual({
    routineId: routine.id,
    live: routine.live,
    interest: routine.interest,
  });
  expect(JSON.stringify(renderer.toJSON())).toContain('조건에 맞는 결과가 없습니다.');
  expect(storage).not.toHaveBeenCalled();
});
it('shows collection percentage and active source before the sequential AI summary begins', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const routine = {
    ...initialWorkspace().routines[0]!,
    live: { ...defaultLiveSettings(), papers: { ...defaultLiveSettings().papers, enabled: true } },
  };
  const collect = vi.fn<typeof collectSources>(async (_input, _signal, onProgress) => {
    onProgress({ kind: 'papers', state: 'started' });
    return new Promise<never>(() => undefined);
  });
  let renderer!: ReactTestRenderer;
  await act(() => {
    renderer = create(
      <LiveBriefingView routine={routine} onSettings={vi.fn()} collect={collect} />,
    );
  });
  renderers.push(renderer);
  await act(() =>
    renderer.root
      .findAllByType('button')
      .find((b) => b.children.join('') === '지금 실제 자료 조회')!
      .props.onClick(),
  );
  const progressbar = renderer.root
    .findAllByProps({ role: 'progressbar' })
    .find((node) => node.props.className.includes('collection'));
  expect(progressbar?.props['aria-valuenow']).toBe(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('연구 논문 실제 소스 조회 중');
});
it('preserves collected source receipts in the parent session so returning from another tab restores the results', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const source = {
    kind: 'papers' as const,
    status: 'ready' as const,
    receiptId: '11111111-1111-4111-8111-111111111111',
    fetchedAt: new Date().toISOString(),
    items: [
      {
        id: 'paper',
        kind: 'papers' as const,
        title: 'Restored paper',
        text: 'Evidence',
        source: 'arXiv',
        readScope: 'abstract' as const,
        details: [],
      },
    ],
    note: 'restorable source',
  };
  const routine = {
    ...initialWorkspace().routines[0]!,
    live: {
      ...defaultLiveSettings(),
      assistant: { ...defaultAssistantPreferences(), autoPaperSummary: false },
    },
  };
  let saved = [] as (typeof source)[];
  const collect = vi.fn<typeof collectSources>(async () => [source]);
  let renderer!: ReactTestRenderer;
  await act(() => {
    renderer = create(
      <LiveBriefingView
        routine={routine}
        onSettings={vi.fn()}
        collect={collect}
        onResultsChange={(next) => {
          saved = next as typeof saved;
        }}
      />,
    );
  });
  renderers.push(renderer);
  await act(() =>
    renderer.root
      .findAllByType('button')
      .find((b) => b.children.join('') === '지금 실제 자료 조회')!
      .props.onClick(),
  );
  expect(saved[0]?.receiptId).toBe(source.receiptId);
  await act(() => renderer.unmount());
  await act(() => {
    renderer = create(
      <LiveBriefingView
        routine={routine}
        onSettings={vi.fn()}
        collect={collect}
        initialResults={saved}
        onResultsChange={(next) => {
          saved = next as typeof saved;
        }}
      />,
    );
  });
  renderers.push(renderer);
  expect(JSON.stringify(renderer.toJSON())).toContain('Restored paper');
});
it('does not abort source collection merely because the live tab unmounts', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const routine = {
    ...initialWorkspace().routines[0]!,
    live: {
      ...defaultLiveSettings(),
      assistant: { ...defaultAssistantPreferences(), autoPaperSummary: false },
    },
  };
  const source = {
    kind: 'papers' as const,
    status: 'ready' as const,
    receiptId: '22222222-2222-4222-8222-222222222222',
    fetchedAt: new Date().toISOString(),
    items: [],
    note: 'source',
  };
  let resolve!: (value: (typeof source)[]) => void;
  const collect = vi.fn<typeof collectSources>(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const saved = vi.fn();
  let renderer!: ReactTestRenderer;
  await act(() => {
    renderer = create(
      <LiveBriefingView
        routine={routine}
        onSettings={vi.fn()}
        collect={collect}
        onResultsChange={saved}
      />,
    );
  });
  await act(() =>
    renderer.root
      .findAllByType('button')
      .find((b) => b.children.join('') === '지금 실제 자료 조회')!
      .props.onClick(),
  );
  await act(() => renderer.unmount());
  await act(async () => {
    resolve([source]);
    await Promise.resolve();
  });
  expect(saved).toHaveBeenCalledWith([source]);
});
