import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createCodexModelCatalog } from '@gosu/contracts';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { BriefingModelMenu } from './briefing-model-menu';
import { briefingChatContextKey } from './briefing-model-selection';
import { initialWorkspace } from './fixtures';
import { sourceRequest } from './live-client';
import { createRoutineClient } from './routine-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
vi.mock('./routine-client', () => ({ createRoutineClient: vi.fn() }));
let ui: ReactTestRenderer | undefined;
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(async () => {
  await act(() => ui?.unmount());
  ui = undefined;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const prefs = {
  ...defaultAssistantPreferences(),
  modelId: 'first',
  reasoning: 'low',
  mailRead: true,
  mailAi: true,
};
const routine = () => ({
  ...initialWorkspace().routines[0]!,
  live: { ...defaultLiveSettings(), assistant: prefs },
});
async function setup() {
  const catalog = createCodexModelCatalog([
    {
      id: 'first',
      model: 'first',
      displayName: 'First',
      isDefault: true,
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
    },
    {
      id: 'future',
      model: 'future',
      displayName: 'Future model',
      isDefault: false,
      supportedReasoningEfforts: [{ reasoningEffort: 'deep-new' }],
    },
  ]);
  const models = vi.fn(async () => [{ providerId: 'codex', catalog, error: null }]);
  vi.mocked(createRoutineClient).mockReturnValue({ models } as never);
  vi.mocked(sourceRequest).mockImplementation(async (path, input) =>
    path === '/assistant/model/current'
      ? { modelId: 'gpt-6-astra', displayName: 'GPT-6-Astra', reasoning: 'high' }
      : path === '/assistant/settings/get'
        ? { preferences: prefs, approved: true }
        : { saved: true, selection: (input as { selection: unknown }).selection },
  );
  const onSaved = vi.fn(),
    onSavingChange = vi.fn();
  await act(() => {
    ui = create(
      <BriefingModelMenu
        routine={routine()}
        onSaved={onSaved}
        onSavingChange={onSavingChange}
        onSettings={vi.fn()}
      />,
    );
  });
  return { models, onSaved, onSavingChange };
}
it('loads provider-owned choices on opening and saves only the selected model triple', async () => {
  const f = await setup();
  expect(f.models).not.toHaveBeenCalled();
  await act(() => ui!.root.findByProps({ 'aria-label': 'Briefing 모델 변경' }).props.onClick());
  const field = (name: string) => ui!.root.findByProps({ 'aria-label': name });
  await act(() => field('Briefing 모델').props.onChange({ target: { value: 'future' } }));
  expect(field('Briefing reasoning').props.value).toBe('');
  expect(
    field('Briefing reasoning')
      .findAllByType('option')
      .map((node) => node.props.value),
  ).toContain('deep-new');
  await act(() => field('Briefing reasoning').props.onChange({ target: { value: 'deep-new' } }));
  await act(async () => ui!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  const saved = vi.mocked(sourceRequest).mock.calls.find((c) => c[0] === '/assistant/model/save')!;
  expect(saved[1]).toEqual({
    routineId: routine().id,
    selection: { providerId: 'codex', modelId: 'future', reasoning: 'deep-new' },
    expectedSelection: { providerId: 'codex', modelId: 'first', reasoning: 'low' },
  });
  expect(f.onSaved).toHaveBeenCalledWith({
    providerId: 'codex',
    modelId: 'future',
    reasoning: 'deep-new',
  });
  expect(f.onSavingChange.mock.calls.map((c) => c[0])).toEqual([true, false]);
});
it('shows the execution-resolved model and effort rather than the catalog default', async () => {
  await setup();
  await act(() => ui!.root.findByProps({ 'aria-label': 'Briefing 모델 변경' }).props.onClick());
  const label = ui!.root.findByProps({ 'aria-label': 'Briefing 모델 변경' });
  expect(label.findAllByType('span')[0]!.children.join('')).toBe('GPT-6-Astra');
  expect(label.findByType('small').children.join('')).toBe('high');
});
it('keeps unavailable explicit pins instead of silently selecting a different model', async () => {
  await setup();
  vi.mocked(sourceRequest).mockResolvedValueOnce({ preferences: { ...prefs, modelId: 'removed' } });
  await act(() => ui!.root.findByProps({ 'aria-label': 'Briefing 모델 변경' }).props.onClick());
  expect(ui!.root.findByProps({ 'aria-label': 'Briefing 모델' }).props.value).toBe('removed');
  expect(ui!.root.findByProps({ type: 'submit' }).props.disabled).toBe(true);
});
it('does not claim a denied save succeeded and releases the send lock', async () => {
  const f = await setup();
  await act(() => ui!.root.findByProps({ 'aria-label': 'Briefing 모델 변경' }).props.onClick());
  vi.mocked(sourceRequest).mockRejectedValueOnce(new Error('변경 거부됨'));
  await act(async () => ui!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  expect(f.onSaved).not.toHaveBeenCalled();
  expect(ui!.root.findByProps({ role: 'alert' }).children.join('')).toContain('변경 거부됨');
  expect(f.onSavingChange.mock.calls.at(-1)).toEqual([false]);
});
it('preserves the chat identity for same-provider model changes but resets on provider/scope changes', () => {
  const r = routine(),
    key = briefingChatContextKey(r);
  expect(
    briefingChatContextKey({
      ...r,
      updatedAt: 'later',
      live: { ...r.live, assistant: { ...prefs, modelId: 'future', reasoning: null } },
    }),
  ).toBe(key);
  expect(
    briefingChatContextKey({
      ...r,
      live: { ...r.live, assistant: { ...prefs, mailOpenConfirmation: 'ask' } },
    }),
  ).toBe(key);
  expect(
    briefingChatContextKey({
      ...r,
      live: { ...r.live, assistant: { ...prefs, providerId: 'claude-code' } },
    }),
  ).not.toBe(key);
  expect(
    briefingChatContextKey({ ...r, live: { ...r.live, assistant: { ...prefs, mailAi: false } } }),
  ).not.toBe(key);
});
it('disables model editing during an active response', async () => {
  const f = await setup();
  await act(() => {
    ui!.update(
      <BriefingModelMenu
        routine={routine()}
        busy
        onSaved={f.onSaved}
        onSavingChange={f.onSavingChange}
        onSettings={vi.fn()}
      />,
    );
  });
  expect(ui!.root.findByProps({ 'aria-label': 'Briefing 모델 변경' }).props.disabled).toBe(true);
  expect(f.models).not.toHaveBeenCalled();
});
