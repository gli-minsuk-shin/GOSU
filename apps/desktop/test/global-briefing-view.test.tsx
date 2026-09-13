import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { GlobalBriefingView } from '../src/renderer/src/global-briefing-view';
import { BRIEFING_LAB_URL, validBriefingLocation } from '../src/shared/briefing-lab-contracts';
import { rendererContentSecurityPolicy, createTrustedRenderer } from '../src/main/renderer-trust';
let ui: ReactTestRenderer;
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.unstubAllGlobals();
});
it('uses one sandboxed global frame across Calendar, hidden and Briefing views', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const open = vi.fn(async () => ({ url: BRIEFING_LAB_URL, configuration: {} }));
  const openPrivacy = vi.fn();
  const reserveDroppedAttachments = vi.fn(async () => ({
    ticket: '11111111-1111-4111-8111-111111111111',
  }));
  const handlers = new Set<(event: MessageEvent) => void>();
  const child = { postMessage: vi.fn() };
  vi.stubGlobal('window', {
    gosu: { briefingLab: { open, openPrivacy, reserveDroppedAttachments } },
    addEventListener: (_type: string, fn: (event: MessageEvent) => void) => handlers.add(fn),
    removeEventListener: (_type: string, fn: (event: MessageEvent) => void) => handlers.delete(fn),
  });
  await act(() => {
    ui = create(<GlobalBriefingView view="calendar" />, {
      createNodeMock: (el) => (el.type === 'iframe' ? { contentWindow: child } : null),
    });
  });
  const frame = ui.root.findByType('iframe');
  expect(frame.props.sandbox).toBe('allow-scripts allow-same-origin allow-downloads allow-popups');
  await act(() => ui.update(<GlobalBriefingView view={null} />));
  expect(ui.root.findByType('iframe')).toBe(frame);
  await act(() => ui.update(<GlobalBriefingView view="assistant" />));
  expect(ui.root.findByType('iframe')).toBe(frame);
  expect(ui.root.findByProps({ className: 'global-briefing-view' }).props['data-view']).toBe(
    'assistant',
  );
  expect(ui.root.findByProps({ className: 'global-briefing-view' }).props['aria-label']).toBe(
    'AI 비서',
  );
  await act(() => ui.update(<GlobalBriefingView view="history" />));
  expect(ui.root.findByType('iframe')).toBe(frame);
  await act(() => ui.update(<GlobalBriefingView view="settings" />));
  await act(() => ui.update(<GlobalBriefingView view="papers" />));
  expect(child.postMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({ view: 'papers' }),
    'http://127.0.0.1:4318',
  );
  await act(() => ui.update(<GlobalBriefingView view="settings" />));
  expect(ui.root.findByType('iframe')).toBe(frame);
  expect(open).toHaveBeenCalledOnce();
  const briefingTarget = {
    routineId: 'r',
    runId: '11111111-1111-4111-8111-111111111111',
    requestId: 1,
  };
  await act(() => ui.update(<GlobalBriefingView view="history" briefingTarget={briefingTarget} />));
  expect(child.postMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({ view: 'history', briefingTarget }),
    'http://127.0.0.1:4318',
  );
  await act(() => ui.update(<GlobalBriefingView view="settings" />));
  child.postMessage.mockClear();
  for (const handler of handlers)
    handler({
      source: child,
      origin: 'https://evil.test',
      data: { type: 'gosu-briefing-ready' },
    } as unknown as MessageEvent);
  expect(child.postMessage).not.toHaveBeenCalled();
  for (const handler of handlers)
    handler({
      source: child,
      origin: 'http://127.0.0.1:4318',
      data: { type: 'gosu-briefing-ready' },
    } as unknown as MessageEvent);
  expect(child.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'gosu-briefing-navigation', view: 'settings' }),
    'http://127.0.0.1:4318',
  );
  const onOpenItem = vi.fn();
  await act(() => ui.update(<GlobalBriefingView view="history" onOpenItem={onOpenItem} />));
  for (const origin of ['https://evil.test', 'http://127.0.0.1:4318'])
    for (const handler of handlers)
      handler({
        source: child,
        origin,
        data: { type: 'gosu-briefing-open-item', target: { kind: 'task', id: 'task-a' } },
      } as unknown as MessageEvent);
  expect(onOpenItem).toHaveBeenCalledExactlyOnceWith({ kind: 'task', id: 'task-a' });
  for (const origin of ['https://evil.test', 'http://127.0.0.1:4318'])
    for (const handler of handlers)
      handler({
        source: child,
        origin,
        data: { type: 'gosu-open-calendar-privacy', kind: 'arbitrary' },
      } as unknown as MessageEvent);
  expect(openPrivacy).toHaveBeenCalledExactlyOnceWith('calendar');
  const files = [new File(['fixture'], 'drop.txt')],
    requestId = '22222222-2222-4222-8222-222222222222';
  await act(async () => {
    for (const origin of ['https://evil.test', 'http://127.0.0.1:4318'])
      for (const handler of handlers)
        handler({
          source: child,
          origin,
          data: { type: 'gosu-briefing-file-drop', requestId, routineId: 'r', files },
        } as unknown as MessageEvent);
  });
  expect(reserveDroppedAttachments).toHaveBeenCalledExactlyOnceWith('r', files);
  expect(child.postMessage).toHaveBeenLastCalledWith(
    {
      type: 'gosu-briefing-file-drop-result',
      requestId,
      ticket: '11111111-1111-4111-8111-111111111111',
    },
    'http://127.0.0.1:4318',
  );
  await act(async () => {
    for (const handler of handlers)
      handler({
        source: child,
        origin: 'http://127.0.0.1:4318',
        data: {
          type: 'gosu-briefing-file-drop',
          requestId,
          routineId: 'r',
          files: [{ path: '/private/not-a-file' }],
        },
      } as unknown as MessageEvent);
  });
  expect(reserveDroppedAttachments).toHaveBeenCalledOnce();
});
it('rejects arbitrary locations and keeps parent CSP restricted to exact lab origins', () => {
  expect(validBriefingLocation({ url: 'https://example.com' })).toBe(false);
  const trusted = createTrustedRenderer({
    developmentUrl: undefined,
    isPackaged: true,
    productionEntryPath: '/tmp/index.html',
  });
  expect(
    rendererContentSecurityPolicy(trusted, 'http://127.0.0.1:1234', 'http://127.0.0.1:4318'),
  ).toContain('frame-src http://127.0.0.1:1234 http://127.0.0.1:4318');
  expect(() => rendererContentSecurityPolicy(trusted, undefined, 'http://evil.test')).toThrow();
});
