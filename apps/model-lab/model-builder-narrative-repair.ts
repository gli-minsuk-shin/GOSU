type JsonRecord = Record<string, unknown>;

const narrativeFieldLimits = {
  moduleId: 120,
  formula: 2_000,
  explanation: 2_000,
  activation: 160,
} as const;

export type ModelBuilderNarrativeRepairPlan = Readonly<{
  candidate: JsonRecord;
  moduleIds: readonly string[];
  modules: readonly JsonRecord[];
}>;

export const MODEL_BUILDER_NARRATIVE_REPAIR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['patches'],
  properties: {
    patches: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['moduleId', 'formula', 'explanation', 'activation'],
        properties: {
          moduleId: { type: 'string', minLength: 1, maxLength: narrativeFieldLimits.moduleId },
          formula: { type: 'string', minLength: 1, maxLength: narrativeFieldLimits.formula },
          explanation: {
            type: 'string',
            minLength: 1,
            maxLength: narrativeFieldLimits.explanation,
          },
          activation: {
            type: ['string', 'null'],
            minLength: 1,
            maxLength: narrativeFieldLimits.activation,
          },
        },
      },
    },
  },
} as const;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Deliberately exclude liveness, ownership, ports, shapes, source contracts, and
// granularity. Those require architecture changes and must use the full repair.
const narrativeFindings = [
  /^declares .+ in its transform but omits it from the formula\.$/u,
  /^explanation claims .+, but transform and formula do not\.$/u,
  /^contains executable tensor operations but only a placeholder formula\..+$/u,
  /^contains executable tensor operations but its formula has no mathematical relation\.$/u,
  /^formula is not renderable: .+$/su,
  /^.+ is declared in text but absent from the equation\.$/u,
  /^equation could not be deterministically derived from its text\.$/u,
  /^independent transform assignments were collapsed into one LaTeX equality chain\.$/u,
  /^a single Linear transform is represented as a multi-layer MLP\.$/u,
  /^FiLM text uses \(1 \+ gamma\), but the equation omits the residual 1\.$/u,
  /^text fields disagree on tanh saturation scales \([^)]+\)\.$/u,
  /^tanh saturation scale .+ in text does not match the equation\.$/u,
];

function modulesFromCandidate(candidate: unknown): JsonRecord[] | null {
  if (!isRecord(candidate) || !Array.isArray(candidate.modules)) return null;
  const modules: JsonRecord[] = [];
  const ids = new Set<string>();
  for (const module of candidate.modules) {
    if (
      !isRecord(module) ||
      typeof module.id !== 'string' ||
      !module.id.trim() ||
      module.id.length > narrativeFieldLimits.moduleId ||
      ids.has(module.id)
    ) {
      return null;
    }
    ids.add(module.id);
    modules.push(module);
  }
  return modules;
}

function targetForFinding(finding: string, modules: readonly JsonRecord[]) {
  const matches = modules.flatMap((module) => {
    const id = module.id as string;
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const expression = new RegExp(`\\[${escapedId}\\]|—\\s*${escapedId}:`, 'gu');
    return [...finding.matchAll(expression)].map((match) => ({
      id,
      index: match.index,
      detail: finding.slice(match.index + match[0].length).trim(),
    }));
  });
  // Formula findings can also include [model.id] before the actual module id.
  const target = matches.sort((left, right) => right.index - left.index)[0];
  if (!target || !narrativeFindings.some((pattern) => pattern.test(target.detail))) return null;
  return target.id;
}

/** Returns a targeted plan only when every reported failure is narrative-only. */
export function planModelBuilderNarrativeRepair(
  candidateJson: string,
  auditReason: string,
): ModelBuilderNarrativeRepairPlan | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(candidateJson);
  } catch {
    return null;
  }
  const modules = modulesFromCandidate(candidate);
  if (!isRecord(candidate) || !modules?.length) return null;
  const reason = auditReason.replace(/^Builder audit failed:\s*/u, '');
  const sections = reason.split(/\s+\|\|\s+/u);
  const moduleIds: string[] = [];
  for (const section of sections) {
    const match =
      /^(?:Formula consistency failed|Semantic architecture quality failed):\s*(.+)$/su.exec(
        section,
      );
    if (!match) return null;
    for (const finding of match[1]!.split(/\s+\|\s+/u)) {
      const id = targetForFinding(finding, modules);
      if (!id) return null;
      if (!moduleIds.includes(id)) moduleIds.push(id);
      if (moduleIds.length > 6) return null;
    }
  }
  if (moduleIds.length === 0) return null;
  return {
    candidate,
    moduleIds,
    modules: modules.filter((module) => moduleIds.includes(module.id as string)),
  };
}

function invalidPatch(reason: string): never {
  throw new Error(`model_builder_narrative_repair_invalid: ${reason}`);
}

/** Applies prose/math fields only; the caller must run the unchanged full audit. */
export function applyModelBuilderNarrativeRepair(
  plan: ModelBuilderNarrativeRepairPlan,
  responseJson: string,
): string {
  let response: unknown;
  try {
    response = JSON.parse(responseJson);
  } catch {
    invalidPatch('response is not JSON');
  }
  if (
    !isRecord(response) ||
    Object.keys(response).length !== 1 ||
    !Array.isArray(response.patches)
  ) {
    invalidPatch('expected only a patches array');
  }
  if (
    plan.moduleIds.length < 1 ||
    plan.moduleIds.length > 6 ||
    new Set(plan.moduleIds).size !== plan.moduleIds.length
  ) {
    invalidPatch('invalid target module set');
  }
  if (response.patches.length !== plan.moduleIds.length) invalidPatch('missing or extra patches');
  const candidate = structuredClone(plan.candidate);
  const modules = modulesFromCandidate(candidate);
  if (!modules) invalidPatch('invalid candidate modules');
  const seen = new Set<string>();
  for (const patch of response.patches) {
    if (
      !isRecord(patch) ||
      Object.keys(patch).sort().join(',') !== 'activation,explanation,formula,moduleId'
    ) {
      invalidPatch('patch fields must be moduleId, formula, explanation, activation');
    }
    if (
      typeof patch.moduleId !== 'string' ||
      !patch.moduleId.trim() ||
      patch.moduleId.length > narrativeFieldLimits.moduleId ||
      !plan.moduleIds.includes(patch.moduleId) ||
      seen.has(patch.moduleId)
    ) {
      invalidPatch('unexpected or duplicate moduleId');
    }
    if (
      typeof patch.formula !== 'string' ||
      !patch.formula.trim() ||
      patch.formula.length > narrativeFieldLimits.formula ||
      typeof patch.explanation !== 'string' ||
      !patch.explanation.trim() ||
      patch.explanation.length > narrativeFieldLimits.explanation ||
      (patch.activation !== null && typeof patch.activation !== 'string') ||
      (typeof patch.activation === 'string' &&
        (!patch.activation.trim() || patch.activation.length > narrativeFieldLimits.activation))
    ) {
      invalidPatch('invalid narrative field type, length, or empty value');
    }
    const module = modules.find((item) => item.id === patch.moduleId);
    if (!module) invalidPatch('target module missing from candidate');
    module.formula = patch.formula;
    module.explanation = patch.explanation;
    module.activation = patch.activation;
    seen.add(patch.moduleId);
  }
  return JSON.stringify(candidate);
}
