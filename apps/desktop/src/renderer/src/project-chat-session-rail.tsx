import type { ProjectChatSession } from '../../shared/project-chat-contracts';

export function ProjectChatSessionRail({
  sessions,
  selectedSessionId,
  activeSessionIds,
  creating,
  disabled = false,
  renameDisabled = false,
  onSelect,
  onCreate,
  onRename,
}: {
  sessions: readonly ProjectChatSession[];
  selectedSessionId: string | null;
  activeSessionIds: ReadonlySet<string>;
  creating: boolean;
  disabled?: boolean;
  renameDisabled?: boolean;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onRename?: (session: ProjectChatSession) => void;
}) {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const selectedSession = selectedSessionId ? byId.get(selectedSessionId) : undefined;
  return (
    <aside className="project-chat-session-rail" aria-label="Project chat sessions">
      <header>
        <div>
          <span>SESSIONS</span>
          <strong>{sessions.length}</strong>
        </div>
        <div className="project-chat-session-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => selectedSession && onRename?.(selectedSession)}
            disabled={disabled || renameDisabled || creating || !selectedSession || !onRename}
            aria-label="Rename selected project chat session"
          >
            Rename
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onCreate}
            disabled={disabled || creating}
            aria-label="Create a new project chat session"
          >
            {creating ? 'Creating…' : '＋ New chat'}
          </button>
        </div>
      </header>
      <div className="project-chat-session-list">
        {sessions.map((session) => {
          const selected = session.id === selectedSessionId;
          const parent = session.parentSessionId ? byId.get(session.parentSessionId) : undefined;
          return (
            <button
              type="button"
              key={session.id}
              className={`project-chat-session-item ${selected ? 'active' : ''}`}
              aria-current={selected ? 'page' : undefined}
              onClick={() => onSelect(session.id)}
              disabled={disabled}
            >
              <span className="project-chat-session-title">
                <i aria-hidden="true">{session.parentSessionId ? '⑂' : '◇'}</i>
                <strong title={session.title}>{session.title}</strong>
                {activeSessionIds.has(session.id) && <b aria-label="Turn active">●</b>}
              </span>
              <small>
                {session.parentSessionId
                  ? `Branched from ${parent?.title ?? 'another session'} · ${formatSessionUpdate(session.createdAt)}`
                  : session.isDefault
                    ? 'Default session'
                    : formatSessionUpdate(session.updatedAt)}
              </small>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function formatSessionUpdate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
