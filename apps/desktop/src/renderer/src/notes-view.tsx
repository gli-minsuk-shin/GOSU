export type VaultSelection = { root: string; files: string[] };
export type SelectedNote = { path: string; content: string };

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
  if (!vault) {
    return (
      <section className="empty-state">
        <div className="empty-card">
          <div className="empty-mark">◇</div>
          <h1>Open a local Markdown folder</h1>
          <p>
            GOSU receives read-only access to the folder you select. File contents are not sent to
            Hosted Sync.
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
        <header>{selectedNote?.path ?? 'Select a Markdown file to read it locally.'}</header>
        <pre>{busy ? 'Reading…' : (selectedNote?.content ?? 'No note selected.')}</pre>
      </article>
    </section>
  );
}
