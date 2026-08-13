import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ManuscriptRootDocumentSchema } from '@gosu/contracts';

import {
  MANUSCRIPT_LATEX_ENGINE_DISPLAY_NAMES,
  type ManuscriptLatexEngine,
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
  return {
    unlinked: 'Not linked',
    checking: 'Checking provider',
    in_sync: 'Verified common checkpoint unchanged · not imported',
    provider_ahead: 'New provider revision observed',
    gosu_ahead: 'GOSU revision differs',
    diverged: 'Heads are unrelated or both changed',
    blocked: 'Blocked',
    failed: 'Connection failed',
  }[state];
}

function providerEditingLabel(connection: NonNullable<ManuscriptWorkspaceItem['connection']>) {
  const modes = connection.binding.capabilitiesSnapshot.interactionModes;
  if (modes.includes('embedded_realtime_editor')) {
    return 'Provider declares embedded realtime support; GOSU editor operations are pending.';
  }
  if (modes.includes('external_realtime_editor')) {
    return `Realtime editing: available only in the ${connection.providerDisplayName} workspace.`;
  }
  return 'Realtime editing: not available through GOSU.';
}

export function describeManuscriptOperationError(
  error: unknown,
  latexEngine?: ManuscriptLatexEngine,
) {
  const selectedEngine = latexEngine
    ? latexEngineDisplayName(latexEngine)
    : 'the selected local LaTeX engine';
  if (error instanceof Error) {
    const code = error.message.split(':', 1)[0];
    if (code === 'manuscript_pdf_compiler_unavailable') {
      return `PDF preview needs a local MacTeX installation with ${selectedEngine}. Install MacTeX or repair the existing installation, then retry; the captured source remains available and unchanged.`;
    }
    if (code === 'manuscript_pdf_compile_failed') {
      return `${selectedEngine} compilation failed. Confirm this local selection matches the Overleaf compiler setting, then check the root TeX document and captured dependencies before retrying.`;
    }
    if (code === 'manuscript_pdf_too_large') {
      return 'The compiled PDF exceeds the 32 MB local preview limit. Open or export the PDF in Overleaf instead.';
    }
    if (code === 'manuscript_pdf_invalid') {
      return `${selectedEngine} did not produce a valid PDF. Check the root document and captured LaTeX source, then retry.`;
    }
    if (code === 'manuscript_checkpoint_not_found') {
      return 'This captured checkpoint is no longer available. Check Overleaf changes and capture a new inbound checkpoint.';
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

function OverleafConnectForm({
  busy,
  connecting,
  onConnect,
}: {
  busy: boolean;
  connecting: boolean;
  onConnect(remoteUrl: string, accessToken: string): Promise<void>;
}) {
  const [remoteUrl, setRemoteUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onConnect(remoteUrl, accessToken).then(() => {
      setAccessToken('');
    });
  };

  return (
    <form className="manuscript-connect-form" onSubmit={submit}>
      <div className="manuscript-form-grid">
        <label>
          Overleaf Git URL
          <input
            value={remoteUrl}
            onChange={(event) => setRemoteUrl(event.target.value)}
            placeholder="https://git.overleaf.com/PROJECT_ID"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            disabled={busy}
          />
        </label>
        <label>
          Personal Git token
          <input
            type="password"
            value={accessToken}
            onChange={(event) => setAccessToken(event.target.value)}
            placeholder="Saved to macOS Keychain"
            autoComplete="off"
            required
            disabled={busy}
          />
        </label>
      </div>
      <div className="manuscript-actions">
        <button
          type="submit"
          className="primary-button"
          disabled={busy || remoteUrl.trim() === '' || accessToken === ''}
        >
          {connecting ? 'Connecting…' : 'Connect Overleaf Git'}
        </button>
        <span>
          Captures inbound Git checkpoints only. Realtime editing stays in the provider workspace
          when the adapter advertises it.
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
  const [title, setTitle] = useState(manuscript.title);
  const [rootDocument, setRootDocument] = useState(manuscript.rootDocument);

  return (
    <details className="manuscript-edit-panel">
      <summary>Edit manuscript name or root document</summary>
      <form
        className="manuscript-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onUpdate(title, rootDocument);
        }}
      >
        <div className="manuscript-form-grid">
          <label>
            Manuscript name
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Root TeX document
            <input
              value={rootDocument}
              onChange={(event) => setRootDocument(event.target.value)}
              placeholder="main.tex"
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
            {updating ? 'Saving…' : 'Save manuscript details'}
          </button>
          <span>
            The corrected root applies to future captures. Existing checkpoint receipts stay
            immutable.
          </span>
        </div>
      </form>
    </details>
  );
}

export function ManuscriptView({ project }: { project: ProjectRecord }) {
  const [snapshot, setSnapshot] = useState<ManuscriptWorkspaceSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('Main manuscript');
  const [rootDocument, setRootDocument] = useState('main.tex');
  const [failedChecks, setFailedChecks] = useState<Record<string, true>>({});
  const [pdfPreviews, setPdfPreviews] = useState<Record<string, ManuscriptPdfPreviewValue>>({});
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
      }
    } catch (operationError) {
      if (generation === requestGeneration.current) setError(describeError(operationError));
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
          `Couldn't check Overleaf. Previous result may be stale. No remote files were changed. ${describeError(operationError)}`,
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
          <span className="eyebrow">{project.name} / Manuscript</span>
          <h1>Manuscript workspaces</h1>
          <p>Link Overleaf, capture an exact source checkpoint, then read or compile it locally.</p>
        </div>
        <span className="manuscript-engine-pill">Checkpoint source · local PDF preview</span>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="ghost-button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      <article className="card manuscript-boundary-card">
        <strong>Safe collaboration boundary</strong>
        <span>
          A capture stores one immutable provider revision. Project Chat can read only that captured
          source, and the PDF preview compiles only that revision on this Mac. Neither action edits
          Overleaf, merges changes, or reads unsaved live edits.
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
          Manuscript name
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={Boolean(busy)}
          />
        </label>
        <label>
          Root TeX document
          <input
            value={rootDocument}
            onChange={(event) => setRootDocument(event.target.value)}
            placeholder="main.tex"
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
          {busy === 'create' ? 'Adding…' : '＋ Add manuscript'}
        </button>
      </form>

      <div className="manuscript-list">
        {!snapshot && !error ? (
          <article className="card manuscript-load-state" role="status">
            Loading manuscript workspaces…
          </article>
        ) : !snapshot ? (
          <article className="card manuscript-load-state">
            Manuscripts were not replaced. Use Retry above when the local workspace is available.
          </article>
        ) : snapshot.manuscripts.length === 0 ? (
          <article className="card empty-state">
            Add the first manuscript, then connect its Overleaf Git URL.
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
                    {connection ? syncLabel(connection.syncState) : 'Not connected'}
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
                      onConnect={(remoteUrl, accessToken) =>
                        run(`connect:${manuscript.id}`, () =>
                          window.gosu.manuscriptWorkspace.connectOverleafGit({
                            projectId: project.id,
                            manuscriptId: manuscript.id,
                            expectedManuscriptVersion: manuscript.version,
                            providerId: 'overleaf_git',
                            remoteUrl,
                            accessToken,
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
                              `Remove “${manuscript.title}”? This deletes only this unused local setup record. It cannot be undone.`,
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
                            ? 'Removing…'
                            : 'Remove unused manuscript'}
                        </button>
                        <span>
                          Available only before this manuscript has ever been connected or captured.
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="manuscript-status-grid">
                      <div>
                        <small>Engine</small>
                        <strong>{connection.providerDisplayName}</strong>
                      </div>
                      <div>
                        <small>Provider revision observed</small>
                        <strong>{shortRevision(connection.lastObservedProviderRevision)}</strong>
                      </div>
                      <div>
                        <small>Current binding checkpoint</small>
                        <strong>{shortRevision(activeCheckpoint?.providerRevision ?? null)}</strong>
                      </div>
                      <div>
                        <small>Authority</small>
                        <strong>
                          {connection.binding.authority === 'provider'
                            ? 'Provider authority'
                            : 'GOSU draft authority'}
                        </strong>
                      </div>
                    </div>
                    <p className="manuscript-capability-note">
                      {providerEditingLabel(connection)} Once captured, Project Chat can request the
                      exact checkpoint read-only, and this tab can request a local PDF compile. Each
                      operation checks the local mirror and required MacTeX sandbox when used.
                    </p>
                    {providerChange && (
                      <div
                        className={`manuscript-provider-change state-${providerChange.state}`}
                        role="status"
                        aria-live="polite"
                      >
                        <div>
                          <small>Overleaf change check</small>
                          <strong>{providerChange.title}</strong>
                        </div>
                        <span>{providerChange.detail}</span>
                        <small>
                          {connection.lastObservedAt
                            ? `Last provider check: ${new Date(connection.lastObservedAt).toLocaleString()}`
                            : 'Last provider check: Never'}
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
                          Open workspace
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
                          ? 'Checking Overleaf…'
                          : 'Check Overleaf changes'}
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={Boolean(busy) || !connection.lastObservedProviderRevision}
                        title={
                          connection.lastObservedProviderRevision
                            ? undefined
                            : 'Check the provider revision before capturing an inbound checkpoint.'
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
                          ? 'Capturing…'
                          : 'Capture inbound checkpoint'}
                      </button>
                      <label className="manuscript-local-engine-selector">
                        <span>Local PDF engine · not read from Overleaf</span>
                        <select
                          aria-label={`Local PDF engine for ${manuscript.title}`}
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
                            ? `Compile the exact captured checkpoint locally with ${latexEngineDisplayName(latexEngine)}. This choice is not read from Overleaf.`
                            : 'Capture an inbound checkpoint before compiling a PDF.'
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
                          ? 'Compiling PDF…'
                          : 'Compile & preview PDF'}
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
                        {busy === `disconnect:${manuscript.id}` ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    </div>
                    {pdfPreview && <ManuscriptPdfPreview preview={pdfPreview} />}
                  </>
                )}
              </article>
            );
          })
        )}
      </div>

      <article className="card manuscript-future-engines">
        <div>
          <strong>Future engines</strong>
          <span>
            The checkpoint core is portable for GOSU Local LaTeX and GOSU Cloud Collaboration.
            Native editor onboarding, artifact import, realtime, and migration ports are still
            pending.
          </span>
        </div>
        <span className="manuscript-engine-pill muted">Checkpoint core ready</span>
      </article>
    </section>
  );
}
