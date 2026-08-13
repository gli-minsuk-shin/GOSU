import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_LECTURE_STUDIO_LAYOUT_STATE,
  loadLectureStudioLayoutState,
  parseLectureStudioLayoutState,
  saveLectureStudioLayoutState,
} from '../src/renderer/src/lecture-studio-layout-state';

describe('lecture studio layout state', () => {
  it('defaults malformed and future values without throwing', () => {
    expect(parseLectureStudioLayoutState(null)).toBe(DEFAULT_LECTURE_STUDIO_LAYOUT_STATE);
    expect(parseLectureStudioLayoutState({ schemaVersion: 2, chatCollapsed: true })).toBe(
      DEFAULT_LECTURE_STUDIO_LAYOUT_STATE,
    );
  });

  it('round trips independent session and assistant sidebar visibility', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    };
    expect(
      saveLectureStudioLayoutState(storage, {
        schemaVersion: 1,
        studioRailCollapsed: true,
        chatCollapsed: true,
      }),
    ).toBe(true);
    expect(loadLectureStudioLayoutState(storage)).toEqual({
      schemaVersion: 1,
      studioRailCollapsed: true,
      chatCollapsed: true,
    });
  });
});
