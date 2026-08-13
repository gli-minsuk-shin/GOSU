import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import type { ExperimentMetricPoint } from '../../shared/experiment-workspace-contracts';
import type { LiteratureRecord } from '../../shared/literature-contracts';
import {
  LECTURE_STUDIO_MAX_EXPERIMENT_SOURCES,
  LECTURE_STUDIO_MAX_LITERATURE_SOURCES,
  LECTURE_STUDIO_MAX_MANUSCRIPT_SOURCES,
  LECTURE_STUDIO_MAX_GENERATION_INSTRUCTIONS,
  LECTURE_STUDIO_MAX_SOURCE_PROJECTS,
  LECTURE_STUDIO_DURATIONS,
  type CancelLectureStudioInput,
  type CompileLectureStudioPdfInput,
  type CreateLectureStudioInput,
  type ExportLectureStudioArtifactInput,
  type GenerateLectureStudioInput,
  type LectureSourceCandidates,
  type LectureSourceSelection,
  type LectureStudio,
  type LectureStudioArtifactActionReceipt,
  type LectureStudioDetail,
  type LectureStudioDetailLevel,
  type LectureStudioDetailInput,
  type LectureStudioDuration,
  type LectureStudioEvent,
  type LectureStudioKind,
  type LectureStudioMessage,
  type LectureStudioRevision,
  type LectureStudioListSnapshot,
  type LectureStudioPdfPreview,
  type LectureStudioSummary,
  type LectureStudioTurnReceipt,
  type ListLectureCandidatesInput,
  type ListLectureStudiosInput,
  type OpenLectureStudioArtifactInput,
  type RevealLectureStudioArtifactInput,
  type SendLectureStudioMessageInput,
} from '../../shared/lecture-studio-contracts';
import type { ProjectRecord } from '../../shared/workspace-contracts';
import type { CodexModel } from './connections-view';
import type { LectureStudioLayoutState } from './lecture-studio-layout-state';
import {
  AUTO_LECTURE_STUDIO_MODEL_SELECTION,
  loadLectureStudioModelSelection,
  resolveLectureStudioModelSelection,
  saveLectureStudioModelSelection,
  selectLectureStudioModel,
  selectLectureStudioReasoning,
  type LectureStudioModelSelection,
} from './lecture-studio-model-selection-store';
import type { LectureStudioDraftStore } from './lecture-studio-session-state';
import { MarkdownDocument } from './markdown-document';
import { PdfPreview } from './pdf-preview';
import { CollapseChevron } from './ui-primitives';
import './lecture-studio-view.css';
import './pdf-preview.css';

export interface LectureStudioViewAdapter {
  list: (input: ListLectureStudiosInput) => Promise<LectureStudioListSnapshot>;
  detail: (input: LectureStudioDetailInput) => Promise<LectureStudioDetail>;
  candidates: (input: ListLectureCandidatesInput) => Promise<LectureSourceCandidates>;
  create: (input: CreateLectureStudioInput) => Promise<LectureStudio>;
  generate: (input: GenerateLectureStudioInput) => Promise<LectureStudioTurnReceipt>;
  send: (input: SendLectureStudioMessageInput) => Promise<LectureStudioTurnReceipt>;
  cancel: (input: CancelLectureStudioInput) => Promise<LectureStudio>;
  compilePdf: (input: CompileLectureStudioPdfInput) => Promise<LectureStudioPdfPreview>;
  exportArtifact: (
    input: ExportLectureStudioArtifactInput,
  ) => Promise<LectureStudioArtifactActionReceipt>;
  openArtifact: (
    input: OpenLectureStudioArtifactInput,
  ) => Promise<LectureStudioArtifactActionReceipt>;
  revealArtifact: (
    input: RevealLectureStudioArtifactInput,
  ) => Promise<LectureStudioArtifactActionReceipt>;
  onEvent: (listener: (event: LectureStudioEvent) => void) => () => void;
}

export interface LectureStudioViewProps {
  projects: readonly ProjectRecord[];
  adapter: LectureStudioViewAdapter;
  draftStore: LectureStudioDraftStore;
  models: readonly CodexModel[];
  modelsLoading: boolean;
  onRefreshModels: () => void;
  layout: LectureStudioLayoutState;
  onLayoutChange: (layout: LectureStudioLayoutState) => void;
}

type PreviewTab = 'notes' | 'notes-pdf' | 'slides' | 'slides-pdf';

function previewDocumentKind(tab: PreviewTab) {
  return tab.startsWith('notes') ? ('lecture-notes' as const) : ('slides' as const);
}

function previewIsPdf(tab: PreviewTab) {
  return tab.endsWith('-pdf');
}

export function lectureArtifactActionLabels(tab: PreviewTab) {
  const format = previewIsPdf(tab) ? 'PDF' : 'Markdown';
  return {
    export: `Export ${format}`,
    open: `Open ${format} in default app`,
    reveal: 'Show saved folder',
  } as const;
}

function LectureArtifactActionIcon({ kind }: { kind: 'export' | 'open' | 'reveal' }) {
  const path =
    kind === 'export'
      ? 'M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4'
      : kind === 'open'
        ? 'M14 4h6v6m0-6-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5'
        : 'M3.5 7.5V6.75A1.75 1.75 0 0 1 5.25 5h3.5l2 2h8A1.75 1.75 0 0 1 20.5 8.75v8.5A1.75 1.75 0 0 1 18.75 19H5.25a1.75 1.75 0 0 1-1.75-1.75V7.5Z';
  return (
    <svg
      className="lecture-artifact-action-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

function revisionMarkdown(revision: LectureStudioRevision, kind: 'lecture-notes' | 'slides') {
  return kind === 'lecture-notes' ? revision.lectureNotesMarkdown : revision.slidesMarkdown;
}

async function sha256Text(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const LECTURE_STUDIO_UI_MAX_SOURCES = Math.max(
  LECTURE_STUDIO_MAX_LITERATURE_SOURCES,
  LECTURE_STUDIO_MAX_EXPERIMENT_SOURCES,
  LECTURE_STUDIO_MAX_MANUSCRIPT_SOURCES,
);
const LECTURE_STUDIO_RECENT_MESSAGE_WINDOW = 50;

type LectureWireCandidateProject = LectureSourceCandidates['projects'][number];

interface LoadedLectureCandidatePage {
  nextOffset: number;
  total: number;
  hasMore: boolean;
}

interface LoadedLectureCandidateProject extends Omit<
  LectureWireCandidateProject,
  'literaturePage' | 'experimentPage'
> {
  literaturePage: LoadedLectureCandidatePage;
  experimentPage: LoadedLectureCandidatePage;
}

export interface LoadedLectureCandidates {
  projects: LoadedLectureCandidateProject[];
}

const EMPTY_SOURCE_SELECTION: LectureSourceSelection = {
  literature: [],
  experiments: [],
  manuscripts: [],
};

function sourceKey(projectId: string, sourceId: string) {
  return `${projectId}:${sourceId}`;
}

function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatAuthors(record: LiteratureRecord) {
  const authors = record.authors;
  if (authors.length === 0) return 'Authors unavailable';
  const names = authors.slice(0, 3);
  return `${names.join(', ')}${authors.length > 3 ? ` +${authors.length - 3}` : ''}`;
}

function metricSummary(points: readonly ExperimentMetricPoint[], ideaId: string) {
  const matching = points.filter((point) => point.ideaId === ideaId);
  const latest = matching.at(-1);
  if (!latest) return 'No metric evidence yet';
  return `${latest.metricDisplayName}: ${latest.value}${latest.unit ? ` ${latest.unit}` : ''}`;
}

export function lectureManuscriptAvailabilityLabel(
  availability: LectureSourceCandidates['projects'][number]['manuscripts'][number]['availability'],
) {
  const labels = {
    ready: 'Captured checkpoint ready',
    capture_required: 'Capture a checkpoint in Manuscript first',
    unconnected: 'Connect this manuscript before using it',
  } as const;
  return labels[availability];
}

function lectureErrorCodeMessage(code: string) {
  const messages: Record<string, string> = {
    invalid_lecture_input: 'Review the selected projects, sources, and presentation settings.',
    lecture_studio_not_found:
      'This lecture workspace no longer exists. Refresh and choose another.',
    lecture_busy: 'This lecture workspace is already generating a revision.',
    lecture_source_conflict:
      'A selected source changed after review. Refresh the source list before generating.',
    lecture_context_too_large:
      'The selected evidence or current documents are too large to send without hiding content. Select fewer sources or split the lecture into smaller Studios.',
    lecture_capacity_reached:
      'This Lecture Studio reached its local history limit. Keep the existing files and start a new Studio.',
    lecture_research_notes_required:
      'Connect Research Notes for the output project before generating Markdown files.',
    lecture_unavailable:
      'Lecture notes and slides are temporarily unavailable. Existing files were not replaced.',
    lecture_codex_unavailable: 'Codex is unavailable. Existing lecture files remain available.',
    lecture_version_conflict: 'This lecture changed in another action. Refresh and try again.',
    lecture_source_not_found: 'A selected manuscript, paper, or experiment is no longer available.',
    lecture_invalid_response:
      'The generated draft failed source or Markdown safety checks, so no files were changed.',
    lecture_persistence_failed:
      'GOSU could not safely commit this revision. Any pending file bundle was rolled back.',
    lecture_cancelled: 'Generation was stopped. The previous revision remains unchanged.',
    lecture_not_active: 'This lecture is no longer generating.',
    lecture_pdf_compiler_unavailable:
      'Local PDF preview needs MacTeX. Install MacTeX, then try compiling this revision again.',
    lecture_pdf_compile_failed:
      'The local LaTeX compiler could not build this revision. The saved Markdown is unchanged.',
    lecture_pdf_too_large:
      'The compiled PDF exceeded the local preview limit. The saved Markdown is unchanged.',
    lecture_pdf_invalid:
      'This revision could not be converted into a safe local PDF preview. The saved Markdown is unchanged.',
    lecture_artifact_not_found:
      'This saved lecture file no longer matches the selected revision. Refresh and try again.',
    lecture_artifact_changed:
      'The saved Markdown changed outside GOSU, so it was not exported or opened as this revision.',
    lecture_artifact_unavailable:
      'The Research Notes output folder is unavailable. Reconnect it before opening saved files.',
    lecture_export_failed: 'GOSU could not safely export this lecture file.',
    lecture_open_failed: 'The file could not be opened in the system default app.',
  };
  return messages[code] ?? 'The lecture operation could not be completed.';
}

function lectureErrorMessage(error: unknown) {
  const code = error instanceof Error ? (error.message.split(':')[0] ?? '') : '';
  return lectureErrorCodeMessage(code);
}

export function mergeLectureCandidatePages(
  current: LoadedLectureCandidates | null,
  incoming: LectureSourceCandidates,
): LoadedLectureCandidates {
  const loadPage = (page: LectureWireCandidateProject['literaturePage']) => ({
    nextOffset: Math.min(page.total, page.offset + page.limit),
    total: page.total,
    hasMore: page.hasMore,
  });
  const loadProject = (project: LectureWireCandidateProject): LoadedLectureCandidateProject => ({
    ...project,
    literaturePage: loadPage(project.literaturePage),
    experimentPage: loadPage(project.experimentPage),
  });
  if (!current) return { projects: incoming.projects.map(loadProject) };
  const incomingByProject = new Map(
    incoming.projects.map((project) => [project.projectId, project]),
  );
  const mergeUnique = <T,>(
    left: readonly T[],
    right: readonly T[],
    identity: (value: T) => string,
  ) => {
    const merged = new Map(left.map((value) => [identity(value), value]));
    for (const value of right) merged.set(identity(value), value);
    return [...merged.values()];
  };
  const projects = current.projects.map((project) => {
    const next = incomingByProject.get(project.projectId);
    if (!next) return project;
    incomingByProject.delete(project.projectId);
    const literatureRecords = mergeUnique(
      project.literatureRecords,
      next.literatureRecords,
      (record) => record.id,
    );
    const experiments = mergeUnique(
      project.experiments,
      next.experiments,
      (experiment) => experiment.idea.id,
    );
    const manuscripts = mergeUnique(
      project.manuscripts,
      next.manuscripts,
      (candidate) => candidate.manuscript.id,
    );
    return {
      ...next,
      literatureRecords,
      experiments,
      manuscripts,
      literaturePage: {
        nextOffset: Math.max(
          project.literaturePage.nextOffset,
          Math.min(
            next.literaturePage.total,
            next.literaturePage.offset + next.literaturePage.limit,
          ),
        ),
        total: next.literaturePage.total,
        hasMore: next.literaturePage.hasMore,
      },
      experimentPage: {
        nextOffset: Math.max(
          project.experimentPage.nextOffset,
          Math.min(
            next.experimentPage.total,
            next.experimentPage.offset + next.experimentPage.limit,
          ),
        ),
        total: next.experimentPage.total,
        hasMore: next.experimentPage.hasMore,
      },
    };
  });
  projects.push(...[...incomingByProject.values()].map(loadProject));
  return { projects };
}

export function toggleLectureProjectSelection(current: readonly string[], projectId: string) {
  if (current.includes(projectId)) {
    return { projectIds: current.filter((candidate) => candidate !== projectId), error: null };
  }
  if (current.length >= LECTURE_STUDIO_MAX_SOURCE_PROJECTS) {
    return {
      projectIds: [...current],
      error: `A lecture can combine at most ${LECTURE_STUDIO_MAX_SOURCE_PROJECTS} projects.`,
    };
  }
  return { projectIds: [...current, projectId], error: null };
}

export function toggleLectureSourceSelection(
  current: ReadonlySet<string>,
  key: string,
  otherSourceCount: number,
) {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
    return { sourceIds: next, error: null };
  }
  if (next.size + otherSourceCount >= LECTURE_STUDIO_UI_MAX_SOURCES) {
    return {
      sourceIds: next,
      error: `A lecture can use at most ${LECTURE_STUDIO_UI_MAX_SOURCES} sources in total.`,
    };
  }
  next.add(key);
  return { sourceIds: next, error: null };
}

export function lastLectureMessageId(messages: readonly LectureStudioMessage[]) {
  return messages.at(-1)?.id ?? null;
}

export function currentLectureStudioRevision(
  detail: LectureStudioDetail | null,
  studio: LectureStudio | null,
) {
  if (!detail || !studio || studio.currentRevision === 0) return null;
  return (
    detail.revisions.find(
      (revision) => revision.studioId === studio.id && revision.revision === studio.currentRevision,
    ) ?? null
  );
}

export function lectureStudioMessages(detail: LectureStudioDetail | null, studioId: string | null) {
  if (!detail || !studioId || detail.studio.id !== studioId) return [];
  return detail.messages;
}

export function lectureStudioStatusLabel(status: LectureStudioSummary['status']) {
  const labels: Record<LectureStudioSummary['status'], string> = {
    draft: 'Draft',
    generating: 'Generating',
    ready: 'Ready',
    failed: 'Failed',
  };
  return labels[status];
}

export function lectureOutputProjectName(
  projects: readonly ProjectRecord[],
  outputProjectId: string,
) {
  return projects.find(({ id }) => id === outputProjectId)?.name ?? outputProjectId;
}

export function activeLectureSourceProjects(projects: readonly ProjectRecord[]) {
  return projects.filter((project) => !project.archivedAt && !project.trashedAt);
}

export function LectureStudioView({
  projects,
  adapter,
  draftStore,
  models,
  modelsLoading,
  onRefreshModels,
  layout,
  onLayoutChange,
}: LectureStudioViewProps) {
  const activeProjects = useMemo(() => activeLectureSourceProjects(projects), [projects]);
  const [listSnapshot, setListSnapshot] = useState<LectureStudioListSnapshot | null>(null);
  const [detail, setDetail] = useState<LectureStudioDetail | null>(null);
  const [selectedStudioId, setSelectedStudioId] = useState<string | null>(null);
  const selectedStudioIdRef = useRef<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyStudioIds, setBusyStudioIds] = useState<Set<string>>(new Set());
  const [draftsByStudioId, setDraftsByStudioId] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [previewTab, setPreviewTab] = useState<PreviewTab>('notes');
  const [modelSelection, setModelSelection] = useState<LectureStudioModelSelection>(
    AUTO_LECTURE_STUDIO_MODEL_SELECTION,
  );
  const loadGeneration = useRef(0);

  const load = useCallback(
    async (showLoading = false, preferredStudioId?: string | null) => {
      const generation = ++loadGeneration.current;
      if (showLoading) setLoading(true);
      try {
        const next = await adapter.list({});
        if (generation !== loadGeneration.current) return;
        setListSnapshot(next);
        const requestedStudioId = preferredStudioId ?? selectedStudioIdRef.current;
        const nextStudioId =
          requestedStudioId && next.studios.some((studio) => studio.id === requestedStudioId)
            ? requestedStudioId
            : (next.studios[0]?.id ?? null);
        const nextDetail = nextStudioId ? await adapter.detail({ studioId: nextStudioId }) : null;
        if (generation !== loadGeneration.current) return;
        selectedStudioIdRef.current = nextStudioId;
        setSelectedStudioId(nextStudioId);
        setDetail(nextDetail);
        setError(null);
      } catch (loadError) {
        if (generation === loadGeneration.current) setError(lectureErrorMessage(loadError));
      } finally {
        if (generation === loadGeneration.current) setLoading(false);
      }
    },
    [adapter],
  );

  useEffect(() => {
    void load(true);
    // The initial load must not restart merely because selecting a studio updates this callback.
  }, [adapter]);

  useEffect(
    () =>
      adapter.onEvent(() => {
        void load();
      }),
    [adapter, load],
  );

  const selectedStudio = detail && detail.studio.id === selectedStudioId ? detail.studio : null;
  const selectedRevision = useMemo(
    () => currentLectureStudioRevision(detail, selectedStudio),
    [detail, selectedStudio],
  );
  const selectedMessages = useMemo(
    () => lectureStudioMessages(detail, selectedStudioId),
    [detail, selectedStudioId],
  );

  useEffect(() => {
    setModelSelection(
      selectedStudioId
        ? loadLectureStudioModelSelection(window.localStorage, selectedStudioId)
        : AUTO_LECTURE_STUDIO_MODEL_SELECTION,
    );
  }, [selectedStudioId]);

  const selectedModelDescriptor = modelSelection.modelId
    ? models.find((model) => model.modelId === modelSelection.modelId)
    : models.find((model) => model.isDefault);
  const modelSelectionUnavailable =
    resolveLectureStudioModelSelection(modelSelection, models).issue !== null;

  const selectStudio = (studioId: string) => {
    selectedStudioIdRef.current = studioId;
    setSelectedStudioId(studioId);
    setModelSelection(loadLectureStudioModelSelection(window.localStorage, studioId));
    setDetail(null);
    setComposing(false);
    setPreviewTab('notes');
    void load(true, studioId);
  };

  const markStudioBusy = useCallback((studioId: string, isBusy: boolean) => {
    setBusyStudioIds((current) => {
      const next = new Set(current);
      if (isBusy) next.add(studioId);
      else next.delete(studioId);
      return next;
    });
  }, []);

  const runGeneration = async (
    studio: LectureStudio,
    selection: LectureStudioModelSelection = modelSelection,
  ) => {
    markStudioBusy(studio.id, true);
    setNotice('');
    setError(null);
    try {
      await adapter.generate({
        studioId: studio.id,
        expectedVersion: studio.version,
        requestedModelId: selection.modelId,
        reasoningOptionId: selection.reasoningOptionId,
      });
      if (selectedStudioIdRef.current === studio.id) {
        setNotice('Lecture notes and slides were saved as a new Research Notes revision.');
      }
      await load(false);
    } catch (generationError) {
      await load(false);
      if (selectedStudioIdRef.current === studio.id) {
        setError(lectureErrorMessage(generationError));
      }
    } finally {
      markStudioBusy(studio.id, false);
    }
  };

  return (
    <section className="lecture-studio" aria-label="Lecture notes and slides workspace">
      {error && (
        <div className="error-banner lecture-studio-banner" role="alert">
          {error}
          <button type="button" className="ghost-button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="success-banner lecture-studio-banner" role="status">
          {notice}
          <button type="button" className="ghost-button" onClick={() => setNotice('')}>
            Dismiss
          </button>
        </div>
      )}

      <div
        className={`lecture-studio-layout${layout.studioRailCollapsed ? ' studio-rail-collapsed' : ''}${layout.chatCollapsed ? ' chat-collapsed' : ''}`}
      >
        <StudioRail
          studios={listSnapshot?.studios ?? []}
          selectedStudioId={selectedStudioId}
          loading={loading}
          composing={composing}
          onNew={() => {
            setComposing(true);
            onLayoutChange({ ...layout, chatCollapsed: false });
            setNotice('');
            setError(null);
          }}
          onSelect={selectStudio}
          collapsed={layout.studioRailCollapsed}
          onCollapsedChange={(studioRailCollapsed) =>
            onLayoutChange({ ...layout, studioRailCollapsed })
          }
        />

        {composing || (!loading && !selectedStudio && (listSnapshot?.studios.length ?? 0) === 0) ? (
          <LectureComposer
            projects={activeProjects}
            adapter={adapter}
            busy={busyStudioIds.size > 0}
            models={models}
            modelsLoading={modelsLoading}
            onRefreshModels={onRefreshModels}
            onCancel={listSnapshot?.studios.length ? () => setComposing(false) : undefined}
            onCreated={async (studio, initialSelection) => {
              setModelSelection(initialSelection);
              saveLectureStudioModelSelection(window.localStorage, studio.id, initialSelection);
              selectedStudioIdRef.current = studio.id;
              setSelectedStudioId(studio.id);
              setComposing(false);
              await load(false, studio.id);
              await runGeneration(studio, initialSelection);
            }}
            onError={(nextError) => setError(lectureErrorMessage(nextError))}
          />
        ) : loading ? (
          <div className="lecture-studio-loading" role="status">
            Loading lecture workspace…
          </div>
        ) : selectedStudio ? (
          <>
            <StudioPreview
              key={selectedStudio.id}
              studio={selectedStudio}
              revision={selectedRevision}
              projects={projects}
              adapter={adapter}
              activeTab={previewTab}
              busy={busyStudioIds.has(selectedStudio.id)}
              onTab={setPreviewTab}
              onGenerate={() => void runGeneration(selectedStudio)}
              onCancel={() => {
                if (!selectedStudio.activeAttemptId) return;
                void adapter
                  .cancel({
                    studioId: selectedStudio.id,
                    attemptId: selectedStudio.activeAttemptId,
                    expectedVersion: selectedStudio.version,
                  })
                  .catch((cancelError) => setError(lectureErrorMessage(cancelError)));
              }}
            />
            <LectureStudioChat
              studio={selectedStudio}
              messages={selectedMessages}
              busy={busyStudioIds.has(selectedStudio.id) || selectedStudio.status === 'generating'}
              collapsed={layout.chatCollapsed}
              onCollapsedChange={(chatCollapsed) => onLayoutChange({ ...layout, chatCollapsed })}
              models={models}
              modelsLoading={modelsLoading}
              selectedModel={modelSelection.modelId}
              selectedReasoning={modelSelection.reasoningOptionId}
              selectedModelDescriptor={selectedModelDescriptor}
              selectionUnavailable={modelSelectionUnavailable}
              onSelectedModel={(modelId) => {
                const next = selectLectureStudioModel(modelSelection, modelId);
                setModelSelection(next);
                saveLectureStudioModelSelection(window.localStorage, selectedStudio.id, next);
              }}
              onSelectedReasoning={(reasoningOptionId) => {
                const next = selectLectureStudioReasoning(modelSelection, reasoningOptionId);
                setModelSelection(next);
                saveLectureStudioModelSelection(window.localStorage, selectedStudio.id, next);
              }}
              onRefreshModels={onRefreshModels}
              draft={draftsByStudioId[selectedStudio.id] ?? draftStore.read(selectedStudio.id)}
              onDraftChange={(draft) => {
                draftStore.write(selectedStudio.id, draft);
                setDraftsByStudioId((current) => ({ ...current, [selectedStudio.id]: draft }));
              }}
              onSend={async (message) => {
                markStudioBusy(selectedStudio.id, true);
                setError(null);
                setNotice('');
                try {
                  await adapter.send({
                    studioId: selectedStudio.id,
                    expectedVersion: selectedStudio.version,
                    message,
                    requestedModelId: modelSelection.modelId,
                    reasoningOptionId: modelSelection.reasoningOptionId,
                  });
                  if (selectedStudioIdRef.current === selectedStudio.id) {
                    setNotice('The requested edit was saved as a new Research Notes revision.');
                  }
                  await load(false);
                  return true;
                } catch (sendError) {
                  await load(false);
                  if (selectedStudioIdRef.current === selectedStudio.id) {
                    setError(lectureErrorMessage(sendError));
                  }
                  return false;
                } finally {
                  markStudioBusy(selectedStudio.id, false);
                }
              }}
              onCancel={() => {
                if (!selectedStudio.activeAttemptId) return;
                void adapter
                  .cancel({
                    studioId: selectedStudio.id,
                    attemptId: selectedStudio.activeAttemptId,
                    expectedVersion: selectedStudio.version,
                  })
                  .catch((cancelError) => setError(lectureErrorMessage(cancelError)));
              }}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}

function StudioRail({
  studios,
  selectedStudioId,
  loading,
  composing,
  onNew,
  onSelect,
  collapsed,
  onCollapsedChange,
}: {
  studios: readonly LectureStudioSummary[];
  selectedStudioId: string | null;
  loading: boolean;
  composing: boolean;
  onNew: () => void;
  onSelect: (studioId: string) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  if (collapsed) {
    return (
      <aside className="lecture-studio-rail collapsed" aria-label="Lecture sessions collapsed">
        <button
          type="button"
          className="lecture-pane-toggle"
          aria-label="Show lecture sessions"
          title="Show lecture sessions"
          aria-expanded="false"
          aria-controls="lecture-studio-sessions"
          onClick={() => onCollapsedChange(false)}
        >
          <CollapseChevron direction="right" />
        </button>
        <button
          type="button"
          className="lecture-rail-new-button"
          aria-label="New lecture"
          title="New lecture"
          onClick={onNew}
        >
          ＋
        </button>
        <strong>{studios.length}</strong>
      </aside>
    );
  }
  return (
    <aside className="lecture-studio-rail" id="lecture-studio-sessions">
      <header>
        <div>
          <span>STUDIOS</span>
          <strong>{studios.length}</strong>
        </div>
        <button type="button" className="ghost-button" onClick={onNew}>
          ＋ New
        </button>
        <button
          type="button"
          className="lecture-pane-toggle"
          aria-label="Hide lecture sessions"
          title="Hide lecture sessions"
          aria-expanded="true"
          aria-controls="lecture-studio-sessions"
          onClick={() => onCollapsedChange(true)}
        >
          <CollapseChevron direction="left" />
        </button>
      </header>
      <div className="lecture-studio-list">
        {loading && studios.length === 0 ? (
          <p>Loading…</p>
        ) : studios.length === 0 ? (
          <div className="lecture-studio-rail-empty">
            <strong>No lecture yet</strong>
            <span>Select research from one or more projects to begin.</span>
          </div>
        ) : (
          studios.map((studio) => (
            <button
              type="button"
              key={studio.id}
              className={studio.id === selectedStudioId && !composing ? 'active' : ''}
              aria-current={studio.id === selectedStudioId && !composing ? 'page' : undefined}
              onClick={() => onSelect(studio.id)}
            >
              <span className={`lecture-studio-status ${studio.status}`} aria-hidden="true" />
              <span className="sr-only">Status: {lectureStudioStatusLabel(studio.status)}. </span>
              <strong>{studio.title}</strong>
              <small>
                {studio.kind === 'talk' ? `${studio.durationMinutes}-minute talk` : 'Lecture'} · r
                {studio.currentRevision}
              </small>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

function LectureComposer({
  projects,
  adapter,
  busy,
  models,
  modelsLoading,
  onRefreshModels,
  onCancel,
  onCreated,
  onError,
}: {
  projects: readonly ProjectRecord[];
  adapter: LectureStudioViewAdapter;
  busy: boolean;
  models: readonly CodexModel[];
  modelsLoading: boolean;
  onRefreshModels: () => void;
  onCancel?: (() => void) | undefined;
  onCreated: (studio: LectureStudio, selection: LectureStudioModelSelection) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<LectureStudioKind>('lecture');
  const [durationMinutes, setDurationMinutes] = useState<LectureStudioDuration>(20);
  const [notesTargetPages, setNotesTargetPages] = useState('');
  const [slidesTargetPages, setSlidesTargetPages] = useState('');
  const [detailLevel, setDetailLevel] = useState<LectureStudioDetailLevel>('standard');
  const [customInstructions, setCustomInstructions] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>(() =>
    projects[0] ? [projects[0].id] : [],
  );
  const [outputProjectId, setOutputProjectId] = useState(projects[0]?.id ?? '');
  const [selectedLiterature, setSelectedLiterature] = useState<Set<string>>(new Set());
  const [selectedExperiments, setSelectedExperiments] = useState<Set<string>>(new Set());
  const [selectedManuscripts, setSelectedManuscripts] = useState<Set<string>>(new Set());
  const [candidates, setCandidates] = useState<LoadedLectureCandidates | null>(null);
  const [loadingSources, setLoadingSources] = useState(false);
  const [loadingMoreProjects, setLoadingMoreProjects] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [initialModelSelection, setInitialModelSelection] = useState<LectureStudioModelSelection>(
    AUTO_LECTURE_STUDIO_MODEL_SELECTION,
  );
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const candidateKey = projectIds.slice().sort().join(':');
  useEffect(() => {
    if (projectIds.length === 0) {
      setCandidates({ projects: [] });
      return;
    }
    let active = true;
    setCandidates(null);
    setLoadingSources(true);
    void adapter
      .candidates({ projectIds, metricPointLimit: 1 })
      .then((next) => {
        if (active) setCandidates(mergeLectureCandidatePages(null, next));
      })
      .catch((loadError) => {
        if (active) onError(loadError);
      })
      .finally(() => {
        if (active) setLoadingSources(false);
      });
    return () => {
      active = false;
    };
    // project IDs are represented by a stable scalar to avoid repeated loads from array identity.
  }, [adapter, candidateKey]);

  useEffect(() => {
    if (projectIds.includes(outputProjectId)) return;
    setOutputProjectId(projectIds[0] ?? '');
  }, [outputProjectId, projectIds]);

  const toggleProject = (projectId: string) => {
    const wasSelected = projectIds.includes(projectId);
    const toggled = toggleLectureProjectSelection(projectIds, projectId);
    setSelectionError(toggled.error);
    setProjectIds(toggled.projectIds);
    if (wasSelected && !toggled.error) {
      setSelectedLiterature(
        (selected) => new Set([...selected].filter((key) => !key.startsWith(`${projectId}:`))),
      );
      setSelectedExperiments(
        (selected) => new Set([...selected].filter((key) => !key.startsWith(`${projectId}:`))),
      );
      setSelectedManuscripts(
        (selected) => new Set([...selected].filter((key) => !key.startsWith(`${projectId}:`))),
      );
    }
  };

  const toggleSource = (kind: 'literature' | 'experiment' | 'manuscript', key: string) => {
    const current =
      kind === 'literature'
        ? selectedLiterature
        : kind === 'experiment'
          ? selectedExperiments
          : selectedManuscripts;
    const otherCount =
      selectedLiterature.size + selectedExperiments.size + selectedManuscripts.size - current.size;
    const toggled = toggleLectureSourceSelection(current, key, otherCount);
    setSelectionError(toggled.error);
    if (kind === 'literature') setSelectedLiterature(toggled.sourceIds);
    else if (kind === 'experiment') setSelectedExperiments(toggled.sourceIds);
    else setSelectedManuscripts(toggled.sourceIds);
  };

  const loadMoreSources = async (projectId: string) => {
    const project = candidates?.projects.find((candidate) => candidate.projectId === projectId);
    if (!project || loadingMoreProjects.has(projectId)) return;
    setLoadingMoreProjects((current) => new Set(current).add(projectId));
    try {
      const next = await adapter.candidates({
        projectIds: [projectId],
        literatureOffset: project.literaturePage.nextOffset,
        literatureLimit: 100,
        experimentOffset: project.experimentPage.nextOffset,
        experimentLimit: 100,
        metricPointLimit: 1,
      });
      setCandidates((current) =>
        current?.projects.some((candidate) => candidate.projectId === projectId)
          ? mergeLectureCandidatePages(current, next)
          : current,
      );
    } catch (loadError) {
      onError(loadError);
    } finally {
      setLoadingMoreProjects((current) => {
        const next = new Set(current);
        next.delete(projectId);
        return next;
      });
    }
  };

  const sourceSelection = useMemo<LectureSourceSelection>(() => {
    const literature = [...selectedLiterature].map((key) => {
      const [projectId = '', recordId = ''] = key.split(':');
      return { projectId, recordId };
    });
    const experiments = [...selectedExperiments].map((key) => {
      const [projectId = '', ideaId = ''] = key.split(':');
      return { projectId, ideaId };
    });
    const manuscripts = [...selectedManuscripts].map((key) => {
      const [projectId = '', manuscriptId = ''] = key.split(':');
      return { projectId, manuscriptId };
    });
    return { literature, experiments, manuscripts };
  }, [selectedExperiments, selectedLiterature, selectedManuscripts]);

  const sourceCount =
    sourceSelection.literature.length +
    sourceSelection.experiments.length +
    sourceSelection.manuscripts.length;
  const canCreate =
    !busy &&
    !creating &&
    title.trim().length >= 2 &&
    projectIds.length > 0 &&
    projectIds.length <= LECTURE_STUDIO_MAX_SOURCE_PROJECTS &&
    outputProjectId !== '' &&
    sourceCount > 0 &&
    sourceCount <= LECTURE_STUDIO_UI_MAX_SOURCES &&
    !modelsLoading &&
    resolveLectureStudioModelSelection(initialModelSelection, models).issue === null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    setCreating(true);
    try {
      const studio = await adapter.create({
        title: title.trim(),
        kind,
        durationMinutes: kind === 'talk' ? durationMinutes : null,
        outputProjectId,
        sourceProjectIds: projectIds,
        sourceSelection,
        generationBrief: {
          notesTargetPages: notesTargetPages === '' ? null : Number(notesTargetPages),
          slidesTargetPages: slidesTargetPages === '' ? null : Number(slidesTargetPages),
          detailLevel,
          customInstructions,
        },
      });
      await onCreated(studio, initialModelSelection);
    } catch (createError) {
      onError(createError);
    } finally {
      setCreating(false);
    }
  };

  return (
    <form className="lecture-composer" onSubmit={(event) => void submit(event)}>
      <header>
        <span className="eyebrow">New synthesis</span>
        <h2>Build across projects</h2>
        <p>
          Select captured manuscript sources, reviewed paper metadata, and experiment evidence the
          lecture may use. GOSU freezes this source set for each generated revision.
        </p>
      </header>

      <div className="lecture-composer-basics">
        <label>
          Title
          <input
            value={title}
            minLength={2}
            maxLength={160}
            placeholder="e.g. Foundation models for tabular learning"
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
            required
          />
        </label>
        <fieldset>
          <legend>Output</legend>
          <div className="lecture-segmented-control">
            <button
              type="button"
              className={kind === 'lecture' ? 'active' : ''}
              aria-pressed={kind === 'lecture'}
              onClick={() => setKind('lecture')}
            >
              Lecture notes + slides
            </button>
            <button
              type="button"
              className={kind === 'talk' ? 'active' : ''}
              aria-pressed={kind === 'talk'}
              onClick={() => setKind('talk')}
            >
              Timed talk slides
            </button>
          </div>
        </fieldset>
      </div>

      <fieldset className="lecture-generation-model">
        <legend>Generation model</legend>
        <div>
          <label>
            Model
            <select
              value={initialModelSelection.modelId ?? ''}
              onChange={(event) =>
                setInitialModelSelection((current) =>
                  selectLectureStudioModel(current, event.target.value || null),
                )
              }
              disabled={creating || modelsLoading}
            >
              <option value="">Auto · provider recommended</option>
              {models.map((model) => (
                <option value={model.modelId} key={model.modelId}>
                  {model.displayName}
                  {model.isDefault ? ' · default' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reasoning
            <select
              value={initialModelSelection.reasoningOptionId ?? ''}
              onChange={(event) =>
                setInitialModelSelection((current) =>
                  selectLectureStudioReasoning(current, event.target.value || null),
                )
              }
              disabled={creating || modelsLoading}
            >
              <option value="">Model default</option>
              {(initialModelSelection.modelId
                ? models.find((model) => model.modelId === initialModelSelection.modelId)
                : models.find((model) => model.isDefault)
              )?.reasoningOptions.map((option) => (
                <option value={option.id} key={option.id}>
                  {option.label}
                  {option.isDefault ? ' · default' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ghost-button"
            onClick={onRefreshModels}
            disabled={modelsLoading}
          >
            Refresh models
          </button>
        </div>
        <small>Model names come from the live provider catalog and are never hardcoded.</small>
        {!modelsLoading &&
          resolveLectureStudioModelSelection(initialModelSelection, models).issue !== null && (
            <small role="alert">Refresh the model catalog or choose an available model.</small>
          )}
      </fieldset>

      {kind === 'talk' && (
        <fieldset className="lecture-duration-picker">
          <legend>Talk duration</legend>
          <div>
            {LECTURE_STUDIO_DURATIONS.map((minutes) => (
              <button
                type="button"
                key={minutes}
                className={durationMinutes === minutes ? 'active' : ''}
                aria-pressed={durationMinutes === minutes}
                onClick={() => setDurationMinutes(minutes)}
              >
                <strong>{minutes}</strong>
                <span>min</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="lecture-generation-brief">
        <legend>Length &amp; detail</legend>
        <p>
          Set optional length targets and guidance before generation. You can continue refining the
          result in the dedicated Lecture Studio chat.
        </p>
        <div className="lecture-generation-brief-grid">
          <label>
            Lecture-note pages
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              inputMode="numeric"
              value={notesTargetPages}
              placeholder="Auto"
              onChange={(event) => setNotesTargetPages(event.target.value)}
            />
            <small>Approximate PDF page target.</small>
          </label>
          <label>
            Slide pages
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              inputMode="numeric"
              value={slidesTargetPages}
              placeholder="Auto"
              onChange={(event) => setSlidesTargetPages(event.target.value)}
            />
            <small>Exact number of Markdown slides.</small>
          </label>
          <label>
            Detail
            <select
              value={detailLevel}
              onChange={(event) => setDetailLevel(event.target.value as LectureStudioDetailLevel)}
            >
              <option value="concise">Concise</option>
              <option value="standard">Standard</option>
              <option value="detailed">Detailed</option>
              <option value="exhaustive">Exhaustive</option>
            </select>
            <small>Controls explanation depth, not evidence quality.</small>
          </label>
        </div>
        <label className="lecture-generation-instructions">
          Additional instructions
          <textarea
            rows={4}
            maxLength={LECTURE_STUDIO_MAX_GENERATION_INSTRUCTIONS}
            value={customInstructions}
            placeholder="e.g. Focus on methodology, compare assumptions, and end with open questions."
            onChange={(event) => setCustomInstructions(event.target.value)}
          />
          <small>
            {customInstructions.length.toLocaleString()} /{' '}
            {LECTURE_STUDIO_MAX_GENERATION_INSTRUCTIONS.toLocaleString()} characters
          </small>
        </label>
      </fieldset>

      <fieldset className="lecture-project-picker">
        <legend>Source projects</legend>
        <p>
          Choose up to {LECTURE_STUDIO_MAX_SOURCE_PROJECTS} active projects ({projectIds.length}{' '}
          selected).
        </p>
        <div>
          {projects.map((project) => (
            <label key={project.id}>
              <input
                type="checkbox"
                checked={projectIds.includes(project.id)}
                onChange={() => toggleProject(project.id)}
              />
              <span>{project.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {selectionError && (
        <div className="error-banner" role="alert">
          {selectionError}
          <button type="button" className="ghost-button" onClick={() => setSelectionError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <label className="lecture-output-project">
        Save generated Markdown to
        <select
          value={outputProjectId}
          onChange={(event) => setOutputProjectId(event.target.value)}
          disabled={projectIds.length === 0}
          required
        >
          {projectIds.map((projectId) => {
            const project = projects.find(({ id }) => id === projectId);
            return (
              <option value={projectId} key={projectId}>
                {project?.name ?? projectId} / Lecture Notes &amp; Slides
              </option>
            );
          })}
        </select>
        <small>
          Every revision is saved as new immutable Markdown files in this project’s Research Notes.
        </small>
      </label>

      <section className="lecture-source-picker">
        <header>
          <div>
            <h3>Evidence sources</h3>
            <p>
              Select up to {LECTURE_STUDIO_UI_MAX_SOURCES} exact records in total. Reviewed paper
              metadata stays labeled as metadata-only until full text is verified. GOSU stops before
              generation if verbose source metadata cannot fit in the model context; it never
              silently drops selected evidence.
            </p>
          </div>
          <strong>{sourceCount} selected</strong>
        </header>
        {loadingSources ? (
          <div className="lecture-source-empty" role="status">
            Reading project evidence…
          </div>
        ) : projectIds.length === 0 ? (
          <div className="lecture-source-empty">Select at least one project.</div>
        ) : (
          <div className="lecture-source-projects">
            {(candidates?.projects ?? []).map((project) => (
              <section key={project.projectId}>
                <header>
                  <strong>{project.projectName}</strong>
                  <span>
                    {project.manuscripts.length} manuscript
                    {project.manuscripts.length === 1 ? '' : 's'} ·{' '}
                    {project.literatureRecords.length} of {project.literaturePage.total} reviewed
                    paper metadata records · {project.experiments.length} of{' '}
                    {project.experimentPage.total} experiments
                  </span>
                </header>
                <div className="lecture-source-columns">
                  <div>
                    <h4>Reviewed paper metadata</h4>
                    {project.literatureRecords.length === 0 ? (
                      <p>No saved papers</p>
                    ) : (
                      project.literatureRecords.map((record) => {
                        const key = sourceKey(project.projectId, record.id);
                        return (
                          <label key={record.id}>
                            <input
                              type="checkbox"
                              checked={selectedLiterature.has(key)}
                              onChange={() => toggleSource('literature', key)}
                            />
                            <span>
                              <strong>{record.title}</strong>
                              <small>
                                {formatAuthors(record)} · {record.publishedYear ?? 'Year unknown'}
                              </small>
                              {(record.manualAnnotations.topics.length > 0 ||
                                record.sourceTopics.length > 0) && (
                                <small>
                                  Topics:{' '}
                                  {[...record.manualAnnotations.topics, ...record.sourceTopics]
                                    .slice(0, 4)
                                    .join(', ')}
                                </small>
                              )}
                            </span>
                            <em>{record.reviewStatus} · Metadata only</em>
                          </label>
                        );
                      })
                    )}
                  </div>
                  <div>
                    <h4>Experiments</h4>
                    {project.experiments.length === 0 ? (
                      <p>No experiment ideas</p>
                    ) : (
                      project.experiments.map(
                        ({ idea, metricPoints, metricPointTotal, metricsTruncated }) => {
                          const key = sourceKey(project.projectId, idea.id);
                          return (
                            <label key={idea.id}>
                              <input
                                type="checkbox"
                                checked={selectedExperiments.has(key)}
                                onChange={() => toggleSource('experiment', key)}
                              />
                              <span>
                                <strong>{idea.title}</strong>
                                <small>{metricSummary(metricPoints, idea.id)}</small>
                                {metricsTruncated && (
                                  <small>
                                    Latest {metricPoints.length} of {metricPointTotal} metric points
                                  </small>
                                )}
                              </span>
                              <em>{idea.outcome}</em>
                            </label>
                          );
                        },
                      )
                    )}
                  </div>
                  <div>
                    <h4>Captured manuscripts</h4>
                    {project.manuscripts.length === 0 ? (
                      <p>No manuscripts in this project</p>
                    ) : (
                      project.manuscripts.map((candidate) => {
                        const key = sourceKey(project.projectId, candidate.manuscript.id);
                        const ready = candidate.availability === 'ready';
                        return (
                          <label
                            key={candidate.manuscript.id}
                            className={!ready ? 'unavailable' : ''}
                            aria-label={`${candidate.manuscript.title} — ${candidate.manuscript.rootDocument} — ${ready ? 'captured checkpoint ready' : lectureManuscriptAvailabilityLabel(candidate.availability)}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedManuscripts.has(key)}
                              disabled={!ready}
                              onChange={() => toggleSource('manuscript', key)}
                            />
                            <span>
                              <strong title={candidate.manuscript.title}>
                                {candidate.manuscript.title}
                              </strong>
                              <small title={candidate.manuscript.rootDocument}>
                                Root: {candidate.manuscript.rootDocument}
                              </small>
                              {candidate.observedAt && (
                                <small>
                                  Captured checkpoint · {formatUpdatedAt(candidate.observedAt)}
                                </small>
                              )}
                              {!ready && (
                                <small>
                                  {lectureManuscriptAvailabilityLabel(candidate.availability)}
                                </small>
                              )}
                            </span>
                            <em>{ready ? 'Ready' : 'Not ready'}</em>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
                {(project.literaturePage.hasMore || project.experimentPage.hasMore) && (
                  <button
                    type="button"
                    className="lecture-load-more"
                    disabled={loadingMoreProjects.has(project.projectId)}
                    onClick={() => void loadMoreSources(project.projectId)}
                  >
                    {loadingMoreProjects.has(project.projectId)
                      ? 'Loading more evidence…'
                      : `Load more from ${project.projectName}`}
                  </button>
                )}
              </section>
            ))}
          </div>
        )}
      </section>

      <footer>
        <span>
          {kind === 'talk' ? `${durationMinutes}-minute talk` : 'Lecture'} · {projectIds.length}{' '}
          project{projectIds.length === 1 ? '' : 's'} · {sourceCount} source
          {sourceCount === 1 ? '' : 's'}
        </span>
        <div>
          {onCancel && (
            <button
              type="button"
              className="ghost-button"
              onClick={onCancel}
              disabled={busy || creating}
            >
              Cancel
            </button>
          )}
          <button type="submit" className="primary-button" disabled={!canCreate}>
            {creating ? 'Creating…' : busy ? 'Generating…' : 'Create & generate'}
          </button>
        </div>
      </footer>
    </form>
  );
}

function StudioPreview({
  studio,
  revision,
  projects,
  adapter,
  activeTab,
  busy,
  onTab,
  onGenerate,
  onCancel,
}: {
  studio: LectureStudio;
  revision: LectureStudioRevision | null;
  projects: readonly ProjectRecord[];
  adapter: LectureStudioViewAdapter;
  activeTab: PreviewTab;
  busy: boolean;
  onTab: (tab: PreviewTab) => void;
  onGenerate: () => void;
  onCancel: () => void;
}) {
  const [pdfPreviews, setPdfPreviews] = useState<
    Partial<Record<'lecture-notes' | 'slides', LectureStudioPdfPreview>>
  >({});
  const [compilingPdf, setCompilingPdf] = useState<'lecture-notes' | 'slides' | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [artifactAction, setArtifactAction] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [artifactActionBusy, setArtifactActionBusy] = useState(false);
  const automaticPdfCompileKey = useRef<string | null>(null);
  const pdfCompileGeneration = useRef(0);
  const artifactActionGeneration = useRef(0);
  const mounted = useRef(true);
  const outputProjectName = lectureOutputProjectName(projects, studio.outputProjectId);
  const documentKind = previewDocumentKind(activeTab);
  const markdown = revision ? revisionMarkdown(revision, documentKind) : '';
  const pdfPreview = pdfPreviews[documentKind];
  const currentArtifact = revision?.artifacts.find((artifact) => artifact.kind === documentKind);

  useEffect(() => {
    pdfCompileGeneration.current += 1;
    automaticPdfCompileKey.current = null;
    setPdfPreviews({});
    setCompilingPdf(null);
    setPdfError(null);
    artifactActionGeneration.current += 1;
    setArtifactAction(null);
    setArtifactError(null);
    setArtifactActionBusy(false);
  }, [revision?.id, studio.id]);

  useEffect(() => {
    artifactActionGeneration.current += 1;
    setArtifactAction(null);
    setArtifactError(null);
    setArtifactActionBusy(false);
  }, [documentKind]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pdfCompileGeneration.current += 1;
      artifactActionGeneration.current += 1;
    };
  }, []);

  const compilePdf = useCallback(async () => {
    if (!revision) return;
    const kind = previewDocumentKind(activeTab);
    const generation = ++pdfCompileGeneration.current;
    setCompilingPdf(kind);
    setPdfError(null);
    try {
      const contentSha256 = await sha256Text(revisionMarkdown(revision, kind));
      const preview = await adapter.compilePdf({
        studioId: studio.id,
        revision: revision.revision,
        kind,
        contentSha256,
      });
      if (!mounted.current || generation !== pdfCompileGeneration.current) return;
      setPdfPreviews((current) => ({ ...current, [kind]: preview }));
    } catch (compileError) {
      if (!mounted.current || generation !== pdfCompileGeneration.current) return;
      setPdfError(lectureErrorMessage(compileError));
    } finally {
      if (mounted.current && generation === pdfCompileGeneration.current) setCompilingPdf(null);
    }
  }, [activeTab, adapter, revision, studio.id]);

  const artifactInput = () => {
    if (!revision || !currentArtifact) return null;
    return {
      studioId: studio.id,
      revisionId: revision.id,
      revision: revision.revision,
      kind: documentKind,
      artifactContentSha256: currentArtifact.contentSha256,
    } as const;
  };

  const runArtifactAction = async (
    action: 'export' | 'open' | 'reveal',
    format?: 'markdown' | 'pdf',
  ) => {
    const input = artifactInput();
    if (!input || artifactActionBusy) return;
    const generation = ++artifactActionGeneration.current;
    setArtifactActionBusy(true);
    setArtifactAction(null);
    setArtifactError(null);
    try {
      const receipt =
        action === 'export'
          ? await adapter.exportArtifact({ ...input, format: format! })
          : action === 'open'
            ? await adapter.openArtifact({ ...input, format: format! })
            : await adapter.revealArtifact(input);
      if (
        mounted.current &&
        generation === artifactActionGeneration.current &&
        receipt.status !== 'cancelled'
      ) {
        const location = receipt.relativePath ? ` · ${receipt.relativePath}` : '';
        const statusLabel =
          receipt.status === 'revealed'
            ? 'Shown in Finder'
            : receipt.status === 'exported'
              ? 'Exported'
              : 'Opened';
        setArtifactAction(`${statusLabel}${location}`);
      }
    } catch (actionError) {
      if (mounted.current && generation === artifactActionGeneration.current) {
        setArtifactError(lectureErrorMessage(actionError));
      }
    } finally {
      if (mounted.current && generation === artifactActionGeneration.current) {
        setArtifactActionBusy(false);
      }
    }
  };

  useEffect(() => {
    if (!revision || !previewIsPdf(activeTab) || pdfPreview || compilingPdf !== null) return;
    const key = `${revision.id}:${documentKind}`;
    if (automaticPdfCompileKey.current === key) return;
    automaticPdfCompileKey.current = key;
    void compilePdf();
  }, [activeTab, compilePdf, compilingPdf, documentKind, pdfPreview, revision]);

  const artifactActionLabels = lectureArtifactActionLabels(activeTab);

  return (
    <main className="lecture-preview">
      <header className="lecture-preview-toolbar">
        <div>
          <span className={`lecture-studio-status ${studio.status}`} aria-hidden="true" />
          <span className="sr-only">Status: {lectureStudioStatusLabel(studio.status)}. </span>
          <div>
            <h2>{studio.title}</h2>
            <p>
              {studio.kind === 'talk' ? `${studio.durationMinutes}-minute talk` : 'Lecture'} ·{' '}
              {studio.sourceProjectIds.length} projects · revision {studio.currentRevision}
            </p>
          </div>
        </div>
        {studio.status === 'generating' || busy ? (
          <button type="button" className="danger-button" onClick={onCancel}>
            Stop generation
          </button>
        ) : (
          <button type="button" className="secondary-button" onClick={onGenerate}>
            Generate new revision
          </button>
        )}
        {studio.lastErrorCode && studio.status === 'failed' && (
          <div className="lecture-preview-error" role="status">
            <strong>Last generation did not commit</strong>
            <span>{lectureErrorCodeMessage(studio.lastErrorCode)}</span>
            <code>{studio.lastErrorCode}</code>
          </div>
        )}
        {pdfError && (
          <div className="lecture-preview-error" role="alert">
            <strong>PDF preview was not created</strong>
            <span>{pdfError}</span>
            <button type="button" className="ghost-button" onClick={() => setPdfError(null)}>
              Dismiss
            </button>
          </div>
        )}
        {artifactError && (
          <div className="lecture-preview-error" role="alert">
            <strong>Document action did not complete</strong>
            <span>{artifactError}</span>
            <button type="button" className="ghost-button" onClick={() => setArtifactError(null)}>
              Dismiss
            </button>
          </div>
        )}
      </header>

      <div className="lecture-preview-tabs" role="tablist" aria-label="Generated documents">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'notes'}
          className={activeTab === 'notes' ? 'active' : ''}
          onClick={() => onTab('notes')}
        >
          Lecture notes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'slides'}
          className={activeTab === 'slides' ? 'active' : ''}
          onClick={() => onTab('slides')}
        >
          {studio.kind === 'talk' ? 'Talk slides' : 'Lecture slides'}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'notes-pdf'}
          className={activeTab === 'notes-pdf' ? 'active' : ''}
          onClick={() => onTab('notes-pdf')}
        >
          Notes PDF
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'slides-pdf'}
          className={activeTab === 'slides-pdf' ? 'active' : ''}
          onClick={() => onTab('slides-pdf')}
        >
          Slides PDF
        </button>
      </div>

      {revision && currentArtifact && (
        <div className="lecture-artifact-actions" aria-label="Lecture document actions">
          <button
            type="button"
            className="ghost-button lecture-artifact-action-button"
            aria-label={artifactActionLabels.export}
            title={artifactActionLabels.export}
            data-lecture-artifact-action="export"
            disabled={artifactActionBusy}
            onClick={() =>
              void runArtifactAction('export', previewIsPdf(activeTab) ? 'pdf' : 'markdown')
            }
          >
            <LectureArtifactActionIcon kind="export" />
          </button>
          <button
            type="button"
            className="ghost-button lecture-artifact-action-button"
            aria-label={artifactActionLabels.open}
            title={artifactActionLabels.open}
            data-lecture-artifact-action="open"
            disabled={artifactActionBusy}
            onClick={() =>
              void runArtifactAction('open', previewIsPdf(activeTab) ? 'pdf' : 'markdown')
            }
          >
            <LectureArtifactActionIcon kind="open" />
          </button>
          <button
            type="button"
            className="ghost-button lecture-artifact-action-button"
            aria-label={artifactActionLabels.reveal}
            title={artifactActionLabels.reveal}
            data-lecture-artifact-action="reveal"
            disabled={artifactActionBusy}
            onClick={() => void runArtifactAction('reveal')}
          >
            <LectureArtifactActionIcon kind="reveal" />
          </button>
          {artifactAction && <span role="status">{artifactAction}</span>}
        </div>
      )}

      <section
        className={`lecture-preview-document${previewIsPdf(activeTab) ? ' pdf' : ''}`}
        role="tabpanel"
      >
        {studio.status === 'generating' && markdown.trim() === '' ? (
          <div className="lecture-preview-empty generating">
            <i />
            <strong>Building revision {studio.currentRevision + 1}</strong>
            <span>Codex is synthesizing only the selected, frozen evidence.</span>
          </div>
        ) : markdown.trim() === '' ? (
          <div className="lecture-preview-empty">
            <strong>No generated {activeTab} yet</strong>
            <span>Generate the first revision to preview it here.</span>
          </div>
        ) : previewIsPdf(activeTab) && pdfPreview ? (
          <PdfPreview document={pdfPreview} className="lecture-studio-pdf-preview" />
        ) : previewIsPdf(activeTab) ? (
          <div className="lecture-preview-empty">
            <strong>Compile this revision as PDF</strong>
            <span>
              GOSU compiles the exact saved Markdown locally with network access disabled.
            </span>
            <button
              type="button"
              className="primary-button"
              disabled={compilingPdf !== null}
              onClick={() => void compilePdf()}
            >
              {compilingPdf === documentKind ? 'Compiling PDF…' : 'Compile & preview PDF'}
            </button>
          </div>
        ) : (
          <MarkdownDocument
            notePath={`${studio.title}-${activeTab}.md`}
            source={markdown}
            vaultFiles={[]}
            onOpenNote={() => undefined}
            loadVaultImages={false}
          />
        )}
      </section>

      <footer className="lecture-preview-receipts">
        <div>
          <span>RESEARCH NOTES</span>
          <strong>{outputProjectName} / Lecture Notes &amp; Slides</strong>
          <small>Updated {formatUpdatedAt(studio.updatedAt)}</small>
        </div>
        {!revision ? (
          <p>Confirmed file paths will appear after generation.</p>
        ) : (
          <ul>
            {revision.artifacts.map((artifact) => (
              <li key={`${artifact.kind}:${artifact.relativePath}`}>
                <span>{artifact.kind}</span>
                <code title={artifact.relativePath}>{artifact.relativePath}</code>
              </li>
            ))}
          </ul>
        )}
      </footer>
    </main>
  );
}

function LectureStudioChat({
  studio,
  messages,
  busy,
  draft,
  onDraftChange,
  onSend,
  onCancel,
  collapsed,
  onCollapsedChange,
  models,
  modelsLoading,
  selectedModel,
  selectedReasoning,
  selectedModelDescriptor,
  selectionUnavailable,
  onSelectedModel,
  onSelectedReasoning,
  onRefreshModels,
}: {
  studio: LectureStudio;
  messages: readonly LectureStudioMessage[];
  busy: boolean;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: (message: string) => Promise<boolean>;
  onCancel: () => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  models: readonly CodexModel[];
  modelsLoading: boolean;
  selectedModel: string | null;
  selectedReasoning: string | null;
  selectedModelDescriptor: CodexModel | undefined;
  selectionUnavailable: boolean;
  onSelectedModel: (modelId: string | null) => void;
  onSelectedReasoning: (reasoningOptionId: string | null) => void;
  onRefreshModels: () => void;
}) {
  const [showNewMessageJump, setShowNewMessageJump] = useState(false);
  const messagesElement = useRef<HTMLDivElement | null>(null);
  const pinnedToBottom = useRef(true);
  const previousStudioId = useRef<string | null>(null);
  const previousMessageId = useRef<string | null>(null);
  const latestMessageId = lastLectureMessageId(messages);
  const reasoningOptions = selectedModelDescriptor?.reasoningOptions ?? [];

  const jumpToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const element = messagesElement.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    pinnedToBottom.current = true;
    setShowNewMessageJump(false);
  }, []);

  useEffect(() => {
    if (previousStudioId.current !== studio.id) {
      previousStudioId.current = studio.id;
      previousMessageId.current = latestMessageId;
      pinnedToBottom.current = true;
      setShowNewMessageJump(false);
      const frame = requestAnimationFrame(() => jumpToLatest('auto'));
      return () => cancelAnimationFrame(frame);
    }
    if (latestMessageId === previousMessageId.current) return;
    previousMessageId.current = latestMessageId;
    if (!latestMessageId) return;
    if (pinnedToBottom.current) {
      const frame = requestAnimationFrame(() => jumpToLatest('auto'));
      return () => cancelAnimationFrame(frame);
    }
    setShowNewMessageJump(true);
    return undefined;
  }, [jumpToLatest, latestMessageId, studio.id]);

  if (collapsed) {
    return (
      <aside className="lecture-chat collapsed" aria-label="Lecture assistant collapsed">
        <button
          type="button"
          className="lecture-pane-toggle"
          aria-label="Show lecture assistant"
          title="Show lecture assistant"
          aria-expanded="false"
          aria-controls="lecture-studio-assistant"
          onClick={() => onCollapsedChange(false)}
        >
          <CollapseChevron direction="left" />
        </button>
        <span>AI</span>
      </aside>
    );
  }

  const send = async () => {
    const message = draft.trim();
    if (!message || busy || studio.status !== 'ready' || selectionUnavailable) return;
    const succeeded = await onSend(message);
    if (succeeded) onDraftChange('');
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  };

  return (
    <aside className="lecture-chat" id="lecture-studio-assistant">
      <header>
        <div>
          <span className="eyebrow">Lecture assistant</span>
          <h2>Edit this revision</h2>
        </div>
        {busy && (
          <button type="button" className="ghost-button" onClick={onCancel}>
            Stop
          </button>
        )}
        <button
          type="button"
          className="lecture-pane-toggle"
          aria-label="Hide lecture assistant"
          title="Hide lecture assistant"
          aria-expanded="true"
          aria-controls="lecture-studio-assistant"
          onClick={() => onCollapsedChange(true)}
        >
          <CollapseChevron direction="right" />
        </button>
      </header>
      <div className="lecture-chat-models">
        <label>
          Model
          <select
            value={selectedModel ?? ''}
            onChange={(event) => onSelectedModel(event.target.value || null)}
            disabled={busy || modelsLoading}
          >
            <option value="">Auto · provider recommended</option>
            {selectedModel !== null && !models.some((model) => model.modelId === selectedModel) && (
              <option value={selectedModel} disabled>
                Unavailable model · choose again
              </option>
            )}
            {models.map((model) => (
              <option value={model.modelId} key={model.modelId}>
                {model.displayName}
                {model.isDefault ? ' · default' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reasoning
          <select
            value={selectedReasoning ?? ''}
            onChange={(event) => onSelectedReasoning(event.target.value || null)}
            disabled={busy || modelsLoading || reasoningOptions.length === 0}
          >
            <option value="">Model default</option>
            {selectedReasoning !== null &&
              !reasoningOptions.some((option) => option.id === selectedReasoning) && (
                <option value={selectedReasoning} disabled>
                  Unavailable reasoning · choose again
                </option>
              )}
            {reasoningOptions.map((option) => (
              <option value={option.id} key={option.id}>
                {option.label}
                {option.isDefault ? ' · default' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ghost-button"
          onClick={onRefreshModels}
          disabled={modelsLoading}
        >
          Refresh
        </button>
        {selectionUnavailable && (
          <p role="alert">Choose an available model and reasoning option.</p>
        )}
      </div>
      <p className="lecture-chat-boundary">
        This chat edits only this lecture workspace. Project chats remain separate. Showing up to
        the {LECTURE_STUDIO_RECENT_MESSAGE_WINDOW} most recent messages.
      </p>
      <div className="lecture-chat-messages-shell">
        <div
          className="lecture-chat-messages"
          aria-live="polite"
          ref={messagesElement}
          onScroll={(event) => {
            const element = event.currentTarget;
            const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
            pinnedToBottom.current = nearBottom;
            if (nearBottom) setShowNewMessageJump(false);
          }}
        >
          {messages.length === 0 ? (
            <div className="lecture-chat-empty">
              <strong>Refine the generated material here</strong>
              <span>
                Try “shorten section 2,” “add an equation slide,” or “make the conclusion fit one
                minute.”
              </span>
            </div>
          ) : (
            messages.map((message) => (
              <article className={message.role} key={message.id}>
                <header>
                  <strong>{message.role === 'user' ? 'You' : 'GOSU'}</strong>
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </header>
                <MarkdownDocument
                  notePath="lecture-studio-chat.md"
                  source={message.content}
                  vaultFiles={[]}
                  onOpenNote={() => undefined}
                  loadVaultImages={false}
                />
              </article>
            ))
          )}
        </div>
        {showNewMessageJump && (
          <button type="button" className="lecture-chat-jump" onClick={() => jumpToLatest()}>
            New message ↓
          </button>
        )}
      </div>
      <footer>
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={keyDown}
          placeholder={
            studio.status === 'ready'
              ? 'Ask for a focused change to the notes or slides…'
              : 'Generate a revision before editing it…'
          }
          rows={3}
          maxLength={12_000}
          disabled={busy || studio.status !== 'ready' || selectionUnavailable}
        />
        <button
          type="button"
          className="primary-button"
          disabled={
            busy || studio.status !== 'ready' || selectionUnavailable || draft.trim() === ''
          }
          onClick={() => void send()}
        >
          {busy ? 'Working…' : 'Send'}
          <small>Enter</small>
        </button>
        <p>Shift + Enter for a new line. Each accepted edit creates new Markdown files.</p>
      </footer>
    </aside>
  );
}

export function emptyLectureSourceSelection(): LectureSourceSelection {
  return structuredClone(EMPTY_SOURCE_SELECTION);
}
