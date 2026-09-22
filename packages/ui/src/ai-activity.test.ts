import { afterEach, expect, it, vi } from 'vitest';
import {
  acknowledgeAiActivity,
  aiActivityStatus,
  beginAiActivity,
  combineAiActivity,
  parseAiActivity,
  reduceAiActivity,
  resetAiActivitySource,
  trackAiActivity,
  trustedAiActivity,
  type AiActivityMessage,
  type AiActivityState,
} from './ai-activity';
const event = (phase: AiActivityMessage['phase'], runId = 'one'): AiActivityMessage => ({
  type: 'gosu-ai-activity',
  workload: 'model-lab',
  runId,
  phase,
});
afterEach(() => vi.unstubAllGlobals());
it('clears reloaded frame work without erasing native paper work in the same destination', () => {
  const state = { papers: { running: ['native', 'briefing-frame:one'], completed: true } };
  expect(resetAiActivitySource(state, 'papers', 'briefing-frame:')).toEqual({
    papers: { running: ['native'], completed: true },
  });
  expect(resetAiActivitySource(state, 'papers')).toEqual({});
});
it('keeps simultaneous work running, then completion until acknowledged without cross-scope changes', () => {
  let state: AiActivityState = {};
  state = reduceAiActivity(state, 'a', event('running'));
  state = reduceAiActivity(state, 'a', event('running', 'two'));
  state = reduceAiActivity(state, 'b', event('running'));
  state = reduceAiActivity(state, 'a', event('completed'));
  expect(aiActivityStatus(state, 'a')).toBe('running');
  state = reduceAiActivity(state, 'a', event('failed', 'two'));
  expect(aiActivityStatus(state, 'a')).toBe('completed');
  state = acknowledgeAiActivity(state, 'a');
  expect(aiActivityStatus(state, 'a')).toBeUndefined();
  expect(aiActivityStatus(state, 'b')).toBe('running');
  expect(combineAiActivity('completed', 'running')).toBe('running');
});
it.each(['failed', 'cancelled'] as const)(
  'never manufactures a completion after %s or restored history',
  (phase) => {
    expect(reduceAiActivity({}, 'a', event('completed'))).toEqual({});
    const state = reduceAiActivity(reduceAiActivity({}, 'a', event('running')), 'a', event(phase));
    expect(aiActivityStatus(state, 'a')).toBeUndefined();
  },
);
it('rejects extra content and messages from another frame or origin', () => {
  const frame = {} as Window;
  const e = { source: frame, origin: 'http://127.0.0.1:4567', data: event('running') };
  expect(trustedAiActivity(e, frame, e.origin + '/s/')).toEqual(e.data);
  expect(trustedAiActivity({ ...e, source: {} as Window }, frame, e.origin)).toBeNull();
  expect(trustedAiActivity({ ...e, origin: 'https://evil.invalid' }, frame, e.origin)).toBeNull();
  expect(parseAiActivity({ ...e.data, projectId: 'spoof' })).toBeNull();
  expect(parseAiActivity({ ...e.data, prompt: 'private' })).toBeNull();
  expect(parseAiActivity({ ...e.data, workload: { toString: 'not callable' } })).toBeNull();
});
it('emits only metadata, exactly one terminal state, and cancellation never twinkles', () => {
  const postMessage = vi.fn();
  vi.stubGlobal('window', { parent: { postMessage }, addEventListener: vi.fn() });
  const c = new AbortController();
  const finish = beginAiActivity('assistant', c.signal);
  c.abort();
  finish('completed');
  finish('failed');
  expect(postMessage.mock.calls.map((c) => c[0].phase)).toEqual(['running', 'cancelled']);
  expect(Object.keys(postMessage.mock.calls[0]![0]).sort()).toEqual([
    'phase',
    'runId',
    'type',
    'workload',
  ]);
});
it('publishes success only after work resolves and preserves rejection', async () => {
  const postMessage = vi.fn();
  vi.stubGlobal('window', { parent: { postMessage }, addEventListener: vi.fn() });
  await expect(trackAiActivity('papers', async () => 42)).resolves.toBe(42);
  await expect(
    trackAiActivity('papers', async () => {
      throw Error('failed');
    }),
  ).rejects.toThrow('failed');
  expect(postMessage.mock.calls.map((c) => c[0].phase)).toEqual([
    'running',
    'completed',
    'running',
    'failed',
  ]);
});
it('resynchronizes active work after the parent frame loads without replaying completion', () => {
  const postMessage = vi.fn();
  const listeners: ((event: MessageEvent) => void)[] = [];
  const parent = { postMessage };
  vi.stubGlobal('window', {
    parent,
    addEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.push(fn),
  });
  const finish = beginAiActivity('briefing');
  postMessage.mockClear();
  const sync = {
    source: parent,
    origin: 'null',
    data: { type: 'gosu-ai-activity-sync' },
  } as unknown as MessageEvent;
  listeners[0]!(sync);
  expect(postMessage).toHaveBeenCalledOnce();
  finish('completed');
  postMessage.mockClear();
  listeners[0]!(sync);
  expect(postMessage).not.toHaveBeenCalled();
});
