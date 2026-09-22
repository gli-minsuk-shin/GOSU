import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createBriefingHostConsent } from '../src/main/briefing-host-consent';
it('foregrounds and attaches private-data approval to GOSU instead of an orphaned timed-out script dialog', async () => {
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
  const show = vi.fn(async () => ({ response: 1 }));
  const controller = new AbortController();
  await createBriefingHostConsent(() => window as unknown as BrowserWindow, show)(
    'Selected mailbox scope',
    controller.signal,
  );
  expect(window.restore).toHaveBeenCalledOnce();
  expect(window.show).toHaveBeenCalledOnce();
  expect(window.focus).toHaveBeenCalledOnce();
  expect(show).toHaveBeenCalledWith(
    window,
    expect.objectContaining({
      defaultId: 0,
      cancelId: 0,
      signal: controller.signal,
      detail: 'Selected mailbox scope',
      buttons: ['취소', '이 요청 허용'],
    }),
  );
});
it('never accepts cancellation, missing window, or a response arriving after abort', async () => {
  const window = {
    isDestroyed: () => false,
    isMinimized: () => false,
    show: vi.fn(),
    focus: vi.fn(),
  } as unknown as BrowserWindow;
  const c = new AbortController();
  const denied = createBriefingHostConsent(
    () => window,
    async () => ({ response: 0 }),
  );
  await expect(denied('scope', c.signal)).rejects.toThrow('consent_denied');
  await expect(
    createBriefingHostConsent(() => undefined, vi.fn())('scope', c.signal),
  ).rejects.toThrow('consent_unavailable');
  const late = createBriefingHostConsent(
    () => window,
    async () => {
      c.abort();
      return { response: 1 };
    },
  );
  await expect(late('scope', c.signal)).rejects.toThrow('source_cancelled');
});
it('declares macOS Mail automation and Calendar access reasons in the packaged host', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.build.mac.extendInfo.NSAppleEventsUsageDescription).toContain('Apple Mail');
  expect(pkg.build.mac.extendInfo.NSCalendarsFullAccessUsageDescription).toContain('캘린더');
  // macOS attributes the bundled bridge's Reminders request to this host app, so the prompt only
  // appears when the host itself declares a reason; without it Reminders silently stays denied.
  expect(pkg.build.mac.extendInfo.NSRemindersFullAccessUsageDescription).toContain('미리 알림');
  expect(pkg.build.mac.extendInfo.NSRemindersUsageDescription).toContain('미리 알림');
  expect(
    readFileSync(new URL('../build/entitlements.mac.plist', import.meta.url), 'utf8'),
  ).toContain('com.apple.security.automation.apple-events');
});
it('routes Briefing settings through GOSU settings while retaining the shared frame', () => {
  const app = readFileSync(new URL('../src/renderer/src/desktop-app.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(
    new URL('../src/renderer/src/settings-view.tsx', import.meta.url),
    'utf8',
  );
  expect(app).toContain('desktop-content-briefing-settings');
  expect(settings).toContain("selectCategory('briefing')");
});
