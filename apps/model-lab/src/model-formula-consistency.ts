import type { ModelModule, ModelSpec } from './model-lab-schema';

function numericTanhScales(text: string): readonly number[] {
  return [
    ...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:[*·×]|\\?,?\s*)?\\?tanh[\s\S]*?\/\s*(\d+(?:\.\d+)?)/giu),
  ].flatMap((match) => {
    const multiplier = Number(match[1]);
    const divisor = Number(match[2]);
    return Number.isFinite(multiplier) && multiplier === divisor ? [multiplier] : [];
  });
}

function transformAssignmentGroupCount(transform: string) {
  return transform
    .split(/\r?\n|;/u)
    .map((clause) => clause.trim())
    .filter((clause) =>
      /^(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_.]*(?:\[[^\]]+\])?(?:\s*,\s*[A-Za-z_][A-Za-z0-9_.]*)*)\s*(?:=|←|<-)/u.test(
        clause,
      ),
    ).length;
}

function formulaRelationCount(clause: string) {
  // Axis/index qualifiers (e.g. min_{axis=1}, sum_{i=1}) are not assignment chains.
  let depth = 0;
  let count = 0;
  for (let index = 0; index < clause.length; index++) {
    const char = clause[index]!;
    if ('{[('.includes(char) && clause[index - 1] !== '\\') depth++;
    else if ('}])'.includes(char) && clause[index - 1] !== '\\') depth = Math.max(0, depth - 1);
    else if (
      depth === 0 &&
      (char === '=' || /^\\(?:leftarrow|coloneqq)\b/u.test(clause.slice(index)))
    )
      count++;
  }
  return count;
}

function formulaAssignmentClauses(formula: string) {
  return formula
    .replaceAll(String.raw`\\`, '\n')
    .replace(/\\(?:quad|qquad)/gu, '\n')
    .replace(/,\s*(?=(?:\[[^\]]+\]|\\?[A-Za-z][A-Za-z0-9_{}^:]*)\s*(?:&?=|\\leftarrow))/gu, '\n')
    .split(/\r?\n|;/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function codeAssignmentAnalysis(transform: string) {
  const statements = transform
    .split(/\r?\n|;/u)
    .map((statement) => statement.trim())
    .filter((statement) => statement && !statement.startsWith('#'));
  const assignments: Array<{ targets: string[]; rhs: string; statement: string }> = [];
  for (const statement of statements) {
    const match =
      /^(\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])?(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*=\s*(?!=)(.+)$/u.exec(
        statement,
      );
    if (!match) return { highConfidence: false, assignments: [] } as const;
    const rawTargets = match[1]!.replace(/^\[|\]$/gu, '').split(',');
    const targets = rawTargets
      .map((target) => /^([A-Za-z_][A-Za-z0-9_]*)/u.exec(target.trim())?.[1])
      .filter((target): target is string => Boolean(target) && target !== '_');
    if (targets.length === 0) return { highConfidence: false, assignments: [] } as const;
    assignments.push({ targets, rhs: match[2]!, statement });
  }
  return { highConfidence: assignments.length > 0, assignments } as const;
}

function structuredTensorNames(value: string) {
  const candidate = value.trim().replace(/^\[|\]$/gu, '');
  const names = candidate.split(',').map((name) => name.trim());
  return names.length > 0 && names.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
    ? names
    : [];
}

function containsIdentifier(text: string, identifier: string) {
  return new RegExp(`(?:^|[^A-Za-z0-9_])${identifier}(?:$|[^A-Za-z0-9_])`, 'u').test(text);
}

function moduleNamedValueLivenessFindings(
  module: ModelModule,
  outgoingTensorNames: readonly string[],
) {
  const analysis = codeAssignmentAnalysis(module.transform);
  if (!analysis.highConfidence || analysis.assignments.length < 2) return [];
  const assignments = analysis.assignments;
  const structuredExports = new Set(outgoingTensorNames.flatMap(structuredTensorNames));
  const terminalValues = new Set<string>();
  const finalAssignmentTargets = new Set(assignments.at(-1)?.targets ?? []);
  assignments.forEach((assignment, assignmentIndex) => {
    assignment.targets.forEach((target) => {
      const consumedLater = assignments
        .slice(assignmentIndex + 1)
        .some((later) => containsIdentifier(later.rhs, target));
      if (!consumedLater) terminalValues.add(target);
    });
  });
  return assignments.flatMap((assignment, assignmentIndex) =>
    assignment.targets.flatMap((target) => {
      const consumedLater = assignments
        .slice(assignmentIndex + 1)
        .some((later) => containsIdentifier(later.rhs, target));
      if (consumedLater || structuredExports.has(target)) return [];
      const implicitSingleOutput = terminalValues.size === 1 && outgoingTensorNames.length > 0;
      const terminalOutputModule =
        terminalValues.has(target) &&
        finalAssignmentTargets.has(target) &&
        (['output', 'objective'].includes(module.kind) || outgoingTensorNames.length === 0);
      if (implicitSingleOutput || terminalOutputModule) return [];
      return [
        `${module.name} — ${module.id}: computed named value ${target} is neither consumed nor exported.`,
      ];
    }),
  );
}

export function moduleFormulaConsistencyFindings(
  module: Pick<ModelModule, 'id' | 'name' | 'transform' | 'activation' | 'formula'>,
): readonly string[] {
  const transform = module.transform.toLocaleLowerCase();
  const activation = module.activation?.toLocaleLowerCase() ?? '';
  const declared = `${transform} ${activation}`;
  const formula = module.formula.toLocaleLowerCase();
  const findings: string[] = [];
  if (/equation not deterministically derived/u.test(formula)) {
    findings.push(`${module.id}: equation could not be deterministically derived from its text.`);
  }
  const transformAssignments = transformAssignmentGroupCount(module.transform);
  const formulaClauses = formulaAssignmentClauses(module.formula);
  const formulaRelations = formulaClauses.map(formulaRelationCount);
  if (
    transformAssignments >= 2 &&
    formulaRelations.reduce((total, count) => total + count, 0) >= transformAssignments &&
    formulaClauses.length < transformAssignments &&
    formulaRelations.some((count) => count >= 2)
  ) {
    findings.push(
      `${module.id}: independent transform assignments were collapsed into one LaTeX equality chain.`,
    );
  }
  const directLinearCount = transform.match(/linear/gu)?.length ?? 0;
  const formulaLinearCount = formula.match(/\\operatorname\{linear\}/gu)?.length ?? 0;
  const directSingleLinear =
    directLinearCount === 1 &&
    !/\b(?:mlp|gelu)\b/u.test(declared) &&
    (/(?:^|=)\s*linear/u.test(transform) || /^linear/u.test(transform));
  if (
    directSingleLinear &&
    (/gelu/u.test(formula) ||
      formulaLinearCount > 1 ||
      (/w_1/u.test(formula) && /w_2/u.test(formula)))
  ) {
    findings.push(`${module.id}: a single Linear transform is represented as a multi-layer MLP.`);
  }
  const requiredOperators: ReadonlyArray<Readonly<[RegExp, RegExp, string]>> = [
    [/gelu/u, /gelu/u, 'GELU'],
    [/silu/u, /silu/u, 'SiLU'],
    [
      /relu/u,
      /(?:relu|max\s*\\?[{(]|soft.?threshold|positive.?part|\]_\+)/u,
      'ReLU / positive-part',
    ],
    [/rmsnorm/u, /rmsnorm/u, 'RMSNorm'],
    [/tanh/u, /tanh/u, 'tanh'],
    [/sigmoid/u, /(?:sigma|sigmoid)/u, 'sigmoid'],
  ];
  requiredOperators.forEach(([declaredPattern, formulaPattern, label]) => {
    if (declaredPattern.test(declared) && !formulaPattern.test(formula)) {
      findings.push(`${module.id}: ${label} is declared in text but absent from the equation.`);
    }
  });
  if (/\(\s*1\s*\+\s*gamma/u.test(transform) && !/1\s*\+\s*\\?gamma/u.test(formula)) {
    findings.push(
      `${module.id}: FiLM text uses (1 + gamma), but the equation omits the residual 1.`,
    );
  }
  const declaredTanhScales = [...numericTanhScales(transform), ...numericTanhScales(activation)];
  const formulaTanhScales = numericTanhScales(formula);
  const uniqueDeclaredTanhScales = [...new Set(declaredTanhScales)];
  if (uniqueDeclaredTanhScales.length > 1) {
    findings.push(
      `${module.id}: text fields disagree on tanh saturation scales (${uniqueDeclaredTanhScales.join(' vs ')}).`,
    );
  } else if (
    uniqueDeclaredTanhScales.length === 1 &&
    !formulaTanhScales.includes(uniqueDeclaredTanhScales[0]!)
  ) {
    findings.push(
      `${module.id}: tanh saturation scale ${uniqueDeclaredTanhScales[0]} in text does not match the equation.`,
    );
  }
  return findings.map((finding) => `${module.name} — ${finding}`);
}

export function modelFormulaConsistencyFindings(
  models: ModelSpec | readonly ModelSpec[],
  options: Readonly<{ includeNamedValueLiveness?: boolean }> = {},
): readonly string[] {
  const candidates: readonly ModelSpec[] = Array.isArray(models)
    ? (models as readonly ModelSpec[])
    : [models as ModelSpec];
  return candidates.flatMap((model) =>
    model.modules.flatMap((module) => {
      const outgoingTensorNames = model.connections
        .filter((connection) => connection.source === module.id)
        .flatMap((connection) => [
          connection.tensorName,
          ...(connection.sourcePort ? [connection.sourcePort] : []),
        ]);
      const exportedNames = [
        ...outgoingTensorNames,
        ...(module.outputPorts?.map((port) => port.name) ?? []),
      ];
      return [
        ...moduleFormulaConsistencyFindings(module),
        ...(options.includeNamedValueLiveness
          ? moduleNamedValueLivenessFindings(module, exportedNames)
          : []),
      ].map((finding) => `${model.name}@${model.version} [${model.id}] — ${finding}`);
    }),
  );
}
