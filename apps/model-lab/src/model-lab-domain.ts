import type {
  AgentReview,
  GradientHealth,
  GradientObservationState,
  GradientProbeName,
  ModelConnection,
  ModelSpec,
  ParameterGradientCoverage,
  TensorShape,
} from './model-lab-schema';
import {
  modelFormulaConsistencyFindings,
  moduleFormulaConsistencyFindings,
} from './model-formula-consistency';

export { modelFormulaConsistencyFindings, moduleFormulaConsistencyFindings };

export function formatShape(shape: TensorShape): string {
  return `[${shape.join(' × ')}]`;
}

export function shapesEqual(left: TensorShape, right: TensorShape): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function gradientAt(
  connection: ModelConnection,
  probe: GradientProbeName,
  checkpointIndex: number,
): number {
  const values = connection.gradient[probe];
  const boundedIndex = Math.max(0, Math.min(values.length - 1, checkpointIndex));
  return values[boundedIndex] ?? Number.NaN;
}

export function gradientStateAt(
  connection: ModelConnection,
  probe: GradientProbeName,
  checkpointIndex: number,
): GradientObservationState {
  const states = connection.gradient.states[probe];
  const boundedIndex = Math.max(0, Math.min(states.length - 1, checkpointIndex));
  return states[boundedIndex] ?? 'not-observed';
}

export function classifyGradient(
  value: number,
  expectedToCarryGradient = true,
  state: GradientObservationState = 'observed',
): GradientHealth {
  if (state === 'frozen' || state === 'not-applicable') {
    return expectedToCarryGradient ? 'invalid' : 'not-applicable';
  }
  if (state === 'nonfinite' || state === 'not-observed') {
    return 'invalid';
  }
  if (state === 'detached') {
    return expectedToCarryGradient ? 'blocked' : 'healthy';
  }
  if (!Number.isFinite(value) || value < 0) {
    return 'invalid';
  }
  if (expectedToCarryGradient && value === 0) {
    return 'blocked';
  }
  if (value > 10) {
    return 'exploding';
  }
  if (expectedToCarryGradient && value < 1e-7) {
    return 'low';
  }
  return 'healthy';
}

export function parameterCoverageAt(
  model: ModelSpec,
  probe: GradientProbeName,
  checkpointIndex: number,
): ParameterGradientCoverage | null {
  if (!model.gradientEvidence || (probe !== 'healthy' && probe !== 'detached')) {
    return null;
  }
  const coverages = model.gradientEvidence.scenarios[probe].parameterCoverage;
  const boundedIndex = Math.max(0, Math.min(coverages.length - 1, checkpointIndex));
  return coverages[boundedIndex] ?? null;
}

export function moduleGradientHealth(
  model: ModelSpec,
  moduleId: string,
  probe: GradientProbeName,
  checkpointIndex: number,
): GradientHealth {
  const module = model.modules.find((candidate) => candidate.id === moduleId);
  const incoming = model.connections.filter((connection) => connection.target === moduleId);
  const observedBoundary =
    incoming.length > 0
      ? incoming
      : module?.kind === 'input'
        ? model.connections.filter((connection) => connection.source === moduleId)
        : [];
  if (observedBoundary.length === 0) return 'invalid';
  const health = observedBoundary.map((connection) =>
    classifyGradient(
      gradientAt(connection, probe, checkpointIndex),
      connection.expectedToCarryGradient,
      gradientStateAt(connection, probe, checkpointIndex),
    ),
  );
  if (health.includes('invalid')) return 'invalid';
  if (health.includes('blocked')) return 'blocked';
  if (health.includes('exploding')) return 'exploding';
  if (health.includes('low')) return 'low';
  if (health.every((value) => value === 'not-applicable')) return 'not-applicable';
  return 'healthy';
}

function shapeReview(model: ModelSpec): AgentReview {
  const modules = new Map(model.modules.map((module) => [module.id, module]));
  const mismatches = model.connections.flatMap((connection) => {
    const source = modules.get(connection.source);
    const target = modules.get(connection.target);
    if (!source || !target) {
      return [`${connection.id}: missing endpoint`];
    }
    const evidence: string[] = [];
    if (!shapesEqual(source.outputShape, connection.shape)) {
      evidence.push(
        `${source.name} emits ${formatShape(source.outputShape)}, edge declares ${formatShape(connection.shape)}`,
      );
    }
    if (!shapesEqual(connection.shape, target.inputShape)) {
      evidence.push(
        `${target.name} expects ${formatShape(target.inputShape)}, edge carries ${formatShape(connection.shape)}`,
      );
    }
    return evidence;
  });
  return {
    id: 'shape-auditor',
    agent: 'Shape auditor',
    specialty: 'Tensor contracts',
    status: mismatches.length === 0 ? 'pass' : 'error',
    summary:
      mismatches.length === 0
        ? `${model.connections.length} tensor interfaces are dimensionally consistent.`
        : `${mismatches.length} tensor interface mismatch${mismatches.length === 1 ? '' : 'es'} found.`,
    evidence:
      mismatches.length === 0
        ? ['Every edge matches its source output and target input.']
        : mismatches,
  };
}

function intentReview(model: ModelSpec): AgentReview {
  const input = model.modules.find((module) => module.kind === 'input');
  const output = [...model.modules].reverse().find((module) => module.kind === 'output');
  const evidence: string[] = [];
  if (!input || !shapesEqual(input.outputShape, model.intent.expectedInput)) {
    evidence.push('Declared input intent does not match the graph input.');
  }
  if (!output || !shapesEqual(output.outputShape, model.intent.expectedOutput)) {
    evidence.push('Declared output intent does not match the graph output.');
  }
  const incompleteModules = model.modules.filter(
    (module) => module.formula.trim().length === 0 || module.transform.trim().length === 0,
  );
  if (incompleteModules.length > 0) {
    evidence.push(
      `${incompleteModules.length} module descriptions are missing a formula or transform.`,
    );
  }
  return {
    id: 'intent-referee',
    agent: 'Intent referee',
    specialty: 'Specification ↔ graph',
    status: evidence.length === 0 ? 'pass' : 'error',
    summary:
      evidence.length === 0
        ? 'The implementation graph matches the stated input, output, and module-level intent.'
        : 'The graph does not fully satisfy the stated design intent.',
    evidence: evidence.length === 0 ? [...model.intent.invariants] : evidence,
  };
}

function formulaReview(models: readonly ModelSpec[]): AgentReview {
  const findings = modelFormulaConsistencyFindings(models);
  const moduleCount = models.reduce((total, model) => total + model.modules.length, 0);
  return {
    id: 'formula-auditor',
    agent: 'Formula auditor',
    specialty: 'Transform ↔ equation',
    status: findings.length === 0 ? 'pass' : 'error',
    summary:
      findings.length === 0
        ? `All ${moduleCount} module equations across ${models.length} model graph${models.length === 1 ? '' : 's'} are consistent with recognized operations in their text.`
        : `${findings.length} transform-to-equation mismatch${findings.length === 1 ? '' : 'es'} found.`,
    evidence:
      findings.length === 0 ? ['No recognized operator contradiction was found.'] : findings,
  };
}

function gradientReview(
  model: ModelSpec,
  probe: GradientProbeName,
  checkpointIndex: number,
): AgentReview {
  const observations = model.connections
    .filter((connection) => connection.expectedToCarryGradient)
    .map((connection) => ({
      connection,
      value: gradientAt(connection, probe, checkpointIndex),
      state: gradientStateAt(connection, probe, checkpointIndex),
    }));
  const unhealthy = observations.filter(
    ({ connection, value, state }) =>
      classifyGradient(value, connection.expectedToCarryGradient, state) !== 'healthy',
  );
  const severeObservation = unhealthy.some(({ connection, value, state }) => {
    const health = classifyGradient(value, connection.expectedToCarryGradient, state);
    return (
      health === 'blocked' ||
      health === 'exploding' ||
      (health === 'invalid' && state !== 'not-observed')
    );
  });
  const missingEdgeEvidence =
    observations.length === 0 || observations.some(({ state }) => state === 'not-observed');
  const parameterCoverage = parameterCoverageAt(model, probe, checkpointIndex);
  const parameterErrors = parameterCoverage
    ? parameterCoverage.detached.tensors + parameterCoverage.nonfinite.tensors
    : 0;
  const missingParameterTensors = parameterCoverage?.notObserved.tensors ?? 0;
  const missingParameterEvidence =
    parameterCoverage === null && model.modules.some((module) => module.parameterCount > 0);
  const parameterFailures = parameterErrors + missingParameterTensors;
  const scenario = model.connections[0]?.gradient;
  const scenarioKind = scenario?.scenarioKinds[probe] ?? 'design-only';
  const scenarioLabel = scenario?.scenarioLabels[probe] ?? 'No gradient evidence is available';
  const missingRuntimeReceipt =
    model.gradientEvidence === null || scenarioKind !== 'pytorch-observed';
  const edgeEvidence =
    observations.length === 0
      ? ['not-observed: no expected gradient-carrying graph connections were provided.']
      : unhealthy.length === 0
        ? observations.map(
            ({ connection, value }) => `${connection.tensorName}: ‖∂L/∂h‖₂ = ${formatNorm(value)}`,
          )
        : unhealthy.map(({ connection, value, state }) => {
            const health = classifyGradient(value, connection.expectedToCarryGradient, state);
            const observation = state === 'observed' ? formatNorm(value) : state;
            return state === 'not-observed'
              ? `${connection.source} → ${connection.target}: not-observed (no runtime gradient receipt)`
              : `${connection.source} → ${connection.target}: ${health} (${observation})`;
          });
  const coverageEvidence = parameterCoverage
    ? [
        `Trainable parameter coverage: ${parameterCoverage.observed.tensors}/${parameterCoverage.denominator.tensors} tensors and ${parameterCoverage.observed.elements}/${parameterCoverage.denominator.elements} elements observed.`,
        ...(parameterFailures > 0
          ? [
              `Unobserved parameter tensors: ${parameterCoverage.detached.tensors} detached, ${parameterCoverage.nonfinite.tensors} nonfinite, ${parameterCoverage.notObserved.tensors} not observed.`,
            ]
          : []),
      ]
    : missingParameterEvidence
      ? ['not-observed: no trainable parameter-gradient coverage receipt is attached.']
      : [];
  const hasMissingEvidence =
    missingEdgeEvidence ||
    missingParameterEvidence ||
    missingParameterTensors > 0 ||
    missingRuntimeReceipt;
  const hasError = severeObservation || parameterErrors > 0;
  const hasProblem =
    unhealthy.length > 0 ||
    parameterFailures > 0 ||
    missingEdgeEvidence ||
    missingParameterEvidence ||
    missingRuntimeReceipt;
  return {
    id: 'autograd-inspector',
    agent: 'Autograd inspector',
    specialty: 'Backward signal',
    status: hasProblem ? (hasError ? 'error' : 'warning') : 'pass',
    summary: !hasProblem
      ? 'Every expected path and trainable parameter carries a finite, non-zero gradient at this checkpoint.'
      : hasMissingEvidence && !hasError
        ? 'Gradient evidence is not observed or incomplete; verification remains pending.'
        : `${unhealthy.length} backward path${unhealthy.length === 1 ? '' : 's'} and ${parameterFailures} trainable parameter tensor${parameterFailures === 1 ? '' : 's'} need attention.`,
    evidence: [
      `${scenarioKind}: ${scenarioLabel}`,
      ...(missingRuntimeReceipt
        ? ['not-observed: no observed runtime gradient receipt backs this scenario.']
        : []),
      ...edgeEvidence,
      ...coverageEvidence,
    ],
  };
}

function codeReview(model: ModelSpec): AgentReview {
  const verifiedPaths = new Set(
    model.sourceArtifacts.filter((artifact) => artifact.verified).map((artifact) => artifact.path),
  );
  const unresolved = model.modules.filter((module) => {
    const references = module.codeReference.split(/;\s*/).map((reference) => reference.trim());
    return references.some((reference) => {
      const match = /^(.+?):\d+(?:[–-]\d+)?(?:,\s*\d+(?:[–-]\d+)?)?$/.exec(reference);
      return !match?.[1] || !verifiedPaths.has(match[1]);
    });
  });
  return {
    id: 'code-mapper',
    agent: 'Code mapper',
    specialty: 'Graph ↔ source',
    status: unresolved.length === 0 ? 'pass' : 'warning',
    summary:
      unresolved.length === 0
        ? `All ${model.modules.length} module anchors resolve to a verified source artifact.`
        : `${unresolved.length} module anchors do not resolve to a verified source artifact.`,
    evidence:
      unresolved.length === 0
        ? model.modules.slice(0, 3).map((module) => `${module.name} ↔ ${module.codeReference}`)
        : unresolved.map((module) => `${module.name}: ${module.codeReference}`),
  };
}

export function runAgentReview(
  model: ModelSpec,
  probe: GradientProbeName,
  checkpointIndex: number,
  formulaScopeModels: readonly ModelSpec[] = [model],
): readonly AgentReview[] {
  return [
    shapeReview(model),
    intentReview(model),
    formulaReview(formulaScopeModels),
    gradientReview(model, probe, checkpointIndex),
    codeReview(model),
  ];
}

export function formatNorm(value: number): string {
  if (!Number.isFinite(value)) return 'invalid';
  if (value === 0) return '0';
  if (Math.abs(value) >= 0.01 && Math.abs(value) < 1000) return value.toFixed(3);
  return value.toExponential(2);
}

export function answerModelQuestion(
  question: string,
  model: ModelSpec,
  selectedModuleId: string,
  probe: GradientProbeName,
  checkpointIndex: number,
): string {
  const module =
    model.modules.find((candidate) => candidate.id === selectedModuleId) ?? model.modules[0];
  if (!module) return 'No model module is available.';
  const normalized = question.toLowerCase();
  if (/gradient|backprop|미분|그래디언트|기울기/u.test(normalized)) {
    const incoming = model.connections.filter((connection) => connection.target === module.id);
    if (incoming.length === 0) {
      return `${module.name} is an input boundary, so it has no incoming edge probe. Select a downstream module to inspect its backward signal.`;
    }
    return incoming
      .map((connection) => {
        const value = gradientAt(connection, probe, checkpointIndex);
        const state = gradientStateAt(connection, probe, checkpointIndex);
        const observation = state === 'observed' ? `norm ${formatNorm(value)}` : state;
        return `${connection.tensorName} carries gradient ${observation} (${classifyGradient(value, connection.expectedToCarryGradient, state)}).`;
      })
      .join(' ');
  }
  if (/shape|dimension|dim|차원|크기/u.test(normalized)) {
    return `${module.name} maps ${formatShape(module.inputShape)} → ${formatShape(module.outputShape)} through ${module.transform}.`;
  }
  if (/formula|equation|수식|계산/u.test(normalized)) {
    return `${module.name} is represented by ${module.formula}. Its activation is ${module.activation ?? 'none'}.`;
  }
  return `${module.name}: ${module.explanation} I can inspect its dimensions, formula, code anchor, or backward gradient evidence.`;
}
