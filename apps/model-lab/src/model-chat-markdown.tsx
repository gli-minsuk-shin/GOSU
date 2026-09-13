import type { Root, RootContent } from 'mdast';
import { memo, type ReactNode } from 'react';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, {
  defaultSchema,
  type Options as RehypeSanitizeOptions,
} from 'rehype-sanitize';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { SKIP, visit } from 'unist-util-visit';

export const MODEL_CHAT_MATH_LIMITS = Object.freeze({
  maxFormulaCount: 256,
  maxCharactersPerFormula: 4_096,
  maxTotalCharacters: 32_768,
});

const MODEL_CHAT_REMARK_MATH_OPTIONS = Object.freeze({
  singleDollarTextMath: true,
});

const MODEL_CHAT_KATEX_OPTIONS = Object.freeze({
  trust: false,
  strict: 'warn' as const,
  maxExpand: 1_000,
  maxSize: 20,
});

const MODEL_CHAT_SANITIZE_SCHEMA: RehypeSanitizeOptions = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), ['className', 'math', 'math-display']],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', 'math', 'math-inline']],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['https'],
  },
};

type ModelChatMathNode = RootContent & {
  type: 'math' | 'inlineMath';
  value: string;
};

export function remarkBoundedModelChatMath() {
  return (tree: Root) => {
    let formulaCount = 0;
    let totalCharacters = 0;

    visit(tree, (node, index, parent) => {
      if (!isModelChatMathNode(node) || index === undefined || !parent) return;

      formulaCount += 1;
      totalCharacters = Math.min(
        totalCharacters + node.value.length,
        MODEL_CHAT_MATH_LIMITS.maxTotalCharacters + 1,
      );
      const withinBudget =
        formulaCount <= MODEL_CHAT_MATH_LIMITS.maxFormulaCount &&
        node.value.length <= MODEL_CHAT_MATH_LIMITS.maxCharactersPerFormula &&
        totalCharacters <= MODEL_CHAT_MATH_LIMITS.maxTotalCharacters;
      if (withinBudget) return;

      const replacement: RootContent =
        node.type === 'inlineMath'
          ? { type: 'inlineCode', value: `$${node.value}$` }
          : { type: 'code', lang: 'tex', value: node.value };
      (parent.children as RootContent[])[index] = replacement;
      return SKIP;
    });
  };
}

function isModelChatMathNode(node: Root | RootContent): node is ModelChatMathNode {
  return (node.type === 'math' || node.type === 'inlineMath') && 'value' in node;
}

const MODEL_CHAT_COMPONENTS: Components = {
  a: ({ children, href }) => <ModelChatLink href={href}>{children}</ModelChatLink>,
  img: ({ alt }) => (
    <span className="model-chat-markdown-image-blocked">
      Remote image blocked{alt?.trim() ? `: ${alt.trim()}` : ''}
    </span>
  ),
};

export const ModelChatMarkdown = memo(function ModelChatMarkdown({ source }: { source: string }) {
  return (
    <div className="model-chat-markdown">
      <Markdown
        remarkPlugins={[
          remarkGfm,
          [remarkMath, MODEL_CHAT_REMARK_MATH_OPTIONS],
          remarkBoundedModelChatMath,
        ]}
        rehypePlugins={[
          [rehypeSanitize, MODEL_CHAT_SANITIZE_SCHEMA],
          [rehypeKatex, MODEL_CHAT_KATEX_OPTIONS],
        ]}
        skipHtml
        urlTransform={safeModelChatMarkdownUrl}
        components={MODEL_CHAT_COMPONENTS}
      >
        {source}
      </Markdown>
    </div>
  );
});

function ModelChatLink({ href, children }: { href: string | undefined; children: ReactNode }) {
  if (!href || !isHttpsUrl(href)) {
    return <span className="model-chat-markdown-link-blocked">{children}</span>;
  }
  return (
    <a href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  );
}

export function safeModelChatMarkdownUrl(url: string) {
  return isHttpsUrl(url) ? url : '';
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
