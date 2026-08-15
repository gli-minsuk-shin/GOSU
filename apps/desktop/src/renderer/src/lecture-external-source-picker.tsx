import { ManuscriptRootDocumentSchema } from '@gosu/contracts';
import { useState, type FormEvent } from 'react';

import './lecture-external-source-picker.css';
import { OverleafPersonalTokenNotice } from './overleaf-personal-token-notice';
import type { OverleafPersonalTokenUiState } from './overleaf-personal-token-ui';

export type LectureExternalSourceCard = Readonly<{
  id: string;
  displayName: string;
  kind: 'latex' | 'markdown' | 'pdf';
  byteSize: number;
  textAvailable: boolean;
  truncated: boolean;
  unitLabel: 'part' | 'page';
  unitCount: number;
  extractedCharacters: number;
  reconstructionNotice: string;
}>;

export type LectureOverleafSourceCard = Readonly<{
  manuscriptId: string;
  title: string;
  rootDocument: string;
  providerRevision: string;
  observedAt: string;
}>;

export type LectureOverleafSourceDraft = Readonly<{
  title: string;
  rootDocument: string;
  remoteUrl: string;
}>;

export function formatLectureSourceBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Size unavailable';
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

export function lectureExternalSourceStatus(source: LectureExternalSourceCard) {
  if (!source.textAvailable) return 'Needs attention';
  return source.truncated ? 'Ready · excerpted' : 'Ready';
}

function LectureSourceTypeIcon({ kind }: { kind: LectureExternalSourceCard['kind'] }) {
  return (
    <span className={`lecture-external-source-type ${kind}`} aria-hidden="true">
      {kind === 'latex' ? 'TEX' : kind === 'markdown' ? 'MD' : 'PDF'}
    </span>
  );
}

export function LectureExternalSourcePicker({
  fileSources,
  overleafSources,
  busy,
  outputProjectName,
  overleafPersonalTokenState,
  onOpenOverleafSettings,
  onChooseFiles,
  onRemoveFile,
  onImportOverleaf,
  onRemoveOverleaf,
}: {
  fileSources: readonly LectureExternalSourceCard[];
  overleafSources: readonly LectureOverleafSourceCard[];
  busy: boolean;
  outputProjectName: string;
  overleafPersonalTokenState: OverleafPersonalTokenUiState;
  onOpenOverleafSettings: () => void;
  onChooseFiles: () => Promise<void>;
  onRemoveFile: (sourceId: string) => Promise<void>;
  onImportOverleaf: (draft: LectureOverleafSourceDraft) => Promise<boolean>;
  onRemoveOverleaf: (manuscriptId: string) => void;
}) {
  const [overleafOpen, setOverleafOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [rootDocument, setRootDocument] = useState('main.tex');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [addingFiles, setAddingFiles] = useState(false);
  const [addingOverleaf, setAddingOverleaf] = useState(false);
  const rootDocumentValid = ManuscriptRootDocumentSchema.safeParse(rootDocument.trim()).success;

  const resetOverleafDraft = () => {
    setTitle('');
    setRemoteUrl('');
    setRootDocument('main.tex');
  };

  const chooseFiles = async () => {
    if (busy || addingFiles) return;
    setAddingFiles(true);
    try {
      await onChooseFiles();
    } finally {
      setAddingFiles(false);
    }
  };

  const importOverleaf = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || addingOverleaf) return;
    setAddingOverleaf(true);
    try {
      const imported = await onImportOverleaf({
        title: title.trim() || 'Overleaf manuscript',
        rootDocument: rootDocument.trim(),
        remoteUrl: remoteUrl.trim(),
      });
      if (imported) {
        setTitle('');
        setRemoteUrl('');
        setRootDocument('main.tex');
        setOverleafOpen(false);
      }
    } finally {
      setAddingOverleaf(false);
    }
  };

  const hasSources = fileSources.length > 0 || overleafSources.length > 0;

  return (
    <section className="lecture-external-source-picker" aria-labelledby="lecture-add-sources-title">
      <header>
        <div>
          <h3 id="lecture-add-sources-title">Add your own sources</h3>
          <p>
            Add LaTeX (.tex), Markdown (.md), or PDF (.pdf), or capture an exact Overleaf Git
            checkpoint.
          </p>
        </div>
        <div className="lecture-external-source-actions">
          <button
            type="button"
            className="ghost-button"
            disabled={busy || addingFiles}
            onClick={() => void chooseFiles()}
          >
            <span aria-hidden="true">＋</span> {addingFiles ? 'Adding…' : 'Files'}
          </button>
          <button
            type="button"
            className="ghost-button"
            aria-expanded={overleafOpen}
            aria-controls="lecture-overleaf-source-form"
            disabled={busy}
            onClick={() =>
              setOverleafOpen((open) => {
                if (open) resetOverleafDraft();
                return !open;
              })
            }
          >
            <span aria-hidden="true">↗</span> Overleaf Git
          </button>
        </div>
      </header>

      {overleafOpen && overleafPersonalTokenState !== 'configured' && (
        <div id="lecture-overleaf-source-form" className="lecture-overleaf-source-form">
          <OverleafPersonalTokenNotice
            state={overleafPersonalTokenState}
            onOpenSettings={onOpenOverleafSettings}
          />
        </div>
      )}

      {overleafOpen && overleafPersonalTokenState === 'configured' && (
        <form
          id="lecture-overleaf-source-form"
          className="lecture-overleaf-source-form"
          onSubmit={(event) => void importOverleaf(event)}
        >
          <div className="lecture-overleaf-source-grid">
            <label>
              Source name
              <input
                value={title}
                maxLength={160}
                placeholder="Overleaf manuscript"
                disabled={busy || addingOverleaf}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              Root TeX file
              <input
                value={rootDocument}
                maxLength={512}
                placeholder="main.tex"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                disabled={busy || addingOverleaf}
                onChange={(event) => setRootDocument(event.target.value)}
              />
            </label>
            <label className="lecture-overleaf-url-field">
              Overleaf Git URL
              <input
                data-overleaf-token-focus-fallback
                value={remoteUrl}
                maxLength={2_048}
                placeholder="https://git.overleaf.com/PROJECT_ID"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                disabled={busy || addingOverleaf}
                onChange={(event) => setRemoteUrl(event.target.value)}
              />
            </label>
          </div>
          <footer>
            <small>
              Uses the token saved in Overleaf Settings. GOSU captures one exact Git checkpoint for{' '}
              {outputProjectName}.
            </small>
            <button
              type="submit"
              className="primary-button"
              disabled={
                busy ||
                addingOverleaf ||
                remoteUrl.trim() === '' ||
                rootDocument.trim() === '' ||
                !rootDocumentValid
              }
            >
              {addingOverleaf ? 'Capturing…' : 'Capture source'}
            </button>
          </footer>
        </form>
      )}

      {hasSources ? (
        <div className="lecture-external-source-cards" aria-label="Added sources">
          {fileSources.map((source) => (
            <article className="lecture-external-source-card" key={source.id}>
              <LectureSourceTypeIcon kind={source.kind} />
              <div>
                <strong title={source.displayName}>{source.displayName}</strong>
                <small>
                  {formatLectureSourceBytes(source.byteSize)} · {source.unitCount}{' '}
                  {source.unitLabel}
                  {source.unitCount === 1 ? '' : 's'} ·{' '}
                  {source.extractedCharacters.toLocaleString()} readable characters
                </small>
                <small title={source.reconstructionNotice}>{source.reconstructionNotice}</small>
              </div>
              <span
                className={`lecture-external-source-status${source.textAvailable ? ' ready' : ' attention'}`}
              >
                {lectureExternalSourceStatus(source)}
              </span>
              <button
                type="button"
                className="lecture-external-source-remove"
                aria-label={`Remove ${source.displayName}`}
                title="Remove from this lecture"
                disabled={busy}
                onClick={() => void onRemoveFile(source.id)}
              >
                ×
              </button>
            </article>
          ))}
          {overleafSources.map((source) => (
            <article className="lecture-external-source-card" key={source.manuscriptId}>
              <span className="lecture-external-source-type overleaf" aria-hidden="true">
                OL
              </span>
              <div>
                <strong title={source.title}>{source.title}</strong>
                <small title={source.rootDocument}>Root: {source.rootDocument}</small>
                <small>Exact Git checkpoint · {new Date(source.observedAt).toLocaleString()}</small>
              </div>
              <span className="lecture-external-source-status ready">Ready</span>
              <button
                type="button"
                className="lecture-external-source-remove"
                aria-label={`Remove ${source.title}`}
                title="Remove from this lecture"
                disabled={busy}
                onClick={() => onRemoveOverleaf(source.manuscriptId)}
              >
                ×
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="lecture-external-source-empty">
          Optional · added sources are frozen for this lecture and remain local.
        </p>
      )}
    </section>
  );
}
