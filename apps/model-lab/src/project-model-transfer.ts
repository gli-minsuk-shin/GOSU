import { modelLabFetch } from './model-lab-environment';
import {
  parseModelPseudocode,
  type ModelPseudocodeRevision,
  type ModelPseudocodeWorkspace,
} from './model-pseudocode';

export type ProjectModelCopy = Readonly<{
  id: string;
  sourceProjectId: string;
  sourceProjectName?: string;
  sourceModelId: string;
  sourceRevision: number;
  targetProjectId: string;
  rootModelId: string;
  modelName: string;
  modelIds: readonly string[];
  createdAt: string;
  status: 'pending' | 'delivered';
  entries?: readonly ModelPseudocodeRevision[];
}>;
export const PROJECT_MODEL_RECEIVED_COPIES_KEY = 'gosu.model-lab.received-copies.v1';
export const PROJECT_MODEL_COPY_PATH = '/api/model-lab-project-copies';

export function mergeProjectModelCopies(
  workspace: ModelPseudocodeWorkspace,
  copies: readonly ProjectModelCopy[],
) {
  const histories = { ...workspace.histories };
  const selectedRevisions = { ...workspace.selectedRevisions };
  const models = [...workspace.models];
  for (const copy of copies) {
    if (
      !copy.entries?.length ||
      !copy.modelIds.includes(copy.rootModelId) ||
      copy.modelIds.length !== copy.entries.length ||
      new Set(copy.modelIds).size !== copy.modelIds.length ||
      new Set(copy.entries.map((entry) => entry.model.id)).size !== copy.entries.length
    )
      throw new Error('Invalid incoming model copy');
    for (const entry of copy.entries) {
      if (
        !copy.modelIds.includes(entry.model.id) ||
        entry.revision !== 0 ||
        entry.parentRevision !== null
      )
        throw new Error('Invalid model copy revision');
      if (histories[entry.model.id]) continue; // replay must never overwrite a user-edited copy
      const parsed = parseModelPseudocode(entry.pseudocode, entry.model.id);
      if (!parsed.ok) throw new Error(`Model copy validation failed: ${parsed.reason}`);
      if (
        entry.pythonArtifact &&
        (entry.pythonArtifact.modelId !== entry.model.id || entry.pythonArtifact.revision !== 0)
      )
        throw new Error('Invalid copied Python scope');
      const revision = {
        ...structuredClone(entry),
        model: parsed.model,
        pseudocode: parsed.normalized,
      };
      histories[entry.model.id] = [revision];
      selectedRevisions[entry.model.id] = 0;
      models.push(revision.model);
    }
  }
  const hasActive = models.some(
    (model) =>
      model.id === workspace.activeModelId && !workspace.trashedModelIds.includes(model.id),
  );
  return {
    ...workspace,
    models,
    histories,
    selectedRevisions,
    activeModelId: hasActive
      ? workspace.activeModelId
      : (copies[0]?.rootModelId ?? workspace.activeModelId),
  };
}

async function responseJson(response: Response) {
  const value = await response.json();
  if (!response.ok)
    throw new Error(typeof value?.error === 'string' ? value.error : 'Model copy failed');
  return value;
}
export const projectModelCopies = {
  async targets(): Promise<readonly { id: string; name: string }[]> {
    return (await responseJson(await modelLabFetch(`${PROJECT_MODEL_COPY_PATH}/targets`))).projects;
  },
  async pending(): Promise<readonly ProjectModelCopy[]> {
    return (await responseJson(await modelLabFetch(PROJECT_MODEL_COPY_PATH))).copies;
  },
  async create(input: {
    targetProjectId: string;
    sourceModelId: string;
    sourceRevision: number;
    requestId: string;
  }): Promise<ProjectModelCopy> {
    return (
      await responseJson(
        await modelLabFetch(PROJECT_MODEL_COPY_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      )
    ).copy;
  },
  async acknowledge(id: string) {
    await responseJson(
      await modelLabFetch(`${PROJECT_MODEL_COPY_PATH}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }),
    );
  },
};
