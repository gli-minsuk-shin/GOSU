import { expect, it } from 'vitest';
import { briefingTodoSnapshot } from '../src/main/briefing-todo-adapter';
it('shares only active projects and unfinished tasks, without descriptions or mutation', () => {
  const base = {
    id: 't',
    projectId: 'p',
    title: 'Read',
    status: 'planned' as const,
    version: 1,
    createdAt: 'x',
    updatedAt: 'x',
    description: 'Private long detail',
  };
  const data = {
    projects: [
      { id: 'p', name: 'Project' },
      { id: 'archived', name: 'Old', archivedAt: 'x' },
    ],
    tasks: [
      base,
      { ...base, id: 'done', status: 'done' as const },
      { ...base, id: 'old', projectId: 'archived' },
      { ...base, id: 'deleted', archivedAt: 'x' },
    ],
  };
  const result = briefingTodoSnapshot(data, '2026-09-11T00:00:00Z');
  expect(result.items).toEqual([
    { id: 't', title: 'Read', projectName: 'Project', status: 'planned' },
  ]);
  expect(data.tasks).toHaveLength(4);
  expect(result.limited).toBe(false);
});
