import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BriefingDesktopHost } from './briefing-desktop-host';
import { initialRealWorkspace } from './src/workspace-defaults';
const hosts: BriefingDesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
it('owns a single loopback host, serves only bounded static paths and never adopts another listener', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'briefing-host-'));
  dirs.push(dir);
  await writeFile(join(dir, 'index.html'), '<html>Fixture</html>');
  const service = {
    middleware: vi.fn(async (_req, _res, next) => next()),
    desktopConfiguration: vi.fn(async () => initialRealWorkspace('2026-09-11T00:00:00Z')),
    notificationSnapshot: vi.fn(async () => ({
      briefings: [],
      calendar: [],
      calendarState: 'disabled' as const,
      calendarLimited: false,
    })),
    startScheduling: vi.fn(),
    close: vi.fn(),
  };
  const factory = vi.fn(() => service);
  const consent = vi.fn(async () => undefined);
  const projectBridge = vi.fn(async () => ({ projects: [] }));
  const host = new BriefingDesktopHost(
    dir,
    0,
    factory,
    undefined,
    undefined,
    consent,
    projectBridge,
    undefined,
  );
  hosts.push(host);
  const [a, b] = await Promise.all([host.open(), host.open()]);
  expect(a.url).toBe(b.url);
  expect(factory).toHaveBeenCalledWith(
    undefined,
    undefined,
    undefined,
    undefined,
    consent,
    projectBridge,
    undefined,
  );
  expect(service.startScheduling).toHaveBeenCalledOnce();
  expect((await host.notifications()).calendarState).toBe('disabled');
  expect(service.notificationSnapshot).toHaveBeenCalledOnce();
  expect(await (await fetch(a.url)).text()).toContain('Fixture');
  expect((await fetch(a.url)).headers.get('content-security-policy')).toBe(
    'frame-ancestors file: http://127.0.0.1:* http://localhost:*',
  );
  expect((await fetch(host.origin + '/%2e%2e%2fpackage.json')).status).toBe(403);
  expect((await fetch(host.origin + '/no.json')).status).toBe(404);
  const other = new BriefingDesktopHost(dir, Number(new URL(host.origin).port), () => service);
  hosts.push(other);
  await expect(other.open()).rejects.toThrow();
  expect(service.startScheduling).toHaveBeenCalledOnce();
});
