import type { ModelCatalog } from '@gosu/contracts';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Formula } from './formula';
import { ModelChatMarkdown } from './model-chat-markdown';
import { composeModelSubgraphs, ModelGraph, overviewModel } from './model-graph';
import {
  codexModelBuilder,
  prepareModelCopilotAttachment,
  prepareModelBuildArtifact,
  type ModelBuildArtifact,
} from './model-lab-builder';
import { MODEL_LAB_MAX_IMPORT_BYTES, parseModelImportJson } from './model-lab-import';
import {
  formatNorm,
  formatShape,
  gradientAt,
  gradientStateAt,
  moduleGradientHealth,
  parameterCoverageAt,
} from './model-lab-domain';
import {
  deterministicModelLabRuntime,
  gosuModelLabRuntime,
  isCurrentModelLabTurn,
  MODEL_LAB_RUNTIME_ERROR_MESSAGE,
  type ModelLabRuntimeStatus,
  type ModelLabModelSelection,
  type ModelLabTurnScope,
} from './model-lab-runtime-adapter';
import type { AgentReview, GradientProbeName, ModelModule, ModelSpec } from './model-lab-schema';
import type { ModelLabAgentProgress, ModelLabAgentUsage } from './model-lab-agent-harness';
import { sampleModels } from './sample-models';

export type ChatMessage = Readonly<{
  id: string;
  modelId: string;
  modelVersion: string;
  role: 'user' | 'assistant';
  body: string;
  attachmentNames?: readonly string[];
  trace?: readonly string[];
  usage?: ModelLabAgentUsage;
}>;

export type ModelCopilotAttachment = Readonly<{
  id: string;
  artifact: ModelBuildArtifact;
  size: number;
}>;

export type ModelChatSession = Readonly<{
  draft: string;
  attachments: readonly ModelCopilotAttachment[];
  messages: readonly ChatMessage[];
}>;

export type ModelViewSession = Readonly<{
  selectedModuleId: string;
  graphDetail: 'overview' | 'expanded';
  expandedSubgraphModuleIds: readonly string[];
}>;

type ModuleDetailState = Readonly<{
  module: ModelModule;
  graphModel: ModelSpec;
  scopeKey: string;
}>;

type ModelImportJob = Readonly<{
  id: string;
  name: string;
  status: 'session-created' | 'model-building' | 'rejected';
  detail: string;
}>;

const fallbackProbeLabels: Record<GradientProbeName, string> = {
  healthy: 'Healthy gradient scenario',
  vanishing: 'Vanishing-gradient scenario',
  detached: 'Detached-gradient scenario',
  exploding: 'Exploding-gradient scenario',
};

const severityLabel = {
  pass: 'Passed',
  warning: 'Needs review',
  error: 'Failed',
} as const;

function nextId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const MODEL_SESSION_SIDEBAR_MIN_WIDTH = 190;
export const MODEL_SESSION_SIDEBAR_MAX_WIDTH = 420;
export const MODEL_SESSION_SIDEBAR_DEFAULT_WIDTH = 252;
export const MODEL_COPILOT_MIN_WIDTH = 300;
export const MODEL_COPILOT_MAX_WIDTH = 620;
export const MODEL_COPILOT_DEFAULT_WIDTH = 390;
export const MODEL_LAB_PRIMARY_MIN_WIDTH = 520;
export const MODEL_COPILOT_MAX_ATTACHMENTS = 6;

type ResizablePanel = 'model-sessions' | 'copilot';

export function clampPanelWidth(width: number, minimum: number, maximum: number) {
  return Math.min(Math.max(Math.round(width), minimum), Math.max(minimum, maximum));
}

export function panelWidthAfterPointerMove(
  panel: ResizablePanel,
  startWidth: number,
  startClientX: number,
  clientX: number,
) {
  const delta = clientX - startClientX;
  return panel === 'model-sessions' ? startWidth + delta : startWidth - delta;
}

export function panelWidthAfterSeparatorKey(
  panel: ResizablePanel,
  width: number,
  key: string,
  minimum: number,
  maximum: number,
  step = 16,
) {
  if (key === 'Home') return minimum;
  if (key === 'End') return maximum;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return width;
  const direction = key === 'ArrowRight' ? 1 : -1;
  const panelDirection = panel === 'model-sessions' ? direction : -direction;
  return clampPanelWidth(width + panelDirection * step, minimum, maximum);
}

export function availablePanelMaximum(
  workspaceWidth: number,
  otherPanelWidth: number,
  minimum: number,
  hardMaximum: number,
) {
  const separatorSpace = 14;
  return Math.max(
    minimum,
    Math.min(
      hardMaximum,
      workspaceWidth - otherPanelWidth - MODEL_LAB_PRIMARY_MIN_WIDTH - separatorSpace,
    ),
  );
}

export function modelLabShellClassName(modelFocus: boolean, modelSessionsCollapsed = false) {
  return [
    'model-lab-shell',
    modelFocus ? 'model-lab-shell--focus' : '',
    modelSessionsCollapsed ? 'model-lab-shell--sessions-collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function modelLabWorkbenchClassName(copilotCollapsed: boolean) {
  return copilotCollapsed
    ? 'model-lab-workbench model-lab-workbench--copilot-collapsed'
    : 'model-lab-workbench';
}

export function modelChatSessionKey(
  model: Pick<ModelSpec, 'id' | 'version'>,
  contentRevision: number,
) {
  return JSON.stringify([model.id, model.version, contentRevision]);
}

export function replaceModelPreservingOrder(
  models: readonly ModelSpec[],
  replacement: ModelSpec,
): readonly ModelSpec[] {
  const existingIndex = models.findIndex((candidate) => candidate.id === replacement.id);
  if (existingIndex < 0) return [...models, replacement];
  return models.map((candidate, index) => (index === existingIndex ? replacement : candidate));
}

export type ImportedModelSession = Readonly<{
  model: ModelSpec;
  models: readonly ModelSpec[];
  identifierChanged: boolean;
}>;

export function createImportedModelSession(
  models: readonly ModelSpec[],
  candidate: ModelSpec,
): ImportedModelSession {
  const occupied = new Set(models.map((model) => model.id));
  if (!occupied.has(candidate.id)) {
    return { model: candidate, models: [...models, candidate], identifierChanged: false };
  }

  let importNumber = 2;
  let nextId = candidate.id;
  while (occupied.has(nextId)) {
    const suffix = `-import-${importNumber}`;
    nextId = `${candidate.id.slice(0, 120 - suffix.length)}${suffix}`;
    importNumber += 1;
  }
  const model = {
    ...candidate,
    id: nextId,
    name: `${candidate.name} (import ${importNumber - 1})`.slice(0, 160),
  };
  return { model, models: [...models, model], identifierChanged: true };
}

export type ModelTrashTransition = Readonly<{
  activeModelId: string;
  moved: boolean;
  reason: 'last-active-model' | 'model-not-active' | null;
  trashedModelIds: readonly string[];
}>;

export function modelSessionDeleteLabel(modelName: string) {
  return `Delete ${modelName}`;
}

export function moveModelSessionToTrash(
  models: readonly ModelSpec[],
  trashedModelIds: readonly string[],
  activeModelId: string,
  targetModelId: string,
): ModelTrashTransition {
  const trashed = new Set(trashedModelIds);
  const activeModels = models.filter((candidate) => !trashed.has(candidate.id));
  const targetIndex = activeModels.findIndex((candidate) => candidate.id === targetModelId);
  if (targetIndex < 0) {
    return {
      activeModelId,
      moved: false,
      reason: 'model-not-active',
      trashedModelIds,
    };
  }
  if (activeModels.length === 1) {
    return {
      activeModelId,
      moved: false,
      reason: 'last-active-model',
      trashedModelIds,
    };
  }
  const remaining = activeModels.filter((candidate) => candidate.id !== targetModelId);
  const adjacentModel = remaining[Math.min(targetIndex, remaining.length - 1)];
  return {
    activeModelId:
      activeModelId === targetModelId ? (adjacentModel?.id ?? activeModelId) : activeModelId,
    moved: true,
    reason: null,
    trashedModelIds: [...trashedModelIds, targetModelId],
  };
}

export function withoutTrashedModelSessions<T>(
  sessions: Readonly<Record<string, T>>,
  trashedModelIds: readonly string[],
): Readonly<Record<string, T>> {
  const trashed = new Set(trashedModelIds);
  return Object.fromEntries(
    Object.entries(sessions).filter(([key]) => {
      try {
        const parsed: unknown = JSON.parse(key);
        return !(Array.isArray(parsed) && typeof parsed[0] === 'string' && trashed.has(parsed[0]));
      } catch {
        return true;
      }
    }),
  );
}

export function isCopilotPanelCollapsed(
  mobileLayout: boolean,
  desktopCollapsed: boolean,
  mobileOpen: boolean,
) {
  return mobileLayout ? !mobileOpen : desktopCollapsed;
}

export function copilotContentAccessibilityProps(collapsed: boolean) {
  return { inert: collapsed, 'aria-hidden': collapsed } as const;
}

export function copilotRestoreAccessibilityProps(collapsed: boolean) {
  return { hidden: !collapsed } as const;
}

type CopilotFocusable = Readonly<{ focus: () => void }>;

export function handoffCopilotFocus(
  collapsed: boolean,
  targets: Readonly<{
    restore: CopilotFocusable | null;
    composer: CopilotFocusable | null;
    close: CopilotFocusable | null;
  }>,
  schedule: (callback: () => void) => unknown = (callback) => requestAnimationFrame(callback),
) {
  schedule(() => {
    if (collapsed) targets.restore?.focus();
    else (targets.composer ?? targets.close)?.focus();
  });
}

export function shouldHandoffCopilotFocus(
  previousCollapsed: boolean,
  collapsed: boolean,
  focusWasInsidePanel: boolean,
) {
  return previousCollapsed !== collapsed && focusWasInsidePanel;
}

export function mobileCopilotOpenAfterLayoutChange(
  previousMobileLayout: boolean,
  mobileLayout: boolean,
  mobileOpen: boolean,
) {
  return previousMobileLayout === mobileLayout ? mobileOpen : false;
}

export function createModelViewSession(model: Pick<ModelSpec, 'modules'>): ModelViewSession {
  return {
    selectedModuleId: model.modules[0]?.id ?? '',
    graphDetail: 'overview',
    expandedSubgraphModuleIds: [],
  };
}

export function modelViewSessionWithUpdate(
  sessions: Readonly<Record<string, ModelViewSession>>,
  sessionKey: string,
  model: Pick<ModelSpec, 'modules'>,
  update: Partial<ModelViewSession>,
): Readonly<Record<string, ModelViewSession>> {
  return {
    ...sessions,
    [sessionKey]: {
      ...(sessions[sessionKey] ?? createModelViewSession(model)),
      ...update,
    },
  };
}

export function modelGraphInstanceKey(
  modelId: string,
  contentRevision: number,
  focused: boolean,
  expandedSubgraphModuleIds: readonly string[] = [],
  modelSessionsCollapsed = false,
  copilotCollapsed = false,
) {
  return JSON.stringify([
    modelId,
    contentRevision,
    focused,
    expandedSubgraphModuleIds,
    modelSessionsCollapsed,
    copilotCollapsed,
  ]);
}

export function createModelChatSession(
  model: Pick<ModelSpec, 'id' | 'name' | 'version'>,
): ModelChatSession {
  return {
    draft: '',
    attachments: [],
    messages: [
      {
        id: `welcome-${model.id}`,
        modelId: model.id,
        modelVersion: model.version,
        role: 'assistant',
        body: `Loaded ${model.name} ${model.version}. GOSU Model Copilot answers from this model's bounded ModelIR, selected module, source anchors, attached evidence, and recent per-model conversation.`,
        trace: ['Model-qualified context', 'GOSU-compatible LLM adapter · bounded evidence'],
      },
    ],
  };
}

export function modelChatSessionWithDraft(
  sessions: Readonly<Record<string, ModelChatSession>>,
  sessionKey: string,
  model: Pick<ModelSpec, 'id' | 'name' | 'version'>,
  draft: string,
): Readonly<Record<string, ModelChatSession>> {
  const session = sessions[sessionKey] ?? createModelChatSession(model);
  return { ...sessions, [sessionKey]: { ...session, draft } };
}

export function modelChatSessionWithAttachments(
  sessions: Readonly<Record<string, ModelChatSession>>,
  sessionKey: string,
  model: Pick<ModelSpec, 'id' | 'name' | 'version'>,
  attachments: readonly ModelCopilotAttachment[],
): Readonly<Record<string, ModelChatSession>> {
  const session = sessions[sessionKey] ?? createModelChatSession(model);
  return { ...sessions, [sessionKey]: { ...session, attachments } };
}

function useMediaQuery(queryText: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(queryText).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(queryText);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [queryText]);
  return matches;
}

function useMobileLayout() {
  return useMediaQuery('(max-width: 768px)');
}

function AttachmentInput({
  onFiles,
  label = '+ New / Import model',
  disabled = false,
}: {
  onFiles: (files: readonly File[]) => void | Promise<void>;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`quiet-button attachment-button${disabled ? ' attachment-button--disabled' : ''}`}
    >
      <span>{label}</span>
      <input
        className="visually-hidden"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,.pdf,.docx,.py,.json,.txt,.md,.tex,.rst,.csv,.yaml,.yml"
        disabled={disabled}
        onChange={(event) => {
          const input = event.currentTarget;
          void Promise.resolve(onFiles(Array.from(input.files ?? []))).finally(() => {
            input.value = '';
          });
        }}
        aria-label="Create a model from Python, image, PDF, DOCX, text, or ModelIR JSON"
      />
    </label>
  );
}

function ModelCopilotAttachmentInput({
  onFiles,
  disabled = false,
}: {
  onFiles: (files: readonly File[]) => void | Promise<void>;
  disabled?: boolean;
}) {
  return (
    <label
      className={`quiet-button attachment-button model-chat__attachment-button${disabled ? ' attachment-button--disabled' : ''}`}
    >
      <span aria-hidden="true">＋</span>
      <span>Files</span>
      <input
        className="visually-hidden"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,.pdf,.docx,.py,.json,.txt,.md,.tex,.rst,.csv,.yaml,.yml"
        disabled={disabled}
        onChange={(event) => {
          const input = event.currentTarget;
          void Promise.resolve(onFiles(Array.from(input.files ?? []))).finally(() => {
            input.value = '';
          });
        }}
        aria-label="Attach files to this Model Copilot conversation"
      />
    </label>
  );
}

function ReviewCard({ review }: { review: AgentReview }) {
  return (
    <article className={`review-card review-card--${review.status}`}>
      <div className="review-card__heading">
        <div>
          <strong>{review.agent}</strong>
          <span>{review.specialty}</span>
        </div>
        <span>{severityLabel[review.status]}</span>
      </div>
      <p>{review.summary}</p>
      <ul>
        {review.evidence.slice(0, 3).map((evidence) => (
          <li key={evidence}>{evidence}</li>
        ))}
      </ul>
    </article>
  );
}

function ModelIntentPanel({ model }: { model: ModelSpec }) {
  return (
    <section className="intent-panel" aria-labelledby="intent-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">DESIGN INTENT</span>
          <h2 id="intent-title">What this model is supposed to be</h2>
        </div>
        <span className="source-chip">{model.sourceLabel}</span>
      </div>
      <p>{model.intent.statement}</p>
      <div className="intent-contract">
        <span>Input {formatShape(model.intent.expectedInput)}</span>
        <span aria-hidden="true">→</span>
        <span>Output {formatShape(model.intent.expectedOutput)}</span>
      </div>
      <ul>
        {model.intent.invariants.map((invariant) => (
          <li key={invariant}>{invariant}</li>
        ))}
      </ul>
    </section>
  );
}

export function moduleDetailGradientEvidence(
  model: ModelSpec,
  moduleId: string,
  probe: GradientProbeName,
  checkpointIndex: number,
) {
  return model.connections
    .filter((connection) => connection.source === moduleId || connection.target === moduleId)
    .map((connection) => {
      const state = gradientStateAt(connection, probe, checkpointIndex);
      const gradient = gradientAt(connection, probe, checkpointIndex);
      return {
        id: connection.id,
        tensorName: connection.tensorName,
        direction: connection.target === moduleId ? ('incoming' as const) : ('outgoing' as const),
        forwardRoute: `${connection.source} → ${connection.target}`,
        backwardGradientRoute: `${connection.target} → ${connection.source}`,
        state,
        value: state === 'observed' ? formatNorm(gradient) : state,
        activationValue: formatNorm(connection.activationNorm),
        shape: formatShape(connection.shape),
        expectedToCarryGradient: connection.expectedToCarryGradient,
      } as const;
    });
}

export function moduleDetailEvidenceSummary(
  evidence: readonly ReturnType<typeof moduleDetailGradientEvidence>[number][],
) {
  if (evidence.length === 0) return 'No edge evidence';
  const states = new Set(evidence.map((reading) => reading.state));
  if (states.size > 1) return 'Mixed edge observations';
  const state = evidence[0]?.state;
  return state === 'observed' ? 'Observed edge gradients' : `${state ?? 'not-observed'} edges`;
}

export function ModuleDetailDialog({
  model,
  module,
  probe,
  checkpointIndex,
  onClose,
  subgraphAction,
}: Readonly<{
  model: ModelSpec;
  module: ModelModule;
  probe: GradientProbeName;
  checkpointIndex: number;
  onClose: () => void;
  subgraphAction?: Readonly<{
    modelName: string;
    moduleCount: number;
    expanded: boolean;
    onToggle: () => void;
  }>;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const checkpoint = model.connections[0]?.gradient.checkpoints[checkpointIndex] ?? 0;
  const evidence = moduleDetailGradientEvidence(model, module.id, probe, checkpointIndex);
  const incomingEvidence = evidence.filter((reading) => reading.direction === 'incoming');
  const outgoingEvidence = evidence.filter((reading) => reading.direction === 'outgoing');
  const evidenceGroups = [
    { label: 'Forward input tensors', readings: incomingEvidence },
    { label: 'Forward output tensors', readings: outgoingEvidence },
  ] as const;
  const coverage = parameterCoverageAt(model, probe, checkpointIndex);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const focusFrame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelAnimationFrame(focusFrame);
      if (dialog.open) dialog.close();
    };
  }, [module.id]);

  return (
    <dialog
      ref={dialogRef}
      id="model-module-detail-dialog"
      className="module-detail-dialog"
      aria-modal="true"
      aria-labelledby="module-detail-title"
      aria-describedby="module-detail-notes"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article>
        <header className="module-detail-dialog__header">
          <div>
            <span className="eyebrow">{module.group} · MODULE DETAIL</span>
            <h2 id="module-detail-title">{module.name}</h2>
          </div>
          <div className="module-detail-dialog__actions">
            {subgraphAction ? (
              <button
                className="quiet-button"
                type="button"
                aria-expanded={subgraphAction.expanded}
                onClick={subgraphAction.onToggle}
              >
                {subgraphAction.expanded ? 'Collapse' : 'Expand'} {subgraphAction.moduleCount}{' '}
                submodules {subgraphAction.expanded ? '↑' : 'inside graph ↓'}
              </button>
            ) : null}
            <span className="module-detail-evidence-summary">
              {moduleDetailEvidenceSummary(evidence)}
            </span>
            <button
              ref={closeRef}
              className="module-detail-dialog__close"
              type="button"
              aria-label={`Close ${module.name} detail`}
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </header>
        <div className="module-detail-dialog__body">
          <section className="module-detail-notes" aria-labelledby="module-detail-notes-title">
            <span className="eyebrow">MODULE EXPLANATION</span>
            <h3 id="module-detail-notes-title">What this module does</h3>
            <p id="module-detail-notes">{module.explanation}</p>
          </section>

          <section className="module-detail-formula" aria-labelledby="module-detail-formula-title">
            <span className="eyebrow">FULL FORMULA</span>
            <h3 id="module-detail-formula-title">Module equation</h3>
            <Formula latex={module.formula} />
          </section>

          <dl className="module-detail-facts">
            <div>
              <dt>Input shape</dt>
              <dd>{formatShape(module.inputShape)}</dd>
            </div>
            <div>
              <dt>Output shape</dt>
              <dd>{formatShape(module.outputShape)}</dd>
            </div>
            <div>
              <dt>Linear transform / operation</dt>
              <dd>{module.transform}</dd>
            </div>
            <div>
              <dt>Activation</dt>
              <dd>{module.activation ?? 'None'}</dd>
            </div>
            {module.repeat ? (
              <div>
                <dt>Repeated stack</dt>
                <dd>
                  {module.repeat.count} × {module.repeat.label}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Parameters</dt>
              <dd>{module.parameterCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Code reference</dt>
              <dd>
                <code>{module.codeReference}</code>
              </dd>
            </div>
          </dl>

          <section
            className="module-detail-evidence"
            aria-labelledby="module-detail-evidence-title"
          >
            <div className="module-detail-evidence__heading">
              <div>
                <span className="eyebrow">GRADIENT EVIDENCE</span>
                <h3 id="module-detail-evidence-title">Backward path at batch {checkpoint}</h3>
              </div>
              <span>{probe}</span>
            </div>
            {evidence.length === 0 ? (
              <p>No edge-gradient observation exists at this model boundary.</p>
            ) : (
              <div className="module-detail-evidence__groups">
                {evidenceGroups.map(({ label, readings }) => (
                  <section key={label} aria-label={label}>
                    <h4>{label}</h4>
                    {readings.length === 0 ? (
                      <p>No {label.toLowerCase()} at this model boundary.</p>
                    ) : (
                      <ul>
                        {readings.map((reading) => (
                          <li key={reading.id}>
                            <div>
                              <strong>{reading.tensorName}</strong>
                              <code>Forward {reading.forwardRoute}</code>
                            </div>
                            <code>Backward gradient {reading.backwardGradientRoute}</code>
                            <span>
                              Shape <strong>{reading.shape}</strong> · gradient expected{' '}
                              <strong>{reading.expectedToCarryGradient ? 'yes' : 'no'}</strong>
                            </span>
                            <span>
                              Mean healthy-probe activation RMS{' '}
                              <strong>{reading.activationValue}</strong>
                            </span>
                            <span>
                              {reading.state} gradient <strong>{reading.value}</strong>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            )}
            {coverage ? (
              <p className="module-detail-evidence__coverage">
                Model-wide coverage:{' '}
                <strong>
                  {coverage.observed.tensors}/{coverage.denominator.tensors}
                </strong>{' '}
                trainable parameter tensors have observed gradients (
                {coverage.observed.elements.toLocaleString()} /{' '}
                {coverage.denominator.elements.toLocaleString()} elements).
              </p>
            ) : (
              <p className="module-detail-evidence__coverage">
                Model-wide parameter-gradient coverage was not observed.
              </p>
            )}
          </section>
        </div>
      </article>
    </dialog>
  );
}

export function ModelLabApp() {
  const [models, setModels] = useState<readonly ModelSpec[]>(sampleModels);
  const [trashedModelIds, setTrashedModelIds] = useState<readonly string[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [emptyTrashArmed, setEmptyTrashArmed] = useState(false);
  const [trashNotice, setTrashNotice] = useState('');
  const [modelId, setModelId] = useState(sampleModels[0]?.id ?? '');
  const [modelRevisions, setModelRevisions] = useState<Readonly<Record<string, number>>>(() =>
    Object.fromEntries(sampleModels.map((candidate) => [candidate.id, 0])),
  );
  const trashedModelIdSet = useMemo(() => new Set(trashedModelIds), [trashedModelIds]);
  const activeModels = useMemo(
    () => models.filter((candidate) => !trashedModelIdSet.has(candidate.id)),
    [models, trashedModelIdSet],
  );
  const trashedModels = useMemo(
    () =>
      trashedModelIds
        .map((trashedId) => models.find((candidate) => candidate.id === trashedId))
        .filter((candidate): candidate is ModelSpec => candidate !== undefined),
    [models, trashedModelIds],
  );
  const model = activeModels.find((candidate) => candidate.id === modelId) ?? activeModels[0];
  if (!model) throw new Error('model_lab_sample_missing');
  const modelRevision = modelRevisions[model.id] ?? 0;
  const activeChatSessionKey = modelChatSessionKey(model, modelRevision);

  const [signalMode, setSignalMode] = useState<'forward' | 'backward'>('backward');
  const [viewSessions, setViewSessions] = useState<Readonly<Record<string, ModelViewSession>>>(() =>
    Object.fromEntries(
      sampleModels.map((candidate) => [
        modelChatSessionKey(candidate, 0),
        createModelViewSession(candidate),
      ]),
    ),
  );
  const activeViewSession = viewSessions[activeChatSessionKey] ?? createModelViewSession(model);
  const selectedModuleId = activeViewSession.selectedModuleId;
  const graphDetail = activeViewSession.graphDetail;
  const expandedSubgraphModuleIds = activeViewSession.expandedSubgraphModuleIds;
  const graphComposition = useMemo(
    () =>
      composeModelSubgraphs(
        overviewModel(model, graphDetail),
        activeModels,
        expandedSubgraphModuleIds,
      ),
    [activeModels, expandedSubgraphModuleIds, graphDetail, model],
  );
  const copilotProjectModels = useMemo(
    () =>
      activeModels.map((candidate) =>
        candidate.id === model.id ? graphComposition.model : candidate,
      ),
    [activeModels, graphComposition.model, model.id],
  );
  const setSelectedModuleId = (moduleId: string) =>
    setViewSessions((current) =>
      modelViewSessionWithUpdate(current, activeChatSessionKey, model, {
        selectedModuleId: moduleId,
      }),
    );
  const setGraphDetail = (detail: 'overview' | 'expanded') =>
    setViewSessions((current) =>
      modelViewSessionWithUpdate(current, activeChatSessionKey, model, { graphDetail: detail }),
    );
  const toggleSubgraph = (moduleId: string) => {
    setModuleDetail(null);
    moduleDetailTriggerRef.current = null;
    setViewSessions((current) => {
      const session = current[activeChatSessionKey] ?? createModelViewSession(model);
      const currentlyExpanded = session.expandedSubgraphModuleIds.includes(moduleId);
      return modelViewSessionWithUpdate(current, activeChatSessionKey, model, {
        expandedSubgraphModuleIds: currentlyExpanded
          ? session.expandedSubgraphModuleIds.filter((candidate) => candidate !== moduleId)
          : [...session.expandedSubgraphModuleIds, moduleId],
        selectedModuleId: currentlyExpanded ? moduleId : session.selectedModuleId,
      });
    });
  };
  const [probe, setProbe] = useState<GradientProbeName>('healthy');
  const [checkpointIndex, setCheckpointIndex] = useState(4);
  const [reviewNonce, setReviewNonce] = useState(1);
  const [reviews, setReviews] = useState<readonly AgentReview[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [importJobs, setImportJobs] = useState<readonly ModelImportJob[]>([]);
  const [buildingModel, setBuildingModel] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [copilotProgress, setCopilotProgress] = useState<readonly ModelLabAgentProgress[]>([]);
  const [copilotStatus, setCopilotStatus] = useState<ModelLabRuntimeStatus | null>(null);
  const [copilotCatalog, setCopilotCatalog] = useState<ModelCatalog | null>(null);
  const [copilotSelection, setCopilotSelection] = useState<ModelLabModelSelection>({
    requestedModelId: null,
    reasoningOptionId: null,
  });
  const [copilotAttachmentNotice, setCopilotAttachmentNotice] = useState<string | null>(null);
  const [modelFocus, setModelFocus] = useState(false);
  const [moduleDetail, setModuleDetail] = useState<ModuleDetailState | null>(null);
  const [modelSessionsCollapsed, setModelSessionsCollapsed] = useState(false);
  const [modelSessionSidebarWidth, setModelSessionSidebarWidth] = useState(
    MODEL_SESSION_SIDEBAR_DEFAULT_WIDTH,
  );
  const [copilotWidth, setCopilotWidth] = useState(MODEL_COPILOT_DEFAULT_WIDTH);
  const [resizingPanel, setResizingPanel] = useState<ResizablePanel | null>(null);
  const [copilotCollapsed, setCopilotCollapsed] = useState(false);
  const [mobileCopilotOpen, setMobileCopilotOpen] = useState(false);
  const mobileLayout = useMobileLayout();
  const stackedSessionLayout = useMediaQuery('(max-width: 900px)');
  const stackedWorkbenchLayout = useMediaQuery('(max-width: 1200px)');
  const modelSessionsPanelCollapsed = modelSessionsCollapsed;
  const previousMobileLayoutRef = useRef(mobileLayout);
  const copilotPanelCollapsed = isCopilotPanelCollapsed(
    mobileLayout,
    copilotCollapsed,
    mobileCopilotOpen,
  );
  const copilotContentA11y = copilotContentAccessibilityProps(copilotPanelCollapsed);
  const copilotRestoreA11y = copilotRestoreAccessibilityProps(copilotPanelCollapsed);
  const [chatSessions, setChatSessions] = useState<Readonly<Record<string, ModelChatSession>>>(() =>
    Object.fromEntries(
      sampleModels.map((candidate) => [
        modelChatSessionKey(candidate, 0),
        createModelChatSession(candidate),
      ]),
    ),
  );
  const shellRef = useRef<HTMLElement>(null);
  const focusToggleRef = useRef<HTMLButtonElement>(null);
  const modelSessionsCollapseRef = useRef<HTMLButtonElement>(null);
  const modelSessionsRestoreRef = useRef<HTMLButtonElement>(null);
  const copilotCloseRef = useRef<HTMLButtonElement>(null);
  const copilotRestoreRef = useRef<HTMLButtonElement>(null);
  const copilotComposerRef = useRef<HTMLTextAreaElement>(null);
  const copilotTurnAbortRef = useRef<AbortController | null>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const chatPinnedToBottomRef = useRef(true);
  const previousChatSessionKeyRef = useRef(activeChatSessionKey);
  const modelRegistryRef = useRef<readonly ModelSpec[]>(models);
  const modelImportInFlightRef = useRef(false);
  const copilotPanelRef = useRef<HTMLElement>(null);
  const moduleDetailTriggerRef = useRef<HTMLElement | null>(null);
  const copilotOwnsFocusRef = useRef(false);
  const previousCopilotCollapsedRef = useRef(copilotPanelCollapsed);
  const panelResizeRef = useRef<{
    panel: ResizablePanel;
    pointerId: number;
    startClientX: number;
    startWidth: number;
  } | null>(null);
  const turnSequenceRef = useRef(0);
  const activeModelRef = useRef({ id: model.id, version: model.version });
  const activeChatSession = chatSessions[activeChatSessionKey] ?? createModelChatSession(model);
  const messages = activeChatSession.messages;
  const question = activeChatSession.draft;
  const copilotAttachments = activeChatSession.attachments;
  const setQuestion = (draft: string) =>
    setChatSessions((current) =>
      modelChatSessionWithDraft(current, activeChatSessionKey, model, draft),
    );
  const setMessages = (update: (current: readonly ChatMessage[]) => readonly ChatMessage[]) =>
    setChatSessions((current) => {
      const session = current[activeChatSessionKey] ?? createModelChatSession(model);
      return {
        ...current,
        [activeChatSessionKey]: { ...session, messages: update(session.messages) },
      };
    });
  const setCopilotAttachments = (attachments: readonly ModelCopilotAttachment[]) =>
    setChatSessions((current) =>
      modelChatSessionWithAttachments(current, activeChatSessionKey, model, attachments),
    );
  const setCopilotPanelVisibility = (collapsed: boolean) => {
    if (mobileLayout) setMobileCopilotOpen(!collapsed);
    else setCopilotCollapsed(collapsed);
  };
  const panelMaximum = (panel: ResizablePanel) => {
    const workspaceWidth = shellRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    if (panel === 'model-sessions') {
      return availablePanelMaximum(
        workspaceWidth,
        copilotPanelCollapsed ? 64 : copilotWidth,
        MODEL_SESSION_SIDEBAR_MIN_WIDTH,
        MODEL_SESSION_SIDEBAR_MAX_WIDTH,
      );
    }
    return availablePanelMaximum(
      workspaceWidth,
      modelSessionsPanelCollapsed ? 64 : modelSessionSidebarWidth,
      MODEL_COPILOT_MIN_WIDTH,
      MODEL_COPILOT_MAX_WIDTH,
    );
  };
  const setPanelWidth = (panel: ResizablePanel, width: number) => {
    if (panel === 'model-sessions') {
      setModelSessionSidebarWidth(
        clampPanelWidth(width, MODEL_SESSION_SIDEBAR_MIN_WIDTH, panelMaximum('model-sessions')),
      );
      return;
    }
    setCopilotWidth(clampPanelWidth(width, MODEL_COPILOT_MIN_WIDTH, panelMaximum('copilot')));
  };
  const beginPanelResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    panel: ResizablePanel,
    startWidth: number,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panelResizeRef.current = {
      panel,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth,
    };
    setResizingPanel(panel);
  };
  const continuePanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = panelResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setPanelWidth(
      resize.panel,
      panelWidthAfterPointerMove(
        resize.panel,
        resize.startWidth,
        resize.startClientX,
        event.clientX,
      ),
    );
  };
  const endPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panelResizeRef.current?.pointerId !== event.pointerId) return;
    panelResizeRef.current = null;
    setResizingPanel(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const resizePanelWithKeyboard = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    panel: ResizablePanel,
    width: number,
    minimum: number,
  ) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    setPanelWidth(
      panel,
      panelWidthAfterSeparatorKey(panel, width, event.key, minimum, panelMaximum(panel)),
    );
  };
  const collapseModelSessions = () => {
    setModelSessionsCollapsed(true);
    requestAnimationFrame(() => modelSessionsRestoreRef.current?.focus());
  };
  const restoreModelSessions = () => {
    setModelSessionsCollapsed(false);
    requestAnimationFrame(() => modelSessionsCollapseRef.current?.focus());
  };
  const openModuleDetail = (module: ModelModule, graphModel: ModelSpec) => {
    const cards = document.querySelectorAll<HTMLElement>('[data-model-node-id]');
    const matchingCard = Array.from(cards).find((card) => card.dataset.modelNodeId === module.id);
    moduleDetailTriggerRef.current =
      matchingCard ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setModuleDetail({ module, graphModel, scopeKey: activeChatSessionKey });
  };
  const closeModuleDetail = () => {
    const returnTarget = moduleDetailTriggerRef.current;
    setModuleDetail(null);
    requestAnimationFrame(() => {
      if (returnTarget?.isConnected) returnTarget.focus();
    });
  };
  const moveModelToTrash = (targetModelId: string) => {
    const transition = moveModelSessionToTrash(models, trashedModelIds, model.id, targetModelId);
    if (!transition.moved) {
      setTrashNotice(
        transition.reason === 'last-active-model'
          ? 'Keep at least one active model session. Import or restore another model first.'
          : 'That model session is no longer active.',
      );
      setTrashOpen(true);
      return;
    }
    const target = models.find((candidate) => candidate.id === targetModelId);
    turnSequenceRef.current += 1;
    setAnswering(false);
    setModuleDetail(null);
    moduleDetailTriggerRef.current = null;
    setTrashedModelIds(transition.trashedModelIds);
    setModelId(transition.activeModelId);
    setEmptyTrashArmed(false);
    setTrashOpen(true);
    setTrashNotice(`${target?.name ?? 'Model session'} moved to Trash.`);
  };
  const restoreModelFromTrash = (targetModelId: string) => {
    const target = models.find((candidate) => candidate.id === targetModelId);
    setTrashedModelIds((current) => current.filter((candidate) => candidate !== targetModelId));
    setEmptyTrashArmed(false);
    setTrashNotice(`${target?.name ?? 'Model session'} restored.`);
  };
  const emptyModelTrash = () => {
    const purgedIds = [...trashedModelIds];
    const purged = new Set(purgedIds);
    setModels((current) => current.filter((candidate) => !purged.has(candidate.id)));
    setModelRevisions((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !purged.has(key))),
    );
    setViewSessions((current) => withoutTrashedModelSessions(current, purgedIds));
    setChatSessions((current) => withoutTrashedModelSessions(current, purgedIds));
    setTrashedModelIds([]);
    setEmptyTrashArmed(false);
    setTrashNotice(
      `${purgedIds.length} model session${purgedIds.length === 1 ? '' : 's'} permanently deleted.`,
    );
  };
  useEffect(() => {
    modelRegistryRef.current = models;
  }, [models]);
  useEffect(() => {
    setViewSessions((current) =>
      current[activeChatSessionKey]
        ? current
        : { ...current, [activeChatSessionKey]: createModelViewSession(model) },
    );
    setChatSessions((current) =>
      current[activeChatSessionKey]
        ? current
        : { ...current, [activeChatSessionKey]: createModelChatSession(model) },
    );
  }, [activeChatSessionKey, model]);

  useEffect(() => {
    setModuleDetail(null);
    moduleDetailTriggerRef.current = null;
    setCopilotAttachmentNotice(null);
    copilotTurnAbortRef.current?.abort();
    copilotTurnAbortRef.current = null;
    setCopilotProgress([]);
  }, [activeChatSessionKey]);

  useLayoutEffect(() => {
    if (previousChatSessionKeyRef.current !== activeChatSessionKey) {
      previousChatSessionKeyRef.current = activeChatSessionKey;
      chatPinnedToBottomRef.current = true;
    }
    const chatBody = chatBodyRef.current;
    if (!chatBody || copilotPanelCollapsed || !chatPinnedToBottomRef.current) return;
    chatBody.scrollTop = chatBody.scrollHeight;
  }, [activeChatSessionKey, copilotPanelCollapsed, messages.length]);

  useEffect(() => {
    setMobileCopilotOpen((current) =>
      mobileCopilotOpenAfterLayoutChange(previousMobileLayoutRef.current, mobileLayout, current),
    );
    previousMobileLayoutRef.current = mobileLayout;
  }, [mobileLayout]);

  useEffect(() => {
    const trackCopilotFocus = (event: FocusEvent) => {
      copilotOwnsFocusRef.current = Boolean(
        event.target instanceof Node && copilotPanelRef.current?.contains(event.target),
      );
    };
    document.addEventListener('focusin', trackCopilotFocus);
    return () => document.removeEventListener('focusin', trackCopilotFocus);
  }, []);

  useLayoutEffect(() => {
    const previousCollapsed = previousCopilotCollapsedRef.current;
    if (
      shouldHandoffCopilotFocus(
        previousCollapsed,
        copilotPanelCollapsed,
        copilotOwnsFocusRef.current,
      )
    ) {
      handoffCopilotFocus(copilotPanelCollapsed, {
        restore: copilotRestoreRef.current,
        composer: copilotComposerRef.current,
        close: copilotCloseRef.current,
      });
    }
    previousCopilotCollapsedRef.current = copilotPanelCollapsed;
  }, [copilotPanelCollapsed]);

  useLayoutEffect(() => {
    activeModelRef.current = { id: model.id, version: model.version };
    turnSequenceRef.current += 1;
    setAnswering(false);
  }, [model, modelRevision]);

  useEffect(() => {
    if (!modelFocus) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.target instanceof Element && event.target.closest('.module-detail-dialog')) return;
      setModelFocus(false);
      requestAnimationFrame(() => focusToggleRef.current?.focus());
    };
    document.addEventListener('keydown', exitOnEscape);
    return () => document.removeEventListener('keydown', exitOnEscape);
  }, [modelFocus]);

  useEffect(() => {
    if (!mobileLayout || !mobileCopilotOpen || modelFocus) return;
    const closeDrawerOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.target instanceof Element && event.target.closest('.module-detail-dialog')) return;
      event.preventDefault();
      setCopilotPanelVisibility(true);
    };
    document.addEventListener('keydown', closeDrawerOnEscape);
    return () => document.removeEventListener('keydown', closeDrawerOnEscape);
  }, [mobileCopilotOpen, mobileLayout, modelFocus]);

  const selectedModule =
    graphComposition.model.modules.find((module) => module.id === selectedModuleId) ??
    graphComposition.model.modules[0];
  if (!selectedModule) throw new Error('model_lab_module_missing');
  const selectedSubgraphTarget = graphComposition.subgraphTargets[selectedModule.id];
  const selectedSubgraphExpanded = graphComposition.expansions.some(
    (expansion) => expansion.parentModuleId === selectedModule.id,
  );
  const activeModuleDetail = moduleDetail?.scopeKey === activeChatSessionKey ? moduleDetail : null;

  const checkpoint = model.connections[0]?.gradient.checkpoints[checkpointIndex] ?? 0;
  const activeTrace = model.connections[0]?.gradient;
  const activeProbeLabels = Object.fromEntries(
    (Object.keys(fallbackProbeLabels) as GradientProbeName[]).map((name) => [
      name,
      activeTrace?.scenarioLabels[name] ?? fallbackProbeLabels[name],
    ]),
  ) as Record<GradientProbeName, string>;
  const scenarioKind = activeTrace?.scenarioKinds[probe] ?? 'design-only';
  const scenarioLabel = activeTrace?.scenarioLabels[probe] ?? 'No scenario metadata is available.';
  const parameterCoverage = parameterCoverageAt(model, probe, checkpointIndex);
  const selectedHealth = moduleGradientHealth(
    graphComposition.model,
    selectedModule.id,
    probe,
    checkpointIndex,
  );
  const incoming = graphComposition.model.connections.filter(
    (connection) => connection.target === selectedModule.id,
  );
  const parameterTotal = model.modules.reduce((total, module) => total + module.parameterCount, 0);
  const selectedCopilotModel = copilotSelection.requestedModelId
    ? copilotCatalog?.models.find(
        (candidate) => candidate.modelId === copilotSelection.requestedModelId,
      )
    : copilotCatalog?.models.find((candidate) => candidate.isDefault);
  const copilotReasoningOptions = selectedCopilotModel?.reasoningOptions ?? [];

  useEffect(() => {
    let current = true;
    void Promise.all([gosuModelLabRuntime.status?.(), gosuModelLabRuntime.listModels?.()])
      .then(([status, catalog]) => {
        if (!current) return;
        if (status) setCopilotStatus(status);
        if (catalog) setCopilotCatalog(catalog);
      })
      .catch(() => {
        if (!current) return;
        setCopilotStatus({
          available: false,
          provider: 'GOSU LLM bridge unavailable',
          model: 'unavailable',
          reasoning: 'unavailable',
        });
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    setReviewing(true);
    void deterministicModelLabRuntime
      .review({
        projectModels: activeModels,
        activeModelId: model.id,
        probe,
        checkpointIndex,
      })
      .then((result) => {
        if (current) setReviews(result);
      })
      .finally(() => {
        if (current) setReviewing(false);
      });
    return () => {
      current = false;
    };
  }, [activeModels, checkpointIndex, model.id, probe, reviewNonce]);

  const registerModel = (candidate: ModelSpec) => {
    const registration = createImportedModelSession(modelRegistryRef.current, candidate);
    const nextModel = registration.model;
    modelRegistryRef.current = registration.models;
    setModels(registration.models);
    setModelRevisions((current) => ({
      ...current,
      [nextModel.id]: 0,
    }));
    setTrashedModelIds((current) => current.filter((candidate) => candidate !== nextModel.id));
    setTrashOpen(false);
    setModelId(nextModel.id);
    return registration;
  };

  const addFiles = async (files: readonly File[]) => {
    if (modelImportInFlightRef.current || files.length === 0) return;
    modelImportInFlightRef.current = true;
    setBuildingModel(true);
    const additions: ModelImportJob[] = [];
    const sourceArtifacts: ModelBuildArtifact[] = [];
    try {
      for (const file of files.slice(0, 8)) {
        if (file.size > MODEL_LAB_MAX_IMPORT_BYTES && file.name.toLowerCase().endsWith('.json')) {
          additions.push({
            id: nextId('model-import'),
            name: file.name,
            status: 'rejected',
            detail: 'ModelIR JSON exceeds the 1 MB limit.',
          });
          continue;
        }
        if (file.name.toLowerCase().endsWith('.json')) {
          const result = parseModelImportJson(await file.text());
          if (result.ok) {
            const registration = registerModel(result.model);
            additions.push({
              id: nextId('model-import'),
              name: file.name,
              status: 'session-created',
              detail: registration.identifierChanged
                ? `Created and opened a separate session as ${registration.model.name}; the imported identifier already existed.`
                : `Created and opened the ${registration.model.name} model session.`,
            });
          } else {
            additions.push({
              id: nextId('model-import'),
              name: file.name,
              status: 'rejected',
              detail: result.reason,
            });
          }
          continue;
        }
        const prepared = await prepareModelBuildArtifact(file);
        if (prepared.ok) sourceArtifacts.push(prepared.artifact);
        else {
          additions.push({
            id: nextId('model-import'),
            name: file.name,
            status: 'rejected',
            detail: prepared.reason,
          });
        }
      }
      if (additions.length > 0) {
        setImportJobs((current) => [...current, ...additions].slice(-8));
      }

      if (sourceArtifacts.length === 0) return;

      const buildId = nextId('model-build');
      const sourceNames = sourceArtifacts.map((artifact) => artifact.name).join(' + ');
      const buildJob: ModelImportJob = {
        id: buildId,
        name: sourceNames,
        status: 'model-building',
        detail: 'Creating a separate model session. The currently open model will not be modified.',
      };
      setImportJobs((current) => [...current, buildJob].slice(-8));
      const result = await codexModelBuilder.build(sourceArtifacts, copilotSelection);
      const registration = registerModel(result.model);
      setImportJobs((current) =>
        current.map((job) =>
          job.id === buildId
            ? {
                ...job,
                status: 'session-created' as const,
                detail: `Created and opened ${registration.model.name}. ${result.trace.join(' · ')}`,
              }
            : job,
        ),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Model reconstruction failed.';
      setImportJobs((current) => {
        const buildingJob = current.find((job) => job.status === 'model-building');
        if (!buildingJob) {
          return [
            ...current,
            {
              id: nextId('model-import'),
              name: files.map((file) => file.name).join(' + '),
              status: 'rejected' as const,
              detail,
            },
          ].slice(-8);
        }
        return current.map((job) =>
          job.id === buildingJob.id ? { ...job, status: 'rejected' as const, detail } : job,
        );
      });
    } finally {
      modelImportInFlightRef.current = false;
      setBuildingModel(false);
    }
  };

  const addCopilotFiles = async (files: readonly File[]) => {
    if (files.length === 0 || answering) return;
    const sessionKey = activeChatSessionKey;
    const sessionModel = model;
    const remaining = MODEL_COPILOT_MAX_ATTACHMENTS - copilotAttachments.length;
    if (remaining <= 0) {
      setCopilotAttachmentNotice(
        `A Model Copilot turn accepts up to ${MODEL_COPILOT_MAX_ATTACHMENTS} files.`,
      );
      return;
    }
    const accepted: ModelCopilotAttachment[] = [];
    const rejected: string[] = [];
    for (const file of files.slice(0, remaining)) {
      const prepared = await prepareModelCopilotAttachment(file);
      if (prepared.ok) {
        accepted.push({ id: nextId('copilot-file'), artifact: prepared.artifact, size: file.size });
      } else {
        rejected.push(`${file.name}: ${prepared.reason}`);
      }
    }
    setChatSessions((current) => {
      const session = current[sessionKey] ?? createModelChatSession(sessionModel);
      return {
        ...current,
        [sessionKey]: {
          ...session,
          attachments: [...session.attachments, ...accepted].slice(
            0,
            MODEL_COPILOT_MAX_ATTACHMENTS,
          ),
        },
      };
    });
    setCopilotAttachmentNotice(
      rejected.length > 0
        ? rejected.join(' · ')
        : `${accepted.length} file${accepted.length === 1 ? '' : 's'} attached to this conversation only.`,
    );
  };

  const submitQuestion = async () => {
    const trimmed = question.trim();
    if ((!trimmed && copilotAttachments.length === 0) || answering) return;
    const submittedQuestion =
      trimmed || 'Analyze the attached files against the selected model graph evidence.';
    const submittedAttachments = [...copilotAttachments];
    const turn: ModelLabTurnScope = {
      sequence: turnSequenceRef.current + 1,
      modelId: model.id,
      modelVersion: model.version,
    };
    turnSequenceRef.current = turn.sequence;
    const turnIsCurrent = () =>
      isCurrentModelLabTurn(turn, turnSequenceRef.current, activeModelRef.current);
    const turnController = new AbortController();
    copilotTurnAbortRef.current?.abort();
    copilotTurnAbortRef.current = turnController;

    setAnswering(true);
    setCopilotProgress([]);
    chatPinnedToBottomRef.current = true;
    setMessages((current) => [
      ...current,
      {
        id: nextId('user'),
        modelId: model.id,
        modelVersion: model.version,
        role: 'user',
        body: submittedQuestion,
        attachmentNames: submittedAttachments.map((attachment) => attachment.artifact.name),
      },
    ]);
    setQuestion('');
    setCopilotAttachments([]);
    setCopilotAttachmentNotice(null);
    try {
      const answer = await gosuModelLabRuntime.answer(
        {
          projectModels: copilotProjectModels,
          activeModelId: model.id,
          selectedModuleId: selectedModule.id,
          probe,
          checkpointIndex,
          question: submittedQuestion,
          attachments: submittedAttachments.map((attachment) => attachment.artifact),
          selection: copilotSelection,
          conversation: messages.slice(-6).map((message) => ({
            role: message.role,
            body: message.body,
          })),
        },
        {
          signal: turnController.signal,
          onProgress: (progress) => {
            if (!turnIsCurrent()) return;
            setCopilotProgress((current) => [...current, progress].slice(-12));
          },
        },
      );
      if (!turnIsCurrent()) return;
      setMessages((current) => [
        ...current,
        {
          id: nextId('assistant'),
          modelId: turn.modelId,
          modelVersion: turn.modelVersion,
          role: 'assistant',
          body: answer.body,
          trace: answer.trace,
          ...(answer.usage ? { usage: answer.usage } : {}),
        },
      ]);
    } catch {
      if (!turnIsCurrent()) return;
      setMessages((current) => [
        ...current,
        {
          id: nextId('assistant-error'),
          modelId: turn.modelId,
          modelVersion: turn.modelVersion,
          role: 'assistant',
          body: turnController.signal.aborted
            ? 'This Model Copilot agent turn was stopped.'
            : MODEL_LAB_RUNTIME_ERROR_MESSAGE,
          trace: [
            `${turn.modelId}@${turn.modelVersion}`,
            turnController.signal.aborted ? 'User stopped agent run' : 'Bounded runtime error',
          ],
        },
      ]);
    } finally {
      if (copilotTurnAbortRef.current === turnController) copilotTurnAbortRef.current = null;
      if (turnIsCurrent()) {
        setAnswering(false);
        setCopilotProgress([]);
      }
    }
  };

  return (
    <main
      ref={shellRef}
      className={modelLabShellClassName(modelFocus, modelSessionsPanelCollapsed)}
      data-model-focus={modelFocus}
      data-resizing-panel={resizingPanel ?? undefined}
      style={
        {
          '--model-session-sidebar-width': `${modelSessionSidebarWidth}px`,
          '--model-copilot-width': `${copilotWidth}px`,
        } as CSSProperties
      }
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        void addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <span className="visually-hidden" aria-live="polite">
        {modelFocus
          ? 'Model focus mode active. Non-visualization panels are hidden. Press Escape to exit.'
          : 'Model focus mode inactive.'}
      </span>
      <aside
        id="model-session-sidebar"
        className={`model-session-sidebar${modelSessionsPanelCollapsed ? ' model-session-sidebar--collapsed' : ''}`}
        aria-label={
          modelSessionsPanelCollapsed
            ? 'Collapsed generated models sidebar'
            : 'Generated models and modules'
        }
      >
        <button
          ref={modelSessionsRestoreRef}
          className="model-session-sidebar__restore"
          type="button"
          aria-label="Restore generated models sidebar"
          hidden={!modelSessionsPanelCollapsed}
          onClick={restoreModelSessions}
        >
          <span aria-hidden="true">→</span>
          <strong>Models</strong>
        </button>
        <header>
          <div>
            <span className="eyebrow">GENERATED MODELS</span>
            <strong>Model sessions</strong>
          </div>
          <div className="model-session-header-actions">
            <span
              className="model-session-count"
              aria-label={`${activeModels.length} active models`}
            >
              {activeModels.length}
            </span>
            <button
              className="model-trash-toggle"
              type="button"
              aria-pressed={trashOpen}
              aria-label={`Trash, ${trashedModels.length} model sessions`}
              onClick={() => {
                setTrashOpen((current) => !current);
                setEmptyTrashArmed(false);
              }}
            >
              Trash {trashedModels.length}
            </button>
            <button
              ref={modelSessionsCollapseRef}
              className="model-session-sidebar__toggle"
              type="button"
              aria-label="Minimize generated models sidebar"
              aria-controls="model-session-sidebar"
              aria-expanded={!modelSessionsPanelCollapsed}
              onClick={collapseModelSessions}
            >
              <span aria-hidden="true">←</span>
            </button>
          </div>
        </header>
        <nav className="model-session-list" aria-label="Generated model sessions">
          {activeModels.map((candidate, index) => {
            const candidateParameterTotal = candidate.modules.reduce(
              (total, module) => total + module.parameterCount,
              0,
            );
            const active = candidate.id === model.id;
            return (
              <div className="model-session-row" key={candidate.id}>
                <button
                  type="button"
                  className={`model-session-select${active ? ' is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    setModelId(candidate.id);
                    setTrashOpen(false);
                  }}
                >
                  <span className="model-session-symbol" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span>
                    <strong>{candidate.name}</strong>
                    <small>
                      {candidate.version} · {candidate.modules.length} modules
                    </small>
                    <small>{candidateParameterTotal.toLocaleString()} parameters</small>
                  </span>
                </button>
                <button
                  className="model-session-trash-action"
                  type="button"
                  aria-label={modelSessionDeleteLabel(candidate.name)}
                  onClick={() => moveModelToTrash(candidate.id)}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </nav>
        {trashOpen ? (
          <section className="model-trash-panel" aria-labelledby="model-trash-title">
            <header>
              <div>
                <span className="eyebrow">TRASH</span>
                <strong id="model-trash-title">Deleted model sessions</strong>
              </div>
              <span
                className="model-session-count"
                aria-label={`${trashedModels.length} trashed models`}
              >
                {trashedModels.length}
              </span>
            </header>
            <p className="model-trash-notice" aria-live="polite">
              {trashNotice || 'Restore a model or permanently remove every model in Trash.'}
            </p>
            {trashedModels.length === 0 ? (
              <p className="model-trash-empty">Trash is empty.</p>
            ) : (
              <ul className="model-trash-list">
                {trashedModels.map((candidate) => (
                  <li key={candidate.id}>
                    <span>
                      <strong>{candidate.name}</strong>
                      <small>{candidate.version}</small>
                    </span>
                    <button
                      className="quiet-button"
                      type="button"
                      onClick={() => restoreModelFromTrash(candidate.id)}
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {trashedModels.length > 0 ? (
              <div className="model-trash-actions">
                {emptyTrashArmed ? (
                  <div className="model-trash-confirmation" role="status">
                    <p>
                      Permanently delete {trashedModels.length} model session
                      {trashedModels.length === 1 ? '' : 's'} and their chat/view state?
                    </p>
                    <div>
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() => setEmptyTrashArmed(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="destructive-button"
                        type="button"
                        onClick={emptyModelTrash}
                      >
                        Delete permanently
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="destructive-button"
                    type="button"
                    onClick={() => setEmptyTrashArmed(true)}
                  >
                    Empty Trash
                  </button>
                )}
              </div>
            ) : null}
          </section>
        ) : (
          <section
            id="active-model-modules"
            className="model-session-modules"
            aria-labelledby="active-model-modules-title"
          >
            <header>
              <span className="eyebrow">ACTIVE MODEL</span>
              <strong id="active-model-modules-title">{model.name} modules</strong>
            </header>
            <nav aria-label={`Modules in ${model.name}`}>
              {graphComposition.model.modules.map((module, index) => {
                const health = moduleGradientHealth(
                  graphComposition.model,
                  module.id,
                  probe,
                  checkpointIndex,
                );
                const nested = graphComposition.expansions.some((expansion) =>
                  expansion.moduleIds.includes(module.id),
                );
                return (
                  <button
                    key={module.id}
                    type="button"
                    className={`${module.id === selectedModule.id ? 'is-active' : ''}${nested ? ' is-submodule' : ''}`}
                    aria-current={module.id === selectedModule.id ? 'true' : undefined}
                    onClick={() => {
                      setSelectedModuleId(module.id);
                      if (['pre-norm', 'residual-mlp', 'skip', 'merge'].includes(module.id)) {
                        setGraphDetail('expanded');
                      }
                    }}
                  >
                    <span className={`index-health index-health--${health}`} aria-hidden="true" />
                    <span>
                      <small>
                        {nested ? '↳ ' : ''}
                        {String(index + 1).padStart(2, '0')} · {module.group}
                      </small>
                      <strong>{module.name}</strong>
                      <code>{formatShape(module.outputShape)}</code>
                    </span>
                  </button>
                );
              })}
            </nav>
          </section>
        )}
        <footer>
          {importJobs.length > 0 ? (
            <section className="model-import-activity" aria-label="New model import activity">
              <strong>Separate model sessions</strong>
              {importJobs.slice(-3).map((job) => (
                <article
                  key={job.id}
                  className={`model-import-job model-import-job--${job.status}`}
                >
                  <span>{job.name}</span>
                  <small>{job.detail}</small>
                  {job.status !== 'model-building' ? (
                    <button
                      type="button"
                      aria-label={`Dismiss import status for ${job.name}`}
                      onClick={() =>
                        setImportJobs((current) =>
                          current.filter((candidate) => candidate.id !== job.id),
                        )
                      }
                    >
                      Dismiss
                    </button>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}
          <AttachmentInput
            onFiles={addFiles}
            label={buildingModel ? 'Creating new session…' : '+ New / Import model'}
            disabled={buildingModel}
          />
          <small className="model-import-boundary">
            Always creates a separate model session; it never attaches to or replaces the current
            model.
          </small>
        </footer>
      </aside>

      <div
        className="panel-resizer panel-resizer--model-sessions"
        role="separator"
        aria-label="Resize generated models sidebar"
        aria-orientation="vertical"
        aria-valuemin={MODEL_SESSION_SIDEBAR_MIN_WIDTH}
        aria-valuemax={panelMaximum('model-sessions')}
        aria-valuenow={modelSessionSidebarWidth}
        aria-valuetext={`${modelSessionSidebarWidth} pixels`}
        tabIndex={0}
        hidden={modelSessionsPanelCollapsed || stackedSessionLayout || modelFocus}
        onPointerDown={(event) =>
          beginPanelResize(event, 'model-sessions', modelSessionSidebarWidth)
        }
        onPointerMove={continuePanelResize}
        onPointerUp={endPanelResize}
        onPointerCancel={endPanelResize}
        onKeyDown={(event) =>
          resizePanelWithKeyboard(
            event,
            'model-sessions',
            modelSessionSidebarWidth,
            MODEL_SESSION_SIDEBAR_MIN_WIDTH,
          )
        }
      />

      <div className="model-lab-content">
        <header className="model-lab-header">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">
              M
            </div>
            <div>
              <span className="eyebrow">GOSU MODEL LAB · STANDALONE PROTOTYPE</span>
              <h1>Make the model inspectable, not just executable.</h1>
            </div>
          </div>
          <div className="header-actions">
            <span className="runtime-status">
              <span aria-hidden="true" />{' '}
              {copilotStatus === null
                ? 'Checking GOSU Model Copilot bridge'
                : copilotStatus.available
                  ? `Model Copilot · ${selectedCopilotModel?.displayName ?? copilotStatus.model}`
                  : 'GOSU Model Copilot bridge unavailable'}
            </span>
          </div>
        </header>

        <section className="prototype-boundary" role="note" aria-label="Prototype boundary">
          <strong>Live in this spike</strong>
          <span>
            ModelIR import plus Codex reconstruction from Python, diagrams, PDFs, Word documents,
            Markdown, and text; interactive graph, deterministic checks, PyTorch evidence, and LLM
            Copilot
          </span>
          <strong>Adapter boundary</strong>
          <span>
            generated architectures are static evidence until GOSU Agent Runtime attaches execution
            and gradient receipts
          </span>
        </section>

        <section className="workspace-bar" aria-label="Active model and review status">
          <div className="model-summary">
            <strong>{model.name}</strong>
            <span>{model.version}</span>
            <span>{model.framework}</span>
            <span>{model.modules.length} modules</span>
            <span>{parameterTotal.toLocaleString()} parameters</span>
            <span>{activeModels.length} active project models</span>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => setReviewNonce((value) => value + 1)}
          >
            Run deterministic checks
          </button>
        </section>

        <div className={modelLabWorkbenchClassName(copilotPanelCollapsed)}>
          <div className="model-lab-primary">
            <div className="model-lab-grid">
              <section className="graph-workspace" aria-label="Interactive model visualization">
                <div className="graph-toolbar">
                  <div className="segmented-control" aria-label="Graph detail">
                    <button
                      type="button"
                      className={graphDetail === 'overview' ? 'is-active' : ''}
                      aria-pressed={graphDetail === 'overview'}
                      onClick={() => setGraphDetail('overview')}
                    >
                      Overview
                    </button>
                    <button
                      type="button"
                      className={graphDetail === 'expanded' ? 'is-active' : ''}
                      aria-pressed={graphDetail === 'expanded'}
                      onClick={() => setGraphDetail('expanded')}
                    >
                      Expanded modules
                    </button>
                  </div>
                  <div className="segmented-control" aria-label="Signal visualization">
                    <button
                      type="button"
                      className={signalMode === 'forward' ? 'is-active' : ''}
                      aria-pressed={signalMode === 'forward'}
                      onClick={() => setSignalMode('forward')}
                    >
                      Forward tensors
                    </button>
                    <button
                      type="button"
                      className={signalMode === 'backward' ? 'is-active' : ''}
                      aria-pressed={signalMode === 'backward'}
                      onClick={() => setSignalMode('backward')}
                    >
                      Backward gradients
                    </button>
                  </div>
                  <label>
                    <span>Gradient scenario</span>
                    <select
                      value={probe}
                      onChange={(event) => setProbe(event.target.value as GradientProbeName)}
                    >
                      {Object.entries(activeProbeLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span
                    className={`scenario-kind scenario-kind--${scenarioKind}`}
                    title={scenarioLabel}
                  >
                    {scenarioKind}
                  </span>
                  <label className="checkpoint-control">
                    <span>
                      {scenarioKind === 'pytorch-observed'
                        ? 'Seeded PyTorch probe'
                        : 'Scenario checkpoint'}
                      {' · '}batch {checkpoint} / 5
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={4}
                      step={1}
                      value={checkpointIndex}
                      onChange={(event) => setCheckpointIndex(Number(event.target.value))}
                    />
                  </label>
                  <button
                    ref={focusToggleRef}
                    className="quiet-button focus-mode-toggle"
                    type="button"
                    aria-pressed={modelFocus}
                    aria-keyshortcuts={modelFocus ? 'Escape' : undefined}
                    onClick={() => setModelFocus((current) => !current)}
                  >
                    <span aria-hidden="true">{modelFocus ? '↙' : '⛶'}</span>
                    {modelFocus ? 'Exit focus' : 'Focus graph'}
                  </button>
                </div>
                <ModelGraph
                  key={modelGraphInstanceKey(
                    model.id,
                    modelRevision,
                    modelFocus,
                    expandedSubgraphModuleIds,
                    modelSessionsPanelCollapsed,
                    copilotPanelCollapsed,
                  )}
                  composition={graphComposition}
                  selectedModuleId={selectedModule.id}
                  probe={probe}
                  checkpointIndex={checkpointIndex}
                  signalMode={signalMode}
                  focusMode={modelFocus}
                  openModuleId={activeModuleDetail?.module.id ?? null}
                  onSelectModule={setSelectedModuleId}
                  onOpenModule={openModuleDetail}
                  onToggleSubgraph={toggleSubgraph}
                />
                <div className="gradient-legend" aria-label="Gradient health legend">
                  <span>
                    <i className="legend-good" /> Healthy
                  </span>
                  <span>
                    <i className="legend-low" /> Vanishing
                  </span>
                  <span>
                    <i className="legend-bad" /> Blocked / exploding
                  </span>
                  <span>
                    <i className="legend-na" /> Not differentiable
                  </span>
                  <strong>{activeProbeLabels[probe]}</strong>
                </div>
              </section>

              <aside className="module-inspector" aria-labelledby="inspector-title">
                <div className="inspector-heading">
                  <div>
                    <span className="eyebrow">MODULE INSPECTOR</span>
                    <h2 id="inspector-title">{selectedModule.name}</h2>
                  </div>
                  <span className={`health-chip health-chip--${selectedHealth}`}>
                    {selectedHealth}
                  </span>
                </div>
                <p>{selectedModule.explanation}</p>
                {selectedSubgraphTarget ? (
                  <button
                    className="primary-button inspector-subgraph-toggle"
                    type="button"
                    aria-expanded={selectedSubgraphExpanded}
                    onClick={() => toggleSubgraph(selectedModule.id)}
                  >
                    {selectedSubgraphExpanded ? 'Collapse' : 'Expand'}{' '}
                    {selectedSubgraphTarget.modelName} · {selectedSubgraphTarget.moduleCount}{' '}
                    submodules {selectedSubgraphExpanded ? '↑' : 'inside this graph ↓'}
                  </button>
                ) : null}
                <dl className="module-facts">
                  <div>
                    <dt>Input</dt>
                    <dd>{formatShape(selectedModule.inputShape)}</dd>
                  </div>
                  <div>
                    <dt>Output</dt>
                    <dd>{formatShape(selectedModule.outputShape)}</dd>
                  </div>
                  <div>
                    <dt>Transform</dt>
                    <dd>{selectedModule.transform}</dd>
                  </div>
                  <div>
                    <dt>Activation</dt>
                    <dd>{selectedModule.activation ?? 'None'}</dd>
                  </div>
                  {selectedModule.repeat ? (
                    <div>
                      <dt>Repeated stack</dt>
                      <dd>
                        {selectedModule.repeat.count} × {selectedModule.repeat.label}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Parameters</dt>
                    <dd>{selectedModule.parameterCount.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Code</dt>
                    <dd>
                      <code>{selectedModule.codeReference}</code>
                    </dd>
                  </div>
                </dl>
                <section className="formula-panel" aria-label="Module formula">
                  <span>Module equation</span>
                  <Formula latex={selectedModule.formula} />
                </section>
                <section className="gradient-detail" aria-label="Incoming gradient evidence">
                  <div>
                    <strong>Backward evidence</strong>
                    <span>probe batch {checkpoint}</span>
                  </div>
                  {incoming.length === 0 ? (
                    <p>No incoming gradient probe at the model boundary.</p>
                  ) : (
                    incoming.map((connection) => (
                      <div key={connection.id} className="gradient-reading">
                        <span>{connection.tensorName}</span>
                        <strong>
                          {gradientStateAt(connection, probe, checkpointIndex) === 'observed'
                            ? formatNorm(gradientAt(connection, probe, checkpointIndex))
                            : gradientStateAt(connection, probe, checkpointIndex)}
                        </strong>
                      </div>
                    ))
                  )}
                  {parameterCoverage ? (
                    <div className="gradient-coverage">
                      <strong>
                        {parameterCoverage.observed.tensors}/{parameterCoverage.denominator.tensors}
                      </strong>
                      <span>trainable tensors with observed gradients</span>
                      <small>
                        {parameterCoverage.observed.elements.toLocaleString()} /{' '}
                        {parameterCoverage.denominator.elements.toLocaleString()} parameter elements
                      </small>
                    </div>
                  ) : (
                    <p className="gradient-coverage-empty">
                      Parameter-gradient coverage not observed.
                    </p>
                  )}
                </section>
              </aside>
            </div>

            <div className="lower-grid">
              <ModelIntentPanel model={model} />
              <section className="agent-review" aria-labelledby="review-title">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">
                      DETERMINISTIC REVIEW · RUN {reviewNonce} {reviewing ? '· CHECKING' : ''}
                    </span>
                    <h2 id="review-title">Four bounded consistency checks</h2>
                  </div>
                  <span className="review-topology">No LLM reviewers in this visual spike</span>
                </div>
                <div className="review-grid">
                  {reviews.map((review) => (
                    <ReviewCard key={review.id} review={review} />
                  ))}
                </div>
              </section>
            </div>
          </div>

          <div
            className="panel-resizer panel-resizer--copilot"
            role="separator"
            aria-label="Resize Model Copilot sidebar"
            aria-orientation="vertical"
            aria-valuemin={MODEL_COPILOT_MIN_WIDTH}
            aria-valuemax={panelMaximum('copilot')}
            aria-valuenow={copilotWidth}
            aria-valuetext={`${copilotWidth} pixels`}
            tabIndex={0}
            hidden={copilotPanelCollapsed || stackedWorkbenchLayout || modelFocus}
            onPointerDown={(event) => beginPanelResize(event, 'copilot', copilotWidth)}
            onPointerMove={continuePanelResize}
            onPointerUp={endPanelResize}
            onPointerCancel={endPanelResize}
            onKeyDown={(event) =>
              resizePanelWithKeyboard(event, 'copilot', copilotWidth, MODEL_COPILOT_MIN_WIDTH)
            }
          />

          <aside
            ref={copilotPanelRef}
            id="model-copilot-panel"
            className={`model-chat model-chat--sidebar${copilotPanelCollapsed ? ' model-chat--collapsed' : ''}`}
            aria-labelledby="chat-title"
          >
            <header {...copilotContentA11y}>
              <div>
                <span className="eyebrow">MODEL COPILOT</span>
                <h2 id="chat-title">Ask against the selected graph evidence</h2>
              </div>
              <button
                ref={copilotCloseRef}
                className="model-chat__toggle"
                type="button"
                aria-label="Minimize Model Copilot"
                aria-controls="model-copilot-panel"
                aria-expanded={!copilotPanelCollapsed}
                onClick={() => setCopilotPanelVisibility(true)}
              >
                <span aria-hidden="true">→</span>
              </button>
            </header>
            <div className="model-chat__runtime" {...copilotContentA11y}>
              <p className="model-chat__scope">
                {copilotStatus === null
                  ? 'Connecting to the GOSU-compatible LLM bridge · per-model conversation'
                  : copilotStatus.available
                    ? `${copilotStatus.provider} · attached evidence stays turn-scoped`
                    : 'LLM bridge unavailable · deterministic fallback disabled'}
              </p>
              <div className="model-chat__model-controls">
                <label>
                  Model
                  <select
                    aria-label="Model Copilot model"
                    value={copilotSelection.requestedModelId ?? ''}
                    disabled={answering || copilotCatalog === null}
                    onChange={(event) =>
                      setCopilotSelection({
                        requestedModelId: event.target.value || null,
                        reasoningOptionId: null,
                      })
                    }
                  >
                    <option value="">Auto · GOSU recommended</option>
                    {copilotCatalog?.models.map((candidate) => (
                      <option
                        key={`${candidate.providerId}:${candidate.modelId}`}
                        value={candidate.modelId}
                      >
                        {candidate.providerId} · {candidate.displayName}
                        {candidate.isDefault ? ' · default' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Reasoning
                  <select
                    aria-label="Model Copilot reasoning"
                    value={copilotSelection.reasoningOptionId ?? ''}
                    disabled={answering || copilotReasoningOptions.length === 0}
                    onChange={(event) =>
                      setCopilotSelection((current) => ({
                        ...current,
                        reasoningOptionId: event.target.value || null,
                      }))
                    }
                  >
                    <option value="">Model default</option>
                    {copilotReasoningOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                        {option.isDefault ? ' · default' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {answering && copilotProgress.length > 0 ? (
                <ol
                  className="model-chat__agent-progress"
                  aria-label="Live Model Copilot agent activity"
                  role="status"
                >
                  {copilotProgress.map((progress, index) => (
                    <li
                      key={`${progress.step}:${progress.phase}:${progress.tool ?? 'reason'}:${index}`}
                    >
                      <strong>
                        Step {progress.step}
                        {progress.tool ? ` · ${progress.tool.replaceAll('_', ' ')}` : ''}
                      </strong>
                      <span>
                        {progress.phase === 'thinking'
                          ? 'Reasoning'
                          : progress.phase === 'tool_started'
                            ? 'Running'
                            : progress.phase === 'final'
                              ? 'Finalizing'
                              : progress.success === false
                                ? 'Failed'
                                : 'Receipt reviewed'}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
            <div
              ref={chatBodyRef}
              className="chat-body"
              role="log"
              aria-label="Model Copilot conversation history"
              aria-live="polite"
              tabIndex={0}
              {...copilotContentA11y}
              onScroll={(event) => {
                const viewport = event.currentTarget;
                chatPinnedToBottomRef.current =
                  viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 32;
              }}
            >
              {messages.map((message) => (
                <article key={message.id} className={`chat-message chat-message--${message.role}`}>
                  <strong>{message.role === 'user' ? 'You' : 'Model Copilot'}</strong>
                  <ModelChatMarkdown source={message.body} />
                  {message.attachmentNames && message.attachmentNames.length > 0 ? (
                    <ul
                      className="chat-message__attachments"
                      aria-label="Files sent with this message"
                    >
                      {message.attachmentNames.map((name, index) => (
                        <li key={`${name}-${index}`}>{name}</li>
                      ))}
                    </ul>
                  ) : null}
                  <span className="chat-message__provenance">
                    {message.modelId} · {message.modelVersion}
                  </span>
                  {message.trace ? <small>{message.trace.join(' → ')}</small> : null}
                  {message.usage ? (
                    <small className="chat-message__usage">
                      {message.usage.inputTokens.toLocaleString()} input ·{' '}
                      {message.usage.outputTokens.toLocaleString()} output ·{' '}
                      {message.usage.cachedReadTokens.toLocaleString()} cached tokens
                    </small>
                  ) : null}
                </article>
              ))}
            </div>
            <div
              className="chat-composer"
              {...copilotContentA11y}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                event.stopPropagation();
              }}
              onDrop={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                event.stopPropagation();
                void addCopilotFiles(Array.from(event.dataTransfer.files));
              }}
            >
              {copilotAttachments.length > 0 ? (
                <ul
                  className="model-chat__attachment-queue"
                  aria-label="Files attached to the next Model Copilot message"
                >
                  {copilotAttachments.map((attachment) => (
                    <li key={attachment.id}>
                      <span>
                        <strong>{attachment.artifact.name}</strong>
                        <small>
                          {attachment.artifact.kind} ·{' '}
                          {Math.max(1, Math.round(attachment.size / 1024))} KB
                        </small>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${attachment.artifact.name} from Model Copilot message`}
                        onClick={() =>
                          setCopilotAttachments(
                            copilotAttachments.filter(
                              (candidate) => candidate.id !== attachment.id,
                            ),
                          )
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {copilotAttachmentNotice ? (
                <p className="model-chat__attachment-notice" role="status">
                  {copilotAttachmentNotice}
                </p>
              ) : null}
              <textarea
                ref={copilotComposerRef}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void submitQuestion();
                  }
                }}
                placeholder="Ask about a dimension, formula, code mapping, or gradient path…"
                aria-label="Ask Model Copilot"
              />
              <div className="model-chat__composer-actions">
                <ModelCopilotAttachmentInput
                  onFiles={addCopilotFiles}
                  disabled={answering || copilotAttachments.length >= MODEL_COPILOT_MAX_ATTACHMENTS}
                />
                <button
                  className={answering ? 'model-chat__stop-button' : 'primary-button'}
                  type="button"
                  onClick={() => {
                    if (answering) copilotTurnAbortRef.current?.abort();
                    else void submitQuestion();
                  }}
                  disabled={!answering && !question.trim() && copilotAttachments.length === 0}
                >
                  {answering ? 'Stop' : 'Ask'}
                </button>
              </div>
            </div>
            <button
              ref={copilotRestoreRef}
              className="model-chat__restore"
              type="button"
              aria-label="Restore Model Copilot"
              aria-controls="model-copilot-panel"
              aria-expanded={!copilotPanelCollapsed}
              {...copilotRestoreA11y}
              onClick={() => setCopilotPanelVisibility(false)}
            >
              <span aria-hidden="true">←</span>
              <strong>Model Copilot</strong>
            </button>
          </aside>
        </div>
      </div>
      {activeModuleDetail ? (
        <ModuleDetailDialog
          model={activeModuleDetail.graphModel}
          module={activeModuleDetail.module}
          probe={probe}
          checkpointIndex={checkpointIndex}
          onClose={closeModuleDetail}
          {...(() => {
            const target = graphComposition.subgraphTargets[activeModuleDetail.module.id];
            if (!target) return {};
            return {
              subgraphAction: {
                modelName: target.modelName,
                moduleCount: target.moduleCount,
                expanded: graphComposition.expansions.some(
                  (expansion) => expansion.parentModuleId === activeModuleDetail.module.id,
                ),
                onToggle: () => toggleSubgraph(activeModuleDetail.module.id),
              },
            };
          })()}
        />
      ) : null}
    </main>
  );
}
