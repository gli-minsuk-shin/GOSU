import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { it, expect, vi } from 'vitest';
import { createCodexModelCatalog } from '@gosu/contracts';
import { initialWorkspace } from './fixtures';
import { BriefingAnalysisPanel } from './briefing-analysis-panel';
import * as clients from './routine-client';
import * as analysisClient from './briefing-analysis-client';
it('keeps model discovery alive when new source results arrive', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let resolve!: (value: clients.RoutineConnection[]) => void;
  const models = vi.fn<clients.RoutineClient['models']>(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const spy = vi.spyOn(clients, 'createRoutineClient').mockReturnValue({ models, run: vi.fn() });
  const props = { routine: initialWorkspace().routines[0]!, memory: null, onResult: vi.fn() };
  const catalog = createCodexModelCatalog([
    { id: 'model', model: 'model', displayName: 'Native model', isDefault: true },
  ]);
  let renderer!: ReactTestRenderer;
  await act(() => {
    renderer = create(<BriefingAnalysisPanel {...props} results={[]} />);
  });
  try {
    await act(() =>
      renderer.root
        .findAllByType('button')
        .find((b) => b.children.join('') === 'GOSU LLM 연결')!
        .props.onClick(),
    );
    await act(() =>
      renderer.update(
        <BriefingAnalysisPanel
          {...props}
          results={[
            {
              kind: 'papers',
              status: 'ready',
              fetchedAt: new Date().toISOString(),
              note: 'test',
              receiptId: '11111111-1111-4111-8111-111111111111',
              items: [
                {
                  id: 'p',
                  kind: 'papers',
                  title: 'Paper',
                  text: 'Evidence',
                  readScope: 'abstract',
                  details: [],
                  source: 'test',
                },
              ],
            },
          ]}
        />,
      ),
    );
    expect(models.mock.calls[0]![0].aborted).toBe(false);
    await act(() => resolve([{ providerId: 'codex', catalog, error: null }]));
    const action = renderer.root
      .findAllByType('button')
      .find((b) => b.children.join('') === '선택한 자료 AI 요약')!;
    expect(action.props.disabled).toBe(false);
  } finally {
    await act(() => renderer.unmount());
    spy.mockRestore();
    vi.unstubAllGlobals();
  }
});
it('auto-selects email only after explicit AI transmission opt-in and shows elapsed native work without changing reasoning', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-09T00:00:00Z'));
  const catalog = createCodexModelCatalog([
    {
      id: 'model',
      model: 'model',
      displayName: 'Native model',
      isDefault: true,
      defaultReasoningEffort: 'high',
      supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
    },
  ]);
  const catalogSpy = vi.spyOn(clients, 'createRoutineClient').mockReturnValue({
    models: vi.fn(async () => [{ providerId: 'codex' as const, catalog, error: null }]),
    run: vi.fn(),
  });
  const run = vi
    .spyOn(analysisClient, 'requestBriefingAnalysis')
    .mockImplementation(async (_input, _signal, progress) => {
      progress('LLM 요약 생성 중');
      return new Promise(() => undefined);
    });
  const props = { routine: initialWorkspace().routines[0]!, memory: null, onResult: vi.fn() };
  let renderer!: ReactTestRenderer;
  await act(() => {
    renderer = create(
      <BriefingAnalysisPanel
        {...props}
        results={[
          {
            kind: 'email',
            status: 'ready',
            receiptId: '11111111-1111-4111-8111-111111111111',
            fetchedAt: new Date().toISOString(),
            note: 'fixture',
            items: [
              {
                id: 'mail',
                kind: 'email',
                title: 'Synthetic mail',
                text: 'Fixture',
                source: 'fixture',
                readScope: 'mail-preview',
                details: [],
              },
            ],
          },
        ]}
      />,
    );
  });
  const button = (text: string) =>
    renderer.root.findAllByType('button').find((b) => b.children.join('') === text)!;
  try {
    await act(() => button('GOSU LLM 연결').props.onClick());
    expect(button('선택한 자료 AI 요약').props.disabled).toBe(true);
    const consent = renderer.root.findAllByType('input').find((i) => i.props.type === 'checkbox')!;
    await act(() => consent.props.onChange({ target: { checked: true } }));
    expect(button('선택한 자료 AI 요약').props.disabled).toBe(false);
    await act(() => button('선택한 자료 AI 요약').props.onClick());
    expect(run.mock.calls[0]![0]).toMatchObject({
      itemIds: ['mail'],
      includeMail: true,
      reasoning: null,
    });
    await act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(renderer.root.findByProps({ 'data-analysis-elapsed': 5 })).toBeDefined();
    expect(JSON.stringify(renderer.toJSON())).toContain('LLM 요약 생성 중');
    await act(() => button('분석 중단').props.onClick());
    expect(run.mock.calls[0]![1].aborted).toBe(true);
  } finally {
    await act(() => renderer.unmount());
    run.mockRestore();
    catalogSpy.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
