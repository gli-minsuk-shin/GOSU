import type { ModelModule, ModelSpec, TensorShape } from './model-lab-schema';
export const MODEL_GRAPH_REASONING_POLICY = [
  'GRAPH REASONING CONTRACT: first build a tensor ledger: define each symbol and axis meaning, distinguish the full carried state from slices/intermediates, and trace each named port through the ordered equations. Preserve symbolic axes; never encode an unknown axis with a large numeric sentinel.',
  'For every matrix product verify the inner dimensions and show the output axes. State transpose/permutation axes, reduction and Softmax axes, reshape element counts, residual operands and which coordinates remain unchanged. Repeated bodies must state initial state, one iteration, carried state and final output.',
  'Separate source-declared design from verified algebra and runtime observation. If source equations conflict, retain the source operation and describe the exact conflicting operands/axes in presentation.uncertainties; do not silently transpose operands, remove a residual, or invent an axis. A possible correction is a proposal, not a source fact.',
  'Every module must include presentation: purpose (one short role sentence), keyEquationIndex (zero-based index of one complete newline-separated equation in formula, normally 0; GOSU selects the actual equation, never rewrite it separately), shapeNotes (explain axes and preserved/updated state), uncertainties (specific unresolved operations; empty only when none identified). Keep that equation concise and under 600 characters. Names are concise English; explanatory prose follows application language. A bare question mark, generic shape warning, or a list of layer names is not an explanation.',
  'Self-audit before emitting: a reader must understand what enters, what changes, why it changes, what leaves, and what remains unverified without opening every detail. Cross-check presentation against ports, transform, formula and original evidence. Never claim execution or mathematical proof from design metadata alone.',
].join('\n');

export function isEnglishGraphName(name: string) {
  return /^[\x20-\x7e]+$/.test(name.trim()) && /[A-Za-z]/.test(name);
}
/** Presentation-only fallback; never rename saved models, IDs or revision hashes. */
export function englishGraphName(name: string, id: string, fallback = 'Model') {
  if (isEnglishGraphName(name)) return name;
  const words = id
    .replace(/[-_][a-f0-9]{10,}$/i, '')
    .replace(/^(block|summary|composite)[:_-]+/i, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.some((w) => /[A-Za-z]/.test(w))) return fallback;
  return words
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
}
export function unsafeGraphDimension(value: string | number) {
  if (typeof value === 'number') return !Number.isSafeInteger(value) || value <= 0;
  return [...value.matchAll(/\d+/g)].some((m) => !Number.isSafeInteger(Number(m[0])));
}
export function compactGraphShape(shape: TensorShape) {
  const uncertain = shape.some(unsafeGraphDimension);
  const text = shape
    .map((d) => (unsafeGraphDimension(d) ? '?' : String(d).replace(/\s+/g, '')))
    .join(' × ');
  return { text: text.length > 52 ? `${text.slice(0, 49)}…` : text, uncertain };
}
export function graphCardSummary(module: ModelModule) {
  const text = (module.presentation?.purpose ?? module.explanation).replace(/\s+/g, ' ').trim();
  const sentence = text.split(/(?<=[.!?。])\s/)[0] ?? '';
  return sentence.length > 125 ? `${sentence.slice(0, 122)}…` : sentence;
}
/** Bounded symbolic arithmetic only; no evaluation, calls, indexing or arbitrary code. */
export function isSymbolicDimension(value: string) {
  const text = value.replace(/\s+/g, '');
  if (!text.length || text.length > 64 || !/[A-Za-z]/.test(text)) return false;
  const tokens = text.match(/(?:[1-9]\d*)?[A-Za-z][A-Za-z0-9_]*'?|\d+|[()+\-*/^]/g) ?? [];
  if (tokens.join('') !== text) return false;
  let operand = true,
    depth = 0;
  for (const token of tokens) {
    if (token === '(') {
      if (!operand) return false;
      depth++;
    } else if (token === ')') {
      if (operand || depth === 0) return false;
      depth--;
    } else if (/^[+\-*/^]$/.test(token)) {
      if (operand) return false;
      operand = true;
    } else {
      if (!operand) return false;
      operand = false;
    }
  }
  return !operand && depth === 0;
}
export function generatedGraphPresentationError(model: ModelSpec): string | null {
  if (
    !isEnglishGraphName(model.name) ||
    model.modules.some(
      (m) =>
        !isEnglishGraphName(m.name) ||
        (m.block && !isEnglishGraphName(m.block.label)) ||
        (m.repeat && !isEnglishGraphName(m.repeat.label)),
    )
  )
    return 'Use concise English ASCII model, module and repeated-block names; explanations may use the application language.';
  const shapes = [
    model.intent.expectedInput,
    model.intent.expectedOutput,
    ...model.connections.map((c) => c.shape),
    ...model.modules.flatMap((m) => [
      m.inputShape,
      m.outputShape,
      ...(m.inputPorts ?? []).map((p) => p.shape),
      ...(m.outputPorts ?? []).map((p) => p.shape),
    ]),
  ];
  if (shapes.some((s) => s.some(unsafeGraphDimension)))
    return 'Unverified numeric dimension: preserve real symbolic axes (for example N_ctx+N_test), never encode unknown dimensions as huge numeric placeholders.';
  return null;
}
