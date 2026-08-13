import { createHash, randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';

import {
  CancelLectureStudioInputSchema,
  CompileLectureStudioPdfInputSchema,
  CreateLectureStudioInputSchema,
  ExportLectureStudioArtifactInputSchema,
  GenerateLectureStudioInputSchema,
  EmptyLectureStudioTrashInputSchema,
  EmptyLectureStudioTrashReceiptSchema,
  LECTURE_STUDIO_MAX_MANUSCRIPT_FILES,
  LECTURE_STUDIO_MAX_MESSAGE_LENGTH,
  LECTURE_STUDIO_OUTPUT_SCHEMA,
  LectureSourceCandidatesSchema,
  LectureSourceManifestSchema,
  LectureStudioDetailInputSchema,
  LectureStudioDetailSchema,
  LectureStudioArtifactActionReceiptSchema,
  LectureStudioEventSchema,
  LectureStudioGenerationOutputSchema,
  LectureStudioListSnapshotSchema,
  LectureStudioMessageSchema,
  LectureStudioRevisionSchema,
  LectureStudioSchema,
  LectureStudioTurnReceiptSchema,
  ListLectureCandidatesInputSchema,
  ListLectureStudiosInputSchema,
  LectureStudioVersionCommandSchema,
  OpenLectureStudioArtifactInputSchema,
  RevealLectureStudioArtifactInputSchema,
  SendLectureStudioMessageInputSchema,
  type CancelLectureStudioInput,
  type CompileLectureStudioPdfInput,
  type CreateLectureStudioInput,
  type ExportLectureStudioArtifactInput,
  type GenerateLectureStudioInput,
  type EmptyLectureStudioTrashInput,
  type EmptyLectureStudioTrashReceipt,
  type LectureSourceCandidates,
  type LectureSourceManifest,
  type LectureSourceSelection,
  type LectureStudio,
  type LectureStudioArtifact,
  type LectureStudioArtifactActionReceipt,
  type LectureStudioDetail,
  type LectureStudioDetailInput,
  type LectureStudioEvent,
  type LectureStudioListSnapshot,
  type LectureStudioMessage,
  type LectureStudioPdfPreview,
  type LectureStudioRevision,
  type LectureStudioSummary,
  type LectureStudioTurnReceipt,
  type ListLectureCandidatesInput,
  type ListLectureStudiosInput,
  type LectureStudioVersionCommand,
  type OpenLectureStudioArtifactInput,
  type PendingLectureRevisionArtifacts,
  type RevealLectureStudioArtifactInput,
  type SendLectureStudioMessageInput,
} from '../shared/lecture-studio-contracts';
import type {
  ExperimentIdea,
  ExperimentMetricPoint,
} from '../shared/experiment-workspace-contracts';
import type { LiteratureRecord } from '../shared/literature-contracts';
import type { LectureExternalSourceService } from './lecture-external-source-service';
import type {
  ManuscriptCheckpointFileChunk,
  ManuscriptCheckpointFileList,
  ManuscriptWorkspaceSnapshot,
} from '../shared/manuscript-workspace-contracts';
import type { ProjectRecord, WorkspaceSnapshot } from '../shared/workspace-contracts';
import {
  LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS,
  LECTURE_STUDIO_SOURCE_MANIFEST_MAX_CHARACTERS,
  buildLectureStudioPrompt,
  talkSlideBudget,
} from './lecture-studio-prompt';
import {
  buildLectureLatexDocument,
  countLectureSlidePages,
  validateLectureLatexBody,
} from './lecture-latex-source';
import { LectureStudioStorageError } from './lecture-studio-storage-error';
import {
  LectureDocumentCompilerError,
  type LectureDocumentCompiler,
} from './lecture-document-compiler';
import { lecturePdfExportBytes, type LectureArtifactPlatform } from './lecture-artifact-platform';
import type { ResolvedLectureRevisionArtifact } from './research-notes-service';

type MaybePromise<T> = T | Promise<T>;
type CodexNotification = Readonly<{ method?: string; params?: unknown }>;

function lectureRevisionSource(revision: LectureStudioRevision, kind: 'lecture-notes' | 'slides') {
  if (revision.schemaVersion === 2) {
    return kind === 'lecture-notes' ? revision.lectureNotesLatex : revision.slidesLatex;
  }
  return kind === 'lecture-notes' ? revision.lectureNotesMarkdown : revision.slidesMarkdown;
}

function lectureRevisionFormat(revision: LectureStudioRevision) {
  return revision.schemaVersion === 2 ? ('latex' as const) : ('markdown' as const);
}

export type LectureExperimentMetricTail = Readonly<{
  ideaId: string;
  metricPoints: readonly ExperimentMetricPoint[];
  metricPointTotal: number;
}>;

export interface LectureStudioStorage {
  listLectureStudios(includeTrashed?: boolean): MaybePromise<readonly LectureStudioSummary[]>;
  getLectureStudio(studioId: string): MaybePromise<LectureStudio | null>;
  getLectureStudioDetail(studioId: string): MaybePromise<LectureStudioDetail | null>;
  listLectureStudioMessages(
    studioId: string,
    limit: number,
  ): MaybePromise<readonly LectureStudioMessage[]>;
  listLectureStudioRevisions(
    studioId: string,
    limit: number,
  ): MaybePromise<readonly LectureStudioRevision[]>;
  getCurrentLectureStudioRevision(studioId: string): MaybePromise<LectureStudioRevision | null>;
  getLectureStudioRevision(
    studioId: string,
    revision: number,
  ): MaybePromise<LectureStudioRevision | null>;
  createLectureStudio(studio: LectureStudio): MaybePromise<boolean>;
  beginLectureStudioTurn(
    input: Readonly<{
      studioId: string;
      expectedVersion: number;
      attemptId: string;
      userMessage: LectureStudioMessage | null;
      updatedAt: string;
    }>,
  ): MaybePromise<LectureStudio | null>;
  completeLectureStudioTurn(
    input: Readonly<{
      studio: LectureStudio;
      revision: LectureStudioRevision;
      assistantMessage: LectureStudioMessage;
    }>,
  ): MaybePromise<LectureStudio | null>;
  failLectureStudioTurn(
    input: Readonly<{
      studioId: string;
      attemptId: string;
      errorCode: string;
      messageStatus: 'failed' | 'interrupted';
      updatedAt: string;
    }>,
  ): MaybePromise<LectureStudio | null>;
  setLectureStudioTrashed(
    studioId: string,
    expectedVersion: number,
    trashedAt: string | null,
    updatedAt: string,
  ): MaybePromise<LectureStudio | null>;
  emptyLectureStudioTrash(
    input: EmptyLectureStudioTrashInput,
    completedAt: string,
  ): MaybePromise<EmptyLectureStudioTrashReceipt | null>;
}

export interface LectureStudioSourceStorage {
  listLiteratureRecords(projectId: string): MaybePromise<readonly LiteratureRecord[]>;
  getLiteratureRecordsByIds(
    projectId: string,
    recordIds: readonly string[],
  ): MaybePromise<readonly LiteratureRecord[]>;
  listExperimentIdeas(projectId: string): MaybePromise<readonly ExperimentIdea[]>;
  listExperimentMetricTails(
    input: Readonly<{
      projectId: string;
      ideaIds: readonly string[];
      perIdeaLimit: number;
    }>,
  ): MaybePromise<readonly LectureExperimentMetricTail[]>;
  getExperimentIdea(projectId: string, ideaId: string): MaybePromise<ExperimentIdea | null>;
}

/**
 * Read-only, project-scoped port into the Manuscript module. Lecture never reads manuscript
 * tables or adapter-private mirrors directly; every source body comes from one exact captured
 * checkpoint through the Manuscript service's existing validation boundary.
 */
export interface LectureManuscriptSourcePort {
  list(input: { projectId: string }): Promise<ManuscriptWorkspaceSnapshot>;
  listCheckpointFiles(input: {
    projectId: string;
    manuscriptId: string;
    checkpointId: string;
  }): Promise<ManuscriptCheckpointFileList>;
  readCheckpointFile(input: {
    projectId: string;
    manuscriptId: string;
    checkpointId: string;
    relativePath: string;
    offset?: number;
    maxCharacters?: number;
  }): Promise<ManuscriptCheckpointFileChunk>;
}

export interface LectureStudioWorkspace {
  snapshot(): MaybePromise<WorkspaceSnapshot>;
}

export interface LectureStudioArtifactWriter {
  assertRevisionDestination(outputProjectId: string): MaybePromise<void>;
  saveRevisionArtifacts(
    input: Readonly<{
      outputProjectId: string;
      studioId: string;
      studioTitle: string;
      revision: number;
      attemptId: string;
      sourceManifestSha256: string;
      documentFormat?: 'markdown' | 'latex';
      lectureNotesMarkdown?: string;
      slidesMarkdown?: string;
      lectureNotesLatex?: string;
      slidesLatex?: string;
      createdAt: string;
      invocation?: ModelInvocation;
      relatedDocuments?: readonly string[];
      relatedPapers?: readonly string[];
    }>,
  ): MaybePromise<readonly [LectureStudioArtifact, LectureStudioArtifact]>;
  confirmRevisionArtifacts(
    input: Parameters<LectureStudioArtifactWriter['saveRevisionArtifacts']>[0],
  ): MaybePromise<void>;
  rollbackRevisionArtifacts(
    input: Parameters<LectureStudioArtifactWriter['saveRevisionArtifacts']>[0],
  ): MaybePromise<void>;
  listPendingRevisionArtifacts(
    requestedLimit?: number,
  ): MaybePromise<readonly PendingLectureRevisionArtifacts[]>;
  confirmPendingRevisionArtifacts(pending: PendingLectureRevisionArtifacts): MaybePromise<void>;
  rollbackPendingRevisionArtifacts(pending: PendingLectureRevisionArtifacts): MaybePromise<void>;
  resolveLectureRevisionArtifact(
    outputProjectId: string,
    artifact: LectureStudioArtifact,
  ): MaybePromise<ResolvedLectureRevisionArtifact>;
}

export interface LectureStudioCodex {
  on: EventEmitter['on'];
  startThread(input: {
    cwd: string;
    modelId: string | null;
    developerInstructions?: string;
    responseVerbosity?: 'low' | 'medium' | 'high' | null;
    dynamicTools?: readonly never[];
    webSearchMode?: 'disabled';
  }): Promise<{ threadId: string }>;
  runTurn(input: {
    threadId: string;
    prompt: string;
    requestedModelId: string | null;
    reasoningOptionId: string | null;
    cwd: string;
    outputSchema?: Readonly<Record<string, unknown>>;
  }): Promise<{ turnId: string; invocation: ModelInvocation }>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  releaseThread(threadId: string): Promise<void>;
}

export class LectureStudioServiceError extends Error {
  constructor(
    readonly code:
      | 'lecture_unavailable'
      | 'lecture_studio_not_found'
      | 'lecture_version_conflict'
      | 'lecture_source_not_found'
      | 'lecture_source_conflict'
      | 'lecture_context_too_large'
      | 'lecture_research_notes_required'
      | 'lecture_busy'
      | 'lecture_not_active'
      | 'lecture_codex_unavailable'
      | 'lecture_generation_timed_out'
      | 'lecture_generation_failed'
      | 'lecture_invalid_response'
      | 'lecture_persistence_failed'
      | 'lecture_capacity_reached'
      | 'lecture_cancelled'
      | 'lecture_pdf_compiler_unavailable'
      | 'lecture_pdf_compile_failed'
      | 'lecture_pdf_too_large'
      | 'lecture_pdf_invalid'
      | 'lecture_artifact_not_found'
      | 'lecture_artifact_changed'
      | 'lecture_artifact_unavailable'
      | 'lecture_export_failed'
      | 'lecture_open_failed'
      | 'lecture_studio_trashed'
      | 'lecture_studio_not_trashed'
      | 'lecture_trash_empty',
  ) {
    super(code);
    this.name = 'LectureStudioServiceError';
  }
}

type PendingTurn = {
  studioId: string;
  attemptId: string;
  threadId: string;
  turnId: string | null;
  invocation: ModelInvocation | null;
  earlyInvocation: { turnId: string; invocation: ModelInvocation } | null;
  finalText: string | null;
  terminal: boolean;
  markActivity: (() => void) | null;
  disposeTimers: (() => void) | null;
  resolve: (value: { status: string; text: string | null }) => void;
};

type ActiveExecution = {
  studioId: string;
  attemptId: string;
  threadId: string | null;
  turnId: string | null;
  cancelRequested: boolean;
  terminal: boolean;
};

type TurnRequest = Readonly<{
  studioId: string;
  expectedVersion: number;
  requestedModelId: string | null;
  reasoningOptionId: string | null;
  message: string | null;
}>;

const LECTURE_STUDIO_MAX_METRICS_PER_IDEA = 64;
const LECTURE_MANUSCRIPT_FILE_MAX_CHARACTERS = 24_000;
const LECTURE_MANUSCRIPT_FILE_EXTRACT_MAX_CHARACTERS = 72_000;
const LECTURE_MANUSCRIPT_TOTAL_EXTRACT_MAX_JSON_CHARACTERS = 100_000;
const LECTURE_MANUSCRIPT_SOURCE_PATH_PATTERN = /\.(?:bib|tex)$/iu;
const UNSUPPORTED_CITATION_PATTERN = /\[@[^\]]+\]|\\(?:auto|paren|text)?cite\s*\{[^}]+\}/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function notificationIdentity(notification: CodexNotification) {
  if (!isRecord(notification.params) || typeof notification.params.threadId !== 'string') {
    return null;
  }
  const turn = notification.params.turn;
  const turnId =
    typeof notification.params.turnId === 'string'
      ? notification.params.turnId
      : isRecord(turn) && typeof turn.id === 'string'
        ? turn.id
        : null;
  return turnId ? { threadId: notification.params.threadId, turnId } : null;
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeCharacterSlice(value: string, start: number, end?: number) {
  let safeStart = Math.max(0, Math.min(start, value.length));
  let safeEnd = Math.max(safeStart, Math.min(end ?? value.length, value.length));
  const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;
  const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
  if (safeStart > 0 && isLowSurrogate(value.charCodeAt(safeStart))) safeStart -= 1;
  if (safeEnd < value.length && isHighSurrogate(value.charCodeAt(safeEnd - 1))) safeEnd -= 1;
  return value.slice(safeStart, safeEnd);
}

function boundedExactFileExtract(content: string, maximumCharacters: number) {
  if (content.length <= maximumCharacters) return content;
  const marker = '\n\n% [GOSU bounded exact checkpoint extract: middle omitted]\n\n';
  const bodyBudget = Math.max(2, maximumCharacters - marker.length);
  const prefixLength = Math.ceil(bodyBudget * 0.72);
  const suffixLength = bodyBudget - prefixLength;
  return `${safeCharacterSlice(content, 0, prefixLength)}${marker}${safeCharacterSlice(
    content,
    content.length - suffixLength,
  )}`;
}

function boundedExactFileExtractToJsonBudget(content: string, maximumJsonCharacters: number) {
  if (JSON.stringify(content).length <= maximumJsonCharacters) return content;
  // An incomplete prefix/suffix extract carries a provenance marker. For very small residual
  // budgets the marker itself cannot fit, so retain the file identity/hash with an empty exact
  // excerpt instead of silently exceeding the caller's serialized-context allowance.
  if (JSON.stringify(boundedExactFileExtract(content, 1)).length > maximumJsonCharacters) return '';
  let low = 1;
  let high = Math.min(content.length, maximumJsonCharacters);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = boundedExactFileExtract(content, middle);
    if (JSON.stringify(candidate).length <= maximumJsonCharacters) low = middle;
    else high = middle - 1;
  }
  return boundedExactFileExtract(content, low);
}

function uniqueNonEmpty(values: readonly string[], maximum: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length === maximum) break;
  }
  return result;
}

function canonicalDoiUrl(doi: string | null) {
  if (!doi) return null;
  try {
    const normalized = doi.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '');
    const result = new URL(`https://doi.org/${normalized}`);
    return result.origin === 'https://doi.org' && result.username === '' && result.password === ''
      ? result.toString()
      : null;
  } catch {
    return null;
  }
}

function assistantContent(reply: string, artifacts: readonly LectureStudioArtifact[]) {
  const suffix = `\n\nSaved to Research Notes:\n${artifacts
    .map((artifact) => `- ${artifact.relativePath}`)
    .join('\n')}`;
  const maximumReplyLength = Math.max(1, LECTURE_STUDIO_MAX_MESSAGE_LENGTH - suffix.length);
  return `${reply.slice(0, maximumReplyLength).trimEnd()}${suffix}`;
}

function pendingArtifactPath(
  pending: PendingLectureRevisionArtifacts,
  artifact: LectureStudioArtifact,
) {
  return pending.artifacts.some(
    (candidate) =>
      candidate.kind === artifact.kind && candidate.relativePath === artifact.relativePath,
  );
}

function committedRevisionMatchesPending(
  studio: LectureStudio,
  revision: LectureStudioRevision,
  pending: PendingLectureRevisionArtifacts,
) {
  if (
    studio.id !== pending.studioId ||
    studio.outputProjectId !== pending.outputProjectId ||
    studio.currentRevision < pending.revision ||
    revision.studioId !== pending.studioId ||
    revision.revision !== pending.revision ||
    revision.attemptId !== pending.attemptId ||
    revision.sourceManifestSha256 !== pending.sourceManifestSha256
  ) {
    return false;
  }
  return (
    revision.artifacts.length === pending.artifacts.length &&
    revision.artifacts.every((artifact) =>
      pending.artifacts.some(
        (candidate) =>
          candidate.kind === artifact.kind &&
          candidate.relativePath === artifact.relativePath &&
          candidate.contentSha256 === artifact.contentSha256,
      ),
    )
  );
}

export class LectureStudioService {
  private readonly pendingByThread = new Map<string, PendingTurn>();
  private readonly bufferedByThread = new Map<string, CodexNotification[]>();
  private readonly activeByStudio = new Map<string, ActiveExecution>();
  private readonly lifecycleLockedProjects = new Set<string>();
  private readonly listeners = new Set<(event: LectureStudioEvent) => void>();
  private pendingArtifactReconciliation: Promise<void> | null = null;

  constructor(
    private readonly dependencies: Readonly<{
      storage: LectureStudioStorage;
      sources: LectureStudioSourceStorage;
      manuscripts: LectureManuscriptSourcePort;
      externalSources: Pick<
        LectureExternalSourceService,
        'claim' | 'discard' | 'snapshots' | 'purgeStudio' | 'rollbackClaim'
      >;
      workspace: LectureStudioWorkspace;
      artifacts: LectureStudioArtifactWriter;
      codex: LectureStudioCodex;
      /** Required acceptance gate: no canonical LaTeX revision is published before both PDFs compile. */
      pdfCompiler: Pick<LectureDocumentCompiler, 'compile'>;
      artifactPlatform?: LectureArtifactPlatform;
      prepareDirectory: (outputProjectId: string) => Promise<string>;
      now?: () => Date;
      /** Maximum time without a matching Codex notification before generation is stopped. */
      timeoutMs?: number;
      /** Absolute deadline for one generation, even while Codex continues reporting progress. */
      hardTimeoutMs?: number;
    }>,
  ) {
    dependencies.codex.on('notification', (notification: CodexNotification) => {
      this.routeNotification(notification);
    });
    dependencies.codex.on('disconnected', () => {
      for (const pending of this.pendingByThread.values()) {
        if (pending.terminal) continue;
        pending.terminal = true;
        pending.resolve({ status: 'transport_failed', text: null });
      }
    });
    dependencies.codex.on(
      'invocation',
      (event: { threadId?: string; turnId?: string; invocation?: ModelInvocation }) => {
        if (!event.threadId || !event.turnId || !event.invocation) return;
        const pending = this.pendingByThread.get(event.threadId);
        if (!pending) return;
        if (pending.turnId === null) {
          pending.earlyInvocation = { turnId: event.turnId, invocation: event.invocation };
          return;
        }
        if (pending.turnId === event.turnId) {
          pending.invocation = event.invocation;
          pending.markActivity?.();
        }
      },
    );
  }

  onEvent(listener: (event: LectureStudioEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async list(input: ListLectureStudiosInput): Promise<LectureStudioListSnapshot> {
    const command = ListLectureStudiosInputSchema.parse(input);
    await this.reconcilePendingArtifacts().catch(() => undefined);
    const studios = await this.dependencies.storage.listLectureStudios(command.includeTrashed);
    return LectureStudioListSnapshotSchema.parse({ schemaVersion: 1, studios });
  }

  async detail(input: LectureStudioDetailInput): Promise<LectureStudioDetail> {
    const command = LectureStudioDetailInputSchema.parse(input);
    await this.reconcilePendingArtifacts().catch(() => undefined);
    const detail = await this.dependencies.storage.getLectureStudioDetail(command.studioId);
    if (!detail) throw new LectureStudioServiceError('lecture_studio_not_found');
    if (detail.studio.trashedAt) {
      throw new LectureStudioServiceError('lecture_studio_trashed');
    }
    return LectureStudioDetailSchema.parse(detail);
  }

  async candidates(input: ListLectureCandidatesInput): Promise<LectureSourceCandidates> {
    const command = ListLectureCandidatesInputSchema.parse(input);
    const projects = await this.requireActiveProjects(command.projectIds);
    const candidates = await Promise.all(
      projects.map(async (project) => {
        const [literatureRecords, ideas, manuscriptSnapshot] = await Promise.all([
          this.dependencies.sources.listLiteratureRecords(project.id),
          this.dependencies.sources.listExperimentIdeas(project.id),
          this.dependencies.manuscripts.list({ projectId: project.id }),
        ]);
        if (manuscriptSnapshot.projectId !== project.id) {
          throw new LectureStudioServiceError('lecture_source_conflict');
        }
        const eligibleLiterature = literatureRecords.filter(
          (record) =>
            record.reviewStatus !== 'excluded' &&
            (command.includeUnreviewed ||
              record.reviewStatus === 'included' ||
              record.reviewStatus === 'reviewed'),
        );
        const orderedLiterature = eligibleLiterature.sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
        );
        const orderedIdeas = [...ideas].sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        );
        const pageIdeas = orderedIdeas.slice(
          command.experimentOffset,
          command.experimentOffset + command.experimentLimit,
        );
        const metricTails =
          pageIdeas.length > 0
            ? await this.dependencies.sources.listExperimentMetricTails({
                projectId: project.id,
                ideaIds: pageIdeas.map((idea) => idea.id),
                perIdeaLimit: command.metricPointLimit,
              })
            : [];
        const requestedIdeaIds = new Set(pageIdeas.map((idea) => idea.id));
        const tailsByIdea = new Map<string, LectureExperimentMetricTail>();
        for (const tail of metricTails) {
          if (
            !requestedIdeaIds.has(tail.ideaId) ||
            tailsByIdea.has(tail.ideaId) ||
            tail.metricPoints.length > command.metricPointLimit ||
            tail.metricPointTotal < tail.metricPoints.length ||
            tail.metricPoints.some(
              (point) => point.projectId !== project.id || point.ideaId !== tail.ideaId,
            )
          ) {
            throw new LectureStudioServiceError('lecture_source_conflict');
          }
          tailsByIdea.set(tail.ideaId, tail);
        }
        return {
          projectId: project.id,
          projectName: project.name,
          literatureRecords: orderedLiterature.slice(
            command.literatureOffset,
            command.literatureOffset + command.literatureLimit,
          ),
          literaturePage: {
            offset: command.literatureOffset,
            limit: command.literatureLimit,
            total: orderedLiterature.length,
            hasMore: command.literatureOffset + command.literatureLimit < orderedLiterature.length,
          },
          experiments: pageIdeas.map((idea) => {
            const tail = tailsByIdea.get(idea.id);
            const metricPoints = [...(tail?.metricPoints ?? [])].sort(
              (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
            );
            const metricPointTotal = tail?.metricPointTotal ?? 0;
            return {
              idea,
              metricPoints,
              metricPointTotal,
              metricsTruncated: metricPointTotal > metricPoints.length,
            };
          }),
          experimentPage: {
            offset: command.experimentOffset,
            limit: command.experimentLimit,
            total: orderedIdeas.length,
            hasMore: command.experimentOffset + command.experimentLimit < orderedIdeas.length,
          },
          manuscripts: manuscriptSnapshot.manuscripts.map(({ manuscript, connection }) => {
            if (manuscript.projectId !== project.id) {
              throw new LectureStudioServiceError('lecture_source_conflict');
            }
            const linked =
              connection?.binding.enabled === true &&
              connection.binding.projectId === project.id &&
              connection.binding.manuscriptId === manuscript.id;
            const checkpoint =
              linked &&
              connection.lastCheckpoint?.bindingId === connection.binding.bindingId &&
              connection.lastCheckpoint.projectId === project.id &&
              connection.lastCheckpoint.manuscriptId === manuscript.id &&
              connection.lastCheckpoint.providerId === connection.binding.providerId &&
              connection.lastCheckpoint.rootDocument === manuscript.rootDocument
                ? connection.lastCheckpoint
                : null;
            return {
              manuscript,
              availability: checkpoint
                ? ('ready' as const)
                : linked
                  ? ('capture_required' as const)
                  : ('unconnected' as const),
              checkpointId: checkpoint?.checkpointId ?? null,
              providerRevision: checkpoint?.providerRevision ?? checkpoint?.sourceRevision ?? null,
              observedAt: checkpoint?.observedAt ?? null,
            };
          }),
        };
      }),
    );
    return LectureSourceCandidatesSchema.parse({ schemaVersion: 1, projects: candidates });
  }

  async reconcilePendingArtifacts() {
    if (this.pendingArtifactReconciliation) {
      await this.pendingArtifactReconciliation;
      return;
    }
    const running = this.reconcilePendingArtifactsOnce();
    this.pendingArtifactReconciliation = running;
    try {
      await running;
    } finally {
      if (this.pendingArtifactReconciliation === running) {
        this.pendingArtifactReconciliation = null;
      }
    }
  }

  async create(input: CreateLectureStudioInput): Promise<LectureStudio> {
    const command = CreateLectureStudioInputSchema.parse(input);
    this.throwIfProjectsLifecycleLocked([...command.sourceProjectIds, command.outputProjectId]);
    const studioId = randomUUID();
    const externalSelection = command.sourceSelection.externalSources;
    let claimedExternalSources = false;
    if (externalSelection) {
      if (!command.sourceProjectIds.includes(command.outputProjectId)) {
        throw new LectureStudioServiceError('lecture_source_conflict');
      }
      try {
        await this.dependencies.externalSources.claim({
          projectId: command.outputProjectId,
          studioId,
          sourceSetId: externalSelection.sourceSetId,
          selectedSourceIds: externalSelection.sourceIds,
        });
        claimedExternalSources = true;
      } catch {
        throw new LectureStudioServiceError('lecture_source_conflict');
      }
    }
    try {
      await this.resolveSourceManifest(
        command.sourceProjectIds,
        command.sourceSelection,
        studioId,
        command.outputProjectId,
      );
      this.throwIfProjectsLifecycleLocked([...command.sourceProjectIds, command.outputProjectId]);
    } catch (error) {
      if (claimedExternalSources) {
        await this.dependencies.externalSources
          .rollbackClaim({ projectId: command.outputProjectId, studioId })
          .catch(() => undefined);
      }
      throw error;
    }
    const now = this.now().toISOString();
    const studio = LectureStudioSchema.parse({
      schemaVersion: 1,
      id: studioId,
      ...command,
      status: 'draft',
      activeAttemptId: null,
      currentRevision: 0,
      version: 1,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    let created: boolean;
    try {
      created = await this.dependencies.storage.createLectureStudio(studio);
    } catch (error) {
      if (claimedExternalSources) {
        await this.dependencies.externalSources
          .rollbackClaim({ projectId: command.outputProjectId, studioId })
          .catch(() => undefined);
      }
      throw this.normalizeStorageError(error);
    }
    if (!created) {
      if (claimedExternalSources) {
        await this.dependencies.externalSources
          .rollbackClaim({ projectId: command.outputProjectId, studioId })
          .catch(() => undefined);
      }
      throw new LectureStudioServiceError('lecture_persistence_failed');
    }
    if (externalSelection) {
      await this.dependencies.externalSources
        .discard({
          projectId: command.outputProjectId,
          sourceSetId: externalSelection.sourceSetId,
        })
        .catch(() => undefined);
    }
    this.publish(studio);
    return studio;
  }

  async generate(input: GenerateLectureStudioInput): Promise<LectureStudioTurnReceipt> {
    const command = GenerateLectureStudioInputSchema.parse(input);
    return this.runTurn({ ...command, message: null });
  }

  async trash(input: LectureStudioVersionCommand): Promise<LectureStudio> {
    const command = LectureStudioVersionCommandSchema.parse(input);
    if (this.activeByStudio.has(command.studioId)) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    const studio = await this.dependencies.storage.getLectureStudio(command.studioId);
    if (!studio) throw new LectureStudioServiceError('lecture_studio_not_found');
    if (studio.trashedAt) throw new LectureStudioServiceError('lecture_studio_trashed');
    if (studio.status === 'generating' || studio.activeAttemptId) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    if (studio.version !== command.expectedVersion) {
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    const now = this.now().toISOString();
    let trashed: LectureStudio | null;
    try {
      trashed = await this.dependencies.storage.setLectureStudioTrashed(
        studio.id,
        studio.version,
        now,
        now,
      );
    } catch (error) {
      throw this.normalizeStorageError(error);
    }
    if (!trashed) throw new LectureStudioServiceError('lecture_version_conflict');
    this.publish(trashed);
    return LectureStudioSchema.parse(trashed);
  }

  async restore(input: LectureStudioVersionCommand): Promise<LectureStudio> {
    const command = LectureStudioVersionCommandSchema.parse(input);
    const studio = await this.dependencies.storage.getLectureStudio(command.studioId);
    if (!studio) throw new LectureStudioServiceError('lecture_studio_not_found');
    if (!studio.trashedAt) throw new LectureStudioServiceError('lecture_studio_not_trashed');
    if (studio.version !== command.expectedVersion) {
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    let restored: LectureStudio | null;
    try {
      restored = await this.dependencies.storage.setLectureStudioTrashed(
        studio.id,
        studio.version,
        null,
        this.now().toISOString(),
      );
    } catch (error) {
      throw this.normalizeStorageError(error);
    }
    if (!restored) throw new LectureStudioServiceError('lecture_version_conflict');
    this.publish(restored);
    return LectureStudioSchema.parse(restored);
  }

  async emptyTrash(input: EmptyLectureStudioTrashInput): Promise<EmptyLectureStudioTrashReceipt> {
    const command = EmptyLectureStudioTrashInputSchema.parse(input);
    const trashed = await this.dependencies.storage.listLectureStudios(true);
    const trashedStudios = trashed.filter((studio) => studio.trashedAt !== undefined);
    if (trashedStudios.some((studio) => this.activeByStudio.has(studio.id))) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    let receipt: EmptyLectureStudioTrashReceipt | null;
    try {
      receipt = await this.dependencies.storage.emptyLectureStudioTrash(
        command,
        this.now().toISOString(),
      );
    } catch (error) {
      throw this.normalizeStorageError(error);
    }
    if (!receipt) {
      if (trashedStudios.length === 0) {
        throw new LectureStudioServiceError('lecture_trash_empty');
      }
      throw new LectureStudioServiceError('lecture_persistence_failed');
    }
    const parsed = EmptyLectureStudioTrashReceiptSchema.parse(receipt);
    await Promise.allSettled(
      parsed.removedStudios.map(({ outputProjectId, studioId }) =>
        this.dependencies.externalSources.purgeStudio({ projectId: outputProjectId, studioId }),
      ),
    );
    return parsed;
  }

  async send(input: SendLectureStudioMessageInput): Promise<LectureStudioTurnReceipt> {
    const command = SendLectureStudioMessageInputSchema.parse(input);
    return this.runTurn(command);
  }

  async compilePdf(input: CompileLectureStudioPdfInput): Promise<LectureStudioPdfPreview> {
    const command = CompileLectureStudioPdfInputSchema.parse(input);
    const compiler = this.dependencies.pdfCompiler;
    if (!compiler) {
      throw new LectureStudioServiceError('lecture_pdf_compiler_unavailable');
    }
    const studio = await this.requireStudio(command.studioId);
    const revision = await this.dependencies.storage.getLectureStudioRevision(
      studio.id,
      command.revision,
    );
    if (!revision || revision.revision > studio.currentRevision) {
      throw new LectureStudioServiceError('lecture_source_not_found');
    }
    const source = lectureRevisionSource(revision, command.kind);
    if (sha256(source) !== command.contentSha256) {
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    try {
      return await compiler.compile({
        studioId: studio.id,
        revision: revision.revision,
        title: studio.title,
        kind: command.kind,
        markdown: source,
        contentSha256: command.contentSha256,
        sourceFormat: lectureRevisionFormat(revision),
      });
    } catch (error) {
      if (error instanceof LectureStudioServiceError) throw error;
      if (error instanceof LectureDocumentCompilerError) {
        throw new LectureStudioServiceError(error.code);
      }
      throw new LectureStudioServiceError('lecture_pdf_compile_failed');
    }
  }

  async exportArtifact(
    input: ExportLectureStudioArtifactInput,
  ): Promise<LectureStudioArtifactActionReceipt> {
    const command = ExportLectureStudioArtifactInputSchema.parse(input);
    const platform = this.requireArtifactPlatform();
    const resolved = await this.resolveArtifactAction(command);
    this.assertArtifactFormat(resolved.revision, command.format);
    let bytes: Buffer;
    let suggestedFileName: string;
    if (command.format !== 'pdf') {
      bytes = Buffer.from(resolved.file.content, 'utf8');
      suggestedFileName = resolved.file.fileName;
    } else {
      const pdf = await this.compileResolvedArtifactPdf(resolved);
      bytes = lecturePdfExportBytes(pdf);
      suggestedFileName = command.kind === 'lecture-notes' ? 'Lecture Notes.pdf' : 'Slides.pdf';
    }
    try {
      const receipt = await platform.exportFile({
        format: command.format,
        suggestedFileName,
        bytes,
      });
      return LectureStudioArtifactActionReceiptSchema.parse({
        schemaVersion: 1,
        status: receipt.status,
        format: command.format,
        fileName: receipt.fileName,
        relativePath: resolved.file.relativePath,
      });
    } catch (error) {
      if (error instanceof LectureStudioServiceError) throw error;
      throw new LectureStudioServiceError('lecture_export_failed');
    }
  }

  async openArtifact(
    input: OpenLectureStudioArtifactInput,
  ): Promise<LectureStudioArtifactActionReceipt> {
    const command = OpenLectureStudioArtifactInputSchema.parse(input);
    const platform = this.requireArtifactPlatform();
    const resolved = await this.resolveArtifactAction(command);
    this.assertArtifactFormat(resolved.revision, command.format);
    try {
      let fileName = resolved.file.fileName;
      if (command.format !== 'pdf') {
        await platform.openExisting(resolved.file.absolutePath);
      } else {
        const pdf = await this.compileResolvedArtifactPdf(resolved);
        fileName = await platform.openPdf({ kind: command.kind, document: pdf });
      }
      return LectureStudioArtifactActionReceiptSchema.parse({
        schemaVersion: 1,
        status: 'opened',
        format: command.format,
        fileName,
        relativePath: resolved.file.relativePath,
      });
    } catch (error) {
      if (error instanceof LectureStudioServiceError) throw error;
      throw new LectureStudioServiceError('lecture_open_failed');
    }
  }

  async revealArtifact(
    input: RevealLectureStudioArtifactInput,
  ): Promise<LectureStudioArtifactActionReceipt> {
    const command = RevealLectureStudioArtifactInputSchema.parse(input);
    const platform = this.requireArtifactPlatform();
    const resolved = await this.resolveArtifactAction(command);
    try {
      await platform.revealExisting(resolved.file.absolutePath);
      return LectureStudioArtifactActionReceiptSchema.parse({
        schemaVersion: 1,
        status: 'revealed',
        format: null,
        fileName: resolved.file.fileName,
        relativePath: resolved.file.relativePath,
      });
    } catch (error) {
      if (error instanceof LectureStudioServiceError) throw error;
      throw new LectureStudioServiceError('lecture_open_failed');
    }
  }

  private requireArtifactPlatform() {
    const platform = this.dependencies.artifactPlatform;
    if (!platform) throw new LectureStudioServiceError('lecture_artifact_unavailable');
    return platform;
  }

  private assertArtifactFormat(
    revision: LectureStudioRevision,
    format: 'markdown' | 'latex' | 'pdf',
  ) {
    if (format === 'pdf') return;
    const expected = lectureRevisionFormat(revision);
    if (format !== expected) {
      throw new LectureStudioServiceError('lecture_artifact_changed');
    }
  }

  private async resolveArtifactAction(command: {
    studioId: string;
    revisionId: string;
    revision: number;
    kind: LectureStudioArtifact['kind'];
    artifactContentSha256: string;
  }) {
    const studio = await this.requireStudio(command.studioId);
    const revision = await this.dependencies.storage.getLectureStudioRevision(
      studio.id,
      command.revision,
    );
    if (
      !revision ||
      revision.id !== command.revisionId ||
      revision.revision > studio.currentRevision
    ) {
      throw new LectureStudioServiceError('lecture_artifact_not_found');
    }
    const artifact = revision.artifacts.find((candidate) => candidate.kind === command.kind);
    if (!artifact) throw new LectureStudioServiceError('lecture_artifact_not_found');
    if (artifact.contentSha256 !== command.artifactContentSha256) {
      throw new LectureStudioServiceError('lecture_artifact_changed');
    }
    try {
      const file = await this.dependencies.artifacts.resolveLectureRevisionArtifact(
        studio.outputProjectId,
        artifact,
      );
      if (file.contentSha256 !== artifact.contentSha256) {
        throw new LectureStudioServiceError('lecture_artifact_changed');
      }
      return { studio, revision, artifact, file };
    } catch (error) {
      if (error instanceof LectureStudioServiceError) throw error;
      if (
        isRecord(error) &&
        (error.code === 'research_notes_folder_conflict' ||
          error.message === 'research_notes_folder_conflict')
      ) {
        throw new LectureStudioServiceError('lecture_artifact_changed');
      }
      if (
        isRecord(error) &&
        (error.code === 'research_notes_note_not_found' ||
          error.message === 'research_notes_note_not_found')
      ) {
        throw new LectureStudioServiceError('lecture_artifact_not_found');
      }
      throw new LectureStudioServiceError('lecture_artifact_unavailable');
    }
  }

  private async compileResolvedArtifactPdf(
    resolved: Awaited<ReturnType<LectureStudioService['resolveArtifactAction']>>,
  ) {
    const compiler = this.dependencies.pdfCompiler;
    if (!compiler) throw new LectureStudioServiceError('lecture_pdf_compiler_unavailable');
    const source = lectureRevisionSource(resolved.revision, resolved.artifact.kind);
    const contentSha256 = sha256(source);
    try {
      const compiled = await compiler.compile({
        studioId: resolved.studio.id,
        revision: resolved.revision.revision,
        title: resolved.studio.title,
        kind: resolved.artifact.kind,
        markdown: source,
        contentSha256,
        sourceFormat: lectureRevisionFormat(resolved.revision),
      });
      try {
        lecturePdfExportBytes(compiled);
      } catch {
        throw new LectureStudioServiceError('lecture_pdf_invalid');
      }
      return compiled;
    } catch (error) {
      if (error instanceof LectureStudioServiceError) throw error;
      if (error instanceof LectureDocumentCompilerError) {
        throw new LectureStudioServiceError(error.code);
      }
      throw new LectureStudioServiceError('lecture_pdf_compile_failed');
    }
  }

  async cancel(input: CancelLectureStudioInput): Promise<LectureStudio> {
    const command = CancelLectureStudioInputSchema.parse(input);
    const studio = await this.requireStudio(command.studioId);
    if (studio.version !== command.expectedVersion) {
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    if (studio.status !== 'generating' || studio.activeAttemptId !== command.attemptId) {
      throw new LectureStudioServiceError('lecture_not_active');
    }
    const active = this.activeByStudio.get(studio.id);
    if (active && active.attemptId === command.attemptId) {
      active.cancelRequested = true;
      if (!active.terminal && active.threadId && active.turnId) {
        await this.dependencies.codex
          .interruptTurn(active.threadId, active.turnId)
          .catch(() => undefined);
      }
    }
    const cancelled = await this.dependencies.storage.failLectureStudioTurn({
      studioId: studio.id,
      attemptId: command.attemptId,
      errorCode: 'lecture_cancelled',
      messageStatus: 'interrupted',
      updatedAt: this.now().toISOString(),
    });
    if (!cancelled) throw new LectureStudioServiceError('lecture_version_conflict');
    this.publish(cancelled);
    return cancelled;
  }

  async runWhenProjectsIdle<T>(
    projectIds: readonly string[],
    operation: () => Promise<T>,
    requireNoStudios = false,
  ) {
    const lockedProjectIds = [...new Set(projectIds)].sort();
    if (lockedProjectIds.some((projectId) => this.lifecycleLockedProjects.has(projectId))) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    for (const projectId of lockedProjectIds) this.lifecycleLockedProjects.add(projectId);
    try {
      const targetIds = new Set(lockedProjectIds);
      const summaries = await this.dependencies.storage.listLectureStudios(true);
      const studios = await Promise.all(
        summaries.map((summary) => this.dependencies.storage.getLectureStudio(summary.id)),
      );
      const hasActiveWork = studios.some(
        (studio) =>
          studio !== null &&
          this.studioTouchesProjects(studio, targetIds) &&
          (studio.status === 'generating' || this.activeByStudio.has(studio.id)),
      );
      if (hasActiveWork) throw new LectureStudioServiceError('lecture_busy');
      if (
        requireNoStudios &&
        studios.some((studio) => studio !== null && this.studioTouchesProjects(studio, targetIds))
      ) {
        throw new LectureStudioServiceError('lecture_busy');
      }
      return await operation();
    } finally {
      for (const projectId of lockedProjectIds) this.lifecycleLockedProjects.delete(projectId);
    }
  }

  private async runTurn(request: TurnRequest): Promise<LectureStudioTurnReceipt> {
    if (this.activeByStudio.has(request.studioId)) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    const current = await this.requireStudio(request.studioId);
    this.throwIfProjectsLifecycleLocked([...current.sourceProjectIds, current.outputProjectId]);
    if (current.version !== request.expectedVersion) {
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    if (current.status === 'generating') throw new LectureStudioServiceError('lecture_busy');
    try {
      await this.dependencies.artifacts.assertRevisionDestination(current.outputProjectId);
    } catch (error) {
      throw this.normalizeArtifactError(error);
    }

    const attemptId = randomUUID();
    const startedAt = this.now().toISOString();
    const userMessage = request.message
      ? LectureStudioMessageSchema.parse({
          schemaVersion: 1,
          id: randomUUID(),
          studioId: current.id,
          role: 'user',
          status: 'complete',
          content: request.message,
          attemptId,
          revision: null,
          invocation: null,
          createdAt: startedAt,
          completedAt: startedAt,
        })
      : null;
    let generating: LectureStudio | null;
    try {
      this.throwIfProjectsLifecycleLocked([...current.sourceProjectIds, current.outputProjectId]);
      generating = await this.dependencies.storage.beginLectureStudioTurn({
        studioId: current.id,
        expectedVersion: current.version,
        attemptId,
        userMessage,
        updatedAt: startedAt,
      });
    } catch (error) {
      throw this.normalizeStorageError(error);
    }
    if (!generating) throw new LectureStudioServiceError('lecture_version_conflict');
    const active: ActiveExecution = {
      studioId: generating.id,
      attemptId,
      threadId: null,
      turnId: null,
      cancelRequested: false,
      terminal: false,
    };
    this.activeByStudio.set(generating.id, active);
    this.publish(generating);

    let threadId: string | null = null;
    let turnId: string | null = null;
    let pendingArtifactInput:
      Parameters<LectureStudioArtifactWriter['saveRevisionArtifacts']>[0] | null = null;
    try {
      const [sourceManifest, previousRevision, messages, cwd] = await Promise.all([
        this.resolveSourceManifest(
          generating.sourceProjectIds,
          generating.sourceSelection,
          generating.id,
          generating.outputProjectId,
        ),
        this.dependencies.storage.getCurrentLectureStudioRevision(generating.id),
        this.dependencies.storage.listLectureStudioMessages(generating.id, 12),
        this.dependencies.prepareDirectory(generating.outputProjectId),
      ]);
      this.throwIfCancelled(active);
      const sourceManifestSha256 = sha256(JSON.stringify(sourceManifest));
      let started: Awaited<ReturnType<LectureStudioCodex['startThread']>>;
      try {
        started = await this.dependencies.codex.startThread({
          cwd,
          modelId: request.requestedModelId,
          developerInstructions: LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS,
          responseVerbosity: 'medium',
          dynamicTools: [],
          webSearchMode: 'disabled',
        });
      } catch {
        throw new LectureStudioServiceError('lecture_codex_unavailable');
      }
      threadId = started.threadId;
      active.threadId = threadId;
      this.throwIfCancelled(active);

      const completed = new Promise<{ status: string; text: string | null }>((resolve) => {
        this.pendingByThread.set(threadId!, {
          studioId: generating.id,
          attemptId,
          threadId: threadId!,
          turnId: null,
          invocation: null,
          earlyInvocation: null,
          finalText: null,
          terminal: false,
          markActivity: null,
          disposeTimers: null,
          resolve,
        });
      });
      let running: Awaited<ReturnType<LectureStudioCodex['runTurn']>>;
      try {
        running = await this.dependencies.codex.runTurn({
          threadId,
          prompt: buildLectureStudioPrompt({
            mode: previousRevision ? 'revision' : 'initial',
            title: generating.title,
            kind: generating.kind,
            durationMinutes: generating.durationMinutes,
            generationBrief: generating.generationBrief,
            sourceManifest,
            currentDraft: previousRevision
              ? {
                  sourceFormat: previousRevision.schemaVersion === 2 ? 'latex' : 'legacy-markdown',
                  lectureNotes:
                    previousRevision.schemaVersion === 2
                      ? previousRevision.lectureNotesLatex
                      : previousRevision.lectureNotesMarkdown,
                  slides:
                    previousRevision.schemaVersion === 2
                      ? previousRevision.slidesLatex
                      : previousRevision.slidesMarkdown,
                }
              : null,
            recentMessages: messages
              .filter((message) => message.id !== userMessage?.id && message.status === 'complete')
              .map((message) => ({
                role: message.role,
                content: message.content,
              })),
            request: request.message,
          }),
          requestedModelId: request.requestedModelId,
          reasoningOptionId: request.reasoningOptionId,
          cwd,
          outputSchema: LECTURE_STUDIO_OUTPUT_SCHEMA,
        });
      } catch {
        throw new LectureStudioServiceError('lecture_codex_unavailable');
      }
      turnId = running.turnId;
      active.turnId = turnId;
      const pending = this.pendingByThread.get(threadId);
      if (!pending) throw new LectureStudioServiceError('lecture_generation_failed');
      pending.turnId = turnId;
      pending.invocation =
        pending.earlyInvocation?.turnId === turnId
          ? pending.earlyInvocation.invocation
          : running.invocation;

      const idleTimeoutMs = Math.max(
        5_000,
        Math.min(this.dependencies.timeoutMs ?? 180_000, 1_800_000),
      );
      const hardTimeoutMs = Math.max(
        idleTimeoutMs,
        Math.min(this.dependencies.hardTimeoutMs ?? 1_800_000, 1_800_000),
      );
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let hardTimer: ReturnType<typeof setTimeout> | null = null;
      let timeoutSettled = false;
      let resolveTimeout: ((result: { status: string; text: null }) => void) | null = null;
      const timeout = new Promise<{ status: string; text: null }>((resolve) => {
        resolveTimeout = resolve;
      });
      const clearGenerationTimers = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (hardTimer) clearTimeout(hardTimer);
        idleTimer = null;
        hardTimer = null;
        pending.markActivity = null;
        pending.disposeTimers = null;
      };
      const expireGeneration = () => {
        if (timeoutSettled) return;
        timeoutSettled = true;
        clearGenerationTimers();
        resolveTimeout?.({ status: 'timed_out', text: null });
      };
      const armIdleTimer = () => {
        if (timeoutSettled || pending.terminal) return;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(expireGeneration, idleTimeoutMs);
        idleTimer.unref?.();
      };
      pending.markActivity = armIdleTimer;
      pending.disposeTimers = clearGenerationTimers;
      armIdleTimer();
      hardTimer = setTimeout(expireGeneration, hardTimeoutMs);
      hardTimer.unref?.();
      void completed.then(clearGenerationTimers, clearGenerationTimers);

      for (const notification of this.bufferedByThread.get(threadId) ?? []) {
        this.processNotification(pending, notification);
      }
      this.bufferedByThread.delete(threadId);
      this.throwIfCancelled(active);

      const terminal = await Promise.race([completed, timeout]);
      if (terminal.status !== 'completed') {
        throw new LectureStudioServiceError(
          active.cancelRequested
            ? 'lecture_cancelled'
            : terminal.status === 'timed_out'
              ? 'lecture_generation_timed_out'
              : terminal.status === 'transport_failed'
                ? 'lecture_codex_unavailable'
                : 'lecture_generation_failed',
        );
      }
      active.terminal = true;
      this.throwIfCancelled(active);
      const output = this.parseOutput(terminal.text, generating, sourceManifest);
      const completedAt = this.now().toISOString();
      const revisionNumber = generating.currentRevision + 1;
      const invocation = pending.invocation ?? running.invocation;
      const lectureNotesLatex = buildLectureLatexDocument(
        'lecture-notes',
        generating.title,
        output.lectureNotesLatexBody,
      );
      const slidesLatex = buildLectureLatexDocument(
        'slides',
        generating.title,
        output.slidesLatexBody,
      );
      try {
        const compileResults = await Promise.allSettled(
          (
            [
              ['lecture-notes', lectureNotesLatex],
              ['slides', slidesLatex],
            ] as const
          ).map(([kind, source]) =>
            this.dependencies.pdfCompiler.compile({
              studioId: generating.id,
              revision: revisionNumber,
              title: generating.title,
              kind,
              markdown: source,
              contentSha256: sha256(source),
              sourceFormat: 'latex',
            }),
          ),
        );
        this.throwIfCancelled(active);
        const failedCompile = compileResults.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        if (failedCompile) throw failedCompile.reason;
      } catch (error) {
        this.throwIfCancelled(active);
        if (error instanceof LectureDocumentCompilerError) {
          throw new LectureStudioServiceError(error.code);
        }
        throw new LectureStudioServiceError('lecture_pdf_compile_failed');
      }
      const artifactInput = {
        outputProjectId: generating.outputProjectId,
        studioId: generating.id,
        studioTitle: generating.title,
        revision: revisionNumber,
        attemptId,
        sourceManifestSha256,
        documentFormat: 'latex' as const,
        lectureNotesLatex,
        slidesLatex,
        createdAt: completedAt,
        invocation,
        relatedDocuments: [],
        relatedPapers: uniqueNonEmpty(
          sourceManifest.literature
            .map((source) => canonicalDoiUrl(source.doi))
            .filter((value): value is string => value !== null),
          128,
        ),
      } as const;
      pendingArtifactInput = artifactInput;
      const artifacts = await this.saveArtifacts(artifactInput);
      const revision = LectureStudioRevisionSchema.parse({
        schemaVersion: 2,
        id: randomUUID(),
        studioId: generating.id,
        revision: revisionNumber,
        attemptId,
        sourceManifest,
        sourceManifestSha256,
        lectureNotesLatex,
        slidesLatex,
        artifacts,
        invocation,
        createdAt: completedAt,
      });
      const assistantMessage = LectureStudioMessageSchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        studioId: generating.id,
        role: 'assistant',
        status: 'complete',
        content: assistantContent(output.reply, artifacts),
        attemptId,
        revision: revisionNumber,
        invocation,
        createdAt: completedAt,
        completedAt,
      });
      const completedStudio = LectureStudioSchema.parse({
        ...generating,
        status: 'ready',
        activeAttemptId: null,
        currentRevision: revisionNumber,
        version: generating.version + 1,
        lastErrorCode: null,
        updatedAt: completedAt,
      });
      let stored: LectureStudio | null;
      try {
        stored = await this.dependencies.storage.completeLectureStudioTurn({
          studio: completedStudio,
          revision,
          assistantMessage,
        });
      } catch (error) {
        throw this.normalizeStorageError(error);
      }
      if (!stored) throw new LectureStudioServiceError('lecture_persistence_failed');
      pendingArtifactInput = null;
      await Promise.resolve(
        this.dependencies.artifacts.confirmRevisionArtifacts(artifactInput),
      ).catch(() => undefined);
      this.publish(stored);
      return LectureStudioTurnReceiptSchema.parse({
        studio: stored,
        revision,
        assistantMessage,
      });
    } catch (error) {
      if (pendingArtifactInput) {
        await Promise.resolve(
          this.dependencies.artifacts.rollbackRevisionArtifacts(pendingArtifactInput),
        ).catch(() => undefined);
      }
      const normalized = this.normalizeTurnError(error, active);
      let failed: LectureStudio | null = null;
      try {
        failed = await this.dependencies.storage.failLectureStudioTurn({
          studioId: generating.id,
          attemptId,
          errorCode: normalized.code,
          messageStatus: normalized.code === 'lecture_cancelled' ? 'interrupted' : 'failed',
          updatedAt: this.now().toISOString(),
        });
      } catch {
        // Preserve the original bounded turn failure if recovery persistence also fails.
      }
      if (failed) this.publish(failed);
      throw normalized;
    } finally {
      this.activeByStudio.delete(generating.id);
      if (threadId) {
        this.pendingByThread.get(threadId)?.disposeTimers?.();
        this.pendingByThread.delete(threadId);
        this.bufferedByThread.delete(threadId);
        if (turnId && !active.terminal) {
          await this.dependencies.codex.interruptTurn(threadId, turnId).catch(() => undefined);
        }
        await this.dependencies.codex.releaseThread(threadId).catch(() => undefined);
      }
    }
  }

  private parseOutput(
    text: string | null,
    studio: LectureStudio,
    sourceManifest: LectureSourceManifest,
  ) {
    if (!text) throw new LectureStudioServiceError('lecture_invalid_response');
    try {
      const output = LectureStudioGenerationOutputSchema.parse(JSON.parse(text) as unknown);
      const notesBody = validateLectureLatexBody('lecture-notes', output.lectureNotesLatexBody);
      const slidesBody = validateLectureLatexBody('slides', output.slidesLatexBody);
      if (
        UNSUPPORTED_CITATION_PATTERN.test(notesBody) ||
        UNSUPPORTED_CITATION_PATTERN.test(slidesBody)
      ) {
        throw new Error('unsupported_citation');
      }
      const manuscriptSources =
        sourceManifest.schemaVersion === 1 ? [] : sourceManifest.manuscripts;
      const externalSources =
        sourceManifest.schemaVersion === 3 ? sourceManifest.externalSources : [];
      const allowedLabels = new Set([
        ...sourceManifest.literature.map((source) => source.sourceLabel),
        ...sourceManifest.experiments.map((source) => source.sourceLabel),
        ...manuscriptSources.map((source) => source.sourceLabel),
        ...externalSources.map((source) => source.sourceLabel),
      ]);
      const usedLabels = new Set<string>();
      for (const latex of [notesBody, slidesBody]) {
        const citations = [...latex.matchAll(/\[((?:P|E|M|F)\d+)\]/gu)].map((match) => match[1]!);
        if (citations.length === 0 || citations.some((label) => !allowedLabels.has(label))) {
          throw new Error('invalid_source_citation');
        }
        for (const label of citations) usedLabels.add(label);
      }
      const sourcesHeading = /\\section\s*\{\s*Sources used\s*\}/iu.exec(notesBody);
      if (!sourcesHeading || sourcesHeading.index === undefined) {
        throw new Error('missing_sources_used');
      }
      const sourcesSection = notesBody.slice(sourcesHeading.index + sourcesHeading[0].length);
      if ([...usedLabels].some((label) => !sourcesSection.includes(`[${label}]`))) {
        throw new Error('incomplete_sources_used');
      }
      const slides = [
        ...slidesBody.matchAll(/\\begin\s*\{\s*frame\s*\}[\s\S]*?\\end\s*\{\s*frame\s*\}/gu),
      ].map((match) => match[0]);
      for (const slide of slides) {
        const citations = [...slide.matchAll(/\[((?:P|E|M|F)\d+)\]/gu)].map((match) => match[1]!);
        if (citations.length === 0 || citations.some((label) => !allowedLabels.has(label))) {
          throw new Error('uncited_slide');
        }
      }
      if (studio.kind === 'talk') {
        const requestedSlides = studio.generationBrief.slidesTargetPages;
        if (requestedSlides !== null && countLectureSlidePages(slidesBody) !== requestedSlides) {
          throw new Error('invalid_requested_slide_count');
        }
        const budget = talkSlideBudget(studio.durationMinutes!);
        const slideCount = countLectureSlidePages(slidesBody);
        if (
          requestedSlides === null &&
          (slideCount < budget.minimum || slideCount > budget.maximum)
        ) {
          throw new Error('invalid_talk_slide_count');
        }
      } else if (
        studio.generationBrief.slidesTargetPages !== null &&
        countLectureSlidePages(slidesBody) !== studio.generationBrief.slidesTargetPages
      ) {
        throw new Error('invalid_requested_slide_count');
      }
      return output;
    } catch {
      throw new LectureStudioServiceError('lecture_invalid_response');
    }
  }

  private async saveArtifacts(
    input: Parameters<LectureStudioArtifactWriter['saveRevisionArtifacts']>[0],
  ) {
    try {
      return await this.dependencies.artifacts.saveRevisionArtifacts(input);
    } catch (error) {
      if (
        isRecord(error) &&
        (error.code === 'research_notes_vault_not_selected' ||
          error.code === 'research_notes_folder_unavailable' ||
          error.message === 'research_notes_vault_not_selected' ||
          error.message === 'research_notes_folder_unavailable')
      ) {
        throw new LectureStudioServiceError('lecture_research_notes_required');
      }
      throw new LectureStudioServiceError('lecture_persistence_failed');
    }
  }

  private async reconcilePendingArtifactsOnce() {
    const pendingBundles = await this.dependencies.artifacts.listPendingRevisionArtifacts();
    for (const pending of pendingBundles) {
      let studio: LectureStudio | null;
      let revision: LectureStudioRevision | null;
      try {
        [studio, revision] = await Promise.all([
          this.dependencies.storage.getLectureStudio(pending.studioId),
          this.dependencies.storage.getLectureStudioRevision(pending.studioId, pending.revision),
        ]);
      } catch {
        continue;
      }

      if (
        studio?.status === 'generating' &&
        studio.activeAttemptId === pending.attemptId &&
        studio.currentRevision + 1 === pending.revision &&
        studio.outputProjectId === pending.outputProjectId
      ) {
        continue;
      }

      if (studio && revision && committedRevisionMatchesPending(studio, revision, pending)) {
        await Promise.resolve(
          this.dependencies.artifacts.confirmPendingRevisionArtifacts(pending),
        ).catch(() => undefined);
        continue;
      }

      if (
        revision &&
        revision.artifacts.some((artifact) => pendingArtifactPath(pending, artifact))
      ) {
        // A committed row references this path but its identity/hash disagrees. Preserve it for repair.
        continue;
      }
      await Promise.resolve(
        this.dependencies.artifacts.rollbackPendingRevisionArtifacts(pending),
      ).catch(() => undefined);
    }
  }

  private normalizeArtifactError(error: unknown) {
    if (
      isRecord(error) &&
      (error.code === 'research_notes_vault_not_selected' ||
        error.code === 'research_notes_folder_unavailable' ||
        error.code === 'research_notes_vault_changed' ||
        error.message === 'research_notes_vault_not_selected' ||
        error.message === 'research_notes_folder_unavailable' ||
        error.message === 'research_notes_vault_changed')
    ) {
      return new LectureStudioServiceError('lecture_research_notes_required');
    }
    return new LectureStudioServiceError('lecture_persistence_failed');
  }

  private normalizeStorageError(error: unknown) {
    if (error instanceof LectureStudioStorageError && error.code === 'capacity_reached') {
      return new LectureStudioServiceError('lecture_capacity_reached');
    }
    return new LectureStudioServiceError('lecture_persistence_failed');
  }

  private normalizeTurnError(error: unknown, active: ActiveExecution) {
    if (active.cancelRequested) return new LectureStudioServiceError('lecture_cancelled');
    if (error instanceof LectureStudioServiceError) return error;
    if (
      error instanceof Error &&
      (error.message === 'lecture_studio_prompt_budget_exceeded' ||
        error.message === 'lecture_studio_source_context_too_large')
    ) {
      return new LectureStudioServiceError('lecture_context_too_large');
    }
    if (
      isRecord(error) &&
      (error.code === 'research_notes_vault_not_selected' ||
        error.code === 'research_notes_folder_unavailable' ||
        error.message === 'research_notes_vault_not_selected')
    ) {
      return new LectureStudioServiceError('lecture_research_notes_required');
    }
    return new LectureStudioServiceError('lecture_generation_failed');
  }

  private throwIfCancelled(active: ActiveExecution) {
    if (active.cancelRequested) throw new LectureStudioServiceError('lecture_cancelled');
  }

  private async requireStudio(studioId: string) {
    const studio = await this.dependencies.storage.getLectureStudio(studioId);
    if (!studio) throw new LectureStudioServiceError('lecture_studio_not_found');
    if (studio.trashedAt) throw new LectureStudioServiceError('lecture_studio_trashed');
    return LectureStudioSchema.parse(studio);
  }

  private async requireActiveProjects(projectIds: readonly string[]) {
    const snapshot = await this.dependencies.workspace.snapshot();
    const byId = new Map(snapshot.projects.map((project) => [project.id, project]));
    const projects: ProjectRecord[] = [];
    for (const projectId of projectIds) {
      const project = byId.get(projectId);
      if (!project || project.archivedAt || project.trashedAt) {
        throw new LectureStudioServiceError('lecture_source_not_found');
      }
      projects.push(project);
    }
    return projects;
  }

  private async resolveSourceManifest(
    projectIds: readonly string[],
    selection: LectureSourceSelection,
    studioId?: string,
    outputProjectId?: string,
  ): Promise<LectureSourceManifest> {
    const activeProjects = await this.requireActiveProjects(projectIds);
    const projects = new Map(activeProjects.map((project) => [project.id, project]));
    const records = new Map<string, LiteratureRecord>();
    const ideas = new Map<string, ExperimentIdea>();
    const metricsByIdea = new Map<string, ExperimentMetricPoint[]>();
    const manuscriptExtractBudgetByIdentity = new Map<string, number>();
    const externalSelection = selection.externalSources;
    if (
      externalSelection &&
      (!studioId || !outputProjectId || !projectIds.includes(outputProjectId))
    ) {
      throw new LectureStudioServiceError('lecture_source_conflict');
    }
    const externalSources = externalSelection
      ? await this.dependencies.externalSources
          .snapshots({
            projectId: outputProjectId!,
            studioId: studioId!,
            sourceIds: externalSelection.sourceIds,
          })
          .catch(() => {
            throw new LectureStudioServiceError('lecture_source_conflict');
          })
      : [];
    const externalExtractJsonCharacters = externalSources.reduce(
      (total, source) => total + JSON.stringify(source.extraction.content).length,
      0,
    );
    const manuscriptTotalExtractBudget = Math.max(
      0,
      LECTURE_MANUSCRIPT_TOTAL_EXTRACT_MAX_JSON_CHARACTERS - externalExtractJsonCharacters,
    );
    if (
      selection.manuscripts.length > 0 &&
      manuscriptTotalExtractBudget < selection.manuscripts.length * JSON.stringify('').length
    ) {
      throw new LectureStudioServiceError('lecture_context_too_large');
    }
    if (selection.manuscripts.length > 0) {
      const fairShare = Math.floor(manuscriptTotalExtractBudget / selection.manuscripts.length);
      let remainder = manuscriptTotalExtractBudget - fairShare * selection.manuscripts.length;
      for (const reference of selection.manuscripts) {
        manuscriptExtractBudgetByIdentity.set(
          `${reference.projectId}:${reference.manuscriptId}`,
          fairShare + (remainder-- > 0 ? 1 : 0),
        );
      }
    }
    const manuscripts = new Map<
      string,
      Awaited<ReturnType<LectureStudioService['resolveManuscriptSource']>>
    >();
    await Promise.all(
      activeProjects.map(async (project) => {
        const recordIds = selection.literature
          .filter((reference) => reference.projectId === project.id)
          .map((reference) => reference.recordId);
        const ideaIds = selection.experiments
          .filter((reference) => reference.projectId === project.id)
          .map((reference) => reference.ideaId);
        const manuscriptIds = selection.manuscripts
          .filter((reference) => reference.projectId === project.id)
          .map((reference) => reference.manuscriptId);
        const [projectRecords, projectIdeas, projectMetricTails, projectManuscripts] =
          await Promise.all([
            recordIds.length > 0
              ? this.dependencies.sources.getLiteratureRecordsByIds(project.id, recordIds)
              : Promise.resolve([]),
            Promise.all(
              ideaIds.map((ideaId) =>
                this.dependencies.sources.getExperimentIdea(project.id, ideaId),
              ),
            ),
            ideaIds.length > 0
              ? this.dependencies.sources.listExperimentMetricTails({
                  projectId: project.id,
                  ideaIds,
                  perIdeaLimit: LECTURE_STUDIO_MAX_METRICS_PER_IDEA,
                })
              : Promise.resolve([]),
            Promise.all(
              manuscriptIds.map((manuscriptId) => {
                const identity = `${project.id}:${manuscriptId}`;
                const extractBudget = manuscriptExtractBudgetByIdentity.get(identity);
                if (extractBudget === undefined) {
                  throw new LectureStudioServiceError('lecture_source_conflict');
                }
                return this.resolveManuscriptSource(project.id, manuscriptId, extractBudget);
              }),
            ),
          ]);
        const expectedRecordIds = new Set(recordIds);
        for (const record of projectRecords) {
          if (record.projectId !== project.id || !expectedRecordIds.has(record.id)) {
            throw new LectureStudioServiceError('lecture_source_conflict');
          }
          records.set(`${project.id}:${record.id}`, record);
        }
        if (recordIds.some((recordId) => !records.has(`${project.id}:${recordId}`))) {
          throw new LectureStudioServiceError('lecture_source_not_found');
        }
        for (const [index, idea] of projectIdeas.entries()) {
          if (!idea) throw new LectureStudioServiceError('lecture_source_not_found');
          const expectedIdeaId = ideaIds[index]!;
          if (idea.projectId !== project.id || idea.id !== expectedIdeaId) {
            throw new LectureStudioServiceError('lecture_source_conflict');
          }
          ideas.set(`${project.id}:${idea.id}`, idea);
        }
        const selectedIdeaIds = new Set(ideaIds);
        const returnedMetricIdeaIds = new Set<string>();
        for (const tail of projectMetricTails) {
          if (!selectedIdeaIds.has(tail.ideaId) || returnedMetricIdeaIds.has(tail.ideaId)) {
            throw new LectureStudioServiceError('lecture_source_conflict');
          }
          returnedMetricIdeaIds.add(tail.ideaId);
          const points = [...tail.metricPoints].sort(
            (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
          );
          if (
            points.length > LECTURE_STUDIO_MAX_METRICS_PER_IDEA ||
            tail.metricPointTotal < points.length ||
            points.some((point) => point.projectId !== project.id || point.ideaId !== tail.ideaId)
          ) {
            throw new LectureStudioServiceError('lecture_source_conflict');
          }
          metricsByIdea.set(`${project.id}:${tail.ideaId}`, points);
        }
        for (const [index, manuscript] of projectManuscripts.entries()) {
          const manuscriptId = manuscriptIds[index]!;
          if (
            manuscript.projectId !== project.id ||
            manuscript.manuscriptId !== manuscriptId ||
            manuscripts.has(`${project.id}:${manuscriptId}`)
          ) {
            throw new LectureStudioServiceError('lecture_source_conflict');
          }
          manuscripts.set(`${project.id}:${manuscriptId}`, manuscript);
        }
      }),
    );
    const literature = selection.literature.map((reference, index) => {
      const project = projects.get(reference.projectId);
      const record = records.get(`${reference.projectId}:${reference.recordId}`);
      if (!project || !record) throw new LectureStudioServiceError('lecture_source_not_found');
      if (record.reviewStatus === 'excluded') {
        throw new LectureStudioServiceError('lecture_source_conflict');
      }
      return {
        sourceLabel: `P${index + 1}`,
        projectId: project.id,
        projectName: project.name,
        recordId: record.id,
        recordVersion: record.version,
        annotationVersion: record.annotationVersion,
        title: record.title,
        authors: record.authors,
        containerTitle: record.containerTitle,
        publishedYear: record.publishedYear,
        doi: record.doi,
        citationKey: record.citationKey.trim() || null,
        reviewStatus: record.reviewStatus,
        topics: uniqueNonEmpty(
          [
            ...record.manualAnnotations.topics,
            ...record.sourceTopics,
            ...(record.aiAnnotations?.topics ?? []),
          ],
          40,
        ),
        metadataSummary: (
          record.manualAnnotations.summary.trim() ||
          record.aiAnnotations?.summary.trim() ||
          ''
        ).slice(0, 1_200),
        metadataOnly: true as const,
      };
    });
    const experiments = selection.experiments.map((reference, index) => {
      const project = projects.get(reference.projectId);
      const idea = ideas.get(`${reference.projectId}:${reference.ideaId}`);
      if (!project || !idea) {
        throw new LectureStudioServiceError('lecture_source_not_found');
      }
      return {
        sourceLabel: `E${index + 1}`,
        projectId: project.id,
        projectName: project.name,
        ideaId: idea.id,
        ideaVersion: idea.version,
        parentIdeaId: idea.parentIdeaId,
        title: idea.title,
        hypothesis: idea.hypothesis,
        phase: idea.phase,
        outcome: idea.outcome,
        resultSummary: idea.resultSummary,
        metrics: (metricsByIdea.get(`${reference.projectId}:${reference.ideaId}`) ?? [])
          .slice()
          .sort((left, right) => left.sequence - right.sequence)
          .slice(-LECTURE_STUDIO_MAX_METRICS_PER_IDEA)
          .map((point) => ({
            sequence: point.sequence,
            objectiveId: point.objectiveId,
            objectiveVersion: point.objectiveVersion,
            metricKey: point.metricKey,
            metricDisplayName: point.metricDisplayName,
            direction: point.direction,
            unit: point.unit,
            aggregation: point.aggregation,
            evaluatorHash: point.evaluatorHash,
            datasetHash: point.datasetHash,
            holdoutHash: point.holdoutHash,
            baseline: point.baseline,
            target: point.target,
            value: point.value,
            trialId: point.trialId,
            recordedAt: point.recordedAt,
          })),
      };
    });
    const manuscriptSources = selection.manuscripts.map((reference, index) => {
      const project = projects.get(reference.projectId);
      const manuscript = manuscripts.get(`${reference.projectId}:${reference.manuscriptId}`);
      if (!project || !manuscript) {
        throw new LectureStudioServiceError('lecture_source_not_found');
      }
      return {
        sourceLabel: `M${index + 1}`,
        projectName: project.name,
        ...manuscript,
      };
    });
    const manuscriptExtractJsonCharacters = manuscriptSources.reduce(
      (sourceTotal, manuscript) =>
        sourceTotal +
        manuscript.files.reduce(
          (fileTotal, file) => fileTotal + JSON.stringify(file.content).length,
          0,
        ),
      0,
    );
    if (manuscriptExtractJsonCharacters > manuscriptTotalExtractBudget) {
      throw new LectureStudioServiceError('lecture_context_too_large');
    }
    let manifest: LectureSourceManifest;
    try {
      manifest = LectureSourceManifestSchema.parse({
        // Keep historical non-file revisions on v1 and captured-manuscript-only revisions on v2.
        // External frozen files opt into v3 without changing either earlier manifest hash format.
        schemaVersion: externalSources.length > 0 ? 3 : manuscriptSources.length > 0 ? 2 : 1,
        selectedProjectIds: projectIds,
        literature,
        experiments,
        ...(manuscriptSources.length > 0 ? { manuscripts: manuscriptSources } : {}),
        ...(externalSources.length > 0 ? { manuscripts: manuscriptSources, externalSources } : {}),
      });
    } catch {
      throw new LectureStudioServiceError('lecture_source_conflict');
    }
    if (JSON.stringify(manifest).length > LECTURE_STUDIO_SOURCE_MANIFEST_MAX_CHARACTERS) {
      throw new LectureStudioServiceError('lecture_context_too_large');
    }
    return manifest;
  }

  private async resolveManuscriptSource(
    projectId: string,
    manuscriptId: string,
    extractJsonCharacterBudget: number,
  ) {
    try {
      const snapshot = await this.dependencies.manuscripts.list({ projectId });
      if (snapshot.projectId !== projectId) {
        throw new LectureStudioServiceError('lecture_source_conflict');
      }
      const item = snapshot.manuscripts.find(
        (candidate) =>
          candidate.manuscript.id === manuscriptId && candidate.manuscript.projectId === projectId,
      );
      if (!item) throw new LectureStudioServiceError('lecture_source_not_found');
      const { manuscript, connection } = item;
      const checkpoint =
        connection?.binding.enabled === true &&
        connection.binding.projectId === projectId &&
        connection.binding.manuscriptId === manuscriptId &&
        connection.lastCheckpoint?.bindingId === connection.binding.bindingId &&
        connection.lastCheckpoint.projectId === projectId &&
        connection.lastCheckpoint.manuscriptId === manuscriptId &&
        connection.lastCheckpoint.providerId === connection.binding.providerId &&
        connection.lastCheckpoint.rootDocument === manuscript.rootDocument
          ? connection.lastCheckpoint
          : null;
      if (!connection || !checkpoint) {
        throw new LectureStudioServiceError('lecture_source_not_found');
      }

      const fileList = await this.dependencies.manuscripts.listCheckpointFiles({
        projectId,
        manuscriptId,
        checkpointId: checkpoint.checkpointId,
      });
      if (
        fileList.projectId !== projectId ||
        fileList.manuscriptId !== manuscriptId ||
        fileList.checkpointId !== checkpoint.checkpointId ||
        fileList.providerRevision !== (checkpoint.providerRevision ?? checkpoint.sourceRevision)
      ) {
        throw new LectureStudioServiceError('lecture_source_conflict');
      }
      const sourceFiles = fileList.files
        .filter(
          ({ relativePath, textReadable }) =>
            textReadable && LECTURE_MANUSCRIPT_SOURCE_PATH_PATTERN.test(relativePath),
        )
        .sort((left, right) => {
          if (left.relativePath === manuscript.rootDocument) return -1;
          if (right.relativePath === manuscript.rootDocument) return 1;
          return left.relativePath.localeCompare(right.relativePath, 'en-US');
        });
      if (
        sourceFiles.length === 0 ||
        sourceFiles.length > LECTURE_STUDIO_MAX_MANUSCRIPT_FILES ||
        new Set(sourceFiles.map(({ relativePath }) => relativePath)).size !== sourceFiles.length ||
        !sourceFiles.some(({ relativePath }) => relativePath === manuscript.rootDocument)
      ) {
        throw new LectureStudioServiceError('lecture_context_too_large');
      }

      const fullFiles: Array<{ relativePath: string; content: string }> = [];
      let totalSourceCharacters = 0;
      for (const { relativePath } of sourceFiles) {
        const chunks: string[] = [];
        let offset = 0;
        for (;;) {
          const chunk = await this.dependencies.manuscripts.readCheckpointFile({
            projectId,
            manuscriptId,
            checkpointId: checkpoint.checkpointId,
            relativePath,
            offset,
            maxCharacters: LECTURE_MANUSCRIPT_FILE_MAX_CHARACTERS,
          });
          if (
            chunk.projectId !== projectId ||
            chunk.manuscriptId !== manuscriptId ||
            chunk.checkpointId !== checkpoint.checkpointId ||
            chunk.providerRevision !== fileList.providerRevision ||
            chunk.relativePath !== relativePath ||
            chunk.offset !== offset ||
            chunk.nextOffset !== offset + chunk.content.length ||
            (chunk.truncated && chunk.nextOffset <= offset)
          ) {
            throw new LectureStudioServiceError('lecture_source_conflict');
          }
          chunks.push(chunk.content);
          totalSourceCharacters += chunk.content.length;
          if (totalSourceCharacters > 2_000_000) {
            throw new LectureStudioServiceError('lecture_context_too_large');
          }
          offset = chunk.nextOffset;
          if (!chunk.truncated) break;
        }
        fullFiles.push({ relativePath, content: chunks.join('') });
      }

      let remainingExtractJsonCharacters = extractJsonCharacterBudget;
      if (remainingExtractJsonCharacters < fullFiles.length * JSON.stringify('').length) {
        throw new LectureStudioServiceError('lecture_context_too_large');
      }
      const files = fullFiles.map(({ relativePath, content }, index) => {
        // Files are root-first. Give the current file every remaining byte after reserving the
        // smallest valid JSON string for each later file, so provenance stays complete without
        // allowing a large bibliography to steal another manuscript's fair source share.
        const futureMinimum = (fullFiles.length - index - 1) * JSON.stringify('').length;
        const availableJsonCharacters = remainingExtractJsonCharacters - futureMinimum;
        const perFileMaximum =
          relativePath === manuscript.rootDocument
            ? LECTURE_MANUSCRIPT_FILE_EXTRACT_MAX_CHARACTERS
            : LECTURE_MANUSCRIPT_FILE_MAX_CHARACTERS;
        const extracted = boundedExactFileExtractToJsonBudget(
          content,
          Math.min(availableJsonCharacters, perFileMaximum),
        );
        remainingExtractJsonCharacters -= JSON.stringify(extracted).length;
        return {
          relativePath,
          contentSha256: sha256(content),
          totalCharacters: content.length,
          contentComplete: extracted.length === content.length,
          extractionPolicyVersion: 1 as const,
          content: extracted,
        };
      });
      return {
        projectId,
        manuscriptId,
        manuscriptVersion: manuscript.version,
        title: manuscript.title,
        rootDocument: manuscript.rootDocument,
        checkpointId: checkpoint.checkpointId,
        providerId: checkpoint.providerId,
        providerRevision: checkpoint.providerRevision ?? checkpoint.sourceRevision,
        revisionEnvelopeDigest: checkpoint.revisionEnvelopeDigest,
        observedAt: checkpoint.observedAt,
        files,
        contentKind: 'captured_latex' as const,
        metadataOnly: false as const,
      };
    } catch (error) {
      if (error instanceof LectureStudioServiceError) throw error;
      throw new LectureStudioServiceError('lecture_source_conflict');
    }
  }

  private publish(studio: LectureStudio) {
    const event = LectureStudioEventSchema.parse({
      schemaVersion: 1,
      type: 'lecture.studio.changed',
      studioId: studio.id,
      status: studio.status,
      version: studio.version,
      occurredAt: studio.updatedAt,
    });
    for (const listener of this.listeners) listener(event);
  }

  private throwIfProjectsLifecycleLocked(projectIds: readonly string[]) {
    if (projectIds.some((projectId) => this.lifecycleLockedProjects.has(projectId))) {
      throw new LectureStudioServiceError('lecture_busy');
    }
  }

  private studioTouchesProjects(studio: LectureStudio, projectIds: ReadonlySet<string>) {
    return (
      projectIds.has(studio.outputProjectId) ||
      studio.sourceProjectIds.some((projectId) => projectIds.has(projectId))
    );
  }

  private now() {
    return this.dependencies.now?.() ?? new Date();
  }

  private routeNotification(notification: CodexNotification) {
    const identity = notificationIdentity(notification);
    if (!identity) return;
    const pending = this.pendingByThread.get(identity.threadId);
    if (!pending) return;
    if (pending.turnId === null) {
      const buffered = this.bufferedByThread.get(identity.threadId) ?? [];
      if (buffered.length < 100) buffered.push(notification);
      this.bufferedByThread.set(identity.threadId, buffered);
      return;
    }
    if (pending.turnId !== identity.turnId) return;
    this.processNotification(pending, notification);
  }

  private processNotification(pending: PendingTurn, notification: CodexNotification) {
    if (pending.terminal || !isRecord(notification.params)) return;
    const identity = notificationIdentity(notification);
    if (!identity || identity.threadId !== pending.threadId || identity.turnId !== pending.turnId) {
      return;
    }
    pending.markActivity?.();
    if (notification.method === 'item/completed') {
      const item = notification.params.item;
      if (
        isRecord(item) &&
        item.type === 'agentMessage' &&
        item.phase !== 'commentary' &&
        typeof item.text === 'string'
      ) {
        pending.finalText = item.text;
      }
      return;
    }
    if (notification.method !== 'turn/completed') return;
    const turn = notification.params.turn;
    pending.terminal = true;
    pending.resolve({
      status: isRecord(turn) && typeof turn.status === 'string' ? turn.status : 'failed',
      text: pending.finalText,
    });
  }
}
