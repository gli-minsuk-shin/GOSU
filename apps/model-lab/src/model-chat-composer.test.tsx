import { createElement, memo } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelChatComposer, shouldSubmitModelChat } from './model-chat-composer';
import { ModelChatMarkdown } from './model-chat-markdown';
import { readFileSync } from 'node:fs';

afterEach(() => vi.unstubAllGlobals());
describe('isolated Model Lab typing', () => {
  it('accepts 50 keystrokes without rerendering the workspace, graph or transcript', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let workspaceRenders = 0;
    let graphRenders = 0;
    const Graph = memo(() => {
      graphRenders++;
      return createElement('div', null, 'graph');
    });
    const onDraftChange = vi.fn();
    const onSubmit = vi.fn();
    function Workspace() {
      workspaceRenders++;
      return createElement(
        'main',
        null,
        createElement(Graph),
        createElement(ModelChatMarkdown, { source: '$$H = WX+b$$' }),
        createElement(ModelChatComposer, {
          initialDraft: '',
          busy: false,
          hasAttachments: false,
          onDraftChange,
          onSubmit,
          onStop: vi.fn(),
        }),
      );
    }
    let renderer!: ReactTestRenderer;
    await act(() => {
      renderer = create(createElement(Workspace));
    });
    const text = 'a'.repeat(50);
    for (let index = 1; index <= text.length; index++)
      await act(() =>
        renderer.root
          .findByType('textarea')
          .props.onChange({ target: { value: text.slice(0, index) } }),
      );
    expect(workspaceRenders).toBe(1);
    expect(graphRenders).toBe(1);
    expect(renderer.root.findByType('textarea').props.value).toBe(text);
    expect(onDraftChange).toHaveBeenLastCalledWith(text);
    expect(onSubmit).not.toHaveBeenCalled();
    await act(() => renderer.root.findByType('button').props.onClick());
    expect(onSubmit).toHaveBeenCalledWith(text);
    expect(renderer.root.findByType('textarea').props.value).toBe('');
    await act(() => renderer.unmount());
  });
  it('keeps each model draft isolated when changing session keys', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const props = {
      busy: false,
      hasAttachments: false,
      onDraftChange: vi.fn(),
      onSubmit: vi.fn(),
      onStop: vi.fn(),
    };
    let renderer!: ReactTestRenderer;
    await act(() => {
      renderer = create(
        createElement(ModelChatComposer, { ...props, key: 'a', initialDraft: 'A draft' }),
      );
    });
    await act(() =>
      renderer.update(
        createElement(ModelChatComposer, { ...props, key: 'b', initialDraft: 'B draft' }),
      ),
    );
    expect(renderer.root.findByType('textarea').props.value).toBe('B draft');
    await act(() => renderer.unmount());
  });
  it('does not send on Korean IME commit or Shift+Enter', () => {
    const event = (isComposing = false, shiftKey = false, keyCode = 13) => ({
      key: 'Enter',
      shiftKey,
      nativeEvent: { isComposing, keyCode } as KeyboardEvent,
    });
    expect(shouldSubmitModelChat(event())).toBe(true);
    expect(shouldSubmitModelChat(event(true))).toBe(false);
    expect(shouldSubmitModelChat(event(false, true))).toBe(false);
    expect(shouldSubmitModelChat(event(false, false, 229))).toBe(false);
  });
  it('uses the isolated composer and stable graph callbacks in the real workspace', () => {
    const source = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<ModelChatComposer');
    expect(source).not.toContain('value={question}');
    expect(source).toContain('const setSelectedModuleId = useCallback');
    expect(source).toContain('const toggleSubgraph = useCallback');
    expect(source).toContain('const openModuleDetail = useCallback');
  });
});
