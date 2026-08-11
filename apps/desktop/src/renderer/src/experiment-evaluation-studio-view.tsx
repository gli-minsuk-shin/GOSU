import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import type {
  ApproveExperimentEvaluationInput,
  CreateExperimentEvaluationSessionInput,
  ExperimentEvaluationApprovalReceipt,
  ExperimentEvaluationDetailInput,
  ExperimentEvaluationEvent,
  ExperimentEvaluationListSnapshot,
  ExperimentEvaluationProfile,
  ExperimentEvaluationSession,
  ExperimentEvaluationSessionDetail,
  ExperimentEvaluationTurnReceipt,
  ListExperimentEvaluationsInput,
  ReuseExperimentEvaluationProfileInput,
  SendExperimentEvaluationMessageInput,
} from '../../shared/experiment-evaluation-contracts';
import type {
  ExperimentLoggingCustomField,
  ExperimentLoggingTemplate,
} from '../../shared/experiment-workspace-contracts';
import { ExperimentEvaluationPreview } from './experiment-evaluation-preview';
import {
  buildEvaluationLoggingReview,
  currentEvaluationDetail,
  currentEvaluationSnapshot,
  isCurrentEvaluationOperation,
  isCurrentEvaluationRequest,
} from './experiment-evaluation-studio-model';
import './experiment-evaluation-studio-view.css';

export interface ExperimentEvaluationStudioAdapter {
  list: (input: ListExperimentEvaluationsInput) => Promise<ExperimentEvaluationListSnapshot>;
  detail: (input: ExperimentEvaluationDetailInput) => Promise<ExperimentEvaluationSessionDetail>;
  createSession: (
    input: CreateExperimentEvaluationSessionInput,
  ) => Promise<ExperimentEvaluationSession>;
  send: (input: SendExperimentEvaluationMessageInput) => Promise<ExperimentEvaluationTurnReceipt>;
  approve: (
    input: ApproveExperimentEvaluationInput,
  ) => Promise<ExperimentEvaluationApprovalReceipt>;
  reuseProfile: (
    input: ReuseExperimentEvaluationProfileInput,
  ) => Promise<ExperimentEvaluationSessionDetail>;
  onEvent: (listener: (event: ExperimentEvaluationEvent) => void) => () => void;
}

export interface ExperimentEvaluationStudioViewProps {
  projectId: string;
  loggingTemplate: ExperimentLoggingTemplate;
  adapter: ExperimentEvaluationStudioAdapter;
  requestedModelId: string | null;
  reasoningOptionId: string | null;
  onApplyLoggingFields: (fields: readonly ExperimentLoggingCustomField[]) => Promise<boolean>;
  onOpenObjective: () => void;
}

type RailMode = 'sessions' | 'recipes';

function errorMessage(error: unknown) {
  const code = error instanceof Error ? (error.message.split(':')[0] ?? '') : '';
  const messages: Record<string, string> = {
    invalid_experiment_evaluation_input: 'Review the evaluation request and try again.',
    experiment_evaluation_project_not_found: 'This project no longer exists.',
    experiment_evaluation_project_unavailable: 'Restore this project before changing evaluations.',
    experiment_evaluation_session_not_found: 'This evaluation session no longer exists.',
    experiment_evaluation_profile_not_found: 'This saved recipe is no longer available.',
    experiment_evaluation_version_conflict:
      'This evaluation changed in another action. GOSU did not overwrite it.',
    experiment_evaluation_busy: 'This evaluation session is already generating a draft.',
    experiment_evaluation_codex_unavailable:
      'Codex could not produce this draft. Existing evaluation settings remain unchanged.',
    experiment_evaluation_invalid_response:
      'The generated draft failed the evaluation safety or structure checks.',
    experiment_evaluation_revision_not_found: 'The selected evaluation revision is unavailable.',
    experiment_evaluation_revision_conflict:
      'A newer evaluation draft exists. Review it before saving a recipe.',
    experiment_evaluation_capacity_reached:
      'This project reached its local Evaluation Studio history limit.',
    experiment_evaluation_artifact_failed:
      'GOSU could not safely save the evaluator code and prompt. No recipe was activated.',
  };
  return messages[code] ?? 'Evaluation Studio is temporarily unavailable.';
}

function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function cadenceSentence(detail: ExperimentEvaluationSessionDetail | null) {
  const cadence = detail?.currentRevision?.draft.cadence;
  if (!cadence) return 'Cadence not drafted';
  return `Every ${cadence.interval} ${cadence.unit}${cadence.interval === 1 ? '' : 's'}, starting at ${cadence.startAt}`;
}

function loggingFieldSummary(field: ExperimentLoggingCustomField) {
  return `${field.label} · ${field.type} · ${field.category} · ${field.requiredAt.join(', ')}${field.unit ? ` · ${field.unit}` : ''}`;
}

export function ExperimentEvaluationStudioView({
  projectId,
  loggingTemplate,
  adapter,
  requestedModelId,
  reasoningOptionId,
  onApplyLoggingFields,
  onOpenObjective,
}: ExperimentEvaluationStudioViewProps) {
  const [loadedSnapshot, setSnapshot] = useState<ExperimentEvaluationListSnapshot | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loadedDetail, setDetail] = useState<ExperimentEvaluationSessionDetail | null>(null);
  const [railMode, setRailMode] = useState<RailMode>('sessions');
  const [message, setMessage] = useState('');
  const [profileName, setProfileName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [replaceLoggingConflicts, setReplaceLoggingConflicts] = useState(false);
  const activeProjectIdRef = useRef(projectId);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  activeProjectIdRef.current = projectId;
  const snapshot = currentEvaluationSnapshot(loadedSnapshot, projectId);
  const detail = currentEvaluationDetail(loadedDetail, projectId, selectedSessionId);

  const loadList = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    try {
      const next = await adapter.list({ projectId });
      if (
        !isCurrentEvaluationRequest(
          activeProjectIdRef.current,
          projectId,
          requestId,
          listRequestRef.current,
        )
      ) {
        return null;
      }
      setSnapshot(next);
      setSelectedSessionId((current) =>
        current && next.sessions.some((session) => session.id === current)
          ? current
          : (next.sessions[0]?.id ?? null),
      );
      setError(null);
      return next;
    } catch (loadError) {
      if (
        !isCurrentEvaluationRequest(
          activeProjectIdRef.current,
          projectId,
          requestId,
          listRequestRef.current,
        )
      ) {
        return null;
      }
      setError(errorMessage(loadError));
      return null;
    }
  }, [adapter, projectId]);

  const loadDetail = useCallback(
    async (sessionId: string) => {
      const requestId = ++detailRequestRef.current;
      try {
        const next = await adapter.detail({ projectId, sessionId });
        if (
          !isCurrentEvaluationRequest(
            activeProjectIdRef.current,
            projectId,
            requestId,
            detailRequestRef.current,
          )
        ) {
          return null;
        }
        setDetail(next);
        setProfileName(next.currentRevision?.draft.title ?? next.session.title);
        setError(null);
        return next;
      } catch (loadError) {
        if (
          !isCurrentEvaluationRequest(
            activeProjectIdRef.current,
            projectId,
            requestId,
            detailRequestRef.current,
          )
        ) {
          return null;
        }
        setError(errorMessage(loadError));
        return null;
      }
    },
    [adapter, projectId],
  );

  useEffect(() => {
    listRequestRef.current += 1;
    detailRequestRef.current += 1;
    setSnapshot(null);
    setDetail(null);
    setSelectedSessionId(null);
    setMessage('');
    setProfileName('');
    setError(null);
    setNotice('');
    void loadList();
  }, [loadList, projectId]);

  useEffect(() => {
    if (!selectedSessionId) {
      detailRequestRef.current += 1;
      setDetail(null);
      return;
    }
    void loadDetail(selectedSessionId);
  }, [loadDetail, selectedSessionId]);

  useEffect(() => {
    setReplaceLoggingConflicts(false);
  }, [
    detail?.currentRevision?.revision,
    detail?.session.id,
    loggingTemplate.id,
    loggingTemplate.templateHash,
    loggingTemplate.version,
  ]);

  useEffect(
    () =>
      adapter.onEvent((event) => {
        if (event.projectId !== projectId) return;
        void loadList();
        if (event.sessionId === selectedSessionId) void loadDetail(event.sessionId);
      }),
    [adapter, loadDetail, loadList, projectId, selectedSessionId],
  );

  const createSession = async () => {
    if (busy) return;
    const operationProjectId = projectId;
    setBusy('create');
    setError(null);
    try {
      const session = await adapter.createSession({ projectId, title: 'Evaluation session' });
      if (!isCurrentEvaluationOperation(activeProjectIdRef.current, operationProjectId)) return;
      await loadList();
      if (!isCurrentEvaluationOperation(activeProjectIdRef.current, operationProjectId)) return;
      setSelectedSessionId(session.id);
      setRailMode('sessions');
      setNotice('Created a new evaluation session.');
    } catch (createError) {
      if (!isCurrentEvaluationOperation(activeProjectIdRef.current, operationProjectId)) return;
      setError(errorMessage(createError));
    } finally {
      setBusy(null);
    }
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || !detail || message.trim() === '') return;
    const operationProjectId = projectId;
    const operationSessionId = detail.session.id;
    const request = message.trim();
    setMessage('');
    setBusy('send');
    setError(null);
    try {
      const receipt = await adapter.send({
        projectId,
        sessionId: operationSessionId,
        expectedVersion: detail.session.version,
        message: request,
        requestedModelId,
        reasoningOptionId,
      });
      if (!isCurrentEvaluationOperation(activeProjectIdRef.current, operationProjectId)) return;
      setSelectedSessionId(receipt.session.id);
      await Promise.all([loadList(), loadDetail(receipt.session.id)]);
      if (!isCurrentEvaluationOperation(activeProjectIdRef.current, operationProjectId)) return;
      setNotice('Created a reviewable evaluation draft. No experiment settings were changed.');
    } catch (sendError) {
      if (!isCurrentEvaluationOperation(activeProjectIdRef.current, operationProjectId)) return;
      setMessage(request);
      setError(errorMessage(sendError));
      await loadList();
      await loadDetail(operationSessionId);
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    const revision = detail?.currentRevision;
    if (busy || !detail || !revision || profileName.trim() === '') return;
    const operationProjectId = projectId;
    const operationSessionId = detail.session.id;
    setBusy('approve');
    setError(null);
    try {
      const receipt = await adapter.approve({
        projectId,
        sessionId: operationSessionId,
        expectedVersion: detail.session.version,
        revision: revision.revision,
        profileName: profileName.trim(),
      });
      if (!isCurrentEvaluationOperation(activeProjectIdRef.current, operationProjectId)) return;
      await Promise.all([loadList(), loadDetail(receipt.session.id)]);
      if (!isCurrentEvaluationOperation(activeProjectIdRef.current, operationProjectId)) return;
      setNotice(
        `Saved “${receipt.profile.name}” with evaluator code and prompt in protected local storage.`,
      );
    } catch (approvalError) {
      if (!isCurrentEvaluationOperation(activeProjectIdRef.current, operationProjectId)) return;
      setError(errorMessage(approvalError));
      await loadList();
      await loadDetail(operationSessionId);
    } finally {
      setBusy(null);
    }
  };

  const reuse = async (profile: ExperimentEvaluationProfile) => {
    if (busy) return;
    const operationProjectId = projectId;
    setBusy(`reuse:${profile.id}`);
    setError(null);
    try {
      const reused = await adapter.reuseProfile({ projectId, profileId: profile.id });
      if (!isCurrentEvaluationOperation(activeProjectIdRef.current, operationProjectId)) return;
      await loadList();
      if (!isCurrentEvaluationOperation(activeProjectIdRef.current, operationProjectId)) return;
      setSelectedSessionId(reused.session.id);
      setDetail(reused);
      setRailMode('sessions');
      setNotice(`Loaded “${profile.name}” into a new editable session.`);
    } catch (reuseError) {
      if (!isCurrentEvaluationOperation(activeProjectIdRef.current, operationProjectId)) return;
      setError(errorMessage(reuseError));
    } finally {
      setBusy(null);
    }
  };

  const suggestedLoggingFields = detail?.currentRevision?.draft.loggingFields ?? [];
  const loggingDiff = useMemo(
    () =>
      buildEvaluationLoggingReview(
        loggingTemplate.customFields,
        suggestedLoggingFields,
        replaceLoggingConflicts,
      ),
    [loggingTemplate.customFields, replaceLoggingConflicts, suggestedLoggingFields],
  );

  const mergedLoggingFields = loggingDiff.mergedFields;
  const loggingChangeCount = loggingDiff.changeCount;

  const applyLogging = async () => {
    if (busy || loggingChangeCount === 0) return;
    const operationProjectId = projectId;
    setBusy('logging');
    setError(null);
    try {
      const applied = await onApplyLoggingFields(mergedLoggingFields);
      if (!isCurrentEvaluationOperation(activeProjectIdRef.current, operationProjectId)) return;
      if (applied) {
        setNotice(
          `Saved a new immutable logging-template revision with ${loggingChangeCount} reviewed change${loggingChangeCount === 1 ? '' : 's'}.`,
        );
      }
    } catch {
      if (!isCurrentEvaluationOperation(activeProjectIdRef.current, operationProjectId)) return;
      setError('GOSU could not save the reviewed logging changes. The current template is intact.');
    } finally {
      setBusy(null);
    }
  };

  const draft = detail?.currentRevision?.draft ?? null;
  const activeProfile = snapshot?.profiles.find(
    (profile) => profile.id === detail?.session.acceptedProfileId,
  );

  return (
    <div
      id="experiment-panel-evaluation"
      role="tabpanel"
      aria-labelledby="experiment-tab-evaluation"
      className="experiment-panel evaluation-studio"
    >
      {error && (
        <div className="notice error evaluation-studio-error" role="alert">
          <span>{error}</span>
          <button type="button" className="ghost-button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>

      <aside className="evaluation-studio-rail">
        <header>
          <div>
            <span className="eyebrow">EVALUATION STUDIO</span>
            <h2>Sessions &amp; recipes</h2>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={Boolean(busy)}
            onClick={() => void createSession()}
          >
            ＋ New
          </button>
        </header>
        <div className="evaluation-rail-tabs" role="tablist" aria-label="Evaluation history">
          <button
            type="button"
            role="tab"
            aria-selected={railMode === 'sessions'}
            className={railMode === 'sessions' ? 'active' : ''}
            onClick={() => setRailMode('sessions')}
          >
            Sessions <span>{snapshot?.sessions.length ?? 0}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={railMode === 'recipes'}
            className={railMode === 'recipes' ? 'active' : ''}
            onClick={() => setRailMode('recipes')}
          >
            Saved <span>{snapshot?.profiles.length ?? 0}</span>
          </button>
        </div>
        <div className="evaluation-rail-list">
          {railMode === 'sessions' ? (
            snapshot?.sessions.length ? (
              snapshot.sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={session.id === selectedSessionId ? 'selected' : ''}
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setSelectedSessionId(session.id);
                    setMessage('');
                  }}
                >
                  <strong>{session.title}</strong>
                  <span>
                    {session.status} · v{session.currentRevision}
                  </span>
                  <small>{formatUpdatedAt(session.updatedAt)}</small>
                </button>
              ))
            ) : (
              <p>No sessions yet. Describe an evaluation in a new session.</p>
            )
          ) : snapshot?.profiles.length ? (
            snapshot.profiles.map((profile) => (
              <article key={profile.id}>
                <strong>{profile.name}</strong>
                <span>
                  {profile.draft.cadence.interval} {profile.draft.cadence.unit} cadence · used{' '}
                  {profile.useCount}×
                </span>
                <small>{formatUpdatedAt(profile.lastUsedAt)}</small>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={Boolean(busy)}
                  onClick={() => void reuse(profile)}
                >
                  Use again
                </button>
              </article>
            ))
          ) : (
            <p>Approved recipes appear here for one-click reuse.</p>
          )}
        </div>
      </aside>

      <main className="evaluation-studio-workbench">
        <div className="evaluation-recipe-mode-banner" role="note">
          <strong>Recipe mode</strong>
          <span>
            Previews use synthetic test data. Periodic Runner scheduling and live result ingest are
            not connected yet.
          </span>
        </div>
        {!detail ? (
          <div className="evaluation-studio-empty">
            <strong>Design evaluations by conversation</strong>
            <span>
              Create a session, then describe metrics, cadence, outputs, and experiment rules in
              plain language.
            </span>
            <button
              type="button"
              className="primary-button"
              disabled={Boolean(busy)}
              onClick={() => void createSession()}
            >
              New evaluation session
            </button>
          </div>
        ) : !draft ? (
          <section className="evaluation-studio-start">
            <span className="eyebrow">{detail.session.title}</span>
            <h2>What should this experiment evaluate?</h2>
            <p>
              Example: “Every 500 steps, evaluate holdout macro-F1, show per-class results as a
              table and a learning curve, and stop after three consecutive failures.”
            </p>
            <div className="evaluation-start-facts">
              <span>Target metric optional</span>
              <span>Draft before apply</span>
              <span>Code is never run in Electron</span>
            </div>
          </section>
        ) : (
          <div className="evaluation-studio-draft">
            <header className="evaluation-draft-head">
              <div>
                <span className="eyebrow">
                  REVIEWABLE DRAFT · REVISION {detail.currentRevision?.revision}
                </span>
                <h2>{draft.title}</h2>
                <p>{draft.purpose}</p>
              </div>
              <span
                className={
                  detail.session.acceptedProfileId
                    ? 'evaluation-state approved'
                    : 'evaluation-state'
                }
              >
                {detail.session.acceptedProfileId ? 'Approved recipe' : 'Awaiting approval'}
              </span>
            </header>

            <section className="evaluation-setup-grid">
              <article>
                <span>Cadence</span>
                <strong>{cadenceSentence(detail)}</strong>
                <small>
                  {draft.cadence.stopAfter === null
                    ? 'No automatic stop boundary'
                    : `Stop after ${draft.cadence.stopAfter}`}
                </small>
              </article>
              <article>
                <span>Metrics</span>
                <strong>{draft.metrics.map((metric) => metric.displayName).join(', ')}</strong>
                <small>
                  {draft.metrics.some((metric) => metric.primary)
                    ? 'Includes a proposed primary metric'
                    : 'Observational evaluation'}
                </small>
              </article>
              <article>
                <span>Outputs</span>
                <strong>{draft.outputs.map((output) => output.kind).join(' · ')}</strong>
                <small>
                  {draft.outputs.length} structured output{draft.outputs.length === 1 ? '' : 's'}
                </small>
              </article>
            </section>

            <details className="evaluation-policy" open>
              <summary>Evaluation policy and experiment rules</summary>
              <p>{draft.evaluationPolicy}</p>
              {draft.experimentRules.length > 0 && (
                <ul>
                  {draft.experimentRules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              )}
            </details>

            <ExperimentEvaluationPreview preview={draft.preview} />

            <details className="evaluation-code-prompt">
              <summary>Reference code &amp; reusable prompt</summary>
              <div>
                <h4>{draft.referenceCode.fileName}</h4>
                <pre>
                  <code>{draft.referenceCode.content}</code>
                </pre>
                <h4>Prompt template</h4>
                <pre>{draft.promptTemplate}</pre>
              </div>
            </details>

            {suggestedLoggingFields.length > 0 && (
              <section className="evaluation-logging-review" aria-labelledby="logging-review-title">
                <header>
                  <div>
                    <span className="eyebrow">REVIEW BEFORE APPLY</span>
                    <h3 id="logging-review-title">Logging field changes</h3>
                  </div>
                  <div className="evaluation-logging-counts" aria-label="Logging change summary">
                    <span className="added">{loggingDiff.added.length} add</span>
                    <span className="unchanged">{loggingDiff.unchanged.length} unchanged</span>
                    <span className="conflict">{loggingDiff.conflicts.length} conflict</span>
                  </div>
                </header>
                <div className="evaluation-logging-diff">
                  {loggingDiff.added.map((field) => (
                    <article key={`added:${field.key}`}>
                      <strong>{field.key}</strong>
                      <span className="evaluation-logging-status added">Add</span>
                      <p>{loggingFieldSummary(field)}</p>
                    </article>
                  ))}
                  {loggingDiff.unchanged.map((field) => (
                    <article key={`unchanged:${field.key}`}>
                      <strong>{field.key}</strong>
                      <span className="evaluation-logging-status unchanged">No change</span>
                      <p>{loggingFieldSummary(field)}</p>
                    </article>
                  ))}
                  {loggingDiff.conflicts.map(({ current, suggested }) => (
                    <article key={`conflict:${suggested.key}`} className="conflict">
                      <strong>{suggested.key}</strong>
                      <span className="evaluation-logging-status conflict">Conflict</span>
                      <p>
                        <small>Current</small> {loggingFieldSummary(current)}
                        <br />
                        <small>Proposed</small> {loggingFieldSummary(suggested)}
                      </p>
                    </article>
                  ))}
                </div>
                {loggingDiff.conflicts.length > 0 && (
                  <label className="evaluation-logging-conflict-consent">
                    <input
                      type="checkbox"
                      checked={replaceLoggingConflicts}
                      disabled={Boolean(busy)}
                      onChange={(event) => setReplaceLoggingConflicts(event.target.checked)}
                    />
                    Replace {loggingDiff.conflicts.length} existing field definition
                    {loggingDiff.conflicts.length === 1 ? '' : 's'} in the next immutable revision
                  </label>
                )}
                <p>
                  Unchecked conflicts are skipped. Nothing changes until you save the reviewed
                  logging revision below.
                </p>
              </section>
            )}

            <section className="evaluation-apply-panel">
              <div>
                <label>
                  Saved recipe name
                  <input
                    value={profileName}
                    maxLength={160}
                    onChange={(event) => setProfileName(event.target.value)}
                  />
                </label>
                <p>
                  Approval saves an immutable recipe plus{' '}
                  <code>{draft.referenceCode.fileName}</code> and a prompt file. It does not execute
                  the evaluator or rewrite Goal &amp; Metrics.
                </p>
                {activeProfile && (
                  <p className="evaluation-artifact-paths">
                    Saved locally: {activeProfile.codePath} · {activeProfile.promptPath}
                  </p>
                )}
              </div>
              <div>
                <button type="button" className="secondary-button" onClick={onOpenObjective}>
                  Review Goal &amp; Metrics
                </button>
                {suggestedLoggingFields.length > 0 && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={Boolean(busy) || loggingChangeCount === 0}
                    onClick={() => void applyLogging()}
                  >
                    {loggingChangeCount === 0
                      ? 'Logging already matches'
                      : `Save logging revision (${loggingChangeCount})`}
                  </button>
                )}
                <button
                  type="button"
                  className="primary-button"
                  disabled={
                    Boolean(busy) ||
                    profileName.trim() === '' ||
                    Boolean(detail.session.acceptedProfileId)
                  }
                  onClick={() => void approve()}
                >
                  {detail.session.acceptedProfileId ? 'Recipe saved' : 'Approve & save recipe'}
                </button>
              </div>
            </section>
          </div>
        )}
      </main>

      <aside className="evaluation-studio-chat">
        <header>
          <div>
            <span className="eyebrow">EXPERIMENT ASSISTANT</span>
            <h2>Setup chat</h2>
          </div>
          <span>
            {requestedModelId ?? 'Auto model'} · {reasoningOptionId ?? 'default reasoning'}
          </span>
        </header>
        <div className="evaluation-chat-messages" aria-live="polite">
          {detail?.messages.length ? (
            detail.messages.map((item) => (
              <article key={item.id} className={item.role}>
                <strong>{item.role === 'user' ? 'You' : 'GOSU'}</strong>
                <p>{item.content}</p>
                <small>{formatUpdatedAt(item.completedAt)}</small>
              </article>
            ))
          ) : (
            <p className="evaluation-chat-empty">
              This chat drafts evaluation, metric, logging, and run rules. Every change waits for
              your approval.
            </p>
          )}
          {busy === 'send' && (
            <article className="assistant pending">
              <strong>GOSU</strong>
              <p>Designing a bounded evaluation draft…</p>
            </article>
          )}
        </div>
        <form onSubmit={(event) => void send(event)}>
          <textarea
            value={message}
            disabled={!detail || Boolean(busy)}
            rows={3}
            placeholder="예: 500 step마다 holdout macro-F1을 평가하고 class table과 learning curve를 보여줘"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void send();
            }}
          />
          <button
            type="submit"
            className="primary-button"
            disabled={!detail || Boolean(busy) || message.trim() === ''}
          >
            Send
          </button>
          <small>Enter to send · Shift+Enter for a new line</small>
        </form>
      </aside>
    </div>
  );
}
