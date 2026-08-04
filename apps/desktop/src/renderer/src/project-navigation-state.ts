export type ProjectNavigationState = Readonly<{
  schemaVersion: 1;
  expandedProjectIds: readonly string[];
  hiddenProjectIds: readonly string[];
  activeGroupExpanded: boolean;
  hiddenGroupExpanded: boolean;
  archivedGroupExpanded: boolean;
  sidebarCollapsed: boolean;
}>;

type NavigationStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const PROJECT_NAVIGATION_STORAGE_KEY = 'gosu:project-navigation:v1';

export const DEFAULT_PROJECT_NAVIGATION_STATE: ProjectNavigationState = Object.freeze({
  schemaVersion: 1,
  expandedProjectIds: Object.freeze([]),
  hiddenProjectIds: Object.freeze([]),
  activeGroupExpanded: true,
  hiddenGroupExpanded: false,
  archivedGroupExpanded: false,
  sidebarCollapsed: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string'))].slice(
    0,
    500,
  );
}

export function parseProjectNavigationState(value: unknown): ProjectNavigationState {
  if (!isRecord(value) || value.schemaVersion !== 1) return defaultProjectNavigationState();
  return {
    schemaVersion: 1,
    expandedProjectIds: uniqueStrings(value.expandedProjectIds),
    hiddenProjectIds: uniqueStrings(value.hiddenProjectIds),
    activeGroupExpanded:
      typeof value.activeGroupExpanded === 'boolean' ? value.activeGroupExpanded : true,
    hiddenGroupExpanded:
      typeof value.hiddenGroupExpanded === 'boolean' ? value.hiddenGroupExpanded : false,
    archivedGroupExpanded:
      typeof value.archivedGroupExpanded === 'boolean' ? value.archivedGroupExpanded : false,
    sidebarCollapsed: typeof value.sidebarCollapsed === 'boolean' ? value.sidebarCollapsed : false,
  };
}

export function loadProjectNavigationState(storage: NavigationStorage): ProjectNavigationState {
  try {
    const serialized = storage.getItem(PROJECT_NAVIGATION_STORAGE_KEY);
    return serialized
      ? parseProjectNavigationState(JSON.parse(serialized) as unknown)
      : defaultProjectNavigationState();
  } catch {
    return defaultProjectNavigationState();
  }
}

export function saveProjectNavigationState(
  storage: NavigationStorage,
  state: ProjectNavigationState,
) {
  try {
    storage.setItem(
      PROJECT_NAVIGATION_STORAGE_KEY,
      JSON.stringify(parseProjectNavigationState(state)),
    );
    return true;
  } catch {
    return false;
  }
}

export function pruneProjectNavigationState(
  state: ProjectNavigationState,
  activeProjectIds: ReadonlySet<string>,
): ProjectNavigationState {
  const parsed = parseProjectNavigationState(state);
  return {
    ...parsed,
    expandedProjectIds: parsed.expandedProjectIds.filter((id) => activeProjectIds.has(id)),
    hiddenProjectIds: parsed.hiddenProjectIds.filter((id) => activeProjectIds.has(id)),
  };
}

export function toggleProjectFolder(
  state: ProjectNavigationState,
  projectId: string,
): ProjectNavigationState {
  const expanded = new Set(state.expandedProjectIds);
  if (expanded.has(projectId)) expanded.delete(projectId);
  else expanded.add(projectId);
  return { ...state, expandedProjectIds: [...expanded] };
}

export function hideProjectLocally(
  state: ProjectNavigationState,
  projectId: string,
): ProjectNavigationState {
  const hidden = new Set(state.hiddenProjectIds);
  hidden.add(projectId);
  return {
    ...state,
    expandedProjectIds: state.expandedProjectIds.filter((id) => id !== projectId),
    hiddenProjectIds: [...hidden],
    hiddenGroupExpanded: true,
  };
}

export function showProjectLocally(
  state: ProjectNavigationState,
  projectId: string,
): ProjectNavigationState {
  return {
    ...state,
    hiddenProjectIds: state.hiddenProjectIds.filter((id) => id !== projectId),
  };
}

export function showAllProjectsLocally(state: ProjectNavigationState): ProjectNavigationState {
  return { ...state, hiddenProjectIds: [], hiddenGroupExpanded: false };
}

export function toggleProjectSidebar(state: ProjectNavigationState): ProjectNavigationState {
  return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
}

function defaultProjectNavigationState(): ProjectNavigationState {
  return {
    ...DEFAULT_PROJECT_NAVIGATION_STATE,
    expandedProjectIds: [],
    hiddenProjectIds: [],
  };
}
