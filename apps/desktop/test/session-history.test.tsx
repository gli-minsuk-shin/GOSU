import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { useSessionHistory } from '../src/renderer/src/use-session-history';
it('returns through previous sessions without recording back itself as a new navigation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const restore = vi.fn();
  function Fixture({ view }: { view: string }) {
    const history = useSessionHistory({ view }, restore);
    return (
      <button disabled={!history.canGoBack} onClick={history.back}>
        Back
      </button>
    );
  }
  let ui: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(<Fixture view="briefing" />);
    });
    expect(ui!.root.findByType('button').props.disabled).toBe(true);
    await act(() => ui!.update(<Fixture view="calendar" />));
    await act(() => ui!.update(<Fixture view="tasks" />));
    await act(() => ui!.root.findByType('button').props.onClick());
    expect(restore).toHaveBeenLastCalledWith({ view: 'calendar' });
    await act(() => ui!.update(<Fixture view="calendar" />));
    await act(() => ui!.root.findByType('button').props.onClick());
    expect(restore).toHaveBeenLastCalledWith({ view: 'briefing' });
    await act(() => ui!.update(<Fixture view="briefing" />));
    expect(ui!.root.findByType('button').props.disabled).toBe(true);
  } finally {
    await act(() => ui!?.unmount());
    vi.unstubAllGlobals();
  }
});
