import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORKSPACE_BOARD_SETTINGS,
  type ProjectRecord,
  type WorkspaceTask,
  type WorkspaceTaskStatus,
} from '../src/shared/workspace-contracts';
import {
  EMPTY_WORKSPACE_GLOBAL_BOARD_FILTERS,
  WORKSPACE_GLOBAL_BOARD_COLUMNS,
  WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP,
  WORKSPACE_GLOBAL_BOARD_SHOW_MORE_STEP,
  activeWorkspaceGlobalProjects,
  buildWorkspaceGlobalBoardColumns,
  filterWorkspaceGlobalBoardTasks,
  joinWorkspaceGlobalBoardTasks,
  nextWorkspaceGlobalBoardGroupLimit,
  resolveWorkspaceGlobalInitialStatus,
  resolveWorkspaceGlobalReopenStatus,
  resolveWorkspaceGlobalStatusLabel,
  sliceWorkspaceGlobalBoardGroup,
  workspaceGlobalProjectWipInfo,
} from '../src/renderer/src/workspace-global-board-model';

const FIRST_PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const ARCHIVED_PROJECT_ID = '00000000-0000-4000-8000-000000000003';
const TRASHED_PROJECT_ID = '00000000-0000-4000-8000-000000000004';

function project(id: string, name: string, overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id,
    name,
    slug: name.toLocaleLowerCase().replaceAll(' ', '-'),
    board: DEFAULT_WORKSPACE_BOARD_SETTINGS,
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function task(
  sequence: number,
  projectId: string,
  status: WorkspaceTaskStatus = 'backlog',
  overrides: Partial<WorkspaceTask> = {},
): WorkspaceTask {
  const suffix = String(sequence).padStart(12, '0');
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    projectId,
    title: `Task ${sequence}`,
    status,
    version: 1,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('workspace global Board model', () => {
  it('joins every active project, including locally hidden projects, and excludes lifecycle-inactive owners', () => {
    const first = project(FIRST_PROJECT_ID, 'First project', {
      createdAt: '2026-08-01T00:00:02.000Z',
      board: {
        ...DEFAULT_WORKSPACE_BOARD_SETTINGS,
        columnLabels: { ...DEFAULT_WORKSPACE_BOARD_SETTINGS.columnLabels, planned: 'Queued' },
      },
    });
    const second = project(SECOND_PROJECT_ID, 'Locally hidden project', {
      createdAt: '2026-08-01T00:00:01.000Z',
    });
    const archived = project(ARCHIVED_PROJECT_ID, 'Archived project', {
      archivedAt: '2026-08-03T00:00:00.000Z',
    });
    const trashed = project(TRASHED_PROJECT_ID, 'Trashed project', {
      trashedAt: '2026-08-03T00:00:00.000Z',
    });
    const projects = [first, archived, second, trashed];
    const tasks = [
      task(9, first.id, 'planned'),
      task(2, second.id),
      task(3, archived.id),
      task(4, trashed.id),
      task(5, '00000000-0000-4000-8000-999999999999'),
      task(1, first.id, 'done', { archivedAt: '2026-08-04T00:00:00.000Z' }),
    ];

    expect(activeWorkspaceGlobalProjects(projects).map(({ id }) => id)).toEqual([
      second.id,
      first.id,
    ]);
    const joined = joinWorkspaceGlobalBoardTasks(projects, tasks);
    expect(joined.map(({ task: joinedTask }) => joinedTask.id)).toEqual([
      task(9, first.id).id,
      task(2, second.id).id,
      task(1, first.id).id,
    ]);
    expect(joined[0]).toMatchObject({ project: { id: first.id }, statusLabel: 'Queued' });
    expect(joined.at(-1)?.task.archivedAt).toBeTypeOf('string');
  });

  it('sorts joined Tasks by most recently changed and then ID so mutations stay visible', () => {
    const owner = project(FIRST_PROJECT_ID, 'Owner');
    const joined = joinWorkspaceGlobalBoardTasks(
      [owner],
      [
        task(3, owner.id, 'backlog', { updatedAt: '2026-08-02T00:00:01.000Z' }),
        task(2, owner.id, 'backlog', { updatedAt: '2026-08-02T00:00:02.000Z' }),
        task(1, owner.id, 'backlog', { updatedAt: '2026-08-02T00:00:02.000Z' }),
      ],
    );

    expect(joined.map(({ task: joinedTask }) => joinedTask.id)).toEqual([
      task(2, owner.id).id,
      task(1, owner.id).id,
      task(3, owner.id).id,
    ]);
  });

  it('combines the all-project selector with the existing active, metadata, and Task-trash filters', () => {
    const first = project(FIRST_PROJECT_ID, 'First project');
    const second = project(SECOND_PROJECT_ID, 'Second project');
    const joined = joinWorkspaceGlobalBoardTasks(
      [first, second],
      [
        task(1, first.id, 'planned', {
          title: 'GPU baseline',
          priority: 'high',
          dueDate: '2026-08-18',
          labels: ['Repro'],
        }),
        task(2, second.id, 'planned', { title: 'CPU baseline', priority: 'low' }),
        task(3, first.id, 'done', {
          title: 'Archived GPU baseline',
          archivedAt: '2026-08-17T00:00:00.000Z',
        }),
      ],
    );

    expect(
      filterWorkspaceGlobalBoardTasks(
        joined,
        {
          ...EMPTY_WORKSPACE_GLOBAL_BOARD_FILTERS,
          projectId: first.id,
          query: 'gpu',
          priority: 'high',
          label: 'repro',
          due: 'today',
        },
        '2026-08-18',
      ).map(({ task: filteredTask }) => filteredTask.id),
    ).toEqual([task(1, first.id).id]);
    expect(
      filterWorkspaceGlobalBoardTasks(joined, {
        ...EMPTY_WORKSPACE_GLOBAL_BOARD_FILTERS,
        projectId: first.id,
        query: 'archived',
        mode: 'archived',
      }).map(({ task: filteredTask }) => filteredTask.id),
    ).toEqual([task(3, first.id).id]);
    expect(
      filterWorkspaceGlobalBoardTasks(joined, {
        ...EMPTY_WORKSPACE_GLOBAL_BOARD_FILTERS,
        projectId: '00000000-0000-4000-8000-999999999999',
      }),
    ).toEqual([]);
  });

  it('keeps five canonical columns and independently bounds every status group', () => {
    const owner = project(FIRST_PROJECT_ID, 'Owner');
    const backlogTasks = Array.from(
      { length: WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP + 2 },
      (_, index) => task(index + 1, owner.id),
    );
    const joined = joinWorkspaceGlobalBoardTasks(
      [owner],
      [...backlogTasks, task(100, owner.id, 'review')],
    );

    const columns = buildWorkspaceGlobalBoardColumns(joined);
    expect(columns.map(({ status, label }) => ({ status, label }))).toEqual(
      WORKSPACE_GLOBAL_BOARD_COLUMNS,
    );
    expect(columns[0]).toMatchObject({
      status: 'backlog',
      totalCount: WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP + 2,
      visibleCount: WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP,
      remainingCount: 2,
      hasMore: true,
      nextVisibleLimit: WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP + 2,
    });
    expect(columns.find(({ status }) => status === 'review')).toMatchObject({
      totalCount: 1,
      visibleCount: 1,
      hasMore: false,
    });

    const expanded = buildWorkspaceGlobalBoardColumns(joined, {
      backlog: columns[0]!.nextVisibleLimit,
    });
    expect(expanded[0]).toMatchObject({
      visibleCount: WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP + 2,
      remainingCount: 0,
      hasMore: false,
    });
  });

  it('advances show-more windows in bounded steps and normalizes invalid limits', () => {
    const items = Array.from(
      { length: WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP * 3 },
      (_, index) => index,
    );
    const first = sliceWorkspaceGlobalBoardGroup(items);
    expect(first).toMatchObject({
      visibleCount: WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP,
      nextVisibleLimit:
        WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP + WORKSPACE_GLOBAL_BOARD_SHOW_MORE_STEP,
    });
    expect(nextWorkspaceGlobalBoardGroupLimit(first.nextVisibleLimit, first.totalCount)).toBe(
      items.length,
    );
    expect(sliceWorkspaceGlobalBoardGroup(items, Number.POSITIVE_INFINITY).visibleCount).toBe(
      WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP,
    );
    expect(nextWorkspaceGlobalBoardGroupLimit(-1, 0)).toBe(0);
  });

  it('resolves initial, reopen, and display status from the owning Project Board', () => {
    const owner = project(FIRST_PROJECT_ID, 'Custom workflow', {
      board: {
        ...DEFAULT_WORKSPACE_BOARD_SETTINGS,
        columnLabels: {
          backlog: 'Ideas',
          planned: 'Queued',
          in_progress: 'Running',
          review: 'Validate',
          done: 'Published',
        },
        columnOrder: ['done', 'review', 'planned', 'backlog', 'in_progress'],
      },
    });

    expect(resolveWorkspaceGlobalInitialStatus(owner)).toBe('done');
    expect(resolveWorkspaceGlobalReopenStatus(owner)).toBe('review');
    expect(resolveWorkspaceGlobalStatusLabel(owner, 'planned')).toBe('Queued');
  });

  it('computes WIP from the owning Project full active Task set, independent of other projects and Trash', () => {
    const first = project(FIRST_PROJECT_ID, 'First project', {
      board: {
        ...DEFAULT_WORKSPACE_BOARD_SETTINGS,
        columnLabels: { ...DEFAULT_WORKSPACE_BOARD_SETTINGS.columnLabels, review: 'Validate' },
        wipLimits: { ...DEFAULT_WORKSPACE_BOARD_SETTINGS.wipLimits, review: 1 },
      },
    });
    const second = project(SECOND_PROJECT_ID, 'Second project');
    const tasks = [
      task(1, first.id, 'review'),
      task(2, first.id, 'review'),
      task(3, first.id, 'review', { archivedAt: '2026-08-17T00:00:00.000Z' }),
      task(4, second.id, 'review'),
    ];

    expect(workspaceGlobalProjectWipInfo(first, tasks, 'review')).toEqual({
      projectId: first.id,
      status: 'review',
      statusLabel: 'Validate',
      activeCount: 2,
      wipLimit: 1,
      exceeded: true,
    });
    expect(workspaceGlobalProjectWipInfo(second, tasks, 'review')).toMatchObject({
      activeCount: 1,
      wipLimit: null,
      exceeded: false,
    });
  });
});
