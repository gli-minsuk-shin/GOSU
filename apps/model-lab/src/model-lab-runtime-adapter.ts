import { answerModelQuestion, runAgentReview } from './model-lab-domain';
import { beginAiActivity } from '@gosu/ui/ai-activity';
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

/** "/new" starts a fresh context, "/compact" summarizes the earlier part of the current one. */
export type ModelLabContextAction = 'new' | 'compact';

export type ModelLabContextUpdate = Readonly<{
  action: ModelLabContextAction;
  compacted: boolean;
  summarizedMessages: number;
  totalMessages: number;
  contextStartsAt: number;
  usage?: ContextUsage;
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
  'GOSU Model Assistant is unavailable, so no answer was generated. No deterministic substitute was used. Check the selected LLM connection and retry.';

const MODEL_LAB_KNOWN_RUNTIME_ERRORS: Readonly<Record<string, string>> = {
  model_copilot_timeout:
    'Graph generation exceeded its time limit. The existing model is unchanged; retry the graph edit.',
  model_copilot_output_too_large:
    'The generated graph exceeded the output size limit. The existing model is unchanged.',
  model_copilot_input_failed:
    'The model process closed before receiving the request. Retry or check the provider connection.',
  model_copilot_process_failed:
    'The model process exited before returning a result. The existing model and conversation are preserved.',
  model_lab_native_final_missing:
    'The provider completed without an answer. Retry this request; existing history is preserved.',
  model_lab_native_final_invalid:
    'The provider response could not be validated. Retry this request; existing history is preserved.',
  model_lab_native_turn_failed:
    'The provider could not complete this turn. Existing history and the model are unchanged.',
  model_chat_context_busy:
    'This model revision already has an active context update. Wait for that request to finish; your saved conversation is unchanged.',
  model_copilot_context_request_invalid:
    'GOSU rejected this context command as invalid. The saved conversation is unchanged.',
  model_copilot_context_unavailable:
    'The context command could not be completed. The saved conversation is unchanged.',
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
  model_copilot_selected_model_unavailable:
    'The Model Assistant model chosen for this conversation is not in the current model list. Choose a model again in the Assistant panel, then retry.',
  model_copilot_selected_reasoning_unavailable:
    'The reasoning level chosen for this conversation is not offered by the selected model. Choose a reasoning level again in the Assistant panel, then retry.',
  model_copilot_selected_module_missing:
    'The selected module is not part of the active model. Select a module in the graph, then retry.',
  model_copilot_active_model_missing:
    'The active model was not found in the project registry. Reopen the model, then retry.',
  model_copilot_request_too_large:
    'This request exceeds the Model Assistant request size limit. Remove attached files or shorten the question, then retry.',
  model_copilot_empty_response:
    'The provider returned an empty answer. Retry this request; existing history is preserved.',
  model_copilot_agent_unavailable:
    'The Model Assistant agent could not start with the selected provider. Check the LLM connection in the Assistant panel, then retry.',
  model_copilot_agent_step_limit:
    'Model Assistant used every allowed tool step without reaching an answer. Ask a narrower question, then retry.',
  model_copilot_catalog_unavailable:
    'The Model Assistant model list could not be loaded. Check the provider connection, then retry.',
  model_copilot_codex_catalog_unavailable:
    'The Codex model list could not be loaded. Reconnect Codex in GOSU, then retry.',
};

export function modelLabRuntimeErrorCode(value: unknown) {
  if (typeof value === 'string' && /^model_copilot_codex_exit_(?:\d+|unknown)$/.test(value))
    return 'model_copilot_process_failed';
  return typeof value === 'string' && Object.hasOwn(MODEL_LAB_KNOWN_RUNTIME_ERRORS, value)
    ? value
    : 'model_copilot_llm_unavailable';
}

/**
 * The failure code as the server reported it, when it is a plain code. Anything else (a sentence,
 * a provider log, a secret) collapses to the generic code so no diagnostics leak into the chat.
 */
export function modelLabRuntimeErrorDetail(value: unknown) {
  const known = modelLabRuntimeErrorCode(value);
  if (known !== 'model_copilot_llm_unavailable') return known;
  return typeof value === 'string' && /^[a-z][a-z0-9_]{2,79}$/u.test(value)
    ? value
    : 'model_copilot_llm_unavailable';
}

export function modelLabRuntimeErrorMessage(error: unknown) {
  const detail = modelLabRuntimeErrorDetail(error instanceof Error ? error.message : error);
  const known = MODEL_LAB_KNOWN_RUNTIME_ERRORS[detail];
  if (known) return known;
  // An unrecognized failure still names its code, so the next report says what actually failed.
  return detail === 'model_copilot_llm_unavailable'
    ? MODEL_LAB_RUNTIME_ERROR_MESSAGE
    : `${MODEL_LAB_RUNTIME_ERROR_MESSAGE} Error code: ${detail}.`;
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
  /** Runs a reader's context command. No answer turn is started and no message is stored. */
  updateContext(
    action: ModelLabContextAction,
    request: ModelLabQuestionRequest,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ModelLabContextUpdate>;
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
  async updateContext() {
    // The deterministic reader keeps no stored conversation, so there is no context to change.
    throw new Error('model_copilot_context_unavailable');
  },
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

function isContextUpdate(value: unknown): value is ModelLabContextUpdate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ModelLabContextUpdate>;
  return (
    (candidate.action === 'new' || candidate.action === 'compact') &&
    typeof candidate.compacted === 'boolean' &&
    [candidate.summarizedMessages, candidate.totalMessages, candidate.contextStartsAt].every(
      (count) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0,
    ) &&
    (candidate.usage === undefined || ContextUsageSchema.safeParse(candidate.usage).success)
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
    async updateContext(action, request, options) {
      const response = await fetchImpl('/api/model-copilot/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...request, action }),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isContextUpdate(payload) || payload.action !== action) {
        throw new Error(
          modelLabRuntimeErrorDetail(
            payload && typeof payload === 'object' && 'detail' in payload
              ? payload.detail
              : 'model_copilot_context_unavailable',
          ),
        );
      }
      return payload;
    },
    async answer(request, options) {
      const reportActivity = beginAiActivity('model-lab', options?.signal);
      try {
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
                throw new Error(modelLabRuntimeErrorDetail(record.detail));
              }
            }
            if (chunk.done) break;
          }
          if (!response.ok || !answer) throw new Error('model_copilot_llm_unavailable');
          reportActivity(
            answer.trace.some((line) => line.startsWith('Graph edit failed'))
              ? 'failed'
              : 'completed',
          );
          return answer;
        }
        const payload: unknown = await response.json();
        if (!response.ok || !isRuntimeAnswer(payload)) {
          throw new Error(
            modelLabRuntimeErrorDetail(
              payload && typeof payload === 'object' && 'detail' in payload
                ? payload.detail
                : undefined,
            ),
          );
        }
        reportActivity(
          payload.trace.some((line) => line.startsWith('Graph edit failed'))
            ? 'failed'
            : 'completed',
        );
        return payload;
      } finally {
        reportActivity('failed');
      }
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
