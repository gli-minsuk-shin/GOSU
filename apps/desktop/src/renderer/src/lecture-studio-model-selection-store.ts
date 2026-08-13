type ModelSelectionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const LECTURE_STUDIO_MODEL_SELECTION_STORAGE_PREFIX =
  'gosu:lecture-studio-model-selection:v1:';
export const LECTURE_STUDIO_MODEL_SELECTION_SCHEMA_VERSION = 1;
export const LECTURE_STUDIO_MODEL_SELECTION_MAX_SCOPE_ID_LENGTH = 128;
export const LECTURE_STUDIO_MODEL_SELECTION_MAX_MODEL_ID_LENGTH = 256;
export const LECTURE_STUDIO_MODEL_SELECTION_MAX_REASONING_ID_LENGTH = 128;
export const LECTURE_STUDIO_MODEL_SELECTION_MAX_SERIALIZED_LENGTH = 768;

export type LectureStudioModelSelection = Readonly<{
  modelId: string | null;
  reasoningOptionId: string | null;
}>;

export const AUTO_LECTURE_STUDIO_MODEL_SELECTION: LectureStudioModelSelection = Object.freeze({
  modelId: null,
  reasoningOptionId: null,
});

type StoredLectureStudioModelSelectionV1 = Readonly<{
  schemaVersion: 1;
  modelId: string | null;
  reasoningOptionId: string | null;
}>;

const STORED_SELECTION_KEYS = ['modelId', 'reasoningOptionId', 'schemaVersion'] as const;

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
    typeof boundedOpaqueId(value, LECTURE_STUDIO_MODEL_SELECTION_MAX_SCOPE_ID_LENGTH) === 'string'
  );
}

export function lectureStudioModelSelectionStorageKey(studioId: string) {
  if (!validScopeId(studioId)) return null;
  try {
    return `${LECTURE_STUDIO_MODEL_SELECTION_STORAGE_PREFIX}${encodeURIComponent(studioId)}`;
  } catch {
    return null;
  }
}

export function parseStoredLectureStudioModelSelection(
  value: unknown,
): LectureStudioModelSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== LECTURE_STUDIO_MODEL_SELECTION_SCHEMA_VERSION ||
    Object.keys(record).sort().join(',') !== [...STORED_SELECTION_KEYS].sort().join(',')
  ) {
    return null;
  }

  const modelId = boundedOpaqueId(
    record.modelId,
    LECTURE_STUDIO_MODEL_SELECTION_MAX_MODEL_ID_LENGTH,
  );
  const reasoningOptionId = boundedOpaqueId(
    record.reasoningOptionId,
    LECTURE_STUDIO_MODEL_SELECTION_MAX_REASONING_ID_LENGTH,
  );
  if (modelId === undefined || reasoningOptionId === undefined) return null;
  return { modelId, reasoningOptionId };
}

export function loadLectureStudioModelSelection(
  storage: Pick<ModelSelectionStorage, 'getItem'>,
  studioId: string,
): LectureStudioModelSelection {
  const key = lectureStudioModelSelectionStorageKey(studioId);
  if (!key) return AUTO_LECTURE_STUDIO_MODEL_SELECTION;
  try {
    const serialized = storage.getItem(key);
    if (!serialized || serialized.length > LECTURE_STUDIO_MODEL_SELECTION_MAX_SERIALIZED_LENGTH) {
      return AUTO_LECTURE_STUDIO_MODEL_SELECTION;
    }
    return (
      parseStoredLectureStudioModelSelection(JSON.parse(serialized) as unknown) ??
      AUTO_LECTURE_STUDIO_MODEL_SELECTION
    );
  } catch {
    return AUTO_LECTURE_STUDIO_MODEL_SELECTION;
  }
}

export function saveLectureStudioModelSelection(
  storage: Pick<ModelSelectionStorage, 'setItem' | 'removeItem'>,
  studioId: string,
  selection: LectureStudioModelSelection,
) {
  const key = lectureStudioModelSelectionStorageKey(studioId);
  if (!key) return false;
  const parsed = parseStoredLectureStudioModelSelection({
    schemaVersion: LECTURE_STUDIO_MODEL_SELECTION_SCHEMA_VERSION,
    ...selection,
  });
  if (!parsed) return false;
  try {
    if (parsed.modelId === null && parsed.reasoningOptionId === null) {
      storage.removeItem(key);
      return true;
    }
    const value: StoredLectureStudioModelSelectionV1 = {
      schemaVersion: LECTURE_STUDIO_MODEL_SELECTION_SCHEMA_VERSION,
      ...parsed,
    };
    const serialized = JSON.stringify(value);
    if (serialized.length > LECTURE_STUDIO_MODEL_SELECTION_MAX_SERIALIZED_LENGTH) return false;
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

export function clearLectureStudioModelSelection(
  storage: Pick<ModelSelectionStorage, 'removeItem'>,
  studioId: string,
) {
  const key = lectureStudioModelSelectionStorageKey(studioId);
  if (!key) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function selectLectureStudioModel(
  current: LectureStudioModelSelection,
  modelId: string | null,
): LectureStudioModelSelection {
  if (modelId === current.modelId) return current;
  return { modelId, reasoningOptionId: null };
}

export function selectLectureStudioReasoning(
  current: LectureStudioModelSelection,
  reasoningOptionId: string | null,
): LectureStudioModelSelection {
  return { ...current, reasoningOptionId };
}

export type LectureStudioModelDescriptor = Readonly<{
  modelId: string;
  isDefault: boolean;
  reasoningOptions: readonly Readonly<{ id: string }>[];
}>;

export type LectureStudioModelSelectionResolution = Readonly<{
  effectiveModelId: string | null;
  issue: 'model_unavailable' | 'reasoning_unavailable' | null;
}>;

/**
 * Resolves only against the currently rendered provider catalog. This is a UI guard; Electron Main
 * still refreshes the provider catalog and validates the same opaque IDs immediately before a turn.
 */
export function resolveLectureStudioModelSelection(
  selection: LectureStudioModelSelection,
  models: readonly LectureStudioModelDescriptor[],
): LectureStudioModelSelectionResolution {
  const candidates = selection.modelId
    ? models.filter((model) => model.modelId === selection.modelId)
    : models.filter((model) => model.isDefault);
  if (candidates.length !== 1) return { effectiveModelId: null, issue: 'model_unavailable' };
  const model = candidates[0]!;
  if (
    selection.reasoningOptionId !== null &&
    !model.reasoningOptions.some((option) => option.id === selection.reasoningOptionId)
  ) {
    return { effectiveModelId: model.modelId, issue: 'reasoning_unavailable' };
  }
  return { effectiveModelId: model.modelId, issue: null };
}
