import { useState } from 'react';

import type { LocalNotesVaultGrant, ProjectChatProfile } from '../../shared/project-chat-contracts';
import type { VaultSelection } from '../../shared/vault-contracts';
import type { ProjectRecord } from '../../shared/workspace-contracts';
import { MarkdownDocument } from './markdown-document';

export type { VaultSelection } from '../../shared/vault-contracts';
export type SelectedNote = { path: string; content: string };
export type VaultRuntimeState = 'checking' | 'ready' | 'unavailable';

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
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered');
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
        {vault.files.map((file) => (
          <button
            type="button"
            className={selectedNote?.path === file ? 'active' : ''}
            key={file}
            onClick={() => onRead(file)}
            disabled={busy}
            title={file}
          >
            {file}
          </button>
        ))}
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
                onOpenNote={onRead}
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
