import {
  DEFAULT_WORKSPACE_BOARD_SETTINGS,
  WorkspaceBoardSettingsSchema,
  resolveWorkspaceBoardSettings,
  type WorkspaceBoardSettings,
} from '../../shared/workspace-contracts';
import {
  AGENT_ADD_ON_IDS,
  isAgentAddOnPreference,
  type AgentAddOnId,
  type AgentAddOnPreference,
} from '../../shared/agent-addon-contracts';
import {
  DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES,
  DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE,
  LectureStudioDocumentFeaturesSchema,
  LectureStudioStructureTemplateSchema,
  type LectureStudioDocumentFeatures,
  type LectureStudioStructureTemplate,
} from '../../shared/lecture-studio-contracts';
import {
  isSshResourceRefreshInterval,
  type SshResourceRefreshInterval,
} from './ssh-resource-refresh-policy';

export const APPEARANCE_OPTIONS = ['system', 'dark', 'light'] as const;
export const TEXT_SIZE_OPTIONS = ['compact', 'default', 'large', 'extra-large'] as const;
export const DEFAULT_AI_MODEL_ID_MAX_LENGTH = 256;
export const DEFAULT_AI_REASONING_OPTION_ID_MAX_LENGTH = 128;
export const MAX_PROJECT_LECTURE_DOCUMENT_FEATURE_OVERRIDES = 1_000;

export type AppearancePreference = (typeof APPEARANCE_OPTIONS)[number];
export type TextSizePreference = (typeof TEXT_SIZE_OPTIONS)[number];

export type DefaultAiSelection = Readonly<{
  modelId: string | null;
  reasoningOptionId: string | null;
}>;

export const DEFAULT_AI_SELECTION: DefaultAiSelection = Object.freeze({
  modelId: null,
  reasoningOptionId: 'high',
});

export type UserPreferences = Readonly<{
  schemaVersion: 1;
  appearance: AppearancePreference;
  textSize: TextSizePreference;
  sshResourceRefreshInterval: SshResourceRefreshInterval;
  defaultBoardTemplate: WorkspaceBoardSettings;
  defaultLectureStructure: LectureStudioStructureTemplate;
  defaultLectureDocumentFeatures: LectureStudioDocumentFeatures;
  lectureDocumentFeaturesByProjectId: Readonly<Record<string, LectureStudioDocumentFeatures>>;
  defaultAiSelection: DefaultAiSelection;
  agentAddOns: Readonly<Record<AgentAddOnId, AgentAddOnPreference>>;
}>;

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
type PreferenceRoot = Pick<HTMLElement, 'dataset'>;

export const USER_PREFERENCES_STORAGE_KEY = 'gosu:user-preferences:v1';
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  schemaVersion: 1,
  appearance: 'system',
  textSize: 'default',
  sshResourceRefreshInterval: '1m',
  defaultBoardTemplate: DEFAULT_WORKSPACE_BOARD_SETTINGS,
  defaultLectureStructure: DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE,
  defaultLectureDocumentFeatures: DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES,
  lectureDocumentFeaturesByProjectId: {},
  defaultAiSelection: DEFAULT_AI_SELECTION,
  agentAddOns: {
    openclaw: 'disabled',
    hermes: 'disabled',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function parseLectureDocumentFeatures(value: unknown): LectureStudioDocumentFeatures {
  const parsed = LectureStudioDocumentFeaturesSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES };
}

function parseProjectLectureDocumentFeatures(
  value: unknown,
): Readonly<Record<string, LectureStudioDocumentFeatures>> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value);
  if (entries.length > MAX_PROJECT_LECTURE_DOCUMENT_FEATURE_OVERRIDES) return {};

  const parsed: Record<string, LectureStudioDocumentFeatures> = {};
  for (const [projectId, candidate] of entries) {
    const features = LectureStudioDocumentFeaturesSchema.safeParse(candidate);
    if (!PROJECT_ID_PATTERN.test(projectId) || !features.success) return {};
    parsed[projectId] = features.data;
  }
  return parsed;
}

export function resolveLectureDocumentFeaturesForProject(
  preferences: Pick<
    UserPreferences,
    'defaultLectureDocumentFeatures' | 'lectureDocumentFeaturesByProjectId'
  >,
  projectId: string,
): LectureStudioDocumentFeatures {
  return structuredClone(
    preferences.lectureDocumentFeaturesByProjectId[projectId] ??
      preferences.defaultLectureDocumentFeatures,
  );
}

export function parseDefaultAiSelection(value: unknown): DefaultAiSelection {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'modelId,reasoningOptionId') {
    return { ...DEFAULT_AI_SELECTION };
  }
  const modelId = boundedOpaqueId(value.modelId, DEFAULT_AI_MODEL_ID_MAX_LENGTH);
  const reasoningOptionId = boundedOpaqueId(
    value.reasoningOptionId,
    DEFAULT_AI_REASONING_OPTION_ID_MAX_LENGTH,
  );
  if (modelId === undefined || reasoningOptionId === undefined) {
    return { ...DEFAULT_AI_SELECTION };
  }
  return { modelId, reasoningOptionId };
}

export function parseUserPreferences(value: unknown): UserPreferences {
  if (!isRecord(value) || value.schemaVersion !== 1) return defaultUserPreferences();
  const appearance =
    APPEARANCE_OPTIONS.find((option) => option === value.appearance) ??
    DEFAULT_USER_PREFERENCES.appearance;
  const textSize =
    TEXT_SIZE_OPTIONS.find((option) => option === value.textSize) ??
    DEFAULT_USER_PREFERENCES.textSize;
  const sshResourceRefreshInterval = isSshResourceRefreshInterval(value.sshResourceRefreshInterval)
    ? value.sshResourceRefreshInterval
    : DEFAULT_USER_PREFERENCES.sshResourceRefreshInterval;
  const template = WorkspaceBoardSettingsSchema.safeParse(value.defaultBoardTemplate);
  const lectureStructure = LectureStudioStructureTemplateSchema.safeParse(
    value.defaultLectureStructure,
  );
  const defaultLectureDocumentFeatures = parseLectureDocumentFeatures(
    value.defaultLectureDocumentFeatures,
  );
  const lectureDocumentFeaturesByProjectId = parseProjectLectureDocumentFeatures(
    value.lectureDocumentFeaturesByProjectId,
  );
  const storedAddOns = isRecord(value.agentAddOns) ? value.agentAddOns : {};
  const agentAddOns = Object.fromEntries(
    AGENT_ADD_ON_IDS.map((id) => {
      const candidate = storedAddOns[id];
      const supported =
        isAgentAddOnPreference(candidate) && (id === 'hermes' || candidate !== 'connect-local');
      return [id, supported ? candidate : 'disabled'];
    }),
  ) as Record<AgentAddOnId, AgentAddOnPreference>;
  return {
    schemaVersion: 1,
    appearance,
    textSize,
    sshResourceRefreshInterval,
    defaultBoardTemplate: template.success
      ? template.data
      : resolveWorkspaceBoardSettings(undefined),
    defaultLectureStructure: lectureStructure.success
      ? lectureStructure.data
      : { ...DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE },
    defaultLectureDocumentFeatures,
    lectureDocumentFeaturesByProjectId,
    defaultAiSelection: parseDefaultAiSelection(value.defaultAiSelection),
    agentAddOns,
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
    defaultLectureStructure: { ...DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE },
    defaultLectureDocumentFeatures: { ...DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES },
    lectureDocumentFeaturesByProjectId: {},
    defaultAiSelection: { ...DEFAULT_AI_SELECTION },
    agentAddOns: { ...DEFAULT_USER_PREFERENCES.agentAddOns },
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
