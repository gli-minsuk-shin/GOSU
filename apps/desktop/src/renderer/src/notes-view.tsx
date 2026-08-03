import { useState } from 'react';

import type { VaultSelection } from '../../shared/vault-contracts';
import { MarkdownDocument } from './markdown-document';

export type { VaultSelection } from '../../shared/vault-contracts';
export type SelectedNote = { path: string; content: string };
export type VaultRuntimeState = 'checking' | 'ready' | 'unavailable';

export function LocalNotesView({
  vault,
  selectedNote,
  busy,
  onChoose,
  onRead,
}: {
  vault: VaultSelection | null;
  selectedNote: SelectedNote | null;
  busy: boolean;
  onChoose: () => void;
  onRead: (path: string) => void;
}) {
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered');

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
        <p className="note-agent-disclosure">
          Project agent access stays off until you authorize this folder in AI Agent Settings. Once
          authorized, listing sends display titles and opaque IDs; reading also sends the requested
          excerpt, content hash, offset, and total length to the configured LLM. Visible replies may
          be stored and synchronized.
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
