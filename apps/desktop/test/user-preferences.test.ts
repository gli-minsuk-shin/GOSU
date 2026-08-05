import { describe, expect, it } from 'vitest';

import { DEFAULT_WORKSPACE_BOARD_SETTINGS } from '../src/shared/workspace-contracts';
import {
  DEFAULT_USER_PREFERENCES,
  USER_PREFERENCES_STORAGE_KEY,
  applyUserPreferences,
  loadUserPreferences,
  parseUserPreferences,
  saveUserPreferences,
} from '../src/renderer/src/user-preferences';

const customBoardTemplate = {
  title: 'Experiment pipeline',
  columnLabels: {
    backlog: 'Ideas',
    planned: 'Queued',
    in_progress: 'Running',
    review: 'PI Review',
    done: 'Published',
  },
  columnOrder: ['backlog', 'planned', 'in_progress', 'review', 'done'],
  wipLimits: {
    backlog: null,
    planned: 8,
    in_progress: 3,
    review: 2,
    done: null,
  },
} as const;

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

  it('migrates legacy schema-v1 preferences to the full GOSU Board template', () => {
    expect(
      loadUserPreferences(
        memoryStorage(JSON.stringify({ schemaVersion: 1, appearance: 'light', textSize: 'large' })),
      ),
    ).toEqual({
      schemaVersion: 1,
      appearance: 'light',
      textSize: 'large',
      defaultBoardTemplate: DEFAULT_WORKSPACE_BOARD_SETTINGS,
      agentAddOns: { openclaw: 'disabled', hermes: 'disabled' },
    });
  });

  it('returns independent default Board template objects for separate loads', () => {
    const first = loadUserPreferences(memoryStorage());
    const second = loadUserPreferences(memoryStorage());

    expect(first.defaultBoardTemplate).toEqual(DEFAULT_WORKSPACE_BOARD_SETTINGS);
    expect(first.defaultBoardTemplate).not.toBe(second.defaultBoardTemplate);
    expect(first.defaultBoardTemplate.columnLabels).not.toBe(
      second.defaultBoardTemplate.columnLabels,
    );
  });

  it('round-trips a valid appearance, text size, and custom Board template locally', () => {
    const storage = memoryStorage();
    const preferences = {
      schemaVersion: 1,
      appearance: 'light',
      textSize: 'large',
      defaultBoardTemplate: customBoardTemplate,
      agentAddOns: { openclaw: 'detect-local', hermes: 'disabled' },
    } as const;
    expect(saveUserPreferences(storage, preferences)).toBe(true);
    expect(loadUserPreferences(storage)).toEqual(preferences);
  });

  it('falls back only the invalid Board template while preserving valid display settings', () => {
    const invalidBoardTemplate = {
      ...customBoardTemplate,
      columnLabels: {
        ...customBoardTemplate.columnLabels,
        planned: ' ideas ',
      },
    };

    expect(
      parseUserPreferences({
        schemaVersion: 1,
        appearance: 'dark',
        textSize: 'extra-large',
        defaultBoardTemplate: invalidBoardTemplate,
      }),
    ).toEqual({
      schemaVersion: 1,
      appearance: 'dark',
      textSize: 'extra-large',
      defaultBoardTemplate: DEFAULT_WORKSPACE_BOARD_SETTINGS,
      agentAddOns: { openclaw: 'disabled', hermes: 'disabled' },
    });
  });

  it('fails closed for unknown add-on preferences while preserving valid choices', () => {
    expect(
      parseUserPreferences({
        ...DEFAULT_USER_PREFERENCES,
        agentAddOns: { openclaw: 'connect-and-run', hermes: 'detect-local' },
      }).agentAddOns,
    ).toEqual({ openclaw: 'disabled', hermes: 'detect-local' });
  });

  it('applies validated data attributes to the document root', () => {
    const root = { dataset: {} as DOMStringMap };
    applyUserPreferences(root, {
      ...DEFAULT_USER_PREFERENCES,
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
