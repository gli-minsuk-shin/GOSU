import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { ConnectionRecovery } from './connection-recovery';
import { initialRealWorkspace } from './workspace-defaults';
const request = vi.hoisted(() => vi.fn());
vi.mock('./live-client', () => ({ sourceRequest: request }));
vi.mock('./desktop-bridge', () => ({ isGosuEmbedded: () => true }));
afterEach(() => {
  vi.unstubAllGlobals();
  request.mockReset();
});
it('offers direct reconnect only when saved connections need approval', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  request
    .mockResolvedValueOnce({ needsApproval: true })
    .mockResolvedValue({ needsApproval: false });
  let ui: ReturnType<typeof create>;
  await act(() => {
    ui = create(
      <ConnectionRecovery
        routines={initialRealWorkspace('2026-09-11T00:00:00Z').routines}
        revision={false}
      />,
    );
  });
  expect(request).toHaveBeenCalledTimes(1);
  await act(() => ui!.root.findByType('button').props.onClick());
  expect(request).toHaveBeenLastCalledWith(
    '/assistant/settings/reconnect',
    { routineId: 'personal-research' },
    expect.any(AbortSignal),
  );
  expect(ui!.toJSON()).toBeNull();
  await act(() => ui!.unmount());
});
it('does not prompt or save settings again for an already approved client', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  request.mockResolvedValue({ needsApproval: false });
  let ui: ReturnType<typeof create>;
  await act(() => {
    ui = create(
      <ConnectionRecovery
        routines={initialRealWorkspace('2026-09-11T00:00:00Z').routines}
        revision={false}
      />,
    );
  });
  expect(ui!.toJSON()).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  await act(() => ui!.unmount());
});
