const WIKILINK = /!??\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

export type ObsidianNoteMetadata = {
  frontmatter: Record<string, string | string[]>;
  wikilinks: string[];
};

export function inspectObsidianMarkdown(source: string): ObsidianNoteMetadata {
  const frontmatter: Record<string, string | string[]> = {};
  if (source.startsWith('---\n')) {
    const end = source.indexOf('\n---', 4);
    if (end > 0) {
      for (const raw of source.slice(4, end).split('\n')) {
        const separator = raw.indexOf(':');
        if (separator <= 0) continue;
        const key = raw.slice(0, separator).trim();
        const value = raw.slice(separator + 1).trim();
        if (/^[A-Za-z0-9_-]+$/.test(key)) {
          frontmatter[key] =
            value.startsWith('[') && value.endsWith(']')
              ? value
                  .slice(1, -1)
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean)
              : value;
        }
      }
    }
  }
  const wikilinks = [...source.matchAll(WIKILINK)]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean);
  return { frontmatter, wikilinks: [...new Set(wikilinks)] };
}
