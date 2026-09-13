import { parseModelImportJson } from './model-lab-import';
import { modelLabFetch } from './model-lab-environment';
import {
  isModelPythonArtifactReceipt,
  type ModelPythonArtifactReceipt,
} from './model-python-artifact';
import type { ModelLabModelSelection } from './model-lab-runtime-adapter';
import type { ModelSpec } from './model-lab-schema';

export const MODEL_PSEUDOCODE_HEADER = '# GOSU Model Pseudocode v2';
export const MODEL_PSEUDOCODE_V1_HEADER = '# GOSU Model Pseudocode v1';
export const MODEL_PSEUDOCODE_MAX_CHARACTERS = 300_000;
export const MODEL_PSEUDOCODE_MAX_RECORDS = 5_000;
export const MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY = 'gosu.model-lab.pseudocode-workspace.v1';
export const MODEL_PSEUDOCODE_WORKSPACE_MAX_CHARACTERS = 4_000_000;
export const MODEL_PSEUDOCODE_NORMALIZE_ENDPOINT = '/api/model-pseudocode/normalize';
export const MODEL_PSEUDOCODE_RECONCILE_ENDPOINT = '/api/model-pseudocode/reconcile';
export const MODEL_PSEUDOCODE_RECOMMENDED_MIN_BLOCKS = 3;
export const MODEL_PSEUDOCODE_RECOMMENDED_MAX_BLOCKS = 8;
export const MODEL_PSEUDOCODE_LLM_GUIDE = `GOSU Model Pseudocode v2

The canonical document begins with: # GOSU Model Pseudocode v2

This is a human architecture program, not a dump of framework layers. Prefer ${MODEL_PSEUDOCODE_RECOMMENDED_MIN_BLOCKS}-${MODEL_PSEUDOCODE_RECOMMENDED_MAX_BLOCKS} meaningful
top-level BLOCKs for an ordinary model. A Linear, activation, normalization, residual addition,
FiLM injection, or tensor split inside one conceptual computation belongs as a line under do:;
do not define each atomic operation as a separate BLOCK. Put loops directly in do: and use repeat:
when the entire block is composed repeatedly.

MODEL <stable-id> "Human name"
  version: <text>
  framework: PyTorch | ONNX | JAX | TensorFlow | design-only
  source: <text>
  artifact: verified | <path>        # repeat when needed
  summary: |
    <plain multiline text>
  intent: |
    <plain multiline text>
  invariant: |
    <plain multiline text>           # repeat when needed
  input: [B, N, P]
  output: [B, K]
END MODEL

# Every canonical architecture has at least one kind: input block and one terminal kind: output or objective block.

BLOCK <stable-id> "Human-readable architectural block"
  input: [B, N, P]
  output: [B, K]
  input_port: external | "X" | [B, N, P]
  output_port: loop-carried | "H" | [B, K] | "residual-loop"
  # input/output above must equal the first input_port/output_port shape respectively.
  do: |
    H = beta_base
    H -> Linear(1, 2d)
    for j in range(1, L):
      H1, H2 = split(H)
      H3 = MLP(H) + FiLM(log(lambda))
      H = RMSNorm(H + H3)
  math: |
    u = 2 (log(lambda)-log(lambda_min)) / (log(lambda_max)-log(lambda_min)) - 1
  repeat: "L-1" | residual layers          # optional
  kind: linear                              # optional ModelIR hint
  group: Conditional trunk                  # optional UI label
  position: 2, 0                            # optional stage, lane for branches
  activation: GELU                          # optional
  parameters: 0                             # optional; omit when unknown
  code: model.py:20-48                      # optional evidence anchor
  notes: |                                  # optional explanation
    <plain multiline text>
  block: <block-id> | <count> | <label>      # optional nested visual composition
  subgraph: <model-id>                       # optional expandable model reference
END BLOCK

CONNECT <stable-id> <source-block-id> -> <target-block-id> AS "<tensor>" [B, K] PORTS "<source-port>" -> "<target-port>" GRADIENT yes NORM 0

BLOCK order controls the default stage. Comments begin with #. Every connection endpoint must name
an existing BLOCK. IDs remain unchanged inside one revision tree. Preserve detailed sequential
operations, equations, shapes, FiLM conditioning, and loops inside do:/math: without exploding them
into dozens of declarations.`;

export type ModelPseudocodeParseResult =
  | Readonly<{ ok: true; model: ModelSpec; normalized: string }>
  | Readonly<{ ok: false; reason: string }>;

export type ModelPseudocodeRevision = Readonly<{
  revision: number;
  parentRevision: number | null;
  createdAt: string;
  label: string;
  model: ModelSpec;
  pseudocode: string;
  originalDraft?: string;
  pythonArtifact?: ModelPythonArtifactReceipt;
}>;

export type ModelPseudocodeRevisionRow = Readonly<{
  revision: ModelPseudocodeRevision;
  depth: number;
}>;

export type ModelPseudocodeWorkspace = Readonly<{
  models: readonly ModelSpec[];
  histories: Readonly<Record<string, readonly ModelPseudocodeRevision[]>>;
  selectedRevisions: Readonly<Record<string, number>>;
  activeModelId: string;
  trashedModelIds: readonly string[];
}>;

export type ModelPseudocodeNormalizeResult = Readonly<{
  model: ModelSpec;
  pseudocode: string;
  trace: readonly string[];
}>;

export type ModelPseudocodeUpdateDecision =
  | Readonly<{
      kind: 'commit';
      model: ModelSpec;
      pseudocode: string;
    }>
  | Readonly<{
      kind: 'normalize';
      reason: string;
    }>;

export type ModelPseudocodeLineDiffSummary = Readonly<{
  originalLines: number;
  normalizedLines: number;
  addedLines: number;
  removedLines: number;
}>;

export type ModelPseudocodeLineDiffHunk = Readonly<{
  id: string;
  originalStart: number;
  originalEnd: number;
  proposedStart: number;
  proposedEnd: number;
  originalLines: readonly string[];
  proposedLines: readonly string[];
}>;

export type ModelPseudocodeBlockChange = Readonly<{
  id: string;
  name: string;
  fields: readonly string[];
}>;

export type ModelPseudocodeChangeSummary = Readonly<{
  addedBlocks: readonly string[];
  removedBlocks: readonly string[];
  changedBlocks: readonly ModelPseudocodeBlockChange[];
  connectionChanges: readonly string[];
  lines: readonly string[];
}>;

function pseudocodeShape(shape: readonly (number | string)[]) {
  return `[${shape.join(', ')}]`;
}

function textBlock(name: string, value: string) {
  return [`  ${name}: |`, ...value.split(/\r?\n/).map((line) => `    ${line}`)];
}

function pseudocodePort(
  field: 'input_port' | 'output_port',
  port: NonNullable<ModelSpec['modules'][number]['inputPorts']>[number],
) {
  return `  ${field}: ${port.binding ?? 'internal'} | ${JSON.stringify(port.name)} | ${pseudocodeShape(port.shape)}${port.bindingId ? ` | ${JSON.stringify(port.bindingId)}` : ''}`;
}

export function modelToPseudocode(model: ModelSpec) {
  const lines: string[] = [
    MODEL_PSEUDOCODE_HEADER,
    '# Human-editable architecture source. Indented | blocks may contain equations or pseudocode.',
    '# One BLOCK is one human-scale architectural unit; keep atomic operations together in do:.',
    '# BLOCK order controls layout unless an optional position is provided.',
    '',
    `MODEL ${model.id} ${JSON.stringify(model.name)}`,
    `  version: ${model.version}`,
    `  framework: ${model.framework}`,
    `  source: ${model.sourceLabel}`,
    ...model.sourceArtifacts.map(
      (artifact) =>
        `  artifact: ${artifact.verified ? 'verified' : 'unverified'} | ${artifact.path}`,
    ),
    ...textBlock('summary', model.summary),
    ...textBlock('intent', model.intent.statement),
    ...model.intent.invariants.flatMap((invariant) => textBlock('invariant', invariant)),
    `  input: ${pseudocodeShape(model.intent.expectedInput)}`,
    `  output: ${pseudocodeShape(model.intent.expectedOutput)}`,
    'END MODEL',
    '',
  ];
  for (const [moduleIndex, module] of model.modules.entries()) {
    lines.push(
      `BLOCK ${module.id} ${JSON.stringify(module.name)}`,
      `  input: ${pseudocodeShape(module.inputShape)}`,
      `  output: ${pseudocodeShape(module.outputShape)}`,
      ...(module.inputPorts?.map((port) => pseudocodePort('input_port', port)) ?? []),
      ...(module.outputPorts?.map((port) => pseudocodePort('output_port', port)) ?? []),
      ...textBlock('do', module.transform),
      ...(module.formula.trim() ? textBlock('math', module.formula) : []),
      ...(module.repeat
        ? [`  repeat: ${JSON.stringify(module.repeat.count)} | ${module.repeat.label}`]
        : []),
      ...(module.kind === 'linear' ? [] : [`  kind: ${module.kind}`]),
      ...(module.group === module.name ? [] : [`  group: ${module.group}`]),
      ...(module.stage === moduleIndex && module.lane === 0
        ? []
        : [`  position: ${module.stage}, ${module.lane}`]),
      ...(module.activation ? [`  activation: ${module.activation}`] : []),
      ...(module.parameterCount > 0 ? [`  parameters: ${module.parameterCount}`] : []),
      ...(module.codeReference && module.codeReference !== model.sourceLabel
        ? [`  code: ${module.codeReference}`]
        : []),
      ...(module.explanation.trim() && module.explanation.trim() !== module.transform.trim()
        ? textBlock('notes', module.explanation)
        : []),
      ...(module.block
        ? [
            `  block: ${module.block.id} | ${JSON.stringify(module.block.repeatCount)} | ${module.block.label}`,
          ]
        : []),
      ...(module.subgraph ? [`  subgraph: ${module.subgraph.modelId}`] : []),
      'END BLOCK',
      '',
    );
  }
  for (const connection of model.connections) {
    lines.push(
      `CONNECT ${connection.id} ${connection.source} -> ${connection.target} AS ${JSON.stringify(connection.tensorName)} ${pseudocodeShape(connection.shape)}${connection.sourcePort || connection.targetPort ? ` PORTS ${connection.sourcePort ? JSON.stringify(connection.sourcePort) : 'null'} -> ${connection.targetPort ? JSON.stringify(connection.targetPort) : 'null'}` : ''} GRADIENT ${connection.expectedToCarryGradient ? 'yes' : 'no'} NORM ${Number.isFinite(connection.activationNorm) ? connection.activationNorm : 0}`,
      '',
    );
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function record(line: string, directive: string, lineNumber: number) {
  try {
    const value: unknown = JSON.parse(line.slice(directive.length).trim());
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('record must be a JSON object');
    }
    return value as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'invalid JSON';
    throw new Error(`Line ${lineNumber}: ${directive.trim()} record is invalid (${detail}).`, {
      cause: error,
    });
  }
}

type PseudocodeFields = ReadonlyMap<string, readonly string[]>;

function fieldsFrom(
  lines: readonly string[],
  startIndex: number,
  endDirective: string,
): Readonly<{ fields: PseudocodeFields; nextIndex: number }> {
  const fields = new Map<string, string[]>();
  let index = startIndex;
  while (index < lines.length) {
    const rawLine = lines[index]!;
    if (rawLine.trim() === endDirective) return { fields, nextIndex: index + 1 };
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) {
      index += 1;
      continue;
    }
    const match = /^ {2}([a-z_]+):(?: (.*))?$/.exec(rawLine);
    if (!match)
      throw new Error(`Line ${index + 1}: expected an indented field or ${endDirective}.`);
    const name = match[1]!;
    let value = match[2] ?? '';
    index += 1;
    if (value === '|') {
      const block: string[] = [];
      while (index < lines.length) {
        const blockLine = lines[index]!;
        if (blockLine.startsWith('    ')) {
          block.push(blockLine.slice(4));
          index += 1;
        } else if (!blockLine.trim()) {
          block.push('');
          index += 1;
        } else {
          break;
        }
      }
      value = block.join('\n').trimEnd();
    }
    fields.set(name, [...(fields.get(name) ?? []), value]);
  }
  throw new Error(`${endDirective} is required.`);
}

function requiredField(fields: PseudocodeFields, name: string) {
  const values = fields.get(name);
  if (!values || values.length !== 1 || !values[0]?.trim()) {
    throw new Error(`${name} must appear exactly once and cannot be empty.`);
  }
  return values[0].trim();
}

function optionalField(fields: PseudocodeFields, name: string, fallback: string) {
  const values = fields.get(name);
  if (!values || values.length === 0) return fallback;
  if (values.length > 1) throw new Error(`${name} may appear only once.`);
  return values[0]!.trim();
}

function aliasedField(fields: PseudocodeFields, names: readonly string[], fallback?: string) {
  const populated = names.flatMap((name) =>
    (fields.get(name) ?? []).map((value) => ({ name, value: value.trim() })),
  );
  if (populated.length === 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${names.join(' or ')} must appear exactly once and cannot be empty.`);
  }
  if (populated.length > 1 || !populated[0]?.value) {
    throw new Error(`Use exactly one of ${names.join(' or ')} and keep it non-empty.`);
  }
  return populated[0].value;
}

function numberField(fields: PseudocodeFields, name: string) {
  const value = Number(requiredField(fields, name));
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

function optionalNumberField(fields: PseudocodeFields, name: string, fallback: number) {
  const source = optionalField(fields, name, String(fallback));
  const value = Number(source);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

function pseudocodeShapeValue(value: string, name: string) {
  if (!value.startsWith('[') || !value.endsWith(']')) {
    throw new Error(`${name} must use [dim, dim] shape syntax.`);
  }
  return value
    .slice(1, -1)
    .split(',')
    .map((dimension) => dimension.trim())
    .filter(Boolean)
    .map((dimension) => (/^[1-9]\d*$/.test(dimension) ? Number(dimension) : dimension));
}

function shapeField(fields: PseudocodeFields, name: string) {
  return pseudocodeShapeValue(requiredField(fields, name), name);
}

function portFields(fields: PseudocodeFields, name: 'input_port' | 'output_port') {
  const values = fields.get(name) ?? [];
  return values.map((value, index) => {
    const match =
      /^(internal|external|loop-carried) \| ("(?:[^"\\]|\\.)*") \| (\[[^\]]+\])(?: \| ("(?:[^"\\]|\\.)*"))?$/u.exec(
        value.trim(),
      );
    if (!match) {
      throw new Error(`${name}[${index}] must use binding | "name" | [dim, dim] syntax.`);
    }
    return {
      binding: match[1] as 'internal' | 'external' | 'loop-carried',
      name: JSON.parse(match[2]!) as string,
      shape: pseudocodeShapeValue(match[3]!, `${name}[${index}] shape`),
      ...(match[4] ? { bindingId: JSON.parse(match[4]) as string } : {}),
    };
  });
}

function positionField(fields: PseudocodeFields, defaultStage: number) {
  const source = optionalField(fields, 'position', `${defaultStage}, 0`);
  const match = /^(\d+)\s*,\s*(-?\d+(?:\.\d+)?)$/u.exec(source);
  if (!match) throw new Error('position must use integer-stage, numeric-lane syntax.');
  return { stage: Number(match[1]), lane: Number(match[2]) };
}

function quotedName(source: string, directive: string, lineNumber: number) {
  const match = new RegExp(`^${directive} ([A-Za-z0-9_.:-]+) ("(?:[^"\\\\]|\\\\.)*")$`).exec(
    source,
  );
  if (!match) throw new Error(`Line ${lineNumber}: malformed ${directive} header.`);
  return { id: match[1]!, name: JSON.parse(match[2]!) as string };
}

function repeatField(value: string) {
  if (value === 'none') return null;
  const separator = value.indexOf(' | ');
  if (separator < 0) throw new Error('repeat must be none or count | label.');
  const countSource = value.slice(0, separator);
  let count: number | string;
  try {
    count = JSON.parse(countSource) as number | string;
  } catch {
    count = countSource;
  }
  return { count, label: value.slice(separator + 3).trim() };
}

function blockField(value: string) {
  if (value === 'none') return null;
  const [id, countSource, ...labelParts] = value.split(' | ');
  if (!id || !countSource || labelParts.length === 0) {
    throw new Error('block must be none or id | repeatCount | label.');
  }
  let repeatCount: number | string;
  try {
    repeatCount = JSON.parse(countSource) as number | string;
  } catch {
    repeatCount = countSource;
  }
  return { id, repeatCount, label: labelParts.join(' | ') };
}

function validatedPseudocodeModel(raw: Record<string, unknown>, expectedModelId?: string) {
  const parsed = parseModelImportJson(JSON.stringify({ schemaVersion: 1, ...raw }));
  if (!parsed.ok) return parsed;
  if (expectedModelId && parsed.model.id !== expectedModelId) {
    return {
      ok: false as const,
      reason: `MODEL id must remain “${expectedModelId}” inside this revision tree.`,
    };
  }
  return { ok: true as const, model: parsed.model, normalized: modelToPseudocode(parsed.model) };
}

function parseV1(lines: readonly string[], expectedModelId?: string): ModelPseudocodeParseResult {
  let modelRecord: Record<string, unknown> | null = null;
  let intentRecord: Record<string, unknown> | null = null;
  const modules: Record<string, unknown>[] = [];
  const connections: Record<string, unknown>[] = [];
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('MODEL ')) modelRecord = record(line, 'MODEL ', index + 1);
    else if (line.startsWith('INTENT ')) intentRecord = record(line, 'INTENT ', index + 1);
    else if (line.startsWith('MODULE ')) modules.push(record(line, 'MODULE ', index + 1));
    else if (line.startsWith('CONNECT ')) connections.push(record(line, 'CONNECT ', index + 1));
    else throw new Error(`Line ${index + 1}: unsupported v1 directive.`);
  }
  if (!modelRecord || !intentRecord || modules.length === 0) {
    throw new Error('v1 pseudocode requires MODEL, INTENT, and MODULE records.');
  }
  return validatedPseudocodeModel(
    { ...modelRecord, intent: intentRecord, modules, connections },
    expectedModelId,
  );
}

function parseV2(lines: readonly string[], expectedModelId?: string): ModelPseudocodeParseResult {
  let index = 0;
  let modelRecord: Record<string, unknown> | null = null;
  const modules: Record<string, unknown>[] = [];
  const connections: Record<string, unknown>[] = [];
  while (index < lines.length) {
    const line = lines[index]!.trim();
    if (!line || line.startsWith('#')) {
      index += 1;
      continue;
    }
    if (line.startsWith('MODEL ')) {
      if (modelRecord) throw new Error(`Line ${index + 1}: MODEL may appear only once.`);
      const header = quotedName(line, 'MODEL', index + 1);
      const block = fieldsFrom(lines, index + 1, 'END MODEL');
      const artifacts = (block.fields.get('artifact') ?? []).map((value) => {
        const separator = value.indexOf(' | ');
        if (separator < 0) throw new Error('artifact must use verified | path syntax.');
        return {
          verified: value.slice(0, separator).trim() === 'verified',
          path: value.slice(separator + 3).trim(),
        };
      });
      modelRecord = {
        id: header.id,
        name: header.name,
        version: requiredField(block.fields, 'version'),
        framework: requiredField(block.fields, 'framework'),
        sourceLabel: requiredField(block.fields, 'source'),
        sourceArtifacts: artifacts,
        summary: requiredField(block.fields, 'summary'),
        intent: {
          statement: requiredField(block.fields, 'intent'),
          invariants: [...(block.fields.get('invariant') ?? [])],
          expectedInput: shapeField(block.fields, 'input'),
          expectedOutput: shapeField(block.fields, 'output'),
        },
      };
      index = block.nextIndex;
    } else if (line.startsWith('MODULE ') || line.startsWith('BLOCK ')) {
      const directive = line.startsWith('BLOCK ') ? 'BLOCK' : 'MODULE';
      const header = quotedName(line, directive, index + 1);
      const block = fieldsFrom(lines, index + 1, `END ${directive}`);
      const transform = aliasedField(block.fields, ['do', 'transform']);
      const position = block.fields.has('position')
        ? positionField(block.fields, modules.length)
        : {
            stage: optionalNumberField(block.fields, 'stage', modules.length),
            lane: optionalNumberField(block.fields, 'lane', 0),
          };
      const repeat = repeatField(optionalField(block.fields, 'repeat', 'none'));
      const compositeBlock = blockField(optionalField(block.fields, 'block', 'none'));
      const subgraph = optionalField(block.fields, 'subgraph', 'none');
      const activation = optionalField(block.fields, 'activation', 'none');
      const defaultCodeReference =
        modelRecord && typeof modelRecord.sourceLabel === 'string'
          ? modelRecord.sourceLabel
          : 'human pseudocode';
      modules.push({
        id: header.id,
        name: header.name,
        kind: optionalField(block.fields, 'kind', 'linear'),
        group: optionalField(block.fields, 'group', header.name),
        stage: position.stage,
        lane: position.lane,
        inputShape: shapeField(block.fields, 'input'),
        outputShape: shapeField(block.fields, 'output'),
        ...(block.fields.has('input_port')
          ? { inputPorts: portFields(block.fields, 'input_port') }
          : {}),
        ...(block.fields.has('output_port')
          ? { outputPorts: portFields(block.fields, 'output_port') }
          : {}),
        transform,
        activation: activation === 'none' ? null : activation,
        formula: aliasedField(block.fields, ['math', 'equation'], transform),
        explanation: optionalField(block.fields, 'notes', transform),
        parameterCount: optionalNumberField(block.fields, 'parameters', 0),
        codeReference: optionalField(block.fields, 'code', defaultCodeReference),
        repeat,
        block: compositeBlock,
        ...(subgraph === 'none' ? {} : { subgraph: { modelId: subgraph } }),
      });
      index = block.nextIndex;
    } else if (line.startsWith('CONNECT ')) {
      const compactMatch =
        /^CONNECT ([A-Za-z0-9_.:-]+) ([A-Za-z0-9_.:-]+) -> ([A-Za-z0-9_.:-]+) AS ("(?:[^"\\]|\\.)*") (\[[^\]]+\])(?: PORTS ((?:"(?:[^"\\]|\\.)*"|null)) -> ((?:"(?:[^"\\]|\\.)*"|null)))? GRADIENT (yes|no)(?: NORM ([+\-\d.eE]+))?$/.exec(
          line,
        );
      if (compactMatch) {
        const activationNorm = Number(compactMatch[9] ?? 0);
        if (!Number.isFinite(activationNorm) || activationNorm < 0) {
          throw new Error(`Line ${index + 1}: connection NORM must be non-negative.`);
        }
        connections.push({
          id: compactMatch[1],
          source: compactMatch[2],
          target: compactMatch[3],
          tensorName: JSON.parse(compactMatch[4]!) as string,
          shape: pseudocodeShapeValue(compactMatch[5]!, 'connection shape'),
          ...(compactMatch[6] && compactMatch[6] !== 'null'
            ? { sourcePort: JSON.parse(compactMatch[6]) as string }
            : {}),
          ...(compactMatch[7] && compactMatch[7] !== 'null'
            ? { targetPort: JSON.parse(compactMatch[7]) as string }
            : {}),
          expectedToCarryGradient: compactMatch[8] === 'yes',
          activationNorm,
        });
        index += 1;
        continue;
      }
      const match = /^CONNECT ([A-Za-z0-9_.:-]+) ([A-Za-z0-9_.:-]+) -> ([A-Za-z0-9_.:-]+)$/.exec(
        line,
      );
      if (!match) throw new Error(`Line ${index + 1}: malformed CONNECT header.`);
      const block = fieldsFrom(lines, index + 1, 'END CONNECT');
      const sourcePort = optionalField(block.fields, 'source_port', 'none');
      const targetPort = optionalField(block.fields, 'target_port', 'none');
      connections.push({
        id: match[1],
        source: match[2],
        target: match[3],
        ...(sourcePort === 'none' ? {} : { sourcePort }),
        ...(targetPort === 'none' ? {} : { targetPort }),
        tensorName: requiredField(block.fields, 'tensor'),
        shape: shapeField(block.fields, 'shape'),
        activationNorm: numberField(block.fields, 'activation_norm'),
        expectedToCarryGradient: requiredField(block.fields, 'carries_gradient') === 'true',
      });
      index = block.nextIndex;
    } else {
      throw new Error(
        `Line ${index + 1}: expected MODEL, BLOCK, legacy MODULE, CONNECT, or a # comment.`,
      );
    }
  }
  if (!modelRecord || modules.length === 0) {
    throw new Error('MODEL and at least one BLOCK are required.');
  }
  return validatedPseudocodeModel({ ...modelRecord, modules, connections }, expectedModelId);
}

export function parseModelPseudocode(
  source: string,
  expectedModelId?: string,
): ModelPseudocodeParseResult {
  if (source.length > MODEL_PSEUDOCODE_MAX_CHARACTERS) {
    return {
      ok: false,
      reason: `Pseudocode exceeds ${MODEL_PSEUDOCODE_MAX_CHARACTERS.toLocaleString()} characters.`,
    };
  }
  const lines = source.split(/\r?\n/);
  if (lines.length > MODEL_PSEUDOCODE_MAX_RECORDS) {
    return { ok: false, reason: `Pseudocode exceeds ${MODEL_PSEUDOCODE_MAX_RECORDS} lines.` };
  }
  try {
    const header = lines.find((line) => line.trim())?.trim();
    if (header === MODEL_PSEUDOCODE_V1_HEADER) return parseV1(lines, expectedModelId);
    if (header === MODEL_PSEUDOCODE_HEADER) return parseV2(lines, expectedModelId);
    return {
      ok: false,
      reason: `The first line must be “${MODEL_PSEUDOCODE_HEADER}”.`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Pseudocode is invalid.',
    };
  }
}

export function createModelPseudocodeNormalizer(fetchImpl: typeof fetch = modelLabFetch) {
  return {
    async normalize(input: {
      baseModel: ModelSpec;
      source: string;
      selection: ModelLabModelSelection;
      signal?: AbortSignal;
    }): Promise<ModelPseudocodeNormalizeResult> {
      const response = await fetchImpl(MODEL_PSEUDOCODE_NORMALIZE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseModel: input.baseModel,
          source: input.source,
          selection: input.selection,
        }),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        const detail =
          payload && typeof payload === 'object' && 'detail' in payload
            ? String(payload.detail)
            : 'model_pseudocode_normalizer_unavailable';
        throw new Error(detail);
      }
      const result = payload as { model?: unknown; trace?: unknown };
      const parsed = parseModelImportJson(JSON.stringify(result.model));
      if (!parsed.ok) throw new Error(`Normalized ModelIR was invalid: ${parsed.reason}`);
      if (parsed.model.id !== input.baseModel.id) {
        throw new Error('Normalized model changed the stable model id.');
      }
      if (!Array.isArray(result.trace) || !result.trace.every((item) => typeof item === 'string')) {
        throw new Error('Normalizer trace was invalid.');
      }
      return {
        model: parsed.model,
        pseudocode: modelToPseudocode(parsed.model),
        trace: result.trace,
      };
    },
    async reconcileNarrative(input: {
      baseModel: ModelSpec;
      intendedModel: ModelSpec;
      moduleIds: readonly string[];
      selection: ModelLabModelSelection;
      signal?: AbortSignal;
    }): Promise<ModelPseudocodeNormalizeResult> {
      const response = await fetchImpl(MODEL_PSEUDOCODE_RECONCILE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseModel: input.baseModel,
          intendedModel: input.intendedModel,
          moduleIds: input.moduleIds,
          selection: input.selection,
        }),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        const detail =
          payload && typeof payload === 'object' && 'detail' in payload
            ? String(payload.detail)
            : 'model_pseudocode_reconciliation_unavailable';
        throw new Error(detail);
      }
      const result = payload as { model?: unknown; trace?: unknown };
      const parsed = parseModelImportJson(JSON.stringify(result.model));
      if (!parsed.ok) throw new Error(`Reconciled ModelIR was invalid: ${parsed.reason}`);
      if (parsed.model.id !== input.baseModel.id) {
        throw new Error('Reconciled model changed the stable model id.');
      }
      if (!Array.isArray(result.trace) || !result.trace.every((item) => typeof item === 'string')) {
        throw new Error('Reconciliation trace was invalid.');
      }
      return {
        model: parsed.model,
        pseudocode: modelToPseudocode(parsed.model),
        trace: result.trace,
      };
    },
  };
}

export const modelPseudocodeNormalizer = createModelPseudocodeNormalizer();

export function classifyModelPseudocodeUpdate(
  source: string,
  expectedModelId: string,
): ModelPseudocodeUpdateDecision {
  const parsed = parseModelPseudocode(source, expectedModelId);
  return parsed.ok
    ? { kind: 'commit', model: parsed.model, pseudocode: parsed.normalized }
    : { kind: 'normalize', reason: parsed.reason };
}

function pseudocodeLines(source: string) {
  return source.replace(/\r\n?/gu, '\n').split('\n');
}

export function modelPseudocodeLineDiffHunks(original: string, proposed: string) {
  const originalLines = pseudocodeLines(original);
  const proposedLines = pseudocodeLines(proposed);
  let prefix = 0;
  while (
    prefix < originalLines.length &&
    prefix < proposedLines.length &&
    originalLines[prefix] === proposedLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < originalLines.length - prefix &&
    suffix < proposedLines.length - prefix &&
    originalLines[originalLines.length - 1 - suffix] ===
      proposedLines[proposedLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (prefix === originalLines.length && prefix === proposedLines.length) return [];

  const uniqueLinePositions = (lines: readonly string[], start: number, end: number) => {
    const positions = new Map<string, number[]>();
    for (let index = start; index < end; index += 1) {
      const line = lines[index]!;
      positions.set(line, [...(positions.get(line) ?? []), index]);
    }
    return positions;
  };
  const originalEnd = originalLines.length - suffix;
  const proposedEnd = proposedLines.length - suffix;
  const originalPositions = uniqueLinePositions(originalLines, prefix, originalEnd);
  const proposedPositions = uniqueLinePositions(proposedLines, prefix, proposedEnd);
  const pairs = [...originalPositions.entries()]
    .flatMap(([line, positions]) => {
      const other = proposedPositions.get(line);
      return positions.length === 1 && other?.length === 1
        ? [{ original: positions[0]!, proposed: other[0]! }]
        : [];
    })
    .sort((left, right) => left.original - right.original);

  const tails: number[] = [];
  const previous = Array.from({ length: pairs.length }, () => -1);
  for (let index = 0; index < pairs.length; index += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (pairs[tails[middle]!]!.proposed < pairs[index]!.proposed) low = middle + 1;
      else high = middle;
    }
    previous[index] = low > 0 ? tails[low - 1]! : -1;
    tails[low] = index;
  }
  const anchors: Array<{ original: number; proposed: number }> = [];
  let cursor = tails.at(-1) ?? -1;
  while (cursor >= 0) {
    anchors.push(pairs[cursor]!);
    cursor = previous[cursor]!;
  }
  anchors.reverse();

  const hunks: ModelPseudocodeLineDiffHunk[] = [];
  let previousOriginal = prefix - 1;
  let previousProposed = prefix - 1;
  for (const anchor of [...anchors, { original: originalEnd, proposed: proposedEnd }]) {
    const originalStartIndex = previousOriginal + 1;
    const proposedStartIndex = previousProposed + 1;
    const originalEndIndex = anchor.original - 1;
    const proposedEndIndex = anchor.proposed - 1;
    if (originalStartIndex <= originalEndIndex || proposedStartIndex <= proposedEndIndex) {
      hunks.push({
        id: `hunk-${hunks.length + 1}`,
        originalStart: originalStartIndex + 1,
        originalEnd: originalEndIndex + 1,
        proposedStart: proposedStartIndex + 1,
        proposedEnd: proposedEndIndex + 1,
        originalLines: originalLines.slice(originalStartIndex, originalEndIndex + 1),
        proposedLines: proposedLines.slice(proposedStartIndex, proposedEndIndex + 1),
      });
    }
    previousOriginal = anchor.original;
    previousProposed = anchor.proposed;
  }
  return hunks;
}

export function modelPseudocodeLineDiffSummary(
  original: string,
  proposed: string,
): ModelPseudocodeLineDiffSummary {
  const originalLines = pseudocodeLines(original);
  const proposedLines = pseudocodeLines(proposed);
  const hunks = modelPseudocodeLineDiffHunks(original, proposed);
  return {
    originalLines: originalLines.length,
    normalizedLines: proposedLines.length,
    addedLines: hunks.reduce((total, hunk) => total + hunk.proposedLines.length, 0),
    removedLines: hunks.reduce((total, hunk) => total + hunk.originalLines.length, 0),
  };
}

const moduleChangeFields = [
  ['name', 'name'],
  ['kind', 'kind'],
  ['group', 'group'],
  ['stage', 'position'],
  ['lane', 'position'],
  ['inputShape', 'input shape'],
  ['outputShape', 'output shape'],
  ['inputPorts', 'input ports'],
  ['outputPorts', 'output ports'],
  ['transform', 'transform'],
  ['activation', 'activation'],
  ['formula', 'formula'],
  ['explanation', 'explanation'],
  ['parameterCount', 'parameters'],
  ['codeReference', 'code reference'],
  ['repeat', 'repeat'],
  ['block', 'block composition'],
  ['subgraph', 'subgraph'],
] as const;

export function modelPseudocodeChangeSummary(
  previousModel: ModelSpec,
  nextModel: ModelSpec,
): ModelPseudocodeChangeSummary {
  const previousModules = new Map(previousModel.modules.map((module) => [module.id, module]));
  const nextModules = new Map(nextModel.modules.map((module) => [module.id, module]));
  const addedBlocks = nextModel.modules
    .filter((module) => !previousModules.has(module.id))
    .map((module) => module.id);
  const removedBlocks = previousModel.modules
    .filter((module) => !nextModules.has(module.id))
    .map((module) => module.id);
  const changedBlocks = nextModel.modules.flatMap((module) => {
    const previous = previousModules.get(module.id);
    if (!previous) return [];
    const fields = [
      ...new Set(
        moduleChangeFields.flatMap(([field, label]) =>
          JSON.stringify(previous[field]) === JSON.stringify(module[field]) ? [] : [label],
        ),
      ),
    ];
    return fields.length > 0 ? [{ id: module.id, name: module.name, fields }] : [];
  });
  const staticConnection = (connection: ModelSpec['connections'][number]) => ({
    source: connection.source,
    target: connection.target,
    tensorName: connection.tensorName,
    shape: connection.shape,
    expectedToCarryGradient: connection.expectedToCarryGradient,
  });
  const previousConnections = new Map(
    previousModel.connections.map((connection) => [connection.id, staticConnection(connection)]),
  );
  const nextConnections = new Map(
    nextModel.connections.map((connection) => [connection.id, staticConnection(connection)]),
  );
  const connectionChanges = [
    ...nextModel.connections.flatMap((connection) => {
      const previous = previousConnections.get(connection.id);
      if (!previous) return [`added ${connection.id}`];
      return JSON.stringify(previous) === JSON.stringify(nextConnections.get(connection.id))
        ? []
        : [`changed ${connection.id}`];
    }),
    ...previousModel.connections
      .filter((connection) => !nextConnections.has(connection.id))
      .map((connection) => `removed ${connection.id}`),
  ];
  const lines = [
    ...(addedBlocks.length > 0 ? [`Added blocks: ${addedBlocks.join(', ')}`] : []),
    ...(removedBlocks.length > 0 ? [`Removed blocks: ${removedBlocks.join(', ')}`] : []),
    ...changedBlocks.map(
      (change) => `Changed ${change.name} (${change.id}): ${change.fields.join(', ')}`,
    ),
    ...(connectionChanges.length > 0 ? [`Connections: ${connectionChanges.join(', ')}`] : []),
  ];
  return {
    addedBlocks,
    removedBlocks,
    changedBlocks,
    connectionChanges,
    lines: lines.length > 0 ? lines : ['No architecture fields changed.'],
  };
}

export function modelPseudocodeNarrativeReconciliationIssues(
  previousModel: ModelSpec,
  nextModel: ModelSpec,
) {
  const summary = modelPseudocodeChangeSummary(previousModel, nextModel);
  const narrativeFields = new Set(['transform', 'formula', 'explanation']);
  const computationalFields = new Set([
    'input shape',
    'output shape',
    'transform',
    'activation',
    'formula',
    'repeat',
    'block composition',
    'subgraph',
  ]);
  return summary.changedBlocks.flatMap((change) => {
    const changedNarrative = change.fields.filter((field) => narrativeFields.has(field));
    const computationChanged = change.fields.some((field) => computationalFields.has(field));
    if (!computationChanged || changedNarrative.length === 3) return [];
    const missing = [...narrativeFields].filter((field) => !changedNarrative.includes(field));
    return [
      `${change.name} (${change.id}) changed ${change.fields.join(', ')}, but ${missing.join(' and ')} did not change with it.`,
    ];
  });
}

export function modelPseudocodeNarrativeReconciliationModuleIds(
  previousModel: ModelSpec,
  nextModel: ModelSpec,
) {
  const issueText = modelPseudocodeNarrativeReconciliationIssues(previousModel, nextModel);
  return modelPseudocodeChangeSummary(previousModel, nextModel)
    .changedBlocks.filter((change) => issueText.some((issue) => issue.includes(`(${change.id})`)))
    .map((change) => change.id);
}

export function modelPseudocodeRevisionCommentPrompt(input: {
  previousModel: ModelSpec;
  nextModel: ModelSpec;
  fromRevision: number;
  toRevision: number;
}) {
  const previousModules = new Map(input.previousModel.modules.map((module) => [module.id, module]));
  const nextModules = new Map(input.nextModel.modules.map((module) => [module.id, module]));
  const addedModules = [...nextModules.keys()].filter((id) => !previousModules.has(id));
  const removedModules = [...previousModules.keys()].filter((id) => !nextModules.has(id));
  const changedModules = [...nextModules.entries()]
    .filter(([id, module]) => {
      const previous = previousModules.get(id);
      return previous !== undefined && JSON.stringify(previous) !== JSON.stringify(module);
    })
    .map(([id]) => id);
  const connectionSignature = (model: ModelSpec) =>
    model.connections.map((connection) => ({
      id: connection.id,
      source: connection.source,
      target: connection.target,
      tensorName: connection.tensorName,
      shape: connection.shape,
      expectedToCarryGradient: connection.expectedToCarryGradient,
    }));
  const lineDiff = modelPseudocodeLineDiffSummary(
    modelToPseudocode(input.previousModel),
    modelToPseudocode(input.nextModel),
  );
  return [
    `새 Model pseudocode revision r${input.toRevision}이 r${input.fromRevision}에서 생성되었습니다.`,
    '변경된 architecture를 검토하고 다음을 한국어로 간결하게 comment하세요:',
    '1. 사용자의 model intent와 일치하는 핵심 변경',
    '2. tensor shape·연결·반복 Block·FiLM/conditioning consistency 위험',
    '3. gradient가 막히거나 관측되지 않을 수 있는 경계',
    '관측되지 않은 runtime 결과를 추측하지 말고, 추가 수정 proposal은 만들지 마세요.',
    '',
    `Pseudocode line diff: +${lineDiff.addedLines} / -${lineDiff.removedLines}`,
    `Modules: ${input.previousModel.modules.length} -> ${input.nextModel.modules.length}`,
    `Added modules: ${addedModules.slice(0, 20).join(', ') || 'none'}`,
    `Removed modules: ${removedModules.slice(0, 20).join(', ') || 'none'}`,
    `Changed modules: ${changedModules.slice(0, 20).join(', ') || 'none'}`,
    `Connections changed: ${JSON.stringify(connectionSignature(input.previousModel)) !== JSON.stringify(connectionSignature(input.nextModel)) ? 'yes' : 'no'}`,
  ].join('\n');
}

export function initialModelPseudocodeRevision(
  model: ModelSpec,
  createdAt = new Date().toISOString(),
): ModelPseudocodeRevision {
  return {
    revision: 0,
    parentRevision: null,
    createdAt,
    label: 'Imported model',
    model,
    pseudocode: modelToPseudocode(model),
  };
}

export function appendModelPseudocodeRevision(
  history: readonly ModelPseudocodeRevision[],
  input: Readonly<{
    parentRevision: number;
    model: ModelSpec;
    pseudocode: string;
    originalDraft?: string;
    createdAt?: string;
    label?: string;
  }>,
): readonly ModelPseudocodeRevision[] {
  if (!history.some((revision) => revision.revision === input.parentRevision)) {
    throw new Error('model_pseudocode_parent_revision_missing');
  }
  const revision = Math.max(-1, ...history.map((candidate) => candidate.revision)) + 1;
  return [
    ...history,
    {
      revision,
      parentRevision: input.parentRevision,
      createdAt: input.createdAt ?? new Date().toISOString(),
      label: input.label ?? 'Pseudocode update',
      model: input.model,
      pseudocode: input.pseudocode,
      ...(input.originalDraft ? { originalDraft: input.originalDraft } : {}),
    },
  ];
}

export function attachModelPythonArtifact(
  history: readonly ModelPseudocodeRevision[],
  revisionNumber: number,
  receipt: ModelPythonArtifactReceipt,
) {
  const revision = history.find((candidate) => candidate.revision === revisionNumber);
  if (!revision) throw new Error('model_python_revision_missing');
  if (receipt.modelId !== revision.model.id || receipt.revision !== revisionNumber) {
    throw new Error('model_python_receipt_scope_mismatch');
  }
  return history.map((candidate) =>
    candidate.revision === revisionNumber ? { ...candidate, pythonArtifact: receipt } : candidate,
  );
}

export function modelPseudocodeRevisionRows(
  history: readonly ModelPseudocodeRevision[],
): readonly ModelPseudocodeRevisionRow[] {
  const children = new Map<number | null, ModelPseudocodeRevision[]>();
  for (const revision of history) {
    const siblings = children.get(revision.parentRevision) ?? [];
    children.set(revision.parentRevision, [...siblings, revision]);
  }
  const rows: ModelPseudocodeRevisionRow[] = [];
  const visit = (parentRevision: number | null, depth: number, seen: Set<number>) => {
    for (const revision of [...(children.get(parentRevision) ?? [])].sort(
      (left, right) => left.revision - right.revision,
    )) {
      if (seen.has(revision.revision)) continue;
      seen.add(revision.revision);
      rows.push({ revision, depth });
      visit(revision.revision, depth + 1, seen);
    }
  };
  visit(null, 0, new Set());
  return rows;
}

export function initialModelPseudocodeWorkspace(
  models: readonly ModelSpec[],
): ModelPseudocodeWorkspace {
  const histories = Object.fromEntries(
    models.map((model) => [model.id, [initialModelPseudocodeRevision(model)]]),
  );
  return {
    models,
    histories,
    selectedRevisions: Object.fromEntries(models.map((model) => [model.id, 0])),
    activeModelId: models[0]?.id ?? '',
    trashedModelIds: [],
  };
}

type StoredRevision = Readonly<{
  revision: number;
  parentRevision: number | null;
  createdAt: string;
  label: string;
  pseudocode: string;
  originalDraft?: string;
  pythonArtifact?: ModelPythonArtifactReceipt;
}>;

export function serializeModelPseudocodeWorkspace(input: {
  histories: Readonly<Record<string, readonly ModelPseudocodeRevision[]>>;
  selectedRevisions: Readonly<Record<string, number>>;
  activeModelId: string;
  trashedModelIds: readonly string[];
}) {
  const value = JSON.stringify({
    schemaVersion: 1,
    activeModelId: input.activeModelId,
    trashedModelIds: input.trashedModelIds,
    selectedRevisions: input.selectedRevisions,
    histories: Object.fromEntries(
      Object.entries(input.histories).map(([modelId, history]) => [
        modelId,
        history.map(
          ({
            revision,
            parentRevision,
            createdAt,
            label,
            pseudocode,
            originalDraft,
            pythonArtifact,
          }): StoredRevision => ({
            revision,
            parentRevision,
            createdAt,
            label,
            pseudocode,
            ...(originalDraft ? { originalDraft } : {}),
            ...(pythonArtifact ? { pythonArtifact } : {}),
          }),
        ),
      ]),
    ),
  });
  if (value.length > MODEL_PSEUDOCODE_WORKSPACE_MAX_CHARACTERS) {
    throw new Error('model_pseudocode_workspace_too_large');
  }
  return value;
}

function validStoredRevision(value: unknown): value is StoredRevision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const revision = value as Partial<StoredRevision>;
  return (
    Number.isInteger(revision.revision) &&
    (revision.revision ?? -1) >= 0 &&
    (revision.parentRevision === null ||
      (Number.isInteger(revision.parentRevision) && (revision.parentRevision ?? -1) >= 0)) &&
    typeof revision.createdAt === 'string' &&
    Number.isFinite(Date.parse(revision.createdAt)) &&
    typeof revision.label === 'string' &&
    revision.label.length > 0 &&
    revision.label.length <= 120 &&
    typeof revision.pseudocode === 'string' &&
    (revision.originalDraft === undefined ||
      (typeof revision.originalDraft === 'string' &&
        revision.originalDraft.length <= MODEL_PSEUDOCODE_MAX_CHARACTERS)) &&
    (revision.pythonArtifact === undefined || isModelPythonArtifactReceipt(revision.pythonArtifact))
  );
}

export function restoreModelPseudocodeWorkspace(
  text: string | null,
  fallbackModels: readonly ModelSpec[],
  options: Readonly<{ allowEmpty?: boolean }> = {},
): ModelPseudocodeWorkspace {
  const fallback = initialModelPseudocodeWorkspace(fallbackModels);
  if (!text || text.length > MODEL_PSEUDOCODE_WORKSPACE_MAX_CHARACTERS) return fallback;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
    const snapshot = value as Record<string, unknown>;
    if (
      snapshot.schemaVersion !== 1 ||
      !snapshot.histories ||
      typeof snapshot.histories !== 'object'
    ) {
      return fallback;
    }
    const histories: Record<string, readonly ModelPseudocodeRevision[]> = {};
    for (const [modelId, candidateHistory] of Object.entries(
      snapshot.histories as Record<string, unknown>,
    ).slice(0, 64)) {
      if (!Array.isArray(candidateHistory) || candidateHistory.length === 0) continue;
      const revisions: ModelPseudocodeRevision[] = [];
      const seen = new Set<number>();
      for (const candidate of candidateHistory.slice(0, 100)) {
        if (!validStoredRevision(candidate) || seen.has(candidate.revision)) continue;
        if (candidate.parentRevision !== null && !seen.has(candidate.parentRevision)) continue;
        const parsed = parseModelPseudocode(candidate.pseudocode, modelId);
        if (!parsed.ok) continue;
        seen.add(candidate.revision);
        revisions.push({
          ...candidate,
          model: parsed.model,
          pseudocode: parsed.normalized,
        });
      }
      if (revisions.length > 0) histories[modelId] = revisions;
    }
    const modelIds = Object.keys(histories);
    if (modelIds.length === 0) return fallback;
    const selectedInput =
      snapshot.selectedRevisions &&
      typeof snapshot.selectedRevisions === 'object' &&
      !Array.isArray(snapshot.selectedRevisions)
        ? (snapshot.selectedRevisions as Record<string, unknown>)
        : {};
    const selectedRevisions: Record<string, number> = {};
    const models: ModelSpec[] = [];
    for (const modelId of modelIds) {
      const history = histories[modelId]!;
      const requested = selectedInput[modelId];
      const selected =
        typeof requested === 'number'
          ? history.find((revision) => revision.revision === requested)
          : undefined;
      const revision = selected ?? history[history.length - 1]!;
      selectedRevisions[modelId] = revision.revision;
      models.push(revision.model);
    }
    const trashedModelIds = Array.isArray(snapshot.trashedModelIds)
      ? snapshot.trashedModelIds.filter(
          (candidate): candidate is string =>
            typeof candidate === 'string' && modelIds.includes(candidate),
        )
      : [];
    const activeCandidates = modelIds.filter((modelId) => !trashedModelIds.includes(modelId));
    if (activeCandidates.length === 0 && !options.allowEmpty) return fallback;
    const activeModelId =
      typeof snapshot.activeModelId === 'string' &&
      activeCandidates.includes(snapshot.activeModelId)
        ? snapshot.activeModelId
        : (activeCandidates[0] ?? '');
    return { models, histories, selectedRevisions, activeModelId, trashedModelIds };
  } catch {
    return fallback;
  }
}
