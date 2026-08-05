import { describe, expect, it } from 'vitest';

import {
  localNotesTreeRows,
  revealLocalNote,
  toggleLocalNotesDirectory,
} from '../src/renderer/src/local-notes-tree-model';

function paths(files: readonly string[], expandedDirectories: ReadonlySet<string> = new Set()) {
  return localNotesTreeRows(files, expandedDirectories).map((row) => row.path);
}

describe('Research Notes folder tree model', () => {
  it('sorts folders before files naturally at every level and deduplicates input paths', () => {
    const files = [
      'Root 10.md',
      'Areas/Note 10.md',
      'Projects/Beta.md',
      'Areas/Sub 10/Paper.md',
      'Root 2.md',
      'Areas/Note 2.md',
      'Areas/Sub 2/Paper.md',
      'Zeta.md',
      'Projects/Beta.md',
    ];
    const expanded = new Set(['Areas', 'Projects']);

    const rows = localNotesTreeRows(files, expanded);

    expect(rows.map((row) => row.path)).toEqual([
      'Areas',
      'Areas/Sub 2',
      'Areas/Sub 10',
      'Areas/Note 2.md',
      'Areas/Note 10.md',
      'Projects',
      'Projects/Beta.md',
      'Root 2.md',
      'Root 10.md',
      'Zeta.md',
    ]);
    expect(localNotesTreeRows([...files].reverse(), expanded)).toEqual(rows);
    expect(rows.filter((row) => row.path === 'Projects/Beta.md')).toHaveLength(1);
    expect(rows.find((row) => row.path === 'Areas/Sub 2')).toMatchObject({
      name: 'Sub 2',
      parentPath: 'Areas',
      depth: 1,
      kind: 'directory',
      posInSet: 1,
      setSize: 4,
    });
  });

  it('toggles one folder without erasing sibling or nested expansion state', () => {
    const files = ['Areas/Vision/Segmentation.md', 'Areas/NLP.md', 'Projects/Alpha.md'];
    const initial = new Set(['Areas/Vision', 'Projects']);

    expect(paths(files, initial)).toEqual(['Areas', 'Projects', 'Projects/Alpha.md']);

    const opened = toggleLocalNotesDirectory(initial, 'Areas');
    expect([...opened].sort()).toEqual(['Areas', 'Areas/Vision', 'Projects']);
    expect(paths(files, opened)).toEqual([
      'Areas',
      'Areas/Vision',
      'Areas/Vision/Segmentation.md',
      'Areas/NLP.md',
      'Projects',
      'Projects/Alpha.md',
    ]);

    const closed = toggleLocalNotesDirectory(opened, 'Areas');
    expect([...closed].sort()).toEqual(['Areas/Vision', 'Projects']);
    expect(paths(files, closed)).toEqual(['Areas', 'Projects', 'Projects/Alpha.md']);
    expect([...initial].sort()).toEqual(['Areas/Vision', 'Projects']);
  });

  it('reveals every current-file ancestor while preserving unrelated open folders', () => {
    const initial = new Set(['Projects']);
    const revealed = revealLocalNote(initial, 'Areas/Vision/Segmentation.md');

    expect([...revealed].sort()).toEqual(['Areas', 'Areas/Vision', 'Projects']);
    expect(revealed.has('Areas/Vision/Segmentation.md')).toBe(false);
    expect([...initial]).toEqual(['Projects']);
    expect(paths(['Areas/Vision/Segmentation.md', 'Projects/Alpha.md'], revealed)).toContain(
      'Areas/Vision/Segmentation.md',
    );

    expect([...revealLocalNote(initial, 'Root.md')]).toEqual(['Projects']);
    expect([...revealLocalNote(initial, '../outside.md')]).toEqual(['Projects']);
  });

  it('drops malformed, non-Markdown, duplicate, and conflicting paths without throwing', () => {
    const tooLong = `${'a'.repeat(5_000)}.md`;
    const files = [
      'safe/root.md',
      'safe/nested/Paper.MD',
      'safe/root.md',
      'paper.md',
      'paper.md/child.md',
      '',
      '/absolute.md',
      '../escape.md',
      'safe/../../escape.md',
      './relative.md',
      'safe/./dot.md',
      'safe//empty.md',
      'nul\0name.md',
      'line\nbreak.md',
      'delete\u007fme.md',
      'not-markdown.txt',
      tooLong,
    ];
    const expanded = new Set(['safe', 'safe/nested', 'paper.md']);

    expect(() => localNotesTreeRows(files, expanded)).not.toThrow();
    const rows = localNotesTreeRows(files, expanded);

    expect(rows.map((row) => row.path)).toEqual([
      'safe',
      'safe/nested',
      'safe/nested/Paper.MD',
      'safe/root.md',
      'paper.md',
    ]);
    expect(rows.find((row) => row.path === 'paper.md')).toMatchObject({ kind: 'file' });
    expect(localNotesTreeRows([...files].reverse(), expanded)).toEqual(rows);
  });
});
