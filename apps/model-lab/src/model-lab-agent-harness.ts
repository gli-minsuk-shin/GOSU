import type { ModelLabQuestionRequest } from './model-lab-runtime-adapter';
import type { ModelConnection, ModelModule, ModelSpec } from './model-lab-schema';

export const MODEL_LAB_AGENT_MAX_STEPS = 6;
export const MODEL_LAB_AGENT_MAX_CALLS_PER_STEP = 3;
const MODEL_LAB_AGENT_MAX_RECEIPT_CHARACTERS = 60_000;

export const MODEL_LAB_AGENT_TOOL_NAMES = [
  'list_models',
  'inspect_model',
  'inspect_module',
  'trace_connections',
  'inspect_gradient',
  'compare_models',
] as const;

export type ModelLabAgentToolName = (typeof MODEL_LAB_AGENT_TOOL_NAMES)[number];

export const MODEL_LAB_AGENT_STEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'calls', 'answer'],
  properties: {
    kind: { type: 'string', enum: ['tool_calls', 'final'] },
    calls: {
      type: 'array',
      maxItems: MODEL_LAB_AGENT_MAX_CALLS_PER_STEP,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'argumentsJson'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 80 },
          name: { type: 'string', enum: MODEL_LAB_AGENT_TOOL_NAMES },
          argumentsJson: { type: 'string', minLength: 2, maxLength: 4_000 },
        },
      },
    },
    answer: { type: ['string', 'null'], maxLength: 24_000 },
  },
} as const;

export type ModelLabAgentProgress = Readonly<{
  step: number;
  phase: 'thinking' | 'tool_started' | 'tool_completed' | 'final';
  tool?: ModelLabAgentToolName;
  success?: boolean;
}>;

export type ModelLabAgentProviderResult = Readonly<{
  body: string;
  provider: string;
  model: string;
  reasoning: string;
  usage?: ModelLabAgentUsage;
}>;

export type ModelLabAgentUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  totalTokens: number;
}>;

export type ModelLabAgentProvider = (
  prompt: string,
  signal: AbortSignal,
  outputSchema: Readonly<Record<string, unknown>>,
) => Promise<ModelLabAgentProviderResult>;

type AgentStep = Readonly<{
  kind: 'tool_calls' | 'final';
  calls: readonly Readonly<{
    id: string;
    name: ModelLabAgentToolName;
    argumentsJson: string;
  }>[];
  answer: string | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStep(body: string): AgentStep {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error('model_lab_agent_step_invalid');
  }
  if (
    !isRecord(value) ||
    (value.kind !== 'tool_calls' && value.kind !== 'final') ||
    !Array.isArray(value.calls) ||
    value.calls.length > MODEL_LAB_AGENT_MAX_CALLS_PER_STEP ||
    (value.answer !== null && typeof value.answer !== 'string')
  ) {
    throw new Error('model_lab_agent_step_invalid');
  }
  const calls = value.calls.map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== 'string' ||
      !MODEL_LAB_AGENT_TOOL_NAMES.some((name) => name === candidate.name) ||
      typeof candidate.argumentsJson !== 'string'
    ) {
      throw new Error('model_lab_agent_step_invalid');
    }
    return {
      id: candidate.id.slice(0, 80),
      name: candidate.name as ModelLabAgentToolName,
      argumentsJson: candidate.argumentsJson,
    };
  });
  if (value.kind === 'final') {
    if (calls.length !== 0 || typeof value.answer !== 'string' || !value.answer.trim()) {
      throw new Error('model_lab_agent_final_invalid');
    }
  } else if (calls.length === 0 || value.answer !== null) {
    throw new Error('model_lab_agent_tool_calls_invalid');
  }
  return { kind: value.kind, calls, answer: value.answer };
}

function parseArguments(value: string) {
  if (value.length > 4_000) throw new Error('tool_arguments_too_large');
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) throw new Error('tool_arguments_invalid');
    return parsed;
  } catch {
    throw new Error('tool_arguments_invalid');
  }
}

function boundedReceipt(value: unknown) {
  const serialized = JSON.stringify(value);
  return serialized.length <= MODEL_LAB_AGENT_MAX_RECEIPT_CHARACTERS
    ? serialized
    : JSON.stringify({
        truncated: true,
        totalCharacters: serialized.length,
        excerpt: serialized.slice(0, MODEL_LAB_AGENT_MAX_RECEIPT_CHARACTERS),
      });
}

function stringArgument(arguments_: Record<string, unknown>, name: string, fallback?: string) {
  const value = arguments_[name];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > 160) {
    throw new Error(`tool_${name}_invalid`);
  }
  return value.trim();
}

function modelFor(request: ModelLabQuestionRequest, arguments_: Record<string, unknown>) {
  const modelId = stringArgument(arguments_, 'modelId', request.activeModelId);
  const model = request.projectModels.find((candidate) => candidate.id === modelId);
  if (!model) throw new Error('tool_model_not_found');
  return model;
}

function moduleFor(
  request: ModelLabQuestionRequest,
  model: ModelSpec,
  arguments_: Record<string, unknown>,
) {
  const moduleId = stringArgument(
    arguments_,
    'moduleId',
    model.id === request.activeModelId ? request.selectedModuleId : undefined,
  );
  const module = model.modules.find((candidate) => candidate.id === moduleId);
  if (!module) throw new Error('tool_module_not_found');
  return module;
}

function connectionReceipt(connection: ModelConnection, request: ModelLabQuestionRequest) {
  return {
    id: connection.id,
    source: connection.source,
    target: connection.target,
    tensorName: connection.tensorName,
    shape: connection.shape,
    expectedToCarryGradient: connection.expectedToCarryGradient,
    gradientState:
      connection.gradient.states[request.probe][request.checkpointIndex] ?? 'not-observed',
    gradientValue: Number.isFinite(
      connection.gradient[request.probe][request.checkpointIndex] ?? Number.NaN,
    )
      ? connection.gradient[request.probe][request.checkpointIndex]
      : null,
  };
}

function moduleReceipt(model: ModelSpec, module: ModelModule, request: ModelLabQuestionRequest) {
  return {
    modelId: model.id,
    module,
    incoming: model.connections
      .filter((connection) => connection.target === module.id)
      .map((connection) => connectionReceipt(connection, request)),
    outgoing: model.connections
      .filter((connection) => connection.source === module.id)
      .map((connection) => connectionReceipt(connection, request)),
    sourceArtifacts: model.sourceArtifacts,
  };
}

function traceConnections(
  model: ModelSpec,
  start: ModelModule,
  direction: 'upstream' | 'downstream',
  maxHops: number,
) {
  const visited = new Set([start.id]);
  let frontier = [start.id];
  const layers: { hop: number; modules: string[]; connections: string[] }[] = [];
  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop += 1) {
    const connections = model.connections.filter((connection) =>
      direction === 'upstream'
        ? frontier.includes(connection.target)
        : frontier.includes(connection.source),
    );
    const next = connections
      .map((connection) => (direction === 'upstream' ? connection.source : connection.target))
      .filter((moduleId) => !visited.has(moduleId));
    next.forEach((moduleId) => visited.add(moduleId));
    layers.push({
      hop,
      modules: next,
      connections: connections.map((connection) => connection.id),
    });
    frontier = next;
  }
  return { modelId: model.id, startModuleId: start.id, direction, layers };
}

export function executeModelLabAgentTool(
  request: ModelLabQuestionRequest,
  name: ModelLabAgentToolName,
  argumentsJson: string,
) {
  const arguments_ = parseArguments(argumentsJson);
  if (name === 'list_models') {
    return boundedReceipt(
      request.projectModels.map((model) => ({
        id: model.id,
        name: model.name,
        version: model.version,
        framework: model.framework,
        summary: model.summary,
        moduleCount: model.modules.length,
        parameterCount: model.modules.reduce((sum, module) => sum + module.parameterCount, 0),
      })),
    );
  }
  const model = modelFor(request, arguments_);
  if (name === 'inspect_model') {
    return boundedReceipt({
      id: model.id,
      name: model.name,
      version: model.version,
      framework: model.framework,
      summary: model.summary,
      intent: model.intent,
      modules: model.modules,
      connections: model.connections.map((connection) => connectionReceipt(connection, request)),
      sourceArtifacts: model.sourceArtifacts,
    });
  }
  if (name === 'compare_models') {
    const requestedIds = Array.isArray(arguments_.modelIds)
      ? arguments_.modelIds.filter((id): id is string => typeof id === 'string').slice(0, 5)
      : [model.id];
    const models = requestedIds.map((modelId) => {
      const candidate = request.projectModels.find((item) => item.id === modelId);
      if (!candidate) throw new Error('tool_model_not_found');
      return {
        id: candidate.id,
        name: candidate.name,
        version: candidate.version,
        summary: candidate.summary,
        intent: candidate.intent,
        moduleCount: candidate.modules.length,
        parameterCount: candidate.modules.reduce((sum, module) => sum + module.parameterCount, 0),
      };
    });
    return boundedReceipt(models);
  }
  const module = moduleFor(request, model, arguments_);
  if (name === 'inspect_module') return boundedReceipt(moduleReceipt(model, module, request));
  if (name === 'inspect_gradient') {
    return boundedReceipt({
      modelId: model.id,
      moduleId: module.id,
      probe: request.probe,
      checkpointIndex: request.checkpointIndex,
      incoming: model.connections
        .filter((connection) => connection.target === module.id)
        .map((connection) => connectionReceipt(connection, request)),
      outgoing: model.connections
        .filter((connection) => connection.source === module.id)
        .map((connection) => connectionReceipt(connection, request)),
      runtimeEvidence: model.gradientEvidence,
    });
  }
  const direction = arguments_.direction === 'upstream' ? 'upstream' : 'downstream';
  const requestedHops = arguments_.maxHops;
  const maxHops =
    typeof requestedHops === 'number' && Number.isInteger(requestedHops)
      ? Math.max(1, Math.min(6, requestedHops))
      : 4;
  return boundedReceipt(traceConnections(model, module, direction, maxHops));
}

const TOOL_INSTRUCTIONS = `AVAILABLE GOSU MODEL LAB TOOLS
- list_models({})
- inspect_model({"modelId":"..."})
- inspect_module({"modelId":"...","moduleId":"..."})
- trace_connections({"modelId":"...","moduleId":"...","direction":"upstream|downstream","maxHops":4})
- inspect_gradient({"modelId":"...","moduleId":"..."})
- compare_models({"modelId":"...","modelIds":["...","..."]})

Return kind=tool_calls when more evidence is required. Encode every tool argument object as JSON in argumentsJson. Return kind=final only after checking enough evidence. Never invent a tool receipt.`;

export async function runModelLabAgentHarness(input: {
  request: ModelLabQuestionRequest;
  seedPrompt: string;
  provider: ModelLabAgentProvider;
  signal: AbortSignal;
  onProgress?: (progress: ModelLabAgentProgress) => void;
}) {
  let transcript = `${input.seedPrompt}\n\n${TOOL_INSTRUCTIONS}`;
  const trace: string[] = [];
  let usage: ModelLabAgentUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    totalTokens: 0,
  };
  const receiptCache = new Map<string, string>();
  let lastProvider: ModelLabAgentProviderResult | null = null;
  for (let step = 1; step <= MODEL_LAB_AGENT_MAX_STEPS; step += 1) {
    if (input.signal.aborted) throw new Error('model_copilot_aborted');
    input.onProgress?.({ step, phase: 'thinking' });
    const providerResult = await input.provider(
      `${transcript}\n\nChoose the next bounded action or provide the final answer.`,
      input.signal,
      MODEL_LAB_AGENT_STEP_SCHEMA,
    );
    lastProvider = providerResult;
    if (providerResult.usage) {
      usage = {
        inputTokens: usage.inputTokens + providerResult.usage.inputTokens,
        outputTokens: usage.outputTokens + providerResult.usage.outputTokens,
        cachedReadTokens: usage.cachedReadTokens + providerResult.usage.cachedReadTokens,
        cachedWriteTokens: usage.cachedWriteTokens + providerResult.usage.cachedWriteTokens,
        totalTokens: usage.totalTokens + providerResult.usage.totalTokens,
      };
    }
    const decision = parseStep(providerResult.body);
    if (decision.kind === 'final') {
      input.onProgress?.({ step, phase: 'final' });
      trace.push(`Agent step ${step} · final`);
      return {
        body: decision.answer!.trim(),
        provider: providerResult.provider,
        model: providerResult.model,
        reasoning: providerResult.reasoning,
        usage,
        trace,
      };
    }
    const receipts: {
      id: string;
      name: ModelLabAgentToolName;
      success: boolean;
      receipt: string;
    }[] = [];
    for (const call of decision.calls) {
      if (input.signal.aborted) throw new Error('model_copilot_aborted');
      input.onProgress?.({ step, phase: 'tool_started', tool: call.name });
      const cacheKey = `${call.name}\u0000${call.argumentsJson}`;
      let success = true;
      let receipt = receiptCache.get(cacheKey);
      if (!receipt) {
        try {
          receipt = executeModelLabAgentTool(input.request, call.name, call.argumentsJson);
          receiptCache.set(cacheKey, receipt);
        } catch (error) {
          success = false;
          receipt = JSON.stringify({
            error: error instanceof Error ? error.message : 'model_lab_tool_failed',
          });
        }
      }
      input.onProgress?.({ step, phase: 'tool_completed', tool: call.name, success });
      trace.push(`Agent step ${step} · ${call.name} · ${success ? 'receipt' : 'failed'}`);
      receipts.push({ id: call.id, name: call.name, success, receipt });
    }
    transcript = `${transcript}\n\nAGENT TOOL REQUESTS\n${JSON.stringify(decision.calls)}\n\nGOSU TOOL RECEIPTS\n${JSON.stringify(receipts)}`;
  }
  if (lastProvider) throw new Error('model_copilot_agent_step_limit');
  throw new Error('model_copilot_agent_unavailable');
}
