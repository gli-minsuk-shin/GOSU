import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE,
  type LectureStudioStructureTemplate,
} from '../src/shared/lecture-studio-contracts';
import { DEFAULT_WORKSPACE_BOARD_SETTINGS } from '../src/shared/workspace-contracts';
import {
  DEFAULT_AI_SELECTION,
  DEFAULT_USER_PREFERENCES,
  USER_PREFERENCES_STORAGE_KEY,
  applyUserPreferences,
  loadUserPreferences,
  parseDefaultAiSelection,
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

const customLectureStructure: LectureStudioStructureTemplate = {
  mode: 'custom',
  sections: [
    { title: 'Overview and learning goals', coverage: 'notes-and-slides' },
    { title: 'Technical details', coverage: 'notes-only' },
    { title: 'Summary', coverage: 'notes-and-slides' },
  ],
};

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
      sshResourceRefreshInterval: '1m',
      defaultBoardTemplate: DEFAULT_WORKSPACE_BOARD_SETTINGS,
      defaultLectureStructure: DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE,
      defaultAiSelection: DEFAULT_AI_SELECTION,
      agentAddOns: { openclaw: 'disabled', hermes: 'disabled' },
    });
  });

  it('migrates a missing legacy Lecture structure to adaptive without disturbing other preferences', () => {
    expect(
      parseUserPreferences({
        schemaVersion: 1,
        appearance: 'dark',
        textSize: 'large',
        sshResourceRefreshInterval: '5m',
        defaultBoardTemplate: customBoardTemplate,
        defaultAiSelection: { modelId: 'gpt-current', reasoningOptionId: 'ultra' },
        agentAddOns: { openclaw: 'detect-local', hermes: 'connect-local' },
      }),
    ).toEqual({
      schemaVersion: 1,
      appearance: 'dark',
      textSize: 'large',
      sshResourceRefreshInterval: '5m',
      defaultBoardTemplate: customBoardTemplate,
      defaultLectureStructure: { mode: 'adaptive' },
      defaultAiSelection: { modelId: 'gpt-current', reasoningOptionId: 'ultra' },
      agentAddOns: { openclaw: 'detect-local', hermes: 'connect-local' },
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
      sshResourceRefreshInterval: '5m',
      defaultBoardTemplate: customBoardTemplate,
      defaultLectureStructure: customLectureStructure,
      defaultAiSelection: { modelId: 'gpt-current', reasoningOptionId: 'ultra' },
      agentAddOns: { openclaw: 'detect-local', hermes: 'connect-local' },
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
      sshResourceRefreshInterval: '1m',
      defaultBoardTemplate: DEFAULT_WORKSPACE_BOARD_SETTINGS,
      defaultLectureStructure: DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE,
      defaultAiSelection: DEFAULT_AI_SELECTION,
      agentAddOns: { openclaw: 'disabled', hermes: 'disabled' },
    });
  });

  it('normalizes and returns deep-independent custom Lecture structure copies', () => {
    const stored = {
      ...DEFAULT_USER_PREFERENCES,
      defaultLectureStructure: {
        mode: 'custom',
        sections: [
          { title: '  Cafe\u0301 foundations  ', coverage: 'notes-and-slides' },
          { title: 'Details', coverage: 'notes-only' },
        ],
      },
    } as const;

    const storage = memoryStorage(JSON.stringify(stored));
    const first = loadUserPreferences(storage);
    const second = loadUserPreferences(storage);

    expect(first.defaultLectureStructure).toEqual({
      mode: 'custom',
      sections: [
        { title: 'Café foundations', coverage: 'notes-and-slides' },
        { title: 'Details', coverage: 'notes-only' },
      ],
    });
    expect(first.defaultLectureStructure).not.toBe(stored.defaultLectureStructure);
    expect(first.defaultLectureStructure).not.toBe(second.defaultLectureStructure);
    if (
      first.defaultLectureStructure.mode === 'custom' &&
      second.defaultLectureStructure.mode === 'custom'
    ) {
      expect(first.defaultLectureStructure.sections).not.toBe(
        second.defaultLectureStructure.sections,
      );
      expect(first.defaultLectureStructure.sections[0]).not.toBe(
        second.defaultLectureStructure.sections[0],
      );
    }
  });

  it('falls back only the malformed Lecture structure while preserving other valid settings', () => {
    const parsed = parseUserPreferences({
      schemaVersion: 1,
      appearance: 'dark',
      textSize: 'extra-large',
      sshResourceRefreshInterval: 'manual',
      defaultBoardTemplate: customBoardTemplate,
      defaultLectureStructure: {
        mode: 'custom',
        sections: [{ title: 'Private appendix', coverage: 'notes-only' }],
      },
      defaultAiSelection: { modelId: 'gpt-current', reasoningOptionId: 'high' },
      agentAddOns: { openclaw: 'detect-local', hermes: 'detect-local' },
    });

    expect(parsed).toEqual({
      schemaVersion: 1,
      appearance: 'dark',
      textSize: 'extra-large',
      sshResourceRefreshInterval: 'manual',
      defaultBoardTemplate: customBoardTemplate,
      defaultLectureStructure: { mode: 'adaptive' },
      defaultAiSelection: { modelId: 'gpt-current', reasoningOptionId: 'high' },
      agentAddOns: { openclaw: 'detect-local', hermes: 'detect-local' },
    });
  });

  it('saves and loads a validated custom Lecture structure', () => {
    const storage = memoryStorage();
    const preferences = {
      ...DEFAULT_USER_PREFERENCES,
      defaultLectureStructure: customLectureStructure,
    } as const;

    expect(saveUserPreferences(storage, preferences)).toBe(true);
    const loaded = loadUserPreferences(storage);
    expect(loaded.defaultLectureStructure).toEqual(customLectureStructure);
    expect(loaded.defaultLectureStructure).not.toBe(preferences.defaultLectureStructure);
  });

  it('fails closed for hidden, unknown, reserved, and TeX-like Lecture structure input', () => {
    const invalidStructures = [
      {
        mode: 'custom',
        sections: [{ title: 'Overview\u202e hidden', coverage: 'notes-and-slides' }],
      },
      { mode: 'adaptive', hiddenOverride: true },
      {
        mode: 'custom',
        sections: [{ title: 'Sources used', coverage: 'notes-and-slides' }],
      },
      {
        mode: 'custom',
        sections: [{ title: '\\input{private.tex}', coverage: 'notes-and-slides' }],
      },
    ];

    for (const defaultLectureStructure of invalidStructures) {
      const parsed = parseUserPreferences({
        ...DEFAULT_USER_PREFERENCES,
        defaultLectureStructure,
      });
      expect(parsed.defaultLectureStructure).toEqual({ mode: 'adaptive' });
    }
  });

  it('fails closed for unknown add-on preferences while preserving valid choices', () => {
    expect(
      parseUserPreferences({
        ...DEFAULT_USER_PREFERENCES,
        agentAddOns: { openclaw: 'connect-and-run', hermes: 'detect-local' },
      }).agentAddOns,
    ).toEqual({ openclaw: 'disabled', hermes: 'detect-local' });
  });

  it('rejects connection mode for an add-on that is detection-only', () => {
    expect(
      parseUserPreferences({
        ...DEFAULT_USER_PREFERENCES,
        agentAddOns: { openclaw: 'connect-local', hermes: 'connect-local' },
      }).agentAddOns,
    ).toEqual({ openclaw: 'disabled', hermes: 'connect-local' });
  });

  it('falls back to one-minute server monitoring for an unknown refresh interval', () => {
    expect(
      parseUserPreferences({
        ...DEFAULT_USER_PREFERENCES,
        sshResourceRefreshInterval: 'continuous',
      }).sshResourceRefreshInterval,
    ).toBe('1m');
  });

  it('defaults new AI work to provider Auto with high reasoning and round-trips opaque IDs', () => {
    expect(DEFAULT_USER_PREFERENCES.defaultAiSelection).toEqual({
      modelId: null,
      reasoningOptionId: 'high',
    });
    expect(
      parseDefaultAiSelection({ modelId: 'future-model', reasoningOptionId: 'future-effort' }),
    ).toEqual({ modelId: 'future-model', reasoningOptionId: 'future-effort' });
    expect(parseDefaultAiSelection({ modelId: null, reasoningOptionId: null })).toEqual({
      modelId: null,
      reasoningOptionId: null,
    });
  });

  it('fails closed to the safe high default for malformed AI Settings records', () => {
    const invalidSelections = [
      null,
      { modelId: ' model-a', reasoningOptionId: 'high' },
      { modelId: 'model-a', reasoningOptionId: 'high', unexpected: true },
      { modelId: 'model-a', reasoningOptionId: 'hi\u0000gh' },
    ];

    for (const selection of invalidSelections) {
      expect(parseDefaultAiSelection(selection)).toEqual(DEFAULT_AI_SELECTION);
    }
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
