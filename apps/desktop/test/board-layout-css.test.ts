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

  it('keeps a task to one 34px line and a resting board free of buttons', () => {
    const row = declarationsFor('.todo-task-row')[0] ?? '';
    expect(row).toContain('min-height: 34px');
    expect(row).toContain('align-items: center');
    expect(
      declarationsFor('.todo-task-title').some((rule) => rule.includes('white-space: nowrap')),
    ).toBe(true);
    // Actions are hidden at rest and come back with the pointer or with keyboard focus.
    expect(styles).toMatch(/\.todo-task-actions,\s*\.task-actions\s*\{[^}]*opacity: 0/u);
    for (const selector of [
      '.todo-task-row:hover .todo-task-actions',
      '.todo-task-row:focus-within .todo-task-actions',
      '.task-card:hover .task-actions',
      '.task-card:focus-within .task-actions',
    ])
      expect(styles).toContain(selector);
    // A column no longer reserves 350px when it holds one card.
    expect(declarationsFor('.kanban-column')[0]).toContain('min-height: 160px');
    expect(declarationsFor('.task-card h3')[0]).toContain('-webkit-line-clamp: 2');
  });

  it('keeps filter and quick-add labels for assistive technology while showing one row of controls', () => {
    expect(styles).toMatch(
      /\.board-filter-bar \.field-label,\s*\.task-composer > label > \.field-label\s*\{[^}]*clip-path: inset\(50%\)/u,
    );
    expect(styles).not.toContain('.board-help');
    expect(styles).not.toContain('.todo-list-summary');
  });

  it('keeps global filter and composer grids more specific than the shared Board defaults', () => {
    expect(workspaceTaskStyles).toContain('.workspace-tasks-view .workspace-task-filter-bar {');
    expect(workspaceTaskStyles).toContain('.workspace-tasks-view .workspace-task-composer,');
    // Compact controls stay on one row far below the former 1080px break.
    expect(workspaceTaskStyles).toContain('@container kanban-workspace (max-width: 760px)');
    expect(workspaceTaskStyles).not.toContain('(max-width: 1080px)');
    expect(workspaceTaskStyles).toContain('@container kanban-workspace (max-width: 680px)');
  });
});
