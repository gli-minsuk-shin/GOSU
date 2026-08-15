import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { BoardView, TaskTrash, TodoTaskList, TodoTaskRow } from '../src/renderer/src/board-view';
import { SettingsView } from '../src/renderer/src/settings-view';
import { DEFAULT_USER_PREFERENCES } from '../src/renderer/src/user-preferences';

describe('Board settings UI', () => {
  it('makes every project column directly discoverable as renameable', () => {
    const html = renderToStaticMarkup(
      <BoardView
        project={{
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Research project',
          slug: 'research-project',
          version: 1,
          createdAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-04T00:00:00.000Z',
        }}
        tasks={[]}
        busyAction={null}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onUpdateBoardSettings={vi.fn()}
        onSetTaskArchived={vi.fn()}
      />,
    );

    expect(html).toContain('Rename columns &amp; settings');
    expect(html).toContain('aria-label="Board task workspace"');
    expect(html).toContain('role="group" aria-label="Task layout"');
    expect(html).toContain('aria-pressed="true">Kanban</button>');
    expect(html).toContain('aria-pressed="false">To-do</button>');
    expect(html).toContain(
      'class="kanban-board" role="region" tabindex="0" aria-label="Board columns. Scroll horizontally when needed."',
    );
    expect(html).toContain('aria-label="Rename Backlog column"');
    expect(html.match(/class="column-rename-button"/g)).toHaveLength(5);
  });

  it('renders a compact To-do projection with workflow, metadata, completion, edit, and trash controls', () => {
    const project = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Research project',
      slug: 'research-project',
      version: 1,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    };
    const activeTask = {
      id: '22222222-2222-4222-8222-222222222222',
      projectId: project.id,
      title: 'Run tagged baseline',
      description: 'Reproduce the strongest reported score',
      status: 'in_progress' as const,
      priority: 'urgent' as const,
      dueDate: '2026-08-11',
      labels: ['baseline', 'experiment'],
      version: 3,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:10:00.000Z',
    };
    const doneTask = {
      ...activeTask,
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Read canonical paper',
      status: 'done' as const,
      priority: 'low' as const,
    };

    const html = renderToStaticMarkup(
      <TodoTaskList
        project={project}
        tasks={[activeTask, doneTask]}
        busy={false}
        editingTaskId={null}
        onEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="To-do list"');
    expect(html).toContain('changes also appear on Kanban');
    expect(html).toContain('Run tagged baseline');
    expect(html).toContain('In Progress');
    expect(html).toContain('urgent');
    expect(html).toContain('2026-08-11');
    expect(html).toContain('baseline');
    expect(html).toContain('aria-label="Mark Run tagged baseline done"');
    expect(html).toContain('aria-label="Reopen Read canonical paper in Backlog"');
    expect(html).toContain('aria-label="Edit Run tagged baseline"');
    expect(html).toContain('aria-label="Delete Run tagged baseline"');
  });

  it('sends the current task identity and optimistic version when completing or reopening', () => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    const activeTask = {
      id: '22222222-2222-4222-8222-222222222222',
      projectId: '11111111-1111-4111-8111-111111111111',
      title: 'Run baseline',
      status: 'in_progress' as const,
      version: 3,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:10:00.000Z',
    };
    const completedTask = {
      ...activeTask,
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Review results',
      status: 'done' as const,
      version: 7,
    };
    const sharedProps = {
      statusLabel: 'In Progress',
      reopenLabel: 'Planned',
      reopenStatus: 'planned' as const,
      busy: false,
      searchSelected: false,
      elementRef: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onUpdate,
    };
    const triggerCheckbox = (row: ReturnType<typeof TodoTaskRow>) => {
      const children = (row.props as { children: Array<{ props: { onChange: () => void } }> })
        .children;
      children[0]?.props.onChange();
    };

    triggerCheckbox(TodoTaskRow({ ...sharedProps, task: activeTask }));
    expect(onUpdate).toHaveBeenLastCalledWith({
      projectId: activeTask.projectId,
      taskId: activeTask.id,
      expectedVersion: 3,
      status: 'done',
    });

    triggerCheckbox(TodoTaskRow({ ...sharedProps, task: completedTask }));
    expect(onUpdate).toHaveBeenLastCalledWith({
      projectId: completedTask.projectId,
      taskId: completedTask.id,
      expectedVersion: 7,
      status: 'planned',
    });
  });

  it('exposes recoverable task deletion as Delete and Task trash', () => {
    const activeTask = {
      id: '22222222-2222-4222-8222-222222222222',
      projectId: '11111111-1111-4111-8111-111111111111',
      title: 'Run baseline',
      status: 'backlog' as const,
      version: 3,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:10:00.000Z',
    };
    const deletedTask = {
      ...activeTask,
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Discarded duplicate',
      version: 4,
      archivedAt: '2026-08-04T00:20:00.000Z',
    };
    const html = renderToStaticMarkup(
      <BoardView
        project={{
          id: activeTask.projectId,
          name: 'Research project',
          slug: 'research-project',
          version: 1,
          createdAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-04T00:00:00.000Z',
        }}
        tasks={[activeTask, deletedTask]}
        busyAction={null}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onUpdateBoardSettings={vi.fn()}
        onSetTaskArchived={vi.fn()}
      />,
    );

    expect(html).toContain('Task trash (1)');
    expect(html).toContain('class="task-delete-button"');
    expect(html).toContain('aria-label="Delete Run baseline"');
    expect(html).toContain('>Delete</button>');
    expect(html).not.toContain('>Archive</button>');

    const trashHtml = renderToStaticMarkup(
      <TaskTrash tasks={[deletedTask]} busy={false} onRestore={vi.fn()} />,
    );
    expect(trashHtml).toContain('aria-label="Task trash"');
    expect(trashHtml).toContain('<h3>Task trash</h3>');
    expect(trashHtml).toContain('Deleted ');
    expect(trashHtml).toContain('aria-label="Restore Discarded duplicate"');
  });

  it('disables task deletion and restore while another Board command is running', () => {
    const task = {
      id: '22222222-2222-4222-8222-222222222222',
      projectId: '11111111-1111-4111-8111-111111111111',
      title: 'Run baseline',
      status: 'backlog' as const,
      version: 3,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:10:00.000Z',
    };
    const boardHtml = renderToStaticMarkup(
      <BoardView
        project={{
          id: task.projectId,
          name: 'Research project',
          slug: 'research-project',
          version: 1,
          createdAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-04T00:00:00.000Z',
        }}
        tasks={[task]}
        busyAction="task:update:22222222-2222-4222-8222-222222222222"
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onUpdateBoardSettings={vi.fn()}
        onSetTaskArchived={vi.fn()}
      />,
    );
    expect(boardHtml).toContain(
      'class="task-delete-button" disabled="" aria-label="Delete Run baseline"',
    );

    const trashHtml = renderToStaticMarkup(
      <TaskTrash
        tasks={[{ ...task, archivedAt: '2026-08-04T00:20:00.000Z' }]}
        busy
        onRestore={vi.fn()}
      />,
    );
    expect(trashHtml).toContain('disabled="" aria-label="Restore Run baseline"');
  });

  it('shows a persisted new-project Board template editor in Settings', () => {
    const html = renderToStaticMarkup(
      <SettingsView
        preferences={DEFAULT_USER_PREFERENCES}
        onChange={vi.fn()}
        workspaceSnapshot={null}
        busyAction={null}
        chatBusyProjectIds={new Set()}
        onRenameProject={vi.fn()}
        onSetProjectArchived={vi.fn()}
        onTrashProject={vi.fn()}
        onRestoreProject={vi.fn()}
        onEmptyProjectTrash={vi.fn()}
        lectureTrashSnapshot={{ schemaVersion: 1, studios: [] }}
        lectureTrashState="ready"
        onRetryLectureTrash={vi.fn()}
        onRestoreLectureStudio={vi.fn()}
        onEmptyLectureStudioTrash={vi.fn()}
        onRestoreTask={vi.fn()}
        overleafPersonalTokenState="not_configured"
        onRefreshOverleafPersonalToken={vi.fn()}
        onSaveOverleafPersonalToken={vi.fn()}
        onRemoveOverleafPersonalToken={vi.fn()}
        models={[]}
        modelsLoading={false}
        onRefreshModels={vi.fn()}
        agentProject={undefined}
        agentProfile={undefined}
        agentProfileLoading={false}
        vault={null}
        vaultState="ready"
        onUpdateAgentProfile={vi.fn()}
        initialCategory="board"
      />,
    );

    expect(html).toContain('DEFAULT BOARD TEMPLATE');
    expect(html).toContain('Save default template');
    expect(html).toContain('Canonical: backlog');
    expect(html).toContain('Backlog → Planned → In Progress → Review → Done');
    expect(html).toContain('existing project Boards stay unchanged');
  });
});
