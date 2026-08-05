import type { ProjectChatSession } from '../../shared/project-chat-contracts';

const SESSION_KEY_SEPARATOR = '\u0000';

export function projectChatSessionKey(projectId: string, sessionId: string) {
  return `${projectId}${SESSION_KEY_SEPARATOR}${sessionId}`;
}

export function resolveProjectChatSessionId(
  sessions: readonly ProjectChatSession[],
  preferredSessionId: string | null | undefined,
) {
  if (preferredSessionId && sessions.some((session) => session.id === preferredSessionId)) {
    return preferredSessionId;
  }
  return sessions.find((session) => session.isDefault)?.id ?? sessions[0]?.id ?? null;
}

export function activeSessionIdsForProject(
  projectId: string,
  activeKeys: ReadonlySet<string>,
  sessions: readonly ProjectChatSession[],
) {
  return new Set(
    sessions
      .filter((session) => activeKeys.has(projectChatSessionKey(projectId, session.id)))
      .map((session) => session.id),
  );
}

export class VolatileProjectChatDrafts {
  private readonly drafts = new Map<string, string>();

  read(projectId: string, sessionId: string | null) {
    return this.drafts.get(projectChatSessionKey(projectId, sessionId ?? '')) ?? '';
  }

  write(projectId: string, sessionId: string | null, value: string) {
    const key = projectChatSessionKey(projectId, sessionId ?? '');
    if (value) this.drafts.set(key, value);
    else this.drafts.delete(key);
  }
}

const MAX_VOLATILE_CHAT_SCROLL_TOP = 10_000_000;

export class VolatileProjectChatScrollPositions {
  private readonly positions = new Map<string, number>();

  read(projectId: string, sessionId: string | null) {
    return this.positions.get(projectChatSessionKey(projectId, sessionId ?? '')) ?? null;
  }

  write(projectId: string, sessionId: string | null, scrollTop: number) {
    if (!Number.isFinite(scrollTop) || scrollTop < 0) return false;
    this.positions.set(
      projectChatSessionKey(projectId, sessionId ?? ''),
      Math.min(scrollTop, MAX_VOLATILE_CHAT_SCROLL_TOP),
    );
    return true;
  }
}
