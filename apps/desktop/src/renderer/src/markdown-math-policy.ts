import type { Root, RootContent } from 'mdast';
import type { Options as RehypeKatexOptions } from 'rehype-katex';
import type { Options as RehypeSanitizeOptions } from 'rehype-sanitize';
import { SKIP, visit } from 'unist-util-visit';

export const MARKDOWN_MATH_LIMITS = Object.freeze({
  maxFormulaCount: 256,
  maxCharactersPerFormula: 4_096,
  maxTotalCharacters: 32_768,
});

export const MARKDOWN_REMARK_MATH_OPTIONS = Object.freeze({
  singleDollarTextMath: true,
});

export const MARKDOWN_KATEX_OPTIONS: RehypeKatexOptions = Object.freeze({
  trust: false,
  // rehype-katex catches strict render failures and emits escaped katex-error output instead of
  // throwing through the React tree.
  strict: 'warn',
  maxExpand: 1_000,
  maxSize: 20,
  // KaTeX's default paints a failure in alarm red. When a formula is malformed the source is still
  // the user's own words, so it reads in the surrounding colour and keeps the reason in its title.
  // A wall of red text made a whole answer look broken when only its delimiters were.
  errorColor: 'currentColor',
});

type MarkdownMathNode = RootContent & {
  type: 'math' | 'inlineMath';
  value: string;
};

/**
 * Keep large local Markdown files from turning into an unbounded KaTeX/MathML DOM. Formulas that
 * exceed the document budget remain visible as code so the source is never silently discarded.
 */
export function remarkBoundedMath() {
  return (tree: Root) => {
    let formulaCount = 0;
    let totalCharacters = 0;

    visit(tree, (node, index, parent) => {
      if (!isMarkdownMathNode(node) || index === undefined || !parent) {
        return;
      }

      formulaCount += 1;
      totalCharacters = Math.min(
        totalCharacters + node.value.length,
        MARKDOWN_MATH_LIMITS.maxTotalCharacters + 1,
      );

      const withinBudget =
        formulaCount <= MARKDOWN_MATH_LIMITS.maxFormulaCount &&
        node.value.length <= MARKDOWN_MATH_LIMITS.maxCharactersPerFormula &&
        totalCharacters <= MARKDOWN_MATH_LIMITS.maxTotalCharacters;
      if (withinBudget) {
        return;
      }

      const replacement: RootContent =
        node.type === 'inlineMath'
          ? { type: 'inlineCode', value: `$${node.value}$` }
          : { type: 'code', lang: 'tex', value: node.value };
      (parent.children as RootContent[])[index] = replacement;
      return SKIP;
    });
  };
}

function isMarkdownMathNode(node: Root | RootContent): node is MarkdownMathNode {
  return (node.type === 'math' || node.type === 'inlineMath') && 'value' in node;
}

/**
 * Repairs the one malformed shape that destroys a whole answer: a display fence opened by a line
 * that is exactly `$$` and never closed by another such line. Everything after it -- paragraphs,
 * lists, code -- is swallowed into a single formula, KaTeX refuses it, and the rest of the message
 * is lost. Reported from Model Assistant, where a model closed its fence at the end of a content
 * line instead of on a line of its own.
 *
 * Escaping the unclosed opener lets the remaining text parse as what it is, so lists stay lists and
 * inline math after it still renders. Fences inside code blocks are left alone: a `$$` in a ```
 * block is sample text, not a delimiter.
 */
export function repairUnclosedMathFence(source: string): string {
  if (!source.includes('$$')) return source;
  const lines = source.split('\n');
  let codeFence: string | null = null;
  let opener = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim();
    const fence = /^(`{3,}|~{3,})/u.exec(trimmed)?.[1];
    if (codeFence) {
      if (fence && trimmed.startsWith(codeFence)) codeFence = null;
      continue;
    }
    if (fence) {
      codeFence = fence;
      continue;
    }
    if (trimmed === '$$') opener = opener < 0 ? index : -1;
  }
  if (opener < 0) return source;
  lines[opener] = lines[opener]!.replace('$$', '\\$\\$');
  return lines.join('\n');
}

/** An unescaped `$` that survived the delimiter scan. `\$` is a literal dollar and stays math. */
const STRAY_DELIMITER = /(?<!\\)\$/u;

/**
 * A formula that still holds a `$` never was one. remark-math removes the delimiters it matched, so
 * a surviving `$` means the scan ran past one and swallowed ordinary prose.
 *
 * The reported case: a model opened `$$` on its own line and put the closing `$$` at the end of a
 * content line, which does not close the fence. Everything after it became a single formula, KaTeX
 * refused it, and the entire rest of the answer rendered as error text -- paragraphs, lists and all.
 * Demoting puts the words back as words, split on blank lines so the paragraphs survive.
 */
export function remarkDemoteProseMath() {
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (!isMarkdownMathNode(node) || index === undefined || !parent) return;
      if (!STRAY_DELIMITER.test(node.value)) return;

      if (node.type === 'inlineMath') {
        (parent.children as RootContent[])[index] = { type: 'text', value: `$${node.value}$` };
        return SKIP;
      }
      const paragraphs = node.value
        .split(/\n[ \t]*\n/u)
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map<RootContent>((chunk) => ({
          type: 'paragraph',
          children: [{ type: 'text', value: chunk }],
        }));
      (parent.children as RootContent[]).splice(
        index,
        1,
        ...(paragraphs.length ? paragraphs : [{ type: 'paragraph', children: [] } as RootContent]),
      );
      return [SKIP, index + paragraphs.length];
    });
  };
}

export function markdownMathSanitizeAttributes(
  attributes: RehypeSanitizeOptions['attributes'],
): NonNullable<RehypeSanitizeOptions['attributes']> {
  return {
    ...attributes,
    // The untrusted tree is sanitized before KaTeX. Preserve only remark-math's bounded marker
    // classes; KaTeX then expands those markers into local HTML and MathML with trust disabled.
    div: [...(attributes?.div ?? []), ['className', 'math', 'math-display']],
    span: [...(attributes?.span ?? []), ['className', 'math', 'math-inline']],
  };
}
