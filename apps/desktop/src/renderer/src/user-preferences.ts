export const APPEARANCE_OPTIONS = ['system', 'dark', 'light'] as const;
export const TEXT_SIZE_OPTIONS = ['compact', 'default', 'large', 'extra-large'] as const;

export type AppearancePreference = (typeof APPEARANCE_OPTIONS)[number];
export type TextSizePreference = (typeof TEXT_SIZE_OPTIONS)[number];

export type UserPreferences = Readonly<{
  schemaVersion: 1;
  appearance: AppearancePreference;
  textSize: TextSizePreference;
}>;

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
type PreferenceRoot = Pick<HTMLElement, 'dataset'>;

export const USER_PREFERENCES_STORAGE_KEY = 'gosu:user-preferences:v1';
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  schemaVersion: 1,
  appearance: 'system',
  textSize: 'default',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseUserPreferences(value: unknown): UserPreferences {
  if (!isRecord(value) || value.schemaVersion !== 1) return DEFAULT_USER_PREFERENCES;
  const appearance = APPEARANCE_OPTIONS.find((option) => option === value.appearance);
  const textSize = TEXT_SIZE_OPTIONS.find((option) => option === value.textSize);
  if (!appearance || !textSize) return DEFAULT_USER_PREFERENCES;
  return { schemaVersion: 1, appearance, textSize };
}

export function loadUserPreferences(storage: PreferenceStorage): UserPreferences {
  try {
    const serialized = storage.getItem(USER_PREFERENCES_STORAGE_KEY);
    return serialized
      ? parseUserPreferences(JSON.parse(serialized) as unknown)
      : DEFAULT_USER_PREFERENCES;
  } catch {
    return DEFAULT_USER_PREFERENCES;
  }
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
