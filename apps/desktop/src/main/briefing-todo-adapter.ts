import type { WorkspaceTask } from '../shared/workspace-contracts';
export function briefingTodoSnapshot(
  data: {
    projects: readonly {
      id: string;
      name: string;
      trashedAt?: string | undefined;
      archivedAt?: string | undefined;
    }[];
    tasks: readonly WorkspaceTask[];
  },
  now = new Date().toISOString(),
) {
  const projects = new Map(
    data.projects.filter((p) => !p.trashedAt && !p.archivedAt).map((p) => [p.id, p.name]),
  );
  const tasks = data.tasks
    .filter(
      (t) =>
        !t.archivedAt && t.status !== 'done' && (t.projectId === null || projects.has(t.projectId)),
    )
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  return {
    items: tasks.slice(0, 200).map((t) => ({
      id: t.id,
      title: t.title.slice(0, 1000),
      projectName: t.projectId === null ? '개인 할 일' : projects.get(t.projectId)!.slice(0, 300),
      status: t.status,
      ...(t.priority ? { priority: t.priority } : {}),
      ...(t.dueDate ? { dueDate: t.dueDate } : {}),
    })),
    limited: tasks.length > 200,
    fetchedAt: now,
  };
}
