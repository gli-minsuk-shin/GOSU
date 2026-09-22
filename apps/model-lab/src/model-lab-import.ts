import type {
  GradientObservationState,
  ModelConnection,
  ModelModule,
  ModelSpec,
  TensorDimension,
  TensorShape,
} from './model-lab-schema';
import { formulaDisplayRows, renderFormulaResult } from './formula';
import { isSymbolicDimension, generatedGraphPresentationError } from './graph-presentation';
import { modelShapeConsistencyFindings } from './model-lab-domain';
import { modelFormulaConsistencyFindings } from './model-formula-consistency';
import {
  modelLoopOwnershipFindings,
  modelSemanticArchitectureFindings,
} from './model-repeat-semantics';

export const MODEL_LAB_MAX_IMPORT_BYTES = 1_000_000;

export type ModelImportResult =
  Readonly<{ ok: true; model: ModelSpec }> | Readonly<{ ok: false; reason: string }>;

type UnknownRecord = Record<string, unknown>;

function sameTensorShape(left: TensorShape, right: TensorShape) {
  return (
    left.length === right.length && left.every((dimension, index) => dimension === right[index])
  );
}

function connectionTensorIdentifier(value: string) {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9_λ]+/gu, '');
}

function textUsesIdentifier(text: string, identifier: string) {
  if (identifier === 'λ') return /λ|\\lambda/u.test(text);
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`, 'iu').test(text);
}

export function splitIndependentLambdaSummary(model: ModelSpec): ModelSpec {
  for (const module of model.modules) {
    const transformLines = module.transform
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    const summaryLineIndex = transformLines.findIndex((line) => /^log_lam_mean\s*=/iu.test(line));
    if (summaryLineIndex < 0 || !/x_c\.t\s*@\s*y_c|x_c[^\n]*y_c/iu.test(module.transform)) {
      continue;
    }
    const summaryOutgoing = model.connections.filter(
      (connection) =>
        connection.source === module.id &&
        ['log_lam_mean', 'm_lambda', 'mλ'].includes(
          connectionTensorIdentifier(connection.tensorName),
        ),
    );
    const primaryOutgoing = model.connections.filter(
      (connection) => connection.source === module.id && !summaryOutgoing.includes(connection),
    );
    const lambdaIncoming = model.connections.filter(
      (connection) =>
        connection.target === module.id &&
        ['lambda', 'λ'].includes(connectionTensorIdentifier(connection.tensorName)),
    );
    if (
      summaryOutgoing.length === 0 ||
      primaryOutgoing.length === 0 ||
      lambdaIncoming.length === 0 ||
      !summaryOutgoing.every((connection) =>
        sameTensorShape(connection.shape, summaryOutgoing[0]!.shape),
      ) ||
      !primaryOutgoing.every((connection) =>
        sameTensorShape(connection.shape, primaryOutgoing[0]!.shape),
      )
    ) {
      continue;
    }
    const summaryId = `${module.id}-lambda-summary`.slice(0, 120);
    if (model.modules.some((candidate) => candidate.id === summaryId)) return model;
    const lambdaInputPortNames = new Set(
      lambdaIncoming.flatMap((connection) => connection.targetPort ?? []),
    );
    const summaryOutputPortNames = new Set(
      summaryOutgoing.flatMap((connection) => connection.sourcePort ?? []),
    );
    const summaryInputPorts = module.inputPorts?.filter((port) =>
      lambdaInputPortNames.has(port.name),
    );
    const summaryOutputPorts = module.outputPorts?.filter((port) =>
      summaryOutputPortNames.has(port.name),
    );
    const primaryInputPorts = module.inputPorts?.filter(
      (port) => !lambdaInputPortNames.has(port.name),
    );
    const primaryOutputPorts = module.outputPorts?.filter(
      (port) => !summaryOutputPortNames.has(port.name),
    );
    const formulaLines = module.formula
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    const summaryFormulaIndex = formulaLines.findIndex((line) =>
      /(?:m_\\lambda|log_lam_mean)\s*=/iu.test(line),
    );
    if (summaryFormulaIndex < 0) continue;
    const primaryTransformLines = transformLines.filter(
      (_line, index) => index !== summaryLineIndex,
    );
    const primaryFormulaLines = formulaLines.filter(
      (_line, index) => index !== summaryFormulaIndex,
    );
    const removedLambdaIdentifiers = new Set([
      'lambda',
      'λ',
      ...lambdaIncoming.flatMap((connection) => [
        connectionTensorIdentifier(connection.tensorName),
        ...(connection.targetPort ? [connectionTensorIdentifier(connection.targetPort)] : []),
      ]),
      ...[
        ...transformLines[summaryLineIndex]!.matchAll(/\blog\s*\(\s*([A-Za-z_λ][A-Za-z0-9_λ]*)/giu),
      ].map((match) => match[1]!.toLocaleLowerCase()),
    ]);
    const primaryTransform = primaryTransformLines.join('\n');
    const primaryFormula = primaryFormulaLines.join('\n');
    if (
      /\blog_lam_mean\b/iu.test(primaryTransform) ||
      /(?:m_\\lambda|log_lam_mean)/iu.test(primaryFormula) ||
      [...removedLambdaIdentifiers].some(
        (identifier) =>
          identifier.length > 0 &&
          (textUsesIdentifier(primaryTransform, identifier) ||
            textUsesIdentifier(primaryFormula, identifier)),
      )
    ) {
      continue;
    }
    const summaryModule: ModelModule = {
      id: summaryId,
      name: 'Lambda Log Summary',
      kind: 'normalization',
      group: module.group,
      stage: module.stage,
      lane: module.lane + 1,
      inputShape: lambdaIncoming[0]!.shape,
      outputShape: summaryOutgoing[0]!.shape,
      ...(summaryInputPorts?.length ? { inputPorts: summaryInputPorts } : {}),
      ...(summaryOutputPorts?.length ? { outputPorts: summaryOutputPorts } : {}),
      transform: transformLines[summaryLineIndex]!,
      activation: null,
      formula: formulaLines[summaryFormulaIndex]!,
      explanation:
        'Computes the RTF-declared scalar lambda summary as an independent design branch. It does not participate in the correlation embedding H₀; downstream threshold modules consume it separately. Because the RTF defines the negative mean and later subtracts it, this must not be described as centering without stronger source evidence.',
      parameterCount: 0,
      codeReference: module.codeReference,
    };
    const primaryInputShape = module.inputShape.filter(
      (dimension) => typeof dimension !== 'string' || !/lambda|lam_/iu.test(dimension),
    );
    const primaryModule: ModelModule = {
      ...module,
      inputShape: primaryInputShape.length > 0 ? primaryInputShape : module.inputShape,
      outputShape: primaryOutgoing[0]!.shape,
      ...(primaryInputPorts?.length ? { inputPorts: primaryInputPorts } : {}),
      ...(primaryOutputPorts?.length ? { outputPorts: primaryOutputPorts } : {}),
      transform: primaryTransformLines.join('\n'),
      formula: primaryFormulaLines.join('\n'),
      explanation:
        'Computes the feature-target correlation statistic and embeds it into H₀. The lambda summary is a separate branch and is not an input to H₀.',
    };
    return {
      ...model,
      modules: model.modules.flatMap((candidate) =>
        candidate.id === module.id ? [summaryModule, primaryModule] : [candidate],
      ),
      connections: model.connections.map((connection) => ({
        ...connection,
        ...(lambdaIncoming.includes(connection) ? { target: summaryId } : {}),
        ...(summaryOutgoing.includes(connection) ? { source: summaryId } : {}),
      })),
    };
  }
  return model;
}

export function modelSourceOutputContractFindings(model: ModelSpec) {
  const modules = new Map(model.modules.map((module) => [module.id, module]));
  return model.connections.flatMap((connection) => {
    const source = modules.get(connection.source);
    const boundPort = source?.outputPorts?.find((port) => port.name === connection.sourcePort);
    const declaredShape = boundPort?.shape ?? source?.outputShape;
    if (!source || !declaredShape || sameTensorShape(declaredShape, connection.shape)) return [];
    return [
      `${source.name} [${source.id}] declares output [${declaredShape.join(', ')}], but outgoing tensor “${connection.tensorName}” uses [${connection.shape.join(', ')}]. A ModelIR v1 module has one typed output; independent or differently shaped live outputs must be split into separate modules unless exact named output ports are declared.`,
    ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  });
}

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
      (isSymbolicDimension(dimension) ||
        /^(?:[1-9]\d*)?[A-Za-z][A-Za-z0-9_]{0,13}'?(?:[+-][1-9]\d*)?$/.test(dimension))
    ) {
      return dimension.replace(/\s+/g, '');
    }
    throw new Error(`${field}[${index}] is not a bounded symbolic or positive dimension.`);
  });
}

function modulePorts(value: unknown, field: string): ModelModule['inputPorts'] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) {
    throw new Error(`${field} must contain between 1 and 24 ports.`);
  }
  const ports = value.map((port, index) => {
    if (!isRecord(port)) throw new Error(`${field}[${index}] must be an object.`);
    if (
      port.binding !== undefined &&
      !['internal', 'external', 'loop-carried'].includes(String(port.binding))
    ) {
      throw new Error(`${field}[${index}].binding is unsupported.`);
    }
    const bindingId =
      port.bindingId === undefined || port.bindingId === null
        ? undefined
        : boundedString(port.bindingId, `${field}[${index}].bindingId`, 120);
    if (port.binding === 'loop-carried' && !bindingId) {
      throw new Error(`${field}[${index}].bindingId is required for a loop-carried port.`);
    }
    if (port.binding !== 'loop-carried' && bindingId) {
      throw new Error(`${field}[${index}].bindingId is only valid for loop-carried ports.`);
    }
    return {
      name: boundedString(port.name, `${field}[${index}].name`, 120),
      shape: tensorShape(port.shape, `${field}[${index}].shape`),
      ...(port.binding === undefined
        ? {}
        : { binding: port.binding as 'internal' | 'external' | 'loop-carried' }),
      ...(bindingId ? { bindingId } : {}),
    };
  });
  const names = new Set(ports.map((port) => port.name.normalize('NFC')));
  if (names.size !== ports.length) throw new Error(`${field} names must be unique.`);
  return ports;
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
  const inputPorts = modulePorts(value.inputPorts, `modules[${index}].inputPorts`);
  const outputPorts = modulePorts(value.outputPorts, `modules[${index}].outputPorts`);
  let presentation: ModelModule['presentation'];
  if (value.presentation !== undefined && value.presentation !== null) {
    const p = value.presentation;
    if (!isRecord(p) || !Array.isArray(p.uncertainties) || p.uncertainties.length > 4)
      throw Error('Graph presentation must contain a bounded uncertainty list.');
    presentation = {
      purpose: boundedString(p.purpose, 'presentation.purpose', 180),
      keyEquation: boundedString(
        p.keyEquationIndex !== undefined && typeof value.formula === 'string'
          ? formulaDisplayRows(value.formula)[
              boundedInteger(p.keyEquationIndex, 'presentation.keyEquationIndex', 0, 32)
            ]
          : p.keyEquation,
        'presentation.keyEquation',
        600,
      ),
      shapeNotes: boundedString(p.shapeNotes, 'presentation.shapeNotes', 600),
      uncertainties: p.uncertainties.map((s) =>
        boundedString(s, 'presentation.uncertainties', 240),
      ),
    };
    const normalize = (s: string) => s.replace(/\s+/g, '');
    if (
      typeof value.formula === 'string' &&
      /unresolved|unspecified/i.test(value.formula) &&
      !presentation.uncertainties.length
    )
      throw Error('An explicitly unresolved formula needs a specific uncertainty explanation.');
    const keyEquation = normalize(presentation.keyEquation);
    if (
      typeof value.formula !== 'string' ||
      !formulaDisplayRows(value.formula).some((row) => normalize(row) === keyEquation)
    )
      throw Error('The card key equation must be grounded in the stored module formula.');
    if (
      !/(?:=|\\(?:in|mapsto|to)\b)/.test(presentation.keyEquation) ||
      !renderFormulaResult(presentation.keyEquation).valid
    )
      throw Error('The card key equation must render as a complete equation.');
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
    ...(inputPorts === undefined ? {} : { inputPorts }),
    ...(outputPorts === undefined ? {} : { outputPorts }),
    transform: boundedString(value.transform, `modules[${index}].transform`),
    activation:
      value.activation === null
        ? null
        : boundedString(value.activation, `modules[${index}].activation`, 160),
    formula: boundedString(value.formula, `modules[${index}].formula`, 2_000),
    explanation: boundedString(value.explanation, `modules[${index}].explanation`, 2_000),
    ...(presentation ? { presentation } : {}),
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
    ...(value.subgraph === undefined || value.subgraph === null
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
  const hasSourcePort = value.sourcePort !== undefined && value.sourcePort !== null;
  const hasTargetPort = value.targetPort !== undefined && value.targetPort !== null;
  return {
    id: boundedString(value.id, `connections[${index}].id`, 120),
    source: boundedString(value.source, `connections[${index}].source`, 120),
    target: boundedString(value.target, `connections[${index}].target`, 120),
    ...(!hasSourcePort
      ? {}
      : { sourcePort: boundedString(value.sourcePort, `connections[${index}].sourcePort`, 120) }),
    ...(!hasTargetPort
      ? {}
      : { targetPort: boundedString(value.targetPort, `connections[${index}].targetPort`, 120) }),
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

export function parseModelImportJson(
  text: string,
  options: Readonly<{
    enforceSourceOutputContracts?: boolean;
    enforceReadableNames?: boolean;
    allowSubgraphs?: boolean;
    sourceArtifactNames?: readonly string[];
  }> = {},
): ModelImportResult {
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
    const moduleById = new Map(modules.map((module) => [module.id, module]));
    if (moduleIds.size !== modules.length) throw new Error('module ids must be unique.');
    let connections = value.connections.map(connectionFrom);
    const connectionIds = new Set(connections.map((connection) => connection.id));
    if (connectionIds.size !== connections.length)
      throw new Error('connection ids must be unique.');
    for (const connection of connections) {
      if (!moduleIds.has(connection.source) || !moduleIds.has(connection.target)) {
        throw new Error(`${connection.id} references an unknown module.`);
      }
      const source = moduleById.get(connection.source)!;
      const target = moduleById.get(connection.target)!;
      if (source.outputPorts?.length) {
        const sourcePort = source.outputPorts.find((port) => port.name === connection.sourcePort);
        if (!sourcePort) {
          throw new Error(`${connection.id} references an unknown sourcePort.`);
        }
        if (!sameTensorShape(sourcePort.shape, connection.shape)) {
          throw new Error(`${connection.id} shape does not match its sourcePort.`);
        }
      } else if (connection.sourcePort) {
        throw new Error(`${connection.id} binds sourcePort on a module without outputPorts.`);
      }
      if (target.inputPorts?.length) {
        const targetPort = target.inputPorts.find((port) => port.name === connection.targetPort);
        if (!targetPort) {
          throw new Error(`${connection.id} references an unknown targetPort.`);
        }
        if (!sameTensorShape(targetPort.shape, connection.shape)) {
          throw new Error(`${connection.id} shape does not match its targetPort.`);
        }
      } else if (connection.targetPort) {
        throw new Error(`${connection.id} binds targetPort on a module without inputPorts.`);
      }
    }
    // A matching loop-carried pair already represents the feedback relation. Some
    // generators also emit its arrow as an ordinary edge; canonicalize only that
    // exact redundant edge after validating endpoints/shapes, never external edges.
    connections = connections.filter((connection) => {
      const source = moduleById.get(connection.source)!;
      const target = moduleById.get(connection.target)!;
      const output = source.outputPorts?.find((p) => p.name === connection.sourcePort);
      const input = target.inputPorts?.find((p) => p.name === connection.targetPort);
      const sameOwner =
        (source.id === target.id && source.repeat) ||
        (source.block &&
          target.block &&
          source.block.id === target.block.id &&
          source.block.repeatCount === target.block.repeatCount);
      return !(
        sameOwner &&
        output?.binding === 'loop-carried' &&
        input?.binding === 'loop-carried' &&
        output.bindingId &&
        output.bindingId === input.bindingId
      );
    });
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
    const rawModel: ModelSpec = {
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
    let model = splitIndependentLambdaSummary(rawModel);
    const presentationFinding = options.enforceReadableNames
      ? generatedGraphPresentationError(model)
      : null;
    const expectedSourceArtifactNames = [
      ...new Set(
        (options.sourceArtifactNames ?? [])
          .map((name) => name.trim().normalize('NFC'))
          .filter((name) => name.length > 0),
      ),
    ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    const codeReferenceUsesSource = (codeReference: string, name: string) =>
      codeReference.normalize('NFC') === name ||
      new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:[:#,\\s·—-])`, 'u').test(
        codeReference.normalize('NFC'),
      );
    const provenanceFindings =
      expectedSourceArtifactNames.length === 0
        ? []
        : [
            ...model.modules.flatMap((module) =>
              expectedSourceArtifactNames.some((name) =>
                codeReferenceUsesSource(module.codeReference, name),
              )
                ? []
                : [
                    `${module.name} [${module.id}] codeReference does not name any supplied source artifact.`,
                  ],
            ),
          ];
    if (expectedSourceArtifactNames.length > 0) {
      model = {
        ...model,
        sourceArtifacts: expectedSourceArtifactNames.map((path) => ({ path, verified: true })),
      };
    }
    const sourceOutputFindings = modelSourceOutputContractFindings(model);
    const formulaFindings = [
      ...modelFormulaConsistencyFindings(model, {
        includeNamedValueLiveness: options.enforceSourceOutputContracts === true,
      }),
      ...model.modules.flatMap((module) => {
        const rendered = renderFormulaResult(module.formula);
        return rendered.valid
          ? []
          : [`${module.name} [${module.id}] formula is not renderable: ${rendered.reason}`];
      }),
    ];
    const shapeFindings = modelShapeConsistencyFindings(model);
    const loopOwnershipFindings = modelLoopOwnershipFindings(model);
    const hasExplicitPortContract =
      model.modules.some(
        (module) => Boolean(module.inputPorts?.length) || Boolean(module.outputPorts?.length),
      ) || model.connections.some((connection) => connection.sourcePort || connection.targetPort);
    if (
      !options.enforceSourceOutputContracts &&
      hasExplicitPortContract &&
      (shapeFindings.length > 0 || loopOwnershipFindings.length > 0)
    ) {
      throw new Error(
        `Graph structure failed: ${[...shapeFindings, ...loopOwnershipFindings]
          .slice(0, 5)
          .join(' | ')}`,
      );
    }
    if (options.enforceSourceOutputContracts) {
      const semanticFindings = modelSemanticArchitectureFindings(model);
      const strictPortFindings = [
        ...(!model.modules.some((module) => module.kind === 'input')
          ? ['ModelIR has no input-kind boundary module.']
          : []),
        ...(!model.modules.some((module) => module.kind === 'output' || module.kind === 'objective')
          ? ['ModelIR has no output/objective terminal boundary module.']
          : []),
        ...model.modules.flatMap((module) => [
          ...(!module.inputPorts?.length ? [`${module.name} has no explicit inputPorts.`] : []),
          ...(!module.outputPorts?.length ? [`${module.name} has no explicit outputPorts.`] : []),
          ...(options.allowSubgraphs === false && module.subgraph
            ? [`${module.name} references unqualified subgraph ${module.subgraph.modelId}.`]
            : []),
        ]),
        ...model.connections.flatMap((connection) => [
          ...(!connection.sourcePort ? [`${connection.id} has no sourcePort binding.`] : []),
          ...(!connection.targetPort ? [`${connection.id} has no targetPort binding.`] : []),
        ]),
      ];
      const auditSections = [
        ...(presentationFinding ? [presentationFinding] : []),
        ...(shapeFindings.length > 0 || strictPortFindings.length > 0
          ? [
              `Graph structure failed: ${[...strictPortFindings, ...shapeFindings]
                .slice(0, 8)
                .join(' | ')}`,
            ]
          : []),
        ...(semanticFindings.length > 0
          ? [`Semantic architecture quality failed: ${semanticFindings.slice(0, 5).join(' | ')}`]
          : []),
        ...(sourceOutputFindings.length > 0
          ? [`Source-output contract failed: ${sourceOutputFindings.slice(0, 3).join(' | ')}`]
          : []),
        ...(formulaFindings.length > 0
          ? [`Formula consistency failed: ${formulaFindings.slice(0, 5).join(' | ')}`]
          : []),
        ...(provenanceFindings.length > 0
          ? [`Source provenance failed: ${provenanceFindings.slice(0, 5).join(' | ')}`]
          : []),
      ];
      if (auditSections.length > 0) {
        throw new Error(`Builder audit failed: ${auditSections.join(' || ')}`);
      }
    }
    if (formulaFindings.length > 0) {
      throw new Error(`Formula consistency failed: ${formulaFindings.slice(0, 3).join(' | ')}`);
    }
    if (presentationFinding) throw new Error(presentationFinding);
    return { ok: true, model };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'The ModelIR JSON is invalid.',
    };
  }
}
