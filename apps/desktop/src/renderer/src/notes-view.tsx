import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import {
  allowsAgentMarkdownCreate,
  type LocalNotesVaultGrant,
  type ProjectChatProfile,
} from '../../shared/project-chat-contracts';
import type { ResearchNotesWorkspace } from '../../shared/research-notes-contracts';
import type {
  ReadVaultAttachmentInput,
  VaultAttachment,
  VaultSelection,
} from '../../shared/vault-contracts';
import type { ProjectRecord } from '../../shared/workspace-contracts';
import {
  localNotesTreeRows,
  revealLocalNote,
  toggleLocalNotesDirectory,
  type LocalNotesTreeRow,
} from './local-notes-tree-model';
import { MarkdownDocument } from './markdown-document';
import { SearchView, type SearchViewAdapter } from './search-view';
import { CollapseChevron } from './ui-primitives';

export type { VaultSelection } from '../../shared/vault-contracts';
export type SelectedNote = { path: string; content: string };
export type VaultRuntimeState = 'checking' | 'ready' | 'unavailable';

const EMPTY_EXPANDED_DIRECTORIES: ReadonlySet<string> = new Set();

export function ResearchNotesTree({
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
    <div className="local-notes-tree" role="tree" aria-label="Research Notes files">
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

export function ResearchNotesView({
  vault,
  workspace,
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
  onRetry,
  readAttachment,
  folderTreeCollapsed = false,
  onFolderTreeCollapsedChange = () => undefined,
  searchAdapter,
}: {
  vault?: VaultSelection | null;
  workspace?: ResearchNotesWorkspace | null;
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
  onRetry?: () => void;
  readAttachment?: (input: ReadVaultAttachmentInput) => Promise<VaultAttachment>;
  folderTreeCollapsed?: boolean;
  onFolderTreeCollapsedChange?: (collapsed: boolean) => void;
  searchAdapter?: SearchViewAdapter;
}) {
  const folderTreeDetailsId = useId();
  const managed = workspace !== undefined;
  const effectiveVault: VaultSelection | null = workspace
    ? {
        id: workspace.bindingId,
        name: 'Research Notes',
        root: workspace.displayRoot,
        files: workspace.files,
      }
    : (vault ?? null);
  vault = effectiveVault;
  const vaultId = vault?.id ?? null;
  const selectedNotePath =
    selectedNote && vault?.files.includes(selectedNote.path) ? selectedNote.path : null;
  const visibleSelectedNote = selectedNotePath ? selectedNote : null;
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
    <ResearchNotesProjectAccess
      vault={workspace?.status === 'rename-pending' ? null : vault}
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
    const checking = managed && vaultState === 'checking';
    const unavailable = managed && vaultState === 'unavailable';
    return (
      <section className="empty-state">
        <div className="empty-card">
          <div className="empty-mark">◇</div>
          <h1>
            {checking
              ? 'Opening Research Notes…'
              : unavailable
                ? 'Research Notes need attention'
                : managed
                  ? 'Connect an Obsidian Vault'
                  : 'Open a local Markdown folder'}
          </h1>
          <p>
            {checking
              ? 'GOSU is verifying the Obsidian Vault and this project’s isolated managed folder.'
              : unavailable
                ? 'GOSU could not verify this project’s Obsidian folder. Existing files were not changed. Retry the connection or choose the Vault again.'
                : managed
                  ? `Choose your Obsidian Vault once. GOSU creates only this project's managed GOSU folder with Literature, Papers, Experiments, Project Progress, and Idea Development notes. General Vault content remains read-only and is never sent to Hosted Sync automatically.`
                  : 'GOSU receives read-only access to the folder you select. File contents are not sent to Hosted Sync automatically.'}
          </p>
          <div className="research-notes-empty-actions">
            {unavailable && onRetry && (
              <button type="button" className="primary-button" onClick={onRetry} disabled={busy}>
                {busy ? 'Retrying…' : 'Retry project folder'}
              </button>
            )}
            {!checking && (
              <button
                type="button"
                className={unavailable ? 'secondary-button' : 'primary-button'}
                onClick={onChoose}
                disabled={busy}
              >
                {busy ? 'Opening…' : managed ? 'Choose Obsidian Vault' : 'Choose folder'}
              </button>
            )}
          </div>
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
    <section className={`notes-layout${folderTreeCollapsed ? ' folder-tree-collapsed' : ''}`}>
      <aside
        className={`note-list${folderTreeCollapsed ? ' collapsed' : ''}`}
        aria-label="Markdown files"
      >
        <header className="research-notes-tree-header">
          <strong title={vault.root} hidden={folderTreeCollapsed}>
            {vault.root}
          </strong>
          <button
            type="button"
            className="ghost-button research-notes-folder-tree-toggle"
            aria-controls={folderTreeDetailsId}
            aria-expanded={!folderTreeCollapsed}
            aria-label={
              folderTreeCollapsed
                ? 'Show Research Notes folder tree'
                : 'Hide Research Notes folder tree'
            }
            title={folderTreeCollapsed ? 'Show folder tree' : 'Hide folder tree'}
            onClick={() => onFolderTreeCollapsedChange(!folderTreeCollapsed)}
          >
            <CollapseChevron direction={folderTreeCollapsed ? 'right' : 'left'} />
          </button>
        </header>
        <div
          id={folderTreeDetailsId}
          className="research-notes-tree-details"
          hidden={folderTreeCollapsed}
        >
          <button type="button" className="secondary-button" onClick={onChoose} disabled={busy}>
            {managed ? 'Change Vault' : 'Change folder'}
          </button>
          {workspace?.status === 'rename-pending' && (
            <div className="notice error research-notes-attention" role="status">
              <span>{researchNotesAttentionMessage(workspace.attentionCode)}</span>
              {onRetry && (
                <button type="button" className="ghost-button" onClick={onRetry} disabled={busy}>
                  Retry
                </button>
              )}
            </div>
          )}
          {workspace && (
            <section
              className="research-notes-managed-summary"
              aria-label="Managed project folders"
            >
              <span>MANAGED PROJECT FOLDERS</span>
              <ul>
                {workspace.folders.map((folder) => (
                  <li key={folder}>{folder}</li>
                ))}
              </ul>
              <small>
                {workspace.lastLiteratureSyncAt
                  ? `Literature table synced ${new Date(workspace.lastLiteratureSyncAt).toLocaleString()}`
                  : 'Literature table will sync after the first Literature search or update.'}
              </small>
            </section>
          )}
          {project && searchAdapter && (
            <SearchView
              adapter={searchAdapter}
              scope={{ kind: 'project', projectId: project.id }}
              scopeLabel={`${project.name} Research Notes`}
              compact
              onOpen={(hit) => {
                if (hit.target.kind === 'research-note') openNote(hit.target.path);
              }}
            />
          )}
          {accessPanel}
          <p className="note-agent-disclosure">
            Access is project-specific and stays off until you explicitly authorize this folder here
            or in AI Agent Settings. Listing sends display titles and opaque IDs; reading also sends
            the requested excerpt, content hash, offset, and total length to the configured LLM.
            Automatic Markdown saving is a separate explicit capability: it creates only new files
            under this project’s managed folders, never replaces a different existing file, and
            reports the relative location. Legacy grants remain read-only until upgraded. Visible
            replies may be stored and synchronized; Research Notes file bodies remain local.
          </p>
          {vault.files.length === 0 && <p className="column-empty">No Markdown files found</p>}
          {vault.files.length > 0 && (
            <ResearchNotesTree
              key={vault.id}
              files={vault.files}
              expandedDirectories={expandedDirectories}
              selectedPath={visibleSelectedNote?.path ?? null}
              busy={busy}
              onToggleDirectory={(path) =>
                updateExpandedDirectories((current) => toggleLocalNotesDirectory(current, path))
              }
              onOpenFile={openNote}
            />
          )}
        </div>
      </aside>
      <article className="note-reader">
        <header>
          <span>{visibleSelectedNote?.path ?? 'Select a Markdown file to read it locally.'}</span>
          {visibleSelectedNote && (
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
          ) : visibleSelectedNote ? (
            mode === 'rendered' ? (
              <MarkdownDocument
                key={visibleSelectedNote.path}
                notePath={visibleSelectedNote.path}
                source={visibleSelectedNote.content}
                vaultFiles={vault.files}
                onOpenNote={openNote}
                {...(readAttachment ? { readAttachment } : {})}
              />
            ) : (
              <pre className="markdown-source">{visibleSelectedNote.content}</pre>
            )
          ) : (
            <p className="note-reader-state">No note selected.</p>
          )}
        </div>
      </article>
    </section>
  );
}

export const LocalNotesView = ResearchNotesView;

export function ResearchNotesProjectAccess({
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
  const readAuthorized = Boolean(
    project && profile && vaultState === 'ready' && vault && savedGrant?.id === vault.id,
  );
  const automaticMarkdownSaveAuthorized = readAuthorized && allowsAgentMarkdownCreate(savedGrant);
  const canAuthorize = Boolean(
    project &&
    profile &&
    vaultState === 'ready' &&
    vault &&
    !automaticMarkdownSaveAuthorized &&
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
      title = 'Checking the Research Notes folder…';
      description = 'Authorization stays paused until this project’s Obsidian folder is verified.';
      tone = 'checking';
    } else if (vaultState === 'unavailable') {
      title = savedGrant
        ? `${savedGrant.name} grant saved · status unavailable`
        : 'Research Notes unavailable';
      description = savedGrant
        ? 'The saved grant is paused because GOSU cannot verify this project’s Obsidian folder.'
        : 'Choose the Obsidian Vault again before authorizing project access.';
      tone = 'warning';
    } else if (!vault) {
      title = savedGrant
        ? `${savedGrant.name} grant inactive`
        : 'Connect Research Notes to authorize';
      description = savedGrant
        ? 'The previously authorized Research Notes binding is not currently available. Access was not transferred.'
        : `No Research Notes folder is authorized for ${project.name}.`;
      tone = 'inactive';
    } else if (automaticMarkdownSaveAuthorized) {
      title = `Read + automatic Markdown saves authorized for ${project.name}`;
      description =
        'Project Chat can use bounded read tools and create new Markdown files in the managed project folders. Automatic saves are create-only and never overwrite an existing note.';
      tone = 'authorized';
    } else if (readAuthorized) {
      title = `Read-only access for ${project.name}`;
      description =
        'This legacy grant still permits bounded note listing and reading. Automatic Markdown saves remain off until you explicitly enable them.';
      tone = 'authorized';
    } else if (savedGrant) {
      title = `Current folder not authorized for ${project.name}`;
      description = `${savedGrant.name} was authorized previously. Access never transfers silently to another project or Vault.`;
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
      <span>RESEARCH NOTES AGENT ACCESS</span>
      <strong>{title}</strong>
      <p>{description}</p>
      {project && vault && !automaticMarkdownSaveAuthorized && (
        <small>
          Enabling automatic Markdown saves lets Project Chat create reusable deliverables in this
          project’s Research Notes without asking on every task. GOSU reports the relative saved
          location and cannot replace a different existing file.
        </small>
      )}
      <div className="local-notes-access-actions">
        {project && vault && !automaticMarkdownSaveAuthorized && (
          <button
            type="button"
            className="secondary-button"
            disabled={!canAuthorize}
            onClick={() =>
              onSetAccess({
                id: vault.id,
                name: vault.name,
                allowAgentMarkdownCreate: true,
              })
            }
          >
            {profileLoading
              ? 'Checking access…'
              : busy
                ? 'Working…'
                : readAuthorized
                  ? 'Enable automatic Markdown saves'
                  : `Authorize read + automatic saves for ${project.name}`}
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

export const LocalNotesTree = ResearchNotesTree;
export const LocalNotesProjectAccess = ResearchNotesProjectAccess;

export function researchNotesAttentionMessage(
  attentionCode: ResearchNotesWorkspace['attentionCode'],
) {
  switch (attentionCode) {
    case 'folder_name_conflict':
      return 'The renamed project folder would overwrite an existing Obsidian folder. GOSU kept the original folder unchanged.';
    case 'folder_missing':
      return 'The linked Obsidian project folder is missing. GOSU did not recreate or replace it automatically.';
    case 'folder_ownership_changed':
      return 'The project folder ownership marker changed. GOSU stopped managed writes and left every file untouched.';
    case 'vault_unavailable':
      return 'The linked Obsidian Vault is unavailable. GOSU kept the existing folder binding for a safe retry.';
    default:
      return 'The Obsidian project folder could not be reconciled safely. Existing notes were left untouched.';
  }
}
