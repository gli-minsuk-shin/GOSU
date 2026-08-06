type LayoutStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const RESEARCH_NOTES_LAYOUT_STORAGE_KEY = 'gosu:research-notes-layout:v1';

export type ResearchNotesLayoutState = Readonly<{
  schemaVersion: 1;
  folderTreeCollapsed: boolean;
}>;

export const DEFAULT_RESEARCH_NOTES_LAYOUT_STATE: ResearchNotesLayoutState = Object.freeze({
  schemaVersion: 1,
  folderTreeCollapsed: false,
});

export function parseResearchNotesLayoutState(value: unknown): ResearchNotesLayoutState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_RESEARCH_NOTES_LAYOUT_STATE;
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) return DEFAULT_RESEARCH_NOTES_LAYOUT_STATE;
  return {
    schemaVersion: 1,
    folderTreeCollapsed: record.folderTreeCollapsed === true,
  };
}

export function loadResearchNotesLayoutState(storage: LayoutStorage): ResearchNotesLayoutState {
  try {
    const serialized = storage.getItem(RESEARCH_NOTES_LAYOUT_STORAGE_KEY);
    return serialized
      ? parseResearchNotesLayoutState(JSON.parse(serialized) as unknown)
      : DEFAULT_RESEARCH_NOTES_LAYOUT_STATE;
  } catch {
    return DEFAULT_RESEARCH_NOTES_LAYOUT_STATE;
  }
}

export function saveResearchNotesLayoutState(
  storage: LayoutStorage,
  state: ResearchNotesLayoutState,
) {
  try {
    storage.setItem(
      RESEARCH_NOTES_LAYOUT_STORAGE_KEY,
      JSON.stringify(parseResearchNotesLayoutState(state)),
    );
    return true;
  } catch {
    return false;
  }
}
