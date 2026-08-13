import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { desktopContentClassName } from '../src/renderer/src/desktop-content-layout';

describe('desktop content layout routing', () => {
  it('gives project document viewers the constrained scroll layout', () => {
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'notes', hasActiveProject: true }),
    ).toBe('desktop-content desktop-content-document desktop-content-notes');
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'repository', hasActiveProject: true }),
    ).toBe('desktop-content desktop-content-document');
  });

  it('preserves chat, ordinary workspace, settings, and empty-project layouts', () => {
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'chat', hasActiveProject: true }),
    ).toBe('desktop-content desktop-content-chat');
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'lecture', hasActiveProject: false }),
    ).toBe('desktop-content desktop-content-lecture');
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'search', hasActiveProject: true }),
    ).toBe('desktop-content desktop-content-compact desktop-content-search');
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'connections', hasActiveProject: true }),
    ).toBe('desktop-content desktop-content-compact desktop-content-connections');
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'literature', hasActiveProject: true }),
    ).toBe('desktop-content desktop-content-literature');
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'board', hasActiveProject: true }),
    ).toBe('desktop-content');
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'manuscript', hasActiveProject: true }),
    ).toBe('desktop-content');
    expect(
      desktopContentClassName({ surface: 'settings', tab: 'notes', hasActiveProject: true }),
    ).toBe('desktop-content desktop-content-compact desktop-content-settings');
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'notes', hasActiveProject: false }),
    ).toBe('desktop-content');
  });

  it('starts compact workspace surfaces directly below the titlebar', () => {
    const sharedStyles = readFileSync(
      new URL('../src/renderer/src/styles.css', import.meta.url),
      'utf8',
    );
    const lectureStyles = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.css', import.meta.url),
      'utf8',
    );

    expect(sharedStyles).toMatch(
      /\.desktop-content\.desktop-content-compact\s*\{[^}]*padding:\s*10px/u,
    );
    expect(lectureStyles).toMatch(
      /\.desktop-content\.desktop-content-lecture\s*\{[^}]*padding:\s*10px/u,
    );
  });
});
