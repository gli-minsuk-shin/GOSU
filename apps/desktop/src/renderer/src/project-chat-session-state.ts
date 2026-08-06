import type { ProjectChatMessage, ProjectChatSession } from '../../shared/project-chat-contracts';

const SESSION_KEY_SEPARATOR = '\u0000';

type LayoutStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const PROJECT_CHAT_LAYOUT_STORAGE_KEY = 'gosu:project-chat-layout:v1';
export const PROJECT_CHAT_SESSION_RAIL_MIN_WIDTH = 160;
export const PROJECT_CHAT_SESSION_RAIL_MAX_WIDTH = 360;
export const PROJECT_CHAT_SESSION_RAIL_DEFAULT_WIDTH = 184;

export type ProjectChatLayoutState = Readonly<{
  schemaVersion: 1;
  sessionRailWidth: number;
  sessionRailCollapsed: boolean;
  chatDetailsCollapsed: boolean;
}>;

export const DEFAULT_PROJECT_CHAT_LAYOUT_STATE: ProjectChatLayoutState = Object.freeze({
  schemaVersion: 1,
  sessionRailWidth: PROJECT_CHAT_SESSION_RAIL_DEFAULT_WIDTH,
  sessionRailCollapsed: false,
  chatDetailsCollapsed: false,
});

export function clampProjectChatSessionRailWidth(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return PROJECT_CHAT_SESSION_RAIL_DEFAULT_WIDTH;
  }
  return Math.round(
    Math.min(
      PROJECT_CHAT_SESSION_RAIL_MAX_WIDTH,
      Math.max(PROJECT_CHAT_SESSION_RAIL_MIN_WIDTH, value),
    ),
  );
}

export function parseProjectChatLayoutState(value: unknown): ProjectChatLayoutState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_PROJECT_CHAT_LAYOUT_STATE;
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) return DEFAULT_PROJECT_CHAT_LAYOUT_STATE;
  return {
    schemaVersion: 1,
    sessionRailWidth: clampProjectChatSessionRailWidth(record.sessionRailWidth),
    sessionRailCollapsed: record.sessionRailCollapsed === true,
    chatDetailsCollapsed: record.chatDetailsCollapsed === true,
  };
}

export function loadProjectChatLayoutState(storage: LayoutStorage): ProjectChatLayoutState {
  try {
    const serialized = storage.getItem(PROJECT_CHAT_LAYOUT_STORAGE_KEY);
    return serialized
      ? parseProjectChatLayoutState(JSON.parse(serialized) as unknown)
      : DEFAULT_PROJECT_CHAT_LAYOUT_STATE;
  } catch {
    return DEFAULT_PROJECT_CHAT_LAYOUT_STATE;
  }
}

export function saveProjectChatLayoutState(storage: LayoutStorage, state: ProjectChatLayoutState) {
  try {
    storage.setItem(
      PROJECT_CHAT_LAYOUT_STORAGE_KEY,
      JSON.stringify(parseProjectChatLayoutState(state)),
    );
    return true;
  } catch {
    return false;
  }
}

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

type ProjectChatMessageIdentity = Pick<ProjectChatMessage, 'id' | 'role' | 'turnId'>;

type ProjectChatUnreadAssistantEntry = {
  initialized: boolean;
  pendingCompletedTurnIds: Set<string>;
  announcedAssistantMessageIds: Set<string>;
  lastSeenAssistantMessageId: string | null;
  unreadAssistantMessageId: string | null;
};

/**
 * Keeps transient unread identity outside the mounted chat view so switching projects or sessions
 * cannot discard an assistant arrival. Historical snapshots establish a baseline; only a terminal
 * turn event announces a new response. Duplicate events remain idempotent after acknowledgement.
 */
export class VolatileProjectChatUnreadAssistantMessages {
  private readonly entries = new Map<string, ProjectChatUnreadAssistantEntry>();

  read(projectId: string, sessionId: string | null) {
    return (
      this.entries.get(projectChatSessionKey(projectId, sessionId ?? ''))
        ?.unreadAssistantMessageId ?? null
    );
  }

  noteCompletedTurn(projectId: string, sessionId: string, turnId: string) {
    const key = projectChatSessionKey(projectId, sessionId);
    const previous = this.entries.get(key);
    const pendingCompletedTurnIds = new Set(previous?.pendingCompletedTurnIds ?? []);
    pendingCompletedTurnIds.add(turnId);
    this.entries.set(key, {
      initialized: previous?.initialized ?? false,
      pendingCompletedTurnIds,
      announcedAssistantMessageIds: new Set(previous?.announcedAssistantMessageIds ?? []),
      lastSeenAssistantMessageId: previous?.lastSeenAssistantMessageId ?? null,
      unreadAssistantMessageId: previous?.unreadAssistantMessageId ?? null,
    });
  }

  observe(projectId: string, sessionId: string, messages: readonly ProjectChatMessageIdentity[]) {
    const key = projectChatSessionKey(projectId, sessionId);
    const previous = this.entries.get(key);
    const pendingCompletedTurnIds = new Set(previous?.pendingCompletedTurnIds ?? []);
    const announcedAssistantMessageIds = new Set(previous?.announcedAssistantMessageIds ?? []);
    const messageIds = new Set(messages.map((message) => message.id));
    const messageIndexes = new Map(messages.map((message, index) => [message.id, index]));
    const newlyCompletedAssistantMessages: ProjectChatMessageIdentity[] = [];

    for (const message of messages) {
      if (
        message.role !== 'assistant' ||
        !message.turnId ||
        !pendingCompletedTurnIds.has(message.turnId)
      ) {
        continue;
      }
      pendingCompletedTurnIds.delete(message.turnId);
      if (!announcedAssistantMessageIds.has(message.id)) {
        announcedAssistantMessageIds.add(message.id);
        newlyCompletedAssistantMessages.push(message);
      }
    }

    let unreadAssistantMessageId = previous?.unreadAssistantMessageId ?? null;
    let lastSeenAssistantMessageId = previous?.lastSeenAssistantMessageId ?? null;

    if (unreadAssistantMessageId && !messageIds.has(unreadAssistantMessageId)) {
      unreadAssistantMessageId = null;
    }

    if (!previous?.initialized) {
      const firstCompletionIndex = newlyCompletedAssistantMessages.reduce(
        (earliest, message) => Math.min(earliest, messageIndexes.get(message.id) ?? earliest),
        messages.length,
      );
      for (let index = firstCompletionIndex - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role === 'assistant') {
          lastSeenAssistantMessageId = message.id;
          break;
        }
      }
    }

    const lastSeenIndex = lastSeenAssistantMessageId
      ? (messageIndexes.get(lastSeenAssistantMessageId) ?? -1)
      : -1;
    let unreadIndex = unreadAssistantMessageId
      ? (messageIndexes.get(unreadAssistantMessageId) ?? -1)
      : -1;
    for (const message of newlyCompletedAssistantMessages) {
      const messageIndex = messageIndexes.get(message.id) ?? -1;
      if (messageIndex <= lastSeenIndex || messageIndex <= unreadIndex) continue;
      unreadAssistantMessageId = message.id;
      unreadIndex = messageIndex;
    }

    this.entries.set(key, {
      initialized: true,
      pendingCompletedTurnIds,
      announcedAssistantMessageIds,
      lastSeenAssistantMessageId,
      unreadAssistantMessageId,
    });
    return unreadAssistantMessageId;
  }

  acknowledge(projectId: string, sessionId: string, assistantMessageId: string) {
    const key = projectChatSessionKey(projectId, sessionId);
    const previous = this.entries.get(key);
    if (!previous || previous.unreadAssistantMessageId !== assistantMessageId) {
      return previous?.unreadAssistantMessageId ?? null;
    }
    this.entries.set(key, {
      ...previous,
      lastSeenAssistantMessageId: assistantMessageId,
      unreadAssistantMessageId: null,
    });
    return null;
  }
}
