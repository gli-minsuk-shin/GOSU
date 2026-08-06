import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESEARCH_NOTES_LAYOUT_STATE,
  RESEARCH_NOTES_LAYOUT_STORAGE_KEY,
  loadResearchNotesLayoutState,
  parseResearchNotesLayoutState,
  saveResearchNotesLayoutState,
} from '../src/renderer/src/research-notes-layout-state';

describe('Research Notes layout state', () => {
  it('defaults open and persists an explicit folder tree collapse preference', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(loadResearchNotesLayoutState(storage)).toEqual(DEFAULT_RESEARCH_NOTES_LAYOUT_STATE);
    expect(
      saveResearchNotesLayoutState(storage, {
        schemaVersion: 1,
        folderTreeCollapsed: true,
      }),
    ).toBe(true);
    expect(values.has(RESEARCH_NOTES_LAYOUT_STORAGE_KEY)).toBe(true);
    expect(loadResearchNotesLayoutState(storage)).toEqual({
      schemaVersion: 1,
      folderTreeCollapsed: true,
    });
  });

  it('fails closed to an expanded tree for legacy, malformed, and unsafe values', () => {
    for (const value of [
      null,
      [],
      { schemaVersion: 0, folderTreeCollapsed: true },
      { schemaVersion: 1, folderTreeCollapsed: 'yes' },
    ]) {
      expect(parseResearchNotesLayoutState(value)).toEqual(DEFAULT_RESEARCH_NOTES_LAYOUT_STATE);
    }

    expect(
      loadResearchNotesLayoutState({
        getItem: () => '{bad json',
        setItem: () => undefined,
      }),
    ).toEqual(DEFAULT_RESEARCH_NOTES_LAYOUT_STATE);
    expect(
      loadResearchNotesLayoutState({
        getItem: () => {
          throw new Error('storage unavailable');
        },
        setItem: () => undefined,
      }),
    ).toEqual(DEFAULT_RESEARCH_NOTES_LAYOUT_STATE);
  });

  it('reports a failed save without surfacing a storage exception', () => {
    expect(
      saveResearchNotesLayoutState(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error('storage full');
          },
        },
        { schemaVersion: 1, folderTreeCollapsed: true },
      ),
    ).toBe(false);
  });
});
