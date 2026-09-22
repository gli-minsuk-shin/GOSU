import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BriefingActivityMonitor } from './briefing-activity-monitor';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let ui: ReactTestRenderer;
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const job = {
  id: '11111111-1111-4111-8111-111111111111',
  routineId: 'r',
  runId: null,
  detail: '',
  newCount: 1,
  startedAt: '2026-09-15T00:00:00Z',
  updatedAt: '2026-09-15T00:00:01Z',
  error: null,
};
it('observes running and completed jobs independently of the visible controls without starting work', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const postMessage = vi.fn();
  vi.stubGlobal('window', {
    location: { search: '?embedded=gosu' },
    parent: { postMessage },
    addEventListener: vi.fn(),
  });
  vi.mocked(sourceRequest)
    .mockResolvedValueOnce({ job: { ...job, state: 'complete' } })
    .mockResolvedValueOnce({ job: { ...job, state: 'running' } })
    .mockResolvedValue({ job: { ...job, state: 'complete' } });
  await act(() => {
    ui = create(<BriefingActivityMonitor routineId="r" />);
  });
  expect(postMessage).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(postMessage.mock.calls.map((c) => c[0].phase)).toEqual(['running']);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(postMessage.mock.calls.map((c) => c[0].phase)).toEqual(['running', 'completed']);
  expect(vi.mocked(sourceRequest).mock.calls.every((c) => c[0] === '/generation/status')).toBe(
    true,
  );
});
it('clears an unconfirmed running marker after repeated status failures instead of inventing completion', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const postMessage = vi.fn();
  vi.stubGlobal('window', {
    location: { search: '?embedded=gosu' },
    parent: { postMessage },
    addEventListener: vi.fn(),
  });
  vi.mocked(sourceRequest)
    .mockResolvedValueOnce({ job: { ...job, state: 'running' } })
    .mockRejectedValue(Error('offline'));
  await act(() => {
    ui = create(<BriefingActivityMonitor routineId="r" />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9000);
  });
  expect(postMessage.mock.calls.map((c) => c[0].phase)).toEqual(['running', 'failed']);
});
