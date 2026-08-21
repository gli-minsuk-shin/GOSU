import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
  'utf8',
);

describe('DesktopApp workspace Tasks integration', () => {
  it('renders the global projection through the existing project-scoped task commands', () => {
    expect(source).toContain("activeTab === 'tasks'");
    expect(source).toContain('<WorkspaceTasksView');
    expect(source).toContain('window.gosu.workspace.createTask(input)');
    expect(source).toContain('window.gosu.workspace.updateTask(input)');
    expect(source).toContain('window.gosu.workspace.setTaskArchived(input)');
  });

  it('unhides and expands a project before opening its Board from a global task badge', () => {
    const helper = source.match(
      /const openProjectBoardFromWorkspaceTasks = \(projectId: string\) => \{(?<body>[\s\S]*?)\n {2}\};/u,
    )?.groups?.body;

    expect(helper).toBeDefined();
    expect(helper).toContain('showProjectLocally(projectNavigationRef.current, projectId)');
    expect(helper).toContain('expandedProjectIds');
    expect(helper).toContain("selectProjectTab(projectId, 'board')");
    expect(source).toContain('onOpenProjectBoard={openProjectBoardFromWorkspaceTasks}');
  });

  it('does not report a committed task mutation as failed when only snapshot refresh fails', () => {
    const helper = source.match(
      /const runWorkspaceAction = async \((?<signature>[\s\S]*?)\n {2}\};/u,
    )?.[0];

    expect(helper).toBeDefined();
    expect(helper).toContain('await action()');
    expect(helper).toContain('try {\n        await loadWorkspace();');
    expect(helper).toContain('The change was saved locally, but this view could not refresh.');
    expect(helper).toContain('return true');
  });
});
