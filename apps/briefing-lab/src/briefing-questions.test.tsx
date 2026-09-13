import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BriefingQuestionSettings, DEFAULT_BRIEFING_QUESTIONS } from './briefing-questions';
import { BriefingChat } from './briefing-chat';
import { initialRealWorkspace } from './workspace-defaults';
import { briefingChatContextKey } from './briefing-model-selection';
import { workspaceStream } from './workspace-client';
import { sourceRequest } from './live-client';
vi.mock('./workspace-client', () => ({ workspaceStream: vi.fn() }));
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let ui: ReactTestRenderer;
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it('dismisses recommendations on composer clicks/typing and outside clicks, preserving drafts and saved messages', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const documentListeners = new Map<string, (event: { target: unknown }) => void>();
  const windowListeners = new Map<string, () => void>();
  vi.stubGlobal('document', {
    addEventListener: (name: string, fn: (event: { target: unknown }) => void) =>
      documentListeners.set(name, fn),
    removeEventListener: (name: string) => documentListeners.delete(name),
  });
  vi.stubGlobal('window', {
    addEventListener: (name: string, fn: () => void) => windowListeners.set(name, fn),
    removeEventListener: (name: string) => windowListeners.delete(name),
  });
  const inside = {},
    toggle = {};
  const routine = initialRealWorkspace('2026-09-10T00:00:00Z').routines[0]!;
  vi.mocked(sourceRequest).mockResolvedValue({
    messages: [
      { role: 'assistant', text: 'Saved fixture answer', createdAt: '2026-09-10T00:00:00Z' },
    ],
  });
  const props = { routine, onSettings: vi.fn() };
  await act(() => {
    ui = create(<BriefingChat {...props} />, {
      createNodeMock: (e) =>
        e.type === 'textarea'
          ? { focus: vi.fn() }
          : (e.props as { className?: string }).className === 'briefing-chat-welcome'
            ? { contains: (target: unknown) => target === inside }
            : (e.props as { 'aria-label'?: string })['aria-label'] === '추천 질문'
              ? { contains: (target: unknown) => target === toggle }
              : null,
    });
  });
  const welcome = () => ui.root.findAllByProps({ className: 'briefing-chat-welcome' }).length;
  const open = async () =>
    act(() => ui.root.findByProps({ 'aria-label': '추천 질문', type: 'button' }).props.onClick());
  expect(welcome()).toBe(1); // Saved chat is restored alongside recommendations.
  await act(() => documentListeners.get('pointerdown')?.({ target: inside }));
  expect(welcome()).toBe(1); // A suggestion remains mounted until its own click can submit.
  await act(() => documentListeners.get('pointerdown')?.({ target: toggle }));
  expect(welcome()).toBe(1); // Toggle must not close and then reopen from the same click.
  await act(() => ui.root.findByType('textarea').props.onPointerDown());
  expect(welcome()).toBe(0);
  await open();
  await act(() =>
    ui.root.findByType('textarea').props.onChange({ target: { value: 'Keep my draft' } }),
  );
  expect(welcome()).toBe(0);
  await open();
  await act(() => documentListeners.get('pointerdown')?.({ target: {} }));
  expect(welcome()).toBe(0);
  await open();
  await act(() => windowListeners.get('blur')?.());
  expect(welcome()).toBe(0);
  await act(() => ui.update(<BriefingChat {...props} visible={false} />));
  await act(() => ui.update(<BriefingChat {...props} visible />));
  expect(welcome()).toBe(1);
  expect(ui.root.findByType('textarea').props.value).toBe('Keep my draft');
  expect(JSON.stringify(ui.toJSON())).toContain('Saved fixture answer');
  expect(workspaceStream).not.toHaveBeenCalled();
  await act(() => ui.unmount());
  expect(documentListeners.has('pointerdown')).toBe(false);
  expect(windowListeners.has('blur')).toBe(false);
});
it('does not reopen dismissed suggestions when a slow history restoration finishes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: (value: unknown) => void;
  vi.mocked(sourceRequest).mockImplementation(async (path) =>
    path === '/assistant/conversation/get'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : {},
  );
  const routine = initialRealWorkspace('2026-09-10T00:00:00Z').routines[0]!;
  await act(() => {
    ui = create(<BriefingChat routine={routine} onSettings={vi.fn()} />);
  });
  await act(() => ui.root.findByType('textarea').props.onPointerDown());
  await act(() => finish({ messages: [] }));
  expect(ui.root.findAllByProps({ className: 'briefing-chat-welcome' })).toHaveLength(0);
  expect(workspaceStream).not.toHaveBeenCalled();
});
it('adds/removes questions, rejects duplicate additions and retains an empty list instead of reseeding defaults', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let current: readonly string[] | undefined;
  function Harness() {
    const [value, setValue] = useState<readonly string[]>();
    current = value;
    return <BriefingQuestionSettings value={value} onChange={setValue} />;
  }
  await act(() => {
    ui = create(<Harness />);
  });
  expect(ui.root.findAllByType('li')).toHaveLength(5);
  await act(() =>
    ui.root.findByType('input').props.onChange({ target: { value: 'My saved question' } }),
  );
  await act(() => ui.root.findByProps({ 'aria-label': '추천 질문 추가' }).props.onClick());
  expect(current).toEqual([...DEFAULT_BRIEFING_QUESTIONS, 'My saved question']);
  await act(() =>
    ui.root.findByType('input').props.onChange({ target: { value: 'My saved question' } }),
  );
  expect(ui.root.findByProps({ 'aria-label': '추천 질문 추가' }).props.disabled).toBe(true);
  while (ui.root.findAllByType('li').length)
    await act(() => ui.root.findAllByType('li')[0]!.findByType('button').props.onClick());
  expect(current).toEqual([]);
  expect(workspaceStream).not.toHaveBeenCalled();
});
it('focuses on open/reopen, does not steal focus on briefing updates, and excludes question configuration from chat reset identity', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const routine = initialRealWorkspace('2026-09-10T00:00:00Z').routines[0]!;
  const focus = vi.fn(),
    settings = vi.fn();
  await act(() => {
    ui = create(<BriefingChat routine={routine} onSettings={settings} />, {
      createNodeMock: (e) => (e.type === 'textarea' ? { focus } : null),
    });
  });
  expect(focus).toHaveBeenCalledOnce();
  await act(() =>
    ui.root.findByType('textarea').props.onChange({ target: { value: 'Keep draft' } }),
  );
  const updated = {
    ...routine,
    updatedAt: '2026-09-10T02:00:00Z',
    suggestedQuestions: ['Custom suggestion'],
  };
  expect(briefingChatContextKey(updated)).toBe(briefingChatContextKey(routine));
  await act(() => ui.update(<BriefingChat routine={updated} onSettings={settings} />));
  expect(focus).toHaveBeenCalledOnce();
  expect(ui.root.findByType('textarea').props.value).toBe('Keep draft');
  await act(() =>
    ui.update(<BriefingChat routine={updated} onSettings={settings} visible={false} />),
  );
  await act(() => ui.update(<BriefingChat routine={updated} onSettings={settings} visible />));
  expect(focus).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(ui.toJSON())).toContain('Custom suggestion');
  expect(workspaceStream).not.toHaveBeenCalled();
});
