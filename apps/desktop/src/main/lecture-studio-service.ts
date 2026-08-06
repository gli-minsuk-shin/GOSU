import { createHash, randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';

import {
  CancelLectureStudioInputSchema,
  CreateLectureStudioInputSchema,
  GenerateLectureStudioInputSchema,
  LECTURE_STUDIO_MAX_MESSAGE_LENGTH,
  LECTURE_STUDIO_OUTPUT_SCHEMA,
  LectureSourceCandidatesSchema,
  LectureSourceManifestSchema,
  LectureStudioDetailInputSchema,
  LectureStudioDetailSchema,
  LectureStudioEventSchema,
  LectureStudioGenerationOutputSchema,
  LectureStudioListSnapshotSchema,
  LectureStudioMessageSchema,
  LectureStudioRevisionSchema,
  LectureStudioSchema,
  LectureStudioTurnReceiptSchema,
  ListLectureCandidatesInputSchema,
  ListLectureStudiosInputSchema,
  SendLectureStudioMessageInputSchema,
  type CancelLectureStudioInput,
  type CreateLectureStudioInput,
  type GenerateLectureStudioInput,
  type LectureSourceCandidates,
  type LectureSourceManifest,
  type LectureSourceSelection,
  type LectureStudio,
  type LectureStudioArtifact,
  type LectureStudioDetail,
  type LectureStudioDetailInput,
  type LectureStudioEvent,
  type LectureStudioListSnapshot,
  type LectureStudioMessage,
  type LectureStudioRevision,
  type LectureStudioSummary,
  type LectureStudioTurnReceipt,
  type ListLectureCandidatesInput,
  type ListLectureStudiosInput,
  type PendingLectureRevisionArtifacts,
  type SendLectureStudioMessageInput,
} from '../shared/lecture-studio-contracts';
import type {
  ExperimentIdea,
  ExperimentMetricPoint,
} from '../shared/experiment-workspace-contracts';
import type { LiteratureRecord } from '../shared/literature-contracts';
import type { ProjectRecord, WorkspaceSnapshot } from '../shared/workspace-contracts';
import {
  LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS,
  LECTURE_STUDIO_SOURCE_MANIFEST_MAX_CHARACTERS,
  buildLectureStudioPrompt,
  talkSlideBudget,
} from './lecture-studio-prompt';
import { LectureStudioStorageError } from './lecture-studio-storage-error';

type MaybePromise<T> = T | Promise<T>;
type CodexNotification = Readonly<{ method?: string; params?: unknown }>;

export type LectureExperimentMetricTail = Readonly<{
  ideaId: string;
  metricPoints: readonly ExperimentMetricPoint[];
  metricPointTotal: number;
}>;

export interface LectureStudioStorage {
  listLectureStudios(): MaybePromise<readonly LectureStudioSummary[]>;
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
      lectureNotesMarkdown: string;
      slidesMarkdown: string;
      createdAt: string;
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
      | 'lecture_invalid_response'
      | 'lecture_persistence_failed'
      | 'lecture_capacity_reached'
      | 'lecture_cancelled',
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
const RAW_HTML_PATTERN = /<\s*(?:!--|\/?\s*[A-Za-z][^>]*>)/u;
const MARKDOWN_IMAGE_PATTERN = /!\s*\[/u;
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
  private readonly listeners = new Set<(event: LectureStudioEvent) => void>();
  private pendingArtifactReconciliation: Promise<void> | null = null;

  constructor(
    private readonly dependencies: Readonly<{
      storage: LectureStudioStorage;
      sources: LectureStudioSourceStorage;
      workspace: LectureStudioWorkspace;
      artifacts: LectureStudioArtifactWriter;
      codex: LectureStudioCodex;
      prepareDirectory: (outputProjectId: string) => Promise<string>;
      now?: () => Date;
      timeoutMs?: number;
    }>,
  ) {
    dependencies.codex.on('notification', (notification: CodexNotification) => {
      this.routeNotification(notification);
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
        if (pending.turnId === event.turnId) pending.invocation = event.invocation;
      },
    );
  }

  onEvent(listener: (event: LectureStudioEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async list(input: ListLectureStudiosInput): Promise<LectureStudioListSnapshot> {
    ListLectureStudiosInputSchema.parse(input);
    await this.reconcilePendingArtifacts().catch(() => undefined);
    const studios = await this.dependencies.storage.listLectureStudios();
    return LectureStudioListSnapshotSchema.parse({ schemaVersion: 1, studios });
  }

  async detail(input: LectureStudioDetailInput): Promise<LectureStudioDetail> {
    const command = LectureStudioDetailInputSchema.parse(input);
    await this.reconcilePendingArtifacts().catch(() => undefined);
    const detail = await this.dependencies.storage.getLectureStudioDetail(command.studioId);
    if (!detail) throw new LectureStudioServiceError('lecture_studio_not_found');
    return LectureStudioDetailSchema.parse(detail);
  }

  async candidates(input: ListLectureCandidatesInput): Promise<LectureSourceCandidates> {
    const command = ListLectureCandidatesInputSchema.parse(input);
    const projects = await this.requireActiveProjects(command.projectIds);
    const candidates = await Promise.all(
      projects.map(async (project) => {
        const [literatureRecords, ideas] = await Promise.all([
          this.dependencies.sources.listLiteratureRecords(project.id),
          this.dependencies.sources.listExperimentIdeas(project.id),
        ]);
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
    await this.resolveSourceManifest(command.sourceProjectIds, command.sourceSelection);
    const now = this.now().toISOString();
    const studio = LectureStudioSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
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
      throw this.normalizeStorageError(error);
    }
    if (!created) throw new LectureStudioServiceError('lecture_persistence_failed');
    this.publish(studio);
    return studio;
  }

  async generate(input: GenerateLectureStudioInput): Promise<LectureStudioTurnReceipt> {
    const command = GenerateLectureStudioInputSchema.parse(input);
    return this.runTurn({ ...command, message: null });
  }

  async send(input: SendLectureStudioMessageInput): Promise<LectureStudioTurnReceipt> {
    const command = SendLectureStudioMessageInputSchema.parse(input);
    return this.runTurn(command);
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
      if (active.terminal) throw new LectureStudioServiceError('lecture_not_active');
      active.cancelRequested = true;
      if (active.threadId && active.turnId) {
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

  private async runTurn(request: TurnRequest): Promise<LectureStudioTurnReceipt> {
    if (this.activeByStudio.has(request.studioId)) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    const current = await this.requireStudio(request.studioId);
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
        this.resolveSourceManifest(generating.sourceProjectIds, generating.sourceSelection),
        this.dependencies.storage.getCurrentLectureStudioRevision(generating.id),
        this.dependencies.storage.listLectureStudioMessages(generating.id, 12),
        this.dependencies.prepareDirectory(generating.outputProjectId),
      ]);
      this.throwIfCancelled(active);
      const sourceManifestSha256 = sha256(JSON.stringify(sourceManifest));
      const started = await this.dependencies.codex.startThread({
        cwd,
        modelId: request.requestedModelId,
        developerInstructions: LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS,
        responseVerbosity: 'medium',
        dynamicTools: [],
        webSearchMode: 'disabled',
      });
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
          resolve,
        });
      });
      const running = await this.dependencies.codex.runTurn({
        threadId,
        prompt: buildLectureStudioPrompt({
          mode: previousRevision ? 'revision' : 'initial',
          title: generating.title,
          kind: generating.kind,
          durationMinutes: generating.durationMinutes,
          sourceManifest,
          currentDraft: previousRevision
            ? {
                lectureNotesMarkdown: previousRevision.lectureNotesMarkdown,
                slidesMarkdown: previousRevision.slidesMarkdown,
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
      turnId = running.turnId;
      active.turnId = turnId;
      const pending = this.pendingByThread.get(threadId);
      if (!pending) throw new LectureStudioServiceError('lecture_codex_unavailable');
      pending.turnId = turnId;
      pending.invocation =
        pending.earlyInvocation?.turnId === turnId
          ? pending.earlyInvocation.invocation
          : running.invocation;
      for (const notification of this.bufferedByThread.get(threadId) ?? []) {
        this.processNotification(pending, notification);
      }
      this.bufferedByThread.delete(threadId);
      this.throwIfCancelled(active);

      const timeoutMs = Math.max(5_000, Math.min(this.dependencies.timeoutMs ?? 180_000, 300_000));
      const terminal = await Promise.race([
        completed,
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(
            () => reject(new LectureStudioServiceError('lecture_codex_unavailable')),
            timeoutMs,
          );
          timer.unref?.();
          void completed.finally(() => clearTimeout(timer));
        }),
      ]);
      if (terminal.status !== 'completed') {
        throw new LectureStudioServiceError(
          active.cancelRequested ? 'lecture_cancelled' : 'lecture_codex_unavailable',
        );
      }
      active.terminal = true;
      this.throwIfCancelled(active);
      const output = this.parseOutput(terminal.text, generating, sourceManifest);
      const completedAt = this.now().toISOString();
      const revisionNumber = generating.currentRevision + 1;
      const artifactInput = {
        outputProjectId: generating.outputProjectId,
        studioId: generating.id,
        studioTitle: generating.title,
        revision: revisionNumber,
        attemptId,
        sourceManifestSha256,
        lectureNotesMarkdown: output.lectureNotesMarkdown,
        slidesMarkdown: output.slidesMarkdown,
        createdAt: completedAt,
      } as const;
      pendingArtifactInput = artifactInput;
      const artifacts = await this.saveArtifacts(artifactInput);
      const invocation = pending.invocation ?? running.invocation;
      const revision = LectureStudioRevisionSchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        studioId: generating.id,
        revision: revisionNumber,
        attemptId,
        sourceManifest,
        sourceManifestSha256,
        lectureNotesMarkdown: output.lectureNotesMarkdown,
        slidesMarkdown: output.slidesMarkdown,
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
      if (
        RAW_HTML_PATTERN.test(output.lectureNotesMarkdown) ||
        RAW_HTML_PATTERN.test(output.slidesMarkdown) ||
        MARKDOWN_IMAGE_PATTERN.test(output.lectureNotesMarkdown) ||
        MARKDOWN_IMAGE_PATTERN.test(output.slidesMarkdown) ||
        UNSUPPORTED_CITATION_PATTERN.test(output.lectureNotesMarkdown) ||
        UNSUPPORTED_CITATION_PATTERN.test(output.slidesMarkdown) ||
        !/^#\s+\S/mu.test(output.lectureNotesMarkdown) ||
        !/^#\s+\S/mu.test(output.slidesMarkdown)
      ) {
        throw new Error('unsafe_or_unstructured_markdown');
      }
      const allowedLabels = new Set([
        ...sourceManifest.literature.map((source) => source.sourceLabel),
        ...sourceManifest.experiments.map((source) => source.sourceLabel),
      ]);
      const usedLabels = new Set<string>();
      for (const markdown of [output.lectureNotesMarkdown, output.slidesMarkdown]) {
        const citations = [...markdown.matchAll(/\[((?:P|E)\d+)\]/gu)].map((match) => match[1]!);
        if (citations.length === 0 || citations.some((label) => !allowedLabels.has(label))) {
          throw new Error('invalid_source_citation');
        }
        for (const label of citations) usedLabels.add(label);
      }
      const sourcesHeading = /^#{1,6}\s+Sources used\s*$/imu.exec(output.lectureNotesMarkdown);
      if (!sourcesHeading || sourcesHeading.index === undefined) {
        throw new Error('missing_sources_used');
      }
      const sourcesSection = output.lectureNotesMarkdown.slice(
        sourcesHeading.index + sourcesHeading[0].length,
      );
      if ([...usedLabels].some((label) => !sourcesSection.includes(`[${label}]`))) {
        throw new Error('incomplete_sources_used');
      }
      const slides = output.slidesMarkdown
        .split(/^\s*---\s*$/mu)
        .filter((slide) => slide.trim().length > 0);
      for (const slide of slides.slice(1)) {
        const citations = [...slide.matchAll(/\[((?:P|E)\d+)\]/gu)].map((match) => match[1]!);
        if (citations.length === 0 || citations.some((label) => !allowedLabels.has(label))) {
          throw new Error('uncited_slide');
        }
      }
      if (studio.kind === 'talk') {
        const budget = talkSlideBudget(studio.durationMinutes!);
        const slideCount = slides.length;
        if (slideCount < budget.minimum || slideCount > budget.maximum) {
          throw new Error('invalid_talk_slide_count');
        }
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
    return new LectureStudioServiceError('lecture_codex_unavailable');
  }

  private throwIfCancelled(active: ActiveExecution) {
    if (active.cancelRequested) throw new LectureStudioServiceError('lecture_cancelled');
  }

  private async requireStudio(studioId: string) {
    const studio = await this.dependencies.storage.getLectureStudio(studioId);
    if (!studio) throw new LectureStudioServiceError('lecture_studio_not_found');
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
  ): Promise<LectureSourceManifest> {
    const activeProjects = await this.requireActiveProjects(projectIds);
    const projects = new Map(activeProjects.map((project) => [project.id, project]));
    const records = new Map<string, LiteratureRecord>();
    const ideas = new Map<string, ExperimentIdea>();
    const metricsByIdea = new Map<string, ExperimentMetricPoint[]>();
    await Promise.all(
      activeProjects.map(async (project) => {
        const recordIds = selection.literature
          .filter((reference) => reference.projectId === project.id)
          .map((reference) => reference.recordId);
        const ideaIds = selection.experiments
          .filter((reference) => reference.projectId === project.id)
          .map((reference) => reference.ideaId);
        const [projectRecords, projectIdeas, projectMetricTails] = await Promise.all([
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
    let manifest: LectureSourceManifest;
    try {
      manifest = LectureSourceManifestSchema.parse({
        schemaVersion: 1,
        selectedProjectIds: projectIds,
        literature,
        experiments,
      });
    } catch {
      throw new LectureStudioServiceError('lecture_source_conflict');
    }
    if (JSON.stringify(manifest).length > LECTURE_STUDIO_SOURCE_MANIFEST_MAX_CHARACTERS) {
      throw new LectureStudioServiceError('lecture_context_too_large');
    }
    return manifest;
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
