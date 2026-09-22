import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { desktopChatAutoSuggestions, isDesktopNavigation, isGosuEmbedded } from './desktop-bridge';
afterEach(() => vi.unstubAllGlobals());
it('keeps the embedded History chat in the full-height grid instead of the standalone overlay', () => {
  const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  const rule = css
    .split(
      "[data-gosu-embedded='true'] .briefing-workspace:not(.right-collapsed) .briefing-details {",
    )[1]!
    .split('}')[0]!;
  for (const declaration of [
    'position: relative',
    'inset: auto',
    'width: auto',
    'min-height: 0',
    'align-self: stretch',
    'box-shadow: none',
  ])
    expect(rule).toContain(declaration);
  expect(css).toContain(
    "[data-gosu-embedded='true'] .briefing-splitter.right {\n  visibility: visible;",
  );
});
it('keeps the global assistant in the first grid cell without narrow-screen overlay offsets', () => {
  const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  const rule = css
    .split("[data-gosu-embedded='true'][data-gosu-view='assistant'] .briefing-details {")[1]!
    .split('}')[0]!;
  expect(rule).toContain('grid-column: 1');
  expect(rule).toContain('position: relative');
  expect(rule).toContain('inset: auto');
});
it('accepts only a parent navigation in explicit embedded mode without write commands', () => {
  const parent = {};
  vi.stubGlobal('window', { location: { search: '?embedded=gosu' }, parent });
  const e = {
    source: parent,
    origin: 'null',
    data: { type: 'gosu-briefing-navigation', view: 'calendar' },
  } as unknown as MessageEvent;
  expect(isDesktopNavigation(e)).toBe(true);
  for (const view of ['history', 'papers', 'manage', 'settings', 'assistant'])
    expect(isDesktopNavigation({ ...e, data: { type: 'gosu-briefing-navigation', view } })).toBe(
      true,
    );
  expect(isDesktopNavigation({ ...e, source: {} } as MessageEvent)).toBe(false);
  expect(isDesktopNavigation({ ...e, origin: 'https://evil.test' })).toBe(false);
  expect(
    isDesktopNavigation({ ...e, data: { type: 'gosu-briefing-navigation', view: 'delete' } }),
  ).toBe(false);
  vi.stubGlobal('window', { location: { search: '' }, parent });
  expect(isGosuEmbedded()).toBe(false);
});

it('reads the suggested-questions setting only from a real navigation message', () => {
  const parent = {};
  vi.stubGlobal('window', { location: { search: '?embedded=gosu' }, parent });
  const navigation = (data: Record<string, unknown>) =>
    ({ source: parent, origin: 'null', data }) as unknown as MessageEvent;
  const base = { type: 'gosu-briefing-navigation', view: 'assistant' };

  expect(desktopChatAutoSuggestions(navigation({ ...base, chatAutoSuggestions: false }))).toBe(
    false,
  );
  expect(desktopChatAutoSuggestions(navigation({ ...base, chatAutoSuggestions: true }))).toBe(true);
  // An older shell sends no field, and a page must not change what it shows on a guess.
  expect(desktopChatAutoSuggestions(navigation(base))).toBe(null);
  expect(desktopChatAutoSuggestions(navigation({ ...base, chatAutoSuggestions: 'off' }))).toBe(
    null,
  );
  // Nothing outside the checked navigation message can turn them off.
  expect(
    desktopChatAutoSuggestions({
      source: {},
      origin: 'https://evil.test',
      data: { ...base, chatAutoSuggestions: false },
    } as unknown as MessageEvent),
  ).toBe(null);
});
