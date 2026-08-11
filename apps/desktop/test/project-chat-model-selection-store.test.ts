import { describe, expect, it, vi } from 'vitest';

import {
  AUTO_PROJECT_CHAT_MODEL_SELECTION,
  PROJECT_CHAT_MODEL_SELECTION_MAX_MODEL_ID_LENGTH,
  PROJECT_CHAT_MODEL_SELECTION_MAX_SERIALIZED_LENGTH,
  clearProjectChatModelSelection,
  loadProjectChatModelSelection,
  parseStoredProjectChatModelSelection,
  projectChatModelSelectionStorageKey,
  saveProjectChatModelSelection,
} from '../src/renderer/src/project-chat-model-selection-store';

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const defaultSessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const secondSessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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

describe('Project Chat model selection store', () => {
  it('defaults to Auto when a project session has no saved selection', () => {
    const { storage } = memoryStorage();

    expect(loadProjectChatModelSelection(storage, projectId, defaultSessionId)).toBe(
      AUTO_PROJECT_CHAT_MODEL_SELECTION,
    );
    expect(loadProjectChatModelSelection(storage, '', defaultSessionId)).toBe(
      AUTO_PROJECT_CHAT_MODEL_SELECTION,
    );
    expect(loadProjectChatModelSelection(storage, '\ud800', defaultSessionId)).toBe(
      AUTO_PROJECT_CHAT_MODEL_SELECTION,
    );
  });

  it('persists selections independently by project and session', () => {
    const { storage } = memoryStorage();
    const hermesSelection = {
      providerId: 'hermes',
      modelId: 'hermes-configured-model',
      reasoningOptionId: null,
    } as const;
    const codexSelection = {
      providerId: 'codex',
      modelId: 'gpt-current',
      reasoningOptionId: 'high',
    } as const;

    expect(
      saveProjectChatModelSelection(storage, projectId, defaultSessionId, hermesSelection),
    ).toBe(true);
    expect(saveProjectChatModelSelection(storage, projectId, secondSessionId, codexSelection)).toBe(
      true,
    );

    expect(loadProjectChatModelSelection(storage, projectId, defaultSessionId)).toEqual(
      hermesSelection,
    );
    expect(loadProjectChatModelSelection(storage, projectId, secondSessionId)).toEqual(
      codexSelection,
    );
    expect(
      loadProjectChatModelSelection(
        storage,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        defaultSessionId,
      ),
    ).toBe(AUTO_PROJECT_CHAT_MODEL_SELECTION);
  });

  it('retains an explicit Hermes selection without consulting the live model catalog', () => {
    const { storage } = memoryStorage();
    const unavailableHermesSelection = {
      providerId: 'hermes',
      modelId: 'hermes-configured-model',
      reasoningOptionId: 'ultra',
    } as const;

    saveProjectChatModelSelection(storage, projectId, defaultSessionId, unavailableHermesSelection);

    expect(loadProjectChatModelSelection(storage, projectId, defaultSessionId)).toEqual(
      unavailableHermesSelection,
    );
  });

  it('removes the stored override when the user explicitly returns to Auto', () => {
    const { storage, values } = memoryStorage();
    saveProjectChatModelSelection(storage, projectId, defaultSessionId, {
      providerId: 'hermes',
      modelId: 'hermes-configured-model',
      reasoningOptionId: null,
    });
    const key = projectChatModelSelectionStorageKey(projectId, defaultSessionId)!;
    expect(values.has(key)).toBe(true);

    expect(
      saveProjectChatModelSelection(
        storage,
        projectId,
        defaultSessionId,
        AUTO_PROJECT_CHAT_MODEL_SELECTION,
      ),
    ).toBe(true);
    expect(values.has(key)).toBe(false);
    expect(loadProjectChatModelSelection(storage, projectId, defaultSessionId)).toBe(
      AUTO_PROJECT_CHAT_MODEL_SELECTION,
    );
  });

  it('fails closed on malformed, oversized, future-version, or incoherent records', () => {
    const { storage, values } = memoryStorage();
    const key = projectChatModelSelectionStorageKey(projectId, defaultSessionId)!;
    const invalidRecords = [
      '{',
      JSON.stringify({
        schemaVersion: 2,
        providerId: 'hermes',
        modelId: 'hermes-configured-model',
        reasoningOptionId: null,
      }),
      JSON.stringify({
        schemaVersion: 1,
        providerId: 'hermes',
        modelId: null,
        reasoningOptionId: null,
      }),
      JSON.stringify({
        schemaVersion: 1,
        providerId: 'hermes',
        modelId: 'hermes-configured-model',
        reasoningOptionId: null,
        unexpected: true,
      }),
      JSON.stringify({
        schemaVersion: 1,
        providerId: 'hermes',
        modelId: 'm'.repeat(PROJECT_CHAT_MODEL_SELECTION_MAX_MODEL_ID_LENGTH + 1),
        reasoningOptionId: null,
      }),
      'x'.repeat(PROJECT_CHAT_MODEL_SELECTION_MAX_SERIALIZED_LENGTH + 1),
    ];

    for (const serialized of invalidRecords) {
      values.set(key, serialized);
      expect(loadProjectChatModelSelection(storage, projectId, defaultSessionId)).toBe(
        AUTO_PROJECT_CHAT_MODEL_SELECTION,
      );
    }

    expect(
      parseStoredProjectChatModelSelection({
        schemaVersion: 1,
        providerId: ' hermes',
        modelId: 'hermes-configured-model',
        reasoningOptionId: null,
      }),
    ).toBeNull();
  });

  it('clears one session only and contains storage failures', () => {
    const { storage } = memoryStorage();
    const selection = {
      providerId: 'hermes',
      modelId: 'hermes-configured-model',
      reasoningOptionId: null,
    } as const;
    saveProjectChatModelSelection(storage, projectId, defaultSessionId, selection);
    saveProjectChatModelSelection(storage, projectId, secondSessionId, selection);

    expect(clearProjectChatModelSelection(storage, projectId, defaultSessionId)).toBe(true);
    expect(loadProjectChatModelSelection(storage, projectId, defaultSessionId)).toBe(
      AUTO_PROJECT_CHAT_MODEL_SELECTION,
    );
    expect(loadProjectChatModelSelection(storage, projectId, secondSessionId)).toEqual(selection);

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
    expect(loadProjectChatModelSelection(failingStorage, projectId, defaultSessionId)).toBe(
      AUTO_PROJECT_CHAT_MODEL_SELECTION,
    );
    expect(
      saveProjectChatModelSelection(failingStorage, projectId, defaultSessionId, selection),
    ).toBe(false);
    expect(clearProjectChatModelSelection(failingStorage, projectId, defaultSessionId)).toBe(false);
  });
});
