import { memo, type ReactNode } from 'react';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, {
  defaultSchema,
  type Options as RehypeSanitizeOptions,
} from 'rehype-sanitize';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {
  MARKDOWN_KATEX_OPTIONS,
  MARKDOWN_REMARK_MATH_OPTIONS,
  markdownMathSanitizeAttributes,
  remarkBoundedMath,
  remarkDemoteProseMath,
  repairUnclosedMathFence,
} from '../../desktop/src/renderer/src/markdown-math-policy';

/**
 * One policy for every GOSU chat. Model Lab used to keep its own copy of these limits and its own
 * bounding plugin; they drifted apart from the desktop renderer's and only one of them ever got a
 * fix. The shared module is the single place a formula rule is written now.
 */
export {
  MARKDOWN_MATH_LIMITS as MODEL_CHAT_MATH_LIMITS,
  remarkBoundedMath as remarkBoundedModelChatMath,
} from '../../desktop/src/renderer/src/markdown-math-policy';

const MODEL_CHAT_SANITIZE_SCHEMA: RehypeSanitizeOptions = {
  ...defaultSchema,
  attributes: markdownMathSanitizeAttributes(defaultSchema.attributes),
  protocols: {
    ...defaultSchema.protocols,
    href: ['https'],
  },
};

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
          [remarkMath, MARKDOWN_REMARK_MATH_OPTIONS],
          remarkDemoteProseMath,
          remarkBoundedMath,
        ]}
        rehypePlugins={[
          [rehypeSanitize, MODEL_CHAT_SANITIZE_SCHEMA],
          [rehypeKatex, MARKDOWN_KATEX_OPTIONS],
        ]}
        skipHtml
        urlTransform={safeModelChatMarkdownUrl}
        components={MODEL_CHAT_COMPONENTS}
      >
        {repairUnclosedMathFence(source)}
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
