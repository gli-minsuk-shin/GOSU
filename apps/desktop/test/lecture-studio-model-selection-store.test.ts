import { describe, expect, it, vi } from 'vitest';

import {
  AUTO_LECTURE_STUDIO_MODEL_SELECTION,
  LECTURE_STUDIO_MODEL_SELECTION_MAX_MODEL_ID_LENGTH,
  LECTURE_STUDIO_MODEL_SELECTION_MAX_SERIALIZED_LENGTH,
  clearLectureStudioModelSelection,
  lectureStudioModelSelectionStorageKey,
  loadLectureStudioModelSelection,
  parseStoredLectureStudioModelSelection,
  resolveLectureStudioModelSelection,
  saveLectureStudioModelSelection,
  selectLectureStudioModel,
  selectLectureStudioReasoning,
} from '../src/renderer/src/lecture-studio-model-selection-store';

const firstStudioId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondStudioId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  };
}

describe('Lecture Studio model selection store', () => {
  it('defaults independently to provider Auto for every Studio', () => {
    const { storage } = memoryStorage();

    expect(loadLectureStudioModelSelection(storage, firstStudioId)).toBe(
      AUTO_LECTURE_STUDIO_MODEL_SELECTION,
    );
    expect(loadLectureStudioModelSelection(storage, secondStudioId)).toBe(
      AUTO_LECTURE_STUDIO_MODEL_SELECTION,
    );
    expect(loadLectureStudioModelSelection(storage, '')).toBe(AUTO_LECTURE_STUDIO_MODEL_SELECTION);
    expect(loadLectureStudioModelSelection(storage, '\ud800')).toBe(
      AUTO_LECTURE_STUDIO_MODEL_SELECTION,
    );
  });

  it('persists opaque model and reasoning IDs per Studio without a model-name enum', () => {
    const { storage } = memoryStorage();
    const first = { modelId: 'future-model-id', reasoningOptionId: 'ultra-native' } as const;
    const second = { modelId: 'another-provider-model', reasoningOptionId: null } as const;

    expect(saveLectureStudioModelSelection(storage, firstStudioId, first)).toBe(true);
    expect(saveLectureStudioModelSelection(storage, secondStudioId, second)).toBe(true);

    expect(loadLectureStudioModelSelection(storage, firstStudioId)).toEqual(first);
    expect(loadLectureStudioModelSelection(storage, secondStudioId)).toEqual(second);
  });

  it('resets reasoning only when the selected model actually changes', () => {
    const current = { modelId: 'model-a', reasoningOptionId: 'high' } as const;

    expect(selectLectureStudioModel(current, 'model-a')).toBe(current);
    expect(selectLectureStudioModel(current, 'model-b')).toEqual({
      modelId: 'model-b',
      reasoningOptionId: null,
    });
    expect(selectLectureStudioModel(current, null)).toEqual(AUTO_LECTURE_STUDIO_MODEL_SELECTION);
    expect(selectLectureStudioReasoning(current, 'new-provider-effort')).toEqual({
      modelId: 'model-a',
      reasoningOptionId: 'new-provider-effort',
    });
  });

  it('removes the stored override when the user returns to Auto', () => {
    const { storage, values } = memoryStorage();
    saveLectureStudioModelSelection(storage, firstStudioId, {
      modelId: 'model-a',
      reasoningOptionId: 'high',
    });
    const key = lectureStudioModelSelectionStorageKey(firstStudioId)!;
    expect(values.has(key)).toBe(true);

    expect(
      saveLectureStudioModelSelection(storage, firstStudioId, AUTO_LECTURE_STUDIO_MODEL_SELECTION),
    ).toBe(true);
    expect(values.has(key)).toBe(false);
  });

  it('fails closed on malformed, oversized, future-version, or unexpected records', () => {
    const { storage, values } = memoryStorage();
    const key = lectureStudioModelSelectionStorageKey(firstStudioId)!;
    const invalidRecords = [
      '{',
      JSON.stringify({ schemaVersion: 2, modelId: 'model-a', reasoningOptionId: null }),
      JSON.stringify({
        schemaVersion: 1,
        modelId: 'model-a',
        reasoningOptionId: null,
        unexpected: true,
      }),
      JSON.stringify({
        schemaVersion: 1,
        modelId: 'm'.repeat(LECTURE_STUDIO_MODEL_SELECTION_MAX_MODEL_ID_LENGTH + 1),
        reasoningOptionId: null,
      }),
      'x'.repeat(LECTURE_STUDIO_MODEL_SELECTION_MAX_SERIALIZED_LENGTH + 1),
    ];

    for (const serialized of invalidRecords) {
      values.set(key, serialized);
      expect(loadLectureStudioModelSelection(storage, firstStudioId)).toBe(
        AUTO_LECTURE_STUDIO_MODEL_SELECTION,
      );
    }

    expect(
      parseStoredLectureStudioModelSelection({
        schemaVersion: 1,
        modelId: ' model-a',
        reasoningOptionId: null,
      }),
    ).toBeNull();
  });

  it('keeps an unavailable explicit choice visible and validates it without fallback', () => {
    const models = [
      {
        modelId: 'provider-default',
        isDefault: true,
        reasoningOptions: [{ id: 'medium' }, { id: 'high' }],
      },
    ];

    expect(resolveLectureStudioModelSelection(AUTO_LECTURE_STUDIO_MODEL_SELECTION, models)).toEqual(
      { effectiveModelId: 'provider-default', issue: null },
    );
    expect(
      resolveLectureStudioModelSelection(
        { modelId: 'removed-model', reasoningOptionId: null },
        models,
      ),
    ).toEqual({ effectiveModelId: null, issue: 'model_unavailable' });
    expect(
      resolveLectureStudioModelSelection(
        { modelId: 'provider-default', reasoningOptionId: 'ultra' },
        models,
      ),
    ).toEqual({ effectiveModelId: 'provider-default', issue: 'reasoning_unavailable' });
  });

  it('fails closed when Auto has no unique provider default', () => {
    const duplicateDefaults = [
      { modelId: 'model-a', isDefault: true, reasoningOptions: [] },
      { modelId: 'model-b', isDefault: true, reasoningOptions: [] },
    ];

    expect(
      resolveLectureStudioModelSelection(AUTO_LECTURE_STUDIO_MODEL_SELECTION, duplicateDefaults),
    ).toEqual({ effectiveModelId: null, issue: 'model_unavailable' });
    expect(resolveLectureStudioModelSelection(AUTO_LECTURE_STUDIO_MODEL_SELECTION, [])).toEqual({
      effectiveModelId: null,
      issue: 'model_unavailable',
    });
  });

  it('clears one Studio only and contains blocked-storage failures', () => {
    const { storage } = memoryStorage();
    const selection = { modelId: 'model-a', reasoningOptionId: 'high' } as const;
    saveLectureStudioModelSelection(storage, firstStudioId, selection);
    saveLectureStudioModelSelection(storage, secondStudioId, selection);

    expect(clearLectureStudioModelSelection(storage, firstStudioId)).toBe(true);
    expect(loadLectureStudioModelSelection(storage, firstStudioId)).toBe(
      AUTO_LECTURE_STUDIO_MODEL_SELECTION,
    );
    expect(loadLectureStudioModelSelection(storage, secondStudioId)).toEqual(selection);

    const failingStorage = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      removeItem: vi.fn(() => {
        throw new Error('blocked');
      }),
    };
    expect(loadLectureStudioModelSelection(failingStorage, firstStudioId)).toBe(
      AUTO_LECTURE_STUDIO_MODEL_SELECTION,
    );
    expect(saveLectureStudioModelSelection(failingStorage, firstStudioId, selection)).toBe(false);
    expect(clearLectureStudioModelSelection(failingStorage, firstStudioId)).toBe(false);
  });
});
