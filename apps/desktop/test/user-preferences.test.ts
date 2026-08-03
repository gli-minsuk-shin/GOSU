import { describe, expect, it } from 'vitest';

import {
  DEFAULT_USER_PREFERENCES,
  USER_PREFERENCES_STORAGE_KEY,
  applyUserPreferences,
  loadUserPreferences,
  parseUserPreferences,
  saveUserPreferences,
} from '../src/renderer/src/user-preferences';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set(USER_PREFERENCES_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('local user preferences', () => {
  it('falls back safely for missing, malformed, or unsupported settings', () => {
    expect(loadUserPreferences(memoryStorage())).toEqual(DEFAULT_USER_PREFERENCES);
    expect(loadUserPreferences(memoryStorage('{not-json'))).toEqual(DEFAULT_USER_PREFERENCES);
    expect(
      parseUserPreferences({ schemaVersion: 1, appearance: 'neon', textSize: 'huge' }),
    ).toEqual(DEFAULT_USER_PREFERENCES);
  });

  it('round-trips a valid appearance and text size without project storage', () => {
    const storage = memoryStorage();
    const preferences = { schemaVersion: 1, appearance: 'light', textSize: 'large' } as const;
    expect(saveUserPreferences(storage, preferences)).toBe(true);
    expect(loadUserPreferences(storage)).toEqual(preferences);
  });

  it('applies validated data attributes to the document root', () => {
    const root = { dataset: {} as DOMStringMap };
    applyUserPreferences(root, {
      schemaVersion: 1,
      appearance: 'dark',
      textSize: 'extra-large',
    });
    expect(root.dataset).toEqual({ appearance: 'dark', textSize: 'extra-large' });
  });

  it('survives storage access failures', () => {
    const unavailable = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
    };
    expect(loadUserPreferences(unavailable)).toEqual(DEFAULT_USER_PREFERENCES);
    expect(saveUserPreferences(unavailable, DEFAULT_USER_PREFERENCES)).toBe(false);
  });
});
