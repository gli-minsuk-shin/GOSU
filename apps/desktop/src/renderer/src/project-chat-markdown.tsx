import type { ReactNode } from 'react';
import rehypeKatex, { type Options as RehypeKatexOptions } from 'rehype-katex';
import rehypeSanitize, {
  defaultSchema,
  type Options as RehypeSanitizeOptions,
} from 'rehype-sanitize';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import 'katex/dist/katex.min.css';

const PROJECT_CHAT_SANITIZE_SCHEMA: RehypeSanitizeOptions = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Sanitize the untrusted Markdown tree before KaTeX expands these bounded marker classes
    // into its own locally generated HTML and MathML tree.
    div: [...(defaultSchema.attributes?.div ?? []), ['className', 'math', 'math-display']],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', 'math', 'math-inline']],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['https'],
  },
};

const PROJECT_CHAT_KATEX_OPTIONS: RehypeKatexOptions = {
  trust: false,
  // rehype-katex owns throwOnError: it catches the strict render and retries malformed formulas
  // with escaped `katex-error` output instead of throwing through the React tree.
  strict: 'warn',
  maxExpand: 1_000,
  maxSize: 20,
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
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
      rehypePlugins={[
        [rehypeSanitize, PROJECT_CHAT_SANITIZE_SCHEMA],
        [rehypeKatex, PROJECT_CHAT_KATEX_OPTIONS],
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
