import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BriefingGenerationControls } from './briefing-generation-controls';
import { isBriefingRunShortcut } from './desktop-bridge';
import { sourceRequest } from './live-client';

vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let ui: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => ui?.unmount());
  ui = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const chord = (extra: Partial<KeyboardEvent> = {}) =>
  ({
    key: 'Enter',
    shiftKey: true,
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    repeat: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...extra,
  }) as unknown as KeyboardEvent;
const idle = { intervalHours: 4, nextDueAt: null, scheduleError: null, job: null };

it('recognizes only ⇧⌘Enter (⇧Ctrl+Enter), not while composing or repeating', () => {
  expect(isBriefingRunShortcut(chord())).toBe(true);
  expect(isBriefingRunShortcut(chord({ metaKey: false, ctrlKey: true }))).toBe(true);
  for (const other of [
    { shiftKey: false },
    { metaKey: false },
    { altKey: true },
    { isComposing: true },
    { repeat: true },
    { key: 'a' },
  ])
    expect(isBriefingRunShortcut(chord(other))).toBe(false);
});

async function mount(view: unknown, embedded = true) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const listeners = new Map<string, ((event: never) => void)[]>();
  const parent = { postMessage: vi.fn() };
  vi.stubGlobal('window', {
    location: { search: embedded ? '?embedded=gosu' : '' },
    parent,
    addEventListener: (type: string, handler: (event: never) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), handler]),
    removeEventListener: (type: string, handler: (event: never) => void) =>
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((h) => h !== handler),
      ),
    dispatchEvent: vi.fn(),
  });
  vi.mocked(sourceRequest).mockResolvedValue(view);
  await act(() => {
    ui = create(<BriefingGenerationControls routineId="r" />);
  });
  const fire = async (type: string, event: unknown) =>
    act(async () => {
      for (const handler of listeners.get(type) ?? []) handler(event as never);
      await Promise.resolve();
    });
  return { fire, parent, listeners };
}
const starts = () =>
  vi.mocked(sourceRequest).mock.calls.filter(([path]) => path === '/generation/start').length;

it('on its own, starts a new briefing on the default ⇧⌘Enter exactly like the button', async () => {
  const f = await mount(idle, false);
  const button = ui!.root.findByProps({ 'aria-label': '브리핑 생성' });
  expect(button.props.title).toContain('(⇧⌘Enter)');
  const event = chord();
  await f.fire('keydown', event);
  expect(starts()).toBe(1);
  expect(sourceRequest).toHaveBeenCalledWith(
    '/generation/start',
    { routineId: 'r' },
    expect.anything(),
  );
  expect(event.preventDefault).toHaveBeenCalled();
  // Other keys stay with whoever has the focus (the chat sends on Enter).
  await f.fire('keydown', chord({ shiftKey: false }));
  await f.fire('keydown', chord({ isComposing: true }));
  expect(starts()).toBe(1);
});

it('inside GOSU leaves the chord to the shortcut settings and shows the chord the shell reports', async () => {
  // The user can change or turn off the chord in Settings → Shortcuts. If this frame still reacted
  // to a hardcoded ⇧⌘Enter, the old chord would keep working after a change.
  const f = await mount(idle);
  await f.fire('keydown', chord());
  expect(starts()).toBe(0);
  const title = () => ui!.root.findByProps({ 'aria-label': '브리핑 생성' }).props.title as string;
  expect(title()).not.toContain('Enter');
  const navigation = (runShortcut: unknown) => ({
    source: f.parent,
    origin: 'http://127.0.0.1:5173',
    data: { type: 'gosu-briefing-navigation', view: 'history', runShortcut },
  });
  await f.fire('message', navigation('Ctrl + ⌥ + R'));
  expect(title()).toContain('지금 브리핑 생성 (Ctrl + ⌥ + R)');
  // Turned off in the settings: no chord is promised.
  await f.fire('message', navigation(null));
  expect(title()).toContain('지금 브리핑 생성 ·');
  // The shell's message is what starts the run.
  await f.fire('message', { ...navigation(null), data: { type: 'gosu-briefing-run-now' } });
  expect(starts()).toBe(1);
});

it('does nothing while a run is in progress, as the disabled button would', async () => {
  const f = await mount({
    ...idle,
    job: { id: 'j', state: 'running', newCount: 0, detail: '이메일 조회 중', error: null },
  });
  await f.fire('message', {
    source: f.parent,
    origin: 'http://127.0.0.1:5173',
    data: { type: 'gosu-briefing-run-now' },
  });
  expect(starts()).toBe(0);
});

it('takes the chord forwarded by the desktop shell, from the parent window only', async () => {
  const f = await mount(idle);
  const message = (source: unknown, type: string) => ({
    source,
    origin: 'http://127.0.0.1:5173',
    data: { type },
  });
  await f.fire('message', message({}, 'gosu-briefing-run-now'));
  await f.fire('message', message(f.parent, 'something-else'));
  expect(starts()).toBe(0);
  await f.fire('message', message(f.parent, 'gosu-briefing-run-now'));
  expect(starts()).toBe(1);
  await act(() => ui!.unmount());
  ui = undefined;
  expect(f.listeners.get('keydown')).toEqual([]);
  expect(f.listeners.get('message')).toEqual([]);
});
