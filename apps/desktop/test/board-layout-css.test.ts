import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
const workspaceTaskStyles = readFileSync(
  new URL('../src/renderer/src/workspace-tasks-view.css', import.meta.url),
  'utf8',
);

function declarationsFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return [...styles.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'gu'))].map(
    (match) => match[1] ?? '',
  );
}

describe('Board responsive layout CSS', () => {
  it('fits the five-column Board to the normal content pane', () => {
    const workspace = declarationsFor('.kanban-workspace')[0] ?? '';
    const board = declarationsFor('.kanban-board')[0] ?? '';
    const column = declarationsFor('.kanban-column')[0] ?? '';

    expect(workspace).toContain('container: kanban-workspace / inline-size');
    expect(workspace).toContain('width: 100%');
    expect(workspace).toContain('min-width: 0');
    expect(board).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))');
    expect(board).toContain('width: 100%');
    expect(board).toContain('min-width: 0');
    expect(column).toContain('min-width: 0');
  });

  it('keeps the Board itself as the narrow-layout horizontal scroll owner', () => {
    const boardRules = declarationsFor('.kanban-board');

    expect(boardRules[0]).toContain('overflow-x: auto');
    expect(boardRules[0]).toContain('overscroll-behavior-inline: contain');
    expect(styles).toContain('@container kanban-workspace (max-width: 820px)');
    expect(boardRules.some((rule) => rule.includes('repeat(5, minmax(156px, 1fr))'))).toBe(true);
  });

  it('keeps global filter and composer grids more specific than the shared Board defaults', () => {
    expect(workspaceTaskStyles).toContain('.workspace-tasks-view .workspace-task-filter-bar {');
    expect(workspaceTaskStyles).toContain('.workspace-tasks-view .workspace-task-composer,');
    expect(workspaceTaskStyles).toContain('@container kanban-workspace (max-width: 1080px)');
    expect(workspaceTaskStyles).toContain('@container kanban-workspace (max-width: 680px)');
  });
});
