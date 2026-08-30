import type {
  GradientObservationState,
  ModelConnection,
  ModelModule,
  ModelSpec,
  TensorDimension,
  TensorShape,
} from './model-lab-schema';
import { modelFormulaConsistencyFindings } from './model-formula-consistency';

export const MODEL_LAB_MAX_IMPORT_BYTES = 1_000_000;

export type ModelImportResult =
  Readonly<{ ok: true; model: ModelSpec }> | Readonly<{ ok: false; reason: string }>;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, field: string, maxLength = 2_000): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function boundedNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number.`);
  }
  return value;
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function boundedFiniteNumber(value: unknown, field: string, minimum: number, maximum: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be a finite number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function boundedRepeatCount(value: unknown, field: string): number | string {
  if (typeof value === 'number') return boundedInteger(value, field, 2, 128);
  const expression = boundedString(value, field, 32);
  if (!/^[A-Za-z0-9_+\-*/() ]+$/.test(expression)) {
    throw new Error(`${field} must be an integer or a bounded symbolic expression.`);
  }
  return expression;
}

function tensorShape(value: unknown, field: string): TensorShape {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new Error(`${field} must contain between 1 and 8 dimensions.`);
  }
  return value.map((dimension, index): TensorDimension => {
    if (typeof dimension === 'number' && Number.isInteger(dimension) && dimension > 0) {
      return dimension;
    }
    if (
      typeof dimension === 'string' &&
      /^(?:[1-9]\d*)?[A-Za-z][A-Za-z0-9_]{0,13}'?(?:[+-][1-9]\d*)?$/.test(dimension)
    ) {
      return dimension;
    }
    throw new Error(`${field}[${index}] is not a bounded symbolic or positive dimension.`);
  });
}

function moduleFrom(value: unknown, index: number): ModelModule {
  if (!isRecord(value)) throw new Error(`modules[${index}] must be an object.`);
  const kind = boundedString(value.kind, `modules[${index}].kind`, 32);
  if (
    !['input', 'linear', 'normalization', 'activation', 'merge', 'objective', 'output'].includes(
      kind,
    )
  ) {
    throw new Error(`modules[${index}].kind is unsupported.`);
  }
  return {
    id: boundedString(value.id, `modules[${index}].id`, 120),
    name: boundedString(value.name, `modules[${index}].name`, 160),
    kind: kind as ModelModule['kind'],
    group: boundedString(value.group, `modules[${index}].group`, 160),
    stage: boundedInteger(value.stage, `modules[${index}].stage`, 0, 200),
    lane:
      value.lane === undefined
        ? 0
        : boundedFiniteNumber(value.lane, `modules[${index}].lane`, -100, 100),
    inputShape: tensorShape(value.inputShape, `modules[${index}].inputShape`),
    outputShape: tensorShape(value.outputShape, `modules[${index}].outputShape`),
    transform: boundedString(value.transform, `modules[${index}].transform`),
    activation:
      value.activation === null
        ? null
        : boundedString(value.activation, `modules[${index}].activation`, 160),
    formula: boundedString(value.formula, `modules[${index}].formula`, 2_000),
    explanation: boundedString(value.explanation, `modules[${index}].explanation`, 2_000),
    parameterCount: boundedNumber(value.parameterCount, `modules[${index}].parameterCount`),
    codeReference: boundedString(value.codeReference, `modules[${index}].codeReference`, 300),
    ...(value.repeat === undefined || value.repeat === null
      ? {}
      : isRecord(value.repeat)
        ? {
            repeat: {
              count: boundedRepeatCount(value.repeat.count, `modules[${index}].repeat.count`),
              label: boundedString(value.repeat.label, `modules[${index}].repeat.label`, 80),
            },
          }
        : (() => {
            throw new Error(`modules[${index}].repeat must be an object.`);
          })()),
    ...(value.block === undefined || value.block === null
      ? {}
      : isRecord(value.block)
        ? {
            block: {
              id: boundedString(value.block.id, `modules[${index}].block.id`, 120),
              label: boundedString(value.block.label, `modules[${index}].block.label`, 120),
              repeatCount: boundedRepeatCount(
                value.block.repeatCount,
                `modules[${index}].block.repeatCount`,
              ),
            },
          }
        : (() => {
            throw new Error(`modules[${index}].block must be an object.`);
          })()),
    ...(value.subgraph === undefined
      ? {}
      : isRecord(value.subgraph)
        ? {
            subgraph: {
              modelId: boundedString(
                value.subgraph.modelId,
                `modules[${index}].subgraph.modelId`,
                120,
              ),
            },
          }
        : (() => {
            throw new Error(`modules[${index}].subgraph must be an object.`);
          })()),
  };
}

const NOT_OBSERVED_STATES = Array.from(
  { length: 5 },
  (): GradientObservationState => 'not-observed',
);
const NOT_APPLICABLE_STATES = Array.from(
  { length: 5 },
  (): GradientObservationState => 'not-applicable',
);

function connectionFrom(value: unknown, index: number): ModelConnection {
  if (!isRecord(value)) throw new Error(`connections[${index}] must be an object.`);
  const expectedToCarryGradient = value.expectedToCarryGradient !== false;
  const importedStates = expectedToCarryGradient ? NOT_OBSERVED_STATES : NOT_APPLICABLE_STATES;
  return {
    id: boundedString(value.id, `connections[${index}].id`, 120),
    source: boundedString(value.source, `connections[${index}].source`, 120),
    target: boundedString(value.target, `connections[${index}].target`, 120),
    tensorName: boundedString(value.tensorName, `connections[${index}].tensorName`, 120),
    shape: tensorShape(value.shape, `connections[${index}].shape`),
    activationNorm:
      value.activationNorm === undefined
        ? 0
        : boundedNumber(value.activationNorm, `connections[${index}].activationNorm`),
    expectedToCarryGradient,
    gradient: {
      checkpoints: [1, 2, 3, 4, 5],
      healthy: [0, 0, 0, 0, 0],
      vanishing: [0, 0, 0, 0, 0],
      detached: [0, 0, 0, 0, 0],
      exploding: [0, 0, 0, 0, 0],
      states: {
        healthy: importedStates,
        vanishing: importedStates,
        detached: importedStates,
        exploding: importedStates,
      },
      scenarioKinds: {
        healthy: 'design-only',
        vanishing: 'synthetic-stress',
        detached: 'design-only',
        exploding: 'synthetic-stress',
      },
      scenarioLabels: {
        healthy: 'No observed healthy trace is attached to this imported ModelIR',
        vanishing: 'Synthetic stress scenario; not provider-reported evidence',
        detached: 'No observed detached trace is attached to this imported ModelIR',
        exploding: 'Synthetic stress scenario; not provider-reported evidence',
      },
    },
  };
}

export function parseModelImportJson(text: string): ModelImportResult {
  if (new TextEncoder().encode(text).byteLength > MODEL_LAB_MAX_IMPORT_BYTES) {
    return { ok: false, reason: 'The ModelIR JSON exceeds the 1 MB prototype limit.' };
  }
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || value.schemaVersion !== 1) {
      throw new Error('Expected a ModelIR object with schemaVersion 1.');
    }
    if (!Array.isArray(value.modules) || value.modules.length === 0 || value.modules.length > 200) {
      throw new Error('modules must contain between 1 and 200 entries.');
    }
    if (!Array.isArray(value.connections) || value.connections.length > 400) {
      throw new Error('connections must contain at most 400 entries.');
    }
    if (!isRecord(value.intent)) throw new Error('intent must be an object.');
    const framework = boundedString(value.framework, 'framework', 32);
    if (!['PyTorch', 'ONNX', 'JAX', 'TensorFlow', 'design-only'].includes(framework)) {
      throw new Error('framework is unsupported.');
    }
    const modules = value.modules.map(moduleFrom);
    const moduleIds = new Set(modules.map((module) => module.id));
    if (moduleIds.size !== modules.length) throw new Error('module ids must be unique.');
    const connections = value.connections.map(connectionFrom);
    const connectionIds = new Set(connections.map((connection) => connection.id));
    if (connectionIds.size !== connections.length)
      throw new Error('connection ids must be unique.');
    for (const connection of connections) {
      if (!moduleIds.has(connection.source) || !moduleIds.has(connection.target)) {
        throw new Error(`${connection.id} references an unknown module.`);
      }
    }
    const sourceArtifacts = Array.isArray(value.sourceArtifacts)
      ? value.sourceArtifacts.slice(0, 16).map((artifact, index) => {
          if (!isRecord(artifact) || typeof artifact.verified !== 'boolean') {
            throw new Error(`sourceArtifacts[${index}] must contain path and verified fields.`);
          }
          return {
            path: boundedString(artifact.path, `sourceArtifacts[${index}].path`, 300),
            verified: artifact.verified,
          };
        })
      : [];
    const model: ModelSpec = {
      schemaVersion: 1,
      id: boundedString(value.id, 'id', 120),
      name: boundedString(value.name, 'name', 160),
      version: boundedString(value.version, 'version', 120),
      framework: framework as ModelSpec['framework'],
      sourceLabel: boundedString(value.sourceLabel, 'sourceLabel', 240),
      sourceArtifacts,
      summary: boundedString(value.summary, 'summary', 2_000),
      intent: {
        statement: boundedString(value.intent.statement, 'intent.statement', 2_000),
        invariants: Array.isArray(value.intent.invariants)
          ? value.intent.invariants.map((item, index) =>
              boundedString(item, `intent.invariants[${index}]`, 500),
            )
          : [],
        expectedInput: tensorShape(value.intent.expectedInput, 'intent.expectedInput'),
        expectedOutput: tensorShape(value.intent.expectedOutput, 'intent.expectedOutput'),
      },
      modules,
      connections,
      gradientEvidence: null,
    };
    const formulaFindings = modelFormulaConsistencyFindings(model);
    if (formulaFindings.length > 0) {
      throw new Error(`Formula consistency failed: ${formulaFindings.slice(0, 3).join(' | ')}`);
    }
    return { ok: true, model };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'The ModelIR JSON is invalid.',
    };
  }
}
