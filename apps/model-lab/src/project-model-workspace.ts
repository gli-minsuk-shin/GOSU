import { bottleneckAutoencoder, sampleModels } from './sample-models';
import {
  initialModelPseudocodeWorkspace,
  modelToPseudocode,
  parseModelPseudocode,
  restoreModelPseudocodeWorkspace,
  MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
  serializeModelPseudocodeWorkspace,
  type ModelPseudocodeWorkspace,
} from './model-pseudocode';
import type { ModelModule, ModelSpec } from './model-lab-schema';

export const PROJECT_MODEL_SCOPE_KEY = 'gosu.model-lab.project-scope.v1';
export const DEFAULT_PROJECT_MODEL_ID = bottleneckAutoencoder.id;

export function defaultModelLabModels(): readonly ModelSpec[] {
  return [structuredClone(bottleneckAutoencoder)];
}

export function defaultProjectModelWorkspace(): ModelPseudocodeWorkspace {
  const workspace = initialModelPseudocodeWorkspace(defaultModelLabModels());
  return {
    ...workspace,
    histories: Object.fromEntries(
      Object.entries(workspace.histories).map(([id, history]) => [
        id,
        history.map((revision) => ({ ...revision, label: 'Default model' })),
      ]),
    ),
  };
}

/** Explicit cleanup operation, never an automatic policy applied to user-created models. */
export function keepOnlyBottleneckAutoencoder(workspace: ModelPseudocodeWorkspace) {
  const keep = workspace.models.find(
    (model) => model.id === DEFAULT_PROJECT_MODEL_ID && model.name === bottleneckAutoencoder.name,
  );
  if (!keep) throw new Error('The Bottleneck autoencoder model could not be identified safely');
  const movedIds = workspace.models
    .filter((model) => model.id !== keep.id && !workspace.trashedModelIds.includes(model.id))
    .map((model) => model.id);
  return {
    workspace: {
      ...workspace,
      activeModelId: keep.id,
      trashedModelIds: [
        ...new Set([...workspace.trashedModelIds.filter((id) => id !== keep.id), ...movedIds]),
      ],
    },
    movedIds,
  };
}
const chatKey = 'gosu.model-lab.chat-sessions.v1';
const memoryKey = 'gosu.model-lab.permanent-memory.v1';

/** UI-only null object. Never registered, saved, displayed as a graph or sent to an LLM. */
export const EMPTY_MODEL_LAB_DISPLAY: ModelSpec = {
  schemaVersion: 1,
  id: 'empty-project-workspace',
  name: 'No model selected',
  version: '0',
  framework: 'design-only',
  sourceLabel: 'Empty workspace',
  sourceArtifacts: [],
  summary: '',
  intent: { statement: '', invariants: [], expectedInput: [], expectedOutput: [] },
  modules: [],
  connections: [],
  gradientEvidence: null,
};
export const EMPTY_MODEL_MODULE_DISPLAY: ModelModule = {
  id: 'empty-selection',
  name: 'No module selected',
  kind: 'input',
  group: '',
  stage: 0,
  lane: 0,
  inputShape: [],
  outputShape: [],
  transform: '',
  activation: null,
  formula: '',
  explanation: '',
  parameterCount: 0,
  codeReference: '',
};

export function projectModelLabInitialWorkspace(text: string | null) {
  return text !== null
    ? restoreModelPseudocodeWorkspace(text, [], { allowEmpty: true })
    : defaultProjectModelWorkspace();
}

function json(text: string | undefined, fallback: unknown): unknown {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
let seedSources: Map<string, string> | undefined;

/** One-time, conservative migration: only unchanged automatic seeds go to recoverable Trash. */
export function migrateProjectModelSeeds(storage: Record<string, string>) {
  if (!Object.prototype.hasOwnProperty.call(storage, MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY)) {
    return {
      storage: {
        ...storage,
        [PROJECT_MODEL_SCOPE_KEY]: '1',
        [MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY]: serializeModelPseudocodeWorkspace(
          defaultProjectModelWorkspace(),
        ),
      },
      movedIds: [] as string[],
    };
  }
  if (storage[PROJECT_MODEL_SCOPE_KEY]) return { storage, movedIds: [] as string[] };
  const raw = json(storage[MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY], {});
  const chats = json(storage[chatKey], {});
  const memories = json(storage[memoryKey], []);
  const jobs = json(storage['gosu.model-lab.import-history.v1'], []);
  if (!record(raw) || !record(chats) || !Array.isArray(memories) || !Array.isArray(jobs))
    return { storage, movedIds: [] as string[] };
  const histories = record(raw.histories) ? raw.histories : {};
  seedSources ??= new Map(
    sampleModels.map((model) => {
      const parsed = parseModelPseudocode(modelToPseudocode(model), model.id);
      return [model.id, parsed.ok ? parsed.normalized : modelToPseudocode(model)];
    }),
  );
  const eligible = new Set<string>();
  for (const seed of sampleModels) {
    if (seed.id === DEFAULT_PROJECT_MODEL_ID) continue;
    const history = histories[seed.id];
    if (!Array.isArray(history) || history.length !== 1 || !record(history[0])) continue;
    const revision = history[0];
    if (
      revision.revision !== 0 ||
      revision.parentRevision !== null ||
      revision.label !== 'Imported model' ||
      revision.pythonArtifact ||
      revision.originalDraft ||
      typeof revision.pseudocode !== 'string'
    )
      continue;
    const parsed = parseModelPseudocode(revision.pseudocode, seed.id);
    if (!parsed.ok || parsed.normalized !== seedSources.get(seed.id)) continue;
    const activity = Object.entries(chats).some(
      ([sessionKey, session]) =>
        record(session) &&
        ((Array.isArray(session.messages) &&
          session.messages.some(
            (message) =>
              record(message) &&
              message.modelId === seed.id &&
              (message.id !== `welcome-${seed.id}` || message.role !== 'assistant'),
          )) ||
          (typeof session.draft === 'string' &&
            session.draft.trim() &&
            ((Array.isArray(session.messages) &&
              session.messages.some((message) => record(message) && message.modelId === seed.id)) ||
              (Array.isArray(json(sessionKey, null)) &&
                (json(sessionKey, null) as unknown[])[0] === seed.id)))),
    );
    const memory = memories.some((entry) => record(entry) && entry.scopeId === seed.id);
    const imported = jobs.some(
      (job) =>
        record(job) &&
        job.status === 'session-created' &&
        typeof job.detail === 'string' &&
        job.detail.includes(seed.name),
    );
    if (!activity && !memory && !imported) eligible.add(seed.id);
  }
  // Retain dependencies of every non-seed/user-touched revision, including archived revisions.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, history] of Object.entries(histories)) {
      if (eligible.has(id) || !Array.isArray(history)) continue;
      for (const revision of history) {
        if (!record(revision) || typeof revision.pseudocode !== 'string') continue;
        const parsed = parseModelPseudocode(revision.pseudocode, id);
        if (!parsed.ok) continue;
        for (const module of parsed.model.modules)
          if (module.subgraph && eligible.delete(module.subgraph.modelId)) changed = true;
      }
    }
  }
  const trashed = Array.isArray(raw.trashedModelIds)
    ? raw.trashedModelIds.filter((id): id is string => typeof id === 'string')
    : [];
  const movedIds = [...eligible].filter((id) => !trashed.includes(id));
  const allTrashed = [...new Set([...trashed, ...eligible])];
  const activeIds = Object.keys(histories).filter((id) => !allTrashed.includes(id));
  const next: Record<string, string> = { ...storage, [PROJECT_MODEL_SCOPE_KEY]: '1' };
  if (movedIds.length)
    next[MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY] = JSON.stringify({
      ...raw,
      trashedModelIds: allTrashed,
      activeModelId:
        typeof raw.activeModelId === 'string' && activeIds.includes(raw.activeModelId)
          ? raw.activeModelId
          : (activeIds[0] ?? ''),
    });
  return { storage: next, movedIds };
}
