import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Image, Link, PhrasingContent, Root, Text } from 'mdast';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import Markdown, { type Components } from 'react-markdown';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import { SKIP, visit } from 'unist-util-visit';

const WIKI_LINK_PROTOCOL = 'gosu-wiki:';
const WIKI_EMBED_PROTOCOL = 'gosu-embed:';
const RASTER_ATTACHMENT = /\.(?:avif|gif|jpe?g|png|webp)$/i;

const SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'gosu-wiki'],
    src: [...(defaultSchema.protocols?.src ?? []), 'gosu-embed'],
  },
};

type MarkdownDocumentProps = {
  notePath: string;
  source: string;
  vaultFiles: readonly string[];
  onOpenNote: (path: string) => void;
};

export function MarkdownDocument({
  notePath,
  source,
  vaultFiles,
  onOpenNote,
}: MarkdownDocumentProps) {
  const frontmatter = useMemo(() => extractFrontmatter(source), [source]);
  const components = useMemo<Components>(
    () => ({
      a: ({ children, href }) => (
        <MarkdownLink
          currentPath={notePath}
          href={href}
          vaultFiles={vaultFiles}
          onOpenNote={onOpenNote}
        >
          {children}
        </MarkdownLink>
      ),
      img: ({ alt, src, title }) => (
        <MarkdownImage notePath={notePath} source={src} alt={alt} title={title} />
      ),
    }),
    [notePath, onOpenNote, vaultFiles],
  );

  return (
    <div className="markdown-document">
      {frontmatter && (
        <details className="note-properties">
          <summary>Properties</summary>
          <pre>{frontmatter}</pre>
        </details>
      )}
      <Markdown
        remarkPlugins={[remarkFrontmatter, remarkGfm, remarkObsidianWikiLinks]}
        rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA]]}
        skipHtml
        urlTransform={safeMarkdownUrl}
        components={components}
      >
        {source}
      </Markdown>
    </div>
  );
}

function MarkdownLink({
  currentPath,
  href,
  vaultFiles,
  onOpenNote,
  children,
}: {
  currentPath: string;
  href: string | undefined;
  vaultFiles: readonly string[];
  onOpenNote: (path: string) => void;
  children: ReactNode;
}) {
  const destination = classifyMarkdownLink(currentPath, href, vaultFiles);
  if (destination.kind === 'note') {
    return (
      <a
        href="#"
        className="vault-note-link"
        onClick={(event) => {
          event.preventDefault();
          onOpenNote(destination.path);
        }}
      >
        {children}
      </a>
    );
  }
  if (destination.kind === 'external') {
    return (
      <a
        href={destination.url}
        className="external-markdown-link"
        rel="noreferrer"
        onClick={(event) => {
          event.preventDefault();
          void window.gosu.openExternal(destination.url);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <span
      className={`blocked-markdown-link${destination.reason === 'missing-note' ? ' missing-note' : ''}`}
      title={destination.reason === 'missing-note' ? 'Linked note was not found.' : 'Link blocked.'}
    >
      {children}
    </span>
  );
}

function MarkdownImage({
  notePath,
  source,
  alt,
  title,
}: {
  notePath: string;
  source: string | undefined;
  alt: string | undefined;
  title: string | undefined;
}) {
  const attachmentSource = decodeAttachmentSource(source);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'blocked' }
    | { status: 'failed' }
    | { status: 'ready'; dataUrl: string; path: string }
  >(() => (attachmentSource ? { status: 'loading' } : { status: 'blocked' }));

  useEffect(() => {
    if (!attachmentSource) {
      setState({ status: 'blocked' });
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    void window.gosu.vault
      .readAttachment({ notePath, source: attachmentSource })
      .then((attachment) => {
        if (!active) return;
        setState({
          status: 'ready',
          dataUrl: `data:${attachment.mimeType};base64,${attachment.dataBase64}`,
          path: attachment.path,
        });
      })
      .catch(() => {
        if (active) setState({ status: 'failed' });
      });
    return () => {
      active = false;
    };
  }, [attachmentSource, notePath]);

  const label = alt?.trim() || attachmentSource || 'Markdown image';
  if (state.status !== 'ready') {
    return (
      <span className={`markdown-image-state ${state.status}`}>
        {state.status === 'loading'
          ? `Loading image: ${label}`
          : state.status === 'blocked'
            ? `Remote or unsupported image blocked: ${label}`
            : `Image could not be read: ${label}`}
      </span>
    );
  }
  return (
    <span className="markdown-image">
      <img src={state.dataUrl} alt={label} title={title} loading="lazy" />
      {title && <span>{title}</span>}
    </span>
  );
}

export function remarkObsidianWikiLinks() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (
        index === undefined ||
        !parent ||
        parent.type === 'link' ||
        parent.type === 'linkReference'
      ) {
        return;
      }
      const replacements = splitWikiLinks(node.value);
      if (replacements.length === 1 && replacements[0]?.type === 'text') return;
      parent.children.splice(index, 1, ...replacements);
      return [SKIP, index + replacements.length];
    });
  };
}

function splitWikiLinks(value: string): PhrasingContent[] {
  const results: PhrasingContent[] = [];
  const pattern = /(!?)\[\[([^\]\n]+)\]\]/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor) results.push({ type: 'text', value: value.slice(cursor, index) });
    const embedded = match[1] === '!';
    const rawTarget = match[2] ?? '';
    const separator = rawTarget.indexOf('|');
    const target = (separator === -1 ? rawTarget : rawTarget.slice(0, separator)).trim();
    const alias = (separator === -1 ? '' : rawTarget.slice(separator + 1)).trim();
    if (!target) {
      results.push({ type: 'text', value: match[0] });
    } else if (embedded && RASTER_ATTACHMENT.test(stripWikiFragment(target))) {
      const image: Image = {
        type: 'image',
        url: `${WIKI_EMBED_PROTOCOL}${encodeURIComponent(stripWikiFragment(target))}`,
        alt: wikiDisplayName(target),
      };
      results.push(image);
    } else {
      const label = alias || wikiDisplayName(target);
      const link: Link = {
        type: 'link',
        url: `${WIKI_LINK_PROTOCOL}${encodeURIComponent(target)}`,
        children: [{ type: 'text', value: embedded ? `Embedded note: ${label}` : label }],
      };
      results.push(link);
    }
    cursor = index + match[0].length;
  }
  if (cursor === 0) return [{ type: 'text', value }];
  if (cursor < value.length) results.push({ type: 'text', value: value.slice(cursor) });
  return results;
}

export function classifyMarkdownLink(
  currentPath: string,
  href: string | undefined,
  vaultFiles: readonly string[],
):
  | { kind: 'note'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'blocked'; reason: 'unsafe' | 'missing-note' } {
  if (!href) return { kind: 'blocked', reason: 'unsafe' };
  if (href.startsWith(WIKI_LINK_PROTOCOL)) {
    const target = decodeInternalTarget(href.slice(WIKI_LINK_PROTOCOL.length));
    const path = target ? resolveWikiNote(currentPath, target, vaultFiles) : null;
    return path ? { kind: 'note', path } : { kind: 'blocked', reason: 'missing-note' };
  }
  if (isHttpsUrl(href)) return { kind: 'external', url: href };
  const path = resolveRelativeMarkdownNote(currentPath, href, vaultFiles);
  if (path) return { kind: 'note', path };
  return {
    kind: 'blocked',
    reason: looksLikeMarkdownNote(href) ? 'missing-note' : 'unsafe',
  };
}

export function safeMarkdownUrl(url: string) {
  if (
    url.startsWith(WIKI_LINK_PROTOCOL) ||
    url.startsWith(WIKI_EMBED_PROTOCOL) ||
    isHttpsUrl(url) ||
    isRelativeVaultUrl(url)
  ) {
    return url;
  }
  return '';
}

export function extractFrontmatter(source: string) {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]{0,65536}?)\r?\n(?:---|\.{3})(?:\r?\n|$)/.exec(source);
  return match?.[1]?.trim() || null;
}

function resolveRelativeMarkdownNote(
  currentPath: string,
  href: string,
  vaultFiles: readonly string[],
) {
  if (!looksLikeMarkdownNote(href)) return null;
  const target = decodeInternalTarget(href);
  if (!target) return null;
  const withoutFragment = stripWikiFragment(target);
  const currentDirectory = vaultDirectory(currentPath);
  const candidate = normalizeVaultPath(
    withoutFragment.startsWith('/')
      ? withoutFragment.slice(1)
      : `${currentDirectory}/${withoutFragment}`,
  );
  return candidate ? exactVaultFile(candidate, vaultFiles) : null;
}

function resolveWikiNote(currentPath: string, target: string, vaultFiles: readonly string[]) {
  const withoutFragment = stripWikiFragment(target);
  const markdownTarget = withoutFragment.toLowerCase().endsWith('.md')
    ? withoutFragment
    : `${withoutFragment}.md`;
  const currentDirectory = vaultDirectory(currentPath);
  const candidates = [
    normalizeVaultPath(`${currentDirectory}/${markdownTarget}`),
    normalizeVaultPath(markdownTarget.replace(/^\//, '')),
  ].filter((candidate): candidate is string => candidate !== null);
  for (const candidate of candidates) {
    const exact = exactVaultFile(candidate, vaultFiles);
    if (exact) return exact;
  }
  const basename = markdownTarget.split('/').at(-1)?.toLocaleLowerCase();
  if (!basename) return null;
  const matches = vaultFiles.filter(
    (file) => file.split('/').at(-1)?.toLocaleLowerCase() === basename,
  );
  return matches.length === 1 ? matches[0]! : null;
}

function exactVaultFile(candidate: string, vaultFiles: readonly string[]) {
  const exact = vaultFiles.find((file) => file === candidate);
  if (exact) return exact;
  const normalized = candidate.toLocaleLowerCase();
  const matches = vaultFiles.filter((file) => file.toLocaleLowerCase() === normalized);
  return matches.length === 1 ? matches[0]! : null;
}

function normalizeVaultPath(path: string) {
  const parts: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function vaultDirectory(path: string) {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function looksLikeMarkdownNote(value: string) {
  return /\.md(?:[#?]|$)/i.test(value) && isRelativeVaultUrl(value);
}

function isRelativeVaultUrl(value: string) {
  return (
    value !== '' &&
    !value.startsWith('//') &&
    !/^[a-z][a-z\d+.-]*:/i.test(value) &&
    !value.includes('\0')
  );
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function decodeInternalTarget(value: string) {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return null;
  }
}

function decodeAttachmentSource(source: string | undefined) {
  if (!source) return null;
  const value = source.startsWith(WIKI_EMBED_PROTOCOL)
    ? decodeInternalTarget(source.slice(WIKI_EMBED_PROTOCOL.length))
    : source;
  if (!value || !isRelativeVaultUrl(value)) return null;
  return value;
}

function stripWikiFragment(value: string) {
  return value.split('#', 1)[0]!.trim();
}

function wikiDisplayName(value: string) {
  const path = stripWikiFragment(value);
  return path.split('/').at(-1)?.replace(/\.md$/i, '') || path;
}
