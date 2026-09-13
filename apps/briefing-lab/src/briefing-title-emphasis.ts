type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[] };
/** Emphasize source titles as literal AST text, never by injecting Markdown or HTML. */
export function remarkBriefingTitles({
  titles,
  protectLinks = false,
}: {
  titles: readonly string[];
  protectLinks?: boolean;
}) {
  const exact = [...new Set(titles.filter((title) => title.trim() && title.length <= 1000))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 100);
  if (!exact.length) return () => undefined;
  const pattern = new RegExp(
    exact.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g',
  );
  const visit = (node: MarkdownNode) => {
    if (protectLinks && ['link', 'linkReference'].includes(node.type)) return;
    if (
      [
        'strong',
        'blockquote',
        'code',
        'inlineCode',
        'math',
        'inlineMath',
        'html',
        'image',
      ].includes(node.type) ||
      !node.children
    )
      return;
    node.children = node.children.flatMap((child): MarkdownNode[] => {
      if (child.type !== 'text' || !child.value) {
        visit(child);
        return [child];
      }
      const text = child.value,
        parts: MarkdownNode[] = [];
      let last = 0;
      for (const match of text.matchAll(pattern)) {
        const at = match.index!,
          title = match[0],
          end = at + title.length;
        if (
          (/^[A-Za-z0-9]/.test(title) && /[A-Za-z0-9]/.test(text[at - 1] ?? '')) ||
          (/[A-Za-z0-9]$/.test(title) && /[A-Za-z0-9]/.test(text[end] ?? ''))
        )
          continue;
        if (at > last) parts.push({ type: 'text', value: text.slice(last, at) });
        parts.push({ type: 'strong', children: [{ type: 'text', value: title }] });
        last = end;
      }
      if (!parts.length) return [child];
      if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
      return parts;
    });
  };
  return visit;
}
