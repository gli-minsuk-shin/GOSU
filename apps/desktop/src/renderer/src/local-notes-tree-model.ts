export type LocalNotesTreeRow = Readonly<{
  path: string;
  name: string;
  parentPath: string | null;
  depth: number;
  kind: 'directory' | 'file';
  posInSet: number;
  setSize: number;
}>;

type MutableLocalNotesNode = {
  path: string;
  name: string;
  parentPath: string | null;
  kind: LocalNotesTreeRow['kind'];
  children: Map<string, MutableLocalNotesNode>;
};

const MAX_LOCAL_NOTE_PATH_LENGTH = 1_000;
const MAX_LOCAL_NOTE_COMPONENTS = 33;
const NATURAL_NAME_ORDER = new Intl.Collator('en-US', {
  numeric: true,
  sensitivity: 'base',
});

function exactOrder(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 31 || codePoint === 127;
  });
}

function compareNodes(left: MutableLocalNotesNode, right: MutableLocalNotesNode) {
  if (left.kind === 'directory' && right.kind !== 'directory') return -1;
  if (left.kind !== 'directory' && right.kind === 'directory') return 1;
  return (
    NATURAL_NAME_ORDER.compare(left.name, right.name) ||
    exactOrder(left.name, right.name) ||
    exactOrder(left.path, right.path)
  );
}

function safePathComponents(path: string, markdownRequired: boolean) {
  if (
    path.length === 0 ||
    path.length > MAX_LOCAL_NOTE_PATH_LENGTH ||
    path.startsWith('/') ||
    path.endsWith('/') ||
    hasControlCharacter(path)
  ) {
    return null;
  }
  const components = path.split('/');
  if (
    components.length === 0 ||
    components.length > MAX_LOCAL_NOTE_COMPONENTS ||
    components.some(
      (component) =>
        component.length === 0 ||
        component === '.' ||
        component === '..' ||
        component.startsWith('.'),
    ) ||
    (markdownRequired && !/\.md$/iu.test(components.at(-1)!))
  ) {
    return null;
  }
  return components;
}

function validMarkdownPaths(files: readonly string[]) {
  return [...new Set(files.filter((path) => safePathComponents(path, true) !== null))].sort(
    exactOrder,
  );
}

function insertMarkdownPath(root: MutableLocalNotesNode, filePath: string) {
  const components = safePathComponents(filePath, true);
  if (!components) return;

  let current = root;
  for (const [index, component] of components.entries()) {
    const last = index === components.length - 1;
    const kind: LocalNotesTreeRow['kind'] = last ? 'file' : 'directory';
    const path = components.slice(0, index + 1).join('/');
    const existing = current.children.get(component);
    if (existing) {
      if (existing.kind !== kind) return;
      current = existing;
      continue;
    }
    const node: MutableLocalNotesNode = {
      path,
      name: component,
      parentPath: current.path || null,
      kind,
      children: new Map(),
    };
    current.children.set(component, node);
    current = node;
  }
}

export function localNotesTreeRows(
  files: readonly string[],
  expandedDirectories: ReadonlySet<string>,
): readonly LocalNotesTreeRow[] {
  const root: MutableLocalNotesNode = {
    path: '',
    name: '',
    parentPath: null,
    kind: 'directory',
    children: new Map(),
  };
  for (const file of validMarkdownPaths(files)) insertMarkdownPath(root, file);

  const rows: LocalNotesTreeRow[] = [];
  const visit = (parent: MutableLocalNotesNode, depth: number) => {
    const children = [...parent.children.values()].sort(compareNodes);
    for (const [index, child] of children.entries()) {
      rows.push({
        path: child.path,
        name: child.name,
        parentPath: child.parentPath,
        depth,
        kind: child.kind,
        posInSet: index + 1,
        setSize: children.length,
      });
      if (child.kind === 'directory' && expandedDirectories.has(child.path)) {
        visit(child, depth + 1);
      }
    }
  };
  visit(root, 0);
  return rows;
}

export function toggleLocalNotesDirectory(
  expandedDirectories: ReadonlySet<string>,
  directoryPath: string,
) {
  if (!safePathComponents(directoryPath, false)) return expandedDirectories;
  const next = new Set(expandedDirectories);
  if (next.has(directoryPath)) next.delete(directoryPath);
  else next.add(directoryPath);
  return next;
}

export function revealLocalNote(expandedDirectories: ReadonlySet<string>, filePath: string) {
  const components = safePathComponents(filePath, true);
  if (!components) return expandedDirectories;
  const next = new Set(expandedDirectories);
  for (let index = 1; index < components.length; index += 1) {
    next.add(components.slice(0, index).join('/'));
  }
  return next;
}
