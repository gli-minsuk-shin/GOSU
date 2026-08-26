import katex from 'katex';

export const MAX_FORMULA_SOURCE_LENGTH = 4_000;
const MAX_FORMULA_CACHE_ENTRIES = 512;
const trustedCommandPattern =
  /\\(?:href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData)\b/u;
const formulaCache = new Map<string, FormulaRenderResult>();

export type FormulaRenderResult =
  Readonly<{ valid: true; html: string }> | Readonly<{ valid: false; html: ''; reason: string }>;

export function renderFormulaResult(latex: string, displayMode = true): FormulaRenderResult {
  if (latex.length > MAX_FORMULA_SOURCE_LENGTH) {
    return {
      valid: false,
      html: '',
      reason: `Formula exceeds ${MAX_FORMULA_SOURCE_LENGTH.toLocaleString()} characters.`,
    };
  }
  const cacheKey = JSON.stringify([latex, displayMode]);
  const cached = formulaCache.get(cacheKey);
  if (cached) return cached;
  if (trustedCommandPattern.test(latex)) {
    return rememberFormulaResult(cacheKey, {
      valid: false,
      html: '',
      reason: 'Formula contains a command that requires KaTeX trust.',
    });
  }
  try {
    return rememberFormulaResult(cacheKey, {
      valid: true,
      html: katex.renderToString(latex, {
        displayMode,
        throwOnError: true,
        strict: 'warn',
        trust: false,
        maxExpand: 500,
        maxSize: 20,
        output: 'htmlAndMathml',
      }),
    });
  } catch (error) {
    return rememberFormulaResult(cacheKey, {
      valid: false,
      html: '',
      reason: error instanceof Error ? error.message : 'Formula could not be rendered.',
    });
  }
}

function rememberFormulaResult(cacheKey: string, result: FormulaRenderResult) {
  if (formulaCache.size >= MAX_FORMULA_CACHE_ENTRIES) {
    const oldestKey = formulaCache.keys().next().value as string | undefined;
    if (oldestKey) formulaCache.delete(oldestKey);
  }
  formulaCache.set(cacheKey, result);
  return result;
}

export function Formula({ latex, displayMode = true }: { latex: string; displayMode?: boolean }) {
  const result = renderFormulaResult(latex, displayMode);
  if (!result.valid) {
    return (
      <span
        className="formula formula--invalid"
        role="note"
        aria-label="Invalid module formula"
        title={result.reason}
      >
        <span>Formula unavailable</span>
        <code>{latex}</code>
      </span>
    );
  }
  return <span className="formula" dangerouslySetInnerHTML={{ __html: result.html }} />;
}
