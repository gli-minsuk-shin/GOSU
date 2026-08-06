import { describe, expect, it } from 'vitest';

import { desktopContentClassName } from '../src/renderer/src/desktop-content-layout';

describe('desktop content layout routing', () => {
  it('gives project document viewers the constrained scroll layout', () => {
    for (const tab of ['notes', 'repository'] as const) {
      expect(desktopContentClassName({ surface: 'workspace', tab, hasActiveProject: true })).toBe(
        'desktop-content desktop-content-document',
      );
    }
  });

  it('preserves chat, ordinary workspace, settings, and empty-project layouts', () => {
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'chat', hasActiveProject: true }),
    ).toBe('desktop-content desktop-content-chat');
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'board', hasActiveProject: true }),
    ).toBe('desktop-content');
    expect(
      desktopContentClassName({ surface: 'settings', tab: 'notes', hasActiveProject: true }),
    ).toBe('desktop-content');
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'notes', hasActiveProject: false }),
    ).toBe('desktop-content');
  });
});
