import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { shouldImportDesktopConfiguration } from './desktop-bootstrap';
import { BRIEFING_STORAGE_KEY, LEGACY_BRIEFING_STORAGE_KEY } from './state';
import { initialRealWorkspace } from './workspace-defaults';
it('imports only on first use without any saved current or legacy settings', () => {
  expect(shouldImportDesktopConfiguration({ getItem: () => null }, false, false)).toBe(true);
  expect(shouldImportDesktopConfiguration({ getItem: () => null }, true, false)).toBe(false);
});
it('preserves deliberately empty/default-looking saved settings across updates', () => {
  const raw = JSON.stringify(initialRealWorkspace('2026-09-11T00:00:00Z'));
  for (const key of [BRIEFING_STORAGE_KEY, LEGACY_BRIEFING_STORAGE_KEY]) {
    const storage = { getItem: (name: string) => (name === key ? raw : null) };
    expect(shouldImportDesktopConfiguration(storage, false, false)).toBe(false);
  }
});
it('never treats corrupt or inaccessible storage as a new user', () => {
  expect(shouldImportDesktopConfiguration({ getItem: () => 'broken' }, false, false)).toBe(false);
  expect(
    shouldImportDesktopConfiguration(
      {
        getItem: () => {
          throw Error('denied');
        },
      },
      false,
      false,
    ),
  ).toBe(false);
});
it('allows an explicit restore as an unsaved draft, not an automatic disk overwrite', () => {
  expect(shouldImportDesktopConfiguration({ getItem: () => 'saved' }, true, true)).toBe(true);
  const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
  expect(main).toContain('if (event.data.restore === true) setWorkspace(configuration)');
  expect(main).toContain('else change(configuration)');
  expect(readFileSync(new URL('./workspace.css', import.meta.url), 'utf8')).toContain(
    "[data-gosu-embedded='true'] .briefing-workspace > :nth-child(-n + 2)",
  );
});
