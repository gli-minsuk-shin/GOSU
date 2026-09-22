import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BriefingChat } from './briefing-chat';
import { ContextUsageMeter } from './context-usage-meter';
import { sourceRequest } from './live-client';
import { workspaceStream } from './workspace-client';
import { initialWorkspace } from './fixtures';
import {
  compactStatus,
  contextDividerIndex,
  latestContextUsage,
  newContextStatus,
} from './briefing-chat-commands';

const usage = (estimatedInputTokens: number) => ({
  windowTokens: 200000,
  windowSource: 'provider' as const,
  estimatedInputTokens,
  outputReserveTokens: 1000,
  toolReserveTokens: 1000,
  totalMessages: 4,
  includedMessages: 4,
  compressedMessages: 0,
  omittedMessages: 0,
});
let conversation: Record<string, unknown> = { messages: [] };
let queueState: Record<string, unknown> = { items: [], active: false, canSteer: false };
vi.mock('./live-client', () => ({
  sourceRequest: vi.fn(async (path: string) =>
    path === '/assistant/conversation/get'
      ? conversation
      : path === '/assistant/queue/list'
        ? queueState
        : path === '/assistant/conversation/new'
          ? { started: true, contextStartedAt: '2026-09-22T03:00:00.000Z', setAside: 2 }
          : {},
  ),
}));
vi.mock('./workspace-client', () => ({
  workspaceStream: vi.fn(async (path: string) =>
    path === '/assistant/conversation/compact'
      ? { compacted: true, summarizedMessages: 8, contextUsage: usage(1200) }
      : {
          answer: '일반 답변',
          events: [],
          tasks: [],
          sources: [],
          invocation: { providerId: 'codex', model: 'resolved', reasoning: 'high' },
          writesPerformed: 0,
        },
  ),
}));
let renderer: ReactTestRenderer;
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  conversation = { messages: [] };
  queueState = { items: [], active: false, canSteer: false };
});
const mount = async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await act(() => {
    renderer = create(
      <BriefingChat routine={initialWorkspace().routines[0]!} onSettings={vi.fn()} />,
    );
  });
};
const type = (value: string) =>
  act(() => renderer.root.findByType('textarea').props.onChange({ target: { value } }));
const submit = () =>
  act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
const paths = (mock: unknown) =>
  (mock as { mock: { calls: unknown[][] } }).mock.calls.map((call) => call[0]);
const text = () => JSON.stringify(renderer.toJSON());
const old = [
  { role: 'user' as const, text: '이전 질문', createdAt: '2026-09-22T01:00:00Z' },
  {
    role: 'assistant' as const,
    text: '이전 답변',
    createdAt: '2026-09-22T01:00:05Z',
    contextUsage: usage(90000),
  },
];

it('places the line by instant, not by text order, and ignores usage from before it', () => {
  const messages = [
    { createdAt: '2026-09-22T01:00:00Z', contextUsage: usage(90000) },
    // Same second as the cut but later: as text ".500Z" sorts before "Z".
    { createdAt: '2026-09-22T03:00:00.500Z' },
  ];
  expect(contextDividerIndex(messages, undefined)).toBe(-1);
  expect(contextDividerIndex(messages, 'not a time')).toBe(-1);
  expect(contextDividerIndex(messages, '2026-09-22T03:00:00Z')).toBe(1);
  expect(contextDividerIndex(messages.slice(0, 1), '2026-09-22T03:00:00Z')).toBe(1);
  expect(latestContextUsage(messages, undefined)?.estimatedInputTokens).toBe(90000);
  expect(latestContextUsage(messages, '2026-09-22T03:00:00Z')).toBeUndefined();
  expect(newContextStatus({ started: true, setAside: 6 })).toContain('6개');
  expect(newContextStatus({ started: false, setAside: 0 })).toContain('이미 새 대화');
  expect(compactStatus({ compacted: true, summarizedMessages: 8 })).toContain('8개');
  expect(compactStatus({ compacted: false, summarizedMessages: 0 })).toContain('아직 요약할');
});

it('/new is handled by GOSU: no question is sent, no message is added, a line marks the cut', async () => {
  conversation = { messages: old, otherScopeMessages: 0 };
  await mount();
  await type('  /NEW ');
  await submit();
  expect(paths(sourceRequest)).toContain('/assistant/conversation/new');
  expect(workspaceStream).not.toHaveBeenCalled();
  expect(renderer.root.findAllByProps({ className: 'briefing-chat-message user' })).toHaveLength(1);
  expect(renderer.root.findAllByProps({ role: 'separator' })).toHaveLength(1);
  expect(text()).toContain('이전 메시지 2개는 화면에 남지만 AI에 전달하지 않습니다');
  expect(renderer.root.findByType('textarea').props.value).toBe('');
  expect(renderer.root.findByType(ContextUsageMeter).props.usage).toBeUndefined();
});

it('/compact streams to its own route, reports what it summarized and updates the meter', async () => {
  conversation = { messages: old, otherScopeMessages: 0 };
  await mount();
  await type('/compact');
  await submit();
  expect(paths(workspaceStream)).toEqual(['/assistant/conversation/compact']);
  expect(renderer.root.findAllByProps({ className: 'briefing-chat-message user' })).toHaveLength(1);
  expect(text()).toContain('이전 메시지 8개를 요약으로 바꿨습니다');
  expect(renderer.root.findByType(ContextUsageMeter).props.usage).toMatchObject({
    estimatedInputTokens: 1200,
  });
});

it('a failed command says which command failed and why', async () => {
  await mount();
  vi.mocked(workspaceStream).mockRejectedValueOnce(new Error('문맥 정리를 완료하지 못했습니다.'));
  await type('/compact');
  await submit();
  expect(text()).toContain('/compact 실패 · 문맥 정리를 완료하지 못했습니다.');
});

it('a sentence that only starts with a command is an ordinary question', async () => {
  await mount();
  await type('/compact 이 모델 설명을 짧게 정리해줘');
  await submit();
  expect(paths(workspaceStream)).toEqual(['/assistant/chat']);
  expect(paths(sourceRequest)).not.toContain('/assistant/conversation/new');
});

it('refuses a command while an answer runs elsewhere, and neither queues nor sends it', async () => {
  queueState = { items: [], active: true, canSteer: false };
  await mount();
  await type('/new');
  await submit();
  expect(paths(sourceRequest)).not.toContain('/assistant/conversation/new');
  expect(paths(sourceRequest)).not.toContain('/assistant/queue/enqueue');
  expect(workspaceStream).not.toHaveBeenCalled();
  expect(text()).toContain('/new를 실행하지 않았습니다');
  // The command stays in the box, to press Enter again once the answer is done.
  expect(renderer.root.findByType('textarea').props.value).toBe('/new');
});

it('restores the line and the meter of the current context after a reload', async () => {
  conversation = {
    messages: [
      ...old,
      { role: 'user', text: '새 질문', createdAt: '2026-09-22T03:10:00.000Z' },
      {
        role: 'assistant',
        text: '새 답변',
        createdAt: '2026-09-22T03:10:05.000Z',
        contextUsage: usage(2100),
      },
    ],
    otherScopeMessages: 0,
    contextStartedAt: '2026-09-22T03:00:00.000Z',
  };
  await mount();
  const log = renderer.root.findByProps({ className: 'briefing-chat-log' });
  const order = log
    .findAll(
      (node) =>
        node.props.role === 'separator' ||
        (typeof node.props.className === 'string' &&
          node.props.className.startsWith('briefing-chat-message ')),
    )
    .map((node) => (node.props.role === 'separator' ? 'line' : String(node.props.className)));
  expect(order).toEqual([
    'briefing-chat-message user',
    'briefing-chat-message assistant',
    'line',
    'briefing-chat-message user',
    'briefing-chat-message assistant',
  ]);
  expect(renderer.root.findByType(ContextUsageMeter).props.usage).toMatchObject({
    estimatedInputTokens: 2100,
  });
});

it('offers the two commands while the draft is one word starting with "/", and Enter completes it', async () => {
  await mount();
  expect(renderer.root.findAllByProps({ role: 'listbox' })).toHaveLength(0);
  await type('/');
  expect(
    renderer.root
      .findByProps({ role: 'listbox' })
      .findAllByType('code')
      .map((node) => node.children.join('')),
  ).toEqual(['/new', '/compact']);
  await type('/c');
  await act(() =>
    renderer.root.findByType('textarea').props.onKeyDown({
      key: 'Enter',
      shiftKey: false,
      nativeEvent: { isComposing: false },
      preventDefault: vi.fn(),
    }),
  );
  expect(renderer.root.findByType('textarea').props.value).toBe('/compact');
  expect(workspaceStream).not.toHaveBeenCalled();
  await type('/compact now');
  expect(renderer.root.findAllByProps({ role: 'listbox' })).toHaveLength(0);
});
