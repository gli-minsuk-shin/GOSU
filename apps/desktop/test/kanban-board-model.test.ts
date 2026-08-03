import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  EMPTY_KANBAN_FILTERS,
  activeKanbanFilterCount,
  canDropKanbanTask,
  filterKanbanTasks,
  kanbanColumnProgress,
  parseTaskLabels,
  projectTaskLabels,
  resolveKanbanColumns,
  taskDueState,
} from '../src/renderer/src/kanban-board-model';
import type { ProjectRecord, WorkspaceTask } from '../src/shared/workspace-contracts';

const projectId = randomUUID();
const now = '2026-08-04T00:00:00.000Z';

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: projectId,
    name: 'Kanban fixture',
    slug: 'kanban-fixture',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function task(overrides: Partial<WorkspaceTask> = {}): WorkspaceTask {
  return {
    id: randomUUID(),
    projectId,
    title: 'Reproduce baseline',
    status: 'backlog',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('Kanban board model', () => {
  it('resolves defaults for a legacy project and honors a custom order and WIP limit', () => {
    expect(resolveKanbanColumns(project()).map((column) => column.label)).toEqual([
      'Backlog',
      'Planned',
      'In Progress',
      'Review',
      'Done',
    ]);
    const customized = project({
      board: {
        title: 'Paper pipeline',
        columnLabels: {
          backlog: 'Ideas',
          planned: 'Queued',
          in_progress: 'Running',
          review: 'PI Review',
          done: 'Published',
        },
        columnOrder: ['backlog', 'planned', 'review', 'in_progress', 'done'],
        wipLimits: { backlog: null, planned: 4, in_progress: 2, review: 1, done: null },
      },
    });
    expect(resolveKanbanColumns(customized)).toEqual([
      { status: 'backlog', label: 'Ideas', wipLimit: null },
      { status: 'planned', label: 'Queued', wipLimit: 4 },
      { status: 'review', label: 'PI Review', wipLimit: 1 },
      { status: 'in_progress', label: 'Running', wipLimit: 2 },
      { status: 'done', label: 'Published', wipLimit: null },
    ]);
  });

  it('filters active cards by text, priority, label, and due modes', () => {
    const tasks = [
      task({
        description: 'Measure validation accuracy',
        priority: 'high',
        labels: ['Metric', 'Baseline'],
        dueDate: '2026-08-04',
      }),
      task({ title: 'Write appendix', status: 'review', dueDate: '2026-08-09' }),
      task({ title: 'Old run', archivedAt: now, labels: ['Metric'] }),
    ];
    expect(
      filterKanbanTasks(
        tasks,
        { ...EMPTY_KANBAN_FILTERS, query: 'VALIDATION', priority: 'high', label: 'metric' },
        '2026-08-04',
      ),
    ).toEqual([tasks[0]]);
    expect(
      filterKanbanTasks(tasks, { ...EMPTY_KANBAN_FILTERS, due: 'this_week' }, '2026-08-04'),
    ).toEqual([tasks[0], tasks[1]]);
    expect(
      filterKanbanTasks(tasks, { ...EMPTY_KANBAN_FILTERS, mode: 'archived' }, '2026-08-04'),
    ).toEqual([tasks[2]]);
  });

  it('derives filter metadata and due badges deterministically', () => {
    const tasks = [task({ labels: ['Metric', 'metric', 'Ablation'] })];
    expect(projectTaskLabels(tasks)).toEqual(['Ablation', 'Metric']);
    expect(parseTaskLabels(' Metric,metric, Ablation ,,')).toEqual(['Metric', 'Ablation']);
    expect(
      activeKanbanFilterCount({
        query: 'run',
        priority: 'urgent',
        label: 'Metric',
        due: 'overdue',
        mode: 'active',
      }),
    ).toBe(4);
    expect(taskDueState('2026-08-03', '2026-08-04')).toBe('overdue');
    expect(taskDueState('2026-08-04', '2026-08-04')).toBe('today');
    expect(taskDueState('2026-08-05', '2026-08-04')).toBe('upcoming');
  });

  it('computes WIP from every active card in the column, independent of filtered visibility', () => {
    const tasks = [
      task({ status: 'in_progress', title: 'Visible match' }),
      task({ status: 'in_progress', title: 'Hidden by a view filter' }),
      task({ status: 'in_progress', title: 'Archived', archivedAt: now }),
      task({ status: 'review', title: 'Different column' }),
    ];
    expect(kanbanColumnProgress(tasks, 'in_progress', 1)).toMatchObject({
      activeCount: 2,
      exceeded: true,
    });
    expect(kanbanColumnProgress(tasks, 'in_progress', 2)).toMatchObject({
      activeCount: 2,
      exceeded: false,
    });
  });

  it('accepts only active same-project card moves to a different canonical status', () => {
    const movable = task();
    const archived = task({ archivedAt: now });
    expect(
      canDropKanbanTask({
        projectId,
        taskId: movable.id,
        targetStatus: 'planned',
        tasks: [movable, archived],
      }),
    ).toEqual(movable);
    expect(
      canDropKanbanTask({
        projectId,
        taskId: movable.id,
        targetStatus: 'backlog',
        tasks: [movable],
      }),
    ).toBeNull();
    expect(
      canDropKanbanTask({
        projectId,
        taskId: archived.id,
        targetStatus: 'done',
        tasks: [archived],
      }),
    ).toBeNull();
    expect(
      canDropKanbanTask({
        projectId: randomUUID(),
        taskId: movable.id,
        targetStatus: 'done',
        tasks: [movable],
      }),
    ).toBeNull();
  });
});
