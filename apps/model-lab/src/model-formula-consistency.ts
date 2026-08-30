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
    [/relu/u, /relu/u, 'ReLU'],
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
): readonly string[] {
  const candidates: readonly ModelSpec[] = Array.isArray(models)
    ? (models as readonly ModelSpec[])
    : [models as ModelSpec];
  return candidates.flatMap((model) =>
    model.modules.flatMap((module) =>
      moduleFormulaConsistencyFindings(module).map(
        (finding) => `${model.name}@${model.version} [${model.id}] — ${finding}`,
      ),
    ),
  );
}
