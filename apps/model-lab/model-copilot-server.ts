import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import type { Plugin } from 'vite';
import type { ModelCatalog, ModelDescriptor } from '@gosu/contracts';
import type { ModelBuildArtifact } from './src/model-lab-builder';
import type {
  ModelLabModelSelection,
  ModelLabQuestionRequest,
} from './src/model-lab-runtime-adapter';
import { parseModelImportJson } from './src/model-lab-import';
import type { ModelSpec } from './src/model-lab-schema';
import type { GradientProbeName, ModelConnection } from './src/model-lab-schema';
import {
  runModelLabAgentHarness,
  type ModelLabAgentProgress,
  type ModelLabAgentUsage,
} from './src/model-lab-agent-harness';

const MAX_BUILDER_REQUEST_BYTES = 24 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_BUILDER_REQUEST_BYTES;
const MAX_OUTPUT_BYTES = 96 * 1024;
const CODEX_TIMEOUT_MS = 120_000;
export const MODEL_BUILDER_TIMEOUT_MS = 300_000;
export const MODEL_BUILDER_MAX_PDF_PAGES = 6;

export const MODEL_COPILOT_ENDPOINT = '/api/model-copilot';
export const MODEL_COPILOT_STATUS_ENDPOINT = '/api/model-copilot/status';
export const MODEL_COPILOT_MODELS_ENDPOINT = '/api/model-copilot/models';
export const MODEL_BUILDER_ENDPOINT = '/api/model-builder';
export const MODEL_COPILOT_MODEL = process.env.GOSU_MODEL_LAB_CODEX_MODEL ?? 'gpt-5.6-sol';
export const MODEL_COPILOT_REASONING = process.env.GOSU_MODEL_LAB_CODEX_REASONING ?? 'high';
export const MODEL_BUILDER_REASONING = process.env.GOSU_MODEL_LAB_BUILDER_REASONING ?? 'medium';
export const MODEL_LAB_CLAUDE_CODE_SONNET_ID = 'claude-code:sonnet';
export const MODEL_LAB_CLAUDE_CODE_OPUS_ID = 'claude-code:opus';
export const MODEL_LAB_CLAUDE_CODE_OPUS_5_ID = 'claude-code:opus-5';

const MODEL_LAB_CLAUDE_CODE_UPSTREAM_MODELS = {
  [MODEL_LAB_CLAUDE_CODE_SONNET_ID]: 'claude-sonnet-4-6',
  [MODEL_LAB_CLAUDE_CODE_OPUS_ID]: 'claude-opus-4-8',
  [MODEL_LAB_CLAUDE_CODE_OPUS_5_ID]: 'claude-opus-5',
} as const;
const MODEL_LAB_CLAUDE_CODE_MODEL_IDS = [
  MODEL_LAB_CLAUDE_CODE_SONNET_ID,
  MODEL_LAB_CLAUDE_CODE_OPUS_ID,
  MODEL_LAB_CLAUDE_CODE_OPUS_5_ID,
] as const;

export type CodexRunResult = Readonly<{
  body: string;
  provider: string;
  model: string;
  reasoning: string;
  usage?: ModelLabAgentUsage;
}>;

export type ModelCopilotInvocation = Readonly<{
  providerId: string;
  model: string;
  reasoning: string;
  imagePaths: readonly string[];
}>;

type CodexRunner = (
  prompt: string,
  signal: AbortSignal,
  invocation: ModelCopilotInvocation,
  options?: Readonly<{ outputSchema?: Readonly<Record<string, unknown>> }>,
) => Promise<CodexRunResult>;

export type ModelBuilderRunResult = Readonly<{
  model: ModelSpec;
  provider: string;
  modelName: string;
  reasoning: string;
  sourceKinds: readonly string[];
}>;

export type ModelBuilderRunner = (
  artifacts: readonly ModelBuildArtifact[],
  signal: AbortSignal,
  invocation: ModelCopilotInvocation,
) => Promise<ModelBuilderRunResult>;

type ModelBuilderCodexExecution = Readonly<{
  executable: string;
  args: readonly string[];
  prompt: string;
  timeoutMs: number;
  cwd: string;
}>;

export function modelBuilderCodexExecutionPlan(input: {
  executable: string;
  schemaPath: string;
  resultPath: string;
  imagePaths: readonly string[];
  prompt: string;
  cwd: string;
}): readonly ModelBuilderCodexExecution[] {
  return [
    {
      executable: input.executable,
      args: [
        'exec',
        '--ephemeral',
        '--ignore-user-config',
        '--sandbox',
        'read-only',
        '--ignore-rules',
        '--skip-git-repo-check',
        '--color',
        'never',
        '--model',
        MODEL_COPILOT_MODEL,
        '--config',
        `model_reasoning_effort="${MODEL_BUILDER_REASONING}"`,
        '--output-schema',
        input.schemaPath,
        '--output-last-message',
        input.resultPath,
        ...input.imagePaths.flatMap((imagePath) => ['--image', imagePath]),
        '-',
      ],
      prompt: input.prompt,
      timeoutMs: MODEL_BUILDER_TIMEOUT_MS,
      cwd: input.cwd,
    },
  ];
}

export function shouldAttachPdfRenders(extractedText: string) {
  const text = extractedText.replace(/\s+/g, ' ').trim();
  const lineCount = extractedText.split(/\r?\n/).filter((line) => line.trim()).length;
  const hasTensorShape = /\[[^\]]*[,×x][^\]]*\]/i.test(text);
  const hasArchitectureOperators =
    /(?:->|→|Linear\s*\(|RMSNorm\s*\(|soft-threshold|concat\s*\()/i.test(text);
  return !(text.length >= 200 && lineCount >= 6 && hasTensorShape && hasArchitectureOperators);
}

export function modelBuilderUserFacingError(code: string) {
  if (code === 'model_copilot_timeout') {
    return 'Model reconstruction did not finish within 5 minutes. Retry, or select a faster model/reasoning level after the GOSU adapter is connected.';
  }
  if (/^model_copilot_codex_exit_/.test(code)) {
    return 'Codex exited before producing a ModelIR result. The PDF was read successfully; retry the reconstruction or check the local Codex connection.';
  }
  if (code.startsWith('model_copilot_claude_') || code.startsWith('claude_code_')) {
    return 'Claude Code exited before producing a ModelIR result. Check that Claude Code is still signed in with a Claude.ai subscription, then retry.';
  }
  if (code.startsWith('model_builder_invalid_model_ir:')) {
    return `The selected model returned an invalid model graph. ${code.slice('model_builder_invalid_model_ir:'.length).trim()}`;
  }
  return code;
}

export function standaloneModelCopilotCatalog(
  fetchedAt = new Date().toISOString(),
  claudeCode?: Readonly<{ version: string; subscriptionType: string }>,
): ModelCatalog {
  const reasoningOptions = [MODEL_COPILOT_REASONING];
  const catalogVersion = createHash('sha256')
    .update(JSON.stringify({ model: MODEL_COPILOT_MODEL, reasoningOptions, claudeCode }))
    .digest('hex');
  return {
    schemaVersion: 1,
    providerId: 'codex',
    catalogVersion,
    fetchedAt,
    models: [
      {
        schemaVersion: 1,
        providerId: 'codex',
        modelId: MODEL_COPILOT_MODEL,
        displayName: MODEL_COPILOT_MODEL,
        catalogVersion,
        isDefault: true,
        modalities: ['text', 'image'],
        reasoningOptions: reasoningOptions.map((id) => ({
          id,
          label: id,
          isDefault: true,
        })),
        metadata: { source: 'standalone-model-lab-adapter' },
      },
      ...(claudeCode
        ? MODEL_LAB_CLAUDE_CODE_MODEL_IDS.map((modelId) => ({
            schemaVersion: 1 as const,
            providerId: 'claude-code',
            modelId,
            displayName:
              modelId === MODEL_LAB_CLAUDE_CODE_OPUS_5_ID
                ? 'Claude Code · Opus 5 (subscription)'
                : modelId === MODEL_LAB_CLAUDE_CODE_OPUS_ID
                  ? 'Claude Code · Opus 4.8 (subscription)'
                  : 'Claude Code · Sonnet 4.6 (subscription)',
            catalogVersion,
            isDefault: false,
            modalities: ['text', 'image'] as ('text' | 'image')[],
            reasoningOptions: ['low', 'medium', 'high', 'xhigh'].map((id) => ({
              id,
              label: id === 'xhigh' ? 'Extra high' : `${id[0]!.toUpperCase()}${id.slice(1)}`,
              isDefault: id === 'high',
            })),
            metadata: {
              source: 'local-claude-code-subscription',
              runtimeVersion: claudeCode.version,
              subscriptionType: claudeCode.subscriptionType,
              upstreamModelId: MODEL_LAB_CLAUDE_CODE_UPSTREAM_MODELS[modelId],
            },
          }))
        : []),
    ],
  };
}

export function resolveModelCopilotSelection(
  catalog: ModelCatalog,
  selection: ModelLabModelSelection | undefined,
): Readonly<{ descriptor: ModelDescriptor; reasoning: string }> {
  const descriptor = selection?.requestedModelId
    ? catalog.models.find((candidate) => candidate.modelId === selection.requestedModelId)
    : catalog.models.find((candidate) => candidate.isDefault);
  if (!descriptor) throw new Error('model_copilot_selected_model_unavailable');
  const reasoning = selection?.reasoningOptionId
    ? descriptor.reasoningOptions.find((candidate) => candidate.id === selection.reasoningOptionId)
        ?.id
    : descriptor.reasoningOptions.find((candidate) => candidate.isDefault)?.id;
  if (!reasoning) throw new Error('model_copilot_selected_reasoning_unavailable');
  return { descriptor, reasoning };
}

function activeGradientState(
  connection: ModelConnection,
  probe: GradientProbeName,
  checkpointIndex: number,
) {
  return connection.gradient.states[probe][checkpointIndex] ?? 'not-observed';
}

export function compactModelEvidence(request: ModelLabQuestionRequest) {
  const model = request.projectModels.find((candidate) => candidate.id === request.activeModelId);
  if (!model) throw new Error('model_copilot_active_model_missing');
  const selectedModule =
    model.modules.find((candidate) => candidate.id === request.selectedModuleId) ??
    model.modules[0];
  if (!selectedModule) throw new Error('model_copilot_selected_module_missing');

  return {
    activeModel: {
      id: model.id,
      name: model.name,
      version: model.version,
      framework: model.framework,
      summary: model.summary,
      intent: model.intent,
      sourceArtifacts: model.sourceArtifacts,
      modules: model.modules,
      connections: model.connections.map((connection) => ({
        id: connection.id,
        source: connection.source,
        target: connection.target,
        tensorName: connection.tensorName,
        shape: connection.shape,
        expectedToCarryGradient: connection.expectedToCarryGradient,
        activeGradientState: activeGradientState(
          connection,
          request.probe,
          request.checkpointIndex,
        ),
      })),
    },
    selectedModule,
    activeProbe: request.probe,
    checkpointIndex: request.checkpointIndex,
    relatedProjectModels: request.projectModels.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      version: candidate.version,
      summary: candidate.summary,
    })),
    recentConversation: request.conversation?.slice(-6) ?? [],
    question: request.question,
  };
}

export function modelAgentSeedEvidence(request: ModelLabQuestionRequest) {
  const evidence = compactModelEvidence(request);
  return {
    activeModel: {
      id: evidence.activeModel.id,
      name: evidence.activeModel.name,
      version: evidence.activeModel.version,
      framework: evidence.activeModel.framework,
      summary: evidence.activeModel.summary,
      intent: evidence.activeModel.intent,
      sourceArtifacts: evidence.activeModel.sourceArtifacts,
    },
    selectedModule: evidence.selectedModule,
    relatedProjectModels: evidence.relatedProjectModels,
    activeProbe: evidence.activeProbe,
    checkpointIndex: evidence.checkpointIndex,
    recentConversation: evidence.recentConversation,
    question: evidence.question,
  };
}

export function buildModelCopilotPrompt(
  request: ModelLabQuestionRequest,
  extractedDocumentText: Readonly<Record<string, string>> = {},
): string {
  const evidence = modelAgentSeedEvidence(request);
  const attachments = request.attachments ?? [];
  const textEvidence = attachments
    .filter((artifact) => artifact.kind === 'python' || artifact.kind === 'text')
    .map(
      (artifact) =>
        `ATTACHED ${artifact.kind.toUpperCase()} ${artifact.name}\n${artifact.content.slice(0, 300_000)}`,
    );
  const documentEvidence = Object.entries(extractedDocumentText).map(([name, content]) => {
    const kind = attachments.find((artifact) => artifact.name === name)?.kind;
    return `ATTACHED ${kind === 'docx' ? 'DOCX' : 'PDF'} TEXT ${name}\n${content.slice(0, 300_000)}`;
  });
  const imageNames = attachments
    .filter((artifact) => artifact.kind === 'image')
    .map((artifact) => artifact.name);
  return [
    'You are GOSU Model Copilot, an evidence-grounded neural-network architecture analyst.',
    'Answer in the language used by the user. Explain the computation, not merely the module name.',
    'Use only the bounded ModelIR seed, GOSU Model Lab tool receipts, and user-attached evidence supplied by the provider-neutral harness. Do not inspect any other files or invent missing runtime results.',
    'When a symbol such as lambda is asked about, trace exactly where it enters, how it is transformed, and what tensors it affects.',
    'Write readable Markdown. Put inline LaTeX in $...$ and display equations in $$...$$ so GOSU can render the mathematics; never use raw HTML.',
    'Distinguish a statically reconstructed code path from an observed runtime receipt. State uncertainty explicitly.',
    'Refer to module names and codeReference anchors when useful. Keep the answer concise but technically complete.',
    '',
    'BOUNDED MODEL SEED',
    JSON.stringify(evidence, null, 2),
    imageNames.length > 0 ? `ATTACHED IMAGES: ${imageNames.join(', ')}` : '',
    ...textEvidence,
    ...documentEvidence,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const tensorDimensionSchema = {
  anyOf: [
    { type: 'integer', minimum: 1 },
    { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]{0,15}$' },
  ],
} as const;

export const MODEL_IR_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'name',
    'version',
    'framework',
    'sourceLabel',
    'sourceArtifacts',
    'summary',
    'intent',
    'modules',
    'connections',
  ],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    id: { type: 'string', minLength: 1, maxLength: 120 },
    name: { type: 'string', minLength: 1, maxLength: 160 },
    version: { type: 'string', minLength: 1, maxLength: 120 },
    framework: {
      type: 'string',
      enum: ['PyTorch', 'ONNX', 'JAX', 'TensorFlow', 'design-only'],
    },
    sourceLabel: { type: 'string', minLength: 1, maxLength: 240 },
    sourceArtifacts: {
      type: 'array',
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'verified'],
        properties: {
          path: { type: 'string', minLength: 1, maxLength: 300 },
          verified: { type: 'boolean' },
        },
      },
    },
    summary: { type: 'string', minLength: 1, maxLength: 2_000 },
    intent: {
      type: 'object',
      additionalProperties: false,
      required: ['statement', 'invariants', 'expectedInput', 'expectedOutput'],
      properties: {
        statement: { type: 'string', minLength: 1, maxLength: 2_000 },
        invariants: {
          type: 'array',
          maxItems: 24,
          items: { type: 'string', minLength: 1, maxLength: 500 },
        },
        expectedInput: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: tensorDimensionSchema,
        },
        expectedOutput: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: tensorDimensionSchema,
        },
      },
    },
    modules: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'name',
          'kind',
          'group',
          'stage',
          'lane',
          'inputShape',
          'outputShape',
          'transform',
          'activation',
          'formula',
          'explanation',
          'parameterCount',
          'codeReference',
          'repeat',
          'block',
        ],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 120 },
          name: { type: 'string', minLength: 1, maxLength: 160 },
          kind: {
            type: 'string',
            enum: [
              'input',
              'linear',
              'normalization',
              'activation',
              'merge',
              'objective',
              'output',
            ],
          },
          group: { type: 'string', minLength: 1, maxLength: 160 },
          stage: { type: 'integer', minimum: 0, maximum: 200 },
          lane: { type: 'integer', minimum: -100, maximum: 100 },
          inputShape: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: tensorDimensionSchema,
          },
          outputShape: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: tensorDimensionSchema,
          },
          transform: { type: 'string', minLength: 1, maxLength: 2_000 },
          activation: { type: ['string', 'null'], maxLength: 160 },
          formula: { type: 'string', minLength: 1, maxLength: 2_000 },
          explanation: { type: 'string', minLength: 1, maxLength: 2_000 },
          parameterCount: { type: 'number', minimum: 0 },
          codeReference: { type: 'string', minLength: 1, maxLength: 300 },
          repeat: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['count', 'label'],
                properties: {
                  count: {
                    anyOf: [
                      { type: 'integer', minimum: 2, maximum: 128 },
                      {
                        type: 'string',
                        minLength: 1,
                        maxLength: 32,
                        pattern: '^[A-Za-z0-9_+\\-*/() ]+$',
                      },
                    ],
                  },
                  label: { type: 'string', minLength: 1, maxLength: 80 },
                },
              },
              { type: 'null' },
            ],
          },
          block: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'label', 'repeatCount'],
                properties: {
                  id: { type: 'string', minLength: 1, maxLength: 120 },
                  label: { type: 'string', minLength: 1, maxLength: 120 },
                  repeatCount: {
                    anyOf: [
                      { type: 'integer', minimum: 2, maximum: 128 },
                      {
                        type: 'string',
                        minLength: 1,
                        maxLength: 32,
                        pattern: '^[A-Za-z0-9_+\\-*/() ]+$',
                      },
                    ],
                  },
                },
              },
              { type: 'null' },
            ],
          },
        },
      },
    },
    connections: {
      type: 'array',
      maxItems: 400,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'source',
          'target',
          'tensorName',
          'shape',
          'activationNorm',
          'expectedToCarryGradient',
        ],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 120 },
          source: { type: 'string', minLength: 1, maxLength: 120 },
          target: { type: 'string', minLength: 1, maxLength: 120 },
          tensorName: { type: 'string', minLength: 1, maxLength: 120 },
          shape: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: tensorDimensionSchema,
          },
          activationNorm: { type: 'number', minimum: 0 },
          expectedToCarryGradient: { type: 'boolean' },
        },
      },
    },
  },
} as const;

export function buildModelBuilderPrompt(
  artifacts: readonly Pick<ModelBuildArtifact, 'name' | 'kind' | 'content'>[],
  extractedDocumentText: Readonly<Record<string, string>> = {},
): string {
  const textEvidence = artifacts
    .filter((artifact) => artifact.kind === 'python' || artifact.kind === 'text')
    .map(
      (artifact) =>
        `SOURCE ${artifact.name} (${artifact.kind})\n${artifact.content.slice(0, 300_000)}`,
    );
  const documentEvidence = Object.entries(extractedDocumentText).map(([name, content]) => {
    const kind = artifacts.find((artifact) => artifact.name === name)?.kind;
    return `${kind === 'docx' ? 'DOCX TEXT' : 'PDF TEXT'} ${name}\n${content.slice(0, 300_000)}`;
  });
  const imageNames = artifacts
    .filter((artifact) => artifact.kind === 'image')
    .map((artifact) => artifact.name);
  return [
    'You are GOSU Model Builder, a static neural-network architecture reconstruction agent.',
    'Create one complete ModelIR v1 JSON object from the supplied Python, diagram image, PDF, DOCX, Markdown, or text evidence.',
    'For Python, inspect class/module construction and forward dataflow statically. Never execute uploaded code.',
    'For diagrams, read every visible module, tensor dimension, branch, merge, activation, normalization, and conditional injection such as FiLM.',
    `For PDFs, use the extracted bounded text and, only when that text is insufficient to recover the architecture, attached renders of at most the first ${MODEL_BUILDER_MAX_PDF_PAGES} pages.`,
    'For DOCX, reconstruct from the extracted bounded paragraphs and table-cell text; treat prose descriptions as design intent, not runtime evidence.',
    'Represent the actual computational modules and use groups and lanes for branches.',
    'When a loop, Sequential, ModuleList, or explicit depth repeats a multi-module computation, keep the modules for one iteration and give every module in that iteration the exact same block={id,label,repeatCount}. Use an integer repeatCount when known or a short symbolic expression such as L-1 when the depth is symbolic. The UI will collapse those members into one stacked block and reveal the internal modules only after the block is opened.',
    'Use repeat={count,label} only when one indivisible module is repeated and there are no meaningful internal modules to expose. Never draw repeated iterations as a top-level arrow chain.',
    'Use LaTeX-compatible formula strings without dollar delimiters. Explain each transform and its tensor effects.',
    'Set parameterCount to 0 when it cannot be derived. Never invent runtime values, training results, or gradient measurements.',
    'Set expectedToCarryGradient=false only for intentionally non-differentiable edges. Imported gradients remain unobserved in GOSU until a runtime receipt exists.',
    'Use codeReference anchors with filename and line range for code, page/figure for PDF, paragraph/table for DOCX, or region labels for images.',
    'Use framework=design-only when the source does not establish a framework.',
    'Return only the ModelIR object required by the output schema.',
    '',
    `SUPPLIED ARTIFACTS: ${artifacts.map((artifact) => `${artifact.name} (${artifact.kind})`).join(', ')}`,
    imageNames.length > 0 ? `ATTACHED DIAGRAM IMAGES: ${imageNames.join(', ')}` : '',
    ...textEvidence,
    ...documentEvidence,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function collectChild(
  executable: string,
  args: readonly string[],
  stdin: string | null,
  signal: AbortSignal,
  timeoutMs: number,
  cwd = process.cwd(),
  maxOutputBytes = MAX_OUTPUT_BYTES,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Readonly<{ stdout: string; stderr: string }>> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd,
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => {
      child.kill('SIGTERM');
      finish(() => reject(new Error('model_copilot_aborted')));
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish(() => reject(new Error('model_copilot_timeout')));
    }, timeoutMs);
    signal.addEventListener('abort', abort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > maxOutputBytes) {
        child.kill('SIGTERM');
        finish(() => reject(new Error('model_copilot_output_too_large')));
        return;
      }
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_384);
    });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`model_copilot_codex_exit_${code ?? 'unknown'}`));
      });
    });
    if (stdin === null) child.stdin.end();
    else child.stdin.end(stdin);
  });
}

function claudeSubscriptionEnvironment() {
  const environment = { ...process.env };
  for (const key of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
  ]) {
    delete environment[key];
  }
  return environment;
}

async function resolveClaudeExecutable() {
  const configured = process.env.GOSU_MODEL_LAB_CLAUDE_BIN?.trim();
  if (configured) return configured;
  const knownLocation = join(homedir(), '.local', 'bin', 'claude');
  try {
    await access(knownLocation);
    return knownLocation;
  } catch {
    return 'claude';
  }
}

function parseClaudeSubscriptionStatus(stdout: string) {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = value as Record<string, unknown>;
  if (
    status.loggedIn !== true ||
    status.authMethod !== 'claude.ai' ||
    status.apiProvider !== 'firstParty' ||
    typeof status.subscriptionType !== 'string' ||
    !status.subscriptionType.trim()
  ) {
    return null;
  }
  return status.subscriptionType.trim().slice(0, 64);
}

let claudeCodeStatusCache:
  | Readonly<{
      expiresAt: number;
      value: Readonly<{ version: string; subscriptionType: string }> | null;
    }>
  | undefined;
let claudeCodeStatusInFlight:
  Promise<Readonly<{ version: string; subscriptionType: string }> | null> | undefined;

async function detectClaudeCodeSubscriptionStatus() {
  const controller = new AbortController();
  const executable = await resolveClaudeExecutable();
  const environment = claudeSubscriptionEnvironment();
  try {
    const [version, auth] = await Promise.all([
      collectChild(
        executable,
        ['--version'],
        null,
        controller.signal,
        5_000,
        process.cwd(),
        16_384,
        environment,
      ),
      collectChild(
        executable,
        ['auth', 'status', '--json'],
        null,
        controller.signal,
        5_000,
        process.cwd(),
        16_384,
        environment,
      ),
    ]);
    const subscriptionType = parseClaudeSubscriptionStatus(auth.stdout);
    const runtimeVersion = version.stdout.trim().slice(0, 64);
    return subscriptionType && runtimeVersion
      ? { version: runtimeVersion, subscriptionType }
      : null;
  } catch {
    return null;
  }
}

export function claudeCodeSubscriptionStatus() {
  const cached = claudeCodeStatusCache;
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (claudeCodeStatusInFlight) return claudeCodeStatusInFlight;
  claudeCodeStatusInFlight = detectClaudeCodeSubscriptionStatus().then((value) => {
    claudeCodeStatusCache = { expiresAt: Date.now() + 10_000, value };
    return value;
  });
  void claudeCodeStatusInFlight.finally(() => {
    claudeCodeStatusInFlight = undefined;
  });
  return claudeCodeStatusInFlight;
}

export async function connectedModelCopilotCatalog(fetchedAt = new Date().toISOString()) {
  return standaloneModelCopilotCatalog(
    fetchedAt,
    (await claudeCodeSubscriptionStatus()) ?? undefined,
  );
}

function claudeUpstreamModelId(modelId: string) {
  if (modelId in MODEL_LAB_CLAUDE_CODE_UPSTREAM_MODELS) {
    return MODEL_LAB_CLAUDE_CODE_UPSTREAM_MODELS[
      modelId as keyof typeof MODEL_LAB_CLAUDE_CODE_UPSTREAM_MODELS
    ];
  }
  throw new Error('model_copilot_claude_model_invalid');
}

function parseClaudePrintResult(stdout: string) {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error('model_copilot_claude_result_invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('model_copilot_claude_result_invalid');
  }
  const result = value as Record<string, unknown>;
  if (result.is_error === true) throw new Error('model_copilot_claude_result_error');
  return result;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function claudeUsage(value: unknown): ModelLabAgentUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  const directInput = nonNegativeInteger(usage.input_tokens);
  const cachedReadTokens = nonNegativeInteger(usage.cache_read_input_tokens);
  const cachedWriteTokens = nonNegativeInteger(usage.cache_creation_input_tokens);
  const outputTokens = nonNegativeInteger(usage.output_tokens);
  const inputTokens = directInput + cachedReadTokens + cachedWriteTokens;
  return {
    inputTokens,
    outputTokens,
    cachedReadTokens,
    cachedWriteTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function codexExecUsage(stdout: string): ModelLabAgentUsage | undefined {
  for (const line of stdout.trim().split(/\r?\n/u).reverse()) {
    try {
      const event = JSON.parse(line) as unknown;
      if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
      const record = event as Record<string, unknown>;
      if (record.type !== 'turn.completed' || !record.usage || typeof record.usage !== 'object') {
        continue;
      }
      const usage = record.usage as Record<string, unknown>;
      const inputTokens = nonNegativeInteger(usage.input_tokens);
      const outputTokens = nonNegativeInteger(usage.output_tokens);
      const cachedReadTokens = nonNegativeInteger(usage.cached_input_tokens);
      const cachedWriteTokens = nonNegativeInteger(usage.cache_write_input_tokens);
      return {
        inputTokens,
        outputTokens,
        cachedReadTokens,
        cachedWriteTokens,
        totalTokens: inputTokens + outputTokens,
      };
    } catch {
      // Supported Codex builds keep diagnostics on stderr; ignore unexpected stdout lines.
    }
  }
  return undefined;
}

export const runClaudeCodeModelCopilot: CodexRunner = async (
  prompt,
  signal,
  invocation,
  options,
) => {
  const executable = await resolveClaudeExecutable();
  const imagePrompt =
    invocation.imagePaths.length > 0
      ? `\n\nThe user explicitly attached these temporary image files. Use Read only to inspect them:\n${invocation.imagePaths.join('\n')}`
      : '';
  const readTools = invocation.imagePaths.length > 0 ? 'Read' : '';
  const { stdout } = await collectChild(
    executable,
    [
      '-p',
      '--output-format',
      'json',
      '--model',
      claudeUpstreamModelId(invocation.model),
      '--effort',
      invocation.reasoning,
      '--permission-mode',
      'dontAsk',
      '--tools',
      readTools,
      ...(readTools ? ['--allowedTools', readTools] : []),
      '--safe-mode',
      '--no-chrome',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--no-session-persistence',
      ...(options?.outputSchema ? ['--json-schema', JSON.stringify(options.outputSchema)] : []),
    ],
    `${prompt}${imagePrompt}`,
    signal,
    CODEX_TIMEOUT_MS,
    process.cwd(),
    MAX_OUTPUT_BYTES,
    claudeSubscriptionEnvironment(),
  );
  const result = parseClaudePrintResult(stdout);
  const candidate = options?.outputSchema ? result.structured_output : result.result;
  const body =
    typeof candidate === 'string'
      ? candidate.trim()
      : candidate && typeof candidate === 'object'
        ? JSON.stringify(candidate)
        : '';
  if (!body) {
    throw new Error('model_copilot_empty_response');
  }
  const usage = claudeUsage(result.usage);
  return {
    body,
    provider: 'Claude Code subscription',
    model: invocation.model,
    reasoning: invocation.reasoning,
    ...(usage ? { usage } : {}),
  };
};

export const runSelectedModelCopilot: CodexRunner = (prompt, signal, invocation, options) =>
  invocation.providerId === 'claude-code'
    ? runClaudeCodeModelCopilot(prompt, signal, invocation, options)
    : runCodexModelCopilot(prompt, signal, invocation, options);

export const runCodexModelCopilot: CodexRunner = async (prompt, signal, invocation, options) => {
  const executable = process.env.GOSU_MODEL_LAB_CODEX_BIN ?? 'codex';
  const directory = options?.outputSchema
    ? await mkdtemp(join(tmpdir(), 'gosu-model-agent-'))
    : null;
  try {
    const schemaPath = directory ? join(directory, 'step-schema.json') : null;
    const resultPath = directory ? join(directory, 'step-result.json') : null;
    if (schemaPath && options?.outputSchema) {
      await writeFile(schemaPath, JSON.stringify(options.outputSchema), { mode: 0o600 });
    }
    const { stdout } = await collectChild(
      executable,
      [
        'exec',
        '--ephemeral',
        '--ignore-user-config',
        '--sandbox',
        'read-only',
        '--ignore-rules',
        '--skip-git-repo-check',
        '--color',
        'never',
        ...(options?.outputSchema ? ['--json'] : []),
        '--model',
        invocation.model,
        '--config',
        `model_reasoning_effort="${invocation.reasoning}"`,
        ...(schemaPath && resultPath
          ? ['--output-schema', schemaPath, '--output-last-message', resultPath]
          : []),
        ...invocation.imagePaths.flatMap((imagePath) => ['--image', imagePath]),
        '-',
      ],
      prompt,
      signal,
      CODEX_TIMEOUT_MS,
    );
    const body = resultPath ? (await readFile(resultPath, 'utf8')).trim() : stdout.trim();
    if (!body) throw new Error('model_copilot_empty_response');
    const usage = codexExecUsage(stdout);
    return {
      body,
      provider: 'Codex CLI',
      model: invocation.model,
      reasoning: invocation.reasoning,
      ...(usage ? { usage } : {}),
    };
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
};

function safeArtifactName(name: string, index: number) {
  const fileName = basename(name)
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 160);
  return `${String(index + 1).padStart(2, '0')}-${fileName || 'artifact'}`;
}

export function pdfPageRenderArguments(filePath: string, outputPrefix: string) {
  return [
    '-f',
    '1',
    '-l',
    String(MODEL_BUILDER_MAX_PDF_PAGES),
    '-r',
    '120',
    '-png',
    filePath,
    outputPrefix,
  ];
}

function decodeXmlEntities(text: string) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, value: string) =>
      String.fromCodePoint(Number.parseInt(value, 16)),
    )
    .replace(/&#([0-9]+);/g, (_match, value: string) =>
      String.fromCodePoint(Number.parseInt(value, 10)),
    )
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

export function extractDocxText(documentXml: string) {
  return decodeXmlEntities(
    documentXml
      .replace(/<w:tab\b[^>]*\/>/gi, '\t')
      .replace(/<w:br\b[^>]*\/>/gi, '\n')
      .replace(/<\/w:tc>/gi, '\t')
      .replace(/<\/w:(?:p|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeArtifact(artifact: ModelBuildArtifact) {
  if (artifact.encoding === 'utf8') return Buffer.from(artifact.content, 'utf8');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(artifact.content)) {
    throw new Error('model_builder_invalid_base64');
  }
  return Buffer.from(artifact.content, 'base64');
}

function validatedArtifactArray(
  artifacts: unknown,
  errorPrefix: 'model_builder' | 'model_copilot',
  minimum: number,
  maximum: number,
): readonly ModelBuildArtifact[] {
  if (!Array.isArray(artifacts) || artifacts.length < minimum || artifacts.length > maximum) {
    throw new Error(`${errorPrefix}_artifact_count_invalid`);
  }
  return artifacts.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error(`${errorPrefix}_artifact_${index}_invalid`);
    }
    const artifact = candidate as Partial<ModelBuildArtifact>;
    if (
      typeof artifact.name !== 'string' ||
      artifact.name.length === 0 ||
      artifact.name.length > 240 ||
      typeof artifact.mediaType !== 'string' ||
      artifact.mediaType.length > 120 ||
      !['python', 'text', 'image', 'pdf', 'docx'].includes(artifact.kind ?? '') ||
      !['utf8', 'base64'].includes(artifact.encoding ?? '') ||
      typeof artifact.content !== 'string'
    ) {
      throw new Error(`${errorPrefix}_artifact_${index}_invalid`);
    }
    if (
      (artifact.kind === 'python' || artifact.kind === 'text') !==
      (artifact.encoding === 'utf8')
    ) {
      throw new Error(`${errorPrefix}_artifact_${index}_encoding_invalid`);
    }
    const bytes = Buffer.byteLength(
      artifact.content,
      artifact.encoding === 'utf8' ? 'utf8' : 'base64',
    );
    const limit = artifact.encoding === 'utf8' ? 1_000_000 : 8_000_000;
    if (bytes === 0 || bytes > limit) {
      throw new Error(`${errorPrefix}_artifact_${index}_size_invalid`);
    }
    return artifact as ModelBuildArtifact;
  });
}

function validatedBuilderArtifacts(value: unknown): readonly ModelBuildArtifact[] {
  if (!value || typeof value !== 'object' || !('artifacts' in value)) {
    throw new Error('model_builder_artifacts_missing');
  }
  return validatedArtifactArray(
    (value as { artifacts?: unknown }).artifacts,
    'model_builder',
    1,
    8,
  );
}

function validatedCopilotAttachments(value: unknown): readonly ModelBuildArtifact[] {
  return validatedArtifactArray(value ?? [], 'model_copilot', 0, 6);
}

async function withPreparedCopilotAttachments<T>(
  artifacts: readonly ModelBuildArtifact[],
  signal: AbortSignal,
  run: (
    extractedDocumentText: Readonly<Record<string, string>>,
    imagePaths: readonly string[],
  ) => Promise<T>,
): Promise<T> {
  if (artifacts.every((artifact) => artifact.kind === 'python' || artifact.kind === 'text')) {
    return run({}, []);
  }
  const directory = await mkdtemp(join(tmpdir(), 'gosu-model-copilot-'));
  try {
    const extractedDocumentText: Record<string, string> = {};
    const imagePaths: string[] = [];
    for (const [index, artifact] of artifacts.entries()) {
      if (artifact.kind !== 'image' && artifact.kind !== 'pdf' && artifact.kind !== 'docx') {
        continue;
      }
      const filePath = join(directory, safeArtifactName(artifact.name, index));
      const bytes = decodeArtifact(artifact);
      if (artifact.kind === 'pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new Error('model_copilot_invalid_pdf');
      }
      if (artifact.kind === 'docx' && !bytes.subarray(0, 2).equals(Buffer.from('PK'))) {
        throw new Error('model_copilot_invalid_docx');
      }
      await writeFile(filePath, bytes);
      if (artifact.kind === 'image') {
        if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extname(filePath).toLowerCase())) {
          throw new Error('model_copilot_unsupported_image');
        }
        imagePaths.push(filePath);
      } else if (artifact.kind === 'pdf') {
        const extracted = await collectChild(
          process.env.GOSU_MODEL_LAB_PDFTOTEXT_BIN ?? 'pdftotext',
          ['-f', '1', '-l', '40', filePath, '-'],
          null,
          signal,
          20_000,
          directory,
        );
        extractedDocumentText[artifact.name] = extracted.stdout;
        if (shouldAttachPdfRenders(extracted.stdout)) {
          const pagePrefix = join(directory, `pdf-${index + 1}-page`);
          await collectChild(
            process.env.GOSU_MODEL_LAB_PDFTOPPM_BIN ?? 'pdftoppm',
            pdfPageRenderArguments(filePath, pagePrefix),
            null,
            signal,
            30_000,
            directory,
          );
          const renderedPageNames = (await readdir(directory))
            .filter((name) => name.startsWith(`pdf-${index + 1}-page-`) && name.endsWith('.png'))
            .sort();
          imagePaths.push(...renderedPageNames.map((name) => join(directory, name)));
        }
      } else {
        const extracted = await collectChild(
          process.env.GOSU_MODEL_LAB_UNZIP_BIN ?? 'unzip',
          ['-p', filePath, 'word/document.xml'],
          null,
          signal,
          20_000,
          directory,
          512 * 1024,
        );
        const documentText = extractDocxText(extracted.stdout);
        if (!documentText) throw new Error('model_copilot_empty_docx');
        extractedDocumentText[artifact.name] = documentText;
      }
    }
    return await run(extractedDocumentText, imagePaths);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export const runCodexModelBuilder: ModelBuilderRunner = async (artifacts, signal, invocation) => {
  const directory = await mkdtemp(join(tmpdir(), 'gosu-model-builder-'));
  try {
    const extractedDocumentText: Record<string, string> = {};
    const imagePaths: string[] = [];
    for (const [index, artifact] of artifacts.entries()) {
      if (artifact.kind !== 'image' && artifact.kind !== 'pdf' && artifact.kind !== 'docx') {
        continue;
      }
      const filePath = join(directory, safeArtifactName(artifact.name, index));
      const bytes = decodeArtifact(artifact);
      if (artifact.kind === 'pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new Error('model_builder_invalid_pdf');
      }
      if (artifact.kind === 'docx' && !bytes.subarray(0, 2).equals(Buffer.from('PK'))) {
        throw new Error('model_builder_invalid_docx');
      }
      await writeFile(filePath, bytes);
      if (artifact.kind === 'image') {
        if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extname(filePath).toLowerCase())) {
          throw new Error('model_builder_unsupported_image');
        }
        imagePaths.push(filePath);
      } else if (artifact.kind === 'pdf') {
        const extracted = await collectChild(
          process.env.GOSU_MODEL_LAB_PDFTOTEXT_BIN ?? 'pdftotext',
          ['-f', '1', '-l', '40', filePath, '-'],
          null,
          signal,
          20_000,
          directory,
        );
        extractedDocumentText[artifact.name] = extracted.stdout;
        if (shouldAttachPdfRenders(extracted.stdout)) {
          const pagePrefix = join(directory, `pdf-${index + 1}-page`);
          await collectChild(
            process.env.GOSU_MODEL_LAB_PDFTOPPM_BIN ?? 'pdftoppm',
            pdfPageRenderArguments(filePath, pagePrefix),
            null,
            signal,
            30_000,
            directory,
          );
          const renderedPageNames = (await readdir(directory))
            .filter((name) => name.startsWith(`pdf-${index + 1}-page-`) && name.endsWith('.png'))
            .sort();
          imagePaths.push(...renderedPageNames.map((name) => join(directory, name)));
        }
      } else {
        const extracted = await collectChild(
          process.env.GOSU_MODEL_LAB_UNZIP_BIN ?? 'unzip',
          ['-p', filePath, 'word/document.xml'],
          null,
          signal,
          20_000,
          directory,
          512 * 1024,
        );
        const documentText = extractDocxText(extracted.stdout);
        if (!documentText) throw new Error('model_builder_empty_docx');
        extractedDocumentText[artifact.name] = documentText;
      }
    }

    const prompt = buildModelBuilderPrompt(artifacts, extractedDocumentText);
    let resultText: string;
    let provider: string;
    if (invocation.providerId === 'claude-code') {
      const readTools = imagePaths.length > 0 ? 'Read' : '';
      const imagePrompt =
        imagePaths.length > 0
          ? `\n\nThe user explicitly attached these temporary diagram renders. Use Read only to inspect them:\n${imagePaths.join('\n')}`
          : '';
      const result = await collectChild(
        await resolveClaudeExecutable(),
        [
          '-p',
          '--output-format',
          'json',
          '--model',
          claudeUpstreamModelId(invocation.model),
          '--effort',
          invocation.reasoning,
          '--permission-mode',
          'dontAsk',
          '--tools',
          readTools,
          ...(readTools ? ['--allowedTools', readTools] : []),
          '--safe-mode',
          '--no-chrome',
          '--strict-mcp-config',
          '--mcp-config',
          '{"mcpServers":{}}',
          '--no-session-persistence',
          '--json-schema',
          JSON.stringify(MODEL_IR_OUTPUT_SCHEMA),
        ],
        `${prompt}${imagePrompt}`,
        signal,
        MODEL_BUILDER_TIMEOUT_MS,
        directory,
        MAX_OUTPUT_BYTES,
        claudeSubscriptionEnvironment(),
      );
      const parsedResult = parseClaudePrintResult(result.stdout);
      const structured = parsedResult.structured_output ?? parsedResult.result;
      resultText = typeof structured === 'string' ? structured : JSON.stringify(structured);
      provider = 'Claude Code subscription';
    } else {
      const schemaPath = join(directory, 'model-ir-schema.json');
      const resultPath = join(directory, 'model-ir-result.json');
      await writeFile(schemaPath, JSON.stringify(MODEL_IR_OUTPUT_SCHEMA));
      const executable = process.env.GOSU_MODEL_LAB_CODEX_BIN ?? 'codex';
      const [execution] = modelBuilderCodexExecutionPlan({
        executable,
        schemaPath,
        resultPath,
        imagePaths,
        prompt,
        cwd: directory,
      });
      if (!execution) throw new Error('model_builder_execution_plan_empty');
      await collectChild(
        execution.executable,
        execution.args,
        execution.prompt,
        signal,
        execution.timeoutMs,
        execution.cwd,
      );
      resultText = await readFile(resultPath, 'utf8');
      provider = 'Codex CLI';
    }
    const parsed = parseModelImportJson(resultText);
    if (!parsed.ok) throw new Error(`model_builder_invalid_model_ir: ${parsed.reason}`);
    return {
      model: parsed.model,
      provider,
      modelName: invocation.model,
      reasoning: invocation.reasoning,
      sourceKinds: [...new Set(artifacts.map((artifact) => artifact.kind))],
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

async function codexProviderStatus() {
  const controller = new AbortController();
  const executable = process.env.GOSU_MODEL_LAB_CODEX_BIN ?? 'codex';
  try {
    const result = await collectChild(executable, ['--version'], null, controller.signal, 3_000);
    return {
      available: result.stdout.trim().startsWith('codex-cli '),
      provider: result.stdout.trim() || 'Codex CLI',
      model: MODEL_COPILOT_MODEL,
      reasoning: MODEL_COPILOT_REASONING,
    };
  } catch {
    return {
      available: false,
      provider: 'Codex CLI unavailable',
      model: MODEL_COPILOT_MODEL,
      reasoning: MODEL_COPILOT_REASONING,
    };
  }
}

async function modelCopilotProviderStatus() {
  const [codexStatus, claudeCode] = await Promise.all([
    codexProviderStatus(),
    claudeCodeSubscriptionStatus(),
  ]);
  if (!claudeCode) return codexStatus;
  return {
    available: true,
    provider: codexStatus.available
      ? `Codex CLI + Claude Code ${claudeCode.subscriptionType}`
      : `Claude Code ${claudeCode.subscriptionType}`,
    model: MODEL_COPILOT_MODEL,
    reasoning: MODEL_COPILOT_REASONING,
  };
}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes = MAX_REQUEST_BYTES,
): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        reject(new Error('model_copilot_request_too_large'));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('model_copilot_invalid_json'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
}

function beginNdjson(response: ServerResponse) {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendNdjson(response: ServerResponse, value: unknown) {
  if (response.destroyed || response.writableEnded) return false;
  return response.write(`${JSON.stringify(value)}\n`);
}

export function createModelCopilotPlugin(
  runner: CodexRunner = runSelectedModelCopilot,
  builder: ModelBuilderRunner = runCodexModelBuilder,
): Plugin {
  return {
    name: 'gosu-model-copilot',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = request.url?.split('?')[0];
        if (url === MODEL_COPILOT_STATUS_ENDPOINT && request.method === 'GET') {
          sendJson(response, 200, await modelCopilotProviderStatus());
          return;
        }
        if (url === MODEL_COPILOT_MODELS_ENDPOINT && request.method === 'GET') {
          sendJson(response, 200, await connectedModelCopilotCatalog());
          return;
        }
        if (url === MODEL_BUILDER_ENDPOINT) {
          if (request.method !== 'POST') {
            sendJson(response, 405, { error: 'method_not_allowed' });
            return;
          }
          const controller = new AbortController();
          request.once('aborted', () => controller.abort());
          response.once('close', () => {
            if (!response.writableEnded) controller.abort();
          });
          try {
            const payload = await readJsonBody(request, MAX_BUILDER_REQUEST_BYTES);
            const artifacts = validatedBuilderArtifacts(payload);
            const selection =
              payload && typeof payload === 'object' && 'selection' in payload
                ? ((payload as { selection?: ModelLabModelSelection }).selection ?? undefined)
                : undefined;
            const selected = resolveModelCopilotSelection(
              await connectedModelCopilotCatalog(),
              selection,
            );
            const result = await builder(artifacts, controller.signal, {
              providerId: selected.descriptor.providerId,
              model: selected.descriptor.modelId,
              reasoning:
                selection?.reasoningOptionId ??
                (selected.descriptor.providerId === 'codex'
                  ? MODEL_BUILDER_REASONING
                  : selected.reasoning),
              imagePaths: [],
            });
            sendJson(response, 200, {
              model: result.model,
              trace: [
                `${result.provider} · ${result.modelName}`,
                `Reasoning ${result.reasoning}`,
                `Static reconstruction · ${result.sourceKinds.join(' + ')}`,
                `${result.model.modules.length} modules · ${result.model.connections.length} connections`,
                'Runtime gradients not observed',
              ],
            });
          } catch (error) {
            const code = error instanceof Error ? error.message : 'model_builder_unknown_error';
            sendJson(
              response,
              code.includes('artifact_') || code.includes('request_') ? 400 : 503,
              {
                error: 'model_builder_unavailable',
                detail: modelBuilderUserFacingError(code),
              },
            );
          }
          return;
        }
        if (url !== MODEL_COPILOT_ENDPOINT) {
          next();
          return;
        }
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'method_not_allowed' });
          return;
        }

        const controller = new AbortController();
        request.once('aborted', () => controller.abort());
        response.once('close', () => {
          if (!response.writableEnded) controller.abort();
        });
        const streamProgress = request.headers.accept?.includes('application/x-ndjson') === true;
        if (streamProgress) beginNdjson(response);
        try {
          const rawPayload = await readJsonBody(request);
          if (!rawPayload || typeof rawPayload !== 'object') {
            throw new Error('model_copilot_request_invalid');
          }
          const rawRequest = rawPayload as ModelLabQuestionRequest;
          const attachments = validatedCopilotAttachments(rawRequest.attachments);
          const payload: ModelLabQuestionRequest = { ...rawRequest, attachments };
          const selected = resolveModelCopilotSelection(
            await connectedModelCopilotCatalog(),
            payload.selection,
          );
          const result = await withPreparedCopilotAttachments(
            attachments,
            controller.signal,
            async (extractedDocumentText, imagePaths) => {
              const invocation = {
                providerId: selected.descriptor.providerId,
                model: selected.descriptor.modelId,
                reasoning: selected.reasoning,
                imagePaths,
              };
              const progress: ModelLabAgentProgress[] = [];
              return runModelLabAgentHarness({
                request: payload,
                seedPrompt: buildModelCopilotPrompt(payload, extractedDocumentText),
                signal: controller.signal,
                onProgress: (event) => {
                  progress.push(event);
                  if (streamProgress) sendNdjson(response, { type: 'progress', progress: event });
                },
                provider: (prompt, signal, outputSchema) =>
                  runner(prompt, signal, invocation, { outputSchema }),
              }).then((agentResult) => ({ ...agentResult, progress }));
            },
          );
          const answer = {
            body: result.body,
            usage: result.usage,
            trace: [
              `${result.provider} · ${result.model}`,
              `Reasoning ${result.reasoning}`,
              'Provider-neutral GOSU agent harness',
              ...result.trace,
              `Usage ${result.usage.inputTokens} input · ${result.usage.outputTokens} output · ${result.usage.cachedReadTokens} cached`,
              `${payload.activeModelId}@ModelIR`,
              payload.selectedModuleId,
              attachments.length > 0
                ? `Bounded evidence prompt · ${attachments.length} attached file${attachments.length === 1 ? '' : 's'}`
                : 'Bounded evidence prompt · no attached files',
              'GOSU-compatible model selection contract',
            ],
          };
          if (streamProgress) {
            sendNdjson(response, { type: 'result', answer });
            response.end();
          } else {
            sendJson(response, 200, answer);
          }
        } catch (error) {
          const code = error instanceof Error ? error.message : 'model_copilot_unknown_error';
          if (streamProgress) {
            sendNdjson(response, {
              type: 'error',
              error: 'model_copilot_unavailable',
              detail: code,
            });
            response.end();
          } else {
            sendJson(response, code.includes('request_') ? 400 : 503, {
              error: 'model_copilot_unavailable',
              detail: code,
            });
          }
        }
      });
    },
  };
}
