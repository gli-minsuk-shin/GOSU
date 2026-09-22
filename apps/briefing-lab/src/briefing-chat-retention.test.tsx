import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { BriefingApp } from './briefing-app';
import { BriefingChat, isNearLatestMessage } from './briefing-chat';
import { initialRealWorkspace } from './workspace-defaults';
import {
  defaultAssistantPreferences,
  defaultLiveSettings,
  type BriefingWorkspace,
} from '@gosu/briefing-core';
import { workspaceStream } from './workspace-client';
import { sourceRequest } from './live-client';
import { restoreBriefingConversation } from './briefing-conversation-restore';
it('automatically retries a temporary restart read failure without replaying an AI turn', async () => {
  vi.mocked(sourceRequest)
    .mockRejectedValueOnce(new Error('routine_busy'))
    .mockResolvedValueOnce({ messages: [] });
  const pause = vi.fn(async () => undefined);
  expect(await restoreBriefingConversation('r', new AbortController().signal, pause)).toEqual({
    messages: [],
  });
  expect(sourceRequest).toHaveBeenCalledTimes(2);
  expect(pause).toHaveBeenCalledOnce();
  expect(workspaceStream).not.toHaveBeenCalled();
  vi.mocked(sourceRequest).mockReset().mockRejectedValue(new Error('routine_busy'));
  await expect(
    restoreBriefingConversation('r', new AbortController().signal, pause),
  ).rejects.toThrow('routine_busy');
  expect(sourceRequest).toHaveBeenCalledTimes(3);
});
it('never retries permission failures or continues restoration after cancellation', async () => {
  vi.mocked(sourceRequest).mockRejectedValue(new Error('assistant_client_required'));
  await expect(
    restoreBriefingConversation('r', new AbortController().signal, vi.fn()),
  ).rejects.toThrow('assistant_client_required');
  expect(sourceRequest).toHaveBeenCalledOnce();
  const controller = new AbortController();
  controller.abort();
  await expect(restoreBriefingConversation('r', controller.signal, vi.fn())).rejects.toThrow(
    'Aborted',
  );
  expect(sourceRequest).toHaveBeenCalledOnce();
});

vi.mock('./live-client', () => ({
  sourceRequest: vi.fn(async () => ({ history: [], choices: {}, saved: true })),
}));
vi.mock('./workspace-client', () => ({ workspaceStream: vi.fn() }));
vi.mock('./routine-client', () => ({ createRoutineClient: () => ({ models: async () => [] }) }));
let ui: ReactTestRenderer;
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const text = () => JSON.stringify(ui.toJSON());
const button = (label: string) =>
  ui.root.findAllByType('button').find(
    (b) =>
      b.props['aria-label'] === label ||
      b.children
        .filter((c) => typeof c === 'string')
        .join('')
        .trim() === label ||
      b.findAllByType('strong').some((n) => n.children.join('') === label),
  )!;
const click = async (label: string) => {
  // The topbar opener was removed; reopening now uses the sidebar's close/open controls.
  if (label === 'AI 비서' && !button(label)) {
    await act(() => button('상세 사이드바 최소화').props.onClick());
    await act(() => button('상세 사이드바 펼치기').props.onClick());
  } else await act(() => button(label).props.onClick());
};
const result = (answer: string) => ({
  answer,
  sources: [],
  events: [],
  tasks: [],
  invocation: { providerId: 'codex', model: 'fixture', reasoning: null },
  writesPerformed: 0,
});
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(workspaceStream).mockResolvedValue(result('Remembered assistant reply'));
  const first = initialRealWorkspace('2026-09-10T00:00:00Z');
  const workspace: BriefingWorkspace = {
    ...first,
    routines: [first.routines[0]!, { ...first.routines[0]!, id: 'second', name: 'Second routine' }],
  };
  let replace!: (value: BriefingWorkspace) => void;
  function Harness() {
    const [value, setValue] = useState(workspace);
    replace = setValue;
    return <BriefingApp workspace={value} onChange={setValue} />;
  }
  await act(() => {
    ui = create(<Harness />);
  });
  return { workspace, replace };
}
const activeChat = () =>
  ui.root.findAllByType(BriefingChat).find((n) => n.props.visible !== false)!;
it('switches to the global canvas without remounting the chat or losing an unsent draft', async () => {
  const handlers = new Set<(event: MessageEvent) => void>();
  const parent = { postMessage: vi.fn() };
  vi.stubGlobal('document', { documentElement: { dataset: {} } });
  vi.stubGlobal('window', {
    parent,
    location: { search: '?embedded=gosu' },
    addEventListener: (name: string, fn: (event: MessageEvent) => void) => {
      if (name === 'message') handlers.add(fn);
    },
    removeEventListener: (name: string, fn: (event: MessageEvent) => void) => {
      if (name === 'message') handlers.delete(fn);
    },
    dispatchEvent: vi.fn(),
  });
  await mount();
  const navigate = async (view: string) =>
    act(() => {
      for (const fn of handlers)
        fn({
          source: parent,
          origin: 'null',
          data: { type: 'gosu-briefing-navigation', view },
        } as unknown as MessageEvent);
    });
  await navigate('assistant');
  const chat = activeChat();
  expect(chat.props.globalMode).toBe(true);
  expect(text()).toContain('is-global-assistant');
  expect(text()).toContain('무엇을 도와드릴까요?');
  await act(() =>
    chat.findByType('textarea').props.onChange({ target: { value: 'Retained draft' } }),
  );
  await navigate('history');
  expect(activeChat()).toBe(chat);
  expect(chat.props.globalMode).toBe(false);
  expect(chat.findByType('textarea').props.value).toBe('Retained draft');
  await navigate('assistant');
  expect(activeChat()).toBe(chat);
  expect(chat.findByType('textarea').props.value).toBe('Retained draft');
  expect(workspaceStream).not.toHaveBeenCalled();
});
it('retains a selected paper tag across turns and omits it after explicit removal', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(workspaceStream).mockResolvedValue(result('Grounded reply'));
  const routine = initialRealWorkspace('2026-09-10T00:00:00Z').routines[0]!;
  const reference = {
    routineId: routine.id,
    historyId: 'h',
    paperId: 'p',
    title: 'Selected paper',
  };
  await act(() => {
    ui = create(<BriefingChat routine={routine} onSettings={vi.fn()} paperReference={reference} />);
  });
  expect(text()).toContain('Selected paper');
  expect(workspaceStream).not.toHaveBeenCalled();
  const send = async () => {
    await act(() =>
      ui.root.findByType('textarea').props.onChange({ target: { value: 'Explain methods' } }),
    );
    await act(() => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  };
  await send();
  expect(vi.mocked(workspaceStream).mock.calls[0]?.[1]).toMatchObject({
    paperReference: reference,
  });
  await send();
  expect(vi.mocked(workspaceStream).mock.calls[1]?.[1]).toMatchObject({
    paperReference: reference,
  });
  await act(() => button('참조 논문 해제').props.onClick());
  await send();
  expect(vi.mocked(workspaceStream).mock.calls[2]?.[1]).not.toHaveProperty('paperReference');
});
it('places recommendation and permission icon buttons inside the input box without sending or clearing the draft', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const settings = vi.fn();
  await act(() => {
    ui = create(
      <BriefingChat
        routine={initialRealWorkspace('2026-09-10T00:00:00Z').routines[0]!}
        onSettings={settings}
      />,
    );
  });
  const box = ui.root.findByProps({ className: 'briefing-chat-input-box' });
  expect(box.findAllByType('textarea')).toHaveLength(1);
  const suggestions = box.findByProps({ 'aria-label': '추천 질문' });
  const permissions = box.findByProps({ 'aria-label': '권한 설정' });
  expect(permissions.findByType('path').props.d).toBe('M3 6h3m4 0h11M3 12h11m4 0h3M3 18h5m4 0h9');
  expect(
    permissions.findAllByType('circle').map((node) => [node.props.cx, node.props.cy, node.props.r]),
  ).toEqual([
    ['8', '6', '2'],
    ['16', '12', '2'],
    ['10', '18', '2'],
  ]);
  for (const control of [suggestions, permissions]) {
    expect(control.props.type).toBe('button');
    expect(control.props.title).toBeTruthy();
    expect(control.findAllByType('svg')).toHaveLength(1);
  }
  expect(
    ui.root.findByProps({ className: 'briefing-chat-context' }).findAllByType('button'),
  ).toHaveLength(0);
  await act(() =>
    box.findByType('textarea').props.onChange({ target: { value: 'Keep this draft' } }),
  );
  await act(() => suggestions.props.onClick());
  expect(box.findByProps({ 'aria-label': '추천 질문' }).props['aria-expanded']).toBe(true);
  await act(() => box.findByProps({ 'aria-label': '추천 질문' }).props.onClick());
  expect(box.findByProps({ 'aria-label': '추천 질문' }).props['aria-expanded']).toBe(false);
  await act(() => permissions.props.onClick());
  expect(settings).toHaveBeenCalledOnce();
  expect(box.findByType('textarea').props.value).toBe('Keep this draft');
  expect(workspaceStream).not.toHaveBeenCalled();
});
async function send(prompt: string) {
  await act(() =>
    activeChat()
      .findByType('textarea')
      .props.onChange({ target: { value: prompt } }),
  );
  await act(() => activeChat().findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
}
it('refreshes the library after a chat save receipt without offering to save it again', async () => {
  const dispatchEvent = vi.fn();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent,
    location: { search: '' },
  });
  await mount();
  await click('AI 비서');
  vi.mocked(workspaceStream).mockResolvedValue({
    ...result('Synthetic paper 저장 완료'),
    sources: [
      {
        id: 'p',
        title: 'Synthetic paper',
        kind: 'paper',
        url: 'https://arxiv.org/abs/2601.12345v1',
      },
    ],
    savedPapers: [
      {
        id: 'stored',
        title: 'Synthetic paper',
        savedAt: '2026-09-14T00:00:00Z',
        alreadySaved: false,
      },
    ],
    writesPerformed: 1,
  });
  await send('응');
  expect(text()).toContain('저장 완료');
  expect(activeChat().findAllByProps({ 'aria-label': '논문 요약 저장 확인' })).toHaveLength(0);
  expect(
    dispatchEvent.mock.calls.some(([event]) => event.type === 'gosu-paper-library-updated'),
  ).toBe(true);
});
it('restores saved messages after a full remount without inference and uses them for the next question', async () => {
  const messages = [
    { role: 'user', text: 'Before update', createdAt: '2026-09-13T00:00:00Z' },
    {
      role: 'assistant',
      text: 'Saved answer',
      createdAt: '2026-09-13T00:00:01Z',
      invocation: { providerId: 'codex', model: 'saved-model', reasoning: 'high' },
    },
  ];
  vi.mocked(sourceRequest).mockImplementation(async (path) =>
    path === '/assistant/conversation/get' ? { messages, otherScopeMessages: 2 } : {},
  );
  await mount();
  await click('상세 사이드바 펼치기');
  await act(() => ui.unmount());
  await mount();
  await click('상세 사이드바 펼치기');
  expect(text()).toContain('Before update');
  expect(text()).toContain('Saved answer');
  expect(text()).toContain('saved-model');
  expect(text()).toContain('이전 설정의 대화');
  expect(button('최근 메일 중 중요한 내용 찾아줘')).toBeDefined();
  expect(
    activeChat().findByProps({ 'aria-label': '추천 질문', type: 'button' }).props['aria-expanded'],
  ).toBe(true);
  expect(workspaceStream).not.toHaveBeenCalled();
  await send('Continue');
  expect(vi.mocked(workspaceStream).mock.calls[0]?.[1]).toMatchObject({
    history: [], // The server reads the complete owned transcript; the browser no longer re-sends six messages.
  });
});
it('does not present a new-chat welcome while the previous conversation is still loading', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(sourceRequest).mockImplementation(async (path) =>
    path === '/assistant/conversation/get'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : {},
  );
  await mount();
  await click('상세 사이드바 펼치기');
  expect(text()).toContain('이전 대화 불러오는 중');
  expect(button('최근 메일 중 중요한 내용 찾아줘')).toBeUndefined();
  await act(() =>
    finish({
      messages: [
        {
          role: 'assistant',
          text: 'Previous conversation automatically restored',
          createdAt: '2026-09-13T00:00:00Z',
        },
      ],
    }),
  );
  expect(text()).toContain('Previous conversation automatically restored');
  expect(button('최근 메일 중 중요한 내용 찾아줘')).toBeDefined();
  expect(workspaceStream).not.toHaveBeenCalled();
});
it('keeps a restoration failure visible and blocks sending until an explicit successful retry', async () => {
  vi.mocked(sourceRequest).mockImplementation(async (path) => {
    if (path === '/assistant/conversation/get') throw new Error('unreadable');
    return {};
  });
  await mount();
  await click('상세 사이드바 펼치기');
  await send('Do not lose context');
  expect(text()).toContain('기존 기록은 유지됩니다');
  expect(workspaceStream).not.toHaveBeenCalled();
  vi.mocked(sourceRequest).mockResolvedValue({ messages: [] });
  await click('다시 불러오기');
  await send('Retry after restore');
  expect(workspaceStream).toHaveBeenCalledOnce();
});
it('opens chat directly from the sidebar arrow with no topbar AI button and retains messages across Calendar and briefing refresh', async () => {
  await mount();
  expect(
    ui.root.findByProps({ className: 'briefing-topbar' }).findAllByType('button'),
  ).toHaveLength(0);
  await click('상세 사이드바 펼치기');
  expect(activeChat()).toBeTruthy();
  await send('Persistent across sections');
  await click('Calendar');
  await click('개인 연구 브리핑');
  expect(text()).toContain('Persistent across sections');
  await click('상세 사이드바 최소화');
  await click('상세 사이드바 펼치기');
  expect(text()).toContain('Remembered assistant reply');
  expect(button('최근 메일 중 중요한 내용 찾아줘')).toBeDefined();
});
it('keeps messages/draft and next-turn context when closing and reopening the assistant, and closes recommendations separately', async () => {
  await mount();
  expect(workspaceStream).not.toHaveBeenCalled();
  await click('AI 비서');
  await send('Remember my question');
  await act(() =>
    activeChat()
      .findByType('textarea')
      .props.onChange({ target: { value: 'Continue this draft' } }),
  );
  await click('상세 사이드바 최소화');
  await click('AI 비서');
  expect(text()).toContain('Remembered assistant reply');
  expect(activeChat().findByType('textarea').props.value).toBe('Continue this draft');
  await click('추천 질문 닫기');
  expect(button('최근 메일 중 중요한 내용 찾아줘')).toBeUndefined();
  expect(text()).toContain('Remembered assistant reply');
  expect(workspaceStream).toHaveBeenCalledTimes(1);
  await send('Follow-up');
  expect(vi.mocked(workspaceStream).mock.calls[1]?.[1]).toMatchObject({
    history: [],
  });
});
it('does not abort a pending answer on collapse and receives it exactly once while hidden', async () => {
  await mount();
  let resolve!: (value: unknown) => void;
  vi.mocked(workspaceStream).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await click('AI 비서');
  await act(() => button('오늘과 내일 일정 알려줘').props.onClick());
  const signal = vi.mocked(workspaceStream).mock.calls[0]![2] as AbortSignal;
  await click('상세 사이드바 최소화');
  expect(signal.aborted).toBe(false);
  await act(() => resolve(result('Answer completed while closed')));
  await click('AI 비서');
  expect(text()).toContain('Answer completed while closed');
  expect(workspaceStream).toHaveBeenCalledTimes(1);
});
it('retains separate conversations through routine/copilot navigation but still resets on provider/scope changes', async () => {
  const f = await mount();
  await click('AI 비서');
  await send('Routine one private context');
  await click('AI로 새 루틴');
  await click('AI 비서');
  expect(text()).toContain('Routine one private context');
  await act(() => f.replace({ ...f.workspace, selectedRoutineId: 'second' }));
  await click('AI 비서');
  await send('Routine two question');
  expect(vi.mocked(workspaceStream).mock.calls[1]?.[1]).toMatchObject({
    routineId: 'second',
    history: [],
  });
  await act(() => f.replace(f.workspace));
  await click('AI 비서');
  await send('Continue routine one');
  expect(vi.mocked(workspaceStream).mock.calls[2]?.[1]).toMatchObject({
    routineId: f.workspace.routines[0]!.id,
    history: [],
  });
  expect(JSON.stringify(vi.mocked(workspaceStream).mock.calls[2]?.[1])).not.toContain(
    'Routine two question',
  );
  await act(() =>
    f.replace({
      ...f.workspace,
      routines: f.workspace.routines.map((r, i) =>
        i
          ? r
          : {
              ...r,
              live: {
                ...r.live!,
                assistant: { ...defaultAssistantPreferences(), providerId: 'claude-code' },
              },
            },
      ),
    }),
  );
  expect(text()).not.toContain('Routine one private context');
});
it('keeps recommendation clicks non-destructive, blocks hidden sends, and still honors explicit Stop', async () => {
  await mount();
  let resolve!: (value: unknown) => void;
  vi.mocked(workspaceStream).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await click('AI 비서');
  await act(() => button('최근 메일 중 중요한 내용 찾아줘').props.onClick());
  const chat = activeChat(),
    signal = vi.mocked(workspaceStream).mock.calls[0]![2] as AbortSignal;
  await click('AI 비서');
  await click('추천 질문 닫기');
  expect(signal.aborted).toBe(false);
  // The header only shows the model; Settings → Agent is where it changes, so nothing is locked.
  expect(button('AI 비서 모델 · 설정 → Agent에서 변경').props.disabled).toBeUndefined();
  await click('상세 사이드바 최소화');
  await act(() => chat.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  expect(workspaceStream).toHaveBeenCalledTimes(1);
  await click('AI 비서');
  await click('중단');
  expect(signal.aborted).toBe(true);
  await act(() => resolve(result('Must not appear after Stop')));
  expect(text()).not.toContain('Must not appear after Stop');
});
it('aborts an old pending request on a changed permission context and rejects its late answer', async () => {
  const f = await mount();
  let resolve!: (value: unknown) => void;
  vi.mocked(workspaceStream).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await click('AI 비서');
  await act(() => button('오늘과 내일 일정 알려줘').props.onClick());
  const signal = vi.mocked(workspaceStream).mock.calls[0]![2] as AbortSignal;
  await act(() =>
    f.replace({
      ...f.workspace,
      routines: f.workspace.routines.map((r, i) =>
        i
          ? r
          : {
              ...r,
              live: {
                ...defaultLiveSettings(),
                ...r.live,
                assistant: { ...defaultAssistantPreferences(), mailRead: true },
              },
            },
      ),
    }),
  );
  expect(signal.aborted).toBe(true);
  await act(() => resolve(result('Old-scope answer')));
  expect(text()).not.toContain('Old-scope answer');
});
it('restores the conversation scroll position and focuses the existing composer when recommendations close', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(workspaceStream).mockResolvedValue(result('Scroll-test answer'));
  const routine = initialRealWorkspace('2026-09-10T00:00:00Z').routines[0]!;
  const node = {
    scrollHeight: 1200,
    clientHeight: 300,
    scrollTop: 0,
    scrollTo: ({ top }: { top: number }) => {
      node.scrollTop = Math.min(top, 900);
    },
  };
  const composer = { focus: vi.fn() };
  const props = { routine, onSettings: vi.fn() };
  await act(() => {
    ui = create(<BriefingChat {...props} />, {
      createNodeMock: (e) =>
        (e.props as { className?: string }).className === 'briefing-chat-log'
          ? node
          : e.type === 'textarea'
            ? composer
            : null,
    });
  });
  await send('Scroll test');
  node.scrollTop = 137;
  await act(() =>
    ui.root
      .findByProps({ 'aria-label': '브리핑 대화 기록' })
      .props.onScroll({ currentTarget: node }),
  );
  await act(() => ui.update(<BriefingChat {...props} visible={false} />));
  node.scrollTop = 0;
  await act(() =>
    ui.root
      .findByProps({ 'aria-label': '브리핑 대화 기록' })
      .props.onScroll({ currentTarget: node }),
  );
  await act(() => ui.update(<BriefingChat {...props} visible />));
  expect(node.scrollTop).toBe(137);
  await click('추천 질문 닫기');
  expect(composer.focus).toHaveBeenCalledTimes(3);
  expect(composer.focus).toHaveBeenNthCalledWith(1, { preventScroll: true });
  expect(composer.focus).toHaveBeenNthCalledWith(2, { preventScroll: true });
  expect(node.scrollTop).toBe(137);
  expect(workspaceStream).toHaveBeenCalledOnce();
});
it('puts the reader back after the desktop hid the whole Lab frame and showed it again', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(workspaceStream).mockResolvedValue(result('Frame-test answer'));
  let resized: () => void = () => undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(listener: () => void) {
        resized = listener;
      }
      observe() {}
      disconnect() {}
    },
  );
  const routine = initialRealWorkspace('2026-09-10T00:00:00Z').routines[0]!;
  const node = {
    scrollHeight: 1200,
    clientHeight: 300,
    scrollTop: 0,
    scrollTo: ({ top }: { top: number }) => {
      node.scrollTop = Math.min(top, 900);
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const props = { routine, onSettings: vi.fn() };
  await act(() => {
    ui = create(<BriefingChat {...props} />, {
      createNodeMock: (e) =>
        (e.props as { className?: string }).className === 'briefing-chat-log' ? node : null,
    });
  });
  await send('Frame test');
  node.scrollTop = 410;
  const log = () => ui.root.findByProps({ 'aria-label': '브리핑 대화 기록' });
  await act(() => log().props.onScroll({ currentTarget: node }));

  // display: none on the frame: no box, scroll position reset by the browser, no React update.
  node.clientHeight = 0;
  node.scrollTop = 0;
  resized();
  await act(() => log().props.onScroll({ currentTarget: node }));
  node.clientHeight = 300;
  resized();

  expect(node.scrollTop).toBe(410);
  // The value written while the position is being put back is not recorded as the reader's.
  node.scrollTop = 5;
  await act(() => log().props.onScroll({ currentTarget: node }));
  node.clientHeight = 0;
  resized();
  node.clientHeight = 300;
  resized();
  expect(node.scrollTop).toBe(410);
  vi.unstubAllGlobals();
});
it('offers the Project Chat "latest" control only while the newest message is out of view', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const routine = initialRealWorkspace('2026-09-10T00:00:00Z').routines[0]!;
  const scrolls: { top: number; behavior?: string }[] = [];
  const node = {
    scrollHeight: 2400,
    clientHeight: 400,
    scrollTop: 2000,
    scrollTo: (target: { top: number; behavior?: string }) => {
      scrolls.push(target);
      node.scrollTop = Math.min(target.top, node.scrollHeight - node.clientHeight);
    },
  };
  await act(() => {
    ui = create(<BriefingChat routine={routine} onSettings={vi.fn()} />, {
      createNodeMock: (e) =>
        (e.props as { className?: string }).className === 'briefing-chat-log' ? node : null,
    });
  });
  const jump = () => ui.root.findAllByProps({ className: 'briefing-chat-jump' });
  const scrollTo = async (top: number) => {
    node.scrollTop = top;
    await act(() =>
      ui.root
        .findByProps({ 'aria-label': '브리핑 대화 기록' })
        .props.onScroll({ currentTarget: node }),
    );
  };
  // Reading the newest message: no control. The same 96px tolerance as Project Chat applies.
  expect(jump()).toHaveLength(0);
  await scrollTo(1910);
  expect(jump()).toHaveLength(0);
  expect(isNearLatestMessage({ scrollTop: 1903, scrollHeight: 2400, clientHeight: 400 })).toBe(
    false,
  );
  // Scrolled up into the history: the control appears, labelled like the Project Chat one.
  await scrollTo(600);
  expect(jump()).toHaveLength(1);
  expect(jump()[0]!.props['aria-label']).toBe('최신 메시지로 이동');
  expect(JSON.stringify(ui.toJSON())).toContain('최신');
  // One click returns to the newest message and the control goes away.
  await act(() => jump()[0]!.props.onClick());
  expect(scrolls.at(-1)).toEqual({ top: 2400, behavior: 'smooth' });
  expect(jump()).toHaveLength(0);
  const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  expect(css).toMatch(/\.briefing-chat-log-region\s*\{[^}]*position: relative;/u);
  expect(css).toMatch(
    /\.briefing-chat-jump\s*\{[^}]*position: absolute;[^}]*border-radius: 999px;/u,
  );
});
it('finishes a hidden AI assistant response without cancelling or sending it twice', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: (value: unknown) => void;
  vi.mocked(workspaceStream).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const props = {
    routine: initialRealWorkspace('2026-09-10T00:00:00Z').routines[0]!,
    onSettings: vi.fn(),
  };
  await act(() => {
    ui = create(<BriefingChat {...props} />);
  });
  await send('Finish even while hidden');
  const signal = vi.mocked(workspaceStream).mock.calls[0]![2] as AbortSignal;
  await act(() => ui.update(<BriefingChat {...props} visible={false} />));
  expect(signal.aborted).toBe(false);
  await act(() => finish(result('Completed in background')));
  await act(() => ui.update(<BriefingChat {...props} visible />));
  expect(text()).toContain('Completed in background');
  expect(workspaceStream).toHaveBeenCalledOnce();
});
it('keeps only the input above the composer: restore note in the log, no duplicate progress line, context as a chip', async () => {
  const messages = [{ role: 'user', text: 'Before update', createdAt: '2026-09-13T00:00:00Z' }];
  vi.mocked(sourceRequest).mockImplementation(async (path) =>
    path === '/assistant/conversation/get' ? { messages, otherScopeMessages: 38 } : {},
  );
  await mount();
  let resolve!: (value: unknown) => void;
  vi.mocked(workspaceStream).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await click('AI 비서');
  const chat = activeChat();
  const within = (node: ReturnType<typeof activeChat>) =>
    JSON.stringify(node.children.map((c) => (typeof c === 'string' ? c : c.props)));
  const log = () => chat.findByProps({ 'aria-label': '브리핑 대화 기록' });
  const form = () => chat.findByType('form');
  // The restore note belongs to the restored conversation, not to the space above the input.
  expect(
    JSON.stringify(
      log()
        .findAllByProps({ role: 'note' })
        .map((n) => n.children),
    ),
  ).toContain('38');
  expect(
    form()
      .findAll((n) => n.props.role === 'note' || n.props.role === 'status')
      .map(within)
      .join(''),
  ).not.toContain('이전 설정의 대화');
  // The context meter is a chip in the action row with the send button, not a line of its own.
  const actions = form().findByProps({ className: 'briefing-chat-composer-actions' });
  expect(actions.findAllByProps({ className: 'briefing-context-empty' })).toHaveLength(1);
  await send('Long question');
  // While a turn runs the progress is shown once, in the conversation, with the elapsed time.
  expect(chat.findAllByProps({ className: 'briefing-chat-status' })).toHaveLength(0);
  const bubble = chat.findByProps({ className: 'briefing-chat-message assistant thinking' });
  expect(bubble.findByType('header').findByType('span').children.join('')).toMatch(
    /turn active · \d+초/,
  );
  await act(() => resolve(result('Done answer')));
  // Completion and failure messages keep their line.
  expect(chat.findByProps({ className: 'briefing-chat-status' }).children.join('')).toContain(
    '답변 완료',
  );
});
