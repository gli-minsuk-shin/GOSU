import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import {
  PROJECT_CHAT_MAX_SESSION_TITLE_LENGTH,
  type ProjectChatSession,
} from '../../shared/project-chat-contracts';
import {
  PROJECT_CHAT_SESSION_RAIL_DEFAULT_WIDTH,
  PROJECT_CHAT_SESSION_RAIL_MAX_WIDTH,
  PROJECT_CHAT_SESSION_RAIL_MIN_WIDTH,
} from './project-chat-session-state';
import { ResizeHandle } from './resize-handle';

export type ProjectChatSessionRenameValidation =
  | Readonly<{ status: 'invalid'; message: string }>
  | Readonly<{ status: 'unchanged'; title: string }>
  | Readonly<{ status: 'valid'; title: string }>;

export function validateProjectChatSessionRename(
  value: string,
  currentTitle: string,
): ProjectChatSessionRenameValidation {
  const title = value.trim();
  if (title.length === 0) {
    return { status: 'invalid', message: 'Enter a session name.' };
  }
  if (title.length > PROJECT_CHAT_MAX_SESSION_TITLE_LENGTH) {
    return {
      status: 'invalid',
      message: `Session names can contain at most ${PROJECT_CHAT_MAX_SESSION_TITLE_LENGTH} characters.`,
    };
  }
  return title === currentTitle.trim()
    ? { status: 'unchanged', title }
    : { status: 'valid', title };
}

export function projectChatSessionRenameKeyAction(input: {
  key: string;
  isComposing: boolean;
  keyCode: number;
}): 'save' | 'cancel' | null {
  if (input.isComposing || input.keyCode === 229) return null;
  if (input.key === 'Enter') return 'save';
  if (input.key === 'Escape') return 'cancel';
  return null;
}

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
  width = PROJECT_CHAT_SESSION_RAIL_DEFAULT_WIDTH,
  onWidthChange = () => undefined,
}: {
  sessions: readonly ProjectChatSession[];
  selectedSessionId: string | null;
  activeSessionIds: ReadonlySet<string>;
  creating: boolean;
  disabled?: boolean;
  renameDisabled?: boolean;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onRename?: (
    session: ProjectChatSession,
    title: string,
  ) => boolean | void | Promise<boolean | void>;
  width?: number;
  onWidthChange?: (width: number) => void;
}) {
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [savingRename, setSavingRename] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const sessionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusSessionIdRef = useRef<string | null>(null);
  const suppressComposingSubmitRef = useRef(false);
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const selectedSession = selectedSessionId ? byId.get(selectedSessionId) : undefined;

  useEffect(() => {
    if (renamingSessionId === null) {
      const sessionId = restoreFocusSessionIdRef.current;
      if (sessionId !== null) {
        sessionButtonRefs.current.get(sessionId)?.focus();
        restoreFocusSessionIdRef.current = null;
      }
      return;
    }
    if (!sessions.some((session) => session.id === renamingSessionId)) {
      setRenamingSessionId(null);
      setRenameDraft('');
      setRenameError(null);
      setSavingRename(false);
      return;
    }
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingSessionId, sessions]);

  const beginRename = (session: ProjectChatSession) => {
    if (!onRename || disabled || renameDisabled || creating) return;
    setRenamingSessionId(session.id);
    setRenameDraft(session.title);
    setRenameError(null);
  };

  const cancelRename = () => {
    if (savingRename) return;
    restoreFocusSessionIdRef.current = renamingSessionId;
    setRenamingSessionId(null);
    setRenameDraft('');
    setRenameError(null);
  };

  const saveRename = async (session: ProjectChatSession) => {
    if (!onRename || savingRename) return;
    if (disabled || renameDisabled || creating) {
      setRenameError('Wait for the current project action to finish before renaming.');
      return;
    }
    const validation = validateProjectChatSessionRename(renameDraft, session.title);
    if (validation.status === 'invalid') {
      setRenameError(validation.message);
      renameInputRef.current?.focus();
      return;
    }
    if (validation.status === 'unchanged') {
      cancelRename();
      return;
    }

    setSavingRename(true);
    setRenameError(null);
    try {
      const renamed = await onRename(session, validation.title);
      if (renamed === false) {
        setRenameError('Could not rename this session. Review the error above and try again.');
        renameInputRef.current?.focus();
        return;
      }
      restoreFocusSessionIdRef.current = session.id;
      setRenamingSessionId(null);
      setRenameDraft('');
    } catch {
      setRenameError('Could not rename this session. Try again.');
      renameInputRef.current?.focus();
    } finally {
      setSavingRename(false);
    }
  };

  const submitRename = (event: FormEvent<HTMLFormElement>, session: ProjectChatSession) => {
    event.preventDefault();
    if (suppressComposingSubmitRef.current) {
      suppressComposingSubmitRef.current = false;
      return;
    }
    void saveRename(session);
  };

  const handleRenameKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    session: ProjectChatSession,
  ) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      suppressComposingSubmitRef.current = true;
      queueMicrotask(() => {
        suppressComposingSubmitRef.current = false;
      });
      return;
    }
    const action = projectChatSessionRenameKeyAction({
      key: event.key,
      isComposing: event.nativeEvent.isComposing,
      keyCode: event.keyCode,
    });
    if (action === 'cancel') {
      event.preventDefault();
      cancelRename();
    }
    if (action === 'save') {
      event.preventDefault();
      void saveRename(session);
    }
  };

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
            onClick={() => selectedSession && beginRename(selectedSession)}
            disabled={
              disabled ||
              renameDisabled ||
              creating ||
              renamingSessionId !== null ||
              !selectedSession ||
              !onRename
            }
            aria-label="Rename selected project chat session"
            title={
              renameDisabled ? 'Wait for the active turn to finish before renaming.' : undefined
            }
          >
            Rename
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onCreate}
            disabled={disabled || creating || renamingSessionId !== null}
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
          const renaming = session.id === renamingSessionId;
          return (
            <div
              key={session.id}
              className={`project-chat-session-row ${selected ? 'active' : ''}`}
            >
              {renaming ? (
                <form
                  className="project-chat-session-rename-form"
                  aria-label={`Rename ${session.title}`}
                  aria-busy={savingRename}
                  noValidate
                  onSubmit={(event) => submitRename(event, session)}
                >
                  <label htmlFor={`project-chat-session-name-${session.id}`}>Session name</label>
                  <input
                    ref={renameInputRef}
                    id={`project-chat-session-name-${session.id}`}
                    value={renameDraft}
                    onChange={(event) => {
                      setRenameDraft(event.currentTarget.value);
                      if (renameError) setRenameError(null);
                    }}
                    onKeyDown={(event) => handleRenameKeyDown(event, session)}
                    maxLength={PROJECT_CHAT_MAX_SESSION_TITLE_LENGTH}
                    required
                    autoComplete="off"
                    aria-invalid={renameError ? true : undefined}
                    aria-describedby={
                      renameError ? `project-chat-session-error-${session.id}` : undefined
                    }
                    readOnly={savingRename || disabled || renameDisabled || creating}
                    aria-disabled={savingRename || disabled || renameDisabled || creating}
                  />
                  <div className="project-chat-session-rename-actions">
                    <button
                      type="submit"
                      className="secondary-button"
                      disabled={savingRename || disabled || renameDisabled || creating}
                    >
                      {savingRename ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={cancelRename}
                      disabled={savingRename}
                    >
                      Cancel
                    </button>
                  </div>
                  {renameError && (
                    <small id={`project-chat-session-error-${session.id}`} role="alert">
                      {renameError}
                    </small>
                  )}
                  {!renameError && renameDisabled && (
                    <small>Wait for the active turn to finish before renaming.</small>
                  )}
                </form>
              ) : (
                <>
                  <button
                    ref={(node) => {
                      if (node) sessionButtonRefs.current.set(session.id, node);
                      else sessionButtonRefs.current.delete(session.id);
                    }}
                    type="button"
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
                  {onRename && (
                    <button
                      type="button"
                      className="project-chat-session-rename-trigger"
                      onClick={() => beginRename(session)}
                      disabled={
                        disabled || renameDisabled || creating || renamingSessionId !== null
                      }
                      aria-label={`Rename ${session.title}`}
                      title={
                        renameDisabled
                          ? 'Wait for the active turn to finish before renaming.'
                          : 'Rename session'
                      }
                    >
                      ✎
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      <ResizeHandle
        className="project-chat-session-resize-handle"
        label="Resize project chat sessions sidebar"
        value={width}
        min={PROJECT_CHAT_SESSION_RAIL_MIN_WIDTH}
        max={PROJECT_CHAT_SESSION_RAIL_MAX_WIDTH}
        onChange={onWidthChange}
      />
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
