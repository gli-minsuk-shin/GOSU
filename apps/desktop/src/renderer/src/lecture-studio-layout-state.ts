type LayoutStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const LECTURE_STUDIO_LAYOUT_STORAGE_KEY = 'gosu:lecture-studio-layout:v1';

export type LectureStudioLayoutState = Readonly<{
  schemaVersion: 1;
  studioRailCollapsed: boolean;
  chatCollapsed: boolean;
}>;

export const DEFAULT_LECTURE_STUDIO_LAYOUT_STATE: LectureStudioLayoutState = Object.freeze({
  schemaVersion: 1,
  studioRailCollapsed: false,
  chatCollapsed: false,
});

export function parseLectureStudioLayoutState(value: unknown): LectureStudioLayoutState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_LECTURE_STUDIO_LAYOUT_STATE;
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) return DEFAULT_LECTURE_STUDIO_LAYOUT_STATE;
  return {
    schemaVersion: 1,
    studioRailCollapsed: record.studioRailCollapsed === true,
    chatCollapsed: record.chatCollapsed === true,
  };
}

export function loadLectureStudioLayoutState(storage: Pick<LayoutStorage, 'getItem'>) {
  try {
    const serialized = storage.getItem(LECTURE_STUDIO_LAYOUT_STORAGE_KEY);
    return serialized
      ? parseLectureStudioLayoutState(JSON.parse(serialized) as unknown)
      : DEFAULT_LECTURE_STUDIO_LAYOUT_STATE;
  } catch {
    return DEFAULT_LECTURE_STUDIO_LAYOUT_STATE;
  }
}

export function saveLectureStudioLayoutState(
  storage: Pick<LayoutStorage, 'setItem'>,
  state: LectureStudioLayoutState,
) {
  try {
    storage.setItem(
      LECTURE_STUDIO_LAYOUT_STORAGE_KEY,
      JSON.stringify(parseLectureStudioLayoutState(state)),
    );
    return true;
  } catch {
    return false;
  }
}
