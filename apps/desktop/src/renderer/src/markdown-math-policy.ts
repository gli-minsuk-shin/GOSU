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
