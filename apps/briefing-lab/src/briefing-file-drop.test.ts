import { afterEach, expect, it, vi } from 'vitest';
import { reserveBriefingFileDrop } from './briefing-file-drop';
afterEach(() => vi.unstubAllGlobals());
it('sends only selected Files to the app parent and accepts only the matching trusted response', async () => {
  const handlers = new Set<(event: MessageEvent) => void>(),
    parent = { postMessage: vi.fn() };
  vi.stubGlobal('window', {
    parent,
    location: { search: '?embedded=gosu' },
    addEventListener: (_name: string, listener: (event: MessageEvent) => void) =>
      handlers.add(listener),
    removeEventListener: (_name: string, listener: (event: MessageEvent) => void) =>
      handlers.delete(listener),
  });
  const files = [new File(['fixture'], 'fixture.txt')];
  const pending = reserveBriefingFileDrop('r', files);
  const payload = parent.postMessage.mock.calls[0]![0];
  expect(payload).toEqual({
    type: 'gosu-briefing-file-drop',
    requestId: expect.any(String),
    routineId: 'r',
    files,
  });
  expect(payload).not.toHaveProperty('clientToken');
  expect(payload).not.toHaveProperty('paths');
  const ticket = '11111111-1111-4111-8111-111111111111';
  const send = (origin: string, source: unknown, requestId: string) => {
    for (const handle of handlers)
      handle({
        origin,
        source,
        data: { type: 'gosu-briefing-file-drop-result', requestId, ticket },
      } as MessageEvent);
  };
  send('https://evil.test', parent, payload.requestId);
  expect(handlers.size).toBe(1);
  send('null', {}, payload.requestId);
  expect(handlers.size).toBe(1);
  send('null', parent, 'wrong');
  expect(handlers.size).toBe(1);
  send('null', parent, payload.requestId);
  expect(await pending).toBe(ticket);
  expect(handlers.size).toBe(0);
});
it('does not forward drops from an ordinary website to its parent', async () => {
  const parent = { postMessage: vi.fn() };
  vi.stubGlobal('window', { parent, location: { search: '' } });
  await expect(reserveBriefingFileDrop('r', [new File(['x'], 'x.txt')])).rejects.toThrow('GOSU 앱');
  expect(parent.postMessage).not.toHaveBeenCalled();
});
