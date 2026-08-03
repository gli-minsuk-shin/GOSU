export type ProjectChatLoadToken = Readonly<{
  projectId: string;
  requestSequence: number;
  eventSequence: number;
}>;

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
