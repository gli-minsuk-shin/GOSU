export type SshWorkspaceLoadToken = Readonly<{ projectId: string; generation: number }>;

/** Never render a previous project's grant while the next project is still loading. */
export function sshWorkspacesForProject<T extends { grant: { projectId: string } }>(
  workspaces: readonly T[],
  projectId: string | null,
) {
  return projectId ? workspaces.filter((workspace) => workspace.grant.projectId === projectId) : [];
}

/** Prevent a late project-A response from replacing the visible project-B grant list. */
export class SshWorkspaceLoadGuard {
  private projectId: string | null = null;
  private generation = 0;

  activate(projectId: string | null) {
    if (this.projectId === projectId) return;
    this.projectId = projectId;
    this.generation += 1;
  }

  begin(projectId: string): SshWorkspaceLoadToken | null {
    if (this.projectId !== projectId) return null;
    this.generation += 1;
    return { projectId, generation: this.generation };
  }

  accepts(token: SshWorkspaceLoadToken | null) {
    return (
      token !== null && token.projectId === this.projectId && token.generation === this.generation
    );
  }
}
