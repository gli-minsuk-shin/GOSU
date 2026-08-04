import { describe, expect, it } from 'vitest';

import { repositoryTreeRows } from '../src/renderer/src/repository-tree-model';
import type { GitFileEntry } from '../src/shared/git-workspace-contracts';

const files: readonly GitFileEntry[] = [
  { path: 'src/views/editor.tsx', kind: 'file' },
  { path: 'README.md', kind: 'file' },
  { path: 'vendor/optimizer', kind: 'submodule' },
  { path: 'src/index.ts', kind: 'file' },
  { path: 'docs/current', kind: 'symlink' },
  { path: 'docs/architecture.md', kind: 'file' },
];

describe('repositoryTreeRows', () => {
  it('builds a stable directory-first root independent of input order', () => {
    const rows = repositoryTreeRows(files, new Set(), '');

    expect(rows).toEqual([
      { path: 'docs', name: 'docs', depth: 0, kind: 'directory' },
      { path: 'src', name: 'src', depth: 0, kind: 'directory' },
      { path: 'vendor', name: 'vendor', depth: 0, kind: 'directory' },
      { path: 'README.md', name: 'README.md', depth: 0, kind: 'file' },
    ]);
    expect(repositoryTreeRows([...files].reverse(), new Set(), '')).toEqual(rows);
  });

  it('only reveals descendants of explicitly expanded directories', () => {
    expect(repositoryTreeRows(files, new Set(['src']), '')).toEqual([
      { path: 'docs', name: 'docs', depth: 0, kind: 'directory' },
      { path: 'src', name: 'src', depth: 0, kind: 'directory' },
      { path: 'src/views', name: 'views', depth: 1, kind: 'directory' },
      { path: 'src/index.ts', name: 'index.ts', depth: 1, kind: 'file' },
      { path: 'vendor', name: 'vendor', depth: 0, kind: 'directory' },
      { path: 'README.md', name: 'README.md', depth: 0, kind: 'file' },
    ]);

    expect(repositoryTreeRows(files, new Set(['src', 'src/views']), '')).toContainEqual({
      path: 'src/views/editor.tsx',
      name: 'editor.tsx',
      depth: 2,
      kind: 'file',
    });
  });

  it('preserves file kinds when expanded', () => {
    const rows = repositoryTreeRows(files, new Set(['docs', 'vendor']), '');

    expect(rows).toContainEqual({
      path: 'docs/current',
      name: 'current',
      depth: 1,
      kind: 'symlink',
    });
    expect(rows).toContainEqual({
      path: 'vendor/optimizer',
      name: 'optimizer',
      depth: 1,
      kind: 'submodule',
    });
  });

  it('searches full paths case-insensitively without requiring folders to be expanded', () => {
    expect(repositoryTreeRows(files, new Set(), '  TS  ')).toEqual([
      { path: 'src/index.ts', name: 'src/index.ts', depth: 0, kind: 'file' },
      {
        path: 'src/views/editor.tsx',
        name: 'src/views/editor.tsx',
        depth: 0,
        kind: 'file',
      },
    ]);
  });

  it('returns no rows for a search with no matches', () => {
    expect(repositoryTreeRows(files, new Set(['src']), 'missing-file')).toEqual([]);
  });
});
