import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ResearchNotesTree } from '../src/renderer/src/notes-view';

const files = [
  'Areas/Vision/Segmentation.md',
  'Areas/NLP.md',
  'Projects/Alpha.md',
  'Root.md',
] as const;

function treeItem(html: string, label: string) {
  const items = html.match(/<button\b[^>]*role="treeitem"[^>]*>[\s\S]*?<\/button>/gu) ?? [];
  const item = items.find(
    (candidate) =>
      candidate
        .replaceAll(/<[^>]+>/gu, '')
        .replaceAll('&amp;', '&')
        .trim() === label,
  );
  if (!item) throw new Error(`tree_item_not_found:${label}`);
  return item;
}

function renderTree(expandedDirectories: ReadonlySet<string>, selectedPath: string | null = null) {
  return renderToStaticMarkup(
    <ResearchNotesTree
      files={files}
      expandedDirectories={expandedDirectories}
      selectedPath={selectedPath}
      busy={false}
      onToggleDirectory={vi.fn()}
      onOpenFile={vi.fn()}
    />,
  );
}

describe('Research Notes tree accessibility and disclosure', () => {
  it('renders a labelled ARIA tree while keeping collapsed descendants out of the DOM', () => {
    const html = renderTree(new Set(['Areas']));

    expect(html).toMatch(/role="tree"[^>]*aria-label="Research Notes files"/u);
    expect(treeItem(html, 'Areas')).toContain('aria-level="1"');
    expect(treeItem(html, 'Areas')).toContain('aria-expanded="true"');
    expect(treeItem(html, 'Areas')).toContain('aria-posinset="1"');
    expect(treeItem(html, 'Areas')).toContain('aria-setsize="3"');

    expect(treeItem(html, 'Vision')).toContain('aria-level="2"');
    expect(treeItem(html, 'Vision')).toContain('aria-expanded="false"');
    expect(treeItem(html, 'Vision')).toContain('aria-posinset="1"');
    expect(treeItem(html, 'Vision')).toContain('aria-setsize="2"');
    expect(treeItem(html, 'NLP.md')).toContain('aria-level="2"');

    expect(treeItem(html, 'Projects')).toContain('aria-expanded="false"');
    expect(html).not.toContain('Segmentation.md');
    expect(html).not.toContain('Alpha.md');
  });

  it('marks the revealed current file as the single selected and tabbable tree item', () => {
    const html = renderTree(new Set(['Areas', 'Areas/Vision']), 'Areas/Vision/Segmentation.md');
    const selected = treeItem(html, 'Segmentation.md');

    expect(selected).toContain('aria-level="3"');
    expect(selected).toContain('aria-selected="true"');
    expect(selected).toContain('aria-current="page"');
    expect(selected).toContain('tabindex="0"');
    expect(selected).not.toContain('aria-expanded=');
    expect(html.match(/tabindex="0"/gu)).toHaveLength(1);
    expect(treeItem(html, 'Vision')).toContain('aria-expanded="true"');
  });
});
