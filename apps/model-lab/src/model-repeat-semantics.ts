import type { ModelModule, ModelSpec } from './model-lab-schema';

export type RepeatOperationFamily =
  | 'projection'
  | 'partition'
  | 'nonlinearity'
  | 'normalization'
  | 'merge'
  | 'data-update'
  | 'buffer-control'
  | 'unknown';

export const NON_REPEAT_SEMANTIC_MODULE_MAX_STATEMENTS = 12;

export type RepeatedStepEntry = Readonly<{
  statement: string;
  /** Enclosing if/elif/else/while/with headers (by indentation), outermost first. */
  context: readonly string[];
}>;

export function repeatedModuleStepEntries(
  module: Pick<ModelModule, 'transform'>,
): readonly RepeatedStepEntry[] {
  const source = module.transform.trim();
  if (!source) return [];
  const rawLines = module.transform.split(/\r?\n/u).filter((line) => line.trim());
  let entries: RepeatedStepEntry[];
  if (rawLines.length > 1) {
    const pendingAnnotations: string[] = [];
    const headers: { indent: number; header: string }[] = [];
    entries = [];
    for (const rawLine of rawLines) {
      const line = rawLine.trim();
      if (line.startsWith('#')) {
        const annotation = line.replace(/^#+\s*/u, '').trim();
        if (annotation) pendingAnnotations.push(annotation);
        continue;
      }
      const indent = rawLine.length - rawLine.trimStart().length;
      while (headers.length > 0 && headers.at(-1)!.indent >= indent) headers.pop();
      if (/^(?:for|For)\b.*:\s*$/u.test(line)) continue;
      entries.push({
        statement:
          pendingAnnotations.length > 0 ? `${line} # ${pendingAnnotations.join(' · ')}` : line,
        context: headers.map((entry) => entry.header),
      });
      pendingAnnotations.length = 0;
      if (/^(?:if|elif|else|while|with)\b.*:\s*$/u.test(line)) {
        headers.push({ indent, header: line.replace(/:\s*$/u, '') });
      }
    }
  } else {
    entries = source
      .replace(/^for each iteration:\s*/iu, '')
      .split(/;\s*/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((statement) => ({ statement, context: [] }));
  }
  return entries
    .map((entry) => ({
      ...entry,
      statement: entry.statement.replace(/^(?:[-*•]|\d+[.)])\s*/u, '').trim(),
    }))
    .map((entry) => {
      const inlineLoop = entry.statement.match(/^for\b[^:]*:\s*(.+)$/iu);
      return { ...entry, statement: inlineLoop?.[1]?.trim() ?? entry.statement };
    })
    .filter(({ statement }) => !/^for\b/iu.test(statement))
    .filter(({ statement }) => !/^stop\s*=\s*min\s*\(/iu.test(statement))
    .filter(({ statement }) => statement.length > 1);
}

export function repeatedModuleStepStatements(module: Pick<ModelModule, 'transform'>) {
  return repeatedModuleStepEntries(module).map((entry) => entry.statement);
}

function operationCode(statement: string) {
  return statement.split(/\s+#/u, 1)[0]!.trim();
}

export function repeatOperationFamilies(statement: string): readonly RepeatOperationFamily[] {
  const code = operationCode(statement);
  const families = new Set<RepeatOperationFamily>();
  if (/\b(?:linear|mlp|conv|embedding|attention|projection)\b/iu.test(code)) {
    families.add('projection');
  }
  if (/\b(?:split|chunk|slice)\b|\[[^\]]*:[^\]]*\]/iu.test(code)) {
    families.add('partition');
  }
  if (/\b(?:soft[_-]?threshold|gelu|relu|silu|sigmoid|tanh|softmax)\b/iu.test(code)) {
    families.add('nonlinearity');
  }
  if (/\b(?:rmsnorm|layernorm|batchnorm|normalize|normalization)\b/iu.test(code)) {
    families.add('normalization');
  }
  if (/\b(?:concat|cat|merge|residual|skip)\b|=\s*[^=]+\+[^=]+$/iu.test(code)) {
    families.add('merge');
  }
  if (/(?:@|\.t\b|\bmatmul\b|\bgradient\b|\bcorrelation\b|\/\s*(?:n|lambda)\b)/iu.test(code)) {
    families.add('data-update');
  }
  if (/\b(?:append|buffer|start|stop|range|index|indices)\b/iu.test(code)) {
    families.add('buffer-control');
  }
  return families.size > 0 ? [...families] : ['unknown'];
}

export function homogeneousUnknownRepeatSignature(
  module: Pick<ModelModule, 'transform'>,
): string | null {
  const statements = repeatedModuleStepStatements(module);
  if (statements.length < 2) return null;
  const calls = statements.flatMap((statement) => {
    if (!repeatOperationFamilies(statement).includes('unknown')) return [];
    const call = /=\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\(/u.exec(statement)?.[1];
    return call ? [call] : [];
  });
  return calls.length === statements.length &&
    new Set(calls.map((call) => call.toLocaleLowerCase())).size === 1
    ? calls[0]!
    : null;
}

function genericModuleName(name: string) {
  return /^(?:custom operation|operation|module|layer|step)(?:\s|·|[-_]|\d|$)/iu.test(name.trim());
}

function sameShape(left: ModelModule['inputShape'], right: ModelModule['outputShape']) {
  return (
    left.length === right.length && left.every((dimension, index) => dimension === right[index])
  );
}

function atomicScope(module: ModelModule) {
  return module.block ? `block:${module.block.id}` : `group:${module.group}`;
}

function executableTransform(transform: string) {
  return /(?:=|→|<-|\bLinear\b|\bMLP\b|\bGELU\b|\bRMSNorm\b|\bsoft[_-]?threshold\b|@)/u.test(
    transform,
  );
}

function placeholderFormula(formula: string) {
  return /(?:equation not deterministically|(?:equation|formula) (?:is )?(?:unavailable|not available|unknown|not specified|could not be derived)|no (?:equation|formula)(?: is)? available|no closed-form expression|unable to derive (?:an? )?(?:equation|formula)|mathematical form is unspecified|source (?:does not (?:provide|specify)|lacks) (?:an? )?(?:equation|formula))/iu.test(
    formula.trim(),
  );
}

function formulaHasMathematicalRelation(formula: string) {
  return /=|\\(?:leftarrow|coloneqq|propto|sim|mapsto|approx|equiv)\b/u.test(formula);
}

type NarrativeOperator =
  | 'linear'
  | 'GELU'
  | 'RMSNorm'
  | 'soft-threshold'
  | 'concat'
  | 'split'
  | 'sigmoid'
  | 'tanh'
  | 'ReLU'
  | 'FiLM'
  | 'MLP'
  | 'convolution'
  | 'attention'
  | 'embedding'
  | 'pooling'
  | 'exp'
  | 'log';

function narrativeOperators(
  text: string,
  options: Readonly<{ formulaContext?: boolean }> = {},
): ReadonlySet<NarrativeOperator> {
  const operators = new Set<NarrativeOperator>();
  const patterns: ReadonlyArray<readonly [NarrativeOperator, RegExp]> = [
    ['linear', /\blinear\b|\\operatorname\{linear\}/iu],
    ['GELU', /\bgelu\b/iu],
    ['RMSNorm', /\brmsnorm\b/iu],
    ['soft-threshold', /soft[_ -]?threshold|\\operatorname\{(?:st|softthreshold)\}/iu],
    ['concat', /\bconcat(?:enate)?\b|\\operatorname\{concat\}/iu],
    ['split', /\bsplit\b|\bchunk\b|\\operatorname\{(?:split|chunk)\}/iu],
    ['sigmoid', /\bsigmoid\b|\\sigma\b/iu],
    ['tanh', /\btanh\b/iu],
    ['ReLU', /\brelu\b/iu],
    ['FiLM', /\bfilm\b/iu],
    ['MLP', /\bmlp\b/iu],
    ['convolution', /\bconv(?:olution|1d|2d|3d)?\b/iu],
    ['attention', /\battention\b/iu],
    ['embedding', /\bembedding\b/iu],
    ['pooling', /\bpool(?:ing)?\b|\bmean\b|\bmax(?:imum)?\b/iu],
    ['exp', /\bexp\b|\\exp\b/iu],
    ['log', /\blog\b|\\log\b/iu],
  ];
  for (const [operator, pattern] of patterns) if (pattern.test(text)) operators.add(operator);
  if (options.formulaContext) {
    if (/\[[^\]:\n]+,[^\]:\n]+\]/u.test(text)) operators.add('concat');
    if ((text.match(/=|\\leftarrow/gu)?.length ?? 0) >= 2) operators.add('split');
  }
  return operators;
}

function formulaRepresentsAffineMap(formula: string) {
  const matrixSymbol = String.raw`(?:[A-Z]|\\(?:Theta|Phi|Psi|Omega|Gamma|Delta|Sigma)|\\mathbf\{[A-Z]\})`;
  const vectorSymbol = String.raw`(?:\\?[A-Za-z][A-Za-z0-9_{}]*)`;
  return (
    /\\operatorname\{linear\}|\blinear\b/iu.test(formula) ||
    new RegExp(`${matrixSymbol}(?:[_^{][^\\s]*)?\\s*${vectorSymbol}`, 'u').test(formula) ||
    new RegExp(`${vectorSymbol}\\s*${matrixSymbol}(?:[_^{]|\\b)`, 'u').test(formula) ||
    /\bL\s*\(/u.test(formula)
  );
}

function formulaRepresentsOperator(operator: NarrativeOperator, formula: string) {
  if (operator === 'linear') return formulaRepresentsAffineMap(formula);
  if (operator === 'MLP') {
    const abstractMatrices = formula.match(/[A-Z](?=\\[A-Za-z]+|[a-z(])/gu)?.length ?? 0;
    return (
      /\bmlp\b/iu.test(formula) ||
      ((formula.match(/(?:W|\\mathbf\{W\}|\\Theta|\\theta)[_{^]?/giu)?.length ?? 0) >= 2 &&
        /gelu|relu|silu|tanh|sigma|sigmoid|\\phi/iu.test(formula)) ||
      (abstractMatrices >= 2 && /gelu|relu|silu|tanh|sigma|sigmoid|\\phi/iu.test(formula))
    );
  }
  if (operator === 'convolution') {
    return (
      /\bconv(?:olution|1d|2d|3d)?\b|\\(?:ast|star)\b/iu.test(formula) ||
      /\\sum[\s\S]*(?:K|k)_[{]?[\s\S]*(?:x|X)_[{]?/u.test(formula)
    );
  }
  if (operator === 'attention') {
    return /\battention\b|softmax[\s\S]*(?:Q|K|V)|Q[\s\S]*K(?:\^|_)?(?:\\top|T)/iu.test(formula);
  }
  if (operator === 'embedding') {
    return /\bembedding\b|(?:^|[^A-Za-z])E\s*[[(]|(?:e|E)_[{]?\s*(?:x|t)_/u.test(formula);
  }
  if (operator === 'pooling') {
    return /\bpool(?:ing)?\b|\bmean\b|\bmax(?:imum)?\b|\\sum\b/iu.test(formula);
  }
  return narrativeOperators(formula, { formulaContext: true }).has(operator);
}

export function modelLoopOwnershipFindings(model: ModelSpec): readonly string[] {
  const findings: string[] = [];
  const ownersByBinding = new Map<string, Set<string>>();
  for (const module of model.modules) {
    const loopPorts = [...(module.inputPorts ?? []), ...(module.outputPorts ?? [])].filter(
      (port) => port.binding === 'loop-carried',
    );
    if (loopPorts.length === 0) continue;
    const owner = module.block
      ? `block:${module.block.id}`
      : module.repeat
        ? `repeat:${module.id}`
        : null;
    if (!owner) {
      findings.push(
        `${module.name} [${module.id}] declares loop-carried ports without repeat or shared block metadata.`,
      );
      continue;
    }
    for (const port of loopPorts) {
      if (!port.bindingId) continue;
      const owners = ownersByBinding.get(port.bindingId) ?? new Set<string>();
      owners.add(owner);
      ownersByBinding.set(port.bindingId, owners);
    }
  }
  for (const [bindingId, owners] of ownersByBinding) {
    if (owners.size > 1) {
      findings.push(
        `Loop-carried binding “${bindingId}” crosses multiple repeat/block owners: ${[...owners].join(', ')}.`,
      );
    }
  }
  return findings;
}

function explanationClaimedOperators(explanation: string) {
  const claims = new Set<NarrativeOperator>();
  for (const sentence of explanation.split(/(?<=[.!?])\s+|\r?\n/u)) {
    if (
      /\b(?:not|no|without|omit(?:s|ted)?|absent|discrepancy|note[- ]only)\b|(?:않|없|제외|불일치|노트)/iu.test(
        sentence,
      )
    ) {
      continue;
    }
    if (
      !/\b(?:use[sd]?|appl(?:y|ies|ied)|compute[sd]?|perform[sd]?|include[sd]?|followed by|normalize[sd]?|activate[sd]?|split[sd]?|concat(?:enate)?[sd]?)\b|(?:사용|적용|계산|수행|포함|정규화|활성화|분할|연결)/iu.test(
        sentence,
      )
    ) {
      continue;
    }
    for (const operator of narrativeOperators(sentence)) {
      if (
        operator === 'linear' &&
        !/\bLinear\s*\(|\blinear\s+(?:layer|projection|map|transform)\b/u.test(sentence)
      ) {
        continue;
      }
      if (
        (operator === 'exp' || operator === 'log') &&
        !new RegExp(`(?:\\\\${operator}\\b|\\b${operator}\\s*\\()`, 'iu').test(sentence)
      ) {
        continue;
      }
      claims.add(operator);
    }
  }
  return claims;
}

export function modelSemanticArchitectureFindings(model: ModelSpec): readonly string[] {
  const findings: string[] = [...modelLoopOwnershipFindings(model)];
  for (const module of model.modules) {
    if (module.repeat && module.block) {
      findings.push(
        `${module.name} [${module.id}] declares both repeat and shared block metadata; keep repeat=null on block members so repetition is represented exactly once.`,
      );
      continue;
    }
    if (!module.repeat) continue;
    const statements = repeatedModuleStepStatements(module);
    if (statements.length < 7) continue;
    const perStatement = statements.map(repeatOperationFamilies);
    const families = new Set(perStatement.flat().filter((family) => family !== 'buffer-control'));
    const primaryFamilies = perStatement.map(
      (candidate) => candidate.find((family) => family !== 'buffer-control') ?? 'buffer-control',
    );
    const transitions = primaryFamilies
      .slice(1)
      .filter((family, index) => family !== primaryFamilies[index]).length;
    const unknownCount = perStatement.filter((candidate) => candidate.includes('unknown')).length;
    const knownFamilyCount = [...families].filter((family) => family !== 'unknown').length;
    const unknownSignatures = statements.flatMap((statement, index) => {
      if (!perStatement[index]?.includes('unknown')) return [];
      const call = /=\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\(/u.exec(statement)?.[1];
      return call ? [call.toLocaleLowerCase()] : [];
    });
    const homogeneousUnknown =
      unknownCount > 0 &&
      unknownSignatures.length === unknownCount &&
      new Set(unknownSignatures).size === 1;
    if (knownFamilyCount < 2 && (unknownCount === 0 || homogeneousUnknown)) continue;
    findings.push(
      `${module.name} [${module.id}] expands ${statements.length} executable statements across ${knownFamilyCount} known operation families (${transitions} family transitions, ${unknownCount} unknown) but has no inspectable semantic composite block. Return 2–6 dependency-connected modules sharing one block id, label, and repeatCount instead of one line-expanded repeat module.`,
    );
  }

  for (const module of model.modules) {
    if (module.repeat || module.block || module.subgraph) continue;
    const statements = repeatedModuleStepStatements(module);
    if (statements.length <= NON_REPEAT_SEMANTIC_MODULE_MAX_STATEMENTS) continue;
    const perStatement = statements.map(repeatOperationFamilies);
    const knownFamilies = new Set(
      perStatement.flat().filter((family) => family !== 'buffer-control' && family !== 'unknown'),
    );
    const unknownStatements = statements.filter((_statement, index) =>
      perStatement[index]?.includes('unknown'),
    );
    const unknownSignatures = unknownStatements.flatMap((statement) => {
      const call = /=\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\(/u.exec(statement)?.[1];
      return call ? [call.toLocaleLowerCase()] : [];
    });
    const homogeneousUnknown =
      unknownStatements.length > 0 &&
      unknownSignatures.length === unknownStatements.length &&
      new Set(unknownSignatures).size === 1;
    if (knownFamilies.size < 2 && (unknownStatements.length === 0 || homogeneousUnknown)) continue;
    findings.push(
      `${module.name} [${module.id}] packs ${statements.length} mixed executable statements into one non-repeat module. Split it into human-scale dependency-connected modules or one inspectable 2–6 member composite block.`,
    );
  }

  const atomicModules = model.modules.filter((module) => {
    if (module.repeat || module.subgraph) return false;
    if (['input', 'output', 'objective'].includes(module.kind)) return false;
    if (!sameShape(module.inputShape, module.outputShape)) return false;
    const statements = repeatedModuleStepStatements(module);
    if (statements.length !== 1) return false;
    const families = repeatOperationFamilies(statements[0]!).filter(
      (family) => family !== 'buffer-control' && family !== 'unknown',
    );
    return families.length > 0 && new Set(families).size === 1;
  });
  const atomicIds = new Set(atomicModules.map((module) => module.id));
  const atomicAdjacency = new Map(atomicModules.map((module) => [module.id, new Set<string>()]));
  for (const connection of model.connections) {
    if (!atomicIds.has(connection.source) || !atomicIds.has(connection.target)) continue;
    const source = model.modules.find((module) => module.id === connection.source);
    const target = model.modules.find((module) => module.id === connection.target);
    if (!source || !target || atomicScope(source) !== atomicScope(target)) continue;
    atomicAdjacency.get(source.id)!.add(target.id);
    atomicAdjacency.get(target.id)!.add(source.id);
  }
  const visitedAtomic = new Set<string>();
  for (const module of atomicModules) {
    if (visitedAtomic.has(module.id)) continue;
    const component: string[] = [];
    const pending = [module.id];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visitedAtomic.has(current)) continue;
      visitedAtomic.add(current);
      component.push(current);
      pending.push(...(atomicAdjacency.get(current) ?? []));
    }
    const componentIds = new Set(component);
    const hasBranch = component.some((moduleId) => {
      const incoming = model.connections.filter((connection) => connection.target === moduleId);
      const outgoing = model.connections.filter((connection) => connection.source === moduleId);
      return incoming.length > 1 || outgoing.length > 1;
    });
    const internalDegrees = component.map(
      (moduleId) =>
        model.connections.filter(
          (connection) =>
            componentIds.has(connection.source) &&
            componentIds.has(connection.target) &&
            (connection.source === moduleId || connection.target === moduleId),
        ).length,
    );
    const isSimplePath =
      component.length === 1 ||
      (internalDegrees.filter((degree) => degree === 1).length === 2 &&
        internalDegrees.every((degree) => degree === 1 || degree === 2));
    if (component.length >= 3 && !hasBranch && isSimplePath) {
      findings.push(
        `${component.length} connected one-line atomic modules in “${atomicScope(module)}” form an unbranched same-shape path without a semantic boundary. Merge dependency-connected operators into human-scale modules or replace the atomic card dump with 2–6 meaningful composite members.`,
      );
    }
  }

  const genericModules = model.modules.filter((module) => genericModuleName(module.name));
  if (
    genericModules.length >= 3 &&
    genericModules.length / Math.max(1, model.modules.length) >= 0.3
  ) {
    findings.push(
      `${genericModules.length} of ${model.modules.length} modules use generic step/layer names. Name modules by their architectural role and tensor effect.`,
    );
  }

  for (const module of model.modules) {
    if (executableTransform(module.transform) && placeholderFormula(module.formula)) {
      findings.push(
        `${module.name} [${module.id}] contains executable tensor operations but only a placeholder formula. Derive the source-supported equation or reduce the transform claim; do not invent unsupported mathematics.`,
      );
    }
    if (executableTransform(module.transform) && !formulaHasMathematicalRelation(module.formula)) {
      findings.push(
        `${module.name} [${module.id}] contains executable tensor operations but its formula has no mathematical relation.`,
      );
    }
    const transformOperators = narrativeOperators(`${module.transform} ${module.activation ?? ''}`);
    const formulaOperators = narrativeOperators(module.formula, { formulaContext: true });
    for (const operator of [
      'linear',
      'MLP',
      'convolution',
      'attention',
      'embedding',
      'pooling',
      'soft-threshold',
      'concat',
      'split',
      'exp',
      'log',
    ] as const) {
      const formulaHasOperator = [
        'linear',
        'MLP',
        'convolution',
        'attention',
        'embedding',
        'pooling',
      ].includes(operator)
        ? formulaRepresentsOperator(operator, module.formula)
        : formulaOperators.has(operator);
      if (transformOperators.has(operator) && !formulaHasOperator) {
        findings.push(
          `${module.name} [${module.id}] declares ${operator} in its transform but omits it from the formula.`,
        );
      }
    }
    const declaredOperators = new Set([...transformOperators, ...formulaOperators]);
    for (const operator of explanationClaimedOperators(module.explanation)) {
      if (!declaredOperators.has(operator)) {
        findings.push(
          `${module.name} [${module.id}] explanation claims ${operator}, but transform and formula do not.`,
        );
      }
    }
  }

  const grouped = new Map<string, ModelModule[]>();
  for (const module of model.modules) {
    if (!module.block) continue;
    const members = grouped.get(module.block.id) ?? [];
    members.push(module);
    grouped.set(module.block.id, members);
  }
  for (const [blockId, members] of grouped) {
    const descriptor = members[0]!.block!;
    if (
      members.some(
        (member) =>
          member.block?.label !== descriptor.label ||
          member.block.repeatCount !== descriptor.repeatCount,
      )
    ) {
      findings.push(`Composite block “${blockId}” has inconsistent label or repeatCount metadata.`);
      continue;
    }
    if (members.length < 2 || members.length > 6) {
      findings.push(
        `Composite block “${blockId}” contains ${members.length} modules; use exactly 2–6 semantic modules rather than an empty wrapper or atomic layer dump.`,
      );
      continue;
    }
    const memberIds = new Set(members.map((member) => member.id));
    const adjacency = new Map(members.map((member) => [member.id, new Set<string>()]));
    for (const connection of model.connections) {
      if (!memberIds.has(connection.source) || !memberIds.has(connection.target)) continue;
      adjacency.get(connection.source)!.add(connection.target);
      adjacency.get(connection.target)!.add(connection.source);
    }
    const visited = new Set<string>();
    const pending = [members[0]!.id];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(...(adjacency.get(current) ?? []));
    }
    if (visited.size !== members.length) {
      findings.push(
        `Composite block “${blockId}” is not dependency-connected; every member must participate in one inspectable computation.`,
      );
    }
  }
  return findings;
}
