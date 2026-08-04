import type { GitFileEntry } from '../../shared/git-workspace-contracts';

export type RepositoryTreeRow = Readonly<{
  path: string;
  name: string;
  depth: number;
  kind: 'directory' | GitFileEntry['kind'];
}>;

type MutableNode = {
  path: string;
  name: string;
  kind: RepositoryTreeRow['kind'];
  children: Map<string, MutableNode>;
};

function compareNodes(left: MutableNode, right: MutableNode) {
  if (left.kind === 'directory' && right.kind !== 'directory') return -1;
  if (left.kind !== 'directory' && right.kind === 'directory') return 1;
  return left.name.localeCompare(right.name);
}

export function repositoryTreeRows(
  files: readonly GitFileEntry[],
  expandedDirectories: ReadonlySet<string>,
  search: string,
): readonly RepositoryTreeRow[] {
  const normalizedSearch = search.trim().toLocaleLowerCase('en-US');
  if (normalizedSearch) {
    return files
      .filter((file) => file.path.toLocaleLowerCase('en-US').includes(normalizedSearch))
      .map((file) => ({
        path: file.path,
        name: file.path,
        depth: 0,
        kind: file.kind,
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  const root: MutableNode = {
    path: '',
    name: '',
    kind: 'directory',
    children: new Map(),
  };
  for (const file of files) {
    const components = file.path.split('/');
    let current = root;
    for (const [index, component] of components.entries()) {
      const path = components.slice(0, index + 1).join('/');
      const existing = current.children.get(component);
      if (existing) {
        current = existing;
        continue;
      }
      const node: MutableNode = {
        path,
        name: component,
        kind: index === components.length - 1 ? file.kind : 'directory',
        children: new Map(),
      };
      current.children.set(component, node);
      current = node;
    }
  }

  const rows: RepositoryTreeRow[] = [];
  const visit = (parent: MutableNode, depth: number) => {
    for (const node of [...parent.children.values()].sort(compareNodes)) {
      rows.push({ path: node.path, name: node.name, depth, kind: node.kind });
      if (node.kind === 'directory' && expandedDirectories.has(node.path)) visit(node, depth + 1);
    }
  };
  visit(root, 0);
  return rows;
}
