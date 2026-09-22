import { uiText, useUiLanguage, useUiText, uiLocale } from '@gosu/ui/language';
import { beginAiActivity, trackAiActivity } from '@gosu/ui/ai-activity';
import {
  holdScrollTarget,
  restoreScrollWhenShown,
  type ScrollTarget,
} from '@gosu/ui/scroll-settle';
import {
  AgentPermanentMemoryEntrySchema,
  createAgentPermanentMemoryEntry,
  planAgentContextBudget,
  selectAgentPermanentMemories,
  selectCatalogModel,
  resolveCatalogReasoning,
  startModelCatalogAutoRefresh,
  type AgentPermanentMemoryEntry,
  type ModelCatalog,
} from '@gosu/contracts';
import {
  Fragment,
  useEffect,
  useCallback,
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
import {
  legacyModuleQuestion,
  loopParentModule,
  moduleConversationBody,
  moduleDataFlow,
  moduleDetailNeighbors,
  moduleExplanationQuestion,
  moduleFollowUpQuestion,
  moduleQuestionRef,
  type ModuleFlowEntry,
  type ModuleQuestionRef,
} from './module-detail-flow';
import {
  MODULE_EXPLANATIONS_STORAGE_KEY,
  moduleExplanation,
  moduleExplanationKey,
  readModuleExplanations,
  withModuleExplanation,
  type ModuleExplanation,
} from './module-explanations';
import { moduleReading } from './module-explanation-text';
import {
  PaperSummarySaveOffer,
  type PaperSaveReplyHandler,
} from '../../briefing-lab/src/paper-summary-offer';
import type { PaperSummarySaveReceipt } from '../../briefing-lab/src/paper-summary-contract';
import { ModelChatComposer } from './model-chat-composer';
import {
  modelChatCommandFailure,
  modelChatCommandFinished,
  modelChatCommandRunning,
  modelChatContextDividerText,
  modelChatContextStart,
  modelChatSubmission,
  type ModelChatCommandState,
} from './model-chat-commands';
import type { ChatSlashCommand } from '@gosu/ui/chat-slash-commands';
import { useModelChatRuns } from './model-chat-runs';
import { ModelReferenceActions } from './model-reference-actions';
import { englishGraphName } from './graph-presentation';
import { ContextUsageMeter } from '../../briefing-lab/src/context-usage-meter';
import type { ContextUsage } from '../../briefing-lab/src/context-usage';
import { modelLabHostConfiguration, modelLabStorage, modelLabFetch } from './model-lab-environment';
import {
  loadModelLabChats,
  saveModelLabChats,
  modelLabConversationWorkspace,
} from './model-lab-chat-storage';
import {
  composeModelSubgraphs,
  findGraphModule,
  ModelGraph,
  modelFormulaAuditScope,
  overviewModel,
  repeatedModuleStepStatements,
  type ModelGraphChangeHighlight,
} from './model-graph';
import {
  codexModelBuilder,
  prepareModelCopilotAttachment,
  prepareModelBuildArtifact,
  type ModelBuildArtifact,
  type ModelBuildProgress,
} from './model-lab-builder';
import {
  readModelImportHistory,
  writeModelImportHistory,
  type ModelImportJob,
  type ModelImportPhase,
} from './model-import-history';
import { MODEL_LAB_MAX_IMPORT_BYTES, parseModelImportJson } from './model-lab-import';
import {
  modelPythonArtifactClient,
  modelPythonArtifactKey,
  type ModelPythonArtifact,
} from './model-python-artifact';
import {
  appendModelPseudocodeRevision,
  attachModelPythonArtifact,
  classifyModelPseudocodeUpdate,
  initialModelPseudocodeRevision,
  initialModelPseudocodeWorkspace,
  MODEL_PSEUDOCODE_LLM_GUIDE,
  MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
  modelPseudocodeRevisionRows,
  modelPseudocodeChangeSummary,
  modelPseudocodeLineDiffHunks,
  modelPseudocodeLineDiffSummary,
  modelPseudocodeNarrativeReconciliationIssues,
  modelPseudocodeNarrativeReconciliationModuleIds,
  modelPseudocodeRevisionCommentPrompt,
  modelPseudocodeNormalizer,
  modelToPseudocode,
  restoreModelPseudocodeWorkspace,
  serializeModelPseudocodeWorkspace,
  type ModelPseudocodeRevision,
} from './model-pseudocode';
import {
  formatNorm,
  formatModuleInputContract,
  formatModuleOutputContract,
  formatShape,
  gradientAt,
  gradientStateAt,
  moduleGradientHealth,
  parameterCoverageAt,
} from './model-lab-domain';
import {
  deterministicModelLabRuntime,
  gosuModelLabRuntime,
  modelLabRuntimeErrorDetail,
  modelLabRuntimeErrorMessage,
  type ModelLabRuntimeStatus,
  type ModelLabModelSelection,
  type ModelLabTurnScope,
} from './model-lab-runtime-adapter';
import type { AgentReview, GradientProbeName, ModelModule, ModelSpec } from './model-lab-schema';
import type { ModelLabAgentUsage } from './model-lab-agent-harness';
import {
  EMPTY_MODEL_LAB_DISPLAY,
  EMPTY_MODEL_MODULE_DISPLAY,
  projectModelLabInitialWorkspace,
  defaultModelLabModels,
} from './project-model-workspace';
import {
  projectModelCopies,
  mergeProjectModelCopies,
  PROJECT_MODEL_RECEIVED_COPIES_KEY,
} from './project-model-transfer';
import { ProjectModelCopyDialog } from './project-model-copy-dialog';
import {
  ModelLabLanguageSettings,
  useModelLabLanguagePreference,
  modelLabReviewSummary,
} from './model-lab-language';

export type ChatMessage = Readonly<{
  id: string;
  modelId: string;
  modelVersion: string;
  createdAt: string;
  role: 'user' | 'assistant';
  body: string;
  /** Set when the turn was asked from a module's detail; the body is then the question itself. */
  moduleRef?: ModuleQuestionRef;
  attachmentNames?: readonly string[];
  trace?: readonly string[];
  usage?: ModelLabAgentUsage;
  contextUsage?: ContextUsage;
}>;

/** What a Assistant message shows: a module question reads as the question, not its whole prompt. */
export function chatMessageDisplay(message: Pick<ChatMessage, 'role' | 'body' | 'moduleRef'>) {
  const legacy =
    message.moduleRef || message.role !== 'user' ? null : legacyModuleQuestion(message.body);
  return {
    moduleRef: message.moduleRef ?? legacy?.ref ?? null,
    body: legacy ? (legacy.question ?? uiText('Explain this module in detail.')) : message.body,
  };
}

/** Which module a Assistant message was asked from, with one line on what that module is. */
export function ModuleQuestionTag({
  reference,
  current = false,
  onOpen,
}: Readonly<{
  reference: ModuleQuestionRef;
  current?: boolean;
  onOpen?: (() => void) | undefined;
}>) {
  const label = (
    <>
      <span aria-hidden="true">◆</span>
      <strong>{reference.name}</strong>
      {reference.location && reference.location !== reference.name ? (
        <small>{reference.location}</small>
      ) : null}
    </>
  );
  return (
    <div className={`module-question-tag${current ? ' module-question-tag--current' : ''}`}>
      <span className="module-question-tag__eyebrow">
        {reference.kind === 'explain'
          ? uiText('Module explanation requested')
          : uiText('Asked from module detail')}
      </span>
      {onOpen ? (
        <button
          type="button"
          className="module-question-tag__module"
          title={uiText('Open this module detail')}
          onClick={onOpen}
        >
          {label}
        </button>
      ) : (
        <span className="module-question-tag__module">{label}</span>
      )}
      {reference.summary ? <p>{reference.summary}</p> : null}
    </div>
  );
}

export type ModelCopilotAttachment = Readonly<{
  id: string;
  artifact: ModelBuildArtifact;
  size: number;
}>;

export type ModelChatSession = Readonly<{
  draft: string;
  attachments: readonly ModelCopilotAttachment[];
  messages: readonly ChatMessage[];
  /** Where "/new" put the divider: earlier messages stay visible but leave the model context. */
  contextStartsAt?: number;
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

type ModelPythonArtifactState = Readonly<{
  status: 'loading' | 'generating' | 'ready' | 'failed';
  artifact?: ModelPythonArtifact;
  error?: string;
}>;

type ModelPseudocodeUpdateLogEntry = Readonly<{
  id: string;
  createdAt: string;
  phase: 'reading' | 'interpreting' | 'review' | 'updating' | 'complete' | 'error';
  message: string;
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

export function modelCopilotProviderLabel(providerId: string) {
  if (providerId === 'codex') return 'OpenAI · Codex';
  if (providerId === 'claude-code') return 'Anthropic · Claude Code';
  if (providerId === 'hermes') return 'Hermes Agent';
  return providerId;
}

export function modelImportPhaseLabel(phase: ModelImportPhase) {
  if (phase === 'cancelled') return uiLocale().startsWith('ko') ? '중단됨' : 'STOPPED';
  return uiText(
    {
      'cache-checking': 'CHECKING CANONICAL CACHE',
      'cache-hit': 'CANONICAL CACHE HIT',
      'cache-miss': 'NEW CANONICAL BUILD',
      'local-validation': 'LOCAL VALIDATION',
      'request-validated': 'REQUEST ACCEPTED',
      'selection-resolved': 'LLM SELECTED',
      'sources-preparing': 'PREPARING SOURCES',
      'sources-prepared': 'SOURCES READY',
      'llm-running': 'LLM RUNNING',
      'model-ir-validating': 'VALIDATING MODELIR',
      'model-ir-repairing': 'CORRECTING MODELIR',
      'model-ir-validated': 'MODELIR VALIDATED',
      'registering-session': 'REGISTERING',
      complete: 'CREATED',
      failed: 'FAILED',
    }[phase],
  );
}

export function modelImportJobAfterProgress(
  job: ModelImportJob,
  progress: ModelBuildProgress,
): ModelImportJob {
  const providerLabel = progress.providerId ? modelCopilotProviderLabel(progress.providerId) : null;
  const runLabel = progress.modelLabel
    ? [providerLabel, progress.modelLabel, progress.reasoning].filter(Boolean).join(' · ')
    : job.runLabel;
  return {
    ...job,
    phase: progress.phase,
    detail: progress.message,
    runLabel,
    events: [...job.events, progress.message]
      .filter((message, index, messages) => index === 0 || message !== messages[index - 1])
      .slice(-4),
  };
}

function nextId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function modelPythonDownloadName(modelName: string, revision: number) {
  const slug =
    modelName
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 64) || 'model';
  return `${slug}-r${revision}.py`;
}

export function pseudocodeLineOffset(source: string, lineNumber: number) {
  if (lineNumber <= 1) return 0;
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  return lines
    .slice(0, Math.min(lines.length, lineNumber - 1))
    .reduce((offset, line) => offset + line.length + 1, 0);
}

export function formatModelChatTime(createdAt: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(uiLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function modelChatScrollState({
  scrollTop,
  scrollHeight,
  clientHeight,
}: Readonly<{
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}>) {
  const maximum = Math.max(0, scrollHeight - clientHeight);
  return {
    canScroll: maximum > 1,
    atTop: scrollTop <= 1,
    nearBottom: maximum - scrollTop <= 32,
  } as const;
}

export type ModelChatReadingPosition = Readonly<{ top: number; atBottom: boolean }>;

/** Where a conversation opens: where the reader left it, or at the latest message. */
export function modelChatScrollTarget(
  position: ModelChatReadingPosition | undefined,
): ScrollTarget {
  return !position || position.atBottom
    ? { kind: 'bottom' }
    : { kind: 'offset', top: position.top };
}

/**
 * A scroll event only tells where the reader is while the chat has a box and nothing is moving it
 * for them: a hidden pane reports 0, and a position being put back is not the reader's.
 */
export function modelChatReadingPositionFromScroll(
  viewport: Readonly<{ scrollTop: number; scrollHeight: number; clientHeight: number }>,
  restoring: boolean,
): ModelChatReadingPosition | null {
  if (restoring || viewport.clientHeight <= 0) return null;
  return { top: viewport.scrollTop, atBottom: modelChatScrollState(viewport).nearBottom };
}

export const MODEL_SESSION_SIDEBAR_MIN_WIDTH = 190;
export const MODEL_SESSION_SIDEBAR_MAX_WIDTH = 420;
export const MODEL_SESSION_SIDEBAR_DEFAULT_WIDTH = 252;
export const MODEL_COPILOT_MIN_WIDTH = 300;
export const MODEL_COPILOT_MAX_WIDTH = 620;
export const MODEL_COPILOT_DEFAULT_WIDTH = 390;
export const MODEL_LAB_PRIMARY_MIN_WIDTH = 520;
export const MODEL_COPILOT_MAX_ATTACHMENTS = 6;
export const MODEL_LAB_MEMORY_STORAGE_KEY = 'gosu.model-lab.permanent-memory.v1';
export const MODEL_LAB_MEMORY_STORAGE_MAX_CHARACTERS = 900_000;
const MODEL_LAB_MEMORY_STORAGE_MAX_READ_CHARACTERS = 4_000_000;

export function boundModelLabPermanentMemory(
  entries: readonly AgentPermanentMemoryEntry[],
): readonly AgentPermanentMemoryEntry[] {
  const candidates = entries.slice(-1_000);
  const selected: AgentPermanentMemoryEntry[] = [];
  let characters = 2;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const entry = candidates[index]!;
    const entryCharacters = JSON.stringify(entry).length + (selected.length > 0 ? 1 : 0);
    if (characters + entryCharacters > MODEL_LAB_MEMORY_STORAGE_MAX_CHARACTERS) continue;
    selected.unshift(entry);
    characters += entryCharacters;
  }
  return selected;
}

export function restoreModelLabPermanentMemory(text: string | null) {
  if (!text || text.length > MODEL_LAB_MEMORY_STORAGE_MAX_READ_CHARACTERS) {
    return [] as readonly AgentPermanentMemoryEntry[];
  }
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    return boundModelLabPermanentMemory(
      value.slice(-1_000).flatMap((entry) => {
        const parsed = AgentPermanentMemoryEntrySchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      }),
    );
  } catch {
    return [];
  }
}

export function persistModelLabPermanentMemory(
  storage: Pick<Storage, 'setItem'>,
  entries: readonly AgentPermanentMemoryEntry[],
) {
  try {
    storage.setItem(
      MODEL_LAB_MEMORY_STORAGE_KEY,
      JSON.stringify(boundModelLabPermanentMemory(entries)),
    );
    return 'saved' as const;
  } catch {
    return 'failed' as const;
  }
}

export function loadModelLabPermanentMemory(storage: Pick<Storage, 'getItem'> | null) {
  if (!storage)
    return { entries: [] as readonly AgentPermanentMemoryEntry[], status: 'saved' as const };
  try {
    return {
      entries: restoreModelLabPermanentMemory(storage.getItem(MODEL_LAB_MEMORY_STORAGE_KEY)),
      status: 'saved' as const,
    };
  } catch {
    return { entries: [] as readonly AgentPermanentMemoryEntry[], status: 'failed' as const };
  }
}

export function loadModelLabPermanentMemoryFromBrowser(
  browserWindow: Pick<Window, 'localStorage'>,
) {
  try {
    return loadModelLabPermanentMemory(browserWindow.localStorage);
  } catch {
    return { entries: [] as readonly AgentPermanentMemoryEntry[], status: 'failed' as const };
  }
}

export function persistModelLabPermanentMemoryToBrowser(
  browserWindow: Pick<Window, 'localStorage'>,
  entries: readonly AgentPermanentMemoryEntry[],
) {
  try {
    return persistModelLabPermanentMemory(browserWindow.localStorage, entries);
  } catch {
    return 'failed' as const;
  }
}

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

/**
 * The sidebar footer (import status, builder LLM, import button) shares the sidebar's height with
 * the model tree. Dragging its top edge up gives it more room; the tree keeps the rest.
 */
export const MODEL_SESSION_FOOTER_MIN_HEIGHT = 88;
export const MODEL_SESSION_FOOTER_MAX_HEIGHT = 640;
export const MODEL_SESSION_FOOTER_HEIGHT_STORAGE_KEY = 'gosu.model-lab.session-footer-height.v1';
export const MODEL_SESSION_SECTIONS_STORAGE_KEY = 'gosu.model-lab.session-sections.v1';
export type ModelSessionSections = Readonly<{ imports: boolean; builder: boolean }>;
export function readModelSessionSections(raw: string | null | undefined): ModelSessionSections {
  const fallback: ModelSessionSections = { imports: true, builder: false };
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const value = parsed as Partial<Record<keyof ModelSessionSections, unknown>>;
    return {
      imports: typeof value.imports === 'boolean' ? value.imports : fallback.imports,
      builder: typeof value.builder === 'boolean' ? value.builder : fallback.builder,
    };
  } catch {
    return fallback;
  }
}
export function readModelSessionFooterHeight(raw: string | null | undefined): number | null {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) return null;
  return clampPanelWidth(value, MODEL_SESSION_FOOTER_MIN_HEIGHT, MODEL_SESSION_FOOTER_MAX_HEIGHT);
}
export function footerHeightAfterPointerMove(
  startHeight: number,
  startClientY: number,
  clientY: number,
) {
  return startHeight - (clientY - startClientY);
}
export function footerHeightAfterSeparatorKey(
  height: number,
  key: string,
  minimum = MODEL_SESSION_FOOTER_MIN_HEIGHT,
  maximum = MODEL_SESSION_FOOTER_MAX_HEIGHT,
  step = 16,
) {
  if (key === 'Home') return minimum;
  if (key === 'End') return maximum;
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return height;
  return clampPanelWidth(height + (key === 'ArrowUp' ? step : -step), minimum, maximum);
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

export function toggleModelTreeExpansion(
  expandedModelIds: readonly string[],
  modelId: string,
): readonly string[] {
  return expandedModelIds.includes(modelId) ? [] : [modelId];
}

export function moveModelSessionToTrash(
  models: readonly ModelSpec[],
  trashedModelIds: readonly string[],
  activeModelId: string,
  targetModelId: string,
  allowEmpty = false,
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
  if (activeModels.length === 1 && !allowEmpty) {
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
    activeModelId: activeModelId === targetModelId ? (adjacentModel?.id ?? '') : activeModelId,
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

export function modelViewSessionAfterRevision(
  previousModel: Pick<ModelSpec, 'modules'>,
  nextModel: Pick<ModelSpec, 'modules'>,
): ModelViewSession {
  const previousModules = new Map(previousModel.modules.map((module) => [module.id, module]));
  const changedModule = nextModel.modules.find((module) => {
    const previous = previousModules.get(module.id);
    return previous === undefined || JSON.stringify(previous) !== JSON.stringify(module);
  });
  return {
    selectedModuleId: changedModule?.id ?? nextModel.modules[0]?.id ?? '',
    graphDetail: 'expanded',
    expandedSubgraphModuleIds: [],
  };
}

export function modelGraphChangeHighlightFromSummary(
  summary: ReturnType<typeof modelPseudocodeChangeSummary>,
  mode: ModelGraphChangeHighlight['mode'],
  previousModel?: ModelSpec,
  nextModel?: ModelSpec,
): ModelGraphChangeHighlight {
  const connectionId = (change: string) => change.replace(/^(?:added|changed|removed)\s+/u, '');
  const addedStepIds: string[] = [];
  const changedStepIds: string[] = [];
  const removedStepLabels: string[] = [];
  if (previousModel && nextModel) {
    const previousModules = new Map(previousModel.modules.map((module) => [module.id, module]));
    const nextModules = new Map(nextModel.modules.map((module) => [module.id, module]));
    for (const moduleId of summary.addedBlocks) {
      const module = nextModules.get(moduleId);
      if (!module?.repeat) continue;
      repeatedModuleStepStatements(module).forEach((_statement, index) => {
        addedStepIds.push(`repeat-step:${moduleId}:${index + 1}`);
      });
    }
    for (const change of summary.changedBlocks) {
      if (!change.fields.includes('transform')) continue;
      const previous = previousModules.get(change.id);
      const next = nextModules.get(change.id);
      if (!previous?.repeat || !next?.repeat) continue;
      const previousSteps = repeatedModuleStepStatements(previous);
      const nextSteps = repeatedModuleStepStatements(next);
      const hunks = modelPseudocodeLineDiffHunks(previousSteps.join('\n'), nextSteps.join('\n'));
      for (const hunk of hunks) {
        hunk.proposedLines.forEach((_line, index) => {
          const stepId = `repeat-step:${change.id}:${hunk.proposedStart + index}`;
          if (index < hunk.originalLines.length) changedStepIds.push(stepId);
          else addedStepIds.push(stepId);
        });
        hunk.originalLines.slice(hunk.proposedLines.length).forEach((line, index) => {
          removedStepLabels.push(
            `${change.id} step ${hunk.originalStart + hunk.proposedLines.length + index}: ${line}`,
          );
        });
      }
    }
  }
  return {
    mode,
    addedModuleIds: summary.addedBlocks,
    changedModuleIds: summary.changedBlocks.map((change) => change.id),
    removedModuleIds: summary.removedBlocks,
    addedConnectionIds: summary.connectionChanges
      .filter((change) => change.startsWith('added '))
      .map(connectionId),
    changedConnectionIds: summary.connectionChanges
      .filter((change) => change.startsWith('changed '))
      .map(connectionId),
    addedStepIds: [...new Set(addedStepIds)],
    changedStepIds: [...new Set(changedStepIds)],
    removedStepLabels: [...new Set(removedStepLabels)],
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
  changeToken = '',
) {
  return JSON.stringify([
    modelId,
    contentRevision,
    focused,
    expandedSubgraphModuleIds,
    modelSessionsCollapsed,
    copilotCollapsed,
    changeToken,
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
        createdAt: new Date().toISOString(),
        role: 'assistant',
        body: uiText(
          "Loaded {name} {version}. GOSU Model Assistant answers from this model's bounded ModelIR, selected module, source anchors, attached evidence, and recent per-model conversation.",
          { name: model.name, version: model.version },
        ),
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

export function modelChatSessionWithMessage(
  sessions: Readonly<Record<string, ModelChatSession>>,
  sessionKey: string,
  model: Pick<ModelSpec, 'id' | 'name' | 'version'>,
  message: ChatMessage,
): Readonly<Record<string, ModelChatSession>> {
  const session = sessions[sessionKey] ?? createModelChatSession(model);
  return {
    ...sessions,
    [sessionKey]: { ...session, messages: [...session.messages, message] },
  };
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
  label = uiText('+ New / Import model'),
  disabled = false,
}: {
  onFiles: (files: readonly File[]) => void | Promise<void>;
  label?: string;
  disabled?: boolean;
}) {
  useUiText();
  return (
    <label
      className={`quiet-button attachment-button${disabled ? ' attachment-button--disabled' : ''}`}
    >
      <span>{uiText(label)}</span>
      <input
        className="visually-hidden"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,.pdf,.docx,.rtf,.py,.json,.txt,.md,.tex,.rst,.csv,.yaml,.yml,text/rtf,application/rtf"
        disabled={disabled}
        onChange={(event) => {
          const input = event.currentTarget;
          void Promise.resolve(onFiles(Array.from(input.files ?? []))).finally(() => {
            input.value = '';
          });
        }}
        aria-label={uiText('Create a model from Python, image, PDF, DOCX, text, or ModelIR JSON')}
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
  useUiText();
  return (
    <label
      className={`quiet-button attachment-button model-chat__attachment-button${disabled ? ' attachment-button--disabled' : ''}`}
    >
      <span aria-hidden="true">＋</span>
      <span>{uiText('Files')}</span>
      <input
        className="visually-hidden"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,.pdf,.docx,.rtf,.py,.json,.txt,.md,.tex,.rst,.csv,.yaml,.yml,text/rtf,application/rtf"
        disabled={disabled}
        onChange={(event) => {
          const input = event.currentTarget;
          void Promise.resolve(onFiles(Array.from(input.files ?? []))).finally(() => {
            input.value = '';
          });
        }}
        aria-label={uiText('Attach files to this Model Assistant conversation')}
      />
    </label>
  );
}

function ModelTreeChevron({ expanded }: { expanded: boolean }) {
  useUiText();
  return (
    <svg className="model-tree-chevron" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d={expanded ? 'M4.5 7.5 10 13l5.5-5.5' : 'M7.5 4.5 13 10l-5.5 5.5'} />
    </svg>
  );
}

function ReviewCard({ review }: { review: AgentReview }) {
  useUiText();
  return (
    <article className={`review-card review-card--${review.status}`}>
      <div className="review-card__heading">
        <div>
          <strong>{uiText(review.agent)}</strong>
          <span>{uiText(review.specialty)}</span>
        </div>
        <span>{uiText(severityLabel[review.status])}</span>
      </div>
      <p>{modelLabReviewSummary(review.summary)}</p>
      <ul>
        {review.evidence.slice(0, 3).map((evidence) => (
          <li key={evidence}>{evidence}</li>
        ))}
      </ul>
    </article>
  );
}

function ModelIntentPanel({ model }: { model: ModelSpec }) {
  useUiText();
  return (
    <section className="intent-panel" aria-labelledby="intent-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{uiText('DESIGN INTENT')}</span>
          <h2 id="intent-title">{uiText('What this model is supposed to be')}</h2>
        </div>
        <span className="source-chip">{model.sourceLabel}</span>
      </div>
      <p>{model.intent.statement}</p>
      <div className="intent-contract">
        <span>
          {uiText('Input ')}
          {formatShape(model.intent.expectedInput)}
        </span>
        <span aria-hidden="true">→</span>
        <span>
          {uiText('Output ')}
          {formatShape(model.intent.expectedOutput)}
        </span>
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
  if (evidence.length === 0) return uiText('No edge evidence');
  const states = new Set(evidence.map((reading) => reading.state));
  if (states.size > 1) return uiText('Mixed edge observations');
  const state = evidence[0]?.state;
  return state === 'observed'
    ? uiText('Observed edge gradients')
    : `${state ?? uiText('not-observed')} edges`;
}

const FLOW_ORIGIN_TEXT: Readonly<Record<ModuleFlowEntry['origin'], string>> = {
  connection: 'comes from',
  step: 'earlier step',
  'previous-iteration': 'previous iteration of',
  'block-input': 'block input or parameter',
  'next-iteration': 'next iteration, read by',
  'block-output': 'block output (not read again in this loop)',
};

function flowOriginText(entry: ModuleFlowEntry, side: 'incoming' | 'outgoing') {
  if (side === 'outgoing' && entry.origin === 'step') return uiText('used by');
  if (side === 'outgoing' && entry.origin === 'connection') return uiText('goes to');
  return uiText(FLOW_ORIGIN_TEXT[entry.origin]);
}

export function ModuleDetailDialog({
  model,
  module,
  probe,
  checkpointIndex,
  onClose,
  subgraphAction,
  onNavigate,
  parentBlock,
  aiExplanation,
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
  /** Opens another module of the same graph in this dialog. */
  onNavigate?: (module: ModelModule) => void;
  /** The top-level block an expanded loop step belongs to. */
  parentBlock?: ModelModule | null;
  aiExplanation?: Readonly<{
    /**
     * The Model Assistant conversation. Questions asked here continue it, so a discussion started in
     * one module is still there, and still known to Assistant, in the next one.
     */
    conversation: readonly ChatMessage[];
    /** The discussion saved with this module, shown when the conversation no longer holds it. */
    entry: ModuleExplanation | null;
    busy: boolean;
    error: string | null;
    onRequest: () => void;
    /** Asks Model Assistant one follow-up about this module; false when nothing was asked. */
    onAsk: (question: string) => Promise<boolean>;
  }>;
}>) {
  useUiText();
  const language = useUiLanguage();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLTextAreaElement>(null);
  const askedRef = useRef(false);
  const neighbors = moduleDetailNeighbors(model, module.id);
  const flow = moduleDataFlow(model, module.id);
  const reading = moduleReading(model, module, parentBlock ?? null, language);
  const [chooser, setChooser] = useState<'previous' | 'next' | null>(null);
  const [followUp, setFollowUp] = useState('');
  const moduleById = (id: string | null) =>
    id ? (model.modules.find((candidate) => candidate.id === id) ?? null) : null;
  const displayName = (candidate: ModelModule) =>
    englishGraphName(candidate.name, candidate.id, 'Processing Block');
  const go = (direction: 'previous' | 'next') => {
    const list = neighbors[direction];
    if (!onNavigate || list.length === 0) return;
    if (list.length === 1) {
      setChooser(null);
      onNavigate(list[0]!.module);
      return;
    }
    setChooser((current) => (current === direction ? null : direction));
  };
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
  }, []);
  // Moving to another module keeps the dialog (and the focused arrow) and starts at the top.
  useLayoutEffect(() => {
    setChooser(null);
    setFollowUp('');
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [module.id]);
  const discussionBusy = aiExplanation?.busy ?? false;
  // A reply carries the tag of the question it answers, so a module's exchanges read as a unit.
  const discussion = (aiExplanation?.conversation ?? []).reduce<
    Readonly<{ message: ChatMessage; body: string; moduleRef: ModuleQuestionRef | null }>[]
  >((entries, message) => {
    const shown = chatMessageDisplay(message);
    const moduleRef =
      shown.moduleRef ??
      (message.role === 'assistant' ? (entries.at(-1)?.moduleRef ?? null) : null);
    return [...entries, { message, body: shown.body, moduleRef }];
  }, []);
  const discussionCount = discussion.length;
  const explainedBefore =
    Boolean(aiExplanation?.entry) ||
    discussion.some(
      (entry) => entry.moduleRef?.moduleId === module.id && entry.moduleRef.kind === 'explain',
    );
  const discussionSeen = useRef<{ moduleId: string | null; count: number }>({
    moduleId: null,
    count: discussionCount,
  });
  // The panel follows the conversation: opening a module shows its latest exchange (or the end of
  // the conversation when it has none), a new answer opens at its first line, and a running turn
  // keeps its status in view.
  useLayoutEffect(() => {
    const thread = threadRef.current;
    const seen = discussionSeen.current;
    discussionSeen.current = { moduleId: module.id, count: discussionCount };
    if (!thread) return;
    const messages = thread.querySelectorAll<HTMLElement>('.module-detail-ai__message');
    if (seen.moduleId !== module.id) {
      const own = Array.from(messages).filter(
        (candidate) => candidate.dataset.moduleQuestion === 'current',
      );
      const latest = own.at(-1);
      thread.scrollTo?.({ top: latest ? latest.offsetTop - 8 : thread.scrollHeight });
      return;
    }
    if (discussionCount > seen.count) {
      const newest = messages[Math.max(0, messages.length - (discussionCount - seen.count))];
      thread.scrollTo?.({ top: newest ? newest.offsetTop - 8 : thread.scrollHeight });
    } else if (discussionBusy) thread.scrollTo?.({ top: thread.scrollHeight });
  }, [module.id, discussionCount, discussionBusy]);
  // The box is disabled while Model Assistant answers; typing continues there when it finishes.
  useEffect(() => {
    if (discussionBusy || !askedRef.current) return;
    askedRef.current = false;
    askRef.current?.focus();
  }, [discussionBusy]);
  const askQuestion = async () => {
    const asked = followUp.trim();
    if (!asked || !aiExplanation || aiExplanation.busy) return;
    setFollowUp('');
    askedRef.current = true;
    // A question that could not be sent comes back into the box instead of disappearing.
    if (!(await aiExplanation.onAsk(asked))) setFollowUp((current) => current || asked);
  };

  return (
    <dialog
      ref={dialogRef}
      id="model-module-detail-dialog"
      className={`module-detail-dialog${aiExplanation ? ' module-detail-dialog--copilot' : ''}`}
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
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const target = event.target as HTMLElement;
        if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (window.getSelection?.()?.toString()) return;
        event.preventDefault();
        go(event.key === 'ArrowLeft' ? 'previous' : 'next');
      }}
    >
      <article>
        <header className="module-detail-dialog__header">
          <div>
            <span className="eyebrow">
              {module.group}
              {uiText(' · MODULE DETAIL')}
            </span>
            <h2 id="module-detail-title">
              {englishGraphName(module.name, module.id, 'Processing Block')}
            </h2>
          </div>
          <div className="module-detail-dialog__actions">
            {subgraphAction ? (
              <button
                className="quiet-button"
                type="button"
                aria-expanded={subgraphAction.expanded}
                onClick={subgraphAction.onToggle}
              >
                {subgraphAction.expanded ? uiText('Collapse') : uiText('Expand')}{' '}
                {subgraphAction.moduleCount} {uiText('submodules ')}
                {subgraphAction.expanded ? '↑' : uiText('inside graph ↓')}
              </button>
            ) : null}
            {onNavigate ? (
              <div
                className="module-detail-nav"
                role="group"
                aria-label={uiText('Connected modules')}
              >
                {(['previous', 'next'] as const).map((direction) => {
                  const list = neighbors[direction];
                  const label =
                    direction === 'previous'
                      ? uiText('Previous connected module')
                      : uiText('Next connected module');
                  const only = list.length === 1 ? list[0]!.module : null;
                  return (
                    <div key={direction} className="module-detail-nav__slot">
                      <button
                        type="button"
                        className="module-detail-nav__button"
                        aria-label={only ? `${label}: ${displayName(only)}` : label}
                        title={
                          only
                            ? displayName(only)
                            : list.length === 0
                              ? uiText('No connected module')
                              : uiText('{value0} connected modules', { value0: list.length })
                        }
                        aria-disabled={list.length === 0}
                        {...(list.length > 1
                          ? {
                              'aria-haspopup': 'menu' as const,
                              'aria-expanded': chooser === direction,
                            }
                          : {})}
                        onClick={() => go(direction)}
                      >
                        <span aria-hidden="true">{direction === 'previous' ? '←' : '→'}</span>
                      </button>
                      {chooser === direction ? (
                        <ul className="module-detail-nav__menu" role="menu" aria-label={label}>
                          {list.map((neighbor) => (
                            <li key={neighbor.module.id} role="none">
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setChooser(null);
                                  onNavigate(neighbor.module);
                                }}
                              >
                                <strong>{displayName(neighbor.module)}</strong>
                                <small>{neighbor.tensorName}</small>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
            <span className="module-detail-evidence-summary">
              {moduleDetailEvidenceSummary(evidence)}
            </span>
            <button
              ref={closeRef}
              className="module-detail-dialog__close"
              type="button"
              aria-label={uiText('Close {value0} detail', { value0: module.name })}
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </header>
        <div className="module-detail-dialog__columns">
          <div ref={bodyRef} className="module-detail-dialog__body">
            <section className="module-detail-notes" aria-labelledby="module-detail-notes-title">
              <span className="eyebrow">{uiText('MODULE EXPLANATION')}</span>
              <h3 id="module-detail-notes-title">{uiText('What this module does')}</h3>
              <div id="module-detail-notes">
                {aiExplanation?.entry ? (
                  <div
                    className="module-detail-notes__ai"
                    aria-labelledby="module-detail-notes-ai-title"
                  >
                    <h4 id="module-detail-notes-ai-title" className="module-detail-notes__ai-title">
                      <span className="module-detail-notes__ai-mark" aria-hidden="true">
                        ✦
                      </span>
                      {uiText('Model Assistant explanation')}
                      <small>
                        {uiText('saved {date}', {
                          date: new Intl.DateTimeFormat(uiLocale(language), {
                            dateStyle: 'medium',
                          }).format(new Date(aiExplanation.entry.updatedAt)),
                        })}
                      </small>
                    </h4>
                    {aiExplanation.entry.messages.map((message, index) =>
                      message.role === 'user' ? (
                        <p
                          key={`${message.createdAt}:${index}`}
                          className="module-detail-notes__ai-question"
                        >
                          <b>{uiText('You asked')}</b> {message.body}
                        </p>
                      ) : (
                        <div
                          key={`${message.createdAt}:${index}`}
                          className="module-detail-ai__answer"
                        >
                          <ModelChatMarkdown source={message.body} />
                        </div>
                      ),
                    )}
                  </div>
                ) : null}
                {reading.authored ? (
                  <>
                    <h4>{uiText('Author notes')}</h4>
                    <p>{reading.authored}</p>
                  </>
                ) : null}
                <h4>{uiText('At a glance')}</h4>
                <ul className="module-detail-notes__list">
                  {reading.overview.map((line, index) => (
                    <li key={`overview:${index}`}>{line}</li>
                  ))}
                </ul>
                {reading.steps.length > 0 ? (
                  <>
                    <h4>{uiText('Computation order')}</h4>
                    <ol className="module-detail-notes__steps">
                      {reading.steps.map((entry, index) => (
                        <li
                          key={`step:${index}`}
                          style={{ marginLeft: `${Math.min(entry.depth, 4) * 16}px` }}
                        >
                          <code>{entry.code}</code>
                          <span>{entry.text}</span>
                        </li>
                      ))}
                    </ol>
                    {reading.omittedSteps > 0 ? (
                      <p className="module-detail-notes__more">
                        {uiText('{value0} more lines are in the operation source below.', {
                          value0: reading.omittedSteps,
                        })}
                      </p>
                    ) : null}
                  </>
                ) : null}
                {reading.wiring.length > 0 ? (
                  <>
                    <h4>{uiText('Wiring and evidence')}</h4>
                    <ul className="module-detail-notes__list">
                      {reading.wiring.map((line, index) => (
                        <li key={`wiring:${index}`}>{line}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                <small className="module-detail-notes__caveat">{reading.caveat}</small>
              </div>
            </section>

            <section className="module-detail-flow" aria-labelledby="module-detail-flow-title">
              <span className="eyebrow">{uiText('DATA FLOW')}</span>
              <h3 id="module-detail-flow-title">{uiText('Where its values come from and go')}</h3>
              <div className="module-detail-flow__columns">
                {(
                  [
                    ['incoming', uiText('Comes in')],
                    ['outgoing', uiText('Goes out')],
                  ] as const
                ).map(([side, title]) => (
                  <div key={side}>
                    <h4>{title}</h4>
                    {flow[side].length === 0 ? (
                      <p>{uiText('Nothing in this graph')}</p>
                    ) : (
                      <ul>
                        {flow[side].map((entry, index) => {
                          const other = moduleById(entry.moduleId);
                          return (
                            <li key={`${entry.value}:${entry.moduleId ?? entry.origin}:${index}`}>
                              <code>{entry.value}</code>
                              <span>{flowOriginText(entry, side)}</span>
                              {other && onNavigate ? (
                                <button
                                  type="button"
                                  className="module-detail-flow__link"
                                  onClick={() => onNavigate(other)}
                                >
                                  {displayName(other)}
                                </button>
                              ) : other ? (
                                <strong>{displayName(other)}</strong>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section
              className="module-detail-formula"
              aria-labelledby="module-detail-formula-title"
            >
              <span className="eyebrow">{uiText('FULL FORMULA')}</span>
              <h3 id="module-detail-formula-title">{uiText('Module equation')}</h3>
              <Formula latex={module.formula} />
            </section>

            {parentBlock ? (
              <section
                className="module-detail-parent"
                aria-labelledby="module-detail-parent-title"
              >
                <span className="eyebrow">{uiText('REPEATED BLOCK')}</span>
                <h3 id="module-detail-parent-title">
                  {englishGraphName(parentBlock.name, parentBlock.id, 'Repeated Block')}
                </h3>
                {parentBlock.explanation && parentBlock.explanation !== parentBlock.transform ? (
                  <p>{parentBlock.explanation}</p>
                ) : null}
                {parentBlock.formula && parentBlock.formula !== parentBlock.transform ? (
                  <Formula latex={parentBlock.formula} />
                ) : null}
              </section>
            ) : null}

            <dl className="module-detail-facts">
              <div>
                <dt>{uiText('Input shape')}</dt>
                <dd>{formatModuleInputContract(module)}</dd>
              </div>
              <div>
                <dt>{uiText('Output shape')}</dt>
                <dd>{formatModuleOutputContract(module)}</dd>
              </div>
              <div>
                <dt>{uiText('Linear transform / operation')}</dt>
                <dd>{module.transform}</dd>
              </div>
              <div>
                <dt>{uiText('Activation')}</dt>
                <dd>{module.activation ?? uiText('None')}</dd>
              </div>
              {module.repeat ? (
                <div>
                  <dt>{uiText('Repeated stack')}</dt>
                  <dd>
                    {module.repeat.count} × {module.repeat.label}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>{uiText('Parameters')}</dt>
                <dd>{module.parameterCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{uiText('Code reference')}</dt>
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
                  <span className="eyebrow">{uiText('GRADIENT EVIDENCE')}</span>
                  <h3 id="module-detail-evidence-title">
                    {uiText('Backward path at batch ')}
                    {checkpoint}
                  </h3>
                </div>
                <span>{probe}</span>
              </div>
              {evidence.length === 0 ? (
                <p>{uiText('No edge-gradient observation exists at this model boundary.')}</p>
              ) : (
                <div className="module-detail-evidence__groups">
                  {evidenceGroups.map(({ label, readings }) => (
                    <section key={label} aria-label={label}>
                      <h4>{uiText(label)}</h4>
                      {readings.length === 0 ? (
                        <p>
                          {uiText('No ')}
                          {label.toLowerCase()}
                          {uiText(' at this model boundary.')}
                        </p>
                      ) : (
                        <ul>
                          {readings.map((reading) => (
                            <li key={reading.id}>
                              <div>
                                <strong>{reading.tensorName}</strong>
                                <code>
                                  {uiText('Forward ')}
                                  {reading.forwardRoute}
                                </code>
                              </div>
                              <code>
                                {uiText('Backward gradient ')}
                                {reading.backwardGradientRoute}
                              </code>
                              <span>
                                {uiText('Shape ')}
                                <strong>{reading.shape}</strong>
                                {uiText(' · gradient expected')}{' '}
                                <strong>
                                  {reading.expectedToCarryGradient ? uiText('yes') : uiText('no')}
                                </strong>
                              </span>
                              <span>
                                {uiText('Mean healthy-probe activation RMS')}{' '}
                                <strong>{reading.activationValue}</strong>
                              </span>
                              <span>
                                {reading.state}
                                {uiText(' gradient ')}
                                <strong>{reading.value}</strong>
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
                  {uiText('Model-wide coverage:')}{' '}
                  <strong>
                    {coverage.observed.tensors}/{coverage.denominator.tensors}
                  </strong>{' '}
                  {uiText('trainable parameter tensors have observed gradients (')}
                  {coverage.observed.elements.toLocaleString()} /{' '}
                  {coverage.denominator.elements.toLocaleString()}
                  {uiText(' elements).')}
                </p>
              ) : (
                <p className="module-detail-evidence__coverage">
                  {uiText('Model-wide parameter-gradient coverage was not observed.')}
                </p>
              )}
            </section>
          </div>
          {aiExplanation ? (
            <aside
              className="module-detail-copilot"
              aria-labelledby="module-detail-ai-title"
              aria-busy={aiExplanation.busy}
            >
              <div className="module-detail-copilot__heading">
                <div>
                  <span className="eyebrow">{uiText('AI EXPLANATION')}</span>
                  <h3 id="module-detail-ai-title">
                    {uiText('Ask Model Assistant about this module')}
                  </h3>
                </div>
                <button
                  type="button"
                  className="quiet-button"
                  disabled={aiExplanation.busy}
                  onClick={aiExplanation.onRequest}
                >
                  {aiExplanation.busy
                    ? uiText('Model Assistant is explaining…')
                    : explainedBefore
                      ? uiText('Explain again')
                      : uiText('Explain in detail with AI')}
                </button>
              </div>
              <div ref={threadRef} className="module-detail-copilot__thread">
                {discussion.length > 0 ? (
                  <ol className="module-detail-ai__thread">
                    {discussion.map((entry) => {
                      const current = entry.moduleRef?.moduleId === module.id;
                      return (
                        <li
                          key={entry.message.id}
                          data-module-question={
                            current ? 'current' : entry.moduleRef ? 'other' : 'general'
                          }
                          className={`module-detail-ai__message module-detail-ai__message--${entry.message.role}${current ? ' module-detail-ai__message--current' : ''}`}
                        >
                          <span className="module-detail-ai__role">
                            {entry.message.role === 'user'
                              ? uiText('You asked')
                              : uiText('Model Assistant')}
                          </span>
                          {entry.message.role === 'user' ? (
                            <>
                              {entry.moduleRef ? (
                                <ModuleQuestionTag
                                  reference={entry.moduleRef}
                                  current={current}
                                  onOpen={
                                    !current && onNavigate
                                      ? (() => {
                                          const target = moduleById(entry.moduleRef!.moduleId);
                                          return target ? () => onNavigate(target) : undefined;
                                        })()
                                      : undefined
                                  }
                                />
                              ) : null}
                              <p>{entry.body}</p>
                            </>
                          ) : (
                            <div className="module-detail-ai__answer">
                              <ModelChatMarkdown source={entry.body} />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                ) : aiExplanation.busy ? null : (
                  <p>
                    {uiText(
                      "Model Assistant reads the whole model and explains this module's role, symbols and data flow. Questions asked here continue the Model Assistant conversation, tagged with this module.",
                    )}
                  </p>
                )}
                {aiExplanation.busy ? (
                  <p className="module-detail-copilot__status" role="status">
                    <i aria-hidden="true" />
                    {uiText('Model Assistant is answering…')}
                  </p>
                ) : null}
              </div>
              <div className="module-detail-copilot__footer">
                {aiExplanation.error ? (
                  <p role="alert" className="module-detail-ai__error">
                    {aiExplanation.error}
                  </p>
                ) : null}
                <form
                  className="module-detail-ai__ask"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void askQuestion();
                  }}
                >
                  <textarea
                    ref={askRef}
                    rows={2}
                    value={followUp}
                    disabled={aiExplanation.busy}
                    placeholder={uiText('Ask more about this module')}
                    aria-label={uiText('Ask more about this module')}
                    onChange={(event) => setFollowUp(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        void askQuestion();
                      }
                    }}
                  />
                  <button type="submit" disabled={aiExplanation.busy || !followUp.trim()}>
                    {aiExplanation.busy ? uiText('Model Assistant is answering…') : uiText('Ask')}
                  </button>
                </form>
                <small>
                  {uiText(
                    'Continues the Model Assistant conversation · your question is sent with this module attached · an AI reading, not verification',
                  )}
                </small>
              </div>
            </aside>
          ) : null}
        </div>
      </article>
    </dialog>
  );
}

export function ModelLabApp() {
  useUiText();
  const languagePreference = useModelLabLanguagePreference();
  const [storage] = useState(modelLabStorage);
  const [conversationWorkspaceId] = useState(() => modelLabConversationWorkspace(storage));
  const host = modelLabHostConfiguration();
  const [hostSaveStatus, setHostSaveStatus] = useState('saved');
  const [copyTarget, setCopyTarget] = useState<{
    modelId: string;
    modelName: string;
    revision: number;
  } | null>(null);
  const [copyNotice, setCopyNotice] = useState('');
  const [modelReferenceBusy, setModelReferenceBusy] = useState(false);
  const [modelChatFocusRequest, setModelChatFocusRequest] = useState(0);
  const [initialPseudocodeWorkspace] = useState(() => {
    if (host)
      return projectModelLabInitialWorkspace(
        storage?.getItem(MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY) ?? null,
      );
    const fallbackModels = defaultModelLabModels();
    const fallback = initialModelPseudocodeWorkspace(fallbackModels);
    if (typeof window === 'undefined') return fallback;
    try {
      return restoreModelPseudocodeWorkspace(
        storage?.getItem(MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY) ?? null,
        fallbackModels,
      );
    } catch {
      return fallback;
    }
  });
  const [models, setModels] = useState<readonly ModelSpec[]>(initialPseudocodeWorkspace.models);
  const [trashedModelIds, setTrashedModelIds] = useState<readonly string[]>(
    initialPseudocodeWorkspace.trashedModelIds,
  );
  const [trashOpen, setTrashOpen] = useState(false);
  const [emptyTrashArmed, setEmptyTrashArmed] = useState(false);
  const [trashNotice, setTrashNotice] = useState('');
  const [modelId, setModelId] = useState(initialPseudocodeWorkspace.activeModelId);
  const [expandedModelIds, setExpandedModelIds] = useState<readonly string[]>(() =>
    initialPseudocodeWorkspace.activeModelId ? [initialPseudocodeWorkspace.activeModelId] : [],
  );
  const [modelRevisions, setModelRevisions] = useState<Readonly<Record<string, number>>>(
    initialPseudocodeWorkspace.selectedRevisions,
  );
  const [pseudocodeHistories, setPseudocodeHistories] = useState<
    Readonly<Record<string, readonly ModelPseudocodeRevision[]>>
  >(initialPseudocodeWorkspace.histories);
  const [pseudocodeDrafts, setPseudocodeDrafts] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(
      Object.entries(initialPseudocodeWorkspace.histories).map(([lineageId, history]) => {
        const selectedRevision = initialPseudocodeWorkspace.selectedRevisions[lineageId];
        const revision =
          history.find((candidate) => candidate.revision === selectedRevision) ??
          history[history.length - 1]!;
        return [lineageId, revision.pseudocode];
      }),
    ),
  );
  const [pseudocodePersistenceStatus, setPseudocodePersistenceStatus] = useState<
    'saved' | 'failed'
  >('saved');
  const [normalizingPseudocode, setNormalizingPseudocode] = useState(false);
  const [pseudocodeUpdateLogs, setPseudocodeUpdateLogs] = useState<
    Readonly<Record<string, readonly ModelPseudocodeUpdateLogEntry[]>>
  >({});
  const [activePseudocodeDiffHunkIndex, setActivePseudocodeDiffHunkIndex] = useState(-1);
  const [pythonArtifactStates, setPythonArtifactStates] = useState<
    Readonly<Record<string, ModelPythonArtifactState>>
  >({});
  const [pseudocodeNormalizationSources, setPseudocodeNormalizationSources] = useState<
    Readonly<Record<string, string>>
  >({});
  const [pseudocodeNotice, setPseudocodeNotice] = useState<Readonly<{
    modelId: string;
    tone: 'success' | 'error';
    message: string;
  }> | null>(null);
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
  const workspaceEmpty = activeModels.length === 0;
  const model =
    activeModels.find((candidate) => candidate.id === modelId) ??
    activeModels[0] ??
    EMPTY_MODEL_LAB_DISPLAY;
  const modelRevision = modelRevisions[model.id] ?? 0;
  const activeChatSessionKey = modelChatSessionKey(model, modelRevision);
  const pseudocodeHistory = pseudocodeHistories[model.id] ?? [
    initialModelPseudocodeRevision(model),
  ];
  const activePseudocodeRevision =
    pseudocodeHistory.find((candidate) => candidate.revision === modelRevision) ??
    pseudocodeHistory[pseudocodeHistory.length - 1]!;
  const pseudocodeDraft = pseudocodeDrafts[model.id] ?? activePseudocodeRevision.pseudocode;
  const pseudocodeRevisionRows = modelPseudocodeRevisionRows(pseudocodeHistory);
  const pseudocodeDirty = pseudocodeDraft !== activePseudocodeRevision.pseudocode;
  const pendingPseudocodeNormalizationSource = pseudocodeNormalizationSources[model.id];
  const pseudocodeOriginalDraft = activePseudocodeRevision.originalDraft;
  const pseudocodeNormalizationDiff = useMemo(
    () =>
      pendingPseudocodeNormalizationSource
        ? modelPseudocodeLineDiffSummary(pendingPseudocodeNormalizationSource, pseudocodeDraft)
        : null,
    [pendingPseudocodeNormalizationSource, pseudocodeDraft],
  );
  const pseudocodeDiffHunks = useMemo(
    () =>
      pendingPseudocodeNormalizationSource
        ? modelPseudocodeLineDiffHunks(pendingPseudocodeNormalizationSource, pseudocodeDraft)
        : [],
    [pendingPseudocodeNormalizationSource, pseudocodeDraft],
  );
  const activePseudocodeDiffHunk =
    activePseudocodeDiffHunkIndex >= 0
      ? pseudocodeDiffHunks[activePseudocodeDiffHunkIndex]
      : undefined;
  const originalPseudocodeDiffLines = useMemo(
    () => pendingPseudocodeNormalizationSource?.replace(/\r\n?/gu, '\n').split('\n') ?? [],
    [pendingPseudocodeNormalizationSource],
  );
  const proposedPseudocodeDiffLines = useMemo(
    () => pseudocodeDraft.replace(/\r\n?/gu, '\n').split('\n'),
    [pseudocodeDraft],
  );
  const pendingPseudocodeDecision = useMemo(() => {
    if (!pendingPseudocodeNormalizationSource) return null;
    return classifyModelPseudocodeUpdate(pseudocodeDraft, model.id);
  }, [model, pendingPseudocodeNormalizationSource, pseudocodeDraft]);
  const pendingPseudocodeModel =
    pendingPseudocodeDecision?.kind === 'commit' ? pendingPseudocodeDecision.model : null;
  const pendingPseudocodeChangeSummary = useMemo(
    () =>
      pendingPseudocodeModel ? modelPseudocodeChangeSummary(model, pendingPseudocodeModel) : null,
    [model, pendingPseudocodeModel],
  );
  const activePythonArtifactKey = modelPythonArtifactKey(model.id, modelRevision);
  const activePythonArtifactState = pythonArtifactStates[activePythonArtifactKey];
  const activePseudocodeUpdateLog = pseudocodeUpdateLogs[model.id] ?? [];

  const [signalMode, setSignalMode] = useState<'forward' | 'backward'>('forward');
  const [revisionGraphHighlights, setRevisionGraphHighlights] = useState<
    Readonly<Record<string, ModelGraphChangeHighlight>>
  >({});
  const [viewSessions, setViewSessions] = useState<Readonly<Record<string, ModelViewSession>>>(() =>
    Object.fromEntries(
      initialPseudocodeWorkspace.models.map((candidate) => [
        modelChatSessionKey(candidate, 0),
        createModelViewSession(candidate),
      ]),
    ),
  );
  const activeViewSession = viewSessions[activeChatSessionKey] ?? createModelViewSession(model);
  const selectedModuleId = activeViewSession.selectedModuleId;
  const graphDetail = activeViewSession.graphDetail;
  const expandedSubgraphModuleIds = activeViewSession.expandedSubgraphModuleIds;
  const graphDisplayModel = pendingPseudocodeModel ?? model;
  const graphDisplayRegistry = useMemo(
    () =>
      activeModels.map((candidate) =>
        candidate.id === graphDisplayModel.id ? graphDisplayModel : candidate,
      ),
    [activeModels, graphDisplayModel],
  );
  const pendingGraphHighlight = useMemo(
    () =>
      pendingPseudocodeChangeSummary
        ? modelGraphChangeHighlightFromSummary(
            pendingPseudocodeChangeSummary,
            'proposal',
            model,
            pendingPseudocodeModel ?? undefined,
          )
        : null,
    [model, pendingPseudocodeChangeSummary, pendingPseudocodeModel],
  );
  const activeGraphHighlight =
    pendingGraphHighlight ?? revisionGraphHighlights[activeChatSessionKey] ?? null;
  const graphComposition = useMemo(
    () =>
      composeModelSubgraphs(
        overviewModel(graphDisplayModel, pendingPseudocodeModel ? 'expanded' : graphDetail),
        graphDisplayRegistry,
        expandedSubgraphModuleIds,
      ),
    [
      expandedSubgraphModuleIds,
      graphDetail,
      graphDisplayModel,
      graphDisplayRegistry,
      pendingPseudocodeModel,
    ],
  );
  const copilotProjectModels = useMemo(
    () =>
      activeModels.map((candidate) =>
        candidate.id === model.id ? graphComposition.model : candidate,
      ),
    [activeModels, graphComposition.model, model.id],
  );
  const setSelectedModuleId = useCallback(
    (moduleId: string) =>
      setViewSessions((current) =>
        modelViewSessionWithUpdate(current, activeChatSessionKey, model, {
          selectedModuleId: moduleId,
        }),
      ),
    [activeChatSessionKey, model],
  );
  const setGraphDetail = (detail: 'overview' | 'expanded') =>
    setViewSessions((current) =>
      modelViewSessionWithUpdate(current, activeChatSessionKey, model, { graphDetail: detail }),
    );
  const toggleSubgraph = useCallback(
    (moduleId: string) => {
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
    },
    [activeChatSessionKey, model],
  );
  const [probe, setProbe] = useState<GradientProbeName>('healthy');
  const [checkpointIndex, setCheckpointIndex] = useState(4);
  const [reviewNonce, setReviewNonce] = useState(1);
  const [reviews, setReviews] = useState<readonly AgentReview[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [importJobs, setImportJobs] = useState<readonly ModelImportJob[]>(() =>
    readModelImportHistory(storage ?? undefined),
  );
  const [buildingModel, setBuildingModel] = useState(false);
  const copilotRuns = useModelChatRuns();
  const answering = Boolean(copilotRuns.get(activeChatSessionKey));
  const copilotProgress = copilotRuns.get(activeChatSessionKey)?.progress ?? [];
  const stopCopilotTurn = () => copilotRuns.stop(activeChatSessionKey);
  const [copilotStatus, setCopilotStatus] = useState<ModelLabRuntimeStatus | null>(null);
  const [copilotCatalog, setCopilotCatalog] = useState<ModelCatalog | null>(null);
  const [copilotSelection, setCopilotSelection] = useState<ModelLabModelSelection>({
    providerId: null,
    requestedModelId: null,
    reasoningOptionId: null,
  });
  const [builderSelection, setBuilderSelection] = useState<ModelLabModelSelection>({
    providerId: null,
    requestedModelId: null,
    reasoningOptionId: null,
  });
  const [copilotCatalogRefreshing, setCopilotCatalogRefreshing] = useState(false);
  const [copilotAttachmentNotice, setCopilotAttachmentNotice] = useState<string | null>(null);
  const [modelFocus, setModelFocus] = useState(false);
  const [moduleDetail, setModuleDetail] = useState<ModuleDetailState | null>(null);
  const [modelSessionsCollapsed, setModelSessionsCollapsed] = useState(Boolean(host));
  const [sessionFooterHeight, setSessionFooterHeight] = useState<number | null>(() =>
    readModelSessionFooterHeight(storage?.getItem(MODEL_SESSION_FOOTER_HEIGHT_STORAGE_KEY)),
  );
  const [sessionSections, setSessionSections] = useState<ModelSessionSections>(() =>
    readModelSessionSections(storage?.getItem(MODEL_SESSION_SECTIONS_STORAGE_KEY)),
  );
  const footerResizeRef = useRef<{
    pointerId: number;
    startClientY: number;
    startHeight: number;
  } | null>(null);
  const sessionFooterRef = useRef<HTMLElement | null>(null);
  const [modelSessionSidebarWidth, setModelSessionSidebarWidth] = useState(
    MODEL_SESSION_SIDEBAR_DEFAULT_WIDTH,
  );
  const [copilotWidth, setCopilotWidth] = useState(host ? 340 : MODEL_COPILOT_DEFAULT_WIDTH);
  const [resizingPanel, setResizingPanel] = useState<ResizablePanel | null>(null);
  const [copilotCollapsed, setCopilotCollapsed] = useState(false);
  const [copilotDetailsOpen, setCopilotDetailsOpen] = useState(false);
  const [chatNearBottom, setChatNearBottom] = useState(true);
  const [chatAtTop, setChatAtTop] = useState(true);
  const [chatCanScroll, setChatCanScroll] = useState(false);
  const [mobileCopilotOpen, setMobileCopilotOpen] = useState(false);
  const mobileLayout = useMobileLayout();
  const stackedSessionLayout = useMediaQuery('(max-width: 900px)');
  const stackedWorkbenchLayout = useMediaQuery(host ? '(max-width: 900px)' : '(max-width: 1200px)');
  const modelSessionsPanelCollapsed = !workspaceEmpty && modelSessionsCollapsed;
  const previousMobileLayoutRef = useRef(mobileLayout);
  const copilotPanelCollapsed = isCopilotPanelCollapsed(
    mobileLayout,
    copilotCollapsed,
    mobileCopilotOpen,
  );
  const copilotContentA11y = copilotContentAccessibilityProps(copilotPanelCollapsed);
  const copilotRestoreA11y = copilotRestoreAccessibilityProps(copilotPanelCollapsed);
  const [chatSessions, setChatSessions] = useState<Readonly<Record<string, ModelChatSession>>>(
    () => ({
      ...Object.fromEntries(
        initialPseudocodeWorkspace.models.map((candidate) => [
          modelChatSessionKey(candidate, 0),
          createModelChatSession(candidate),
        ]),
      ),
      ...loadModelLabChats(storage),
    }),
  );
  const initialPermanentMemoryRef = useRef<ReturnType<typeof loadModelLabPermanentMemory> | null>(
    null,
  );
  initialPermanentMemoryRef.current ??=
    typeof window === 'undefined'
      ? loadModelLabPermanentMemory(null)
      : loadModelLabPermanentMemory(storage);
  const [permanentMemory, setPermanentMemory] = useState<readonly AgentPermanentMemoryEntry[]>(
    initialPermanentMemoryRef.current.entries,
  );
  const [memoryPersistenceStatus, setMemoryPersistenceStatus] = useState<'saved' | 'failed'>(
    initialPermanentMemoryRef.current.status,
  );
  useEffect(() => {
    writeModelImportHistory(storage ?? undefined, importJobs);
  }, [importJobs, storage]);
  const shellRef = useRef<HTMLElement>(null);
  const focusToggleRef = useRef<HTMLButtonElement>(null);
  const modelSessionsCollapseRef = useRef<HTMLButtonElement>(null);
  const modelSessionsRestoreRef = useRef<HTMLButtonElement>(null);
  const copilotCloseRef = useRef<HTMLButtonElement>(null);
  const copilotRestoreRef = useRef<HTMLButtonElement>(null);
  const copilotComposerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!modelChatFocusRequest || copilotPanelCollapsed) return;
    const frame = requestAnimationFrame(() => copilotComposerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [modelChatFocusRequest, activeChatSessionKey, copilotPanelCollapsed]);
  const pseudocodeEditorRef = useRef<HTMLTextAreaElement>(null);
  const originalPseudocodeDiffRef = useRef<HTMLPreElement>(null);
  const proposedPseudocodeDiffRef = useRef<HTMLPreElement>(null);
  const pseudocodeDiffScrollSyncRef = useRef(false);
  const pseudocodeNormalizerAbortRef = useRef<AbortController | null>(null);
  const pythonArtifactAbortRef = useRef(new Map<string, AbortController>());
  const pythonArtifactLoadStartedRef = useRef(new Set<string>());
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const chatPinnedToBottomRef = useRef(true);
  const chatReadingPositionsRef = useRef(new Map<string, ModelChatReadingPosition>());
  const chatScrollHoldRef = useRef<ReturnType<typeof holdScrollTarget> | null>(null);
  const chatReshowRef = useRef<ReturnType<typeof restoreScrollWhenShown> | null>(null);
  const activeChatSessionKeyRef = useRef(activeChatSessionKey);
  activeChatSessionKeyRef.current = activeChatSessionKey;
  const previousChatSessionKeyRef = useRef(activeChatSessionKey);
  const modelRegistryRef = useRef<readonly ModelSpec[]>(models);
  const currentDraftsRef = useRef(pseudocodeDrafts);
  currentDraftsRef.current = pseudocodeDrafts;
  const currentWorkspaceRef = useRef({
    models,
    histories: pseudocodeHistories,
    selectedRevisions: modelRevisions,
    activeModelId: modelId,
    trashedModelIds,
  });
  currentWorkspaceRef.current = {
    models,
    histories: pseudocodeHistories,
    selectedRevisions: modelRevisions,
    activeModelId: modelId,
    trashedModelIds,
  };
  const receivedCopiesRef = useRef<Set<string> | null>(null);
  if (!receivedCopiesRef.current) {
    try {
      const value = JSON.parse(storage?.getItem(PROJECT_MODEL_RECEIVED_COPIES_KEY) ?? '[]');
      receivedCopiesRef.current = new Set(
        Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [],
      );
    } catch {
      receivedCopiesRef.current = new Set();
    }
  }
  useEffect(() => {
    if (!host) return;
    let active = true;
    let fetching = false;
    const receive = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const copies = await projectModelCopies.pending();
        if (!active) return;
        const newCopies = copies.filter((copy) => !receivedCopiesRef.current!.has(copy.id));
        if (newCopies.length) {
          const merged = mergeProjectModelCopies(currentWorkspaceRef.current, newCopies);
          storage?.setItem(
            MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
            serializeModelPseudocodeWorkspace(merged),
          );
          newCopies.forEach((copy) => receivedCopiesRef.current!.add(copy.id));
          storage?.setItem(
            PROJECT_MODEL_RECEIVED_COPIES_KEY,
            JSON.stringify([...receivedCopiesRef.current!]),
          );
          currentWorkspaceRef.current = merged;
          modelRegistryRef.current = merged.models;
          setModels(merged.models);
          setPseudocodeHistories(merged.histories);
          setModelRevisions(merged.selectedRevisions);
          setModelId(merged.activeModelId);
          setPseudocodeDrafts((current) => ({
            ...current,
            ...Object.fromEntries(
              newCopies.flatMap((copy) =>
                (copy.entries ?? []).map((entry) => [entry.model.id, entry.pseudocode]),
              ),
            ),
          }));
          setCopyNotice(
            newCopies.every((copy) => copy.sourceProjectId === copy.targetProjectId)
              ? `Added ${newCopies.length} model${newCopies.length === 1 ? '' : 's'} from chat.`
              : `Received ${newCopies.length} independent model cop${newCopies.length === 1 ? 'y' : 'ies'} from another project.`,
          );
        }
        await storage?.flush?.();
        for (const copy of copies)
          if (receivedCopiesRef.current!.has(copy.id))
            await projectModelCopies.acknowledge(copy.id);
      } catch (error) {
        if (active)
          setCopyNotice(
            error instanceof Error ? error.message : uiText('Model copy could not be received'),
          );
      } finally {
        fetching = false;
      }
    };
    void receive();
    const timer = setInterval(() => {
      void receive();
    }, 2500);
    window.addEventListener('focus', receive);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', receive);
    };
  }, [host, storage]);
  const modelImportInFlightRef = useRef(false);
  const modelImportAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => modelImportAbortRef.current?.abort(), []);
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
  const activeChatSession = chatSessions[activeChatSessionKey] ?? createModelChatSession(model);
  const messages = activeChatSession.messages;
  const chatContextStartsAt = modelChatContextStart(
    activeChatSession.contextStartsAt,
    messages.length,
  );
  // What a later turn may send: everything the reader left after the last "/new".
  const modelFacingMessages = messages.slice(chatContextStartsAt);
  const [chatCommandStates, setChatCommandStates] = useState<
    Record<string, ModelChatCommandState | undefined>
  >({});
  const activeChatCommand = chatCommandStates[activeChatSessionKey];
  const [contextUsageBySession, setContextUsageBySession] = useState<
    Record<string, ContextUsage | undefined>
  >({});
  const displayedContextUsage =
    contextUsageBySession[activeChatSessionKey] ??
    [...messages].reverse().find((message) => message.contextUsage)?.contextUsage;
  const paperReply = useRef<PaperSaveReplyHandler | null>(null);
  const chatDraftsRef = useRef<Record<string, string>>({});
  const chatSessionsRef = useRef(chatSessions);
  chatSessionsRef.current = chatSessions;
  const chatSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChat = useCallback(() => {
    try {
      saveModelLabChats(storage, chatSessionsRef.current, chatDraftsRef.current);
    } catch {
      setHostSaveStatus('failed');
    }
  }, [storage]);
  useEffect(() => {
    saveChat();
  }, [chatSessions, saveChat]);
  useEffect(() => {
    const status = (event: Event) => setHostSaveStatus((event as CustomEvent<string>).detail);
    window.addEventListener('gosu-model-lab-save', status);
    return () => {
      window.removeEventListener('gosu-model-lab-save', status);
      if (chatSaveTimer.current) clearTimeout(chatSaveTimer.current);
      saveChat();
    };
  }, [saveChat]);
  const copilotAttachments = activeChatSession.attachments;
  const setQuestion = (draft: string) => {
    chatDraftsRef.current[activeChatSessionKey] = draft;
    if (chatSaveTimer.current) clearTimeout(chatSaveTimer.current);
    chatSaveTimer.current = setTimeout(saveChat, 500);
  };
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
  const storeSessionSections = (next: ModelSessionSections) => {
    setSessionSections(next);
    try {
      storage?.setItem(MODEL_SESSION_SECTIONS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The choice still holds for this session.
    }
  };
  const setSessionFooterHeightClamped = (height: number) => {
    const next = clampPanelWidth(
      height,
      MODEL_SESSION_FOOTER_MIN_HEIGHT,
      MODEL_SESSION_FOOTER_MAX_HEIGHT,
    );
    setSessionFooterHeight(next);
    try {
      storage?.setItem(MODEL_SESSION_FOOTER_HEIGHT_STORAGE_KEY, String(next));
    } catch {
      // The height still holds for this session.
    }
  };
  const currentSessionFooterHeight = () =>
    sessionFooterHeight ??
    Math.round(sessionFooterRef.current?.getBoundingClientRect().height ?? 240);
  const beginFooterResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    footerResizeRef.current = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startHeight: currentSessionFooterHeight(),
    };
  };
  const continueFooterResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = footerResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setSessionFooterHeightClamped(
      footerHeightAfterPointerMove(resize.startHeight, resize.startClientY, event.clientY),
    );
  };
  const endFooterResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (footerResizeRef.current?.pointerId !== event.pointerId) return;
    footerResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  useEffect(() => {
    if (buildingModel) setSessionSections((current) => ({ ...current, imports: true }));
  }, [buildingModel]);
  const collapseModelSessions = () => {
    setModelSessionsCollapsed(true);
    requestAnimationFrame(() => modelSessionsRestoreRef.current?.focus());
  };
  const restoreModelSessions = () => {
    setModelSessionsCollapsed(false);
    requestAnimationFrame(() => modelSessionsCollapseRef.current?.focus());
  };
  const openModuleDetail = useCallback(
    (module: ModelModule, graphModel: ModelSpec) => {
      const cards = document.querySelectorAll<HTMLElement>('[data-model-node-id]');
      const matchingCard = Array.from(cards).find((card) => card.dataset.modelNodeId === module.id);
      moduleDetailTriggerRef.current =
        matchingCard ??
        (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setModuleDetail({ module, graphModel, scopeKey: activeChatSessionKey });
    },
    [activeChatSessionKey],
  );
  const closeModuleDetail = () => {
    const returnTarget = moduleDetailTriggerRef.current;
    setModuleDetail(null);
    requestAnimationFrame(() => {
      if (returnTarget?.isConnected) returnTarget.focus();
    });
  };
  const moveModelToTrash = (targetModelId: string) => {
    const transition = moveModelSessionToTrash(
      models,
      trashedModelIds,
      model.id,
      targetModelId,
      Boolean(host),
    );
    if (!transition.moved) {
      setTrashNotice(
        transition.reason === 'last-active-model'
          ? uiText('Keep at least one active model session. Import or restore another model first.')
          : uiText('That model session is no longer active.'),
      );
      setTrashOpen(true);
      return;
    }
    const target = models.find((candidate) => candidate.id === targetModelId);
    copilotRuns.removeModel(targetModelId);
    setModuleDetail(null);
    moduleDetailTriggerRef.current = null;
    setTrashedModelIds(transition.trashedModelIds);
    setModelId(transition.activeModelId);
    setExpandedModelIds([transition.activeModelId]);
    setEmptyTrashArmed(false);
    setTrashOpen(true);
    setTrashNotice(`${target?.name ?? uiText('Model session')} moved to Trash.`);
  };
  const restoreModelFromTrash = (targetModelId: string) => {
    const target = models.find((candidate) => candidate.id === targetModelId);
    setTrashedModelIds((current) => current.filter((candidate) => candidate !== targetModelId));
    if (workspaceEmpty) {
      setModelId(targetModelId);
      setExpandedModelIds([targetModelId]);
    }
    setEmptyTrashArmed(false);
    setTrashNotice(`${target?.name ?? uiText('Model session')} restored.`);
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
    setPermanentMemory((current) =>
      current.filter((entry) => entry.scopeType !== 'model' || !purged.has(entry.scopeId)),
    );
    setPseudocodeHistories((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !purged.has(key))),
    );
    setPseudocodeDrafts((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !purged.has(key))),
    );
    setPseudocodeNormalizationSources((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !purged.has(key))),
    );
    setPythonArtifactStates((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => {
          try {
            const [candidateModelId] = JSON.parse(key) as [string, number];
            return !purged.has(candidateModelId);
          } catch {
            return false;
          }
        }),
      ),
    );
    for (const [key, controller] of pythonArtifactAbortRef.current) {
      try {
        const [candidateModelId] = JSON.parse(key) as [string, number];
        if (!purged.has(candidateModelId)) continue;
        controller.abort();
        pythonArtifactAbortRef.current.delete(key);
      } catch {
        controller.abort();
        pythonArtifactAbortRef.current.delete(key);
      }
    }
    setExpandedModelIds((current) => current.filter((candidate) => !purged.has(candidate)));
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
    if (typeof window === 'undefined') return;
    try {
      storage?.setItem(
        MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
        serializeModelPseudocodeWorkspace({
          histories: pseudocodeHistories,
          selectedRevisions: modelRevisions,
          activeModelId: modelId,
          trashedModelIds,
        }),
      );
      setPseudocodePersistenceStatus('saved');
    } catch {
      setPseudocodePersistenceStatus('failed');
    }
  }, [modelId, modelRevisions, pseudocodeHistories, trashedModelIds, storage]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (storage)
      setMemoryPersistenceStatus(persistModelLabPermanentMemory(storage, permanentMemory));
  }, [permanentMemory, storage]);
  useEffect(() => {
    if (workspaceEmpty) return;
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
  }, [activeChatSessionKey, model, workspaceEmpty]);

  useEffect(() => {
    const receipt = activePseudocodeRevision.pythonArtifact;
    if (!receipt || pythonArtifactLoadStartedRef.current.has(activePythonArtifactKey)) return;
    pythonArtifactLoadStartedRef.current.add(activePythonArtifactKey);
    const controller = new AbortController();
    let settled = false;
    setPythonArtifactStates((current) => ({
      ...current,
      [activePythonArtifactKey]: { status: 'loading' },
    }));
    void modelPythonArtifactClient
      .read(receipt, controller.signal)
      .then((artifact) => {
        if (controller.signal.aborted) return;
        settled = true;
        setPythonArtifactStates((current) => ({
          ...current,
          [activePythonArtifactKey]: { status: 'ready', artifact },
        }));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        settled = true;
        setPythonArtifactStates((current) => ({
          ...current,
          [activePythonArtifactKey]: {
            status: 'failed',
            error:
              error instanceof Error ? error.message : uiText('Python artifact could not be read.'),
          },
        }));
      });
    return () => {
      controller.abort();
      if (!settled) pythonArtifactLoadStartedRef.current.delete(activePythonArtifactKey);
    };
  }, [activePseudocodeRevision.pythonArtifact, activePythonArtifactKey]);

  useEffect(() => {
    setActivePseudocodeDiffHunkIndex(-1);
    requestAnimationFrame(() => {
      if (originalPseudocodeDiffRef.current) originalPseudocodeDiffRef.current.scrollTop = 0;
      if (proposedPseudocodeDiffRef.current) proposedPseudocodeDiffRef.current.scrollTop = 0;
    });
  }, [pendingPseudocodeNormalizationSource, pseudocodeDraft]);

  useEffect(() => {
    setModuleDetail(null);
    moduleDetailTriggerRef.current = null;
    setCopilotAttachmentNotice(null);
    pseudocodeNormalizerAbortRef.current?.abort();
    pseudocodeNormalizerAbortRef.current = null;
    setNormalizingPseudocode(false);
  }, [activeChatSessionKey]);

  // The desktop hides this Lab's frame on every tab switch, and the panel can be collapsed. Either
  // way the log loses its box and its scroll position, and no state changes when it comes back.
  useEffect(() => {
    const chatBody = chatBodyRef.current;
    if (!chatBody) return;
    chatReshowRef.current = restoreScrollWhenShown(chatBody, () =>
      modelChatScrollTarget(chatReadingPositionsRef.current.get(activeChatSessionKeyRef.current)),
    );
    return () => chatReshowRef.current?.dispose();
  }, []);

  useLayoutEffect(() => {
    const switchedConversation = previousChatSessionKeyRef.current !== activeChatSessionKey;
    if (switchedConversation) {
      previousChatSessionKeyRef.current = activeChatSessionKey;
      // A conversation opens where it was left; one that was never scrolled opens at the latest.
      chatPinnedToBottomRef.current =
        chatReadingPositionsRef.current.get(activeChatSessionKey)?.atBottom ?? true;
    }
    const chatBody = chatBodyRef.current;
    if (!chatBody || copilotPanelCollapsed) return;
    if (switchedConversation) {
      chatScrollHoldRef.current?.stop();
      chatScrollHoldRef.current = holdScrollTarget(
        chatBody,
        modelChatScrollTarget(chatReadingPositionsRef.current.get(activeChatSessionKey)),
      );
    } else if (chatPinnedToBottomRef.current) chatBody.scrollTop = chatBody.scrollHeight;
    const state = modelChatScrollState(chatBody);
    setChatCanScroll(state.canScroll);
    setChatAtTop(state.atTop);
    setChatNearBottom(state.nearBottom);
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
    graphComposition.model.modules[0] ??
    EMPTY_MODEL_MODULE_DISPLAY;
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
      activeTrace?.scenarioLabels[name] ?? uiText(fallbackProbeLabels[name]),
    ]),
  ) as Record<GradientProbeName, string>;
  const scenarioKind = activeTrace?.scenarioKinds[probe] ?? uiText('design-only');
  const scenarioLabel =
    activeTrace?.scenarioLabels[probe] ?? uiText('No scenario metadata is available.');
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
  const activeModelMemoryCount = permanentMemory.filter(
    (entry) => entry.scopeType === 'model' && entry.scopeId === model.id,
  ).length;
  const selectedCopilotModel = copilotCatalog
    ? selectCatalogModel(copilotCatalog, copilotSelection)
    : undefined;
  const copilotReasoningOptions = selectedCopilotModel?.reasoningOptions ?? [];
  const copilotModelSelectionMissing = Boolean(
    copilotSelection.requestedModelId && copilotCatalog && !selectedCopilotModel,
  );
  const copilotReasoningSelectionMissing = Boolean(
    copilotSelection.reasoningOptionId &&
    selectedCopilotModel &&
    !copilotReasoningOptions.some(
      (candidate) => candidate.id === copilotSelection.reasoningOptionId,
    ),
  );
  const copilotProviderGroups = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof copilotCatalog>['models']>();
    for (const candidate of copilotCatalog?.models ?? []) {
      groups.set(candidate.providerId, [...(groups.get(candidate.providerId) ?? []), candidate]);
    }
    return [...groups.entries()];
  }, [copilotCatalog]);
  const selectedBuilderModel = copilotCatalog
    ? selectCatalogModel(copilotCatalog, builderSelection)
    : undefined;
  const builderReasoningOptions = selectedBuilderModel?.reasoningOptions ?? [];
  const builderModelSelectionMissing = Boolean(
    builderSelection.requestedModelId && copilotCatalog && !selectedBuilderModel,
  );
  const builderReasoningSelectionMissing = Boolean(
    builderSelection.reasoningOptionId &&
    selectedBuilderModel &&
    !builderReasoningOptions.some(
      (candidate) => candidate.id === builderSelection.reasoningOptionId,
    ),
  );
  const selectedCopilotReasoning = resolveCatalogReasoning(
    selectedCopilotModel,
    copilotSelection.reasoningOptionId,
  );
  const selectedBuilderReasoning = resolveCatalogReasoning(
    selectedBuilderModel,
    builderSelection.reasoningOptionId,
  );
  const copilotModelLabel =
    selectedCopilotModel?.displayName ??
    (copilotModelSelectionMissing
      ? uiText('Unavailable model')
      : (copilotStatus?.model ?? 'Connecting…'));
  const copilotProviderLabel =
    selectedCopilotModel?.providerId ?? copilotStatus?.provider ?? 'GOSU LLM bridge';
  const copilotProviderDisplayLabel = modelCopilotProviderLabel(copilotProviderLabel);
  const copilotReasoningLabel =
    selectedCopilotReasoning?.label ??
    (copilotReasoningSelectionMissing
      ? uiText('Unavailable reasoning')
      : (copilotStatus?.reasoning ?? uiText('Model default')));
  const refreshCopilotCatalog = async () => {
    if (copilotCatalogRefreshing) return;
    setCopilotCatalogRefreshing(true);
    try {
      const catalog = await gosuModelLabRuntime.listModels?.({ refresh: true });
      if (catalog) {
        setCopilotCatalog(catalog);
        setCopilotAttachmentNotice(
          `Refreshed ${catalog.models.length} available LLM model${catalog.models.length === 1 ? '' : 's'} from GOSU providers.`,
        );
      }
    } catch {
      setCopilotAttachmentNotice(uiText('Could not refresh the GOSU model catalog.'));
    } finally {
      setCopilotCatalogRefreshing(false);
    }
  };

  useEffect(() => {
    let current = true;
    void gosuModelLabRuntime
      .status?.()
      .then((status) => {
        if (!current) return;
        if (status) setCopilotStatus(status);
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

  useEffect(
    () =>
      startModelCatalogAutoRefresh({
        refresh: async (signal) => {
          const catalog = await gosuModelLabRuntime.listModels?.({ refresh: true });
          if (catalog && !signal.aborted) setCopilotCatalog(catalog);
        },
      }),
    [],
  );

  useEffect(() => {
    if (workspaceEmpty) {
      setReviews([]);
      return;
    }
    let current = true;
    setReviewing(true);
    void deterministicModelLabRuntime
      .review({
        projectModels: modelFormulaAuditScope(activeModels),
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
  }, [activeModels, checkpointIndex, model.id, probe, reviewNonce, workspaceEmpty]);

  const setPseudocodeDraft = (value: string) => {
    setPseudocodeDrafts((current) => ({ ...current, [model.id]: value }));
    if (pseudocodeNotice?.modelId === model.id) setPseudocodeNotice(null);
  };

  const appendPseudocodeUpdateLog = (
    targetModelId: string,
    phase: ModelPseudocodeUpdateLogEntry['phase'],
    message: string,
    reset = false,
  ) => {
    const entry: ModelPseudocodeUpdateLogEntry = {
      id: nextId('pseudocode-update'),
      createdAt: new Date().toISOString(),
      phase,
      message,
    };
    setPseudocodeUpdateLogs((current) => ({
      ...current,
      [targetModelId]: reset ? [entry] : [...(current[targetModelId] ?? []), entry].slice(-16),
    }));
  };

  const jumpToPseudocodeDiffHunk = () => {
    if (pseudocodeDiffHunks.length === 0) return;
    const nextIndex = (activePseudocodeDiffHunkIndex + 1) % pseudocodeDiffHunks.length;
    const hunk = pseudocodeDiffHunks[nextIndex]!;
    setActivePseudocodeDiffHunkIndex(nextIndex);
    requestAnimationFrame(() => {
      const scrollLineIntoPane = (pane: HTMLPreElement | null, line: number) => {
        const target =
          pane?.querySelector<HTMLElement>(`[data-line="${Math.max(1, line)}"]`) ??
          pane?.querySelector<HTMLElement>('[data-line]:last-child');
        if (!pane || !target) return;
        pane.scrollTop = Math.max(0, target.offsetTop - pane.clientHeight * 0.28);
      };
      scrollLineIntoPane(originalPseudocodeDiffRef.current, hunk.originalStart);
      scrollLineIntoPane(proposedPseudocodeDiffRef.current, hunk.proposedStart);
      const editor = pseudocodeEditorRef.current;
      if (editor) {
        const offset = pseudocodeLineOffset(pseudocodeDraft, hunk.proposedStart);
        editor.setSelectionRange(offset, offset);
        const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 20;
        editor.scrollTop = Math.max(
          0,
          (hunk.proposedStart - 1) * lineHeight - editor.clientHeight * 0.25,
        );
      }
    });
  };

  const synchronizePseudocodeDiffScroll = (
    source: HTMLPreElement,
    target: HTMLPreElement | null,
  ) => {
    if (!target || pseudocodeDiffScrollSyncRef.current) return;
    const sourceRange = source.scrollHeight - source.clientHeight;
    const targetRange = target.scrollHeight - target.clientHeight;
    if (sourceRange <= 0 || targetRange <= 0) return;
    pseudocodeDiffScrollSyncRef.current = true;
    target.scrollTop = (source.scrollTop / sourceRange) * targetRange;
    requestAnimationFrame(() => {
      pseudocodeDiffScrollSyncRef.current = false;
    });
  };

  const generatePythonArtifact = async (targetModel: ModelSpec, revision: number) => {
    const artifactKey = modelPythonArtifactKey(targetModel.id, revision);
    pythonArtifactAbortRef.current.get(artifactKey)?.abort();
    const controller = new AbortController();
    pythonArtifactAbortRef.current.set(artifactKey, controller);
    const reportActivity = beginAiActivity('model-lab', controller.signal);
    setPythonArtifactStates((current) => ({
      ...current,
      [artifactKey]: { status: 'generating' },
    }));
    try {
      const artifact = await modelPythonArtifactClient.generate({
        model: targetModel,
        revision,
        selection: builderSelection,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setPseudocodeHistories((current) => {
        const history = current[targetModel.id];
        if (!history) return current;
        return {
          ...current,
          [targetModel.id]: attachModelPythonArtifact(history, revision, artifact.receipt),
        };
      });
      setPythonArtifactStates((current) => ({
        ...current,
        [artifactKey]: { status: 'ready', artifact },
      }));
      reportActivity('completed');
    } catch (error) {
      setPythonArtifactStates((current) => ({
        ...current,
        [artifactKey]: {
          status: 'failed',
          error: controller.signal.aborted
            ? uiText('Python generation stopped.')
            : error instanceof Error
              ? error.message
              : uiText('Python artifact generation failed.'),
        },
      }));
    } finally {
      reportActivity('failed');
      if (pythonArtifactAbortRef.current.get(artifactKey) === controller) {
        pythonArtifactAbortRef.current.delete(artifactKey);
      }
    }
  };

  const queuePseudocodeRevisionComment = (input: {
    previousModel: ModelSpec;
    nextModel: ModelSpec;
    nextModels: readonly ModelSpec[];
    fromRevision: number;
    toRevision: number;
  }) => {
    const sessionKey = modelChatSessionKey(input.nextModel, input.toRevision);
    const pendingMessageId = nextId('revision-review');
    const createdAt = new Date().toISOString();
    const changeSummary = modelPseudocodeChangeSummary(input.previousModel, input.nextModel);
    const deterministicReceipt = [
      `**Revision r${input.toRevision} update receipt**`,
      ...changeSummary.lines.map((line) => `- ${line}`),
    ].join('\n');
    setChatSessions((current) =>
      modelChatSessionWithMessage(current, sessionKey, input.nextModel, {
        id: pendingMessageId,
        modelId: input.nextModel.id,
        modelVersion: input.nextModel.version,
        createdAt,
        role: 'assistant',
        body: `${deterministicReceipt}\n\nModel Assistant is reviewing how the pseudocode and graph changed…`,
        trace: [
          uiText('Pseudocode revision committed'),
          ...changeSummary.lines,
          uiText('Automatic Model Assistant review pending'),
        ],
      }),
    );
    const question = modelPseudocodeRevisionCommentPrompt(input);
    const selectedModuleId = input.nextModel.modules[0]?.id;
    if (!selectedModuleId) return;
    void gosuModelLabRuntime
      .answer({
        projectModels: input.nextModels,
        activeModelId: input.nextModel.id,
        selectedModuleId,
        probe,
        checkpointIndex,
        question,
        purpose: 'revision-comment',
        conversationRevision: input.toRevision,
        conversationWorkspaceId,
        selection: copilotSelection,
      })
      .then((answer) => {
        setChatSessions((current) => {
          const session = current[sessionKey];
          if (!session) return current;
          return {
            ...current,
            [sessionKey]: {
              ...session,
              messages: session.messages.map((message) =>
                message.id === pendingMessageId
                  ? {
                      ...message,
                      body: `${deterministicReceipt}\n\n${answer.body}`,
                      trace: [
                        ...answer.trace,
                        `Automatic review · r${input.fromRevision} → r${input.toRevision}`,
                      ],
                      ...(answer.usage ? { usage: answer.usage } : {}),
                      ...(answer.contextUsage ? { contextUsage: answer.contextUsage } : {}),
                    }
                  : message,
              ),
            },
          };
        });
      })
      .catch(() => {
        setChatSessions((current) => {
          const session = current[sessionKey];
          if (!session) return current;
          return {
            ...current,
            [sessionKey]: {
              ...session,
              messages: session.messages.map((message) =>
                message.id === pendingMessageId
                  ? {
                      ...message,
                      body: `${deterministicReceipt}\n\nThe graph was updated. The automatic LLM comment was unavailable; no review findings were invented.`,
                      trace: [
                        uiText('Pseudocode revision committed'),
                        uiText('Automatic Model Assistant review unavailable'),
                      ],
                    }
                  : message,
              ),
            },
          };
        });
      });
  };

  const commitPseudocodeRevision = (
    nextModel: ModelSpec,
    normalizedPseudocode: string,
    originalDraft?: string,
  ) => {
    const changeSummary = modelPseudocodeChangeSummary(model, nextModel);
    appendPseudocodeUpdateLog(
      model.id,
      'updating',
      `Validated draft accepted. Updating graph from r${modelRevision}…`,
    );
    changeSummary.lines.forEach((line) => appendPseudocodeUpdateLog(model.id, 'review', line));
    const nextHistory = appendModelPseudocodeRevision(pseudocodeHistory, {
      parentRevision: modelRevision,
      model: nextModel,
      pseudocode: normalizedPseudocode,
      ...(originalDraft ? { originalDraft } : {}),
      label: originalDraft
        ? uiText('LLM-normalized pseudocode update')
        : uiText('Pseudocode update'),
    });
    const nextRevision = nextHistory[nextHistory.length - 1]!;
    const nextModels = replaceModelPreservingOrder(modelRegistryRef.current, nextModel);
    modelRegistryRef.current = nextModels;
    setModels(nextModels);
    setModelRevisions((current) => ({
      ...current,
      [model.id]: nextRevision.revision,
    }));
    setPseudocodeHistories((current) => ({ ...current, [model.id]: nextHistory }));
    setPseudocodeDrafts((current) => ({ ...current, [model.id]: normalizedPseudocode }));
    setViewSessions((current) => ({
      ...current,
      [modelChatSessionKey(nextModel, nextRevision.revision)]: modelViewSessionAfterRevision(
        model,
        nextModel,
      ),
    }));
    setRevisionGraphHighlights((current) => ({
      ...current,
      [modelChatSessionKey(nextModel, nextRevision.revision)]: modelGraphChangeHighlightFromSummary(
        changeSummary,
        'revision',
        model,
        nextModel,
      ),
    }));
    setPseudocodeNormalizationSources((current) => {
      const { [model.id]: _discarded, ...remaining } = current;
      return remaining;
    });
    setPseudocodeNotice({
      modelId: model.id,
      tone: 'success',
      message: `Created revision r${nextRevision.revision} from r${modelRevision}; graph updated and the changed block is focused in Expanded modules.`,
    });
    appendPseudocodeUpdateLog(
      model.id,
      'complete',
      `Graph updated as revision r${nextRevision.revision}. Changed block focused in Expanded modules; Python artifact generation and Model Assistant review started.`,
    );
    queuePseudocodeRevisionComment({
      previousModel: model,
      nextModel,
      nextModels,
      fromRevision: modelRevision,
      toRevision: nextRevision.revision,
    });
    void generatePythonArtifact(nextModel, nextRevision.revision);
    setModuleDetail(null);
    moduleDetailTriggerRef.current = null;
  };

  const updateGraphFromPseudocode = async () => {
    if (normalizingPseudocode) {
      pseudocodeNormalizerAbortRef.current?.abort();
      appendPseudocodeUpdateLog(
        model.id,
        'error',
        uiText('LLM interpretation was stopped by the user.'),
      );
      return;
    }
    appendPseudocodeUpdateLog(
      model.id,
      'reading',
      `Comparing the current draft with revision r${modelRevision}…`,
      !pendingPseudocodeNormalizationSource,
    );
    const decision = classifyModelPseudocodeUpdate(pseudocodeDraft, model.id);
    let interpretationReason: string;
    let reconciliationIntendedModel: ModelSpec | null = null;
    let reconciliationModuleIds: readonly string[] = [];
    if (decision.kind === 'commit') {
      const reconciliationIssues = modelPseudocodeNarrativeReconciliationIssues(
        model,
        decision.model,
      );
      if (reconciliationIssues.length === 0) {
        appendPseudocodeUpdateLog(
          model.id,
          'reading',
          uiText('Canonical template parsed locally. No LLM interpretation was needed.'),
        );
        commitPseudocodeRevision(
          decision.model,
          decision.pseudocode,
          pendingPseudocodeNormalizationSource,
        );
        return;
      }
      interpretationReason = reconciliationIssues.join(' ');
      reconciliationIntendedModel = decision.model;
      reconciliationModuleIds = modelPseudocodeNarrativeReconciliationModuleIds(
        model,
        decision.model,
      );
      appendPseudocodeUpdateLog(
        model.id,
        'review',
        `Narrative consistency check requested reconciliation: ${interpretationReason}`,
      );
    } else {
      interpretationReason = decision.reason;
      appendPseudocodeUpdateLog(
        model.id,
        'reading',
        `Local parser could not commit this draft: ${decision.reason}`,
      );
    }

    const targetModelId = model.id;
    const originalDraft = pendingPseudocodeNormalizationSource ?? pseudocodeDraft;
    const controller = new AbortController();
    pseudocodeNormalizerAbortRef.current = controller;
    setNormalizingPseudocode(true);
    const reportActivity = beginAiActivity('model-lab', controller.signal);
    appendPseudocodeUpdateLog(
      targetModelId,
      'interpreting',
      reconciliationIntendedModel
        ? `${selectedBuilderModel?.displayName ?? uiText('Selected Model Builder LLM')} · ${selectedBuilderReasoning?.label ?? uiText('model-default reasoning')} is reconciling transform, formula, and explanation only for: ${reconciliationModuleIds.join(', ')}. Graph topology is locked.`
        : `${selectedBuilderModel?.displayName ?? uiText('Selected Model Builder LLM')} · ${selectedBuilderReasoning?.label ?? uiText('model-default reasoning')} is reading the modified free-form draft and mapping Block fields, shapes, and connections.`,
    );
    setPseudocodeNotice({
      modelId: targetModelId,
      tone: 'success',
      message:
        'The draft is outside the standard template. Interpreting it with the selected Model Builder LLM…',
    });
    try {
      const result = reconciliationIntendedModel
        ? await modelPseudocodeNormalizer.reconcileNarrative({
            baseModel: model,
            intendedModel: reconciliationIntendedModel,
            moduleIds: reconciliationModuleIds,
            selection: builderSelection,
            signal: controller.signal,
          })
        : await modelPseudocodeNormalizer.normalize({
            baseModel: model,
            source: pseudocodeDraft,
            selection: builderSelection,
            signal: controller.signal,
          });
      if (controller.signal.aborted) return;
      const resultHunks = modelPseudocodeLineDiffHunks(originalDraft, result.pseudocode);
      if (resultHunks.length === 0) {
        setPseudocodeDrafts((current) => ({
          ...current,
          [targetModelId]: result.pseudocode,
        }));
        setPseudocodeNormalizationSources((current) => {
          const { [targetModelId]: _discarded, ...remaining } = current;
          return remaining;
        });
        setPseudocodeNotice({
          modelId: targetModelId,
          tone: 'error',
          message: 'The LLM returned an identical draft. No proposal or graph update was created.',
        });
        appendPseudocodeUpdateLog(
          targetModelId,
          'error',
          uiText(
            'LLM result is identical to the original draft. Diff panel suppressed; graph and revision tree unchanged.',
          ),
        );
        return;
      }
      const changeSummary = modelPseudocodeChangeSummary(model, result.model);
      const proposalFocusModuleId =
        changeSummary.addedBlocks[0] ??
        changeSummary.changedBlocks[0]?.id ??
        result.model.modules[0]?.id ??
        '';
      setPseudocodeDrafts((current) => ({
        ...current,
        [targetModelId]: result.pseudocode,
      }));
      setPseudocodeNormalizationSources((current) => ({
        ...current,
        [targetModelId]: originalDraft,
      }));
      setViewSessions((current) =>
        modelViewSessionWithUpdate(current, activeChatSessionKey, model, {
          selectedModuleId: proposalFocusModuleId,
          graphDetail: 'expanded',
        }),
      );
      setPseudocodeNotice({
        modelId: targetModelId,
        tone: 'success',
        message: `Normalized with ${result.trace.slice(0, 2).join(' · ')}. Graph unchanged; review the diff, then apply it as a revision.`,
      });
      appendPseudocodeUpdateLog(
        targetModelId,
        'review',
        `${reconciliationIntendedModel ? uiText('Bounded narrative reconciliation') : uiText('LLM interpretation')} completed (${result.trace.slice(0, 2).join(' · ')}). Graph is still unchanged.`,
      );
      changeSummary.lines.forEach((line) =>
        appendPseudocodeUpdateLog(targetModelId, 'review', `LLM mapped: ${line}`),
      );
      appendPseudocodeUpdateLog(
        targetModelId,
        'review',
        uiText(
          'Review the proposed text and diff. Apply as revision is the only action that updates the graph.',
        ),
      );
      reportActivity('completed');
    } catch (error) {
      const errorMessage = controller.signal.aborted
        ? uiText('Pseudocode interpretation stopped.')
        : error instanceof Error
          ? error.message
          : `Pseudocode interpretation failed after: ${interpretationReason}`;
      setPseudocodeNotice({
        modelId: targetModelId,
        tone: 'error',
        message: errorMessage,
      });
      appendPseudocodeUpdateLog(targetModelId, 'error', errorMessage);
    } finally {
      reportActivity('failed');
      if (pseudocodeNormalizerAbortRef.current === controller) {
        pseudocodeNormalizerAbortRef.current = null;
        setNormalizingPseudocode(false);
      }
    }
  };

  const restoreFreeFormPseudocodeDraft = () => {
    if (!pendingPseudocodeNormalizationSource) return;
    setPseudocodeDrafts((current) => ({
      ...current,
      [model.id]: pendingPseudocodeNormalizationSource,
    }));
    setPseudocodeNormalizationSources((current) => {
      const { [model.id]: _discarded, ...remaining } = current;
      return remaining;
    });
    setPseudocodeNotice({
      modelId: model.id,
      tone: 'success',
      message: 'Restored the original free-form draft. The graph remains unchanged.',
    });
  };

  const selectPseudocodeRevision = (revision: ModelPseudocodeRevision) => {
    const nextModels = replaceModelPreservingOrder(modelRegistryRef.current, revision.model);
    modelRegistryRef.current = nextModels;
    setModels(nextModels);
    setModelRevisions((current) => ({ ...current, [model.id]: revision.revision }));
    setPseudocodeDrafts((current) => ({ ...current, [model.id]: revision.pseudocode }));
    setPseudocodeNormalizationSources((current) => {
      const { [model.id]: _discarded, ...remaining } = current;
      return remaining;
    });
    setPseudocodeNotice({
      modelId: model.id,
      tone: 'success',
      message: `Viewing revision r${revision.revision}. Editing and updating will create a child branch.`,
    });
    setModuleDetail(null);
    moduleDetailTriggerRef.current = null;
  };

  const registerModel = (candidate: ModelSpec) => {
    const registration = createImportedModelSession(modelRegistryRef.current, candidate);
    const nextModel = registration.model;
    modelRegistryRef.current = registration.models;
    setModels(registration.models);
    setModelRevisions((current) => ({
      ...current,
      [nextModel.id]: 0,
    }));
    const initialRevision = initialModelPseudocodeRevision(nextModel);
    setPseudocodeHistories((current) => ({
      ...current,
      [nextModel.id]: [initialRevision],
    }));
    setPseudocodeDrafts((current) => ({
      ...current,
      [nextModel.id]: initialRevision.pseudocode,
    }));
    setPseudocodeNormalizationSources((current) => {
      const { [nextModel.id]: _discarded, ...remaining } = current;
      return remaining;
    });
    setTrashedModelIds((current) => current.filter((candidate) => candidate !== nextModel.id));
    setTrashOpen(false);
    setModelId(nextModel.id);
    setExpandedModelIds([nextModel.id]);
    setPseudocodeNotice({
      modelId: nextModel.id,
      tone: 'success',
      message: 'Imported model and created revision r0 with synchronized pseudocode.',
    });
    void generatePythonArtifact(nextModel, 0);
    return registration;
  };

  const addFiles = async (files: readonly File[]) => {
    if (modelImportInFlightRef.current || files.length === 0) return;
    modelImportInFlightRef.current = true;
    const controller = new AbortController();
    modelImportAbortRef.current = controller;
    const checkImportCancelled = () => {
      if (controller.signal.aborted) throw Error('model_copilot_aborted');
    };
    setBuildingModel(true);
    const additions: ModelImportJob[] = [];
    const sourceArtifacts: ModelBuildArtifact[] = [];
    let activeBuildId: string | null = null;
    try {
      for (const file of files.slice(0, 8)) {
        checkImportCancelled();
        if (file.size > MODEL_LAB_MAX_IMPORT_BYTES && file.name.toLowerCase().endsWith('.json')) {
          additions.push({
            id: nextId('model-import'),
            name: file.name,
            status: 'rejected',
            phase: 'failed',
            detail: 'ModelIR JSON exceeds the 1 MB limit.',
            runLabel: 'Local ModelIR validation · No LLM',
            events: [uiText('Rejected before any LLM request was made.')],
          });
          continue;
        }
        if (file.name.toLowerCase().endsWith('.json')) {
          const text = await file.text();
          checkImportCancelled();
          const result = parseModelImportJson(text, {
            enforceSourceOutputContracts: true,
          });
          if (result.ok) {
            const registration = registerModel(result.model);
            additions.push({
              id: nextId('model-import'),
              name: file.name,
              status: 'session-created',
              phase: 'complete',
              detail: registration.identifierChanged
                ? `Created and opened a separate session as ${registration.model.name}; the imported identifier already existed.`
                : `Created and opened the ${registration.model.name} model session.`,
              runLabel: 'Local ModelIR validation · No LLM',
              events: [
                uiText('Validated ModelIR schema and transform ↔ equation consistency locally.'),
                uiText('Created revision r0 and opened a separate model session.'),
              ],
            });
          } else {
            additions.push({
              id: nextId('model-import'),
              name: file.name,
              status: 'rejected',
              phase: 'failed',
              detail: result.reason,
              runLabel: 'Local ModelIR validation · No LLM',
              events: [uiText('Local validation failed; no LLM request was made.')],
            });
          }
          continue;
        }
        const prepared = await prepareModelBuildArtifact(file);
        checkImportCancelled();
        if (prepared.ok) sourceArtifacts.push(prepared.artifact);
        else {
          additions.push({
            id: nextId('model-import'),
            name: file.name,
            status: 'rejected',
            phase: 'failed',
            detail: prepared.reason,
            runLabel: 'Local source preparation · No LLM request sent',
            events: [uiText('Source preparation failed before provider invocation.')],
          });
        }
      }
      if (additions.length > 0) {
        setImportJobs((current) => [...current, ...additions].slice(-8));
      }

      if (sourceArtifacts.length === 0) return;

      const buildId = nextId('model-build');
      activeBuildId = buildId;
      const sourceNames = sourceArtifacts.map((artifact) => artifact.name).join(' + ');
      const initialRunLabel = selectedBuilderModel
        ? [
            modelCopilotProviderLabel(selectedBuilderModel.providerId),
            selectedBuilderModel.displayName,
            selectedBuilderReasoning?.label ?? uiText('Model default reasoning'),
          ].join(' · ')
        : uiText('Auto routing · actual LLM will appear after server selection');
      const buildJob: ModelImportJob = {
        id: buildId,
        name: sourceNames,
        status: 'model-building',
        phase: 'sources-preparing',
        detail: `Prepared ${sourceArtifacts.length} source artifact${sourceArtifacts.length === 1 ? '' : 's'} locally.`,
        runLabel: initialRunLabel,
        events: [
          `Prepared ${sourceArtifacts.map((artifact) => artifact.kind).join(' + ')} source evidence locally.`,
        ],
      };
      setImportJobs((current) => [...current, buildJob].slice(-8));
      const result = await trackAiActivity(
        'model-lab',
        () =>
          codexModelBuilder.build(sourceArtifacts, builderSelection, {
            signal: controller.signal,
            onProgress: (progress) =>
              setImportJobs((current) =>
                current.map((job) =>
                  job.id === buildId ? modelImportJobAfterProgress(job, progress) : job,
                ),
              ),
          }),
        controller.signal,
      );
      checkImportCancelled();
      setImportJobs((current) =>
        current.map((job) =>
          job.id === buildId
            ? {
                ...job,
                phase: 'registering-session' as const,
                detail: 'ModelIR passed validation. Registering a separate model session.',
                events: [...job.events, uiText('Registering graph and revision r0.')].slice(-4),
              }
            : job,
        ),
      );
      const registration = registerModel(result.model);
      setImportJobs((current) =>
        current.map((job) =>
          job.id === buildId
            ? {
                ...job,
                status: 'session-created' as const,
                phase: 'complete' as const,
                detail: `Created and opened ${registration.model.name}. model.py generation continues as a separate background task.`,
                runLabel: result.trace.slice(0, 2).join(' · ') || job.runLabel,
                events: [
                  ...job.events,
                  `${registration.model.modules.length} modules · ${registration.model.connections.length} connections registered.`,
                ].slice(-4),
              }
            : job,
        ),
      );
    } catch (error) {
      const detail = controller.signal.aborted
        ? uiLocale().startsWith('ko')
          ? '모델 생성을 중단했습니다. 완료된 가져오기는 유지합니다.'
          : 'Model import stopped. Completed imports are preserved.'
        : error instanceof Error
          ? error.message
          : uiText('Model reconstruction failed.');
      setImportJobs((current) => {
        const buildingJob = activeBuildId
          ? current.find((job) => job.id === activeBuildId)
          : undefined;
        if (!buildingJob) {
          return [
            ...current,
            {
              id: nextId('model-import'),
              name: files.map((file) => file.name).join(' + '),
              status: 'rejected' as const,
              phase: controller.signal.aborted ? ('cancelled' as const) : ('failed' as const),
              detail,
              runLabel: 'Local source preparation · No LLM request confirmed',
              events: [uiText('Import failed before a provider run could be tracked.')],
            },
          ].slice(-8);
        }
        return current.map((job) => {
          if (job.id !== buildingJob.id) return job;
          const failureMessage = controller.signal.aborted
            ? detail
            : job.phase === 'failed'
              ? job.detail
              : detail;
          return {
            ...job,
            status: 'rejected' as const,
            phase: controller.signal.aborted ? ('cancelled' as const) : ('failed' as const),
            detail: failureMessage,
            events: [...job.events, failureMessage].slice(-4),
          };
        });
      });
    } finally {
      modelImportInFlightRef.current = false;
      if (modelImportAbortRef.current === controller) modelImportAbortRef.current = null;
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
        `A Model Assistant turn accepts up to ${MODEL_COPILOT_MAX_ATTACHMENTS} files.`,
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

  /**
   * "/new" and "/compact" are handled by GOSU: no user message is stored and the answer route is
   * never called. Files staged for the next message stay staged, and every outcome — including a
   * refusal or a failure code — is written to the composer's status line.
   */
  const runChatCommand = async (command: ChatSlashCommand) => {
    const sessionKey = activeChatSessionKey;
    const report = (status: ModelChatCommandState) =>
      setChatCommandStates((current) => ({ ...current, [sessionKey]: status }));
    report(modelChatCommandRunning(command));
    try {
      const update = await gosuModelLabRuntime.updateContext(
        command === '/new' ? 'new' : 'compact',
        {
          projectModels: copilotProjectModels,
          activeModelId: model.id,
          selectedModuleId: selectedModule.id,
          probe,
          checkpointIndex,
          question: command,
          selection: copilotSelection,
          conversationRevision: modelRevision,
          conversationWorkspaceId,
          conversation: modelFacingMessages.map((message) => ({
            role: message.role,
            body: moduleConversationBody(message),
            createdAt: message.createdAt,
          })),
        },
      );
      if (update.usage) {
        const usage = update.usage;
        setContextUsageBySession((current) => ({ ...current, [sessionKey]: usage }));
      }
      if (command === '/new') {
        setChatSessions((current) => {
          const session = current[sessionKey] ?? createModelChatSession(model);
          return {
            ...current,
            [sessionKey]: { ...session, contextStartsAt: session.messages.length },
          };
        });
      }
      report(modelChatCommandFinished(command, update));
    } catch (error) {
      report(
        modelChatCommandFailure(
          command,
          modelLabRuntimeErrorDetail(error instanceof Error ? error.message : error),
        ),
      );
    }
  };

  const submitQuestion = async (
    question: string,
    options: Readonly<{
      explanationOnly?: boolean;
      /** Asked from a module's detail: the message keeps this tag and shows only the question. */
      moduleRef?: ModuleQuestionRef;
      /** What Model Assistant receives for this turn when it differs from the visible question. */
      prompt?: string;
    }> = {},
  ): Promise<{ ok: true; body: string } | { ok: false; reason: string } | null> => {
    if (workspaceEmpty) return null;
    const trimmed = question.trim();
    const submission = modelChatSubmission(trimmed, {
      answering,
      commandRunning: activeChatCommand?.phase === 'running',
    });
    if (submission.kind === 'refused') {
      const sessionKey = activeChatSessionKey;
      setChatCommandStates((current) => ({ ...current, [sessionKey]: submission.status }));
      return null;
    }
    if (submission.kind === 'command') {
      await runChatCommand(submission.command);
      return null;
    }
    if ((!trimmed && copilotAttachments.length === 0) || answering) return null;
    // An ordinary question replaces the last command receipt; the composer stays quiet.
    if (activeChatCommand)
      setChatCommandStates((current) => ({ ...current, [activeChatSessionKey]: undefined }));
    if (!options.explanationOnly && !copilotAttachments.length && paperReply.current?.(trimmed))
      return null;
    const submittedQuestion =
      trimmed || uiText('Analyze the attached files against the selected model graph evidence.');
    const submittedAttachments = options.explanationOnly ? [] : [...copilotAttachments];
    const retrievedMemory = selectAgentPermanentMemories(
      permanentMemory.filter((entry) => entry.scopeType === 'model' && entry.scopeId === model.id),
      submittedQuestion,
      {
        maxTokens: planAgentContextBudget(
          selectedCopilotModel?.contextWindowTokens === undefined
            ? {}
            : { contextWindowTokens: selectedCopilotModel.contextWindowTokens },
        ).permanentMemoryBudgetTokens,
      },
    );
    const turn: ModelLabTurnScope = {
      sequence: turnSequenceRef.current + 1,
      modelId: model.id,
      modelVersion: model.version,
    };
    turnSequenceRef.current = turn.sequence;
    const turnController = copilotRuns.start(activeChatSessionKey);
    if (!turnController) return null;
    const turnIsCurrent = () => copilotRuns.owns(activeChatSessionKey, turnController);
    chatPinnedToBottomRef.current = true;
    setChatNearBottom(true);
    setMessages((current) => [
      ...current,
      {
        id: nextId('user'),
        modelId: model.id,
        modelVersion: model.version,
        createdAt: new Date().toISOString(),
        role: 'user',
        body: submittedQuestion,
        ...(options.moduleRef ? { moduleRef: options.moduleRef } : {}),
        attachmentNames: submittedAttachments.map((attachment) => attachment.artifact.name),
      },
    ]);
    if (!options.explanationOnly) {
      setQuestion('');
      setCopilotAttachments([]);
      setCopilotAttachmentNotice(null);
    }
    try {
      const answer = await gosuModelLabRuntime.answer(
        {
          projectModels: copilotProjectModels,
          activeModelId: model.id,
          selectedModuleId: selectedModule.id,
          probe,
          checkpointIndex,
          question: options.prompt ?? submittedQuestion,
          attachments: submittedAttachments.map((attachment) => attachment.artifact),
          persistentMemory: retrievedMemory.entries,
          selection: copilotSelection,
          conversationRevision: modelRevision,
          conversationWorkspaceId,
          // Earlier module questions stay attributed to their module for the rest of the talk.
          // A conversation reset after "/new" bootstraps from the divider, never from above it.
          conversation: modelFacingMessages.map((message) => ({
            role: message.role,
            body: moduleConversationBody(message),
            createdAt: message.createdAt,
          })),
        },
        {
          signal: turnController.signal,
          onContextUsage: (usage) => {
            if (turnIsCurrent())
              setContextUsageBySession((current) => ({
                ...current,
                [activeChatSessionKey]: usage,
              }));
          },
          onProgress: (progress) => {
            if (!turnIsCurrent()) return;
            copilotRuns.progress(activeChatSessionKey, turnController, progress);
          },
        },
      );
      if (!turnIsCurrent()) return null;
      if (turnController.signal.aborted) throw new Error('source_cancelled');
      const proposalIsFresh =
        (currentWorkspaceRef.current.selectedRevisions[turn.modelId] ?? 0) === modelRevision &&
        currentDraftsRef.current[turn.modelId] === pseudocodeDrafts[turn.modelId];
      // An explanation request never stages an edit, whatever the answer carries.
      const editProposal =
        !options.explanationOnly &&
        proposalIsFresh &&
        answer.editProposal?.model.id === turn.modelId
          ? answer.editProposal
          : undefined;
      const editProposalSummary = editProposal
        ? modelPseudocodeChangeSummary(model, editProposal.model)
        : null;
      if (editProposal) {
        const proposedPseudocode = modelToPseudocode(editProposal.model);
        setPseudocodeDrafts((current) => ({
          ...current,
          [turn.modelId]: proposedPseudocode,
        }));
        setPseudocodeNormalizationSources((current) => ({
          ...current,
          [turn.modelId]: current[turn.modelId] ?? pseudocodeDraft,
        }));
        setViewSessions((current) =>
          modelViewSessionWithUpdate(current, activeChatSessionKey, model, {
            selectedModuleId:
              editProposalSummary?.addedBlocks[0] ??
              editProposalSummary?.changedBlocks[0]?.id ??
              editProposal.model.modules[0]?.id ??
              '',
            graphDetail: 'expanded',
          }),
        );
        setPseudocodeNotice({
          modelId: turn.modelId,
          tone: 'success',
          message:
            'Model Assistant prepared a pseudocode and graph proposal. The graph is unchanged; review the diff, then apply it as a revision.',
        });
        appendPseudocodeUpdateLog(
          turn.modelId,
          'interpreting',
          `Model Assistant interpreted the chat request with ${copilotModelLabel} · ${copilotReasoningLabel}.`,
          true,
        );
        editProposalSummary?.lines.forEach((line) =>
          appendPseudocodeUpdateLog(turn.modelId, 'review', `Chat proposal mapped: ${line}`),
        );
        appendPseudocodeUpdateLog(
          turn.modelId,
          'review',
          uiText(
            'Pseudocode proposal prepared. Graph and revision tree remain unchanged until Apply as revision.',
          ),
        );
      }
      const assistantMessageId = nextId('assistant');
      const assistantCreatedAt = new Date().toISOString();
      const assistantBody = editProposal
        ? `${answer.body}\n\n**Edit proposal receipt**\n${editProposalSummary?.lines.map((line) => `- ${line}`).join('\n')}\n\nGraph unchanged. Review the pseudocode diff and use **Apply as revision** to update it.`
        : answer.body +
          (answer.editProposal && !proposalIsFresh
            ? '\n\nThe answer is saved to the original conversation. A newer revision or draft exists, so the background edit proposal did not overwrite it.'
            : '');
      setMessages((current) => [
        ...current,
        {
          id: assistantMessageId,
          modelId: turn.modelId,
          modelVersion: turn.modelVersion,
          createdAt: assistantCreatedAt,
          role: 'assistant',
          body: assistantBody,
          ...(options.moduleRef ? { moduleRef: options.moduleRef } : {}),
          trace: editProposal
            ? [
                `Memory retrieval · ${retrievedMemory.entries.length}/${retrievedMemory.candidateCount} selected · ~${retrievedMemory.estimatedTokens} tokens`,
                ...answer.trace,
                uiText('Chat edit proposal · graph unchanged pending review'),
              ]
            : [
                `Memory retrieval · ${retrievedMemory.entries.length}/${retrievedMemory.candidateCount} selected · ~${retrievedMemory.estimatedTokens} tokens`,
                ...answer.trace,
              ],
          ...(answer.usage ? { usage: answer.usage } : {}),
          ...(answer.contextUsage ? { contextUsage: answer.contextUsage } : {}),
        },
      ]);
      const memory = createAgentPermanentMemoryEntry({
        id: nextId('model-memory'),
        scopeType: 'model',
        scopeId: turn.modelId,
        sourceId: assistantMessageId,
        userRequest: options.moduleRef
          ? `[${options.moduleRef.name}] ${submittedQuestion}`
          : submittedQuestion,
        outcome: assistantBody,
        createdAt: assistantCreatedAt,
      });
      if (memory) {
        setPermanentMemory((current) =>
          boundModelLabPermanentMemory([
            ...current.filter(
              (entry) =>
                entry.id !== memory.id &&
                !(entry.scopeId === memory.scopeId && entry.sourceId === memory.sourceId),
            ),
            memory,
          ]),
        );
      }
      return { ok: true, body: answer.body };
    } catch (error) {
      if (!turnIsCurrent()) return null;
      const reason = turnController.signal.aborted
        ? uiText('This Model Assistant agent turn was stopped.')
        : modelLabRuntimeErrorMessage(error);
      setMessages((current) => [
        ...current,
        {
          id: nextId('assistant-error'),
          modelId: turn.modelId,
          modelVersion: turn.modelVersion,
          createdAt: new Date().toISOString(),
          role: 'assistant',
          body: reason,
          ...(options.moduleRef ? { moduleRef: options.moduleRef } : {}),
          trace: [
            `${turn.modelId}@${turn.modelVersion}`,
            turnController.signal.aborted
              ? uiText('User stopped agent run')
              : uiText('Bounded runtime error'),
          ],
        },
      ]);
      return { ok: false, reason };
    } finally {
      copilotRuns.finish(activeChatSessionKey, turnController);
    }
  };

  const [moduleExplanations, setModuleExplanations] = useState(() =>
    readModuleExplanations(storage?.getItem(MODULE_EXPLANATIONS_STORAGE_KEY)),
  );
  /** Modules of this model with a saved Model Assistant discussion; their graph cards are marked. */
  const explainedModuleKeys = useMemo(
    () => new Set(Object.keys(moduleExplanations.models[model.id] ?? {})),
    [moduleExplanations, model.id],
  );
  const [moduleExplanationRun, setModuleExplanationRun] = useState<{
    modelId: string;
    key: string;
    busy: boolean;
    error: string | null;
  } | null>(null);
  /** One Model Assistant turn about a module: the first explanation, or a follow-up question. */
  const askAboutModule = async (
    target: ModelModule,
    graphModel: ModelSpec,
    followUp?: string,
  ): Promise<boolean> => {
    const key = moduleExplanationKey(target);
    const modelIdAtRequest = model.id;
    const saved = moduleExplanation(moduleExplanations, modelIdAtRequest, target);
    if (answering) {
      setModuleExplanationRun({
        modelId: modelIdAtRequest,
        key,
        busy: false,
        error: uiText('Model Assistant is answering another question. Try again when it finishes.'),
      });
      return false;
    }
    setModuleExplanationRun({ modelId: modelIdAtRequest, key, busy: true, error: null });
    const parent = loopParentModule(model, graphModel);
    // The latest exchanges about this module, taken from the one Model Assistant conversation.
    let asked: ModuleQuestionRef | null = null;
    const exchanges = messages.flatMap((message) => {
      const shown = chatMessageDisplay(message);
      if (message.role === 'user') asked = shown.moduleRef;
      const about: ModuleQuestionRef | null = shown.moduleRef ?? asked;
      return about?.moduleId === target.id ? [{ role: message.role, body: shown.body }] : [];
    });
    const result = await submitQuestion(followUp ?? uiText('Explain this module in detail.'), {
      explanationOnly: true,
      moduleRef: moduleQuestionRef(target, followUp ? 'question' : 'explain'),
      prompt: followUp
        ? moduleFollowUpQuestion(
            graphModel,
            target,
            parent,
            exchanges.length > 0 ? exchanges : (saved?.messages ?? []),
            followUp,
          )
        : moduleExplanationQuestion(graphModel, target, parent),
    });
    if (!result || !result.ok) {
      setModuleExplanationRun({
        modelId: modelIdAtRequest,
        key,
        busy: false,
        error: result
          ? result.reason
          : uiText('Model Assistant could not start. Check the Assistant panel and try again.'),
      });
      return false;
    }
    const createdAt = new Date().toISOString();
    setModuleExplanations((current) => {
      const next = withModuleExplanation(
        current,
        modelIdAtRequest,
        target,
        [
          ...(followUp ? [{ role: 'user' as const, body: followUp, createdAt }] : []),
          { role: 'assistant' as const, body: result.body, createdAt },
        ],
        // "Explain again" starts the module's discussion over.
        !followUp,
      );
      try {
        storage?.setItem(MODULE_EXPLANATIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // The answer stays visible for this session even if it could not be stored.
      }
      return next;
    });
    setModuleExplanationRun(null);
    return true;
  };

  const downloadActivePythonArtifact = () => {
    const artifact = activePythonArtifactState?.artifact;
    if (!artifact) return;
    const url = URL.createObjectURL(new Blob([artifact.source], { type: 'text/x-python' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = modelPythonDownloadName(model.name, modelRevision);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const openModelDiscussion = (id: string) => {
    setModelId(id);
    setTrashOpen(false);
    setModelFocus(false);
    setCopilotCollapsed(false);
    setMobileCopilotOpen(true);
    setModelChatFocusRequest((value) => value + 1);
  };
  const openProjectDiscussion = async (id: string, revision: number) => {
    if (!host || modelReferenceBusy || !storage) return;
    setModelReferenceBusy(true);
    try {
      storage.setItem(
        MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
        serializeModelPseudocodeWorkspace({
          histories: pseudocodeHistories,
          selectedRevisions: modelRevisions,
          activeModelId: modelId,
          trashedModelIds,
        }),
      );
      await storage.flush?.();
      // The parent receives only identifiers; Main resolves the saved content and hash itself.
      window.parent.postMessage(
        { type: 'gosu:model-lab:project-chat', model: { modelId: id, revision } },
        '*',
      );
    } catch {
      setCopyNotice(uiText('Save the model successfully before opening Project Chat.'));
    } finally {
      setModelReferenceBusy(false);
    }
  };

  return (
    <main
      ref={shellRef}
      className={modelLabShellClassName(modelFocus, modelSessionsPanelCollapsed)}
      data-model-focus={modelFocus}
      data-project-id={host?.projectId}
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
          ? uiText(
              'Model focus mode active. Non-visualization panels are hidden. Press Escape to exit.',
            )
          : uiText('Model focus mode inactive.')}
      </span>
      <aside
        id="model-session-sidebar"
        className={`model-session-sidebar${modelSessionsPanelCollapsed ? ' model-session-sidebar--collapsed' : ''}`}
        aria-label={
          modelSessionsPanelCollapsed
            ? uiText('Collapsed generated models sidebar')
            : uiText('Generated models and modules')
        }
      >
        <button
          ref={modelSessionsRestoreRef}
          className="model-session-sidebar__restore"
          type="button"
          aria-label={uiText('Restore generated models sidebar')}
          hidden={!modelSessionsPanelCollapsed}
          onClick={restoreModelSessions}
        >
          <span aria-hidden="true">→</span>
          <strong>{uiText('Models')}</strong>
        </button>
        <header>
          <div>
            <span className="eyebrow">{uiText('MODEL LAB')}</span>
            <strong>{uiText('Models')}</strong>
          </div>
          <div className="model-session-header-actions">
            <span
              className="model-session-count"
              aria-label={uiText('{value0} active models', { value0: activeModels.length })}
            >
              {activeModels.length}
            </span>
            <button
              className="model-trash-toggle"
              type="button"
              aria-pressed={trashOpen}
              aria-label={uiText('Trash, {value0} model sessions', {
                value0: trashedModels.length,
              })}
              onClick={() => {
                setTrashOpen((current) => !current);
                setEmptyTrashArmed(false);
              }}
            >
              {uiText('Trash ')}
              {trashedModels.length}
            </button>
            <button
              ref={modelSessionsCollapseRef}
              className="model-session-sidebar__toggle"
              type="button"
              aria-label={uiText('Minimize generated models sidebar')}
              disabled={workspaceEmpty}
              aria-controls="model-session-sidebar"
              aria-expanded={!modelSessionsPanelCollapsed}
              onClick={collapseModelSessions}
            >
              <span aria-hidden="true">←</span>
            </button>
          </div>
        </header>
        {trashOpen ? (
          <section className="model-trash-panel" aria-labelledby="model-trash-title">
            <header>
              <div>
                <span className="eyebrow">{uiText('TRASH')}</span>
                <strong id="model-trash-title">{uiText('Deleted model sessions')}</strong>
              </div>
              <span
                className="model-session-count"
                aria-label={uiText('{value0} trashed models', { value0: trashedModels.length })}
              >
                {trashedModels.length}
              </span>
            </header>
            <p className="model-trash-notice" aria-live="polite">
              {trashNotice || uiText('Restore a model or permanently remove every model in Trash.')}
            </p>
            {trashedModels.length === 0 ? (
              <p className="model-trash-empty">{uiText('Trash is empty.')}</p>
            ) : (
              <ul className="model-trash-list">
                {trashedModels.map((candidate) => (
                  <li key={candidate.id}>
                    <span>
                      <strong>{englishGraphName(candidate.name, candidate.id)}</strong>
                      <small>{candidate.version}</small>
                    </span>
                    <button
                      className="quiet-button"
                      type="button"
                      onClick={() => restoreModelFromTrash(candidate.id)}
                    >
                      {uiText('Restore')}
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
                      {uiText(
                        trashedModels.length === 1
                          ? 'Permanently delete {count} model session and its chat/view state?'
                          : 'Permanently delete {count} model sessions and their chat/view state?',
                        { count: trashedModels.length },
                      )}
                    </p>
                    <div>
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() => setEmptyTrashArmed(false)}
                      >
                        {uiText('Cancel')}
                      </button>
                      <button
                        className="destructive-button"
                        type="button"
                        onClick={emptyModelTrash}
                      >
                        {uiText('Delete permanently')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="destructive-button"
                    type="button"
                    onClick={() => setEmptyTrashArmed(true)}
                  >
                    {uiText('Empty Trash')}
                  </button>
                )}
              </div>
            ) : null}
          </section>
        ) : (
          <nav
            className="model-session-tree"
            aria-label={uiText('Generated models and module blocks')}
          >
            {activeModels.map((candidate) => {
              const active = candidate.id === model.id;
              const expanded = expandedModelIds.includes(candidate.id);
              const candidateRevision = modelRevisions[candidate.id] ?? 0;
              const candidateSessionKey = modelChatSessionKey(candidate, candidateRevision);
              const candidateViewSession =
                viewSessions[candidateSessionKey] ?? createModelViewSession(candidate);
              const treeModel = active
                ? graphComposition.model
                : overviewModel(candidate, candidateViewSession.graphDetail);
              const candidateParameterTotal = candidate.modules.reduce(
                (total, module) => total + module.parameterCount,
                0,
              );
              return (
                <section
                  className={`model-tree-folder${active ? ' selected' : ''}`}
                  key={candidate.id}
                >
                  <div className="model-tree-folder-row">
                    <button
                      type="button"
                      className="model-tree-folder-button"
                      aria-expanded={expanded}
                      aria-current={active ? 'page' : undefined}
                      title={englishGraphName(candidate.name, candidate.id)}
                      onClick={() => {
                        setModelId(candidate.id);
                        setTrashOpen(false);
                        setExpandedModelIds((current) =>
                          toggleModelTreeExpansion(current, candidate.id),
                        );
                      }}
                    >
                      <span className="model-tree-folder-chevron" aria-hidden="true">
                        <ModelTreeChevron expanded={expanded} />
                      </span>
                      <span className="model-tree-folder-icon" aria-hidden="true">
                        {expanded ? '▰' : '▱'}
                      </span>
                      <span className="model-tree-folder-copy">
                        <strong>{englishGraphName(candidate.name, candidate.id)}</strong>
                        <small>
                          {candidate.version} · {candidate.modules.length}
                          {uiText(' modules ·')} {candidateParameterTotal.toLocaleString()}
                          {uiText(' parameters')}
                        </small>
                      </span>
                    </button>
                    <ModelReferenceActions
                      name={englishGraphName(candidate.name, candidate.id)}
                      disabled={
                        answering ||
                        buildingModel ||
                        modelReferenceBusy ||
                        Boolean(pendingPseudocodeNormalizationSource)
                      }
                      onLocal={() => openModelDiscussion(candidate.id)}
                    />
                    <details className="model-tree-folder-menu">
                      <summary
                        aria-label={uiText('Actions for {value0}', { value0: candidate.name })}
                        title={uiText('Model actions')}
                      >
                        •••
                      </summary>
                      <div role="menu">
                        {host && (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={
                              answering ||
                              buildingModel ||
                              modelReferenceBusy ||
                              Boolean(pendingPseudocodeNormalizationSource)
                            }
                            onClick={() =>
                              void openProjectDiscussion(candidate.id, candidateRevision)
                            }
                          >
                            {uiText('Ask in Project Chat')}
                          </button>
                        )}
                        {host && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() =>
                              setCopyTarget({
                                modelId: candidate.id,
                                modelName: candidate.name,
                                revision: candidateRevision,
                              })
                            }
                          >
                            {uiText('Duplicate to project…')}
                          </button>
                        )}
                        <button
                          type="button"
                          role="menuitem"
                          aria-label={modelSessionDeleteLabel(candidate.name)}
                          onClick={() => moveModelToTrash(candidate.id)}
                        >
                          {uiText('Delete')}
                        </button>
                      </div>
                    </details>
                  </div>
                  {expanded ? (
                    <div
                      className="model-tree-folder-children"
                      aria-label={uiText('{value0} module blocks', { value0: candidate.name })}
                    >
                      {treeModel.modules.map((module, index) => {
                        const health = moduleGradientHealth(
                          treeModel,
                          module.id,
                          probe,
                          checkpointIndex,
                        );
                        const nested =
                          active &&
                          graphComposition.expansions.some((expansion) =>
                            expansion.moduleIds.includes(module.id),
                          );
                        const moduleActive = active && module.id === selectedModule.id;
                        return (
                          <button
                            key={module.id}
                            type="button"
                            className={`${moduleActive ? 'active' : ''}${nested ? ' is-submodule' : ''}`}
                            aria-current={moduleActive ? 'page' : undefined}
                            onClick={() => {
                              const revealExpandedResidual = [
                                'pre-norm',
                                'residual-mlp',
                                'skip',
                                'merge',
                              ].includes(module.id);
                              setModelId(candidate.id);
                              setTrashOpen(false);
                              setViewSessions((current) =>
                                modelViewSessionWithUpdate(
                                  current,
                                  candidateSessionKey,
                                  candidate,
                                  {
                                    selectedModuleId: module.id,
                                    ...(revealExpandedResidual
                                      ? { graphDetail: 'expanded' as const }
                                      : {}),
                                  },
                                ),
                              );
                            }}
                          >
                            <span
                              className={`index-health index-health--${health}`}
                              aria-hidden="true"
                            />
                            <span>
                              <small>
                                {nested ? '↳ ' : ''}
                                {String(index + 1).padStart(2, '0')} · {module.group}
                              </small>
                              <strong>
                                {englishGraphName(module.name, module.id, 'Processing Block')}
                              </strong>
                              <code>{formatShape(module.outputShape)}</code>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </nav>
        )}
        <div
          className="panel-resizer panel-resizer--session-footer"
          role="separator"
          aria-orientation="horizontal"
          aria-label={uiText('Resize the import and builder area')}
          aria-valuemin={MODEL_SESSION_FOOTER_MIN_HEIGHT}
          aria-valuemax={MODEL_SESSION_FOOTER_MAX_HEIGHT}
          aria-valuenow={sessionFooterHeight ?? undefined}
          tabIndex={0}
          onPointerDown={beginFooterResize}
          onPointerMove={continueFooterResize}
          onPointerUp={endFooterResize}
          onPointerCancel={endFooterResize}
          onKeyDown={(event) => {
            if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            setSessionFooterHeightClamped(
              footerHeightAfterSeparatorKey(currentSessionFooterHeight(), event.key),
            );
          }}
        />
        <footer
          ref={sessionFooterRef}
          style={
            sessionFooterHeight === null
              ? undefined
              : { maxHeight: `${sessionFooterHeight}px`, height: `${sessionFooterHeight}px` }
          }
        >
          {importJobs.length > 0 ? (
            <details
              className="model-session-section"
              open={sessionSections.imports}
              onToggle={(event) =>
                storeSessionSections({ ...sessionSections, imports: event.currentTarget.open })
              }
            >
              <summary>
                <strong>{uiText('Graph import status')}</strong>
                <span>
                  {importJobs.length}
                  {buildingModel ? ` · ${uiText('building…')}` : ''}
                </span>
              </summary>
              <section
                className="model-import-activity"
                aria-label={uiText('New model import activity')}
                aria-live="polite"
              >
                {buildingModel && (
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => modelImportAbortRef.current?.abort()}
                  >
                    {uiLocale().startsWith('ko') ? '모델 생성 중지' : 'Stop model generation'}
                  </button>
                )}
                {importJobs.slice(-3).map((job) => (
                  <article
                    key={job.id}
                    className={`model-import-job model-import-job--${job.status}`}
                    role="status"
                  >
                    <header>
                      <span>{job.name}</span>
                      <b>{modelImportPhaseLabel(job.phase)}</b>
                    </header>
                    <small className="model-import-job__run">{job.runLabel}</small>
                    <small className="model-import-job__detail">{job.detail}</small>
                    {job.events.length > 0 ? (
                      <ol
                        aria-label={uiText('Recent import events for {value0}', {
                          value0: job.name,
                        })}
                      >
                        {job.events.map((event, index) => (
                          <li key={`${index}:${event}`}>{event}</li>
                        ))}
                      </ol>
                    ) : null}
                    {job.status !== 'model-building' ? (
                      <button
                        type="button"
                        aria-label={uiText('Dismiss import status for {value0}', {
                          value0: job.name,
                        })}
                        onClick={() =>
                          setImportJobs((current) =>
                            current.filter((candidate) => candidate.id !== job.id),
                          )
                        }
                      >
                        {uiText('Dismiss')}
                      </button>
                    ) : null}
                  </article>
                ))}
              </section>
            </details>
          ) : null}
          <details
            className="model-session-section"
            open={sessionSections.builder}
            onToggle={(event) =>
              storeSessionSections({ ...sessionSections, builder: event.currentTarget.open })
            }
          >
            <summary>
              <strong>{uiText('MODEL BUILDER LLM')}</strong>
              <span>
                {builderSelection.requestedModelId
                  ? (copilotCatalog?.models.find(
                      (candidate) => candidate.modelId === builderSelection.requestedModelId,
                    )?.displayName ?? builderSelection.requestedModelId)
                  : uiText('Auto')}
                {builderSelection.reasoningOptionId
                  ? ` · ${builderReasoningOptions.find((option) => option.id === builderSelection.reasoningOptionId)?.label ?? builderSelection.reasoningOptionId}`
                  : ''}
              </span>
            </summary>
            <section
              className="model-builder-selection"
              aria-label={uiText('Model Builder LLM selection')}
            >
              <header>
                <span>
                  <small>{uiText('Python · image · PDF · DOCX · RTF · text')}</small>
                </span>
                <button
                  type="button"
                  disabled={buildingModel || copilotCatalogRefreshing}
                  onClick={() => void refreshCopilotCatalog()}
                >
                  {copilotCatalogRefreshing ? '…' : uiText('Refresh')}
                </button>
              </header>
              <label>
                <span>{uiText('Model')}</span>
                <select
                  aria-label={uiText('Model Builder model')}
                  value={builderSelection.requestedModelId ?? ''}
                  disabled={buildingModel || copilotCatalog === null || copilotCatalogRefreshing}
                  onChange={(event) => {
                    const requestedModelId = event.target.value || null;
                    const descriptor = requestedModelId
                      ? copilotCatalog?.models.find(
                          (candidate) => candidate.modelId === requestedModelId,
                        )
                      : undefined;
                    setBuilderSelection({
                      providerId: descriptor?.providerId ?? null,
                      requestedModelId,
                      reasoningOptionId: null,
                    });
                  }}
                >
                  <option value="">{uiText('Auto · provider recommended')}</option>
                  {builderModelSelectionMissing && builderSelection.requestedModelId ? (
                    <option value={builderSelection.requestedModelId} disabled>
                      {uiText('Unavailable model · choose again')}
                    </option>
                  ) : null}
                  {copilotProviderGroups.map(([providerId, candidates]) => (
                    <optgroup key={providerId} label={modelCopilotProviderLabel(providerId)}>
                      {candidates.map((candidate) => (
                        <option
                          key={`${candidate.providerId}:${candidate.modelId}`}
                          value={candidate.modelId}
                        >
                          {candidate.displayName}
                          {candidate.isDefault ? uiText(' · default') : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label>
                <span>{uiText('Reasoning')}</span>
                <select
                  aria-label={uiText('Model Builder reasoning')}
                  value={builderSelection.reasoningOptionId ?? ''}
                  disabled={buildingModel || builderReasoningOptions.length === 0}
                  onChange={(event) =>
                    setBuilderSelection((current) => ({
                      ...current,
                      reasoningOptionId: event.target.value || null,
                    }))
                  }
                >
                  <option value="">{uiText('Model default')}</option>
                  {builderReasoningSelectionMissing && builderSelection.reasoningOptionId ? (
                    <option value={builderSelection.reasoningOptionId} disabled>
                      {uiText('Unavailable reasoning · choose again')}
                    </option>
                  ) : null}
                  {builderReasoningOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                      {option.isDefault ? uiText(' · default') : ''}
                    </option>
                  ))}
                </select>
              </label>
            </section>
          </details>
          <ModelLabLanguageSettings preference={languagePreference} />
          <div className="model-session-footer-actions">
            <AttachmentInput
              onFiles={addFiles}
              label={
                buildingModel ? uiText('Creating new session…') : uiText('+ New / Import model')
              }
              disabled={buildingModel}
            />
            <small className="model-import-boundary">
              {uiText(
                'Source files use the selected LLM. ModelIR JSON imports directly without an LLM. Every import creates a separate model session.',
              )}
            </small>
          </div>
        </footer>
      </aside>

      <div
        className="panel-resizer panel-resizer--model-sessions"
        role="separator"
        aria-label={uiText('Resize generated models sidebar')}
        aria-orientation="vertical"
        aria-valuemin={MODEL_SESSION_SIDEBAR_MIN_WIDTH}
        aria-valuemax={panelMaximum('model-sessions')}
        aria-valuenow={modelSessionSidebarWidth}
        aria-valuetext={uiText('{value0} pixels', { value0: modelSessionSidebarWidth })}
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

      {copyNotice && (
        <div className="model-lab-copy-notice" role="status">
          {copyNotice}
          <button type="button" onClick={() => setCopyNotice('')}>
            {uiText('Dismiss')}
          </button>
        </div>
      )}
      {workspaceEmpty ? (
        <section
          className="model-lab-content model-lab-empty"
          aria-label={uiText('Empty project Model Lab')}
        >
          <span className="eyebrow">{host?.projectName ?? uiText('MODEL LAB')}</span>
          <h1>{uiText('No models in this project yet')}</h1>
          <p>
            {uiText('Use ')}
            <strong>{uiText('+ New / Import model')}</strong>
            {uiText(" on the left, or duplicate a model here from another project's Model Lab.")}
          </p>
          <p>
            {uiText(
              "Each project owns independent model sessions. Changes here never update another project's models.",
            )}
          </p>
          {trashedModels.length > 0 && (
            <button type="button" onClick={() => setTrashOpen(true)}>
              {uiText('View Trash · ')}
              {trashedModels.length}
            </button>
          )}
          {hostSaveStatus === 'failed' && (
            <p role="alert">{uiText('Project save failed. Keep this tab open and retry.')}</p>
          )}
        </section>
      ) : (
        <div className="model-lab-content">
          <header className="model-lab-header">
            <div className="brand-lockup">
              <div className="brand-mark" aria-hidden="true">
                {uiText('M')}
              </div>
              <div>
                <span className="eyebrow">
                  {host
                    ? uiText('{value0} · MODEL LAB', { value0: host.projectName })
                    : uiText('GOSU MODEL LAB')}
                </span>
                <h1>{uiText('Model Lab')}</h1>
              </div>
            </div>
            <div className="model-summary" aria-label={uiText('Active model summary')}>
              <strong>{englishGraphName(model.name, model.id)}</strong>
              <ModelReferenceActions
                name={englishGraphName(model.name, model.id)}
                disabled={
                  answering ||
                  buildingModel ||
                  modelReferenceBusy ||
                  Boolean(pendingPseudocodeNormalizationSource)
                }
                onLocal={() => openModelDiscussion(model.id)}
              />
              <span>{model.version}</span>
              <span>{model.framework}</span>
              <span>
                {model.modules.length}
                {uiText(' modules')}
              </span>
              <span>
                {parameterTotal.toLocaleString()}
                {uiText(' parameters')}
              </span>
            </div>
            <div className="header-actions">
              {host && (
                <span role="status">
                  {hostSaveStatus === 'failed' ? (
                    <>
                      {uiText('Project save failed')}{' '}
                      <button
                        type="button"
                        onClick={() => {
                          saveChat();
                          storage?.retry?.();
                        }}
                      >
                        {uiText('Retry save')}
                      </button>
                    </>
                  ) : hostSaveStatus === 'saving' ? (
                    uiText('Saving project…')
                  ) : (
                    uiText('Project saved')
                  )}
                </span>
              )}
              <span className="runtime-status">
                <span aria-hidden="true" />{' '}
                {copilotStatus === null
                  ? uiText('Checking Assistant')
                  : copilotStatus.available
                    ? uiText('LLM · {value0}', {
                        value0: selectedCopilotModel?.displayName ?? copilotStatus.model,
                      })
                    : uiText('Assistant unavailable')}
              </span>
              <details className="model-lab-about">
                <summary>{uiText('About')}</summary>
                <div role="note" aria-label={uiText('Prototype boundary')}>
                  <strong>{uiText('Live in this prototype')}</strong>
                  <span>
                    {uiText(
                      'ModelIR and source reconstruction; interactive graph, deterministic checks, PyTorch evidence, and LLM Assistant.',
                    )}
                  </span>
                  <strong>{uiText('Adapter boundary')}</strong>
                  <span>
                    {uiText(
                      'Generated architectures remain static evidence until GOSU Agent Runtime attaches execution and gradient receipts.',
                    )}
                  </span>
                </div>
              </details>
              <button
                className="primary-button model-lab-header__review"
                type="button"
                onClick={() => setReviewNonce((value) => value + 1)}
              >
                {uiText('Run checks')}
              </button>
            </div>
          </header>

          <div className={modelLabWorkbenchClassName(copilotPanelCollapsed)}>
            <div className="model-lab-primary">
              <div
                className={`model-lab-grid${signalMode === 'forward' ? ' model-lab-grid--architecture' : ''}`}
              >
                <section
                  className="graph-workspace"
                  aria-label={uiText('Interactive model visualization')}
                >
                  <div className="graph-toolbar">
                    <div className="graph-toolbar__primary">
                      <div className="segmented-control" aria-label={uiText('Graph detail')}>
                        <button
                          type="button"
                          className={graphDetail === 'overview' ? 'is-active' : ''}
                          aria-pressed={graphDetail === 'overview'}
                          onClick={() => setGraphDetail('overview')}
                        >
                          {uiText('Overview')}
                        </button>
                        <button
                          type="button"
                          className={graphDetail === 'expanded' ? 'is-active' : ''}
                          aria-pressed={graphDetail === 'expanded'}
                          onClick={() => setGraphDetail('expanded')}
                        >
                          {uiText('Expanded modules')}
                        </button>
                      </div>
                      <div
                        className="segmented-control"
                        aria-label={uiText('Signal visualization')}
                      >
                        <button
                          type="button"
                          className={signalMode === 'forward' ? 'is-active' : ''}
                          aria-pressed={signalMode === 'forward'}
                          onClick={() => setSignalMode('forward')}
                        >
                          {uiText('Forward tensors')}
                        </button>
                        <button
                          type="button"
                          className={signalMode === 'backward' ? 'is-active' : ''}
                          aria-pressed={signalMode === 'backward'}
                          onClick={() => setSignalMode('backward')}
                        >
                          {uiText('Backward gradients')}
                        </button>
                      </div>
                      <button
                        ref={focusToggleRef}
                        className="quiet-button focus-mode-toggle"
                        type="button"
                        aria-pressed={modelFocus}
                        aria-keyshortcuts={modelFocus ? 'Escape' : undefined}
                        onClick={() => setModelFocus((current) => !current)}
                      >
                        <span aria-hidden="true">{modelFocus ? '↙' : '⛶'}</span>
                        {modelFocus ? uiText('Exit focus') : uiText('Focus graph')}
                      </button>
                    </div>
                    {signalMode === 'backward' && (
                      <div className="graph-toolbar__diagnostics">
                        <label>
                          <span>{uiText('Gradient scenario')}</span>
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
                          {uiText(scenarioKind)}
                        </span>
                        <label className="checkpoint-control">
                          <span>
                            {scenarioKind === uiText('pytorch-observed')
                              ? uiText('Seeded PyTorch probe')
                              : uiText('Scenario checkpoint')}
                            {' · '}
                            {uiText('batch ')}
                            {checkpoint} / 5
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
                      </div>
                    )}
                  </div>
                  <ModelGraph
                    key={modelGraphInstanceKey(
                      model.id,
                      modelRevision,
                      modelFocus,
                      expandedSubgraphModuleIds,
                      modelSessionsPanelCollapsed,
                      copilotPanelCollapsed,
                      activeGraphHighlight ? JSON.stringify(activeGraphHighlight) : '',
                    )}
                    composition={graphComposition}
                    selectedModuleId={selectedModule.id}
                    probe={probe}
                    checkpointIndex={checkpointIndex}
                    signalMode={signalMode}
                    focusMode={modelFocus}
                    changeHighlight={activeGraphHighlight}
                    openModuleId={activeModuleDetail?.module.id ?? null}
                    explainedKeys={explainedModuleKeys}
                    onSelectModule={setSelectedModuleId}
                    onOpenModule={openModuleDetail}
                    onToggleSubgraph={toggleSubgraph}
                  />
                  {signalMode === 'backward' && (
                    <div className="gradient-legend" aria-label={uiText('Gradient health legend')}>
                      <span>
                        <i className="legend-good" />
                        {uiText(' Healthy')}
                      </span>
                      <span>
                        <i className="legend-low" />
                        {uiText(' Vanishing')}
                      </span>
                      <span>
                        <i className="legend-bad" />
                        {uiText(' Blocked / exploding')}
                      </span>
                      <span>
                        <i className="legend-na" />
                        {uiText(' Not differentiable')}
                      </span>
                      <strong>{activeProbeLabels[probe]}</strong>
                    </div>
                  )}
                </section>

                <aside className="module-inspector" aria-labelledby="inspector-title">
                  <div className="inspector-heading">
                    <div>
                      <span className="eyebrow">{uiText('MODULE INSPECTOR')}</span>
                      <h2 id="inspector-title">
                        {englishGraphName(
                          selectedModule.name,
                          selectedModule.id,
                          'Processing Block',
                        )}
                      </h2>
                    </div>
                    <span className={`health-chip health-chip--${selectedHealth}`}>
                      {selectedHealth}
                    </span>
                  </div>
                  <p>{selectedModule.explanation}</p>
                  {selectedModule.presentation && (
                    <section aria-label={uiText('Tensor reasoning')}>
                      <strong>{uiText('Tensor reasoning')}</strong>
                      <p>{selectedModule.presentation.shapeNotes}</p>
                      <Formula latex={selectedModule.presentation.keyEquation} />
                      {selectedModule.presentation.uncertainties.length > 0 && (
                        <>
                          <strong>{uiText('Unresolved operations')}</strong>
                          <ul>
                            {selectedModule.presentation.uncertainties.map((note, index) => (
                              <li key={index}>{note}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </section>
                  )}
                  {selectedSubgraphTarget ? (
                    <button
                      className="primary-button inspector-subgraph-toggle"
                      type="button"
                      aria-expanded={selectedSubgraphExpanded}
                      onClick={() => toggleSubgraph(selectedModule.id)}
                    >
                      {selectedSubgraphExpanded ? uiText('Collapse') : uiText('Expand')}{' '}
                      {selectedSubgraphTarget.modelName} · {selectedSubgraphTarget.moduleCount}{' '}
                      {uiText('submodules ')}
                      {selectedSubgraphExpanded ? '↑' : uiText('inside this graph ↓')}
                    </button>
                  ) : null}
                  <dl className="module-facts">
                    <div>
                      <dt>{uiText('Input')}</dt>
                      <dd>{formatModuleInputContract(selectedModule)}</dd>
                    </div>
                    <div>
                      <dt>{uiText('Output')}</dt>
                      <dd>{formatModuleOutputContract(selectedModule)}</dd>
                    </div>
                    <div>
                      <dt>{uiText('Transform')}</dt>
                      <dd>{selectedModule.transform}</dd>
                    </div>
                    <div>
                      <dt>{uiText('Activation')}</dt>
                      <dd>{selectedModule.activation ?? 'None'}</dd>
                    </div>
                    {selectedModule.repeat ? (
                      <div>
                        <dt>{uiText('Repeated stack')}</dt>
                        <dd>
                          {selectedModule.repeat.count} × {selectedModule.repeat.label}
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>{uiText('Parameters')}</dt>
                      <dd>{selectedModule.parameterCount.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>{uiText('Code')}</dt>
                      <dd>
                        <code>{selectedModule.codeReference}</code>
                      </dd>
                    </div>
                  </dl>
                  <section className="formula-panel" aria-label={uiText('Module formula')}>
                    <span>{uiText('Module equation')}</span>
                    <Formula latex={selectedModule.formula} />
                  </section>
                  <section
                    className="gradient-detail"
                    aria-label={uiText('Incoming gradient evidence')}
                  >
                    <div>
                      <strong>{uiText('Backward evidence')}</strong>
                      <span>
                        {uiText('probe batch ')}
                        {checkpoint}
                      </span>
                    </div>
                    {incoming.length === 0 ? (
                      <p>{uiText('No incoming gradient probe at the model boundary.')}</p>
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
                          {parameterCoverage.observed.tensors}/
                          {parameterCoverage.denominator.tensors}
                        </strong>
                        <span>{uiText('trainable tensors with observed gradients')}</span>
                        <small>
                          {parameterCoverage.observed.elements.toLocaleString()} /{' '}
                          {parameterCoverage.denominator.elements.toLocaleString()}
                          {uiText(' parameter elements')}
                        </small>
                      </div>
                    ) : (
                      <p className="gradient-coverage-empty">
                        {uiText('Parameter-gradient coverage not observed.')}
                      </p>
                    )}
                  </section>
                </aside>
              </div>

              <section className="model-pseudocode-studio" aria-labelledby="model-pseudocode-title">
                <header>
                  <div>
                    <span className="eyebrow">
                      {uiText('ARCHITECTURE SOURCE · REVISION r')}
                      {modelRevision}
                    </span>
                    <h2 id="model-pseudocode-title">{uiText('Model pseudocode')}</h2>
                    <p>
                      {uiText(
                        'Write freely or edit the standard template, then update an immutable graph revision.',
                      )}
                    </p>
                  </div>
                  <div className="model-pseudocode-actions">
                    <button
                      type="button"
                      className="quiet-button"
                      disabled={
                        (!pseudocodeDirty && !pendingPseudocodeNormalizationSource) ||
                        normalizingPseudocode
                      }
                      onClick={() => {
                        setPseudocodeDraft(activePseudocodeRevision.pseudocode);
                        setPseudocodeNormalizationSources((current) => {
                          const { [model.id]: _discarded, ...remaining } = current;
                          return remaining;
                        });
                        setPseudocodeNotice({
                          modelId: model.id,
                          tone: 'success',
                          message: `Draft restored to revision r${modelRevision}.`,
                        });
                      }}
                    >
                      {uiText('Reset draft')}
                    </button>
                    <button
                      type="button"
                      className={
                        normalizingPseudocode ? 'primary-button stopping' : 'primary-button'
                      }
                      disabled={
                        !normalizingPseudocode &&
                        !pseudocodeDirty &&
                        !pendingPseudocodeNormalizationSource
                      }
                      onClick={() => void updateGraphFromPseudocode()}
                    >
                      {normalizingPseudocode
                        ? uiText('Stop interpreting')
                        : pendingPseudocodeNormalizationSource
                          ? uiText('Apply as revision')
                          : uiText('Update graph')}
                    </button>
                  </div>
                </header>
                <details className="model-pseudocode-guide">
                  <summary>{uiText('Template guide · shared with the LLM normalizer')}</summary>
                  <pre>{MODEL_PSEUDOCODE_LLM_GUIDE}</pre>
                </details>
                {activePseudocodeUpdateLog.length > 0 ? (
                  <section
                    className="model-pseudocode-update-log"
                    aria-label={uiText('Architecture update receipt')}
                    aria-live="polite"
                  >
                    <header>
                      <div>
                        <strong>{uiText('Architecture update receipt')}</strong>
                        <span>
                          {uiText('What the parser or LLM read, and whether the graph changed.')}
                        </span>
                      </div>
                      <code data-phase={activePseudocodeUpdateLog.at(-1)?.phase}>
                        {activePseudocodeUpdateLog.at(-1)?.phase}
                      </code>
                    </header>
                    <ol>
                      {activePseudocodeUpdateLog.map((entry) => (
                        <li key={entry.id} data-phase={entry.phase}>
                          <time dateTime={entry.createdAt}>
                            {formatModelChatTime(entry.createdAt)}
                          </time>
                          <strong>{entry.phase}</strong>
                          <span>{entry.message}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}
                <div className="model-pseudocode-layout">
                  <aside
                    className="model-pseudocode-revision-tree"
                    aria-label={uiText('Model pseudocode revision tree')}
                  >
                    <header>
                      <strong>{uiText('Version tree')}</strong>
                      <span>
                        {pseudocodeHistory.length}
                        {uiText(' revisions')}
                      </span>
                    </header>
                    <ul>
                      {pseudocodeRevisionRows.map(({ revision, depth }) => (
                        <li
                          key={revision.revision}
                          style={{ '--revision-depth': depth } as CSSProperties}
                        >
                          <button
                            type="button"
                            className={revision.revision === modelRevision ? 'active' : ''}
                            aria-current={revision.revision === modelRevision ? 'page' : undefined}
                            onClick={() => selectPseudocodeRevision(revision)}
                          >
                            <span className="model-pseudocode-tree-branch" aria-hidden="true">
                              {depth === 0 ? '◆' : '└'}
                            </span>
                            <span>
                              <strong>
                                {uiText('r')}
                                {revision.revision}
                              </strong>
                              <small>{revision.label}</small>
                              {revision.originalDraft ? (
                                <small>{uiText('original draft retained')}</small>
                              ) : null}
                              <small>
                                {revision.parentRevision === null
                                  ? uiText('root')
                                  : uiText('from r{value0}', {
                                      value0: revision.parentRevision,
                                    })}{' '}
                                · {formatModelChatTime(revision.createdAt)}
                              </small>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p>
                      {uiText(
                        'Revisions are immutable. Updating an older revision creates a child branch.',
                      )}
                    </p>
                  </aside>
                  <div className="model-pseudocode-editor">
                    <textarea
                      ref={pseudocodeEditorRef}
                      value={pseudocodeDraft}
                      onChange={(event) => setPseudocodeDraft(event.target.value)}
                      aria-label={uiText('Model pseudocode editor')}
                      spellCheck={false}
                      wrap="off"
                    />
                    {pendingPseudocodeNormalizationSource &&
                    pseudocodeNormalizationDiff &&
                    pseudocodeDiffHunks.length > 0 ? (
                      <section
                        className="model-pseudocode-normalization-review"
                        aria-label={uiText('Review normalized pseudocode changes')}
                      >
                        <header>
                          <div>
                            <strong>{uiText('Review LLM edit proposal')}</strong>
                            <span>{uiText('Graph unchanged until Apply as revision.')}</span>
                          </div>
                          <button
                            type="button"
                            className="model-pseudocode-diff-jump"
                            aria-label={uiText(
                              pseudocodeDiffHunks.length === 1
                                ? 'Jump to changed lines. {count} change.'
                                : 'Jump to changed lines. {count} changes.',
                              { count: pseudocodeDiffHunks.length },
                            )}
                            onClick={jumpToPseudocodeDiffHunk}
                          >
                            +{pseudocodeNormalizationDiff.addedLines} / −
                            {pseudocodeNormalizationDiff.removedLines}
                            {uiText(' lines')}
                            <small>
                              {activePseudocodeDiffHunkIndex >= 0
                                ? `${activePseudocodeDiffHunkIndex + 1} / ${pseudocodeDiffHunks.length}`
                                : uiText(
                                    pseudocodeDiffHunks.length === 1
                                      ? '{count} change'
                                      : '{count} changes',
                                    { count: pseudocodeDiffHunks.length },
                                  )}
                            </small>
                          </button>
                        </header>
                        {pendingPseudocodeChangeSummary ? (
                          <ul className="model-pseudocode-change-summary">
                            {pendingPseudocodeChangeSummary.lines.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        ) : null}
                        {activePseudocodeDiffHunk ? (
                          <p className="model-pseudocode-active-hunk" role="status">
                            {uiText('Change ')}
                            {activePseudocodeDiffHunkIndex + 1}
                            {uiText(' of')} {pseudocodeDiffHunks.length}
                            {uiText(' · original lines')} {activePseudocodeDiffHunk.originalStart}–
                            {activePseudocodeDiffHunk.originalEnd}
                            {uiText(' · proposed lines')} {activePseudocodeDiffHunk.proposedStart}–
                            {activePseudocodeDiffHunk.proposedEnd}
                          </p>
                        ) : null}
                        <div className="model-pseudocode-diff">
                          <article className="removed">
                            <header>
                              <strong>{uiText('Original free-form draft')}</strong>
                              <span>
                                {pseudocodeNormalizationDiff.originalLines}
                                {uiText(' lines')}
                              </span>
                            </header>
                            <pre
                              ref={originalPseudocodeDiffRef}
                              onScroll={(event) =>
                                synchronizePseudocodeDiffScroll(
                                  event.currentTarget,
                                  proposedPseudocodeDiffRef.current,
                                )
                              }
                            >
                              {originalPseudocodeDiffLines.map((line, index) => {
                                const lineNumber = index + 1;
                                const active =
                                  activePseudocodeDiffHunk !== undefined &&
                                  lineNumber >= activePseudocodeDiffHunk.originalStart &&
                                  lineNumber <= activePseudocodeDiffHunk.originalEnd;
                                return (
                                  <span
                                    key={lineNumber}
                                    data-line={lineNumber}
                                    className={active ? 'is-active' : undefined}
                                  >
                                    {line || ' '}
                                  </span>
                                );
                              })}
                            </pre>
                          </article>
                          <article className="added">
                            <header>
                              <strong>{uiText('Proposed v2 draft')}</strong>
                              <span>
                                {pseudocodeNormalizationDiff.normalizedLines}
                                {uiText(' lines')}
                              </span>
                            </header>
                            <pre
                              ref={proposedPseudocodeDiffRef}
                              onScroll={(event) =>
                                synchronizePseudocodeDiffScroll(
                                  event.currentTarget,
                                  originalPseudocodeDiffRef.current,
                                )
                              }
                            >
                              {proposedPseudocodeDiffLines.map((line, index) => {
                                const lineNumber = index + 1;
                                const active =
                                  activePseudocodeDiffHunk !== undefined &&
                                  lineNumber >= activePseudocodeDiffHunk.proposedStart &&
                                  lineNumber <= activePseudocodeDiffHunk.proposedEnd;
                                return (
                                  <span
                                    key={lineNumber}
                                    data-line={lineNumber}
                                    className={active ? 'is-active' : undefined}
                                  >
                                    {line || ' '}
                                  </span>
                                );
                              })}
                            </pre>
                          </article>
                        </div>
                        <footer>
                          <span>
                            {uiText('Review or edit the proposed draft before applying it.')}
                          </span>
                          <button
                            type="button"
                            className="quiet-button"
                            onClick={restoreFreeFormPseudocodeDraft}
                          >
                            {uiText('Restore original draft')}
                          </button>
                        </footer>
                      </section>
                    ) : null}
                    {pseudocodeOriginalDraft ? (
                      <details className="model-pseudocode-original">
                        <summary>
                          {uiText('Original free-form draft retained with this revision')}
                        </summary>
                        <pre>{pseudocodeOriginalDraft}</pre>
                      </details>
                    ) : null}
                    <footer>
                      <span className={pseudocodeDirty ? 'dirty' : ''}>
                        {pseudocodeDirty
                          ? uiText('Unsaved architecture changes')
                          : uiText('Graph matches r{value0}', { value0: modelRevision })}
                      </span>
                      {pseudocodeNotice?.modelId === model.id ? (
                        <strong className={pseudocodeNotice.tone}>
                          {pseudocodeNotice.message}
                        </strong>
                      ) : null}
                      <em className={pseudocodePersistenceStatus}>
                        {pseudocodePersistenceStatus === 'saved'
                          ? uiText('Revision tree saved locally')
                          : uiText('Local revision save failed')}
                      </em>
                    </footer>
                  </div>
                </div>
                <footer className="model-pseudocode-future-boundary">
                  <strong>{uiText('Experiment integration boundary')}</strong>
                  <span>
                    {uiText(
                      'Every new revision can carry a syntax-checked Python artifact. Experiment execution remains disabled until GOSU consumes the manifest and requests explicit approval.',
                    )}
                  </span>
                </footer>
              </section>

              <section className="model-python-artifact" aria-labelledby="model-python-title">
                <header>
                  <div>
                    <span className="eyebrow">
                      {uiText('VERSIONED CODE ARTIFACT · REVISION r')}
                      {modelRevision}
                    </span>
                    <h2 id="model-python-title">{uiText('Python model')}</h2>
                    <p>
                      {uiText(
                        'Generated from the validated ModelIR and stored without executing it.',
                      )}
                    </p>
                  </div>
                  <div className="model-python-artifact__actions">
                    {activePythonArtifactState?.status === 'generating' ? (
                      <button
                        type="button"
                        className="quiet-button stopping"
                        onClick={() =>
                          pythonArtifactAbortRef.current.get(activePythonArtifactKey)?.abort()
                        }
                      >
                        {uiText('Stop generation')}
                      </button>
                    ) : null}
                    {activePythonArtifactState?.artifact ? (
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={downloadActivePythonArtifact}
                      >
                        {uiText('Download .py')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="primary-button"
                      disabled={
                        activePythonArtifactState?.status === 'generating' ||
                        activePythonArtifactState?.status === 'loading'
                      }
                      onClick={() => void generatePythonArtifact(model, modelRevision)}
                    >
                      {activePythonArtifactState?.artifact
                        ? uiText('Regenerate Python')
                        : uiText('Generate Python')}
                    </button>
                  </div>
                </header>
                {activePythonArtifactState?.status === 'generating' ||
                activePythonArtifactState?.status === 'loading' ? (
                  <div className="model-python-artifact__status" role="status">
                    <strong>
                      {activePythonArtifactState.status === 'generating'
                        ? uiText('Generating model.py…')
                        : uiText('Loading stored model.py…')}
                    </strong>
                    <span>
                      {uiText(
                        'The graph remains usable. Generated source is never imported or executed here.',
                      )}
                    </span>
                  </div>
                ) : activePythonArtifactState?.artifact ? (
                  <div className="model-python-artifact__ready">
                    <dl>
                      <div>
                        <dt>{uiText('Entrypoint')}</dt>
                        <dd>{activePythonArtifactState.artifact.receipt.entrypoint}</dd>
                      </div>
                      <div>
                        <dt>{uiText('Status')}</dt>
                        <dd>{activePythonArtifactState.artifact.receipt.implementationStatus}</dd>
                      </div>
                      <div>
                        <dt>{uiText('Dependencies')}</dt>
                        <dd>
                          {activePythonArtifactState.artifact.receipt.dependencies.join(', ') ||
                            uiText('none declared')}
                        </dd>
                      </div>
                      <div>
                        <dt>{uiText('SHA-256')}</dt>
                        <dd>
                          {activePythonArtifactState.artifact.receipt.sourceSha256.slice(0, 16)}…
                        </dd>
                      </div>
                    </dl>
                    <p>{activePythonArtifactState.artifact.summary}</p>
                    <code className="model-python-artifact__path">
                      {activePythonArtifactState.artifact.receipt.absolutePath}
                    </code>
                    <pre aria-label={uiText('Generated Python model source')}>
                      {activePythonArtifactState.artifact.source}
                    </pre>
                    <footer>
                      <strong>{uiText('Experiment handoff receipt ready')}</strong>
                      <span>
                        {uiText(
                          'The manifest records model ID, revision, entrypoint, dependencies, source hash, and implementation status. GOSU Experiments integration is the next consumer.',
                        )}
                      </span>
                    </footer>
                  </div>
                ) : activePythonArtifactState?.status === 'failed' ? (
                  <div className="model-python-artifact__status failed" role="alert">
                    <strong>{uiText('Python artifact was not generated.')}</strong>
                    <span>{activePythonArtifactState.error}</span>
                  </div>
                ) : (
                  <div className="model-python-artifact__status">
                    <strong>
                      {uiText('No Python artifact is attached to this earlier revision.')}
                    </strong>
                    <span>
                      {uiText(
                        'New imports and future revisions generate one automatically; use Generate Python to backfill this revision.',
                      )}
                    </span>
                  </div>
                )}
              </section>

              <div className="lower-grid">
                <ModelIntentPanel model={model} />
                <section className="agent-review" aria-labelledby="review-title">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">
                        {uiText('DETERMINISTIC REVIEW · RUN ')}
                        {reviewNonce} {reviewing ? uiText('· CHECKING') : ''}
                      </span>
                      <h2 id="review-title">{uiText('Five bounded consistency checks')}</h2>
                    </div>
                    <span className="review-topology">
                      {uiText('No LLM reviewers in this visual spike')}
                    </span>
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
              aria-label={uiText('Resize Model Assistant sidebar')}
              aria-orientation="vertical"
              aria-valuemin={MODEL_COPILOT_MIN_WIDTH}
              aria-valuemax={panelMaximum('copilot')}
              aria-valuenow={copilotWidth}
              aria-valuetext={uiText('{value0} pixels', { value0: copilotWidth })}
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
              <header className="model-chat__toolbar" {...copilotContentA11y}>
                <div className="model-chat__identity">
                  <span className="model-chat__orbit" aria-hidden="true">
                    {uiText('G')}
                  </span>
                  <div>
                    <strong id="chat-title">{uiText('Model Assistant')}</strong>
                    <span title={englishGraphName(model.name, model.id)}>
                      {englishGraphName(model.name, model.id)}
                    </span>
                  </div>
                </div>
                <div className="model-chat__toolbar-actions">
                  {answering ? (
                    <button
                      type="button"
                      className="model-chat__toolbar-stop"
                      onClick={stopCopilotTurn}
                    >
                      {uiText('Stop response')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="model-chat__details-toggle"
                    aria-expanded={copilotDetailsOpen}
                    aria-controls="model-copilot-runtime-details"
                    onClick={() => setCopilotDetailsOpen((current) => !current)}
                  >
                    {copilotDetailsOpen ? uiText('Minimize') : uiText('Show details')}
                  </button>
                  <button
                    ref={copilotCloseRef}
                    className="model-chat__toggle"
                    type="button"
                    aria-label={uiText('Minimize Model Assistant')}
                    aria-controls="model-copilot-panel"
                    aria-expanded={!copilotPanelCollapsed}
                    onClick={() => setCopilotPanelVisibility(true)}
                  >
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
                <div
                  className="model-chat__toolbar-badges"
                  aria-label={uiText('Current Model Assistant configuration')}
                >
                  <span title={uiText('Provider: {value0}', { value0: copilotProviderLabel })}>
                    {copilotProviderDisplayLabel}
                  </span>
                  <span title={uiText('Model: {value0}', { value0: copilotModelLabel })}>
                    {copilotModelLabel}
                  </span>
                  <span title={uiText('Reasoning: {value0}', { value0: copilotReasoningLabel })}>
                    {copilotReasoningLabel}
                  </span>
                  <span
                    className={memoryPersistenceStatus === 'failed' ? 'warning' : undefined}
                    title={
                      memoryPersistenceStatus === 'saved'
                        ? uiText(
                            'Model-lineage memory is saved locally and retrieved by relevance.',
                          )
                        : uiText(
                            'Model-lineage memory is active only in this tab because local persistence failed.',
                          )
                    }
                  >
                    {uiText('Memory ')}
                    {activeModelMemoryCount} ·{' '}
                    {memoryPersistenceStatus === 'saved' ? uiText('saved') : uiText('not saved')}
                  </span>
                  {copilotModelSelectionMissing || copilotReasoningSelectionMissing ? (
                    <span className="warning">{uiText('Selection needs attention')}</span>
                  ) : null}
                </div>
              </header>
              <div
                id="model-copilot-runtime-details"
                className="model-chat__runtime"
                hidden={!copilotDetailsOpen}
                {...copilotContentA11y}
              >
                <p className="model-chat__scope">
                  {copilotStatus === null
                    ? uiText(
                        'Connecting to the GOSU-compatible LLM bridge · per-model conversation',
                      )
                    : copilotStatus.available
                      ? uiText('{value0} · architecture edits stage a revision diff', {
                          value0: copilotStatus.provider,
                        })
                      : uiText('LLM bridge unavailable · deterministic fallback disabled')}
                </p>
                <div className="model-chat__model-controls">
                  <label>
                    {uiText('Model')}
                    <select
                      aria-label={uiText('Model Assistant model')}
                      value={copilotSelection.requestedModelId ?? ''}
                      disabled={answering || copilotCatalog === null || copilotCatalogRefreshing}
                      onChange={(event) => {
                        const requestedModelId = event.target.value || null;
                        const descriptor = requestedModelId
                          ? copilotCatalog?.models.find(
                              (candidate) => candidate.modelId === requestedModelId,
                            )
                          : undefined;
                        setCopilotSelection({
                          providerId: descriptor?.providerId ?? null,
                          requestedModelId,
                          reasoningOptionId: null,
                        });
                      }}
                    >
                      <option value="">{uiText('Auto · provider recommended')}</option>
                      {copilotModelSelectionMissing && copilotSelection.requestedModelId ? (
                        <option value={copilotSelection.requestedModelId} disabled>
                          {uiText('Unavailable model · choose again')}
                        </option>
                      ) : null}
                      {copilotProviderGroups.map(([providerId, candidates]) => (
                        <optgroup key={providerId} label={modelCopilotProviderLabel(providerId)}>
                          {candidates.map((candidate) => (
                            <option
                              key={`${candidate.providerId}:${candidate.modelId}`}
                              value={candidate.modelId}
                            >
                              {candidate.displayName}
                              {candidate.isDefault ? uiText(' · default') : ''}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <label>
                    {uiText('Reasoning')}
                    <select
                      aria-label={uiText('Model Assistant reasoning')}
                      value={copilotSelection.reasoningOptionId ?? ''}
                      disabled={answering || copilotReasoningOptions.length === 0}
                      onChange={(event) =>
                        setCopilotSelection((current) => ({
                          ...current,
                          reasoningOptionId: event.target.value || null,
                        }))
                      }
                    >
                      <option value="">{uiText('Model default')}</option>
                      {copilotReasoningSelectionMissing && copilotSelection.reasoningOptionId ? (
                        <option value={copilotSelection.reasoningOptionId} disabled>
                          {uiText('Unavailable reasoning · choose again')}
                        </option>
                      ) : null}
                      {copilotReasoningOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                          {option.isDefault ? uiText(' · default') : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="model-chat__catalog-refresh"
                    disabled={answering || copilotCatalogRefreshing}
                    onClick={() => void refreshCopilotCatalog()}
                  >
                    {copilotCatalogRefreshing ? uiText('Refreshing…') : uiText('Refresh')}
                  </button>
                </div>
              </div>
              <div className="model-chat__transcript-region" {...copilotContentA11y}>
                <div
                  ref={chatBodyRef}
                  className="chat-body"
                  role="log"
                  aria-label={uiText('Model Assistant conversation history')}
                  aria-live="polite"
                  tabIndex={0}
                  onWheel={() => chatScrollHoldRef.current?.stop()}
                  onTouchStart={() => chatScrollHoldRef.current?.stop()}
                  onPointerDown={() => chatScrollHoldRef.current?.stop()}
                  onKeyDown={() => chatScrollHoldRef.current?.stop()}
                  onScroll={(event) => {
                    const viewport = event.currentTarget;
                    const position = modelChatReadingPositionFromScroll(
                      viewport,
                      Boolean(chatScrollHoldRef.current?.active || chatReshowRef.current?.holding),
                    );
                    if (!position) return;
                    chatReadingPositionsRef.current.set(activeChatSessionKey, position);
                    const state = modelChatScrollState(viewport);
                    chatPinnedToBottomRef.current = state.nearBottom;
                    setChatCanScroll(state.canScroll);
                    setChatAtTop(state.atTop);
                    setChatNearBottom(state.nearBottom);
                  }}
                >
                  {messages.map((message, messageIndex) => (
                    <Fragment key={message.id}>
                      {chatContextStartsAt > 0 && messageIndex === chatContextStartsAt ? (
                        <p className="model-chat__context-divider">
                          <span>{modelChatContextDividerText()}</span>
                        </p>
                      ) : null}
                      <article className={`chat-message chat-message--${message.role}`}>
                        <header>
                          <strong>
                            {message.role === 'user' ? uiText('You') : uiText('GOSU')}
                          </strong>
                          <span>{formatModelChatTime(message.createdAt)}</span>
                        </header>
                        {(() => {
                          // A question asked from a module's detail says which module, and what
                          // that module is, instead of showing the whole prompt sent with it.
                          const shown = chatMessageDisplay(message);
                          const target =
                            message.role === 'user' && shown.moduleRef
                              ? findGraphModule(graphComposition.model, shown.moduleRef.moduleId)
                              : null;
                          return (
                            <>
                              {message.role === 'user' && shown.moduleRef ? (
                                <ModuleQuestionTag
                                  reference={shown.moduleRef}
                                  onOpen={
                                    target
                                      ? () => openModuleDetail(target.module, target.graphModel)
                                      : undefined
                                  }
                                />
                              ) : null}
                              <ModelChatMarkdown source={shown.body} />
                            </>
                          );
                        })()}
                        {message.role === 'assistant' &&
                          !message.id.startsWith('assistant-error') && (
                            <PaperSummarySaveOffer
                              activityWorkload="model-lab"
                              question={
                                messages
                                  .slice(0, messageIndex)
                                  .reverse()
                                  .find((m) => m.role === 'user')?.body ?? ''
                              }
                              answer={message.body}
                              allowBareYes={!message.body.includes('Edit proposal receipt')}
                              onReplyReady={
                                messageIndex === messages.length - 1
                                  ? (handler) => {
                                      paperReply.current = handler;
                                    }
                                  : undefined
                              }
                              onSave={async (candidate) => {
                                const response = await modelLabFetch('/api/paper-summaries/save', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ candidate, confirmed: true }),
                                });
                                if (!response.ok) throw new Error('paper_save_failed');
                                return (await response.json()) as PaperSummarySaveReceipt;
                              }}
                            />
                          )}
                        {message.attachmentNames && message.attachmentNames.length > 0 ? (
                          <ul
                            className="chat-message__attachments"
                            aria-label={uiText('Files sent with this message')}
                          >
                            {message.attachmentNames.map((name, index) => (
                              <li key={`${name}-${index}`}>{name}</li>
                            ))}
                          </ul>
                        ) : null}
                        <footer className="chat-message__meta">
                          <span className="chat-message__provenance">
                            {uiText('Model graph · ')}
                            {message.modelId} · {message.modelVersion}
                          </span>
                          {message.trace ? (
                            <details className="chat-message__runtime-details">
                              <summary>{uiText('Agent run details')}</summary>
                              <small>{message.trace.join(' → ')}</small>
                            </details>
                          ) : null}
                          {message.usage && !message.contextUsage ? (
                            <small className="chat-message__usage">
                              {message.usage.inputTokens.toLocaleString()}
                              {uiText(' input ·')} {message.usage.outputTokens.toLocaleString()}
                              {uiText(' output ·')}{' '}
                              {message.usage.cachedReadTokens.toLocaleString()}
                              {uiText(' cached tokens')}
                            </small>
                          ) : null}
                        </footer>
                      </article>
                      {chatContextStartsAt > 0 &&
                      chatContextStartsAt === messages.length &&
                      messageIndex === messages.length - 1 ? (
                        <p className="model-chat__context-divider">
                          <span>{modelChatContextDividerText()}</span>
                        </p>
                      ) : null}
                    </Fragment>
                  ))}
                  {answering ? (
                    <article
                      className="chat-message chat-message--assistant chat-message--thinking"
                      role="status"
                    >
                      <header>
                        <strong>{uiText('GOSU')}</strong>
                        <span>{uiText('Model Assistant turn active')}</span>
                      </header>
                      <div className="model-chat__thinking-line">
                        <i />
                        <i />
                        <i />
                        <span>{uiText('선택한 모델 구조와 증거를 검토하고 있습니다')}</span>
                      </div>
                      {copilotProgress.length > 0 ? (
                        <ol
                          className="model-chat__agent-progress"
                          aria-label={uiText('Live Model Assistant agent activity')}
                        >
                          {copilotProgress.map((progress, index) => (
                            <li
                              key={`${progress.step}:${progress.phase}:${progress.tool ?? 'reason'}:${index}`}
                            >
                              <strong>
                                {uiText('Step ')}
                                {progress.step}
                                {progress.tool ? ` · ${progress.tool.replaceAll('_', ' ')}` : ''}
                              </strong>
                              <span>
                                {progress.phase === 'editing'
                                  ? uiText('Preparing graph revision')
                                  : progress.phase === 'thinking'
                                    ? uiText('Reasoning')
                                    : progress.phase === 'tool_started'
                                      ? uiText('Running')
                                      : progress.phase === 'final'
                                        ? uiText('Finalizing')
                                        : progress.success === false
                                          ? uiText('Failed')
                                          : uiText('Receipt reviewed')}
                              </span>
                            </li>
                          ))}
                        </ol>
                      ) : null}
                    </article>
                  ) : null}
                </div>
                {chatCanScroll ? (
                  <button
                    type="button"
                    className="model-chat__scroll-jump"
                    aria-label={
                      chatNearBottom && !chatAtTop
                        ? uiText('Scroll to earlier Model Assistant messages')
                        : uiText('Jump to the latest Model Assistant message')
                    }
                    onClick={() => {
                      const viewport = chatBodyRef.current;
                      if (!viewport) return;
                      if (chatNearBottom && !chatAtTop) {
                        viewport.scrollTo({
                          top: Math.max(0, viewport.scrollTop - viewport.clientHeight * 0.82),
                          behavior: 'smooth',
                        });
                        chatPinnedToBottomRef.current = false;
                      } else {
                        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
                        chatPinnedToBottomRef.current = true;
                      }
                    }}
                  >
                    <span aria-hidden="true">{chatNearBottom && !chatAtTop ? '↑' : '↓'}</span>
                    {chatNearBottom && !chatAtTop ? uiText('Earlier') : uiText('Latest')}
                  </button>
                ) : null}
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
                <div className="model-chat__reference">
                  <span className="model-reference-tag">
                    {englishGraphName(model.name, model.id)} · r{modelRevision}
                  </span>
                </div>
                <p className="model-chat__context-note">
                  <span>{uiText('LOCAL MODEL CONTEXT')}</span>
                  {selectedModule.name} · {uiText(scenarioKind)} · {copilotProviderDisplayLabel}
                </p>
                {copilotAttachments.length > 0 ? (
                  <ul
                    className="model-chat__attachment-queue"
                    aria-label={uiText('Files attached to the next Model Assistant message')}
                  >
                    {copilotAttachments.map((attachment) => (
                      <li key={attachment.id}>
                        <span>
                          <strong>{attachment.artifact.name}</strong>
                          <small>
                            {attachment.artifact.kind} ·{' '}
                            {Math.max(1, Math.round(attachment.size / 1024))}
                            {uiText(' KB')}
                          </small>
                        </span>
                        <button
                          type="button"
                          aria-label={uiText('Remove {value0} from Model Assistant message', {
                            value0: attachment.artifact.name,
                          })}
                          onClick={() =>
                            setCopilotAttachments(
                              copilotAttachments.filter(
                                (candidate) => candidate.id !== attachment.id,
                              ),
                            )
                          }
                        >
                          {uiText('Remove')}
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
                {activeChatCommand ? (
                  <p
                    className={`model-chat__command-status model-chat__command-status--${activeChatCommand.phase}`}
                    role="status"
                    aria-label={uiText('Context command')}
                  >
                    <strong>{activeChatCommand.command}</strong>
                    <span>{activeChatCommand.message}</span>
                  </p>
                ) : null}
                <ContextUsageMeter usage={displayedContextUsage} busy={answering} />
                <ModelChatComposer
                  key={activeChatSessionKey}
                  initialDraft={
                    chatDraftsRef.current[activeChatSessionKey] ?? activeChatSession.draft
                  }
                  busy={answering}
                  hasAttachments={copilotAttachments.length > 0}
                  onDraftChange={setQuestion}
                  onSubmit={(draft) => {
                    void submitQuestion(draft);
                  }}
                  onStop={stopCopilotTurn}
                  inputRef={copilotComposerRef}
                  files={
                    <ModelCopilotAttachmentInput
                      onFiles={addCopilotFiles}
                      disabled={
                        answering || copilotAttachments.length >= MODEL_COPILOT_MAX_ATTACHMENTS
                      }
                    />
                  }
                />
              </div>
              <button
                ref={copilotRestoreRef}
                className="model-chat__restore"
                type="button"
                aria-label={uiText('Restore Model Assistant')}
                aria-controls="model-copilot-panel"
                aria-expanded={!copilotPanelCollapsed}
                {...copilotRestoreA11y}
                onClick={() => setCopilotPanelVisibility(false)}
              >
                <span aria-hidden="true">←</span>
                <strong>{uiText('Model Assistant')}</strong>
              </button>
            </aside>
          </div>
        </div>
      )}
      {activeModuleDetail && !workspaceEmpty ? (
        <ModuleDetailDialog
          model={activeModuleDetail.graphModel}
          module={activeModuleDetail.module}
          probe={probe}
          checkpointIndex={checkpointIndex}
          onClose={closeModuleDetail}
          onNavigate={(next) => {
            const card = Array.from(
              document.querySelectorAll<HTMLElement>('[data-model-node-id]'),
            ).find((candidate) => candidate.dataset.modelNodeId === next.id);
            if (card) moduleDetailTriggerRef.current = card;
            setModuleDetail({
              module: next,
              graphModel: activeModuleDetail.graphModel,
              scopeKey: activeChatSessionKey,
            });
          }}
          parentBlock={loopParentModule(model, activeModuleDetail.graphModel)}
          aiExplanation={{
            conversation: messages,
            entry: moduleExplanation(moduleExplanations, model.id, activeModuleDetail.module),
            busy:
              moduleExplanationRun?.modelId === model.id &&
              moduleExplanationRun.key === moduleExplanationKey(activeModuleDetail.module) &&
              moduleExplanationRun.busy,
            error:
              moduleExplanationRun?.modelId === model.id &&
              moduleExplanationRun.key === moduleExplanationKey(activeModuleDetail.module)
                ? moduleExplanationRun.error
                : null,
            onRequest: () =>
              void askAboutModule(activeModuleDetail.module, activeModuleDetail.graphModel),
            onAsk: (followUp) =>
              askAboutModule(activeModuleDetail.module, activeModuleDetail.graphModel, followUp),
          }}
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
      {copyTarget && (
        <ProjectModelCopyDialog
          {...copyTarget}
          storage={storage}
          onClose={() => setCopyTarget(null)}
          onCopied={setCopyNotice}
        />
      )}
    </main>
  );
}
