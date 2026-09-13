import { uiText, useUiText } from '@gosu/ui/language';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ManuscriptRootDocumentSchema } from '@gosu/contracts';

import {
  MANUSCRIPT_LATEX_ENGINE_DISPLAY_NAMES,
  type ManuscriptLatexEngine,
  type ManuscriptPdfArtifactBinding,
  type ManuscriptPdfPreview as ManuscriptPdfPreviewValue,
  type ManuscriptRecord,
  type ManuscriptWorkspaceItem,
  type ManuscriptWorkspaceSnapshot,
} from '../../shared/manuscript-workspace-contracts';
import type { ProjectRecord } from '../../shared/workspace-contracts';
import {
  activeManuscriptBindingCheckpoint,
  deriveManuscriptProviderChange,
} from './manuscript-provider-change';
import { describeError } from './ui-primitives';
import { ManuscriptPdfPreview } from './manuscript-pdf-preview';
import { OverleafPersonalTokenNotice } from './overleaf-personal-token-notice';
import type { OverleafPersonalTokenUiState } from './overleaf-personal-token-ui';

const MANUSCRIPT_LATEX_ENGINE_OPTIONS = [
  { id: 'pdflatex', displayName: MANUSCRIPT_LATEX_ENGINE_DISPLAY_NAMES.pdflatex },
  { id: 'xelatex', displayName: MANUSCRIPT_LATEX_ENGINE_DISPLAY_NAMES.xelatex },
  { id: 'lualatex', displayName: MANUSCRIPT_LATEX_ENGINE_DISPLAY_NAMES.lualatex },
] as const satisfies readonly Readonly<{
  id: ManuscriptLatexEngine;
  displayName: string;
}>[];

function latexEngineDisplayName(engine: ManuscriptLatexEngine) {
  return (
    MANUSCRIPT_LATEX_ENGINE_OPTIONS.find((option) => option.id === engine)?.displayName ?? engine
  );
}

function shortRevision(revision: string | null) {
  return revision ? revision.slice(0, 12) : 'Not checked';
}

function syncLabel(state: NonNullable<ManuscriptWorkspaceItem['connection']>['syncState']) {
  return uiText(
    {
      unlinked: 'Not linked',
      checking: 'Checking provider',
      in_sync: 'Verified common checkpoint unchanged · not imported',
      provider_ahead: 'New provider revision observed',
      gosu_ahead: 'GOSU revision differs',
      diverged: 'Heads are unrelated or both changed',
      blocked: 'Blocked',
      failed: 'Connection failed',
    }[state],
  );
}

function providerEditingLabel(connection: NonNullable<ManuscriptWorkspaceItem['connection']>) {
  const modes = connection.binding.capabilitiesSnapshot.interactionModes;
  if (modes.includes('embedded_realtime_editor')) {
    return uiText(
      'Provider declares embedded realtime support; GOSU editor operations are pending.',
    );
  }
  if (modes.includes('external_realtime_editor')) {
    return uiText('Realtime editing: available only in the {providerDisplayName} workspace.', {
      providerDisplayName: connection.providerDisplayName,
    });
  }
  return uiText('Realtime editing: not available through GOSU.');
}

export function describeManuscriptOperationError(
  error: unknown,
  latexEngine?: ManuscriptLatexEngine,
) {
  const selectedEngine = latexEngine
    ? latexEngineDisplayName(latexEngine)
    : uiText('the selected local LaTeX engine');
  if (error instanceof Error) {
    const code = error.message.split(':', 1)[0];
    if (code === 'manuscript_pdf_compiler_unavailable') {
      return uiText(
        'PDF preview needs a local MacTeX installation with {selectedEngine}. Install MacTeX or repair the existing installation, then retry; the captured source remains available and unchanged.',
        { selectedEngine: selectedEngine },
      );
    }
    if (code === 'manuscript_pdf_compile_failed') {
      return uiText(
        '{selectedEngine} compilation failed. Confirm this local selection matches the Overleaf compiler setting, then check the root TeX document and captured dependencies before retrying.',
        { selectedEngine: selectedEngine },
      );
    }
    if (code === 'manuscript_pdf_too_large') {
      return uiText(
        'The compiled PDF exceeds the 32 MB local preview limit. Open or export the PDF in Overleaf instead.',
      );
    }
    if (code === 'manuscript_pdf_invalid') {
      return uiText(
        '{selectedEngine} did not produce a valid PDF. Check the root document and captured LaTeX source, then retry.',
        { selectedEngine: selectedEngine },
      );
    }
    if (code === 'manuscript_checkpoint_not_found') {
      return uiText(
        'This captured checkpoint is no longer available. Check Overleaf changes and capture a new inbound checkpoint.',
      );
    }
    if (code === 'manuscript_pdf_cache_failed') {
      return uiText(
        'The compiled PDF could not be retained in GOSU’s protected local cache. Check available disk space and retry the compile.',
      );
    }
    if (code === 'manuscript_pdf_artifact_not_found') {
      return uiText(
        'This compiled PDF is no longer in the protected local cache. Compile it again before exporting or opening it.',
      );
    }
    if (code === 'manuscript_pdf_export_failed') {
      return uiText(
        'The PDF could not be exported to the selected location. Choose another local folder and retry.',
      );
    }
    if (code === 'manuscript_pdf_open_failed') {
      return uiText('The compiled PDF could not be opened in the system default PDF app.');
    }
  }
  return describeError(error);
}

export function validManuscriptRootDocument(path: string) {
  return ManuscriptRootDocumentSchema.safeParse(path).success;
}

export function suggestedManuscriptTitle(existingCount: number) {
  return existingCount === 0 ? 'Main manuscript' : `Main manuscript ${existingCount + 1}`;
}

export function manuscriptPdfArtifactBinding(
  preview: ManuscriptPdfPreviewValue,
): ManuscriptPdfArtifactBinding {
  return {
    projectId: preview.projectId,
    manuscriptId: preview.manuscriptId,
    checkpointId: preview.checkpointId,
    artifactId: preview.artifactId,
    pdfSha256: preview.pdfSha256,
  };
}

function OverleafConnectForm({
  busy,
  connecting,
  tokenState,
  onOpenOverleafSettings,
  onConnect,
}: {
  busy: boolean;
  connecting: boolean;
  tokenState: OverleafPersonalTokenUiState;
  onOpenOverleafSettings: () => void;
  onConnect(remoteUrl: string): Promise<void>;
}) {
  useUiText();
  const [remoteUrl, setRemoteUrl] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (tokenState !== 'configured') return;
    void onConnect(remoteUrl);
  };

  if (tokenState !== 'configured') {
    return (
      <OverleafPersonalTokenNotice state={tokenState} onOpenSettings={onOpenOverleafSettings} />
    );
  }

  return (
    <form className="manuscript-connect-form" onSubmit={submit}>
      <div className="manuscript-form-grid">
        <label>
          {uiText('Overleaf Git URL')}
          <input
            data-overleaf-token-focus-fallback
            value={remoteUrl}
            onChange={(event) => setRemoteUrl(event.target.value)}
            placeholder={uiText('https://git.overleaf.com/PROJECT_ID')}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            disabled={busy}
          />
        </label>
      </div>
      <div className="manuscript-actions">
        <button type="submit" className="primary-button" disabled={busy || remoteUrl.trim() === ''}>
          {connecting ? uiText('Connecting…') : uiText('Connect Overleaf Git')}
        </button>
        <span>
          {uiText(
            'Uses the token saved in Overleaf Settings. Captures inbound Git checkpoints only; realtime editing stays in the provider workspace when available.',
          )}
        </span>
      </div>
    </form>
  );
}

function ManuscriptEditForm({
  manuscript,
  busy,
  updating,
  onUpdate,
}: {
  manuscript: ManuscriptRecord;
  busy: boolean;
  updating: boolean;
  onUpdate(title: string, rootDocument: string): Promise<void>;
}) {
  useUiText();
  const [title, setTitle] = useState(manuscript.title);
  const [rootDocument, setRootDocument] = useState(manuscript.rootDocument);

  return (
    <details className="manuscript-edit-panel">
      <summary>{uiText('Edit manuscript name or root document')}</summary>
      <form
        className="manuscript-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onUpdate(title, rootDocument);
        }}
      >
        <div className="manuscript-form-grid">
          <label>
            {uiText('Manuscript name')}
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            {uiText('Root TeX document')}
            <input
              value={rootDocument}
              onChange={(event) => setRootDocument(event.target.value)}
              placeholder={uiText('main.tex')}
              disabled={busy}
            />
          </label>
        </div>
        <div className="manuscript-actions">
          <button
            type="submit"
            className="secondary-button"
            disabled={busy || title.trim() === '' || !validManuscriptRootDocument(rootDocument)}
          >
            {updating ? uiText('Saving…') : uiText('Save manuscript details')}
          </button>
          <span>
            {uiText(
              'The corrected root applies to future captures. Existing checkpoint receipts stay immutable.',
            )}
          </span>
        </div>
      </form>
    </details>
  );
}

export function ManuscriptView({
  project,
  overleafPersonalTokenState = 'loading',
  onOpenOverleafSettings = () => undefined,
}: {
  project: ProjectRecord;
  overleafPersonalTokenState?: OverleafPersonalTokenUiState;
  onOpenOverleafSettings?: () => void;
}) {
  useUiText();
  const [snapshot, setSnapshot] = useState<ManuscriptWorkspaceSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('Main manuscript');
  const [rootDocument, setRootDocument] = useState('main.tex');
  const [failedChecks, setFailedChecks] = useState<Record<string, true>>({});
  const [pdfPreviews, setPdfPreviews] = useState<Record<string, ManuscriptPdfPreviewValue>>({});
  const [pdfArtifactStatuses, setPdfArtifactStatuses] = useState<Record<string, string>>({});
  const [latexEngines, setLatexEngines] = useState<Record<string, ManuscriptLatexEngine>>({});
  const requestGeneration = useRef(0);
  const manuscriptCount = snapshot?.manuscripts.length;

  const load = async () => {
    const generation = ++requestGeneration.current;
    setError(null);
    try {
      const next = await window.gosu.manuscriptWorkspace.list(project.id);
      if (generation === requestGeneration.current) setSnapshot(next);
    } catch (loadError) {
      if (generation === requestGeneration.current) setError(describeError(loadError));
    }
  };

  useEffect(() => {
    requestGeneration.current += 1;
    setSnapshot(null);
    setBusy(null);
    setFailedChecks({});
    setPdfPreviews({});
    setPdfArtifactStatuses({});
    setLatexEngines({});
    setTitle('Main manuscript');
    setRootDocument('main.tex');
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [project.id]);

  useEffect(() => {
    if (manuscriptCount !== undefined) setTitle(suggestedManuscriptTitle(manuscriptCount));
  }, [manuscriptCount, project.id]);

  const run = async (key: string, operation: () => Promise<ManuscriptWorkspaceSnapshot>) => {
    if (busy) return;
    const generation = ++requestGeneration.current;
    setBusy(key);
    setError(null);
    try {
      const next = await operation();
      if (generation === requestGeneration.current) {
        setSnapshot(next);
        setPdfPreviews({});
        setPdfArtifactStatuses({});
      }
    } catch (operationError) {
      if (generation === requestGeneration.current) setError(describeError(operationError));
    } finally {
      if (generation === requestGeneration.current) setBusy(null);
    }
  };

  const runPdfArtifactAction = async (
    preview: ManuscriptPdfPreviewValue,
    action: 'export' | 'open' | 'reveal',
  ) => {
    if (busy) return;
    const generation = ++requestGeneration.current;
    setBusy(`pdf-${action}:${preview.manuscriptId}`);
    setError(null);
    try {
      const binding = manuscriptPdfArtifactBinding(preview);
      const receipt =
        action === 'export'
          ? await window.gosu.manuscriptWorkspace.exportPdf(binding)
          : action === 'open'
            ? await window.gosu.manuscriptWorkspace.openPdf(binding)
            : await window.gosu.manuscriptWorkspace.revealPdf(binding);
      if (generation === requestGeneration.current) {
        const status =
          receipt.status === 'cancelled'
            ? 'Export cancelled.'
            : receipt.status === 'exported'
              ? `Exported ${receipt.fileName ?? 'PDF'}.`
              : receipt.status === 'opened'
                ? 'Opened in the default PDF app.'
                : 'Shown in Finder.';
        setPdfArtifactStatuses((current) => ({
          ...current,
          [preview.manuscriptId]: status,
        }));
      }
    } catch (actionError) {
      if (generation === requestGeneration.current) {
        setError(describeManuscriptOperationError(actionError));
      }
    } finally {
      if (generation === requestGeneration.current) setBusy(null);
    }
  };

  const compilePdf = async (
    manuscriptId: string,
    checkpointId: string,
    engine: ManuscriptLatexEngine,
  ) => {
    if (busy) return;
    const generation = ++requestGeneration.current;
    setBusy(`compile:${manuscriptId}`);
    setError(null);
    try {
      const preview = await window.gosu.manuscriptWorkspace.compilePdf({
        projectId: project.id,
        manuscriptId,
        checkpointId,
        engine,
      });
      if (generation === requestGeneration.current) {
        // Keep one bounded PDF document resident at a time. A project can own
        // many manuscripts, and each preview may carry up to 32 MiB of bytes.
        setPdfPreviews({ [manuscriptId]: preview });
        setPdfArtifactStatuses({});
      }
    } catch (compileError) {
      if (generation === requestGeneration.current) {
        setError(describeManuscriptOperationError(compileError, engine));
      }
    } finally {
      if (generation === requestGeneration.current) setBusy(null);
    }
  };

  const checkOverleafChanges = async (
    manuscriptId: string,
    bindingId: string,
    operation: () => Promise<ManuscriptWorkspaceSnapshot>,
  ) => {
    if (busy) return;
    const key = `inspect:${manuscriptId}`;
    const generation = ++requestGeneration.current;
    setBusy(key);
    setError(null);
    try {
      const next = await operation();
      if (generation === requestGeneration.current) {
        setSnapshot(next);
        setPdfPreviews((current) => {
          if (!current[manuscriptId]) return current;
          const nextPreviews = { ...current };
          delete nextPreviews[manuscriptId];
          return nextPreviews;
        });
        setPdfArtifactStatuses((current) => {
          if (!current[manuscriptId]) return current;
          const nextStatuses = { ...current };
          delete nextStatuses[manuscriptId];
          return nextStatuses;
        });
        setFailedChecks((current) => {
          if (!current[bindingId]) return current;
          const nextChecks = { ...current };
          delete nextChecks[bindingId];
          return nextChecks;
        });
      }
    } catch (operationError) {
      if (generation === requestGeneration.current) {
        setFailedChecks((current) => ({ ...current, [bindingId]: true }));
        setError(
          uiText(
            "Couldn't check Overleaf. Previous result may be stale. No remote files were changed. {value1}",
            { value1: describeError(operationError) },
          ),
        );
      }
    } finally {
      if (generation === requestGeneration.current) setBusy(null);
    }
  };

  return (
    <section className="manuscript-workspace">
      <header className="manuscript-compact-heading">
        <div>
          <span className="eyebrow">
            {project.name} {uiText('/ Manuscript')}
          </span>
          <h1>{uiText('Manuscript workspaces')}</h1>
          <p>
            {uiText(
              'Link Overleaf, capture an exact source checkpoint, then read or compile it locally.',
            )}
          </p>
        </div>
        <span className="manuscript-engine-pill">
          {uiText('Checkpoint source · local PDF preview')}
        </span>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="ghost-button" onClick={() => void load()}>
            {uiText('Retry')}
          </button>
        </div>
      )}

      <article className="card manuscript-boundary-card">
        <strong>{uiText('Safe collaboration boundary')}</strong>
        <span>
          {uiText(
            'A capture stores one immutable provider revision. Project Chat can read only that captured source, and the PDF preview compiles only that revision on this Mac. Neither action edits Overleaf, merges changes, or reads unsaved live edits.',
          )}
        </span>
      </article>

      <form
        className="card manuscript-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run('create', () =>
            window.gosu.manuscriptWorkspace.create({
              projectId: project.id,
              title,
              rootDocument,
            }),
          );
        }}
      >
        <label>
          {uiText('Manuscript name')}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={Boolean(busy)}
          />
        </label>
        <label>
          {uiText('Root TeX document')}
          <input
            value={rootDocument}
            onChange={(event) => setRootDocument(event.target.value)}
            placeholder={uiText('main.tex')}
            disabled={Boolean(busy)}
          />
        </label>
        <button
          className="secondary-button"
          type="submit"
          disabled={
            Boolean(busy) || title.trim() === '' || !validManuscriptRootDocument(rootDocument)
          }
        >
          {busy === 'create' ? uiText('Adding…') : uiText('＋ Add manuscript')}
        </button>
      </form>

      <div className="manuscript-list">
        {!snapshot && !error ? (
          <article className="card manuscript-load-state" role="status">
            {uiText('Loading manuscript workspaces…')}
          </article>
        ) : !snapshot ? (
          <article className="card manuscript-load-state">
            {uiText(
              'Manuscripts were not replaced. Use Retry above when the local workspace is available.',
            )}
          </article>
        ) : snapshot.manuscripts.length === 0 ? (
          <article className="card empty-state">
            {uiText('Add the first manuscript, then connect its Overleaf Git URL.')}
          </article>
        ) : (
          snapshot.manuscripts.map((item) => {
            const { manuscript, connection } = item;
            const activeCheckpoint = connection
              ? activeManuscriptBindingCheckpoint(connection)
              : null;
            const providerChange = connection
              ? deriveManuscriptProviderChange(
                  connection,
                  Boolean(failedChecks[connection.binding.bindingId]),
                )
              : null;
            const pdfPreview = pdfPreviews[manuscript.id];
            const latexEngine = latexEngines[manuscript.id] ?? 'pdflatex';
            return (
              <article className="card manuscript-item" key={manuscript.id}>
                <div className="manuscript-item-head">
                  <div>
                    <span className="eyebrow">{manuscript.rootDocument}</span>
                    <h2>{manuscript.title}</h2>
                  </div>
                  <span
                    className={`manuscript-sync-state state-${connection?.syncState ?? 'unlinked'}`}
                  >
                    {connection ? syncLabel(connection.syncState) : uiText('Not connected')}
                  </span>
                </div>

                <ManuscriptEditForm
                  manuscript={manuscript}
                  busy={Boolean(busy)}
                  updating={busy === `update:${manuscript.id}`}
                  onUpdate={(nextTitle, nextRootDocument) =>
                    run(`update:${manuscript.id}`, () =>
                      window.gosu.manuscriptWorkspace.update({
                        projectId: project.id,
                        manuscriptId: manuscript.id,
                        expectedVersion: manuscript.version,
                        title: nextTitle,
                        rootDocument: nextRootDocument,
                      }),
                    )
                  }
                />

                {!connection ? (
                  <>
                    <OverleafConnectForm
                      busy={Boolean(busy)}
                      connecting={busy === `connect:${manuscript.id}`}
                      tokenState={overleafPersonalTokenState}
                      onOpenOverleafSettings={onOpenOverleafSettings}
                      onConnect={(remoteUrl) =>
                        run(`connect:${manuscript.id}`, () =>
                          window.gosu.manuscriptWorkspace.connectOverleafGit({
                            projectId: project.id,
                            manuscriptId: manuscript.id,
                            expectedManuscriptVersion: manuscript.version,
                            providerId: 'overleaf_git',
                            remoteUrl,
                          }),
                        )
                      }
                    />
                    {item.canDeleteUnconfigured === true && (
                      <div className="manuscript-actions">
                        <button
                          type="button"
                          className="danger-button"
                          disabled={Boolean(busy)}
                          onClick={() => {
                            const confirmed = window.confirm(
                              uiText(
                                'Remove “{title}”? This deletes only this unused local setup record. It cannot be undone.',
                                { title: manuscript.title },
                              ),
                            );
                            if (!confirmed) return;
                            void run(`delete:${manuscript.id}`, () =>
                              window.gosu.manuscriptWorkspace.deleteUnconfigured({
                                projectId: project.id,
                                manuscriptId: manuscript.id,
                                expectedVersion: manuscript.version,
                              }),
                            );
                          }}
                        >
                          {busy === `delete:${manuscript.id}`
                            ? uiText('Removing…')
                            : uiText('Remove unused manuscript')}
                        </button>
                        <span>
                          {uiText(
                            'Available only before this manuscript has ever been connected or captured.',
                          )}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="manuscript-status-grid">
                      <div>
                        <small>{uiText('Engine')}</small>
                        <strong>{connection.providerDisplayName}</strong>
                      </div>
                      <div>
                        <small>{uiText('Provider revision observed')}</small>
                        <strong>{shortRevision(connection.lastObservedProviderRevision)}</strong>
                      </div>
                      <div>
                        <small>{uiText('Current binding checkpoint')}</small>
                        <strong>{shortRevision(activeCheckpoint?.providerRevision ?? null)}</strong>
                      </div>
                      <div>
                        <small>{uiText('Authority')}</small>
                        <strong>
                          {connection.binding.authority === 'provider'
                            ? uiText('Provider authority')
                            : uiText('GOSU draft authority')}
                        </strong>
                      </div>
                    </div>
                    <p className="manuscript-capability-note">
                      {providerEditingLabel(connection)}{' '}
                      {uiText(
                        'Once captured, Project Chat can request the exact checkpoint read-only, and this tab can request a local PDF compile. Each operation checks the local mirror and required MacTeX sandbox when used.',
                      )}
                    </p>
                    {providerChange && (
                      <div
                        className={`manuscript-provider-change state-${providerChange.state}`}
                        role="status"
                        aria-live="polite"
                      >
                        <div>
                          <small>{uiText('Overleaf change check')}</small>
                          <strong>{providerChange.title}</strong>
                        </div>
                        <span>{providerChange.detail}</span>
                        <small>
                          {connection.lastObservedAt
                            ? uiText('Last provider check: {value1}', {
                                value1: new Date(connection.lastObservedAt).toLocaleString(),
                              })
                            : uiText('Last provider check: Never')}
                        </small>
                      </div>
                    )}
                    {connection.lastFailureCode && (
                      <p className="manuscript-connection-warning">
                        {describeError(new Error(connection.lastFailureCode))}
                      </p>
                    )}
                    <div className="manuscript-actions">
                      {connection.workspaceUrl && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => void window.gosu.openExternal(connection.workspaceUrl!)}
                        >
                          {uiText('Open workspace')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={Boolean(busy)}
                        aria-busy={busy === `inspect:${manuscript.id}`}
                        onClick={() =>
                          void checkOverleafChanges(
                            manuscript.id,
                            connection.binding.bindingId,
                            () =>
                              window.gosu.manuscriptWorkspace.inspect({
                                projectId: project.id,
                                manuscriptId: manuscript.id,
                                bindingId: connection.binding.bindingId,
                                expectedBindingVersion: connection.binding.version,
                              }),
                          )
                        }
                      >
                        {busy === `inspect:${manuscript.id}`
                          ? uiText('Checking Overleaf…')
                          : uiText('Check Overleaf changes')}
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={Boolean(busy) || !connection.lastObservedProviderRevision}
                        title={
                          connection.lastObservedProviderRevision
                            ? undefined
                            : uiText(
                                'Check the provider revision before capturing an inbound checkpoint.',
                              )
                        }
                        onClick={() =>
                          void run(`fetch:${manuscript.id}`, () =>
                            window.gosu.manuscriptWorkspace.fetchCheckpoint({
                              projectId: project.id,
                              manuscriptId: manuscript.id,
                              bindingId: connection.binding.bindingId,
                              expectedBindingVersion: connection.binding.version,
                              expectedProviderRevision: connection.lastObservedProviderRevision,
                            }),
                          )
                        }
                      >
                        {busy === `fetch:${manuscript.id}`
                          ? uiText('Capturing…')
                          : uiText('Capture inbound checkpoint')}
                      </button>
                      <label className="manuscript-local-engine-selector">
                        <span>{uiText('Local PDF engine · not read from Overleaf')}</span>
                        <select
                          aria-label={uiText('Local PDF engine for {title}', {
                            title: manuscript.title,
                          })}
                          value={latexEngine}
                          disabled={Boolean(busy)}
                          onChange={(event) =>
                            setLatexEngines((current) => ({
                              ...current,
                              [manuscript.id]: event.target.value as ManuscriptLatexEngine,
                            }))
                          }
                        >
                          {MANUSCRIPT_LATEX_ENGINE_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={Boolean(busy) || !activeCheckpoint}
                        title={
                          activeCheckpoint
                            ? uiText(
                                'Compile the exact captured checkpoint locally with {value1}. This choice is not read from Overleaf.',
                                { value1: latexEngineDisplayName(latexEngine) },
                              )
                            : uiText('Capture an inbound checkpoint before compiling a PDF.')
                        }
                        onClick={() =>
                          activeCheckpoint
                            ? void compilePdf(
                                manuscript.id,
                                activeCheckpoint.checkpointId,
                                latexEngine,
                              )
                            : undefined
                        }
                      >
                        {busy === `compile:${manuscript.id}`
                          ? uiText('Compiling PDF…')
                          : uiText('Compile & preview PDF')}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void run(`disconnect:${manuscript.id}`, () =>
                            window.gosu.manuscriptWorkspace.disconnect({
                              projectId: project.id,
                              manuscriptId: manuscript.id,
                              bindingId: connection.binding.bindingId,
                              expectedBindingVersion: connection.binding.version,
                            }),
                          )
                        }
                      >
                        {busy === `disconnect:${manuscript.id}`
                          ? uiText('Disconnecting…')
                          : uiText('Disconnect')}
                      </button>
                    </div>
                    {pdfPreview && (
                      <ManuscriptPdfPreview
                        preview={pdfPreview}
                        artifactActions={{
                          busy: Boolean(busy),
                          status: pdfArtifactStatuses[manuscript.id] ?? null,
                          onExport: () => void runPdfArtifactAction(pdfPreview, 'export'),
                          onOpen: () => void runPdfArtifactAction(pdfPreview, 'open'),
                          onReveal: () => void runPdfArtifactAction(pdfPreview, 'reveal'),
                        }}
                      />
                    )}
                  </>
                )}
              </article>
            );
          })
        )}
      </div>

      <article className="card manuscript-future-engines">
        <div>
          <strong>{uiText('Future engines')}</strong>
          <span>
            {uiText(
              'The checkpoint core is portable for GOSU Local LaTeX and GOSU Cloud Collaboration. Native editor onboarding, artifact import, realtime, and migration ports are still pending.',
            )}
          </span>
        </div>
        <span className="manuscript-engine-pill muted">{uiText('Checkpoint core ready')}</span>
      </article>
    </section>
  );
}
