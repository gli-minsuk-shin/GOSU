import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROJECT_NAVIGATION_STATE,
  PROJECT_NAVIGATION_STORAGE_KEY,
  hideProjectLocally,
  loadProjectNavigationState,
  parseProjectNavigationState,
  pruneProjectNavigationState,
  saveProjectNavigationState,
  showAllProjectsLocally,
  showProjectLocally,
  toggleProjectFolder,
} from '../src/renderer/src/project-navigation-state';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set(PROJECT_NAVIGATION_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('local project navigation state', () => {
  it('falls back safely for missing, malformed, or unsupported values', () => {
    expect(loadProjectNavigationState(memoryStorage())).toEqual(DEFAULT_PROJECT_NAVIGATION_STATE);
    expect(loadProjectNavigationState(memoryStorage('{not-json'))).toEqual(
      DEFAULT_PROJECT_NAVIGATION_STATE,
    );
    expect(parseProjectNavigationState({ schemaVersion: 2 })).toEqual(
      DEFAULT_PROJECT_NAVIGATION_STATE,
    );
  });

  it('round-trips independent folder and group expansion state', () => {
    const storage = memoryStorage();
    const state = {
      schemaVersion: 1,
      expandedProjectIds: ['project-a', 'project-b'],
      hiddenProjectIds: ['project-c'],
      activeGroupExpanded: true,
      hiddenGroupExpanded: true,
      archivedGroupExpanded: true,
    } as const;

    expect(saveProjectNavigationState(storage, state)).toBe(true);
    expect(loadProjectNavigationState(storage)).toEqual(state);
  });

  it('deduplicates bounded IDs and supplies defaults for missing group flags', () => {
    expect(
      parseProjectNavigationState({
        schemaVersion: 1,
        expandedProjectIds: ['project-a', 'project-a', 3],
        hiddenProjectIds: ['project-b', 'project-b', null],
      }),
    ).toEqual({
      schemaVersion: 1,
      expandedProjectIds: ['project-a'],
      hiddenProjectIds: ['project-b'],
      activeGroupExpanded: true,
      hiddenGroupExpanded: false,
      archivedGroupExpanded: false,
    });
  });

  it('toggles multiple folders without collapsing the other open projects', () => {
    const first = toggleProjectFolder(DEFAULT_PROJECT_NAVIGATION_STATE, 'project-a');
    const second = toggleProjectFolder(first, 'project-b');
    const third = toggleProjectFolder(second, 'project-a');

    expect(first.expandedProjectIds).toEqual(['project-a']);
    expect(second.expandedProjectIds).toEqual(['project-a', 'project-b']);
    expect(third.expandedProjectIds).toEqual(['project-b']);
  });

  it('hides, restores, and reveals projects locally without affecting unrelated folders', () => {
    const state = {
      ...DEFAULT_PROJECT_NAVIGATION_STATE,
      expandedProjectIds: ['project-a', 'project-b'],
    };
    const hidden = hideProjectLocally(state, 'project-a');

    expect(hidden.expandedProjectIds).toEqual(['project-b']);
    expect(hidden.hiddenProjectIds).toEqual(['project-a']);
    expect(hidden.hiddenGroupExpanded).toBe(true);
    expect(showProjectLocally(hidden, 'project-a').hiddenProjectIds).toEqual([]);
    expect(showAllProjectsLocally(hidden)).toMatchObject({
      hiddenProjectIds: [],
      hiddenGroupExpanded: false,
    });
  });

  it('prunes navigation IDs that no longer belong to active projects', () => {
    const pruned = pruneProjectNavigationState(
      {
        ...DEFAULT_PROJECT_NAVIGATION_STATE,
        expandedProjectIds: ['active', 'archived'],
        hiddenProjectIds: ['active', 'trashed'],
      },
      new Set(['active']),
    );

    expect(pruned.expandedProjectIds).toEqual(['active']);
    expect(pruned.hiddenProjectIds).toEqual(['active']);
  });

  it('survives localStorage access failures', () => {
    const unavailable = {
      getItem: () => {
        throw new Error('unavailable');
      },
      setItem: () => {
        throw new Error('unavailable');
      },
    };

    expect(loadProjectNavigationState(unavailable)).toEqual(DEFAULT_PROJECT_NAVIGATION_STATE);
    expect(saveProjectNavigationState(unavailable, DEFAULT_PROJECT_NAVIGATION_STATE)).toBe(false);
  });
});
