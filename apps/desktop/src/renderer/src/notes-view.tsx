import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import type { LocalNotesVaultGrant, ProjectChatProfile } from '../../shared/project-chat-contracts';
import type { VaultSelection } from '../../shared/vault-contracts';
import type { ProjectRecord } from '../../shared/workspace-contracts';
import {
  localNotesTreeRows,
  revealLocalNote,
  toggleLocalNotesDirectory,
  type LocalNotesTreeRow,
} from './local-notes-tree-model';
import { MarkdownDocument } from './markdown-document';

export type { VaultSelection } from '../../shared/vault-contracts';
export type SelectedNote = { path: string; content: string };
export type VaultRuntimeState = 'checking' | 'ready' | 'unavailable';

const EMPTY_EXPANDED_DIRECTORIES: ReadonlySet<string> = new Set();

export function LocalNotesTree({
  files,
  expandedDirectories,
  selectedPath,
  busy,
  onToggleDirectory,
  onOpenFile,
}: {
  files: readonly string[];
  expandedDirectories: ReadonlySet<string>;
  selectedPath: string | null;
  busy: boolean;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const rows = useMemo(
    () => localNotesTreeRows(files, expandedDirectories),
    [expandedDirectories, files],
  );
  const [focusedPath, setFocusedPath] = useState<string | null>(selectedPath);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (selectedPath) setFocusedPath(selectedPath);
  }, [selectedPath]);
  const visibleFocusedPath = rows.some((row) => row.path === focusedPath)
    ? focusedPath
    : rows.some((row) => row.path === selectedPath)
      ? selectedPath
      : (rows[0]?.path ?? null);

  const focusRow = (path: string | null) => {
    if (!path) return;
    setFocusedPath(path);
    rowButtons.current.get(path)?.focus();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    row: LocalNotesTreeRow,
    index: number,
  ) => {
    let focusTarget: string | null;
    switch (event.key) {
      case 'ArrowDown':
        focusTarget = rows[Math.min(index + 1, rows.length - 1)]?.path ?? null;
        break;
      case 'ArrowUp':
        focusTarget = rows[Math.max(index - 1, 0)]?.path ?? null;
        break;
      case 'Home':
        focusTarget = rows[0]?.path ?? null;
        break;
      case 'End':
        focusTarget = rows.at(-1)?.path ?? null;
        break;
      case 'ArrowRight':
        if (row.kind !== 'directory') return;
        if (!expandedDirectories.has(row.path)) {
          event.preventDefault();
          onToggleDirectory(row.path);
          return;
        }
        focusTarget = rows[index + 1]?.depth === row.depth + 1 ? rows[index + 1]!.path : null;
        break;
      case 'ArrowLeft':
        if (row.kind === 'directory' && expandedDirectories.has(row.path)) {
          event.preventDefault();
          onToggleDirectory(row.path);
          return;
        }
        focusTarget = row.parentPath;
        break;
      default:
        return;
    }
    event.preventDefault();
    focusRow(focusTarget);
  };

  return (
    <div className="local-notes-tree" role="tree" aria-label="Local Notes files">
      {rows.map((row, index) => {
        const directory = row.kind === 'directory';
        const expanded = directory && expandedDirectories.has(row.path);
        const selected = !directory && selectedPath === row.path;
        return (
          <button
            type="button"
            role="treeitem"
            key={`${row.kind}:${row.path}`}
            ref={(button) => {
              if (button) rowButtons.current.set(row.path, button);
              else rowButtons.current.delete(row.path);
            }}
            className={`local-notes-tree-row ${row.kind}${selected ? ' selected' : ''}`}
            style={{ paddingInlineStart: `${9 + row.depth * 17}px` }}
            aria-level={row.depth + 1}
            aria-posinset={row.posInSet}
            aria-setsize={row.setSize}
            aria-expanded={directory ? expanded : undefined}
            aria-selected={directory ? undefined : selected}
            aria-current={selected ? 'page' : undefined}
            aria-disabled={!directory && busy ? true : undefined}
            tabIndex={visibleFocusedPath === row.path ? 0 : -1}
            title={row.path}
            onFocus={() => setFocusedPath(row.path)}
            onKeyDown={(event) => handleKeyDown(event, row, index)}
            onClick={() => {
              if (directory) onToggleDirectory(row.path);
              else if (!busy) onOpenFile(row.path);
            }}
          >
            <span
              className={`local-notes-tree-disclosure${expanded ? ' expanded' : ''}`}
              aria-hidden="true"
            />
            <span className="local-notes-tree-icon" aria-hidden="true" />
            <span className="local-notes-tree-label">{row.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function LocalNotesView({
  vault,
  vaultState,
  selectedNote,
  busy,
  project,
  profile,
  profileLoading,
  accessBusy,
  onChoose,
  onRead,
  onSetProjectAccess,
  onOpenAgentSettings,
}: {
  vault: VaultSelection | null;
  vaultState: VaultRuntimeState;
  selectedNote: SelectedNote | null;
  busy: boolean;
  project: ProjectRecord | undefined;
  profile: ProjectChatProfile | undefined;
  profileLoading: boolean;
  accessBusy: boolean;
  onChoose: () => void;
  onRead: (path: string) => void;
  onSetProjectAccess: (grant: LocalNotesVaultGrant | null) => void;
  onOpenAgentSettings: () => void;
}) {
  const vaultId = vault?.id ?? null;
  const selectedNotePath =
    selectedNote && vault?.files.includes(selectedNote.path) ? selectedNote.path : null;
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered');
  const [treeState, setTreeState] = useState<{
    vaultId: string | null;
    expandedDirectories: ReadonlySet<string>;
  }>({
    vaultId,
    expandedDirectories: selectedNotePath
      ? revealLocalNote(EMPTY_EXPANDED_DIRECTORIES, selectedNotePath)
      : EMPTY_EXPANDED_DIRECTORIES,
  });
  useEffect(() => {
    setTreeState({
      vaultId,
      expandedDirectories: EMPTY_EXPANDED_DIRECTORIES,
    });
  }, [vaultId]);
  useEffect(() => {
    if (!vaultId || !selectedNotePath) return;
    setTreeState((current) => ({
      vaultId,
      expandedDirectories: revealLocalNote(
        current.vaultId === vaultId ? current.expandedDirectories : EMPTY_EXPANDED_DIRECTORIES,
        selectedNotePath,
      ),
    }));
  }, [selectedNotePath, vaultId]);
  const accessPanel = (
    <LocalNotesProjectAccess
      vault={vault}
      vaultState={vaultState}
      project={project}
      profile={profile}
      profileLoading={profileLoading}
      busy={accessBusy}
      onSetAccess={onSetProjectAccess}
      onOpenSettings={onOpenAgentSettings}
    />
  );

  if (!vault) {
    return (
      <section className="empty-state">
        <div className="empty-card">
          <div className="empty-mark">◇</div>
          <h1>Open a local Markdown folder</h1>
          <p>
            GOSU receives read-only access to the folder you select. File contents are not sent to
            Hosted Sync automatically. If you later authorize this folder for a project agent,
            listing sends note display titles and opaque IDs to the configured LLM; reading also
            sends a bounded excerpt, content hash, offset, and total character count for that chat
            turn. The model may quote or summarize that data in the visible project chat, which is
            stored locally and may later be synchronized.
          </p>
          <button type="button" className="primary-button" onClick={onChoose} disabled={busy}>
            {busy ? 'Opening…' : 'Choose folder'}
          </button>
          {accessPanel}
        </div>
      </section>
    );
  }

  const expandedDirectories =
    treeState.vaultId === vault.id ? treeState.expandedDirectories : EMPTY_EXPANDED_DIRECTORIES;
  const updateExpandedDirectories = (
    update: (current: ReadonlySet<string>) => ReadonlySet<string>,
  ) => {
    setTreeState((current) => ({
      vaultId: vault.id,
      expandedDirectories: update(
        current.vaultId === vault.id ? current.expandedDirectories : EMPTY_EXPANDED_DIRECTORIES,
      ),
    }));
  };
  const openNote = (path: string) => {
    updateExpandedDirectories((current) => revealLocalNote(current, path));
    onRead(path);
  };

  return (
    <section className="notes-layout">
      <aside className="note-list" aria-label="Markdown files">
        <header>
          <strong title={vault.root}>{vault.root}</strong>
          <button type="button" className="secondary-button" onClick={onChoose} disabled={busy}>
            Change folder
          </button>
        </header>
        {accessPanel}
        <p className="note-agent-disclosure">
          Access is project-specific and stays off until you explicitly authorize this folder here
          or in AI Agent Settings. Once authorized, listing sends display titles and opaque IDs;
          reading also sends the requested excerpt, content hash, offset, and total length to the
          configured LLM. Visible replies may be stored and synchronized.
        </p>
        {vault.files.length === 0 && <p className="column-empty">No Markdown files found</p>}
        {vault.files.length > 0 && (
          <LocalNotesTree
            key={vault.id}
            files={vault.files}
            expandedDirectories={expandedDirectories}
            selectedPath={selectedNote?.path ?? null}
            busy={busy}
            onToggleDirectory={(path) =>
              updateExpandedDirectories((current) => toggleLocalNotesDirectory(current, path))
            }
            onOpenFile={openNote}
          />
        )}
      </aside>
      <article className="note-reader">
        <header>
          <span>{selectedNote?.path ?? 'Select a Markdown file to read it locally.'}</span>
          {selectedNote && (
            <div className="note-reader-mode" aria-label="Markdown display mode">
              <button
                type="button"
                className={mode === 'rendered' ? 'active' : ''}
                aria-pressed={mode === 'rendered'}
                onClick={() => setMode('rendered')}
              >
                Rendered
              </button>
              <button
                type="button"
                className={mode === 'source' ? 'active' : ''}
                aria-pressed={mode === 'source'}
                onClick={() => setMode('source')}
              >
                Source
              </button>
            </div>
          )}
        </header>
        <div className="note-reader-body">
          {busy ? (
            <p className="note-reader-state">Reading…</p>
          ) : selectedNote ? (
            mode === 'rendered' ? (
              <MarkdownDocument
                key={selectedNote.path}
                notePath={selectedNote.path}
                source={selectedNote.content}
                vaultFiles={vault.files}
                onOpenNote={openNote}
              />
            ) : (
              <pre className="markdown-source">{selectedNote.content}</pre>
            )
          ) : (
            <p className="note-reader-state">No note selected.</p>
          )}
        </div>
      </article>
    </section>
  );
}

export function LocalNotesProjectAccess({
  vault,
  vaultState,
  project,
  profile,
  profileLoading,
  busy,
  onSetAccess,
  onOpenSettings,
}: {
  vault: VaultSelection | null;
  vaultState: VaultRuntimeState;
  project: ProjectRecord | undefined;
  profile: ProjectChatProfile | undefined;
  profileLoading: boolean;
  busy: boolean;
  onSetAccess: (grant: LocalNotesVaultGrant | null) => void;
  onOpenSettings: () => void;
}) {
  const savedGrant = profile?.localNotesVault ?? null;
  const authorized = Boolean(
    project && profile && vaultState === 'ready' && vault && savedGrant?.id === vault.id,
  );
  const canAuthorize = Boolean(
    project &&
    profile &&
    vaultState === 'ready' &&
    vault &&
    !authorized &&
    !profileLoading &&
    !busy,
  );
  const canRevoke = Boolean(project && profile && savedGrant && !profileLoading && !busy);

  let title = 'Select an active project';
  let description = 'Choose a project in the sidebar before granting its agent access.';
  let tone = 'inactive';

  if (project) {
    if (profileLoading) {
      title = `Checking ${project.name} access…`;
      description = 'Loading the encrypted project agent profile.';
      tone = 'checking';
    } else if (!profile) {
      title = 'Project access status unavailable';
      description = 'Open AI Agent Settings to retry loading this project profile.';
      tone = 'warning';
    } else if (vaultState === 'checking') {
      title = 'Checking the Local Notes folder…';
      description = 'Authorization stays paused until the selected folder is verified.';
      tone = 'checking';
    } else if (vaultState === 'unavailable') {
      title = savedGrant
        ? `${savedGrant.name} grant saved · status unavailable`
        : 'Folder unavailable';
      description = savedGrant
        ? 'The saved grant is paused because GOSU cannot verify the current folder.'
        : 'Choose the folder again before authorizing project access.';
      tone = 'warning';
    } else if (!vault) {
      title = savedGrant ? `${savedGrant.name} grant inactive` : 'Choose a folder to authorize';
      description = savedGrant
        ? 'The previously authorized folder is not currently selected. Access was not transferred.'
        : `No Local Notes folder is authorized for ${project.name}.`;
      tone = 'inactive';
    } else if (authorized) {
      title = `Authorized for ${project.name}`;
      description = `${vault.name} can be listed and read through bounded tools in this project's chat.`;
      tone = 'authorized';
    } else if (savedGrant) {
      title = `Current folder not authorized for ${project.name}`;
      description = `${savedGrant.name} was authorized previously. Access never transfers silently to ${vault.name}.`;
      tone = 'warning';
    } else {
      title = `Not authorized for ${project.name}`;
      description = `${vault.name} remains local-only until you explicitly grant project access.`;
      tone = 'inactive';
    }
  }

  return (
    <section
      className={`local-notes-project-access ${tone}`}
      aria-label="Project agent access"
      aria-live="polite"
    >
      <span>PROJECT AGENT ACCESS</span>
      <strong>{title}</strong>
      <p>{description}</p>
      <div className="local-notes-access-actions">
        {project && vault && !authorized && (
          <button
            type="button"
            className="secondary-button"
            disabled={!canAuthorize}
            onClick={() => onSetAccess({ id: vault.id, name: vault.name })}
          >
            {profileLoading
              ? 'Checking access…'
              : busy
                ? 'Working…'
                : `Authorize for ${project.name}`}
          </button>
        )}
        {project && savedGrant && (
          <button
            type="button"
            className="ghost-button"
            disabled={!canRevoke}
            onClick={() => onSetAccess(null)}
          >
            {busy ? 'Working…' : 'Revoke access'}
          </button>
        )}
        {project && (
          <button type="button" className="ghost-button" onClick={onOpenSettings}>
            Open AI Agent Settings…
          </button>
        )}
      </div>
    </section>
  );
}
