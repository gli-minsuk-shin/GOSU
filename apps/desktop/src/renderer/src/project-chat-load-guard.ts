import type { ProjectChatSnapshot } from '../../shared/project-chat-contracts';

export type ProjectChatLoadToken = Readonly<{
  projectId: string;
  requestSequence: number;
  eventSequence: number;
}>;

export function shouldHydrateProjectChat(activeTab: string, activeProjectId: string) {
  return activeProjectId.length > 0 && (activeTab === 'chat' || activeTab === 'notes');
}

export function markProjectChatLoading(current: ReadonlySet<string>, projectId: string) {
  if (current.has(projectId)) return current;
  const next = new Set(current);
  next.add(projectId);
  return next;
}

export function clearProjectChatLoading(current: ReadonlySet<string>, projectId: string) {
  if (!current.has(projectId)) return current;
  const next = new Set(current);
  next.delete(projectId);
  return next;
}

export function mergeProjectChatSnapshot(
  current: ProjectChatSnapshot | undefined,
  incoming: ProjectChatSnapshot,
): ProjectChatSnapshot {
  if (
    current?.profile &&
    current.profile.version > (incoming.profile?.version ?? Number.NEGATIVE_INFINITY)
  ) {
    return { ...incoming, profile: current.profile };
  }
  return incoming;
}

/** Prevents an older snapshot response from overwriting a newer renderer event or response. */
export class ProjectChatLoadGuard {
  private readonly requestSequences = new Map<string, number>();
  private readonly eventSequences = new Map<string, number>();

  begin(projectId: string): ProjectChatLoadToken {
    const requestSequence = (this.requestSequences.get(projectId) ?? 0) + 1;
    this.requestSequences.set(projectId, requestSequence);
    return {
      projectId,
      requestSequence,
      eventSequence: this.eventSequences.get(projectId) ?? 0,
    };
  }

  observeEvent(projectId: string) {
    this.invalidateProject(projectId);
  }

  invalidateProject(projectId: string) {
    this.eventSequences.set(projectId, (this.eventSequences.get(projectId) ?? 0) + 1);
  }

  canApply(token: ProjectChatLoadToken) {
    return (
      this.requestSequences.get(token.projectId) === token.requestSequence &&
      (this.eventSequences.get(token.projectId) ?? 0) === token.eventSequence
    );
  }

  isLatestRequest(token: ProjectChatLoadToken) {
    return this.requestSequences.get(token.projectId) === token.requestSequence;
  }
}
