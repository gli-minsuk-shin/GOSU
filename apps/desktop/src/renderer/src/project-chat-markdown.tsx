import type { ReactNode } from 'react';
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
} from './markdown-math-policy';

const PROJECT_CHAT_SANITIZE_SCHEMA: RehypeSanitizeOptions = {
  ...defaultSchema,
  attributes: markdownMathSanitizeAttributes(defaultSchema.attributes),
  protocols: {
    ...defaultSchema.protocols,
    href: ['https'],
  },
};

const PROJECT_CHAT_MARKDOWN_COMPONENTS: Components = {
  a: ({ children, href }) => <ProjectChatLink href={href}>{children}</ProjectChatLink>,
  img: ({ alt }) => (
    <span className="project-chat-markdown-image-blocked">
      Remote image blocked{alt?.trim() ? `: ${alt.trim()}` : ''}
    </span>
  ),
};

export function ProjectChatMarkdown({ source }: { source: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, [remarkMath, MARKDOWN_REMARK_MATH_OPTIONS], remarkBoundedMath]}
      rehypePlugins={[
        [rehypeSanitize, PROJECT_CHAT_SANITIZE_SCHEMA],
        [rehypeKatex, MARKDOWN_KATEX_OPTIONS],
      ]}
      skipHtml
      urlTransform={safeProjectChatMarkdownUrl}
      components={PROJECT_CHAT_MARKDOWN_COMPONENTS}
    >
      {source}
    </Markdown>
  );
}

function ProjectChatLink({ href, children }: { href: string | undefined; children: ReactNode }) {
  if (!href || !isHttpsUrl(href)) {
    return <span className="project-chat-markdown-link-blocked">{children}</span>;
  }
  return (
    <a
      href={href}
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault();
        void window.gosu.openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

export function safeProjectChatMarkdownUrl(url: string) {
  return isHttpsUrl(url) ? url : '';
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
