import { uiText, useUiText } from '@gosu/ui/language';
import katex from 'katex';

export const MAX_FORMULA_SOURCE_LENGTH = 4_000;
const MAX_FORMULA_CACHE_ENTRIES = 512;
const trustedCommandPattern =
  /\\(?:href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData)\b/u;
const formulaCache = new Map<string, FormulaRenderResult>();

export type FormulaRenderResult =
  Readonly<{ valid: true; html: string }> | Readonly<{ valid: false; html: ''; reason: string }>;

export function formulaDisplayRows(latex: string) {
  const rows: string[] = [];
  let buffer = '';
  let environmentDepth = 0;
  let parenthesisDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  const flush = () => {
    const row = buffer.trim();
    if (row) rows.push(row);
    buffer = '';
  };
  let index = 0;
  while (index < latex.length) {
    const rest = latex.slice(index);
    const begin = /^\\begin\{[^{}]{1,40}\}/u.exec(rest)?.[0];
    if (begin) {
      environmentDepth += 1;
      buffer += begin;
      index += begin.length;
      continue;
    }
    const end = /^\\end\{[^{}]{1,40}\}/u.exec(rest)?.[0];
    if (end) {
      environmentDepth = Math.max(0, environmentDepth - 1);
      buffer += end;
      index += end.length;
      continue;
    }
    const groupingDepth = parenthesisDepth + bracketDepth + braceDepth;
    if (environmentDepth === 0 && groupingDepth === 0) {
      const separator = /^,\s*\\(?:quad|qquad)\s*/u.exec(rest)?.[0];
      if (separator) {
        flush();
        index += separator.length;
        continue;
      }
      if (rest[0] === '\n' || rest.startsWith('\r\n')) {
        flush();
        index += rest.startsWith('\r\n') ? 2 : 1;
        continue;
      }
    }
    const character = rest[0]!;
    if (character === '(') parenthesisDepth += 1;
    else if (character === ')') parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    else if (character === '[') bracketDepth += 1;
    else if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === '{') braceDepth += 1;
    else if (character === '}') braceDepth = Math.max(0, braceDepth - 1);
    buffer += character;
    index += 1;
  }
  flush();
  return rows;
}

function alignedFormulaRow(line: string) {
  if (line.includes('&')) return line;
  const equalsIndex = line.indexOf('=');
  if (equalsIndex < 0) return line;
  return `${line.slice(0, equalsIndex)}&=${line.slice(equalsIndex + 1)}`;
}

export function escapeLatexTextUnderscores(latex: string) {
  return latex.replace(/\\text\{([^{}]*)\}/gu, (_match, text: string) => {
    const escaped = text.replace(/(^|[^\\])_/gu, '$1\\_');
    return `\\text{${escaped}}`;
  });
}

export function formulaSourceForRendering(latex: string, displayMode = true) {
  const normalized = escapeLatexTextUnderscores(latex);
  if (/\\begin\{[^{}]{1,40}\}/u.test(normalized)) return normalized;
  const lines = formulaDisplayRows(normalized);
  if (lines.length <= 1) return normalized;
  if (!displayMode) return lines.join(String.raw`\mathrel{;}\quad `);
  return (
    String.raw`\begin{aligned}` +
    `\n${lines.map(alignedFormulaRow).join(String.raw` \\ `)}\n` +
    String.raw`\end{aligned}`
  );
}

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
    const source = formulaSourceForRendering(latex, displayMode);
    return rememberFormulaResult(cacheKey, {
      valid: true,
      html: katex.renderToString(source, {
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
  useUiText();
  const result = renderFormulaResult(latex, displayMode);
  if (!result.valid) {
    return (
      <span
        className="formula formula--invalid"
        role="note"
        aria-label={uiText('Invalid module formula')}
        title={result.reason}
      >
        <span>{uiText('Formula unavailable')}</span>
        <code>{latex}</code>
      </span>
    );
  }
  return <span className="formula" dangerouslySetInnerHTML={{ __html: result.html }} />;
}
