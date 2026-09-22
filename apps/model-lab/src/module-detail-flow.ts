import { englishGraphName, graphCardSummary } from './graph-presentation';
import type { ModelModule, ModelSpec } from './model-lab-schema';
import { moduleExplanationKey } from './module-explanations';
import { pseudocodeStatementNames } from './repeat-step-description';

export type ModuleNeighbor = Readonly<{ module: ModelModule; tensorName: string }>;

/** Modules wired into (previous) and out of (next) this module in the graph being viewed. */
export function moduleDetailNeighbors(
  model: ModelSpec,
  moduleId: string,
): Readonly<{ previous: readonly ModuleNeighbor[]; next: readonly ModuleNeighbor[] }> {
  const byId = new Map(model.modules.map((module) => [module.id, module]));
  const collect = (direction: 'previous' | 'next') => {
    const seen = new Set<string>();
    const neighbors: ModuleNeighbor[] = [];
    for (const connection of model.connections) {
      const otherId =
        direction === 'previous'
          ? connection.target === moduleId
            ? connection.source
            : null
          : connection.source === moduleId
            ? connection.target
            : null;
      const other = otherId && otherId !== moduleId ? byId.get(otherId) : undefined;
      if (!other || seen.has(other.id)) continue;
      seen.add(other.id);
      neighbors.push({ module: other, tensorName: connection.tensorName });
    }
    return neighbors;
  };
  return { previous: collect('previous'), next: collect('next') };
}

export type ModuleFlowEntry = Readonly<{
  value: string;
  /** The module on the other end, when it is in this graph. */
  moduleId: string | null;
  origin:
    | 'connection'
    | 'step'
    | 'previous-iteration'
    | 'block-input'
    | 'next-iteration'
    | 'block-output';
}>;

export type ModuleFlow = Readonly<{
  kind: 'variables' | 'connections';
  incoming: readonly ModuleFlowEntry[];
  outgoing: readonly ModuleFlowEntry[];
}>;

const isLoopStep = (module: ModelModule) => module.id.startsWith('repeat-step:');

/**
 * Where this module's values come from and where they go. Inside an expanded loop the steps are
 * read as statements: a value comes from the last earlier step that wrote it, else from the
 * previous iteration (a later step writes it) or the block's input; a written value goes to the
 * later steps that read it before it is rewritten, else to the next iteration or the block
 * output. Other graphs use their connections.
 */
export function moduleDataFlow(model: ModelSpec, moduleId: string): ModuleFlow {
  const module = model.modules.find((candidate) => candidate.id === moduleId);
  if (module && isLoopStep(module)) {
    const steps = model.modules
      .filter(isLoopStep)
      .sort((left, right) => left.stage - right.stage || left.lane - right.lane);
    const names = steps.map((step) => pseudocodeStatementNames(step.transform));
    const index = steps.findIndex((step) => step.id === moduleId);
    const own = names[index];
    if (own) {
      const writers = (value: string, from: number, to: number) =>
        names
          .slice(from, to)
          .map((entry, offset) => (entry?.writes.includes(value) ? from + offset : -1))
          .filter((position) => position >= 0);
      const incoming = own.reads.map((value): ModuleFlowEntry => {
        const earlier = writers(value, 0, index).at(-1);
        if (earlier !== undefined) return { value, moduleId: steps[earlier]!.id, origin: 'step' };
        const later = writers(value, index, steps.length).at(-1);
        return later !== undefined
          ? { value, moduleId: steps[later]!.id, origin: 'previous-iteration' }
          : { value, moduleId: null, origin: 'block-input' };
      });
      const outgoing = own.writes.flatMap((value): ModuleFlowEntry[] => {
        const readers: ModuleFlowEntry[] = [];
        for (let position = index + 1; position < steps.length; position += 1) {
          const entry = names[position];
          if (entry?.reads.includes(value))
            readers.push({ value, moduleId: steps[position]!.id, origin: 'step' });
          if (entry?.writes.includes(value)) break;
        }
        if (readers.length > 0) return readers;
        const nextIteration = names
          .slice(0, index + 1)
          .findIndex((entry) => entry?.reads.includes(value));
        return nextIteration >= 0
          ? [{ value, moduleId: steps[nextIteration]!.id, origin: 'next-iteration' }]
          : [{ value, moduleId: null, origin: 'block-output' }];
      });
      return { kind: 'variables', incoming, outgoing };
    }
  }
  return {
    kind: 'connections',
    incoming: model.connections
      .filter((connection) => connection.target === moduleId)
      .map((connection) => ({
        value: connection.targetPort ?? connection.tensorName,
        moduleId: connection.source,
        origin: 'connection' as const,
      })),
    outgoing: model.connections
      .filter((connection) => connection.source === moduleId)
      .map((connection) => ({
        value: connection.sourcePort ?? connection.tensorName,
        moduleId: connection.target,
        origin: 'connection' as const,
      })),
  };
}

/** The top-level block an expanded loop step belongs to, from the loop graph's id. */
export function loopParentModule(topLevel: ModelSpec, graphModel: ModelSpec): ModelModule | null {
  const marker = '::repeat::';
  const at = graphModel.id.indexOf(marker);
  if (at < 0 || graphModel.id.slice(0, at) !== topLevel.id) return null;
  const parentId = graphModel.id.slice(at + marker.length);
  return topLevel.modules.find((module) => module.id === parentId) ?? null;
}

/** The module's own identity, source and data flow, prepended to every Assistant question here. */
function moduleContextLines(
  graphModel: ModelSpec,
  module: ModelModule,
  parent: ModelModule | null,
): string[] {
  const flow = moduleDataFlow(graphModel, module.id);
  const nameOf = (id: string | null) =>
    (id && graphModel.modules.find((candidate) => candidate.id === id)?.name) ?? id ?? 'outside';
  const flowLines = [
    ...flow.incoming.map(
      (entry) => `- in: ${entry.value} from ${nameOf(entry.moduleId)} (${entry.origin})`,
    ),
    ...flow.outgoing.map(
      (entry) => `- out: ${entry.value} to ${nameOf(entry.moduleId)} (${entry.origin})`,
    ),
  ];
  return [
    `Module: ${module.name} (${module.group}, id ${module.id})`,
    ...(parent
      ? [`Inside repeated block: ${parent.name} (id ${parent.id}), ${graphModel.summary}`]
      : []),
    `Source: ${module.transform}`,
    `Equation (LaTeX): ${module.formula}`,
    `Input shape: [${module.inputShape.join(', ')}] · output shape: [${module.outputShape.join(', ')}]`,
    ...(flowLines.length > 0 ? ['Data flow:', ...flowLines] : []),
    ...(parent?.explanation ? [`Block notes: ${parent.explanation.slice(0, 3000)}`] : []),
  ];
}

/** The question the "explain with AI" button sends to Model Assistant for one module. */
export function moduleExplanationQuestion(
  graphModel: ModelSpec,
  module: ModelModule,
  parent: ModelModule | null,
): string {
  return [
    'Explain in detail what this one module does in the selected model, for its author who could not follow it. Do not propose or make any edit to the model.',
    'Cover: its role in the whole architecture and why it is needed; each symbol in its equation and the tensor shapes; where its inputs come from and where its outputs are used; how it relates to the neighbouring steps; and which parts the source leaves unknown or elided. Separate what the pseudocode states from your interpretation.',
    '',
    ...moduleContextLines(graphModel, module, parent),
  ].join('\n');
}

/**
 * A follow-up question asked from the module detail dialog. The module's own context and the last
 * exchanges about it travel with the question, so a short question still lands on this module.
 */
export function moduleFollowUpQuestion(
  graphModel: ModelSpec,
  module: ModelModule,
  parent: ModelModule | null,
  thread: readonly Readonly<{ role: 'user' | 'assistant'; body: string }>[],
  question: string,
): string {
  const earlier = thread.slice(-4).map((message) => {
    const label = message.role === 'user' ? 'Earlier question' : 'Earlier answer';
    const body = message.body.replace(/\s+/gu, ' ').trim();
    return `${label}: ${body.length > 1200 ? `${body.slice(0, 1200)}…` : body}`;
  });
  return [
    'Answer this follow-up question about the one module below, in the same detail. Do not propose or make any edit to the model, and keep separating what the pseudocode states from your interpretation.',
    '',
    ...moduleContextLines(graphModel, module, parent),
    ...(earlier.length > 0 ? ['', ...earlier] : []),
    '',
    `Question: ${question.trim().slice(0, 2000)}`,
  ].join('\n');
}

/**
 * Marks a Model Assistant message as asked from a module's detail. The module discussion is not a
 * separate thread: it is the one Model Assistant conversation, where this tag says which module a
 * question was about and roughly what that module is.
 */
export type ModuleQuestionRef = Readonly<{
  moduleId: string;
  /** `moduleExplanationKey` when it was asked, so an edited module reads as a different one. */
  key: string;
  name: string;
  /** Where the module sits, e.g. "FOR-LOOP · step 2" or its group. */
  location: string;
  /** One sentence on what the module does. */
  summary: string;
  kind: 'explain' | 'question';
}>;

const REF_TEXT = 240;
const clip = (value: string, limit = REF_TEXT) => {
  const text = value.replace(/\s+/gu, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

export function moduleQuestionRef(
  module: ModelModule,
  kind: ModuleQuestionRef['kind'],
): ModuleQuestionRef {
  return {
    moduleId: module.id,
    key: moduleExplanationKey(module),
    name: clip(englishGraphName(module.name, module.id, 'Processing Block'), 120),
    location: clip(module.group, 120),
    summary: clip(graphCardSummary(module) || module.transform),
    kind,
  };
}

export function readModuleQuestionRef(value: unknown): ModuleQuestionRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const ref = value as Partial<Record<keyof ModuleQuestionRef, unknown>>;
  const text = (field: unknown, limit: number) =>
    typeof field === 'string' && field.length <= limit ? field : null;
  const moduleId = text(ref.moduleId, 400);
  const key = text(ref.key, 420);
  const name = text(ref.name, 200);
  const location = text(ref.location, 200);
  const summary = text(ref.summary, 400);
  if (!moduleId || !key || name === null || location === null || summary === null) return null;
  return {
    moduleId,
    key,
    name,
    location,
    summary,
    kind: ref.kind === 'explain' ? 'explain' : 'question',
  };
}

const LEGACY_EXPLAIN = 'Explain in detail what this one module does';
const LEGACY_FOLLOW_UP = 'Answer this follow-up question about the one module below';

/**
 * Before the tag existed the whole prompt (instruction, module context, question) was saved as the
 * user's message. Such a message is read back as the question it carried and the module it named.
 */
export function legacyModuleQuestion(
  body: string,
): Readonly<{ ref: ModuleQuestionRef; question: string | null }> | null {
  const explain = body.startsWith(LEGACY_EXPLAIN);
  if (!explain && !body.startsWith(LEGACY_FOLLOW_UP)) return null;
  const header = /^Module: (.+) \(([^()]*(?:\([^()]*\)[^()]*)*), id ([^\s()]+)\)$/mu.exec(body);
  if (!header) return null;
  const source = /^Source: (.+)$/mu.exec(body)?.[1] ?? '';
  const question = explain ? null : (/^Question: ([\s\S]+)$/mu.exec(body)?.[1]?.trim() ?? null);
  if (!explain && !question) return null;
  return {
    ref: {
      moduleId: header[3]!,
      key: header[3]!,
      name: clip(header[1]!, 120),
      location: clip(header[2]!, 120),
      summary: clip(source),
      kind: explain ? 'explain' : 'question',
    },
    question,
  };
}

/** The tag a saved message carries, or the one an older raw prompt implies. */
export function messageModuleRef(
  message: Readonly<{ role: 'user' | 'assistant'; body: string; moduleRef?: ModuleQuestionRef }>,
): ModuleQuestionRef | null {
  if (message.moduleRef) return message.moduleRef;
  return message.role === 'user' ? (legacyModuleQuestion(message.body)?.ref ?? null) : null;
}

/**
 * A module question as later turns of the conversation see it: the question itself, preceded by
 * which module it was asked from, so "the previous module" still means something in another one.
 */
export function moduleConversationBody(
  message: Readonly<{ role: 'user' | 'assistant'; body: string; moduleRef?: ModuleQuestionRef }>,
): string {
  if (message.role !== 'user') return message.body;
  const legacy = message.moduleRef ? null : legacyModuleQuestion(message.body);
  const ref = message.moduleRef ?? legacy?.ref;
  if (!ref) return message.body;
  const asked = legacy ? (legacy.question ?? 'Explain this module in detail.') : message.body;
  return `[Asked from the detail of module "${ref.name}" (id ${ref.moduleId}, ${ref.location}) — ${ref.summary}]\n${asked}`;
}
