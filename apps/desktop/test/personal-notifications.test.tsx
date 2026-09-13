import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { usePersonalNotifications } from '../src/renderer/src/use-personal-notifications';
let ui: ReactTestRenderer;
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('polls the native metadata feed even without a Briefing view and stops after unmount', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const value = { briefings: [], calendar: [], calendarState: 'disabled', calendarLimited: false };
  const notifications = vi.fn(async () => value);
  vi.stubGlobal('window', {
    gosu: { briefingLab: { notifications } },
    setInterval,
    clearInterval,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  function Fixture() {
    const state = usePersonalNotifications();
    return <p>{state.error ? 'failed' : (state.snapshot?.calendarState ?? 'loading')}</p>;
  }
  await act(() => {
    ui = create(<Fixture />);
  });
  expect(notifications).toHaveBeenCalledOnce();
  expect(JSON.stringify(ui.toJSON())).toContain('disabled');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(notifications).toHaveBeenCalledTimes(2);
  await act(() => ui.unmount());
  await vi.advanceTimersByTimeAsync(30000);
  expect(notifications).toHaveBeenCalledTimes(2);
});
