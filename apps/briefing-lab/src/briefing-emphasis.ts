import { remarkBriefingTitles } from './briefing-title-emphasis';

type Node = { type: string; value?: string; children?: Node[] };
const plain = (node: Node): string => node.value ?? node.children?.map(plain).join('') ?? '';
const protectedTypes = new Set([
  'blockquote',
  'code',
  'inlineCode',
  'math',
  'inlineMath',
  'html',
  'image',
  'heading',
]);

/** Bound model emphasis without rewriting prose; old paper keywords are literal, local-only hints. */
export function remarkBriefingEmphasis({
  titles = [],
  keywords = [],
  enabled = true,
}: {
  titles?: readonly string[];
  keywords?: readonly string[];
  enabled?: boolean;
}) {
  if (!enabled) return () => undefined;
  const exactTitles = new Set(titles);
  const emphasizeKeywords = remarkBriefingTitles({
    protectLinks: true,
    titles: keywords.filter((term) => term.trim().length >= 2 && term.length <= 60).slice(0, 6),
  });
  return (tree: Node) => {
    const seen = new Set<string>();
    const hasStrong = (node: Node): boolean =>
      node.type === 'strong' || !!node.children?.some(hasStrong);
    const visit = (node: Node) => {
      if (protectedTypes.has(node.type) || !node.children) return;
      if (!['paragraph', 'tableCell'].includes(node.type)) {
        node.children.forEach(visit);
        return;
      }
      // Respect model-selected phrases first. Do not fill a quota with more keywords.
      if (!hasStrong(node)) emphasizeKeywords(node);
      const paragraph = plain(node).trim();
      let count = 0;
      const trim = (parent: Node) => {
        if (!parent.children || protectedTypes.has(parent.type)) return;
        parent.children = parent.children.flatMap((child): Node[] => {
          if (child.type !== 'strong') {
            trim(child);
            return [child];
          }
          const phrase = plain(child).trim();
          if (exactTitles.has(phrase)) return [child];
          const key = phrase.toLocaleLowerCase();
          const keep =
            phrase.length > 0 &&
            phrase.length <= 60 &&
            phrase !== paragraph &&
            count < 2 &&
            !seen.has(key);
          if (keep) {
            count++;
            seen.add(key);
            return [child];
          }
          return child.children ?? [];
        });
      };
      trim(node);
    };
    visit(tree);
  };
}
