import { answerModelQuestion, runAgentReview } from './model-lab-domain';
import { modelLabFetch } from './model-lab-environment';
import type { AgentPermanentMemoryEntry, ModelCatalog } from '@gosu/contracts';
import type { ModelBuildArtifact } from './model-lab-builder';
import { parseModelImportJson } from './model-lab-import';
import type { AgentReview, GradientProbeName, ModelSpec } from './model-lab-schema';
import type { ModelLabAgentProgress } from './model-lab-agent-harness';
import type { ModelLabAgentUsage } from './model-lab-agent-harness';
import { ContextUsageSchema, type ContextUsage } from '../../briefing-lab/src/context-usage';

export type ModelLabRuntimeMode = 'deterministic-local' | 'codex-llm' | 'gosu-agent-runtime';

export type ModelLabConversationMessage = Readonly<{
  role: 'user' | 'assistant';
  body: string;
  createdAt?: string;
}>;

export type ModelLabProjectContext = Readonly<{
  projectModels: readonly ModelSpec[];
  activeModelId: string;
  probe: GradientProbeName;
  checkpointIndex: number;
  persistentMemory?: readonly AgentPermanentMemoryEntry[];
}>;

export type ModelLabQuestionRequest = ModelLabProjectContext &
  Readonly<{
    selectedModuleId: string;
    question: string;
    conversation?: readonly ModelLabConversationMessage[];
    attachments?: readonly ModelBuildArtifact[];
    selection?: ModelLabModelSelection;
    purpose?: 'chat' | 'revision-comment';
    conversationRevision?: number;
    conversationWorkspaceId?: string | undefined;
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
  contextUsage?: ContextUsage;
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

const MODEL_LAB_KNOWN_RUNTIME_ERRORS: Readonly<Record<string, string>> = {
  model_chat_context_busy:
    'This model revision already has an active context update. Wait for that request to finish; your saved conversation is unchanged.',
  model_chat_context_invalid:
    'The saved Model Lab conversation could not be validated. It was not reset or overwritten.',
  model_chat_context_limit:
    'The Model Lab conversation archive reached its safety limit. Existing messages were preserved; this request was not saved.',
  assistant_context_too_large:
    'The current model context cannot fit this request safely, even after history preparation. Existing messages are preserved.',
  assistant_compaction_invalid:
    'Conversation compaction did not return a valid summary. Original messages are preserved.',
  claude_code_auth_required:
    'Claude Code authentication expired. Sign in again with Claude Code, then retry this turn.',
  claude_code_timeout:
    'Claude Code did not finish within five minutes. Retry this turn or choose a faster reasoning level.',
  codex_auth_required:
    'GOSU Codex authentication is required. Reconnect Codex in GOSU, then retry this turn.',
  codex_usage_limit_exceeded:
    'Codex usage is currently limited. Retry after the provider limit resets.',
  codex_context_too_large:
    'The request exceeds the selected Codex context. Reduce attached context or select a larger-context model.',
  model_copilot_context_too_large:
    'This turn exceeds the available model context. Reduce the attached context or select a larger-context model.',
  model_lab_native_timeout:
    'The native agent did not finish within five minutes. Retry this turn or choose a faster reasoning level.',
};

export function modelLabRuntimeErrorCode(value: unknown) {
  return typeof value === 'string' && Object.hasOwn(MODEL_LAB_KNOWN_RUNTIME_ERRORS, value)
    ? value
    : 'model_copilot_llm_unavailable';
}

export function modelLabRuntimeErrorMessage(error: unknown) {
  const code =
    error instanceof Error
      ? modelLabRuntimeErrorCode(error.message)
      : modelLabRuntimeErrorCode(error);
  return MODEL_LAB_KNOWN_RUNTIME_ERRORS[code] ?? MODEL_LAB_RUNTIME_ERROR_MESSAGE;
}

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
      onContextUsage?: (usage: ContextUsage) => void;
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
      parseModelImportJson(JSON.stringify(editProposal.model), {
        enforceSourceOutputContracts: true,
      }).ok);
  return (
    typeof candidate.body === 'string' &&
    Array.isArray(candidate.trace) &&
    candidate.trace.every((entry) => typeof entry === 'string') &&
    (candidate.usage === undefined || isRuntimeUsage(candidate.usage)) &&
    (candidate.contextUsage === undefined ||
      ContextUsageSchema.safeParse(candidate.contextUsage).success) &&
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

export function createGosuModelLabRuntime(
  fetchImpl: FetchLike = modelLabFetch,
): ModelLabRuntimeAdapter {
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
            } else if (record.type === 'context-usage') {
              const usage = ContextUsageSchema.safeParse(record.usage);
              if (usage.success) options?.onContextUsage?.(usage.data);
            } else if (record.type === 'result' && isRuntimeAnswer(record.answer)) {
              answer = record.answer;
            } else if (record.type === 'error') {
              throw new Error(modelLabRuntimeErrorCode(record.detail));
            }
          }
          if (chunk.done) break;
        }
        if (!response.ok || !answer) throw new Error('model_copilot_llm_unavailable');
        return answer;
      }
      const payload: unknown = await response.json();
      if (!response.ok || !isRuntimeAnswer(payload)) {
        throw new Error(
          modelLabRuntimeErrorCode(
            payload && typeof payload === 'object' && 'detail' in payload
              ? payload.detail
              : undefined,
          ),
        );
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
