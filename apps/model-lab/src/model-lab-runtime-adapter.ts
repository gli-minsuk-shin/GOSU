import { answerModelQuestion, runAgentReview } from './model-lab-domain';
import type { ModelCatalog } from '@gosu/contracts';
import type { ModelBuildArtifact } from './model-lab-builder';
import { parseModelImportJson } from './model-lab-import';
import type { AgentReview, GradientProbeName, ModelSpec } from './model-lab-schema';
import type { ModelLabAgentProgress } from './model-lab-agent-harness';
import type { ModelLabAgentUsage } from './model-lab-agent-harness';

export type ModelLabRuntimeMode = 'deterministic-local' | 'codex-llm' | 'gosu-agent-runtime';

export type ModelLabConversationMessage = Readonly<{
  role: 'user' | 'assistant';
  body: string;
}>;

export type ModelLabProjectContext = Readonly<{
  projectModels: readonly ModelSpec[];
  activeModelId: string;
  probe: GradientProbeName;
  checkpointIndex: number;
}>;

export type ModelLabQuestionRequest = ModelLabProjectContext &
  Readonly<{
    selectedModuleId: string;
    question: string;
    conversation?: readonly ModelLabConversationMessage[];
    attachments?: readonly ModelBuildArtifact[];
    selection?: ModelLabModelSelection;
    purpose?: 'chat' | 'revision-comment';
  }>;

/** Matches GOSU Project Chat's provider-opaque model selection fields. */
export type ModelLabModelSelection = Readonly<{
  providerId: string | null;
  requestedModelId: string | null;
  reasoningOptionId: string | null;
}>;

export type ModelLabRuntimeAnswer = Readonly<{
  body: string;
  trace: readonly string[];
  usage?: ModelLabAgentUsage;
  editProposal?: Readonly<{
    model: ModelSpec;
    instructions: string;
  }>;
}>;

export type ModelLabTurnScope = Readonly<{
  sequence: number;
  modelId: string;
  modelVersion: string;
}>;

export const MODEL_LAB_RUNTIME_ERROR_MESSAGE =
  'GOSU Model Copilot is unavailable, so no answer was generated. No deterministic substitute was used. Check the selected LLM connection and retry.';

export type ModelLabRuntimeStatus = Readonly<{
  available: boolean;
  provider: string;
  model: string;
  reasoning: string;
}>;

export function isCurrentModelLabTurn(
  turn: ModelLabTurnScope,
  currentSequence: number,
  activeModel: Readonly<{ id: string; version: string }>,
): boolean {
  return (
    turn.sequence === currentSequence &&
    turn.modelId === activeModel.id &&
    turn.modelVersion === activeModel.version
  );
}

export interface ModelLabRuntimeAdapter {
  readonly mode: ModelLabRuntimeMode;
  answer(
    request: ModelLabQuestionRequest,
    options?: Readonly<{
      signal?: AbortSignal;
      onProgress?: (progress: ModelLabAgentProgress) => void;
    }>,
  ): Promise<ModelLabRuntimeAnswer>;
  review(request: ModelLabProjectContext): Promise<readonly AgentReview[]>;
  status?(): Promise<ModelLabRuntimeStatus>;
  listModels?(options?: Readonly<{ refresh?: boolean }>): Promise<ModelCatalog>;
}

function activeModel(request: ModelLabProjectContext): ModelSpec {
  const model = request.projectModels.find((candidate) => candidate.id === request.activeModelId);
  if (!model) throw new Error('model_lab_runtime_active_model_missing');
  return model;
}

export const deterministicModelLabRuntime: ModelLabRuntimeAdapter = {
  mode: 'deterministic-local',
  async answer(request) {
    const model = activeModel(request);
    return {
      body: answerModelQuestion(
        request.question,
        model,
        request.selectedModuleId,
        request.probe,
        request.checkpointIndex,
      ),
      trace: [
        `${model.name}@${model.version}`,
        `Project model registry · ${request.projectModels.length}`,
        request.selectedModuleId,
        'Deterministic evidence reader',
      ],
    };
  },
  async review(request) {
    return runAgentReview(
      activeModel(request),
      request.probe,
      request.checkpointIndex,
      request.projectModels,
    );
  },
};

type FetchLike = typeof fetch;

function isRuntimeUsage(value: unknown): value is ModelLabAgentUsage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  return [
    'inputTokens',
    'outputTokens',
    'cachedReadTokens',
    'cachedWriteTokens',
    'totalTokens',
  ].every(
    (field) =>
      typeof usage[field] === 'number' &&
      Number.isSafeInteger(usage[field]) &&
      (usage[field] as number) >= 0,
  );
}

function isRuntimeAnswer(value: unknown): value is ModelLabRuntimeAnswer {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ModelLabRuntimeAnswer>;
  const editProposal = candidate.editProposal;
  const validEditProposal =
    editProposal === undefined ||
    (typeof editProposal === 'object' &&
      editProposal !== null &&
      !Array.isArray(editProposal) &&
      typeof editProposal.instructions === 'string' &&
      parseModelImportJson(JSON.stringify(editProposal.model)).ok);
  return (
    typeof candidate.body === 'string' &&
    Array.isArray(candidate.trace) &&
    candidate.trace.every((entry) => typeof entry === 'string') &&
    (candidate.usage === undefined || isRuntimeUsage(candidate.usage)) &&
    validEditProposal
  );
}

function isRuntimeStatus(value: unknown): value is ModelLabRuntimeStatus {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ModelLabRuntimeStatus>;
  return (
    typeof candidate.available === 'boolean' &&
    typeof candidate.provider === 'string' &&
    typeof candidate.model === 'string' &&
    typeof candidate.reasoning === 'string'
  );
}

function isModelCatalog(value: unknown): value is ModelCatalog {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ModelCatalog>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.providerId === 'string' &&
    typeof candidate.catalogVersion === 'string' &&
    typeof candidate.fetchedAt === 'string' &&
    Array.isArray(candidate.models) &&
    candidate.models.every(
      (model) =>
        model.schemaVersion === 1 &&
        typeof model.providerId === 'string' &&
        typeof model.modelId === 'string' &&
        typeof model.displayName === 'string' &&
        typeof model.isDefault === 'boolean' &&
        Array.isArray(model.modalities) &&
        Array.isArray(model.reasoningOptions),
    )
  );
}

export function createGosuModelLabRuntime(fetchImpl: FetchLike = fetch): ModelLabRuntimeAdapter {
  return {
    mode: 'gosu-agent-runtime',
    async answer(request, options) {
      const response = await fetchImpl('/api/model-copilot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson, application/json',
        },
        body: JSON.stringify(request),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      const contentType = response.headers?.get?.('content-type') ?? '';
      if (contentType.includes('application/x-ndjson') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let answer: ModelLabRuntimeAnswer | null = null;
        for (;;) {
          const chunk = await reader.read();
          buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          for (;;) {
            const newline = buffer.indexOf('\n');
            if (newline < 0) break;
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (!line.trim()) continue;
            const event = JSON.parse(line) as unknown;
            if (!event || typeof event !== 'object') continue;
            const record = event as Record<string, unknown>;
            if (
              record.type === 'progress' &&
              record.progress &&
              typeof record.progress === 'object'
            ) {
              options?.onProgress?.(record.progress as ModelLabAgentProgress);
            } else if (record.type === 'result' && isRuntimeAnswer(record.answer)) {
              answer = record.answer;
            } else if (record.type === 'error') {
              throw new Error('model_copilot_llm_unavailable');
            }
          }
          if (chunk.done) break;
        }
        if (!response.ok || !answer) throw new Error('model_copilot_llm_unavailable');
        return answer;
      }
      const payload: unknown = await response.json();
      if (!response.ok || !isRuntimeAnswer(payload)) {
        throw new Error('model_copilot_llm_unavailable');
      }
      return payload;
    },
    async review(request) {
      return runAgentReview(
        activeModel(request),
        request.probe,
        request.checkpointIndex,
        request.projectModels,
      );
    },
    async status() {
      const response = await fetchImpl('/api/model-copilot/status', {
        headers: { Accept: 'application/json' },
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isRuntimeStatus(payload)) {
        throw new Error('model_copilot_status_unavailable');
      }
      return payload;
    },
    async listModels(options) {
      const response = await fetchImpl(
        `/api/model-copilot/models${options?.refresh ? '?refresh=1' : ''}`,
        {
          headers: { Accept: 'application/json' },
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok || !isModelCatalog(payload)) {
        throw new Error('model_copilot_catalog_unavailable');
      }
      return payload;
    },
  };
}

/** Backwards-compatible prototype name; GOSU embedding uses the same adapter contract. */
export const createCodexModelLabRuntime = createGosuModelLabRuntime;
export const gosuModelLabRuntime = createGosuModelLabRuntime();
export const codexModelLabRuntime = gosuModelLabRuntime;
