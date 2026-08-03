import type { ProjectRecord } from '../../shared/workspace-contracts';

export function visibleProjects(projects: readonly ProjectRecord[]) {
  return projects.filter((project) => project.trashedAt === undefined);
}

export function trashedProjects(projects: readonly ProjectRecord[]) {
  return projects.filter((project) => project.trashedAt !== undefined);
}

export function resolveActiveProjectId(
  projects: readonly ProjectRecord[],
  currentProjectId: string,
) {
  const active = visibleProjects(projects);
  return active.some((project) => project.id === currentProjectId)
    ? currentProjectId
    : (active[0]?.id ?? '');
}
