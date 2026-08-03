import {
  DEFAULT_WORKSPACE_BOARD_SETTINGS,
  WorkspaceBoardSettingsSchema,
  resolveWorkspaceBoardSettings,
  type WorkspaceBoardSettings,
} from '../../shared/workspace-contracts';

export const APPEARANCE_OPTIONS = ['system', 'dark', 'light'] as const;
export const TEXT_SIZE_OPTIONS = ['compact', 'default', 'large', 'extra-large'] as const;

export type AppearancePreference = (typeof APPEARANCE_OPTIONS)[number];
export type TextSizePreference = (typeof TEXT_SIZE_OPTIONS)[number];

export type UserPreferences = Readonly<{
  schemaVersion: 1;
  appearance: AppearancePreference;
  textSize: TextSizePreference;
  defaultBoardTemplate: WorkspaceBoardSettings;
}>;

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
type PreferenceRoot = Pick<HTMLElement, 'dataset'>;

export const USER_PREFERENCES_STORAGE_KEY = 'gosu:user-preferences:v1';
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  schemaVersion: 1,
  appearance: 'system',
  textSize: 'default',
  defaultBoardTemplate: DEFAULT_WORKSPACE_BOARD_SETTINGS,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseUserPreferences(value: unknown): UserPreferences {
  if (!isRecord(value) || value.schemaVersion !== 1) return defaultUserPreferences();
  const appearance =
    APPEARANCE_OPTIONS.find((option) => option === value.appearance) ??
    DEFAULT_USER_PREFERENCES.appearance;
  const textSize =
    TEXT_SIZE_OPTIONS.find((option) => option === value.textSize) ??
    DEFAULT_USER_PREFERENCES.textSize;
  const template = WorkspaceBoardSettingsSchema.safeParse(value.defaultBoardTemplate);
  return {
    schemaVersion: 1,
    appearance,
    textSize,
    defaultBoardTemplate: template.success
      ? template.data
      : resolveWorkspaceBoardSettings(undefined),
  };
}

export function loadUserPreferences(storage: PreferenceStorage): UserPreferences {
  try {
    const serialized = storage.getItem(USER_PREFERENCES_STORAGE_KEY);
    return serialized
      ? parseUserPreferences(JSON.parse(serialized) as unknown)
      : defaultUserPreferences();
  } catch {
    return defaultUserPreferences();
  }
}

function defaultUserPreferences(): UserPreferences {
  return {
    ...DEFAULT_USER_PREFERENCES,
    defaultBoardTemplate: resolveWorkspaceBoardSettings(undefined),
  };
}

export function saveUserPreferences(
  storage: PreferenceStorage,
  preferences: UserPreferences,
): boolean {
  try {
    storage.setItem(
      USER_PREFERENCES_STORAGE_KEY,
      JSON.stringify(parseUserPreferences(preferences)),
    );
    return true;
  } catch {
    return false;
  }
}

export function applyUserPreferences(root: PreferenceRoot, preferences: UserPreferences) {
  const validated = parseUserPreferences(preferences);
  root.dataset.appearance = validated.appearance;
  root.dataset.textSize = validated.textSize;
}
