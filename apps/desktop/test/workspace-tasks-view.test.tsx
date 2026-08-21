import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  WorkspaceTaskComposer,
  WorkspaceTaskTrash,
  WorkspaceTasksView,
  workspaceGlobalProjectLabels,
  workspaceGlobalTaskArchiveInput,
  workspaceGlobalTaskCompletionUpdate,
  workspaceGlobalTaskCreateInput,
  workspaceGlobalTaskStatusUpdate,
} from '../src/renderer/src/workspace-tasks-view';
import {
  joinWorkspaceGlobalBoardTasks,
  resolveWorkspaceGlobalInitialStatus,
} from '../src/renderer/src/workspace-global-board-model';
import type { ProjectRecord, WorkspaceTask } from '../src/shared/workspace-contracts';

const NOW = '2026-08-18T00:00:00.000Z';

const alpha: ProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Alpha Project',
  slug: 'alpha-project',
  board: {
    title: 'Alpha workflow',
    columnLabels: {
      backlog: 'Ideas',
      planned: 'Queued',
      in_progress: 'Running',
      review: 'PI Review',
      done: 'Published',
    },
    columnOrder: ['planned', 'backlog', 'in_progress', 'review', 'done'],
    wipLimits: {
      backlog: null,
      planned: 3,
      in_progress: 2,
      review: 1,
      done: null,
    },
  },
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

const beta: ProjectRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Beta Project',
  slug: 'beta-project',
  version: 1,
  createdAt: '2026-08-18T00:00:01.000Z',
  updatedAt: '2026-08-18T00:00:01.000Z',
};

const archivedProject: ProjectRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Archived Project',
  slug: 'archived-project',
  archivedAt: '2026-08-18T00:05:00.000Z',
  version: 2,
  createdAt: '2026-08-18T00:00:02.000Z',
  updatedAt: '2026-08-18T00:05:00.000Z',
};

function task(project: ProjectRecord, overrides: Partial<WorkspaceTask> = {}): WorkspaceTask {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    projectId: project.id,
    title: 'Shared task title',
    status: 'in_progress',
    version: 3,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const callbacks = () => ({
  onCreateTask: vi.fn().mockResolvedValue(true),
  onUpdateTask: vi.fn().mockResolvedValue(true),
  onSetTaskArchived: vi.fn().mockResolvedValue(true),
});

describe('workspace all-project Tasks view', () => {
  it('shows canonical Kanban columns and project-aware duplicate cards for every active project', () => {
    const html = renderToStaticMarkup(
      <WorkspaceTasksView
        projects={[alpha, beta, archivedProject]}
        tasks={[
          task(alpha),
          task(beta, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
          task(archivedProject, {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            title: 'Archived project task must stay hidden',
          }),
        ]}
        busyAction={null}
        {...callbacks()}
      />,
    );

    expect(html).toContain('aria-label="All-project task workspace"');
    expect(html).toContain('<h2>All project tasks</h2>');
    expect(html).toContain('2 active tasks across 2 active projects');
    expect(html).toContain('aria-label="Filter tasks across projects"');
    expect(html).toContain('All active projects');
    expect(html).toContain('Alpha Project');
    expect(html).toContain('Beta Project');
    expect(html).not.toContain('Archived Project');
    expect(html).not.toContain('Archived project task must stay hidden');
    expect(html).toContain('id="workspace-task-column-backlog"');
    expect(html).toContain('id="workspace-task-column-planned"');
    expect(html).toContain('id="workspace-task-column-in_progress"');
    expect(html).toContain('id="workspace-task-column-review"');
    expect(html).toContain('id="workspace-task-column-done"');
    expect(html).toContain('Running');
    expect(html).toContain('aria-label="Shared task title in Alpha Project"');
    expect(html).toContain('aria-label="Shared task title in Beta Project"');
    expect(html).toContain('aria-label="Edit Shared task title in Alpha Project"');
    expect(html).toContain('aria-label="Delete Shared task title in Beta Project"');
    expect(html.match(/>Shared task title<\/h3>/gu)).toHaveLength(2);
  });

  it('requires a real project and uses the selected project custom first stage in the composer', () => {
    const allProjectsHtml = renderToStaticMarkup(
      <WorkspaceTaskComposer
        projects={[alpha, beta]}
        scopedProjectId={null}
        busyAction={null}
        onCreate={vi.fn()}
      />,
    );
    expect(allProjectsHtml).toContain('<option value="" selected="">Choose a project</option>');
    expect(allProjectsHtml).toContain('<select required=""');
    expect(allProjectsHtml).toContain('disabled="">Add task</button>');
    expect(allProjectsHtml).toContain('Global tasks never become unassigned');

    const selectedProjectHtml = renderToStaticMarkup(
      <WorkspaceTaskComposer
        projects={[alpha, beta]}
        scopedProjectId={alpha.id}
        busyAction={null}
        onCreate={vi.fn()}
      />,
    );
    expect(resolveWorkspaceGlobalInitialStatus(alpha)).toBe('planned');
    expect(selectedProjectHtml).toContain(`<option value="${alpha.id}" selected="">Alpha Project`);
    expect(selectedProjectHtml).toContain('<option value="planned" selected="">Queued</option>');
    expect(selectedProjectHtml.indexOf('Queued')).toBeLessThan(
      selectedProjectHtml.indexOf('Ideas'),
    );

    expect(
      workspaceGlobalTaskCreateInput({
        projectId: alpha.id,
        title: '  Run the selected baseline  ',
        status: resolveWorkspaceGlobalInitialStatus(alpha),
        description: '  Acceptance criteria  ',
        priority: 'high',
        dueDate: '2026-08-22',
        labels: 'Baseline, baseline, paper',
      }),
    ).toEqual({
      projectId: alpha.id,
      title: 'Run the selected baseline',
      status: 'planned',
      description: 'Acceptance criteria',
      priority: 'high',
      dueDate: '2026-08-22',
      labels: ['Baseline', 'paper'],
    });
  });

  it('adds the stable slug anywhere duplicate project names would otherwise be ambiguous', () => {
    const duplicateAlpha: ProjectRecord = {
      ...beta,
      name: 'Alpha Project',
      slug: 'alpha-project-replication',
    };
    const labels = workspaceGlobalProjectLabels([alpha, duplicateAlpha]);
    expect(labels.get(alpha.id)).toBe('Alpha Project · alpha-project');
    expect(labels.get(duplicateAlpha.id)).toBe('Alpha Project · alpha-project-replication');
    expect(workspaceGlobalProjectLabels([alpha, alpha]).get(alpha.id)).toBe('Alpha Project');

    const html = renderToStaticMarkup(
      <WorkspaceTasksView
        projects={[alpha, duplicateAlpha]}
        tasks={[task(alpha), task(duplicateAlpha, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })]}
        busyAction={null}
        onOpenProjectBoard={vi.fn()}
        {...callbacks()}
      />,
    );

    expect(html).toContain('Alpha Project · alpha-project');
    expect(html).toContain('Alpha Project · alpha-project-replication');
    expect(html).toContain('aria-label="Shared task title in Alpha Project · alpha-project"');
    expect(html).toContain(
      'aria-label="Edit Shared task title in Alpha Project · alpha-project-replication"',
    );
    expect(html).toContain('aria-label="Open Alpha Project · alpha-project Board"');
  });

  it('keeps update, completion, deletion, and restore commands bound to task ownership and version', () => {
    const active = joinWorkspaceGlobalBoardTasks([alpha], [task(alpha)])[0]!;
    const completed = joinWorkspaceGlobalBoardTasks(
      [alpha],
      [task(alpha, { status: 'done', version: 7 })],
    )[0]!;

    expect(workspaceGlobalTaskStatusUpdate(active, 'review')).toEqual({
      projectId: alpha.id,
      taskId: active.task.id,
      expectedVersion: 3,
      status: 'review',
    });
    expect(workspaceGlobalTaskCompletionUpdate(active)).toEqual({
      projectId: alpha.id,
      taskId: active.task.id,
      expectedVersion: 3,
      status: 'done',
    });
    expect(workspaceGlobalTaskCompletionUpdate(completed)).toEqual({
      projectId: alpha.id,
      taskId: completed.task.id,
      expectedVersion: 7,
      status: 'planned',
    });
    expect(workspaceGlobalTaskArchiveInput(active, true)).toEqual({
      projectId: alpha.id,
      taskId: active.task.id,
      expectedVersion: 3,
      archived: true,
    });
    expect(workspaceGlobalTaskArchiveInput(completed, false)).toEqual({
      projectId: alpha.id,
      taskId: completed.task.id,
      expectedVersion: 7,
      archived: false,
    });
  });

  it('uses the owning project reopen label and accessible project context in To-do mode', () => {
    const html = renderToStaticMarkup(
      <WorkspaceTasksView
        projects={[alpha, beta]}
        tasks={[
          task(alpha, { status: 'done', version: 7 }),
          task(beta, {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            status: 'done',
            version: 2,
          }),
        ]}
        busyAction={null}
        initialViewMode="todo"
        {...callbacks()}
      />,
    );

    expect(html).toContain('aria-label="All-project To-do list"');
    expect(html).toContain('aria-label="Reopen Shared task title in Alpha Project in Queued"');
    expect(html).toContain('aria-label="Reopen Shared task title in Beta Project in Backlog"');
    expect(html).toContain('Alpha Project');
    expect(html).toContain('Beta Project');
  });

  it('bounds each group to forty tasks and exposes an accessible Show more control', () => {
    const manyTasks = Array.from({ length: 41 }, (_, index) =>
      task(alpha, {
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
        title: `Bounded task ${String(index + 1).padStart(2, '0')}`,
        status: 'backlog',
        createdAt: `2026-08-18T00:${String(index).padStart(2, '0')}:00.000Z`,
      }),
    );
    const html = renderToStaticMarkup(
      <WorkspaceTasksView
        projects={[alpha]}
        tasks={manyTasks}
        busyAction={null}
        {...callbacks()}
      />,
    );

    expect(html).toContain('Bounded task 41');
    expect(html).toContain('Bounded task 02');
    expect(html).not.toContain('Bounded task 01');
    expect(html).toContain('Show 1 more');
    expect(html).toContain('of 1 remaining tasks');
  });

  it('shows aggregate Task trash with project badges and project-scoped restore labels', () => {
    const deleted = joinWorkspaceGlobalBoardTasks(
      [alpha, beta],
      [
        task(alpha, { archivedAt: '2026-08-18T01:00:00.000Z' }),
        task(beta, {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          archivedAt: '2026-08-18T01:01:00.000Z',
        }),
      ],
    );
    const html = renderToStaticMarkup(
      <WorkspaceTaskTrash
        items={deleted}
        busy={false}
        visibleLimit={undefined}
        onShowMore={vi.fn()}
        onRestore={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(html).toContain('aria-label="All-project Task trash"');
    expect(html).toContain('Task trash across projects');
    expect(html).toContain('Alpha Project');
    expect(html).toContain('Beta Project');
    expect(html).toContain('aria-label="Restore Shared task title in Alpha Project"');
    expect(html).toContain('aria-label="Restore Shared task title in Beta Project"');
  });
});
