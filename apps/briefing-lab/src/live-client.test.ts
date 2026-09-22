import { afterEach, expect, it, vi } from 'vitest';
import { sourceRequest } from './live-client';

vi.mock('./briefing-client-session', () => ({ briefingHeaders: async () => ({}) }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

it('waits and resends a request the server refused as busy, since it was never handled', async () => {
  // The Briefing Lab server turns away a fourth concurrent request with 429 routine_busy before it
  // reads the body, so sending it again cannot repeat any action.
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(reply(429, { error: 'routine_busy' }))
    .mockResolvedValueOnce(reply(429, { error: 'routine_busy' }))
    .mockResolvedValueOnce(reply(200, { items: [] }));
  vi.stubGlobal('fetch', fetch);
  const pending = sourceRequest('/assistant/guidance/list', { routineId: 'r' });
  await vi.runAllTimersAsync();
  await expect(pending).resolves.toEqual({ items: [] });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[2]![1].body).toBe(JSON.stringify({ routineId: 'r' }));
});

it('explains a server that stays busy in Korean and keeps the code, and never resends other failures', async () => {
  vi.useFakeTimers();
  const busy = vi.fn(async () => reply(429, { error: 'routine_busy' }));
  vi.stubGlobal('fetch', busy);
  const pending = sourceRequest('/assistant/guidance/list', { routineId: 'r' }).catch((e) => e);
  await vi.runAllTimersAsync();
  const error = (await pending) as Error & { code?: string };
  expect(busy).toHaveBeenCalledTimes(4);
  expect(error.message).toContain('다른 요청');
  expect(error.message).not.toContain('routine_busy');
  expect(error.code).toBe('routine_busy');
  const denied = vi.fn(async () => reply(400, { error: '브리핑 지침은 최대 20개입니다.' }));
  vi.stubGlobal('fetch', denied);
  await expect(
    sourceRequest('/assistant/guidance/add', { routineId: 'r', text: 'x' }),
  ).rejects.toThrow('최대 20개');
  expect(denied).toHaveBeenCalledOnce();
});

it('stops waiting for a busy server when the request is cancelled', async () => {
  vi.useFakeTimers();
  const busy = vi.fn(async () => reply(429, { error: 'routine_busy' }));
  vi.stubGlobal('fetch', busy);
  const controller = new AbortController();
  const pending = sourceRequest('/history/list', { routineId: 'r' }, controller.signal).catch(
    (e) => e,
  );
  await vi.advanceTimersByTimeAsync(10);
  controller.abort();
  await vi.runAllTimersAsync();
  expect(((await pending) as Error).name).toBe('AbortError');
  expect(busy).toHaveBeenCalledOnce();
});
