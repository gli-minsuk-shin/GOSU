export const MODEL_LAB_SCHEMA_VERSION = 1 as const;

export type TensorDimension = number | string;
export type TensorShape = readonly TensorDimension[];

export type ModelModuleKind =
  'input' | 'linear' | 'normalization' | 'activation' | 'merge' | 'objective' | 'output';

export type ModelSubgraphReference = Readonly<{
  modelId: string;
}>;

export type ModelModuleRepeat = Readonly<{
  count: number | string;
  label: string;
}>;

export type ModelModuleBlock = Readonly<{
  id: string;
  label: string;
  repeatCount: number | string;
}>;

export type ModelModulePort = Readonly<{
  name: string;
  shape: TensorShape;
  binding?: 'internal' | 'external' | 'loop-carried';
  bindingId?: string;
}>;

export type ModelModule = Readonly<{
  id: string;
  name: string;
  kind: ModelModuleKind;
  group: string;
  stage: number;
  lane: number;
  inputShape: TensorShape;
  outputShape: TensorShape;
  inputPorts?: readonly ModelModulePort[];
  outputPorts?: readonly ModelModulePort[];
  transform: string;
  activation: string | null;
  formula: string;
  explanation: string;
  parameterCount: number;
  codeReference: string;
  repeat?: ModelModuleRepeat;
  block?: ModelModuleBlock;
  subgraph?: ModelSubgraphReference;
}>;

export type GradientProbeName = 'healthy' | 'vanishing' | 'detached' | 'exploding';

export type GradientObservationState =
  'observed' | 'detached' | 'not-observed' | 'nonfinite' | 'frozen' | 'not-applicable';

export type GradientScenarioKind = 'pytorch-observed' | 'synthetic-stress' | 'design-only';

export type GradientTrace = Readonly<{
  checkpoints: readonly number[];
  healthy: readonly number[];
  vanishing: readonly number[];
  detached: readonly number[];
  exploding: readonly number[];
  states: Readonly<Record<GradientProbeName, readonly GradientObservationState[]>>;
  scenarioKinds: Readonly<Record<GradientProbeName, GradientScenarioKind>>;
  scenarioLabels: Readonly<Record<GradientProbeName, string>>;
}>;

export type GradientCoverageCount = Readonly<{
  tensors: number;
  elements: number;
}>;

export type ParameterGradientCoverage = Readonly<{
  denominator: GradientCoverageCount;
  observed: GradientCoverageCount;
  detached: GradientCoverageCount;
  nonfinite: GradientCoverageCount;
  notObserved: GradientCoverageCount;
  excluded: Readonly<{
    frozenTensors: number;
    frozenElements: number;
    notApplicableTensors: number;
    notApplicableElements: number;
  }>;
}>;

export type ParameterGradientTrace = Readonly<{
  shape: readonly number[];
  elementCount: number;
  trainable: boolean;
  gradientRms: readonly (number | null)[];
  states: readonly GradientObservationState[];
}>;

export type EdgeGradientEvidence = Readonly<{
  shape: readonly number[];
  activationRms: readonly number[];
  gradientRms: readonly (number | null)[];
  states: readonly GradientObservationState[];
}>;

export type ObservedGradientScenario = Readonly<{
  kind: 'pytorch-observed';
  label: string;
  variant: string;
  losses: readonly number[];
  edges: Readonly<Record<string, EdgeGradientEvidence>>;
  parameters: Readonly<Record<string, ParameterGradientTrace>>;
  parameterCoverage: readonly ParameterGradientCoverage[];
}>;

export type ModelGradientEvidence = Readonly<{
  schemaVersion: 1;
  generator: string;
  framework: 'PyTorch';
  torchVersion: string;
  seed: number;
  mode: 'train' | 'eval';
  loss: Readonly<{ name: string }>;
  probeCount: number;
  scenarios: Readonly<{
    healthy: ObservedGradientScenario;
    detached: ObservedGradientScenario;
  }>;
}>;

export type ModelConnection = Readonly<{
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  tensorName: string;
  shape: TensorShape;
  activationNorm: number;
  gradient: GradientTrace;
  expectedToCarryGradient: boolean;
}>;

export type ModelIntent = Readonly<{
  statement: string;
  invariants: readonly string[];
  expectedInput: TensorShape;
  expectedOutput: TensorShape;
}>;

export type ModelSourceArtifact = Readonly<{
  path: string;
  verified: boolean;
}>;

export type ModelSpec = Readonly<{
  schemaVersion: typeof MODEL_LAB_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  framework: 'PyTorch' | 'ONNX' | 'JAX' | 'TensorFlow' | 'design-only';
  sourceLabel: string;
  sourceArtifacts: readonly ModelSourceArtifact[];
  summary: string;
  intent: ModelIntent;
  modules: readonly ModelModule[];
  connections: readonly ModelConnection[];
  gradientEvidence: ModelGradientEvidence | null;
}>;

export type ReviewSeverity = 'pass' | 'warning' | 'error';

export type AgentReview = Readonly<{
  id: string;
  agent: string;
  specialty: string;
  status: ReviewSeverity;
  summary: string;
  evidence: readonly string[];
}>;

export type GradientHealth =
  'healthy' | 'low' | 'blocked' | 'exploding' | 'invalid' | 'not-applicable';
