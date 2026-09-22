import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { BriefingApp } from './briefing-app';
import { BriefingHistoryItem, BriefingHistoryView } from './briefing-history-view';
import { RoutineCopilot } from './routine-copilot';
import { initialWorkspace } from './fixtures';
import { runFixture, saveWorkspace, loadWorkspace } from './state';
import { withoutSampleContent } from './workspace-defaults';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({
  sourceRequest: vi.fn(async () => ({ saved: true, history: [] })),
  collectSources: vi.fn(async () => []),
}));
vi.mock('./routine-client', () => ({ createRoutineClient: () => ({ models: async () => [] }) }));

const NOW = '2026-09-08T10:00:00.000Z';
const renderers: ReactTestRenderer[] = [];
const text = (node: ReactTestInstance) =>
  node.children.filter((child) => typeof child === 'string').join('');
const button = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.findAllByType('button').find((node) => text(node) === label)!;
const field = (renderer: ReactTestRenderer, label: string) => {
  const node = renderer.root
    .findAllByType('label')
    .find(
      (candidate) =>
        candidate.props.className === 'briefing-field' &&
        text(candidate.findAllByType('span')[0]!) === label,
    )!;
  return [...node.findAllByType('input'), ...node.findAllByType('select')][0]!;
};
const content = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON());
async function click(node: ReactTestInstance) {
  await act(() => node.props.onClick());
}
it('retains the History component and its expanded-item state when navigating away', async () => {
  const test = await mount();
  const history = test.renderer.root
    .findAllByType(BriefingHistoryView)
    .find((node) => node.props.routineIds)!;
  await click(button(test.renderer, '루틴 설정'));
  expect(test.renderer.root.findByType(BriefingHistoryView)).toBe(history);
  expect(history.parent?.props.hidden).toBe(true);
});
it('places one collapse-all icon in the fixed reading header and removes it from settings', async () => {
  const test = await mount();
  const header = test.renderer.root.findByProps({ className: 'briefing-main-header' });
  expect(header.findAllByProps({ 'aria-label': '모두 접기' })).toHaveLength(1);
  await click(button(test.renderer, '루틴 설정'));
  expect(test.renderer.root.findAllByProps({ 'aria-label': '모두 접기' })).toHaveLength(0);
  await click(button(test.renderer, '실제 브리핑'));
  expect(
    test.renderer.root
      .findByProps({ className: 'briefing-main-header' })
      .findAllByProps({ 'aria-label': '모두 접기' }),
  ).toHaveLength(1);
});
it('offers always-by-default original Mail opening with an independent ask choice', async () => {
  const test = await mount();
  await click(button(test.renderer, '루틴 설정'));
  const input = field(test.renderer, 'Apple Mail 원본 열기 확인');
  expect(input.props.value).toBe('always');
  await change(input, 'ask');
  expect(field(test.renderer, 'Apple Mail 원본 열기 확인').props.value).toBe('ask');
  expect(field(test.renderer, 'Briefing 요청 확인').props.value).toBe('always');
  await click(button(test.renderer, '설정 저장'));
  expect(test.workspace.routines[0]!.live?.assistant?.mailOpenConfirmation).toBe('ask');
});
async function change(node: ReactTestInstance, value: string) {
  await act(() => node.props.onChange({ target: { value } }));
}
it('saves a Mail limit change from fifteen to a hundred and gives a readable error beyond the supported range', async () => {
  const original = initialWorkspace(NOW);
  const changed = {
    ...original.routines[0]!,
    live: {
      ...defaultLiveSettings(),
      mail: {
        accountId: 'a',
        mailboxId: 'inbox-a',
        days: 3,
        limit: 15,
        subject: '',
        sender: '',
        unreadOnly: false,
        bodyPreview: true,
      },
    },
  };
  const test = await mount({ ...original, routines: [changed, ...original.routines.slice(1)] });
  await click(button(test.renderer, '루틴 설정'));
  const input = field(test.renderer, '전체 계정 최대 표시 수');
  expect(input.props.max).toBe(100);
  await change(input, '100');
  await click(button(test.renderer, '설정 저장'));
  expect(test.workspace.routines[0]!.live?.mail?.limit).toBe(100);
  expect(content(test.renderer)).not.toContain('설정을 저장하지 못했습니다.');
  await change(field(test.renderer, '전체 계정 최대 표시 수'), '101');
  await click(button(test.renderer, '설정 저장'));
  expect(content(test.renderer)).toContain('메일 조회 개수는 1~100 사이의 정수로 입력해주세요.');
  expect(content(test.renderer)).not.toContain('live.mail.limit:');
  expect(test.workspace.routines[0]!.live?.mail?.limit).toBe(100);
});

async function mount(seed = initialWorkspace(NOW)) {
  const initial = withoutSampleContent(seed);
  let current = initial;
  const edits = vi.fn();
  const run = vi.fn();
  let runNumber = 0;
  function Harness() {
    const [workspace, setWorkspace] = useState(initial);
    return (
      <BriefingApp
        workspace={workspace}
        onChange={(next) => {
          current = next;
          edits(next);
          setWorkspace(next);
        }}
        onRun={(routineId) => {
          run(routineId);
          current = runFixture(current, routineId, NOW, `ui-run-${++runNumber}`);
          setWorkspace(current);
        }}
      />
    );
  }
  let renderer!: ReactTestRenderer;
  await act(() => {
    renderer = create(<Harness />);
  });
  renderers.push(renderer);
  // Settings tests enter the manager; default real History is tested separately.
  await click(button(renderer, '루틴 관리'));
  const selected =
    initial.routines.find((r) => r.id === initial.selectedRoutineId) ?? initial.routines[0];
  if (selected) {
    await click(renderer.root.findByProps({ 'aria-label': selected.name + ' 설정' }));
    await click(button(renderer, '실제 브리핑'));
  }
  return {
    renderer,
    edits,
    run,
    get workspace() {
      return current;
    },
  };
}

beforeEach(() => {
  vi.mocked(sourceRequest).mockClear();
  vi.mocked(sourceRequest).mockResolvedValue({ saved: true, history: [] });
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', {
    innerWidth: 1440,
    confirm: vi.fn(() => true),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(async () => {
  await act(() => {
    for (const renderer of renderers.splice(0)) renderer.unmount();
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Briefing Lab phase 1 UI', () => {
  it('combines all personal routine histories in one default scroll feed with newest entries first', async () => {
    const base = initialWorkspace(NOW);
    const workspace = {
      ...base,
      routines: [
        ...base.routines,
        { ...base.routines[0]!, id: 'second-personal', name: 'Second personal' },
      ],
    };
    vi.mocked(sourceRequest).mockImplementation(async (_path, body) => {
      const id = (body as { routineId: string }).routineId;
      const newest = id === 'second-personal';
      return {
        history: [
          {
            id,
            routineId: id,
            createdAt: newest ? '2026-09-09T09:00:00Z' : '2026-09-08T09:00:00Z',
            kind: 'briefing',
            answer: newest ? 'NEWEST BRIEFING' : 'OLDER BRIEFING',
            items: [],
            private: false,
          },
        ],
      };
    });
    let renderer!: ReactTestRenderer;
    await act(() => {
      renderer = create(<BriefingApp workspace={workspace} onChange={vi.fn()} onRun={vi.fn()} />);
    });
    renderers.push(renderer);
    expect(renderer.root.findAllByProps({ className: 'briefing-history-feed' })).toHaveLength(1);
    expect(content(renderer).indexOf('NEWEST BRIEFING')).toBeLessThan(
      content(renderer).indexOf('OLDER BRIEFING'),
    );
    expect(renderer.root.findAllByProps({ className: 'briefing-history-run' })).toHaveLength(2);
    const paths = vi.mocked(sourceRequest).mock.calls.map((call) => call[0]);
    expect(paths.filter((path) => path !== '/assistant/guidance/list')).toEqual([
      '/generation/status',
      '/history/list',
      '/history/list',
    ]);
    // The header's guidance button and the feed's pinned mail share one read per routine, so they
    // do not push the server past its three concurrent requests.
    expect(
      vi
        .mocked(sourceRequest)
        .mock.calls.filter((call) => call[0] === '/assistant/guidance/list')
        .map((call) => (call[1] as { routineId: string }).routineId)
        .sort(),
    ).toEqual(['personal-research', 'second-personal']);
    const personal = renderer.root
      .findAllByType('button')
      .find(
        (node) =>
          contentText(node).includes('개인 연구 브리핑') &&
          contentText(node).includes('전체 History'),
      )!;
    await click(personal);
    expect(
      vi
        .mocked(sourceRequest)
        .mock.calls.map((call) => call[0])
        .filter((path) => path !== '/assistant/guidance/list'),
    ).toEqual(['/generation/status', ...Array(4).fill('/history/list')]);
  });
  it('opens the complete History by default and removes all routine/sample navigation from the sidebar without deleting data', async () => {
    const base = runFixture(initialWorkspace(NOW), 'personal-research', NOW, 'kept-sample');
    let renderer!: ReactTestRenderer;
    const edits = vi.fn(),
      run = vi.fn();
    await act(() => {
      renderer = create(<BriefingApp workspace={base} onChange={edits} onRun={run} />);
    });
    renderers.push(renderer);
    const sidebar = renderer.root.findByProps({ 'aria-label': '브리핑 루틴과 실행 이력' });
    expect(
      sidebar.findAll((node) =>
        String(node.props.className ?? '').includes('briefing-routine-tree'),
      ),
    ).toHaveLength(0);
    expect(sidebar.findAll((node) => node.props.className === 'briefing-history')).toHaveLength(0);
    expect(contentText(sidebar)).not.toContain('샘플 8건');
    expect(content(renderer)).toContain('저장된 AI 브리핑');
    expect(button(renderer, '샘플 브리핑 만들기')).toBeUndefined();
    expect(edits).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    await click(button(renderer, '루틴 관리'));
    expect(content(renderer)).toContain('루틴 관리');
    expect(content(renderer)).not.toContain('샘플 보관함');
    expect(
      sidebar.findAll((node) =>
        String(node.props.className ?? '').includes('briefing-routine-tree'),
      ),
    ).toHaveLength(0);
    expect(base.runs[0]!.id).toBe('kept-sample');
  });
  it('an asynchronous settings save preserves routines created while the native approval was pending', async () => {
    const test = await mount();
    await click(button(test.renderer, '루틴 설정'));
    await change(field(test.renderer, '루틴 이름'), 'Saved after approval');
    let resolve!: (value: unknown) => void;
    vi.mocked(sourceRequest).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await act(() => {
      button(test.renderer, '설정 저장').props.onClick();
    });
    await click(button(test.renderer, '새 루틴'));
    expect(test.workspace.routines).toHaveLength(3);
    await act(async () => {
      resolve({ saved: true });
      await Promise.resolve();
    });
    expect(test.workspace.routines).toHaveLength(3);
    expect(test.workspace.routines[0]?.name).toBe('Saved after approval');
  });
  it('saves per-routine section order without generating a sample or changing other settings', async () => {
    const test = await mount();
    const other = structuredClone(test.workspace.routines[1]);
    await click(button(test.renderer, '루틴 설정'));
    await click(test.renderer.root.findByProps({ 'aria-label': '이메일 섹션 아래로' }));
    await click(button(test.renderer, '설정 저장'));
    let saved = '';
    expect(
      saveWorkspace(
        {
          setItem: (_key, value) => {
            saved = value;
          },
        },
        test.workspace,
      ),
    ).toBeNull();
    const loaded = loadWorkspace({ getItem: () => saved }, NOW);
    expect(loaded.workspace.routines[0]!.sectionOrder?.slice(0, 3)).toEqual([
      'weather',
      'papers',
      'email',
    ]);
    expect(loaded.workspace.routines[1]).toEqual(other);
    expect(loaded.workspace.runs).toEqual([]);
    expect(test.run).not.toHaveBeenCalled();
  });
  it('keeps the saved Mail body scope aligned with the AI assistant preference', async () => {
    const base = initialWorkspace(NOW);
    const workspace = {
      ...base,
      routines: base.routines.map((routine, index) =>
        index === 0
          ? {
              ...routine,
              live: {
                ...defaultLiveSettings(),
                mail: {
                  accountId: 'account',
                  mailboxId: 'mailbox',
                  days: 3,
                  limit: 10,
                  subject: '',
                  sender: '',
                  unreadOnly: false,
                  bodyPreview: false,
                },
                assistant: { ...defaultAssistantPreferences(), mailRead: true, mailAi: true },
              },
            }
          : routine,
      ),
    };
    const test = await mount(workspace);
    await click(button(test.renderer, '루틴 설정'));
    await click(button(test.renderer, '설정 저장'));
    expect(test.workspace.routines[0]!.live?.mail?.bodyPreview).toBe(true);
  });
  it('opens the AI builder without invoking an LLM and adds an accepted draft without overwriting existing routines', async () => {
    const test = await mount();
    const before = test.workspace.routines;
    await click(button(test.renderer, 'AI로 새 루틴'));
    expect(fetch).not.toHaveBeenCalled();
    const proposed = {
      ...before[0]!,
      id: 'new-ai-routine',
      name: '새 AI 루틴',
      state: 'draft' as const,
    };
    await act(() => test.renderer.root.findByType(RoutineCopilot).props.onCreate(proposed));
    expect(test.workspace.routines).toEqual(
      withoutSampleContent({ ...test.workspace, routines: [...before, proposed] }).routines,
    );
    expect(test.workspace.selectedRoutineId).toBe(proposed.id);
    expect(test.workspace.runs).toHaveLength(0);
    expect(test.run).not.toHaveBeenCalled();
  });
  it('opens Calendar and personal briefing History as parallel sidebar sessions', async () => {
    const test = await mount();
    const primary = (label: string) =>
      test.renderer.root
        .findAllByProps({ className: 'briefing-sidebar-primary-button ' })
        .find((node) => node.findAllByType('strong').some((child) => text(child) === label))!;
    await click(primary('Calendar'));
    expect(content(test.renderer)).toContain('Apple Calendar 연결');
    expect(test.renderer.root.findAllByProps({ className: 'briefing-tabs' })).toHaveLength(0);
    expect(test.renderer.root.findAllByProps({ className: 'briefing-main-header' })).toHaveLength(
      0,
    );
    expect(test.renderer.root.findByType('main').props.className).toContain(
      'briefing-main-calendar',
    );
    vi.mocked(sourceRequest).mockResolvedValue({ history: [] });
    await click(primary('개인 연구 브리핑'));
    expect(content(test.renderer)).toContain('저장된 AI 브리핑');
    expect(test.renderer.root.findAllByProps({ className: 'briefing-tabs' })).toHaveLength(0);
    vi.mocked(sourceRequest).mockResolvedValue({ papers: [], feedback: {} });
    await click(primary('논문 요약'));
    expect(test.renderer.root.findAllByProps({ 'aria-label': '저장 논문 검색' })).toHaveLength(1);
    expect(test.renderer.root.findAllByProps({ className: 'briefing-tabs' })).toHaveLength(0);
    expect(test.renderer.root.findAllByProps({ 'aria-label': '저장된 AI 브리핑' })).toHaveLength(0);
  });
  it('starts honestly empty with two independent routines and no network, LLM, or automatic run', async () => {
    const test = await mount();
    const output = content(test.renderer);
    expect(output).not.toContain('첫 브리핑을 미리 살펴보세요');
    expect(output).toContain('지금 실제 자료 조회');
    expect(output).not.toContain('briefing-fixture-banner');
    expect(output).not.toContain('이용 안내');
    expect(output).toContain('AI로 새 루틴');
    expect(test.renderer.root.findAllByType('textarea')).toHaveLength(0);
    expect(test.run).not.toHaveBeenCalled();
    expect(test.edits).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('offers only real briefing and settings tabs with no sample execution or archive', async () => {
    const test = await mount();
    expect(button(test.renderer, '샘플 브리핑 만들기')).toBeUndefined();
    expect(content(test.renderer)).not.toContain('샘플 보관함');
    expect(test.workspace.runs).toEqual([]);
    await click(button(test.renderer, '루틴 관리'));
    expect(content(test.renderer)).not.toContain('샘플');
    await click(test.renderer.root.findByProps({ 'aria-label': '연구과제 브리핑 설정' }));
    expect(test.workspace.selectedRoutineId).toBe('funding-research');
    expect(content(test.renderer)).not.toContain('샘플 디렉터리');
    expect(test.run).not.toHaveBeenCalled();
  });
  it('saves changed times, kind-independent state, keywords and exclusions only for one routine', async () => {
    const test = await mount();
    const otherBefore = structuredClone(test.workspace.routines[1]);
    await click(
      test.renderer.root.findAllByType('button').find((node) => text(node) === '루틴 설정')!,
    );
    await change(field(test.renderer, '루틴 이름'), '내 논문 브리핑');
    await change(field(test.renderer, '전달 시각'), '07:30, 19:30');
    await change(field(test.renderer, '반복 간격'), '2');
    await change(field(test.renderer, '상태 · 미리보기 전용'), 'enabled');
    await change(test.renderer.root.findByProps({ 'aria-label': '키워드 1 중요도' }), '5');
    await change(field(test.renderer, '제외 키워드'), 'advertisement, commercial');
    expect(test.workspace.routines[0]?.name).not.toBe('내 논문 브리핑');
    expect(button(test.renderer, '저장한 설정으로 샘플 실행')).toBeUndefined();
    vi.setSystemTime('2026-09-08T10:01:00.000Z');
    await click(button(test.renderer, '설정 저장'));
    expect(test.workspace.routines[0]).toMatchObject({
      name: '내 논문 브리핑',
      state: 'enabled',
      schedule: { times: ['07:30', '19:30'], interval: 2 },
      interest: { excluded: ['advertisement', 'commercial'] },
    });
    expect(test.workspace.routines[1]).toEqual(
      withoutSampleContent({ ...test.workspace, routines: [otherBefore!] }).routines[0],
    );
    expect(test.run).not.toHaveBeenCalled();
    expect(content(test.renderer)).toContain('초안을 저장했습니다.');
  });

  it('discards stale form drafts when external sample reset replaces the routine generation', async () => {
    const original = initialWorkspace(NOW);
    const edits = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(() => {
      renderer = create(<BriefingApp workspace={original} onChange={edits} onRun={vi.fn()} />);
    });
    renderers.push(renderer);
    await click(button(renderer, '루틴 관리'));
    await click(renderer.root.findByProps({ 'aria-label': `${original.routines[0]!.name} 설정` }));
    await change(field(renderer, '루틴 이름'), 'Unsaved stale draft');
    await change(field(renderer, '전달 시각'), '17:45');
    const reset = initialWorkspace('2026-09-08T10:02:00.000Z');
    await act(() =>
      renderer.update(<BriefingApp workspace={reset} onChange={edits} onRun={vi.fn()} />),
    );
    expect(field(renderer, '루틴 이름').props.value).toBe(reset.routines[0]?.name);
    expect(field(renderer, '전달 시각').props.value).toBe('08:00');
    expect(content(renderer)).not.toContain('Unsaved stale draft');
    expect(edits).not.toHaveBeenCalled();
  });

  it('blocks invalid schedule saves and keeps the original workspace untouched', async () => {
    const test = await mount();
    const before = structuredClone(test.workspace);
    await click(
      test.renderer.root.findAllByType('button').find((node) => text(node) === '루틴 설정')!,
    );
    await change(field(test.renderer, '전달 시각'), '25:99');
    await click(button(test.renderer, '설정 저장'));
    expect(content(test.renderer)).toContain('설정을 저장하지 못했습니다.');
    expect(test.workspace).toEqual(before);
    expect(test.edits).not.toHaveBeenCalled();
  });

  it('offers weekly weekdays, month-day and five calculated schedule previews', async () => {
    const test = await mount();
    await click(
      test.renderer.root.findAllByType('button').find((node) => text(node) === '루틴 설정')!,
    );
    await change(field(test.renderer, '반복 주기 · 미리보기 전용'), 'weekly');
    expect(
      test.renderer.root.findByProps({ className: 'briefing-weekdays' }).findAllByType('input'),
    ).toHaveLength(7);
    await change(field(test.renderer, '반복 주기 · 미리보기 전용'), 'monthly');
    await change(field(test.renderer, '매월 날짜'), '31');
    const preview = test.renderer.root.findAllByProps({ className: 'briefing-preview' })[0]!;
    expect(preview.findAllByType('li')).toHaveLength(5);
    expect(contentText(preview)).toContain('말일 조정');
    await click(button(test.renderer, '설정 저장'));
    expect(test.workspace.routines[0]?.schedule).toMatchObject({
      frequency: 'monthly',
      monthDay: 31,
    });
  });

  it('registers an explicitly selected-country public HTTPS site as unsupported without fetching it', async () => {
    const base = initialWorkspace(NOW);
    const test = await mount({ ...base, selectedRoutineId: 'funding-research' });
    await click(
      test.renderer.root.findAllByType('button').find((node) => text(node) === '루틴 설정')!,
    );
    await change(field(test.renderer, '사이트 이름'), 'Manual research grants');
    await change(field(test.renderer, '사이트 국가'), 'GB');
    await change(
      field(test.renderer, '공고 페이지 HTTPS 주소'),
      'https://funding.example.org/calls',
    );
    await click(button(test.renderer, '사이트를 초안에 추가'));
    expect(content(test.renderer)).toContain('사용자 등록 · 자동 수집 미지원');
    await click(button(test.renderer, '설정 저장'));
    expect(test.workspace.routines[1]?.sources.at(-1)).toMatchObject({
      origin: 'user',
      country: 'GB',
      label: 'Manual research grants',
      url: 'https://funding.example.org/calls',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(test.workspace.routines[1]?.countries).toEqual([]);
  });

  it.each([
    'http://funding.example.org',
    'https://127.0.0.1/private',
    'https://name:secret@funding.example.org',
  ])('rejects unsafe source %s before adding it to the draft', async (url) => {
    const base = initialWorkspace(NOW);
    const test = await mount({ ...base, selectedRoutineId: 'funding-research' });
    await click(
      test.renderer.root.findAllByType('button').find((node) => text(node) === '루틴 설정')!,
    );
    await change(field(test.renderer, '사이트 이름'), 'Unsafe');
    await change(field(test.renderer, '사이트 국가'), 'KR');
    await change(field(test.renderer, '공고 페이지 HTTPS 주소'), url);
    await click(button(test.renderer, '사이트를 초안에 추가'));
    expect(content(test.renderer)).toContain('유효한 HTTPS 주소를 입력하세요.');
    expect(test.workspace.routines[1]?.sources.some((source) => source.label === 'Unsafe')).toBe(
      false,
    );
    expect(test.edits).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('removes only a user bookmark while preserving live connection settings', async () => {
    const base = initialWorkspace(NOW);
    const source = {
      id: 'user-site',
      kind: 'papers' as const,
      label: 'Research bookmark',
      origin: 'user' as const,
      url: 'https://example.org',
    };
    const seeded = {
      ...base,
      routines: base.routines.map((r, i) =>
        i ? r : { ...r, sources: [source], live: defaultLiveSettings() },
      ),
    };
    const test = await mount(seeded);
    await click(button(test.renderer, '루틴 설정'));
    await click(test.renderer.root.findByProps({ 'aria-label': source.label + ' 항목 삭제' }));
    await click(button(test.renderer, '설정 저장'));
    expect(test.workspace.routines[0]?.sources).toEqual([]);
    expect(test.workspace.routines[0]?.live?.papers).toEqual(seeded.routines[0]?.live?.papers);
    expect(test.workspace.runs).toEqual([]);
  });
  it.each([false, true])(
    'deletes only the chosen routine configuration and does not reopen an old sample (last=%s)',
    async (last) => {
      const base = initialWorkspace(NOW);
      const test = await mount(last ? { ...base, routines: [base.routines[0]!] } : base);
      await click(button(test.renderer, '루틴 설정'));
      await click(button(test.renderer, '루틴 삭제'));
      expect(test.workspace.routines).toHaveLength(last ? 0 : 1);
      expect(test.workspace.runs).toEqual([]);
      expect(content(test.renderer)).not.toContain('샘플 보관함');
      expect(sourceRequest).toHaveBeenCalledWith(
        '/assistant/settings/deactivate',
        { routineId: 'personal-research' },
        expect.any(AbortSignal),
      );
      expect(
        vi.mocked(sourceRequest).mock.calls.every((call) => !call[0].includes('history/delete')),
      ).toBe(true);
      expect(test.run).not.toHaveBeenCalled();
    },
  );
  it('collapses only sidebars, preserves the center and resizes both sides with keyboard controls', async () => {
    const test = await mount();
    const left = test.renderer.root.findByProps({ 'aria-label': '루틴 사이드바 너비' });
    await act(() => left.props.onKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() }));
    expect(
      test.renderer.root.findByProps({ 'aria-label': '루틴 사이드바 너비' }).props['aria-valuenow'],
    ).toBe(280);
    await click(test.renderer.root.findByProps({ 'aria-label': '상세 사이드바 펼치기' }));
    const right = test.renderer.root.findByProps({ 'aria-label': '상세 사이드바 너비' });
    await act(() => right.props.onKeyDown({ key: 'ArrowLeft', preventDefault: vi.fn() }));
    expect(
      test.renderer.root.findByProps({ 'aria-label': '상세 사이드바 너비' }).props['aria-valuenow'],
    ).toBe(396);
    await click(test.renderer.root.findByProps({ 'aria-label': '루틴 사이드바 최소화' }));
    await click(test.renderer.root.findByProps({ 'aria-label': '상세 사이드바 최소화' }));
    expect(test.renderer.root.findAllByType('main')).toHaveLength(1);
    expect(button(test.renderer, '샘플 브리핑 만들기')).toBeUndefined();
    expect(test.renderer.root.findByProps({ 'data-testid': 'briefing-main-scroll' })).toBeTruthy();
    await click(test.renderer.root.findByProps({ 'aria-label': '상세 사이드바 펼치기' }));
    expect(
      test.renderer.root.findByProps({ 'aria-label': '상세 사이드바 너비' }).props['aria-valuenow'],
    ).toBe(396);
    await click(test.renderer.root.findByProps({ 'aria-label': '루틴 사이드바 펼치기' }));
    expect(
      test.renderer.root.findByProps({ 'aria-label': '루틴 사이드바 너비' }).props['aria-valuenow'],
    ).toBe(280);
  });

  it('starts compact at narrow widths and maintains independent scroll containers in CSS', async () => {
    vi.stubGlobal('window', { innerWidth: 400 });
    const test = await mount();
    expect(test.renderer.root.findByProps({ 'aria-label': '루틴 사이드바 펼치기' })).toBeTruthy();
    expect(test.renderer.root.findByProps({ 'aria-label': '상세 사이드바 펼치기' })).toBeTruthy();
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(css).toContain('minmax(0, 1fr)');
    expect(css).toContain('overscroll-behavior: contain');
    expect(css).toContain('.briefing-main-scroll');
    expect(css).toContain('overflow: auto');
    expect(css).toMatch(
      /\.briefing-workspace > \.briefing-main \{\s*grid-column: 3;\s*grid-row: 1;/u,
    );
    expect(css).toMatch(
      /\.briefing-workspace > \.briefing-details \{\s*grid-column: 5;\s*grid-row: 1;/u,
    );
  });

  it('escapes imported real-history titles and keeps the original saved date', () => {
    const html = renderToStaticMarkup(
      <BriefingHistoryItem
        item={{
          id: 'paper',
          title: '<script>never execute</script>',
          kind: 'papers',
          summary: 'Saved summary',
          readScope: 'abstract',
          importance: 'high',
          relevance: '',
        }}
        savedAt="2026-09-10T00:00:00Z"
      />,
    );
    expect(html).toContain('&lt;script&gt;never execute&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('2026년 9월 10일');
  });
});

function contentText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : contentText(child)))
    .join('');
}
