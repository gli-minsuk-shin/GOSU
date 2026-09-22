import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { GlobalBriefingView } from '../src/renderer/src/global-briefing-view';
import { BRIEFING_LAB_URL, validBriefingLocation } from '../src/shared/briefing-lab-contracts';
import { rendererContentSecurityPolicy, createTrustedRenderer } from '../src/main/renderer-trust';
let ui: ReactTestRenderer;
it('resets only the visible Briefing host offset on notification navigation without reloading the iframe', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = { scrollTop: 170, scrollLeft: 12 },
    child = { postMessage: vi.fn() };
  vi.stubGlobal('window', {
    gosu: { briefingLab: { open: async () => ({ url: BRIEFING_LAB_URL, configuration: {} }) } },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  await act(() => {
    ui = create(<GlobalBriefingView view="history" />, {
      createNodeMock: (e) =>
        e.type === 'iframe' ? { contentWindow: child, closest: () => host } : null,
    });
  });
  const frame = ui.root.findByType('iframe');
  expect(host.scrollTop).toBe(0);
  expect(host.scrollLeft).toBe(0);
  host.scrollTop = 90;
  await act(() => ui.update(<GlobalBriefingView view={null} />));
  expect(host.scrollTop).toBe(90);
  await act(() =>
    ui.update(
      <GlobalBriefingView
        view="history"
        navigationRevision={2}
        briefingTarget={{
          routineId: 'r',
          runId: '11111111-1111-4111-8111-111111111111',
          requestId: 2,
        }}
      />,
    ),
  );
  expect(host.scrollTop).toBe(0);
  expect(ui.root.findByType('iframe')).toBe(frame);
});
it('refreshes task data only for the owned embedded frame after a confirmed creation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const handlers = new Set<(event: MessageEvent) => void>(),
    child = { postMessage: vi.fn() },
    changed = vi.fn();
  vi.stubGlobal('window', {
    gosu: { briefingLab: { open: async () => ({ url: BRIEFING_LAB_URL, configuration: {} }) } },
    addEventListener: (_t: string, h: (event: MessageEvent) => void) => handlers.add(h),
    removeEventListener: (_t: string, h: (event: MessageEvent) => void) => handlers.delete(h),
  });
  await act(() => {
    ui = create(<GlobalBriefingView view="history" onWorkspaceChanged={changed} />, {
      createNodeMock: (e) => (e.type === 'iframe' ? { contentWindow: child } : null),
    });
  });
  const send = (source: unknown, origin: string) =>
    handlers.forEach((h) =>
      h({ source, origin, data: { type: 'gosu-briefing-todo-created' } } as MessageEvent),
    );
  send(child, 'https://foreign.test');
  send({}, new URL(BRIEFING_LAB_URL).origin);
  expect(changed).not.toHaveBeenCalled();
  send(child, new URL(BRIEFING_LAB_URL).origin);
  expect(changed).toHaveBeenCalledOnce();
});
it('turns a counted "run a new briefing" shortcut into the frame\'s run message and tells it the chord', async () => {
  // The chord is a setting (Settings → Shortcuts). The main process catches it and the app shell
  // counts it while the briefing feed shows; this view only relays it to the owned frame.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const handlers = new Map<string, Set<(event: never) => void>>(),
    child = { postMessage: vi.fn() };
  vi.stubGlobal('window', {
    gosu: {
      briefingLab: { open: async () => ({ url: BRIEFING_LAB_URL, configuration: {} }) },
      app: { getAppShortcuts: async () => ({ briefingRun: 'Control+Alt+R' }) },
    },
    addEventListener: (type: string, h: (event: never) => void) =>
      handlers.set(type, (handlers.get(type) ?? new Set()).add(h)),
    removeEventListener: (type: string, h: (event: never) => void) => handlers.get(type)?.delete(h),
  });
  const options = {
    createNodeMock: (e: { type: unknown }) =>
      e.type === 'iframe' ? { contentWindow: child } : null,
  };
  await act(() => {
    ui = create(<GlobalBriefingView view="history" />, options);
  });
  const runs = () =>
    child.postMessage.mock.calls.filter(([message]) => message.type === 'gosu-briefing-run-now');
  expect(runs()).toHaveLength(0);
  // The page itself no longer listens for a hardcoded ⇧⌘Enter.
  expect(handlers.get('keydown')?.size ?? 0).toBe(0);
  await act(() => ui.update(<GlobalBriefingView view="history" runRequest={1} />));
  expect(runs()).toEqual([[{ type: 'gosu-briefing-run-now' }, new URL(BRIEFING_LAB_URL).origin]]);
  await act(() => ui.update(<GlobalBriefingView view="history" runRequest={1} />));
  expect(runs()).toHaveLength(1);
  await act(() => ui.update(<GlobalBriefingView view="history" runRequest={2} />));
  expect(runs()).toHaveLength(2);
  // The frame shows the user's chord on its button.
  expect(
    child.postMessage.mock.calls.some(
      ([message]) =>
        message.type === 'gosu-briefing-navigation' && message.runShortcut === 'Ctrl + ⌥ + R',
    ),
  ).toBe(true);
});
it('opens Settings → Agent only when the owned Briefing frame asks for it', async () => {
  // Briefing has no model picker: its "AI model" links lead to the one place that decides.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const handlers = new Set<(event: MessageEvent) => void>(),
    child = { postMessage: vi.fn() },
    agent = vi.fn(),
    briefing = vi.fn();
  vi.stubGlobal('window', {
    gosu: { briefingLab: { open: async () => ({ url: BRIEFING_LAB_URL, configuration: {} }) } },
    addEventListener: (_t: string, h: (event: MessageEvent) => void) => handlers.add(h),
    removeEventListener: (_t: string, h: (event: MessageEvent) => void) => handlers.delete(h),
  });
  await act(() => {
    ui = create(
      <GlobalBriefingView view="settings" onSettings={briefing} onAgentSettings={agent} />,
      { createNodeMock: (e) => (e.type === 'iframe' ? { contentWindow: child } : null) },
    );
  });
  const send = (source: unknown, origin: string) =>
    handlers.forEach((h) =>
      h({ source, origin, data: { type: 'gosu-open-agent-settings' } } as MessageEvent),
    );
  send(child, 'https://foreign.test');
  send({}, new URL(BRIEFING_LAB_URL).origin);
  expect(agent).not.toHaveBeenCalled();
  send(child, new URL(BRIEFING_LAB_URL).origin);
  expect(agent).toHaveBeenCalledOnce();
  expect(briefing).not.toHaveBeenCalled();
});
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
