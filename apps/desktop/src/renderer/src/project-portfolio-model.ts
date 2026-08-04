import type { ProjectRecord } from '../../shared/workspace-contracts';

export type PortfolioProjectRecord = ProjectRecord &
  Readonly<{
    archivedAt?: string | undefined;
  }>;

export function activeProjects(projects: readonly PortfolioProjectRecord[]) {
  return projects.filter(
    (project) => project.trashedAt === undefined && project.archivedAt === undefined,
  );
}

/** Kept as a compatibility name for callers that treat visible projects as active projects. */
export function visibleProjects(projects: readonly PortfolioProjectRecord[]) {
  return activeProjects(projects);
}

export function archivedProjects(projects: readonly PortfolioProjectRecord[]) {
  return projects.filter(
    (project) => project.trashedAt === undefined && project.archivedAt !== undefined,
  );
}

export function trashedProjects(projects: readonly PortfolioProjectRecord[]) {
  return projects.filter((project) => project.trashedAt !== undefined);
}

export function sidebarProjects(
  projects: readonly PortfolioProjectRecord[],
  hiddenProjectIds: ReadonlySet<string>,
) {
  return activeProjects(projects).filter((project) => !hiddenProjectIds.has(project.id));
}

export function resolveActiveProjectId(
  projects: readonly PortfolioProjectRecord[],
  currentProjectId: string,
  hiddenProjectIds: ReadonlySet<string> = new Set(),
) {
  const active = sidebarProjects(projects, hiddenProjectIds);
  return active.some((project) => project.id === currentProjectId)
    ? currentProjectId
    : (active[0]?.id ?? '');
}
