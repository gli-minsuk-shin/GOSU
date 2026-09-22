import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setUiLanguage } from '@gosu/ui/language';
import { ModelChatComposer } from './model-chat-composer';
import {
  modelChatCommandDescription,
  modelChatCommandFailure,
  modelChatCommandFinished,
  modelChatCommandMenu,
  modelChatCommandRunning,
  modelChatContextDividerText,
  modelChatContextStart,
  modelChatSubmission,
  trimmedModelChatContextStart,
} from './model-chat-commands';
import { loadModelLabChats, saveModelLabChats } from './model-lab-chat-storage';
import type { ChatMessage, ModelChatSession } from './model-lab-app';

afterEach(() => {
  setUiLanguage('en');
  vi.unstubAllGlobals();
});

const message = (index: number): ChatMessage => ({
  id: `m${index}`,
  modelId: 'model-a',
  modelVersion: '1',
  createdAt: '2026-09-14T00:00:00.000Z',
  role: index % 2 ? 'assistant' : 'user',
  body: `Message ${index}`,
});

describe('Model Assistant context commands', () => {
  it('offers only the matching commands with a one-line description each', () => {
    expect(modelChatCommandMenu('/')).toEqual([
      { command: '/new', description: 'Start a fresh context; earlier messages stay visible' },
      { command: '/compact', description: 'Summarize earlier messages now' },
    ]);
    expect(modelChatCommandMenu('/co').map((entry) => entry.command)).toEqual(['/compact']);
    expect(modelChatCommandMenu('/compact the model before export')).toEqual([]);
    expect(modelChatCommandMenu('what is /new')).toEqual([]);
    setUiLanguage('ko');
    expect(modelChatCommandDescription('/new')).toBe(
      '새 문맥으로 시작 · 이전 메시지는 화면에 남습니다',
    );
    expect(modelChatCommandDescription('/compact')).toBe('이전 대화를 지금 요약');
  });

  it('routes a whole-message command away from the model and refuses it while busy', () => {
    const idle = { answering: false, commandRunning: false };
    expect(modelChatSubmission('/compact the model before export', idle)).toEqual({
      kind: 'question',
    });
    expect(modelChatSubmission('  /NEW  ', idle)).toEqual({ kind: 'command', command: '/new' });
    const answering = modelChatSubmission('/compact', { ...idle, answering: true });
    expect(answering.kind).toBe('refused');
    expect(answering.kind === 'refused' && answering.status).toEqual({
      command: '/compact',
      phase: 'failed',
      message:
        'A Model Assistant answer is still running, so /compact was not run. Stop the answer or wait for it, then retry.',
    });
    const running = modelChatSubmission('/new', { ...idle, commandRunning: true });
    expect(running.kind === 'refused' && running.status.message).toBe(
      'A context command is already running, so /new was not run.',
    );
  });

  it('names the outcome of every command run, including the failure code', () => {
    expect(modelChatCommandRunning('/compact').message).toBe('Compacting the conversation…');
    expect(modelChatCommandRunning('/new').message).toBe('Starting a fresh context…');
    expect(modelChatCommandFinished('/new', { compacted: false, summarizedMessages: 0 })).toEqual({
      command: '/new',
      phase: 'done',
      message:
        'A fresh context started. Earlier messages stay visible but are not sent to the model.',
    });
    expect(
      modelChatCommandFinished('/compact', { compacted: true, summarizedMessages: 18 }).message,
    ).toBe('Summarized 18 earlier messages; the originals are kept.');
    expect(
      modelChatCommandFinished('/compact', { compacted: false, summarizedMessages: 0 }).message,
    ).toBe('There is nothing older to summarize yet.');
    expect(modelChatCommandFailure('/compact', 'model_chat_context_busy')).toEqual({
      command: '/compact',
      phase: 'failed',
      message:
        'The /compact command failed and the conversation is unchanged. Error code: model_chat_context_busy.',
    });
    setUiLanguage('ko');
    expect(modelChatCommandRunning('/compact').message).toBe('대화 문맥을 정리하는 중…');
    expect(
      modelChatCommandFinished('/compact', { compacted: true, summarizedMessages: 2 }).message,
    ).toBe('이전 메시지 2개를 요약으로 바꿨습니다. 원본은 그대로 보존됩니다.');
    expect(modelChatCommandFailure('/new', 'model_copilot_llm_unavailable').message).toBe(
      '/new 명령을 실행하지 못했고 대화는 그대로입니다. 오류 코드: model_copilot_llm_unavailable.',
    );
    expect(modelChatContextDividerText()).toBe(
      '여기부터 새 대화 · 위 메시지는 모델에 전달되지 않습니다',
    );
  });

  it('keeps the divider inside the transcript, including a trimmed or unmarked session', () => {
    expect(modelChatContextStart(undefined, 12)).toBe(0);
    expect(modelChatContextStart('4', 12)).toBe(0);
    expect(modelChatContextStart(-2, 12)).toBe(0);
    expect(modelChatContextStart(4, 12)).toBe(4);
    expect(modelChatContextStart(40, 12)).toBe(12);
    expect(trimmedModelChatContextStart(250, 300, 200)).toBe(150);
    expect(trimmedModelChatContextStart(40, 300, 200)).toBe(0);
    expect(trimmedModelChatContextStart(300, 300, 200)).toBe(200);
    expect(trimmedModelChatContextStart(4, 10, 200)).toBe(4);
  });

  it('remembers the divider position across a reload and reads sessions saved without one', () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    };
    const messages = Array.from({ length: 6 }, (_, index) => message(index));
    const sessions: Record<string, ModelChatSession> = {
      fresh: { draft: '', attachments: [], messages },
      reset: { draft: '', attachments: [], messages, contextStartsAt: 4 },
    };
    saveModelLabChats(storage, sessions, {});
    const reloaded = loadModelLabChats(storage);
    expect(reloaded.reset?.contextStartsAt).toBe(4);
    expect(reloaded.reset?.messages).toHaveLength(6);
    expect(reloaded.fresh?.contextStartsAt).toBeUndefined();
  });

  it('shows the command menu above the composer and fills the draft when one is clicked', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const onDraftChange = vi.fn();
    const onSubmit = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(() => {
      renderer = create(
        createElement(ModelChatComposer, {
          initialDraft: '',
          busy: false,
          hasAttachments: false,
          onDraftChange,
          onSubmit,
          onStop: vi.fn(),
        }),
      );
    });
    expect(renderer.root.findAllByType('li')).toHaveLength(0);
    await act(() =>
      renderer.root.findByType('textarea').props.onChange({ target: { value: '/c' } }),
    );
    const items = renderer.root.findAllByType('li');
    expect(items).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).toContain('Summarize earlier messages now');
    await act(() => items[0]!.findByType('button').props.onClick());
    expect(renderer.root.findByType('textarea').props.value).toBe('/compact');
    expect(onDraftChange).toHaveBeenLastCalledWith('/compact');
    expect(onSubmit).not.toHaveBeenCalled();
    await act(() => renderer.unmount());
  });

  it('completes a half-typed command on Enter instead of sending it to the model', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const onSubmit = vi.fn();
    const onDraftChange = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(() => {
      renderer = create(
        createElement(ModelChatComposer, {
          initialDraft: '',
          busy: false,
          hasAttachments: false,
          onDraftChange,
          onSubmit,
          onStop: vi.fn(),
        }),
      );
    });
    const enter = () =>
      act(() =>
        renderer.root.findByType('textarea').props.onKeyDown({
          key: 'Enter',
          shiftKey: false,
          nativeEvent: { isComposing: false, keyCode: 13 },
          preventDefault: vi.fn(),
        }),
      );
    await act(() =>
      renderer.root.findByType('textarea').props.onChange({ target: { value: '/n' } }),
    );
    await enter();
    expect(renderer.root.findByType('textarea').props.value).toBe('/new');
    expect(onDraftChange).toHaveBeenLastCalledWith('/new');
    expect(onSubmit).not.toHaveBeenCalled();
    await enter();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('/new');
    await act(() => renderer.unmount());
  });

  it('submits a command while an answer runs so the refusal is visible, but not a question', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const onSubmit = vi.fn();
    const props = {
      initialDraft: '',
      busy: true,
      hasAttachments: false,
      onDraftChange: vi.fn(),
      onSubmit,
      onStop: vi.fn(),
    };
    let renderer!: ReactTestRenderer;
    await act(() => {
      renderer = create(createElement(ModelChatComposer, props));
    });
    const enter = {
      key: 'Enter',
      shiftKey: false,
      nativeEvent: { isComposing: false, keyCode: 13 },
      preventDefault: () => undefined,
    };
    const textarea = () => renderer.root.findByType('textarea');
    await act(() => textarea().props.onChange({ target: { value: 'What is lambda?' } }));
    await act(() => textarea().props.onKeyDown(enter));
    expect(onSubmit).not.toHaveBeenCalled();
    await act(() => textarea().props.onChange({ target: { value: '/compact' } }));
    await act(() => textarea().props.onKeyDown(enter));
    expect(onSubmit).toHaveBeenCalledWith('/compact');
    await act(() => renderer.unmount());
  });

  it('intercepts the command in the workspace before a message or an answer request is made', () => {
    const source = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    const submit = source.slice(source.indexOf('const submitQuestion = async ('));
    const intercept = submit.indexOf('modelChatSubmission(');
    expect(intercept).toBeGreaterThan(-1);
    expect(intercept).toBeLessThan(submit.indexOf('setMessages((current) => ['));
    expect(intercept).toBeLessThan(submit.indexOf('gosuModelLabRuntime.answer('));
    // The bootstrap history the first write sends must stop at the divider.
    expect(source).toContain('conversation: modelFacingMessages.map((message) => ({');
    expect(source).toContain('const modelFacingMessages = messages.slice(chatContextStartsAt);');
    // The transcript keeps every message and marks the reset point between them.
    expect(source).toContain('chatContextStartsAt > 0 && messageIndex === chatContextStartsAt ? (');
    expect(source).toContain('className="model-chat__context-divider"');
  });
});
