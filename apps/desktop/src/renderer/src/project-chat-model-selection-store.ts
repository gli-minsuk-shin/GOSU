import type { ProjectChatModelSelection } from './project-chat-provider-selection';

type ModelSelectionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const PROJECT_CHAT_MODEL_SELECTION_STORAGE_PREFIX = 'gosu:project-chat-model-selection:v1:';
export const PROJECT_CHAT_MODEL_SELECTION_SCHEMA_VERSION = 1;
export const PROJECT_CHAT_MODEL_SELECTION_MAX_SCOPE_ID_LENGTH = 128;
export const PROJECT_CHAT_MODEL_SELECTION_MAX_PROVIDER_ID_LENGTH = 128;
export const PROJECT_CHAT_MODEL_SELECTION_MAX_MODEL_ID_LENGTH = 256;
export const PROJECT_CHAT_MODEL_SELECTION_MAX_REASONING_ID_LENGTH = 128;
export const PROJECT_CHAT_MODEL_SELECTION_MAX_SERIALIZED_LENGTH = 1_024;

export const AUTO_PROJECT_CHAT_MODEL_SELECTION: ProjectChatModelSelection = Object.freeze({
  providerId: null,
  modelId: null,
  reasoningOptionId: null,
});

type StoredProjectChatModelSelectionV1 = Readonly<{
  schemaVersion: 1;
  providerId: string | null;
  modelId: string | null;
  reasoningOptionId: string | null;
}>;

const STORED_SELECTION_KEYS = [
  'modelId',
  'providerId',
  'reasoningOptionId',
  'schemaVersion',
] as const;

function boundedOpaqueId(value: unknown, maximumLength: number): string | null | undefined {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    return undefined;
  }
  return value;
}

function validScopeId(value: string) {
  return (
    typeof boundedOpaqueId(value, PROJECT_CHAT_MODEL_SELECTION_MAX_SCOPE_ID_LENGTH) === 'string'
  );
}

export function projectChatModelSelectionStorageKey(projectId: string, sessionId: string) {
  if (!validScopeId(projectId) || !validScopeId(sessionId)) return null;
  try {
    return `${PROJECT_CHAT_MODEL_SELECTION_STORAGE_PREFIX}${encodeURIComponent(projectId)}:${encodeURIComponent(sessionId)}`;
  } catch {
    return null;
  }
}

export function parseStoredProjectChatModelSelection(
  value: unknown,
): ProjectChatModelSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== PROJECT_CHAT_MODEL_SELECTION_SCHEMA_VERSION ||
    Object.keys(record).sort().join(',') !== [...STORED_SELECTION_KEYS].sort().join(',')
  ) {
    return null;
  }

  const providerId = boundedOpaqueId(
    record.providerId,
    PROJECT_CHAT_MODEL_SELECTION_MAX_PROVIDER_ID_LENGTH,
  );
  const modelId = boundedOpaqueId(record.modelId, PROJECT_CHAT_MODEL_SELECTION_MAX_MODEL_ID_LENGTH);
  const reasoningOptionId = boundedOpaqueId(
    record.reasoningOptionId,
    PROJECT_CHAT_MODEL_SELECTION_MAX_REASONING_ID_LENGTH,
  );
  if (providerId === undefined || modelId === undefined || reasoningOptionId === undefined) {
    return null;
  }
  if ((providerId === null) !== (modelId === null)) return null;

  return { providerId, modelId, reasoningOptionId };
}

export function loadProjectChatModelSelection(
  storage: Pick<ModelSelectionStorage, 'getItem'>,
  projectId: string,
  sessionId: string,
): ProjectChatModelSelection {
  const key = projectChatModelSelectionStorageKey(projectId, sessionId);
  if (!key) return AUTO_PROJECT_CHAT_MODEL_SELECTION;
  try {
    const serialized = storage.getItem(key);
    if (!serialized || serialized.length > PROJECT_CHAT_MODEL_SELECTION_MAX_SERIALIZED_LENGTH) {
      return AUTO_PROJECT_CHAT_MODEL_SELECTION;
    }
    return (
      parseStoredProjectChatModelSelection(JSON.parse(serialized) as unknown) ??
      AUTO_PROJECT_CHAT_MODEL_SELECTION
    );
  } catch {
    return AUTO_PROJECT_CHAT_MODEL_SELECTION;
  }
}

export function saveProjectChatModelSelection(
  storage: Pick<ModelSelectionStorage, 'setItem' | 'removeItem'>,
  projectId: string,
  sessionId: string,
  selection: ProjectChatModelSelection,
) {
  const key = projectChatModelSelectionStorageKey(projectId, sessionId);
  if (!key) return false;
  const parsed = parseStoredProjectChatModelSelection({
    schemaVersion: PROJECT_CHAT_MODEL_SELECTION_SCHEMA_VERSION,
    ...selection,
  });
  if (!parsed) return false;
  try {
    if (
      parsed.providerId === null &&
      parsed.modelId === null &&
      parsed.reasoningOptionId === null
    ) {
      storage.removeItem(key);
      return true;
    }
    const value: StoredProjectChatModelSelectionV1 = {
      schemaVersion: PROJECT_CHAT_MODEL_SELECTION_SCHEMA_VERSION,
      ...parsed,
    };
    const serialized = JSON.stringify(value);
    if (serialized.length > PROJECT_CHAT_MODEL_SELECTION_MAX_SERIALIZED_LENGTH) return false;
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

export function clearProjectChatModelSelection(
  storage: Pick<ModelSelectionStorage, 'removeItem'>,
  projectId: string,
  sessionId: string,
) {
  const key = projectChatModelSelectionStorageKey(projectId, sessionId);
  if (!key) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
