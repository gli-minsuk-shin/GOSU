import { useState } from 'react';

import {
  EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION,
  type EmptyLectureStudioTrashInput,
  type EmptyLectureStudioTrashReceipt,
  type LectureStudioListSnapshot,
  type LectureStudioVersionCommand,
} from '../../shared/lecture-studio-contracts';

export function LectureTrashSettingsSection({
  snapshot,
  busy,
  onRestore,
  onEmptyTrash,
}: {
  snapshot: LectureStudioListSnapshot | null;
  busy: boolean;
  onRestore: (input: LectureStudioVersionCommand) => Promise<boolean>;
  onEmptyTrash: (
    input: EmptyLectureStudioTrashInput,
  ) => Promise<EmptyLectureStudioTrashReceipt | null>;
}) {
  const [phrase, setPhrase] = useState('');
  const [receipt, setReceipt] = useState<EmptyLectureStudioTrashReceipt | null>(null);
  const trashed = snapshot?.studios.filter((studio) => studio.trashedAt !== undefined) ?? [];

  return (
    <div className="settings-layout project-settings-layout">
      <article className="settings-card">
        <div className="settings-card-heading">
          <span>LECTURE TRASH</span>
          <h2>Recoverable Lecture Studios</h2>
          <p>
            Restore a Studio with the same ID, chat, source manifest, and revision history. Research
            Notes and generated files stay untouched while a Studio is in Trash.
          </p>
        </div>
        {!snapshot ? (
          <div className="settings-empty-row">Loading Lecture Trash…</div>
        ) : trashed.length === 0 ? (
          <div className="settings-empty-row">Lecture Trash is empty.</div>
        ) : (
          <div className="project-settings-list">
            {trashed.map((studio) => (
              <section className="project-settings-row trashed" key={studio.id}>
                <div className="project-settings-summary">
                  <strong>{studio.title}</strong>
                  <span>
                    Trashed {new Date(studio.trashedAt!).toLocaleString()} · revision{' '}
                    {studio.currentRevision} · {studio.kind === 'talk' ? 'talk slides' : 'lecture'}
                  </span>
                </div>
                <div className="project-settings-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void onRestore({ studioId: studio.id, expectedVersion: studio.version })
                    }
                  >
                    Restore
                  </button>
                </div>
              </section>
            ))}
          </div>
        )}
      </article>

      {trashed.length > 0 && (
        <article className="settings-card">
          <div className="settings-card-heading">
            <span>PERMANENT REMOVAL</span>
            <h2>Empty Lecture Trash</h2>
            <p>
              This removes only trashed Studio metadata, chat, and revision records from the
              encrypted GOSU database. Existing Research Notes, exported TeX/PDF files, manuscript
              checkpoints, literature, and experiment evidence are preserved.
            </p>
          </div>
          <label>
            Type {EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION} to continue
            <input
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className="danger-button"
            disabled={busy || phrase !== EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION}
            onClick={() => {
              if (phrase !== EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION) return;
              if (
                !window.confirm(
                  `Final warning (2 of 2): permanently remove ${trashed.length} Lecture Studio${trashed.length === 1 ? '' : 's'} from GOSU? Research Notes and exported files remain on disk. This cannot be undone in GOSU.`,
                )
              ) {
                return;
              }
              void onEmptyTrash({
                idempotencyKey: window.crypto.randomUUID(),
                confirmation: EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION,
              }).then((nextReceipt) => {
                if (!nextReceipt) return;
                setPhrase('');
                setReceipt(nextReceipt);
              });
            }}
          >
            Empty Lecture Trash permanently
          </button>
        </article>
      )}

      {receipt && (
        <article className="settings-card settings-template-callout" role="status">
          <strong>
            Removed {receipt.removedStudios.length} Lecture Studio
            {receipt.removedStudios.length === 1 ? '' : 's'} from GOSU
          </strong>
          <span>
            Research Notes and exported files were preserved. Completed{' '}
            {new Date(receipt.completedAt).toLocaleString()}.
          </span>
        </article>
      )}
    </div>
  );
}
