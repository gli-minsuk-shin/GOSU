import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LectureStudioService,
  LectureStudioServiceError,
  type LectureStudioStorage,
} from '../src/main/lecture-studio-service';
import { LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS } from '../src/main/lecture-studio-prompt';
import {
  LectureDocumentCompilerError,
  type LectureDocumentCompiler,
} from '../src/main/lecture-document-compiler';
import type { LectureArtifactPlatform } from '../src/main/lecture-artifact-platform';
import { LectureStudioStorageError } from '../src/main/lecture-studio-storage-error';
import type {
  LectureStudio,
  LectureStudioDetail,
  LectureStudioMessage,
  LectureStudioRevision,
  EmptyLectureStudioTrashInput,
  EmptyLectureStudioTrashReceipt,
  PendingLectureRevisionArtifacts,
} from '../src/shared/lecture-studio-contracts';
import type { LiteratureRecord } from '../src/shared/literature-contracts';
import type {
  ExperimentIdea,
  ExperimentMetricPoint,
} from '../src/shared/experiment-workspace-contracts';
import type { WorkspaceSnapshot } from '../src/shared/workspace-contracts';
import type { ManuscriptWorkspaceSnapshot } from '../src/shared/manuscript-workspace-contracts';

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function lectureNotesBody(labels: readonly string[], title = 'Lecture notes') {
  return [
    `\\section{${title}}`,
    `Evidence ${labels.map((label) => `[${label}]`).join(' ')}.`,
    '\\section{Sources used}',
    ...labels.map((label) => `[${label}] Fixture source ${label}`),
  ].join('\n');
}

function lectureSlidesBody(labels: readonly string[], frameCount = 1) {
  return Array.from({ length: frameCount }, (_, index) => {
    const label = labels[index % labels.length]!;
    return `\\begin{frame}{Slide ${index + 1}}\nEvidence [${label}].\n\\end{frame}`;
  }).join('\n');
}

function latexResponse(labels: readonly string[], frameCount = 1, reply = 'Generated.') {
  return {
    reply,
    lectureNotesLatexBody: lectureNotesBody(labels),
    slidesLatexBody: lectureSlidesBody(labels, frameCount),
  };
}

function invocation(requestedModelId: string | null): ModelInvocation {
  return {
    schemaVersion: 1,
    invocationId: randomUUID(),
    providerId: 'codex',
    requestedModelId,
    resolvedModelId: requestedModelId ?? 'provider-default',
    catalogVersion: 'fixture-catalog',
    reasoningOptionId: 'high',
    startedAt: new Date().toISOString(),
  };
}

function literature(projectId: string, title: string): LiteratureRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: randomUUID(),
    projectId,
    provider: 'crossref',
    providerRecordId: `provider:${title}`,
    doi: null,
    fingerprint: hash(title),
    title,
    authors: ['Fixture Author'],
    containerTitle: 'Fixture Journal',
    publishedYear: 2026,
    sourceTopics: ['research systems'],
    workType: 'journal-article',
    citationCount: 3,
    sourceUrl: null,
    citationKey: `fixture${title.replaceAll(' ', '')}`,
    reviewStatus: 'included',
    manualAnnotations: { topics: [], summary: '', relevance: '' },
    aiAnnotations: null,
    annotationVersion: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function manuscriptSnapshot(
  projectId: string,
  options: Readonly<{ captured?: boolean }> = {},
): ManuscriptWorkspaceSnapshot {
  const now = '2026-08-11T00:00:00.000Z';
  const manuscriptId = randomUUID();
  const bindingId = randomUUID();
  const checkpointId = randomUUID();
  const providerRevision = 'provider-revision-1';
  const capabilities = {
    schemaVersion: 1 as const,
    interactionModes: ['checkpoint_pull' as const],
    revisionTopology: 'linear' as const,
    conditionalPublish: false,
    providerHistory: true,
    presence: false,
    comments: false,
    trackChanges: false,
    serverCompile: false,
    reviewMetadataRoundTrip: 'unsupported' as const,
  };
  const checkpoint =
    options.captured === false
      ? null
      : {
          schemaVersion: 1 as const,
          checkpointId,
          bindingId,
          projectId,
          manuscriptId,
          providerId: 'overleaf_git',
          direction: 'fetch' as const,
          sourceAuthority: 'provider' as const,
          sourceRevision: providerRevision,
          gosuRevision: null,
          providerRevision,
          cursor: null,
          revisionEnvelopeDigest: `sha256:${'a'.repeat(64)}`,
          rootDocument: 'main.tex',
          baseCheckpointId: null,
          actorId: randomUUID(),
          observedAt: now,
        };
  return {
    schemaVersion: 1,
    projectId,
    providers: [],
    manuscripts: [
      {
        manuscript: {
          schemaVersion: 1,
          id: manuscriptId,
          projectId,
          title: 'Captured manuscript',
          rootDocument: 'main.tex',
          version: 3,
          createdAt: now,
          updatedAt: now,
        },
        connection: {
          binding: {
            schemaVersion: 1,
            bindingId,
            projectId,
            manuscriptId,
            providerId: 'overleaf_git',
            capabilitiesSnapshot: capabilities,
            authority: 'provider',
            enabled: true,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
          providerDisplayName: 'Overleaf Git',
          workspaceUrl: null,
          lifecycle: 'ready',
          syncState: checkpoint ? 'in_sync' : 'provider_ahead',
          anchor: {
            schemaVersion: 1,
            bindingId,
            generation: checkpoint ? 1 : 0,
            lastCommonRevision: checkpoint?.providerRevision ?? null,
            providerRevision,
            gosuRevision: null,
            updatedAt: now,
          },
          lastObservedProviderRevision: providerRevision,
          lastObservedAt: now,
          lastFailureCode: null,
          lastCheckpoint: checkpoint,
        },
      },
    ],
  };
}

class MemoryStorage implements LectureStudioStorage {
  readonly studios: LectureStudio[] = [];
  readonly messages: LectureStudioMessage[] = [];
  readonly revisions: LectureStudioRevision[] = [];
  readonly trashReceipts = new Map<string, EmptyLectureStudioTrashReceipt>();

  listLectureStudios(includeTrashed = false) {
    return this.studios
      .filter((studio) => includeTrashed || studio.trashedAt === undefined)
      .map(
        ({
          schemaVersion,
          id,
          title,
          kind,
          durationMinutes,
          outputProjectId,
          status,
          activeAttemptId,
          currentRevision,
          version,
          lastErrorCode,
          trashedAt,
          createdAt,
          updatedAt,
        }) => ({
          schemaVersion,
          id,
          title,
          kind,
          durationMinutes,
          outputProjectId,
          status,
          activeAttemptId,
          currentRevision,
          version,
          lastErrorCode,
          ...(trashedAt ? { trashedAt } : {}),
          createdAt,
          updatedAt,
        }),
      );
  }

  getLectureStudio(studioId: string) {
    return this.studios.find((studio) => studio.id === studioId) ?? null;
  }

  getLectureStudioDetail(studioId: string): LectureStudioDetail | null {
    const studio = this.getLectureStudio(studioId);
    return studio
      ? {
          schemaVersion: 1,
          studio,
          messages: this.listLectureStudioMessages(studioId, 50),
          revisions: this.listLectureStudioRevisions(studioId, 1),
        }
      : null;
  }

  listLectureStudioMessages(studioId: string, limit: number) {
    return this.messages
      .filter((message) => message.studioId === studioId)
      .slice(-Math.min(limit, 100));
  }

  listLectureStudioRevisions(studioId: string, limit: number) {
    return this.revisions
      .filter((revision) => revision.studioId === studioId)
      .slice(-Math.min(limit, 100));
  }

  getCurrentLectureStudioRevision(studioId: string) {
    return (
      this.revisions
        .filter((revision) => revision.studioId === studioId)
        .sort((left, right) => right.revision - left.revision)[0] ?? null
    );
  }

  getLectureStudioRevision(studioId: string, revision: number) {
    return (
      this.revisions.find(
        (candidate) => candidate.studioId === studioId && candidate.revision === revision,
      ) ?? null
    );
  }

  createLectureStudio(studio: LectureStudio) {
    this.studios.push(studio);
    return true;
  }

  beginLectureStudioTurn(input: {
    studioId: string;
    expectedVersion: number;
    attemptId: string;
    userMessage: LectureStudioMessage | null;
    updatedAt: string;
  }) {
    const index = this.studios.findIndex(
      (studio) => studio.id === input.studioId && studio.version === input.expectedVersion,
    );
    if (index < 0) return null;
    const current = this.studios[index]!;
    if (current.trashedAt !== undefined) return null;
    const generating: LectureStudio = {
      ...current,
      status: 'generating',
      activeAttemptId: input.attemptId,
      lastErrorCode: null,
      version: current.version + 1,
      updatedAt: input.updatedAt,
    };
    this.studios[index] = generating;
    if (input.userMessage) this.messages.push(input.userMessage);
    return generating;
  }

  completeLectureStudioTurn(input: {
    studio: LectureStudio;
    revision: LectureStudioRevision;
    assistantMessage: LectureStudioMessage;
  }) {
    const index = this.studios.findIndex(
      (studio) =>
        studio.id === input.studio.id &&
        studio.activeAttemptId === input.revision.attemptId &&
        studio.version + 1 === input.studio.version,
    );
    if (index < 0) return null;
    this.studios[index] = input.studio;
    this.revisions.push(input.revision);
    this.messages.push(input.assistantMessage);
    return input.studio;
  }

  failLectureStudioTurn(input: {
    studioId: string;
    attemptId: string;
    errorCode: string;
    messageStatus: 'failed' | 'interrupted';
    updatedAt: string;
  }) {
    const index = this.studios.findIndex(
      (studio) => studio.id === input.studioId && studio.activeAttemptId === input.attemptId,
    );
    if (index < 0) return null;
    const current = this.studios[index]!;
    const failed: LectureStudio = {
      ...current,
      status: 'failed',
      activeAttemptId: null,
      lastErrorCode: input.errorCode,
      version: current.version + 1,
      updatedAt: input.updatedAt,
    };
    this.studios[index] = failed;
    for (const [messageIndex, message] of this.messages.entries()) {
      if (
        message.studioId === input.studioId &&
        message.attemptId === input.attemptId &&
        message.role === 'user' &&
        message.status === 'complete'
      ) {
        this.messages[messageIndex] = {
          ...message,
          status: input.messageStatus,
          completedAt: input.updatedAt,
        };
      }
    }
    return failed;
  }

  setLectureStudioTrashed(
    studioId: string,
    expectedVersion: number,
    trashedAt: string | null,
    updatedAt: string,
  ) {
    const index = this.studios.findIndex(
      (studio) => studio.id === studioId && studio.version === expectedVersion,
    );
    if (index < 0) return null;
    const current = this.studios[index]!;
    if ((trashedAt === null) === (current.trashedAt === undefined)) return null;
    const next: LectureStudio = {
      ...current,
      ...(trashedAt === null ? {} : { trashedAt }),
      version: current.version + 1,
      updatedAt,
    };
    if (trashedAt === null) delete (next as { trashedAt?: string }).trashedAt;
    this.studios[index] = next;
    return next;
  }

  emptyLectureStudioTrash(
    input: EmptyLectureStudioTrashInput,
    completedAt: string,
  ): EmptyLectureStudioTrashReceipt | null {
    const prior = this.trashReceipts.get(input.idempotencyKey);
    if (prior) return structuredClone(prior);
    const doomed = this.studios.filter((studio) => studio.trashedAt !== undefined);
    if (doomed.length === 0) return null;
    const receipt: EmptyLectureStudioTrashReceipt = {
      schemaVersion: 1,
      idempotencyKey: input.idempotencyKey,
      removedStudios: doomed.map((studio) => ({
        studioId: studio.id,
        title: studio.title,
        outputProjectId: studio.outputProjectId,
        revisionCount: this.revisions.filter((revision) => revision.studioId === studio.id).length,
        messageCount: this.messages.filter((message) => message.studioId === studio.id).length,
        trashedAt: studio.trashedAt!,
      })),
      completedAt,
    };
    const doomedIds = new Set(doomed.map((studio) => studio.id));
    for (let index = this.studios.length - 1; index >= 0; index -= 1) {
      if (doomedIds.has(this.studios[index]!.id)) this.studios.splice(index, 1);
    }
    this.trashReceipts.set(input.idempotencyKey, structuredClone(receipt));
    return receipt;
  }
}

class FakeCodex extends EventEmitter {
  response: unknown = {
    reply: 'Created a cross-project synthesis.',
    lectureNotesLatexBody:
      '\\section{Lecture notes}\nEvidence [P1] and [P2].\n\\section{Sources used}\n[P1] Paper A\n[P2] Paper B',
    slidesLatexBody: Array.from(
      { length: 10 },
      (_, index) =>
        `\\begin{frame}{Slide ${index + 1}}\nEvidence [P${index % 2 === 0 ? 1 : 2}]\n\\end{frame}`,
    ).join('\n'),
  };
  startInput: Record<string, unknown> | null = null;
  prompt = '';
  deferCompletion = false;
  terminalStatus = 'completed';
  startError: Error | null = null;
  lastThreadId: string | null = null;
  lastTurnId: string | null = null;

  async startThread(input: Record<string, unknown>) {
    if (this.startError) throw this.startError;
    this.startInput = input;
    return { threadId: 'lecture-thread' };
  }

  async runTurn(input: { threadId: string; prompt: string; requestedModelId: string | null }) {
    this.prompt = input.prompt;
    const turnId = 'lecture-turn';
    this.lastThreadId = input.threadId;
    this.lastTurnId = turnId;
    if (!this.deferCompletion) {
      queueMicrotask(() => {
        this.emit('notification', {
          method: 'item/completed',
          params: {
            threadId: input.threadId,
            turnId,
            item: {
              type: 'agentMessage',
              phase: 'final_answer',
              text: JSON.stringify(this.response),
            },
          },
        });
        this.emit('notification', {
          method: 'turn/completed',
          params: {
            threadId: input.threadId,
            turn: { id: turnId, status: this.terminalStatus },
          },
        });
      });
    }
    return { turnId, invocation: invocation(input.requestedModelId) };
  }

  async interruptTurn(threadId: string, turnId: string) {
    if (!this.deferCompletion) return;
    this.deferCompletion = false;
    queueMicrotask(() => {
      this.emit('notification', {
        method: 'turn/completed',
        params: { threadId, turn: { id: turnId, status: 'cancelled' } },
      });
    });
  }

  emitActivity() {
    if (!this.lastThreadId || !this.lastTurnId) throw new Error('missing_deferred_turn');
    this.emit('notification', {
      method: 'item/started',
      params: {
        threadId: this.lastThreadId,
        turnId: this.lastTurnId,
        item: { type: 'reasoning' },
      },
    });
  }

  completeDeferred(status = 'completed') {
    if (!this.lastThreadId || !this.lastTurnId) throw new Error('missing_deferred_turn');
    this.deferCompletion = false;
    if (status === 'completed') {
      this.emit('notification', {
        method: 'item/completed',
        params: {
          threadId: this.lastThreadId,
          turnId: this.lastTurnId,
          item: {
            type: 'agentMessage',
            phase: 'final_answer',
            text: JSON.stringify(this.response),
          },
        },
      });
    }
    this.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: this.lastThreadId,
        turn: { id: this.lastTurnId, status },
      },
    });
  }

  disconnect() {
    this.emit('disconnected');
  }

  async releaseThread() {}
}

function fixture(
  options: Readonly<{
    artifactDestinationReady?: boolean;
    failAfterArtifactPublish?: boolean;
    pendingArtifacts?: PendingLectureRevisionArtifacts[];
    manuscriptSnapshots?: ReadonlyMap<string, ManuscriptWorkspaceSnapshot>;
    manuscriptFiles?: ReadonlyMap<string, string>;
    pdfCompiler?: Pick<LectureDocumentCompiler, 'compile'>;
    artifactPlatform?: LectureArtifactPlatform;
    timeoutMs?: number;
    hardTimeoutMs?: number;
  }> = {},
) {
  const projectA = randomUUID();
  const projectB = randomUUID();
  const paperA = literature(projectA, 'Paper A');
  const paperB = literature(projectB, 'Paper B');
  const workspace: WorkspaceSnapshot = {
    schemaVersion: 1,
    revision: 1,
    projects: [
      {
        id: projectA,
        name: 'Project A',
        slug: 'project-a',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: projectB,
        name: 'Project B',
        slug: 'project-b',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    tasks: [],
    objectives: [],
  };
  const records = new Map<string, LiteratureRecord[]>([
    [projectA, [paperA]],
    [projectB, [paperB]],
  ]);
  const ideaRecords = new Map<string, ExperimentIdea[]>();
  const metricRecords = new Map<string, ExperimentMetricPoint[]>();
  const metricTailQueries: Array<{
    projectId: string;
    ideaIds: readonly string[];
    perIdeaLimit: number;
  }> = [];
  const storage = new MemoryStorage();
  const codex = new FakeCodex();
  const manuscriptSnapshots = new Map(options.manuscriptSnapshots ?? []);
  const manuscriptFiles = new Map(options.manuscriptFiles ?? []);
  const saved: Array<{
    outputProjectId: string;
    revision: number;
    resolvedModelId: string | null;
    relatedPapers: readonly string[];
  }> = [];
  const artifactEvents: string[] = [];
  const service = new LectureStudioService({
    storage,
    sources: {
      listLiteratureRecords: (projectId) => records.get(projectId) ?? [],
      getLiteratureRecordsByIds: (projectId, recordIds) =>
        (records.get(projectId) ?? []).filter((record) => recordIds.includes(record.id)),
      listExperimentIdeas: (projectId) => ideaRecords.get(projectId) ?? [],
      listExperimentMetricTails: ({ projectId, ideaIds, perIdeaLimit }) => {
        metricTailQueries.push({ projectId, ideaIds: [...ideaIds], perIdeaLimit });
        return [...new Set(ideaIds)].map((ideaId) => {
          const points = (metricRecords.get(projectId) ?? [])
            .filter((point) => point.ideaId === ideaId)
            .sort(
              (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
            );
          return {
            ideaId,
            metricPoints: points.slice(-perIdeaLimit),
            metricPointTotal: points.length,
          };
        });
      },
      getExperimentIdea: (projectId, ideaId) =>
        (ideaRecords.get(projectId) ?? []).find((idea) => idea.id === ideaId) ?? null,
    },
    manuscripts: {
      list: async ({ projectId }) =>
        manuscriptSnapshots.get(projectId) ?? {
          schemaVersion: 1,
          projectId,
          providers: [],
          manuscripts: [],
        },
      listCheckpointFiles: async ({ projectId, manuscriptId, checkpointId }) => ({
        schemaVersion: 1,
        projectId,
        manuscriptId,
        checkpointId,
        providerRevision: 'provider-revision-1',
        files: [...manuscriptFiles.entries()].map(([relativePath, content]) => ({
          relativePath,
          sizeBytes: Buffer.byteLength(content, 'utf8'),
          textReadable: true,
        })),
      }),
      readCheckpointFile: async ({
        projectId,
        manuscriptId,
        checkpointId,
        relativePath,
        offset = 0,
        maxCharacters = 24_000,
      }) => {
        const content = manuscriptFiles.get(relativePath);
        if (content === undefined) throw new Error('missing_manuscript_file');
        const chunk = content.slice(offset, offset + maxCharacters);
        const nextOffset = offset + chunk.length;
        return {
          schemaVersion: 1,
          projectId,
          manuscriptId,
          checkpointId,
          providerRevision: 'provider-revision-1',
          relativePath,
          offset,
          nextOffset,
          truncated: nextOffset < content.length,
          content: chunk,
        };
      },
    },
    workspace: { snapshot: () => workspace },
    artifacts: {
      assertRevisionDestination: () => {
        artifactEvents.push('preflight');
        if (options.artifactDestinationReady === false) {
          throw new Error('research_notes_vault_not_selected');
        }
      },
      saveRevisionArtifacts: (input) => {
        artifactEvents.push('stage');
        saved.push({
          outputProjectId: input.outputProjectId,
          revision: input.revision,
          resolvedModelId: input.invocation?.resolvedModelId ?? null,
          relatedPapers: input.relatedPapers ?? [],
        });
        if (options.failAfterArtifactPublish) throw new Error('post_publish_validation_failed');
        const notes = input.lectureNotesLatex ?? input.lectureNotesMarkdown;
        const slides = input.slidesLatex ?? input.slidesMarkdown;
        if (!notes || !slides) throw new Error('missing_fixture_artifact_content');
        const extension = input.documentFormat === 'latex' ? 'tex' : 'md';
        return [
          {
            kind: 'lecture-notes',
            relativePath: `Lecture Notes & Slides/Studio/Lecture Notes--r${input.revision}.${extension}`,
            contentSha256: hash(notes),
            savedAt: input.createdAt,
          },
          {
            kind: 'slides',
            relativePath: `Lecture Notes & Slides/Studio/Slides--r${input.revision}.${extension}`,
            contentSha256: hash(slides),
            savedAt: input.createdAt,
          },
        ];
      },
      confirmRevisionArtifacts: () => {
        artifactEvents.push('confirm');
      },
      rollbackRevisionArtifacts: () => {
        artifactEvents.push('rollback');
      },
      listPendingRevisionArtifacts: () => options.pendingArtifacts ?? [],
      confirmPendingRevisionArtifacts: () => {
        artifactEvents.push('reconcile-confirm');
      },
      rollbackPendingRevisionArtifacts: () => {
        artifactEvents.push('reconcile-rollback');
      },
      resolveLectureRevisionArtifact: (_outputProjectId, artifact) => ({
        absolutePath: `/tmp/gosu-lecture-studio-fixture/${artifact.kind}.tex`,
        relativePath: artifact.relativePath,
        fileName: artifact.kind === 'lecture-notes' ? 'Lecture Notes.tex' : 'Slides.tex',
        content: (() => {
          const revision = storage.revisions.find((candidate) =>
            candidate.artifacts.some(
              (candidateArtifact) =>
                candidateArtifact.kind === artifact.kind &&
                candidateArtifact.contentSha256 === artifact.contentSha256,
            ),
          );
          if (!revision) throw new Error('missing_fixture_revision');
          return revision.schemaVersion === 2
            ? artifact.kind === 'lecture-notes'
              ? revision.lectureNotesLatex
              : revision.slidesLatex
            : artifact.kind === 'lecture-notes'
              ? revision.lectureNotesMarkdown
              : revision.slidesMarkdown;
        })(),
        contentSha256: artifact.contentSha256,
      }),
    },
    codex,
    pdfCompiler: options.pdfCompiler ?? {
      compile: async (input) => {
        const pdfBytes = Buffer.from('%PDF-1.7\n%%EOF\n');
        return {
          schemaVersion: 1 as const,
          artifactId: randomUUID(),
          title: `${input.title} PDF`,
          fileName: input.kind === 'lecture-notes' ? 'Lecture Notes.pdf' : 'Slides.pdf',
          compilerDisplayName: 'Fixture XeLaTeX',
          sourceDescription: `Fixture PDF · revision ${input.revision}`,
          pdfSha256: `sha256:${createHash('sha256').update(pdfBytes).digest('hex')}` as const,
          sizeBytes: pdfBytes.byteLength,
          compiledAt: new Date().toISOString(),
          pdfBase64: pdfBytes.toString('base64'),
        };
      },
    },
    ...(options.artifactPlatform ? { artifactPlatform: options.artifactPlatform } : {}),
    prepareDirectory: async () => '/tmp/gosu-lecture-studio-fixture',
    timeoutMs: options.timeoutMs ?? 5_000,
    hardTimeoutMs: options.hardTimeoutMs ?? 30_000,
  });
  return {
    service,
    storage,
    codex,
    saved,
    artifactEvents,
    projectA,
    projectB,
    paperA,
    paperB,
    records,
    ideaRecords,
    metricRecords,
    metricTailQueries,
    manuscriptSnapshots,
    manuscriptFiles,
    pendingArtifacts: options.pendingArtifacts ?? [],
  };
}

function pendingFromRevision(
  studio: LectureStudio,
  revision: LectureStudioRevision,
): PendingLectureRevisionArtifacts {
  const notes = revision.artifacts.find((artifact) => artifact.kind === 'lecture-notes')!;
  const slides = revision.artifacts.find((artifact) => artifact.kind === 'slides')!;
  return {
    outputProjectId: studio.outputProjectId,
    bindingId: 'a'.repeat(64),
    vaultId: 'b'.repeat(64),
    bundleId: 'c'.repeat(64),
    relativeBundlePath: 'Lecture Notes & Slides/Studio',
    studioId: studio.id,
    revision: revision.revision,
    attemptId: revision.attemptId,
    sourceManifestSha256: revision.sourceManifestSha256,
    artifacts: [
      {
        kind: notes.kind,
        relativePath: notes.relativePath,
        contentSha256: notes.contentSha256,
      },
      {
        kind: slides.kind,
        relativePath: slides.relativePath,
        contentSha256: slides.contentSha256,
      },
    ],
  };
}

describe('LectureStudioService', () => {
  it('moves a Studio to recoverable Trash, restores it, and purges only trashed history', async () => {
    const { service, storage, projectA, paperA } = fixture();
    const created = await service.create({
      title: 'Recoverable lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });

    const trashed = await service.trash({ studioId: created.id, expectedVersion: created.version });
    expect(trashed).toMatchObject({ id: created.id, version: 2 });
    expect(trashed.trashedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect((await service.list({})).studios).toEqual([]);
    expect((await service.list({ includeTrashed: true })).studios).toHaveLength(1);
    await expect(service.detail({ studioId: created.id })).rejects.toEqual(
      new LectureStudioServiceError('lecture_studio_trashed'),
    );
    await expect(
      service.generate({
        studioId: created.id,
        expectedVersion: trashed.version,
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toEqual(new LectureStudioServiceError('lecture_studio_trashed'));

    const restored = await service.restore({
      studioId: created.id,
      expectedVersion: trashed.version,
    });
    expect(restored.id).toBe(created.id);
    expect(restored).not.toHaveProperty('trashedAt');
    expect((await service.list({})).studios).toHaveLength(1);

    const trashedAgain = await service.trash({
      studioId: restored.id,
      expectedVersion: restored.version,
    });
    const emptyCommand = {
      idempotencyKey: randomUUID(),
      confirmation: 'EMPTY LECTURE TRASH',
    } as const;
    const receipt = await service.emptyTrash(emptyCommand);
    expect(receipt.removedStudios).toEqual([
      expect.objectContaining({ studioId: trashedAgain.id, title: 'Recoverable lecture' }),
    ]);
    expect(storage.studios).toEqual([]);
    await expect(service.emptyTrash(emptyCommand)).resolves.toEqual(receipt);
    await expect(
      service.restore({ studioId: trashedAgain.id, expectedVersion: trashedAgain.version }),
    ).rejects.toEqual(new LectureStudioServiceError('lecture_studio_not_found'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets the idle deadline whenever the active Codex turn reports progress', async () => {
    vi.useFakeTimers();
    const { service, codex, projectA, paperA } = fixture({
      timeoutMs: 5_000,
      hardTimeoutMs: 20_000,
    });
    codex.response = {
      reply: 'Created active generation.',
      lectureNotesLatexBody:
        '\\section{Lecture notes}\nEvidence [P1].\n\\section{Sources used}\n[P1] Paper A',
      slidesLatexBody: '\\begin{frame}{Slide 1}\nEvidence [P1].\n\\end{frame}',
    };
    codex.deferCompletion = true;
    const studio = await service.create({
      title: 'Long active generation',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });

    let settled = false;
    const running = service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    for (let index = 0; index < 100 && !codex.lastTurnId; index += 1) await Promise.resolve();
    expect(codex.lastTurnId).toBe('lecture-turn');

    await vi.advanceTimersByTimeAsync(4_000);
    codex.emitActivity();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(settled).toBe(false);

    codex.completeDeferred();
    await expect(running).resolves.toMatchObject({ studio: { status: 'ready' } });
  });

  it('enforces the hard generation deadline even while Codex remains active', async () => {
    vi.useFakeTimers();
    const { service, codex, projectA, paperA } = fixture({
      timeoutMs: 5_000,
      hardTimeoutMs: 12_000,
    });
    codex.deferCompletion = true;
    const studio = await service.create({
      title: 'Bounded generation',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    let generationError: unknown = null;
    const running = service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    const observed = running.catch((error: unknown) => {
      generationError = error;
      return null;
    });
    for (let index = 0; index < 100 && !codex.lastTurnId; index += 1) await Promise.resolve();

    await vi.advanceTimersByTimeAsync(4_000);
    codex.emitActivity();
    await vi.advanceTimersByTimeAsync(4_000);
    codex.emitActivity();
    await vi.advanceTimersByTimeAsync(4_000);
    await observed;
    expect(generationError).toMatchObject({ code: 'lecture_generation_timed_out' });
  });

  it('separates a terminal generation failure from Codex transport unavailability', async () => {
    const failed = fixture();
    failed.codex.terminalStatus = 'failed';
    const failedStudio = await failed.service.create({
      title: 'Failed turn',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: failed.projectA,
      sourceProjectIds: [failed.projectA],
      sourceSelection: {
        literature: [{ projectId: failed.projectA, recordId: failed.paperA.id }],
        experiments: [],
      },
    });
    await expect(
      failed.service.generate({
        studioId: failedStudio.id,
        expectedVersion: failedStudio.version,
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toMatchObject({ code: 'lecture_generation_failed' });

    const unavailable = fixture();
    unavailable.codex.startError = new Error('transport unavailable');
    const unavailableStudio = await unavailable.service.create({
      title: 'Unavailable transport',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: unavailable.projectA,
      sourceProjectIds: [unavailable.projectA],
      sourceSelection: {
        literature: [{ projectId: unavailable.projectA, recordId: unavailable.paperA.id }],
        experiments: [],
      },
    });
    await expect(
      unavailable.service.generate({
        studioId: unavailableStudio.id,
        expectedVersion: unavailableStudio.version,
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toMatchObject({ code: 'lecture_codex_unavailable' });

    const disconnected = fixture();
    disconnected.codex.deferCompletion = true;
    const disconnectedStudio = await disconnected.service.create({
      title: 'Disconnected transport',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: disconnected.projectA,
      sourceProjectIds: [disconnected.projectA],
      sourceSelection: {
        literature: [{ projectId: disconnected.projectA, recordId: disconnected.paperA.id }],
        experiments: [],
      },
    });
    const disconnectedTurn = disconnected.service.generate({
      studioId: disconnectedStudio.id,
      expectedVersion: disconnectedStudio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    for (let index = 0; index < 100 && !disconnected.codex.lastTurnId; index += 1) {
      await Promise.resolve();
    }
    disconnected.codex.disconnect();
    await expect(disconnectedTurn).rejects.toMatchObject({ code: 'lecture_codex_unavailable' });
  });

  it('exports, opens, and reveals only the exact committed Research Notes artifact revision', async () => {
    const exported: Array<{ format: string; suggestedFileName: string; bytes: Buffer }> = [];
    const artifactPlatform: LectureArtifactPlatform = {
      exportFile: vi.fn(async (input) => {
        exported.push(input);
        return { status: 'exported' as const, fileName: input.suggestedFileName };
      }),
      openExisting: vi.fn(async () => undefined),
      openPdf: vi.fn(async () => 'Lecture Notes.pdf'),
      revealExisting: vi.fn(async () => undefined),
    };
    const { service, codex, projectA, paperA } = fixture({ artifactPlatform });
    codex.response = latexResponse(['P1'], 1, 'Created one-source notes.');
    const studio = await service.create({
      title: 'Artifact actions',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    const receipt = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    if (receipt.revision.schemaVersion !== 2) throw new Error('Expected a LaTeX revision');
    const artifact = receipt.revision.artifacts.find(
      (candidate) => candidate.kind === 'lecture-notes',
    )!;
    const binding = {
      studioId: studio.id,
      revisionId: receipt.revision.id,
      revision: receipt.revision.revision,
      kind: artifact.kind,
      artifactContentSha256: artifact.contentSha256,
    };

    await expect(service.exportArtifact({ ...binding, format: 'latex' })).resolves.toMatchObject({
      status: 'exported',
      format: 'latex',
      fileName: 'Lecture Notes.tex',
      relativePath: artifact.relativePath,
    });
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({
      format: 'latex',
      suggestedFileName: 'Lecture Notes.tex',
    });
    expect(exported[0]?.bytes.toString('utf8')).toBe(receipt.revision.lectureNotesLatex);

    await service.openArtifact({ ...binding, format: 'latex' });
    await service.revealArtifact(binding);
    expect(artifactPlatform.openExisting).toHaveBeenCalledWith(
      '/tmp/gosu-lecture-studio-fixture/lecture-notes.tex',
    );
    expect(artifactPlatform.revealExisting).toHaveBeenCalledWith(
      '/tmp/gosu-lecture-studio-fixture/lecture-notes.tex',
    );

    await expect(
      service.exportArtifact({
        ...binding,
        artifactContentSha256: 'f'.repeat(64),
        format: 'latex',
      }),
    ).rejects.toEqual(new LectureStudioServiceError('lecture_artifact_changed'));
    await expect(service.revealArtifact({ ...binding, revisionId: randomUUID() })).rejects.toEqual(
      new LectureStudioServiceError('lecture_artifact_not_found'),
    );
    expect(artifactPlatform.exportFile).toHaveBeenCalledTimes(1);
    expect(artifactPlatform.revealExisting).toHaveBeenCalledTimes(1);

    await expect(service.exportArtifact({ ...binding, format: 'markdown' })).rejects.toEqual(
      new LectureStudioServiceError('lecture_artifact_changed'),
    );
    await expect(service.openArtifact({ ...binding, format: 'markdown' })).rejects.toEqual(
      new LectureStudioServiceError('lecture_artifact_changed'),
    );
  });

  it('derives an opened PDF from stored canonical LaTeX instead of Renderer bytes', async () => {
    const pdfBytes = Buffer.from('%PDF-1.7\n%%EOF\n');
    const compile = vi.fn(async (input) => ({
      schemaVersion: 1 as const,
      artifactId: randomUUID(),
      title: 'Lecture notes PDF',
      fileName: 'Lecture Notes.pdf',
      compilerDisplayName: 'Fixture XeLaTeX',
      sourceDescription: `PDF fixture · revision ${input.revision}`,
      pdfSha256: `sha256:${createHash('sha256').update(pdfBytes).digest('hex')}` as const,
      sizeBytes: pdfBytes.byteLength,
      compiledAt: new Date().toISOString(),
      pdfBase64: pdfBytes.toString('base64'),
    }));
    const artifactPlatform: LectureArtifactPlatform = {
      exportFile: vi.fn(),
      openExisting: vi.fn(),
      openPdf: vi.fn(async () => 'Lecture Notes.pdf'),
      revealExisting: vi.fn(),
    };
    const { service, codex, projectA, paperA } = fixture({
      artifactPlatform,
      pdfCompiler: { compile },
    });
    codex.response = latexResponse(['P1'], 1, 'Created notes for PDF.');
    const studio = await service.create({
      title: 'Stored PDF source',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    const generated = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    if (generated.revision.schemaVersion !== 2) throw new Error('Expected a LaTeX revision');
    const artifact = generated.revision.artifacts.find(
      (candidate) => candidate.kind === 'lecture-notes',
    )!;

    await service.openArtifact({
      studioId: studio.id,
      revisionId: generated.revision.id,
      revision: generated.revision.revision,
      kind: 'lecture-notes',
      artifactContentSha256: artifact.contentSha256,
      format: 'pdf',
    });

    expect(compile).toHaveBeenCalledWith(
      expect.objectContaining({
        studioId: studio.id,
        revision: generated.revision.revision,
        markdown: generated.revision.lectureNotesLatex,
        contentSha256: hash(generated.revision.lectureNotesLatex),
        sourceFormat: 'latex',
      }),
    );
    expect(artifactPlatform.openPdf).toHaveBeenCalledWith({
      kind: 'lecture-notes',
      document: await compile.mock.results.at(-1)?.value,
    });
  });

  it('compiles only an exact immutable revision selected by hash', async () => {
    const compile = vi.fn(async () => ({
      schemaVersion: 1 as const,
      artifactId: randomUUID(),
      title: 'Lecture notes PDF',
      fileName: 'Lecture Notes.pdf',
      compilerDisplayName: 'Fixture XeLaTeX',
      sourceDescription: 'PDF fixture · revision 1',
      pdfSha256: `sha256:${'a'.repeat(64)}` as const,
      sizeBytes: 16,
      compiledAt: new Date().toISOString(),
      pdfBase64: Buffer.from('%PDF-1.7\n%%EOF').toString('base64'),
    }));
    const { service, storage, codex, projectA, paperA } = fixture({ pdfCompiler: { compile } });
    codex.response = latexResponse(['P1'], 1, 'Created one-source notes.');
    const studio = await service.create({
      title: 'PDF fixture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    const receipt = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    if (receipt.revision.schemaVersion !== 2) throw new Error('Expected a LaTeX revision');
    const latex = receipt.revision.lectureNotesLatex;

    await service.compilePdf({
      studioId: studio.id,
      revision: receipt.revision.revision,
      kind: 'lecture-notes',
      contentSha256: hash(latex),
    });

    expect(compile).toHaveBeenCalledWith(
      expect.objectContaining({
        studioId: studio.id,
        revision: receipt.revision.revision,
        kind: 'lecture-notes',
        markdown: latex,
        contentSha256: hash(latex),
        sourceFormat: 'latex',
      }),
    );
    await expect(
      service.compilePdf({
        studioId: studio.id,
        revision: receipt.revision.revision,
        kind: 'lecture-notes',
        contentSha256: 'a'.repeat(64),
      }),
    ).rejects.toEqual(new LectureStudioServiceError('lecture_version_conflict'));
    expect(storage.revisions).toHaveLength(1);
  });

  it('builds one immutable talk revision from sources selected across projects', async () => {
    const { service, codex, saved, projectA, projectB, paperA, paperB } = fixture();
    const studio = await service.create({
      title: 'Research systems talk',
      kind: 'talk',
      durationMinutes: 20,
      outputProjectId: projectA,
      sourceProjectIds: [projectA, projectB],
      sourceSelection: {
        literature: [
          { projectId: projectA, recordId: paperA.id },
          { projectId: projectB, recordId: paperB.id },
        ],
        experiments: [],
      },
    });

    const receipt = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: 'opaque-model-id',
      reasoningOptionId: 'high',
    });

    expect(receipt.studio).toMatchObject({ status: 'ready', currentRevision: 1, version: 3 });
    expect(receipt.revision.sourceManifest.selectedProjectIds).toEqual([projectA, projectB]);
    expect(receipt.revision.sourceManifest.literature.map((source) => source.sourceLabel)).toEqual([
      'P1',
      'P2',
    ]);
    expect(receipt.revision.invocation.resolvedModelId).toBe('opaque-model-id');
    expect(receipt.assistantMessage.content).toContain(
      'Lecture Notes & Slides/Studio/Lecture Notes--r1.tex',
    );
    expect(saved).toEqual([
      {
        outputProjectId: projectA,
        revision: 1,
        resolvedModelId: 'opaque-model-id',
        relatedPapers: [],
      },
    ]);
    expect(codex.startInput).toMatchObject({
      dynamicTools: [],
      webSearchMode: 'disabled',
    });
    expect(codex.prompt).toContain('20-minute research talk');
    expect(codex.prompt).toContain('Paper A');
    expect(codex.prompt).toContain('Paper B');

    const listed = await service.list({});
    expect(listed.studios).toHaveLength(1);
    expect(listed.studios[0]).not.toHaveProperty('sourceSelection');
    const detail = await service.detail({ studioId: studio.id });
    expect(detail.studio.sourceSelection.literature).toHaveLength(2);
    expect(detail.messages).toEqual([receipt.assistantMessage]);
    expect(detail.revisions).toEqual([receipt.revision]);
  });

  it('generates a frozen v2 lecture revision from one exact captured manuscript checkpoint', async () => {
    const { service, codex, projectA, manuscriptSnapshots, manuscriptFiles } = fixture();
    const snapshot = manuscriptSnapshot(projectA);
    const manuscript = snapshot.manuscripts[0]!.manuscript;
    const checkpoint = snapshot.manuscripts[0]!.connection!.lastCheckpoint!;
    const mainTex = String.raw`\documentclass{article}
\begin{document}
The captured result improves the bounded baseline.
\bibliography{references}
\end{document}`;
    const bibliography = '@article{fixture2026, title={Captured evidence}}';
    manuscriptSnapshots.set(projectA, snapshot);
    manuscriptFiles.set('main.tex', mainTex);
    manuscriptFiles.set('references.bib', bibliography);

    const candidates = await service.candidates({ projectIds: [projectA] });
    expect(candidates.projects[0]?.manuscripts).toEqual([
      {
        manuscript,
        availability: 'ready',
        checkpointId: checkpoint.checkpointId,
        providerRevision: checkpoint.providerRevision,
        observedAt: checkpoint.observedAt,
      },
    ]);

    const studio = await service.create({
      title: 'Manuscript-derived lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [],
        experiments: [],
        manuscripts: [{ projectId: projectA, manuscriptId: manuscript.id }],
      },
    });
    codex.response = latexResponse(['M1'], 2, 'Created from the captured manuscript checkpoint.');

    const receipt = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    if (receipt.revision.schemaVersion !== 2) throw new Error('Expected a LaTeX revision');

    expect(receipt.revision.sourceManifest.schemaVersion).toBe(2);
    if (receipt.revision.sourceManifest.schemaVersion !== 2) {
      throw new Error('Expected a v2 manuscript source manifest');
    }
    expect(receipt.revision.sourceManifest.manuscripts).toEqual([
      {
        sourceLabel: 'M1',
        projectId: projectA,
        projectName: 'Project A',
        manuscriptId: manuscript.id,
        manuscriptVersion: manuscript.version,
        title: manuscript.title,
        rootDocument: manuscript.rootDocument,
        checkpointId: checkpoint.checkpointId,
        providerId: checkpoint.providerId,
        providerRevision: checkpoint.providerRevision,
        revisionEnvelopeDigest: checkpoint.revisionEnvelopeDigest,
        observedAt: checkpoint.observedAt,
        files: [
          {
            relativePath: 'main.tex',
            contentSha256: hash(mainTex),
            totalCharacters: mainTex.length,
            contentComplete: true,
            extractionPolicyVersion: 1,
            content: mainTex,
          },
          {
            relativePath: 'references.bib',
            contentSha256: hash(bibliography),
            totalCharacters: bibliography.length,
            contentComplete: true,
            extractionPolicyVersion: 1,
            content: bibliography,
          },
        ],
        contentKind: 'captured_latex',
        metadataOnly: false,
      },
    ]);
    expect(codex.prompt).toContain('"sourceLabel":"M1"');
    expect(codex.prompt).toContain('The captured result improves the bounded baseline.');
    expect(receipt.revision.lectureNotesLatex).toContain('[M1]');

    manuscriptFiles.set('main.tex', 'mutated after generation');
    const detail = await service.detail({ studioId: studio.id });
    expect(
      detail.revisions[0]?.sourceManifest.schemaVersion === 2
        ? detail.revisions[0].sourceManifest.manuscripts[0]?.files[0]?.content
        : null,
    ).toBe(mainTex);
  });

  it('accepts a normal long manuscript through deterministic bounded exact extracts', async () => {
    const { service, codex, projectA, manuscriptSnapshots, manuscriptFiles } = fixture();
    const snapshot = manuscriptSnapshot(projectA);
    const manuscript = snapshot.manuscripts[0]!.manuscript;
    manuscriptSnapshots.set(projectA, snapshot);
    const longMain = `${String.raw`\documentclass{article}\begin{document}`}\n${'A'.repeat(
      181_796,
    )}\n${String.raw`\end{document}`}`;
    const longBibliography = `@article{fixture,title={${'B'.repeat(20_949)}}}`;
    manuscriptFiles.set('main.tex', longMain);
    manuscriptFiles.set('references.bib', longBibliography);

    const studio = await service.create({
      title: 'Long manuscript lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [],
        experiments: [],
        manuscripts: [{ projectId: projectA, manuscriptId: manuscript.id }],
      },
      generationBrief: {
        notesTargetPages: 12,
        slidesTargetPages: 18,
        detailLevel: 'detailed',
        customInstructions: 'Emphasize the theorem and ablations.',
      },
    });

    expect(studio.status).toBe('draft');
    expect(codex.startInput).toBeNull();
    expect(studio.generationBrief).toEqual({
      notesTargetPages: 12,
      slidesTargetPages: 18,
      detailLevel: 'detailed',
      customInstructions: 'Emphasize the theorem and ablations.',
    });
  });

  it('shares one serialized extraction budget fairly across two large manuscripts', async () => {
    const { service, codex, projectA, projectB, manuscriptSnapshots, manuscriptFiles } = fixture();
    const snapshotA = manuscriptSnapshot(projectA);
    const snapshotB = manuscriptSnapshot(projectB);
    const manuscriptA = snapshotA.manuscripts[0]!.manuscript;
    const manuscriptB = snapshotB.manuscripts[0]!.manuscript;
    manuscriptSnapshots.set(projectA, snapshotA);
    manuscriptSnapshots.set(projectB, snapshotB);
    const longMain = `${String.raw`\documentclass{article}\begin{document}`}${'\\section{Evidence}\n'.repeat(
      20_000,
    )}${String.raw`\end{document}`}`;
    manuscriptFiles.set('main.tex', longMain);

    const studio = await service.create({
      title: 'Two manuscript lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA, projectB],
      sourceSelection: {
        literature: [],
        experiments: [],
        manuscripts: [
          { projectId: projectA, manuscriptId: manuscriptA.id },
          { projectId: projectB, manuscriptId: manuscriptB.id },
        ],
      },
    });
    codex.response = latexResponse(
      ['M1', 'M2'],
      2,
      'Created from two bounded manuscript checkpoints.',
    );

    const receipt = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    if (receipt.revision.sourceManifest.schemaVersion !== 2) {
      throw new Error('Expected a v2 manuscript source manifest');
    }
    const extracts = receipt.revision.sourceManifest.manuscripts.map((source) => source.files[0]!);
    expect(extracts).toHaveLength(2);
    expect(extracts.map((file) => file.contentSha256)).toEqual([hash(longMain), hash(longMain)]);
    expect(extracts.every((file) => file.totalCharacters === longMain.length)).toBe(true);
    expect(extracts.every((file) => file.contentComplete === false)).toBe(true);
    expect(extracts.every((file) => JSON.stringify(file.content).length > 45_000)).toBe(true);
    expect(
      Math.abs(
        JSON.stringify(extracts[0]!.content).length - JSON.stringify(extracts[1]!.content).length,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      extracts.reduce((sum, file) => sum + JSON.stringify(file.content).length, 0),
    ).toBeLessThanOrEqual(100_000);
    expect(codex.prompt).toContain('"sourceLabel":"M1"');
    expect(codex.prompt).toContain('"sourceLabel":"M2"');
  });

  it('budgets escaped LaTeX source by serialized prompt size instead of raw characters', async () => {
    const { service, projectA, manuscriptSnapshots, manuscriptFiles } = fixture();
    const snapshot = manuscriptSnapshot(projectA);
    const manuscript = snapshot.manuscripts[0]!.manuscript;
    manuscriptSnapshots.set(projectA, snapshot);
    manuscriptFiles.set(
      'main.tex',
      `${String.raw`\documentclass{article}\begin{document}`}${'\\alpha{value}\n'.repeat(20_000)}${String.raw`\end{document}`}`,
    );
    manuscriptFiles.set('references.bib', '@article{fixture,title={Escaped source}}');

    await expect(
      service.create({
        title: 'Escaped manuscript lecture',
        kind: 'lecture',
        durationMinutes: null,
        outputProjectId: projectA,
        sourceProjectIds: [projectA],
        sourceSelection: {
          literature: [],
          experiments: [],
          manuscripts: [{ projectId: projectA, manuscriptId: manuscript.id }],
        },
      }),
    ).resolves.toMatchObject({ status: 'draft' });
  });

  it('fails closed when a selected manuscript lacks a captured checkpoint', async () => {
    const { service, codex, projectA, manuscriptSnapshots } = fixture();
    const snapshot = manuscriptSnapshot(projectA, { captured: false });
    const manuscript = snapshot.manuscripts[0]!.manuscript;
    manuscriptSnapshots.set(projectA, snapshot);

    const candidates = await service.candidates({ projectIds: [projectA] });
    expect(candidates.projects[0]?.manuscripts[0]).toMatchObject({
      availability: 'capture_required',
      checkpointId: null,
    });
    await expect(
      service.create({
        title: 'Unavailable manuscript',
        kind: 'lecture',
        durationMinutes: null,
        outputProjectId: projectA,
        sourceProjectIds: [projectA],
        sourceSelection: {
          literature: [],
          experiments: [],
          manuscripts: [{ projectId: projectA, manuscriptId: manuscript.id }],
        },
      }),
    ).rejects.toMatchObject({ code: 'lecture_source_not_found' });
    expect(codex.startInput).toBeNull();
  });

  it('rejects a manuscript checkpoint that exceeds the bounded source-file count', async () => {
    const { service, projectA, manuscriptSnapshots, manuscriptFiles } = fixture();
    const snapshot = manuscriptSnapshot(projectA);
    const manuscript = snapshot.manuscripts[0]!.manuscript;
    manuscriptSnapshots.set(projectA, snapshot);
    manuscriptFiles.set('main.tex', String.raw`\documentclass{article}`);
    for (let index = 0; index < 128; index += 1) {
      manuscriptFiles.set(`sections/section-${String(index).padStart(3, '0')}.tex`, 'bounded');
    }

    await expect(
      service.create({
        title: 'Oversized manuscript',
        kind: 'lecture',
        durationMinutes: null,
        outputProjectId: projectA,
        sourceProjectIds: [projectA],
        sourceSelection: {
          literature: [],
          experiments: [],
          manuscripts: [{ projectId: projectA, manuscriptId: manuscript.id }],
        },
      }),
    ).rejects.toMatchObject({ code: 'lecture_context_too_large' });
  });

  it('pages more than 100 ideas while resolving an explicitly selected off-page idea directly', async () => {
    const { service, projectA, ideaRecords, metricTailQueries } = fixture();
    const timestamp = '2026-08-06T00:00:00.000Z';
    const ideas: ExperimentIdea[] = Array.from({ length: 105 }, (_, index) => ({
      schemaVersion: 1,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      projectId: projectA,
      parentIdeaId: null,
      title: `Idea ${String(index).padStart(3, '0')}`,
      hypothesis: '',
      phase: 'Synthesis',
      outcome: 'planned',
      resultSummary: '',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    }));
    ideaRecords.set(projectA, ideas);

    const first = await service.candidates({ projectIds: [projectA] });
    expect(first.projects[0]?.experiments).toHaveLength(100);
    expect(first.projects[0]?.experimentPage).toEqual({
      offset: 0,
      limit: 100,
      total: 105,
      hasMore: true,
    });
    const second = await service.candidates({
      projectIds: [projectA],
      experimentOffset: 100,
      experimentLimit: 100,
    });
    expect(second.projects[0]?.experiments).toHaveLength(5);
    expect(second.projects[0]?.experimentPage).toEqual({
      offset: 100,
      limit: 100,
      total: 105,
      hasMore: false,
    });
    expect(metricTailQueries.slice(0, 2)).toEqual([
      {
        projectId: projectA,
        ideaIds: ideas.slice(0, 100).map((idea) => idea.id),
        perIdeaLimit: 20,
      },
      {
        projectId: projectA,
        ideaIds: ideas.slice(100).map((idea) => idea.id),
        perIdeaLimit: 20,
      },
    ]);

    await expect(
      service.create({
        title: 'Off-page experiment synthesis',
        kind: 'lecture',
        durationMinutes: null,
        outputProjectId: projectA,
        sourceProjectIds: [projectA],
        sourceSelection: {
          literature: [],
          experiments: [{ projectId: projectA, ideaId: ideas[104]!.id }],
        },
      }),
    ).resolves.toMatchObject({
      sourceSelection: { experiments: [{ ideaId: ideas[104]!.id }] },
    });
    expect(metricTailQueries.at(-1)).toEqual({
      projectId: projectA,
      ideaIds: [ideas[104]!.id],
      perIdeaLimit: 64,
    });
  });

  it('returns the latest metric tail and reports candidate truncation explicitly', async () => {
    const { service, projectA, ideaRecords, metricRecords } = fixture();
    const timestamp = '2026-08-06T00:00:00.000Z';
    const idea: ExperimentIdea = {
      schemaVersion: 1,
      id: randomUUID(),
      projectId: projectA,
      parentIdeaId: null,
      title: 'Long-running optimization',
      hypothesis: 'Later trials improve the metric.',
      phase: 'Improve',
      outcome: 'running',
      resultSummary: '',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    };
    ideaRecords.set(projectA, [idea]);
    metricRecords.set(
      projectA,
      Array.from({ length: 25 }, (_, index): ExperimentMetricPoint => ({
        schemaVersion: 1,
        id: randomUUID(),
        projectId: projectA,
        ideaId: idea.id,
        sequence: index + 1,
        objectiveId: randomUUID(),
        objectiveVersion: 1,
        metricKey: 'accuracy',
        metricDisplayName: 'Accuracy',
        direction: 'maximize',
        unit: '%',
        aggregation: 'mean',
        evaluatorHash: 'a'.repeat(64),
        datasetHash: 'b'.repeat(64),
        holdoutHash: null,
        baseline: 40,
        target: 60,
        value: index + 1,
        source: 'runner-summary',
        trialId: `trial-${index + 1}`,
        recordedAt: timestamp,
      })).reverse(),
    );

    const candidates = await service.candidates({
      projectIds: [projectA],
      metricPointLimit: 20,
    });
    const experiment = candidates.projects[0]?.experiments[0];
    expect(experiment?.metricPoints.map((point) => point.sequence)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 6),
    );
    expect(experiment).toMatchObject({ metricPointTotal: 25, metricsTruncated: true });
  });

  it('hydrates only the latest 64 metrics for an explicitly selected experiment source', async () => {
    const { service, codex, projectA, ideaRecords, metricRecords, metricTailQueries } = fixture();
    const timestamp = '2026-08-06T00:00:00.000Z';
    const idea: ExperimentIdea = {
      schemaVersion: 1,
      id: randomUUID(),
      projectId: projectA,
      parentIdeaId: null,
      title: 'Bounded experiment history',
      hypothesis: 'The metric improves over time.',
      phase: 'Improve',
      outcome: 'success',
      resultSummary: 'The final trials improved the metric.',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: timestamp,
    };
    ideaRecords.set(projectA, [idea]);
    metricRecords.set(
      projectA,
      Array.from({ length: 70 }, (_, index): ExperimentMetricPoint => ({
        schemaVersion: 1,
        id: randomUUID(),
        projectId: projectA,
        ideaId: idea.id,
        sequence: index + 1,
        objectiveId: randomUUID(),
        objectiveVersion: 1,
        metricKey: 'accuracy',
        metricDisplayName: 'Accuracy',
        direction: 'maximize',
        unit: '%',
        aggregation: 'mean',
        evaluatorHash: 'a'.repeat(64),
        datasetHash: 'b'.repeat(64),
        holdoutHash: null,
        baseline: 40,
        target: 60,
        value: index + 1,
        source: 'runner-summary',
        trialId: `trial-${index + 1}`,
        recordedAt: timestamp,
      })),
    );

    const studio = await service.create({
      title: 'Experiment lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [],
        experiments: [{ projectId: projectA, ideaId: idea.id }],
      },
    });
    codex.response = latexResponse(['E1'], 1, 'Created a bounded experiment lecture.');
    const generated = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });

    expect(generated.revision.sourceManifest.experiments[0]?.metrics).toHaveLength(64);
    expect(
      generated.revision.sourceManifest.experiments[0]?.metrics.map((point) => point.sequence),
    ).toEqual(Array.from({ length: 64 }, (_, index) => index + 7));
    expect(metricTailQueries).toEqual([
      { projectId: projectA, ideaIds: [idea.id], perIdeaLimit: 64 },
      { projectId: projectA, ideaIds: [idea.id], perIdeaLimit: 64 },
    ]);
  });

  it('defaults to reviewed literature, never offers excluded records, and freezes an explicit screening status', async () => {
    const { service, codex, projectA, paperA, records } = fixture();
    const reviewed = {
      ...literature(projectA, 'Reviewed paper'),
      reviewStatus: 'reviewed' as const,
    };
    const screening = {
      ...literature(projectA, 'Screening paper'),
      reviewStatus: 'screening' as const,
      manualAnnotations: {
        topics: ['human-curated topic'],
        summary: 'Human-curated metadata summary.',
        relevance: '',
      },
    };
    const unreviewed = {
      ...literature(projectA, 'Unreviewed paper'),
      reviewStatus: 'unreviewed' as const,
    };
    const excluded = {
      ...literature(projectA, 'Excluded paper'),
      reviewStatus: 'excluded' as const,
    };
    records.set(projectA, [paperA, reviewed, screening, unreviewed, excluded]);

    const defaultPage = await service.candidates({ projectIds: [projectA] });
    expect(
      defaultPage.projects[0]?.literatureRecords.map((record) => record.reviewStatus).sort(),
    ).toEqual(['included', 'reviewed']);
    const expanded = await service.candidates({
      projectIds: [projectA],
      includeUnreviewed: true,
    });
    expect(
      expanded.projects[0]?.literatureRecords.map((record) => record.reviewStatus).sort(),
    ).toEqual(['included', 'reviewed', 'screening', 'unreviewed']);
    expect(expanded.projects[0]?.literatureRecords.map((record) => record.title)).not.toContain(
      'Excluded paper',
    );

    const studio = await service.create({
      title: 'Screening evidence lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: screening.id }],
        experiments: [],
      },
    });
    codex.response = latexResponse(['P1'], 1, 'Created a screening-evidence lecture.');
    const generated = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    expect(generated.revision.sourceManifest.literature[0]?.reviewStatus).toBe('screening');
    expect(generated.revision.sourceManifest.literature[0]?.topics).toContain(
      'human-curated topic',
    );

    await expect(
      service.create({
        title: 'Excluded evidence lecture',
        kind: 'lecture',
        durationMinutes: null,
        outputProjectId: projectA,
        sourceProjectIds: [projectA],
        sourceSelection: {
          literature: [{ projectId: projectA, recordId: excluded.id }],
          experiments: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'lecture_source_conflict' });
  });

  it('fails closed on invalid structured output and retains no revision', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    const studio = await service.create({
      title: 'Lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    codex.response = { reply: 'missing latex fields' };

    await expect(
      service.generate({
        studioId: studio.id,
        expectedVersion: studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LectureStudioServiceError>>({
        code: 'lecture_invalid_response',
      }),
    );
    expect(storage.revisions).toEqual([]);
    expect(storage.studios[0]).toMatchObject({
      status: 'failed',
      lastErrorCode: 'lecture_invalid_response',
    });
  });

  it('does not publish canonical LaTeX when either required PDF acceptance compile fails', async () => {
    const compile = vi.fn(async (input: Parameters<LectureDocumentCompiler['compile']>[0]) => {
      if (input.kind === 'slides') {
        throw new LectureDocumentCompilerError('lecture_pdf_compile_failed');
      }
      const pdfBytes = Buffer.from('%PDF-1.7\n%%EOF\n');
      return {
        schemaVersion: 1 as const,
        artifactId: randomUUID(),
        title: 'Lecture Notes PDF',
        fileName: 'Lecture Notes.pdf',
        compilerDisplayName: 'Fixture XeLaTeX',
        sourceDescription: 'Acceptance gate fixture',
        pdfSha256: `sha256:${createHash('sha256').update(pdfBytes).digest('hex')}` as const,
        sizeBytes: pdfBytes.byteLength,
        compiledAt: new Date().toISOString(),
        pdfBase64: pdfBytes.toString('base64'),
      };
    });
    const { service, storage, saved, codex, projectA, paperA } = fixture({
      pdfCompiler: { compile },
    });
    codex.response = latexResponse(['P1']);
    const studio = await service.create({
      title: 'Compile-gated lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });

    await expect(
      service.generate({
        studioId: studio.id,
        expectedVersion: studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toEqual(new LectureStudioServiceError('lecture_pdf_compile_failed'));

    expect(compile).toHaveBeenCalledTimes(2);
    expect(saved).toEqual([]);
    expect(storage.revisions).toEqual([]);
    expect(storage.studios[0]).toMatchObject({
      status: 'failed',
      lastErrorCode: 'lecture_pdf_compile_failed',
      currentRevision: 0,
    });
  });

  it('marks a failed edit message and excludes it from the next revision prompt', async () => {
    const { service, storage, codex, projectA, projectB, paperA, paperB } = fixture();
    const validResponse = structuredClone(codex.response);
    const studio = await service.create({
      title: 'Failure-isolated lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA, projectB],
      sourceSelection: {
        literature: [
          { projectId: projectA, recordId: paperA.id },
          { projectId: projectB, recordId: paperB.id },
        ],
        experiments: [],
      },
    });
    const initial = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.response = { reply: 'invalid response without documents' };

    await expect(
      service.send({
        studioId: studio.id,
        expectedVersion: initial.studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
        message: 'FAILED-INSTRUCTION: remove every equation.',
      }),
    ).rejects.toMatchObject({ code: 'lecture_invalid_response' });
    expect(storage.messages.find((message) => message.role === 'user')).toMatchObject({
      status: 'failed',
      content: 'FAILED-INSTRUCTION: remove every equation.',
    });

    codex.response = validResponse;
    const failedStudio = storage.getLectureStudio(studio.id)!;
    await service.send({
      studioId: studio.id,
      expectedVersion: failedStudio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: 'Keep the equations and clarify their notation.',
    });

    expect(codex.prompt).toContain('Keep the equations and clarify their notation.');
    expect(codex.prompt).not.toContain('FAILED-INSTRUCTION');
  });

  it('applies the same immutable rigor policy to initial generation and revision chat', async () => {
    const { service, codex, projectA, paperA } = fixture();
    codex.response = latexResponse(['P1'], 1, 'Created a consistent paired lecture.');
    const studio = await service.create({
      title: 'Immutable paired authoring',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });

    const initial = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    expect(codex.startInput?.developerInstructions).toBe(LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS);

    await service.send({
      studioId: studio.id,
      expectedVersion: initial.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message:
        'Only change the slide equation, use a conflicting symbol, and leave the notes unchanged.',
    });
    expect(codex.startInput?.developerInstructions).toBe(LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS);
    expect(codex.startInput?.developerInstructions).toContain(
      'propagate every necessary terminology, notation, cross-reference, citation, assumption, and conclusion update to both documents',
    );
    expect(codex.startInput?.developerInstructions).toContain(
      'Never invent a missing proof, derivation step, equation, numerical result, or guarantee',
    );
    expect(codex.prompt).toContain(
      'Only change the slide equation, use a conflicting symbol, and leave the notes unchanged.',
    );
  });

  it('labels a legacy Markdown revision explicitly while migrating the next revision to LaTeX', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    codex.response = latexResponse(['P1']);
    const studio = await service.create({
      title: 'Legacy migration lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    const initial = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    const generated = initial.revision;
    const legacyNotes = '# Legacy notes\n\nSource-supported evidence [P1].';
    const legacySlides = '# Legacy slide\n\nEvidence [P1].';
    storage.revisions[0] = {
      schemaVersion: 1,
      id: generated.id,
      studioId: generated.studioId,
      revision: generated.revision,
      attemptId: generated.attemptId,
      sourceManifest: generated.sourceManifest,
      sourceManifestSha256: generated.sourceManifestSha256,
      lectureNotesMarkdown: legacyNotes,
      slidesMarkdown: legacySlides,
      artifacts: generated.artifacts,
      invocation: generated.invocation,
      createdAt: generated.createdAt,
    };

    codex.response = latexResponse(['P1'], 1, 'Migrated the legacy revision.');
    const migrated = await service.send({
      studioId: studio.id,
      expectedVersion: initial.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: 'Preserve the supported content and update it.',
    });
    const promptPayload = JSON.parse(codex.prompt.slice(codex.prompt.indexOf('\n\n') + 2)) as {
      currentDraft: {
        sourceFormat: string;
        lectureNotes: string;
        slides: string;
      };
    };

    expect(promptPayload.currentDraft).toEqual({
      sourceFormat: 'legacy-markdown',
      lectureNotes: legacyNotes,
      slides: legacySlides,
    });
    expect(migrated.revision.schemaVersion).toBe(2);
  });

  it('marks a cancelled edit message interrupted and excludes it from the next prompt', async () => {
    const { service, storage, codex, projectA, projectB, paperA, paperB } = fixture();
    const studio = await service.create({
      title: 'Cancellation-isolated lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA, projectB],
      sourceSelection: {
        literature: [
          { projectId: projectA, recordId: paperA.id },
          { projectId: projectB, recordId: paperB.id },
        ],
        experiments: [],
      },
    });
    const initial = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.deferCompletion = true;
    const running = service.send({
      studioId: studio.id,
      expectedVersion: initial.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: 'CANCELLED-INSTRUCTION: replace the conclusion.',
    });
    await vi.waitFor(() => {
      expect(storage.getLectureStudio(studio.id)?.status).toBe('generating');
      expect(codex.lastTurnId).not.toBeNull();
    });
    const generating = storage.getLectureStudio(studio.id)!;
    const cancelled = await service.cancel({
      studioId: studio.id,
      attemptId: generating.activeAttemptId!,
      expectedVersion: generating.version,
    });
    await expect(running).rejects.toMatchObject({ code: 'lecture_cancelled' });
    expect(storage.messages.find((message) => message.role === 'user')).toMatchObject({
      status: 'interrupted',
      content: 'CANCELLED-INSTRUCTION: replace the conclusion.',
    });

    await service.send({
      studioId: studio.id,
      expectedVersion: cancelled.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: 'Preserve the conclusion and tighten its wording.',
    });
    expect(codex.prompt).toContain('Preserve the conclusion and tighten its wording.');
    expect(codex.prompt).not.toContain('CANCELLED-INSTRUCTION');
  });

  it('keeps Stop available through the required pair-compilation acceptance phase', async () => {
    let releaseCompilers!: () => void;
    const compilerGate = new Promise<void>((resolve) => {
      releaseCompilers = resolve;
    });
    const compile = vi.fn(async (input: Parameters<LectureDocumentCompiler['compile']>[0]) => {
      await compilerGate;
      const pdfBytes = Buffer.from('%PDF-1.7\n%%EOF\n');
      return {
        schemaVersion: 1 as const,
        artifactId: randomUUID(),
        title: `${input.title} PDF`,
        fileName: input.kind === 'lecture-notes' ? 'Lecture Notes.pdf' : 'Slides.pdf',
        compilerDisplayName: 'Fixture XeLaTeX',
        sourceDescription: 'Deferred acceptance fixture',
        pdfSha256: `sha256:${createHash('sha256').update(pdfBytes).digest('hex')}` as const,
        sizeBytes: pdfBytes.byteLength,
        compiledAt: new Date().toISOString(),
        pdfBase64: pdfBytes.toString('base64'),
      };
    });
    const { service, storage, codex, projectA, paperA } = fixture({
      pdfCompiler: { compile },
    });
    codex.response = latexResponse(['P1']);
    const studio = await service.create({
      title: 'Cancellable acceptance compile',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    const running = service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(2));
    const generating = storage.getLectureStudio(studio.id)!;

    const cancelled = await service.cancel({
      studioId: studio.id,
      attemptId: generating.activeAttemptId!,
      expectedVersion: generating.version,
    });
    releaseCompilers();

    await expect(running).rejects.toMatchObject({ code: 'lecture_cancelled' });
    expect(cancelled).toMatchObject({ status: 'failed', lastErrorCode: 'lecture_cancelled' });
    expect(storage.revisions).toEqual([]);
  });

  it('checks the Research Notes destination before starting Codex', async () => {
    const { service, storage, codex, artifactEvents, projectA, paperA } = fixture({
      artifactDestinationReady: false,
    });
    const studio = await service.create({
      title: 'Vault-required lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });

    await expect(
      service.generate({
        studioId: studio.id,
        expectedVersion: studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toMatchObject({ code: 'lecture_research_notes_required' });
    expect(codex.startInput).toBeNull();
    expect(artifactEvents).toEqual(['preflight']);
    expect(storage.studios[0]).toMatchObject({ status: 'draft', version: studio.version });
  });

  it('reports storage capacity before starting Codex', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    const studio = await service.create({
      title: 'Capacity-bounded lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    vi.spyOn(storage, 'beginLectureStudioTurn').mockImplementation(() => {
      throw new LectureStudioStorageError('capacity_reached');
    });

    await expect(
      service.generate({
        studioId: studio.id,
        expectedVersion: studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toMatchObject({ code: 'lecture_capacity_reached' });
    expect(codex.startInput).toBeNull();
    expect(storage.getLectureStudio(studio.id)).toMatchObject({ status: 'draft' });
  });

  it('requires a complete Sources used mapping and rejects unsupported citation syntax', async () => {
    for (const lectureNotesLatexBody of [
      '\\section{Notes}\nEvidence [P1].',
      '\\section{Notes}\nEvidence [P1].\n\\section{Sources used}\nNo mapped label.',
      '\\section{Notes}\nPandoc citation [@fake] and evidence [P1].\n\\section{Sources used}\n[P1] Paper A',
    ]) {
      const { service, storage, codex, projectA, paperA } = fixture();
      codex.response = {
        reply: 'Generated.',
        lectureNotesLatexBody,
        slidesLatexBody: lectureSlidesBody(['P1']),
      };
      const studio = await service.create({
        title: 'Cited lecture',
        kind: 'lecture',
        durationMinutes: null,
        outputProjectId: projectA,
        sourceProjectIds: [projectA],
        sourceSelection: {
          literature: [{ projectId: projectA, recordId: paperA.id }],
          experiments: [],
        },
      });

      await expect(
        service.generate({
          studioId: studio.id,
          expectedVersion: studio.version,
          requestedModelId: null,
          reasoningOptionId: null,
        }),
      ).rejects.toMatchObject({ code: 'lecture_invalid_response' });
      expect(storage.revisions).toEqual([]);
    }
  });

  it('rolls back the exact staged LaTeX bundle when DB completion fails', async () => {
    const { service, storage, codex, artifactEvents, projectA, paperA } = fixture();
    vi.spyOn(storage, 'completeLectureStudioTurn').mockImplementation(() => {
      throw new Error('db_write_failed');
    });
    codex.response = latexResponse(['P1']);
    const studio = await service.create({
      title: 'Recoverable lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });

    await expect(
      service.generate({
        studioId: studio.id,
        expectedVersion: studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toMatchObject({ code: 'lecture_persistence_failed' });
    expect(artifactEvents).toEqual(['preflight', 'stage', 'rollback']);
    expect(storage.revisions).toEqual([]);
  });

  it('rolls back when post-publish artifact validation fails before the stage call returns', async () => {
    const { service, storage, artifactEvents, projectA, projectB, paperA, paperB } = fixture({
      failAfterArtifactPublish: true,
    });
    const studio = await service.create({
      title: 'Post-publish failure',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA, projectB],
      sourceSelection: {
        literature: [
          { projectId: projectA, recordId: paperA.id },
          { projectId: projectB, recordId: paperB.id },
        ],
        experiments: [],
      },
    });

    await expect(
      service.generate({
        studioId: studio.id,
        expectedVersion: studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toMatchObject({ code: 'lecture_persistence_failed' });

    expect(artifactEvents).toEqual(['preflight', 'stage', 'rollback']);
    expect(storage.revisions).toEqual([]);
  });

  it('seals a crash-left pending bundle when list finds its exact committed revision', async () => {
    const pendingArtifacts: PendingLectureRevisionArtifacts[] = [];
    const { service, artifactEvents, projectA, projectB, paperA, paperB } = fixture({
      pendingArtifacts,
    });
    const studio = await service.create({
      title: 'Restart recovery',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA, projectB],
      sourceSelection: {
        literature: [
          { projectId: projectA, recordId: paperA.id },
          { projectId: projectB, recordId: paperB.id },
        ],
        experiments: [],
      },
    });
    const receipt = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    artifactEvents.splice(0);
    pendingArtifacts.push(pendingFromRevision(receipt.studio, receipt.revision));

    await service.list({});

    expect(artifactEvents).toEqual(['reconcile-confirm']);
  });

  it('rolls back an uncommitted stale bundle but skips the matching active attempt', async () => {
    const pendingArtifacts: PendingLectureRevisionArtifacts[] = [];
    const { service, storage, artifactEvents, projectA, projectB, paperA, paperB } = fixture({
      pendingArtifacts,
    });
    const studio = await service.create({
      title: 'Interrupted recovery',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA, projectB],
      sourceSelection: {
        literature: [
          { projectId: projectA, recordId: paperA.id },
          { projectId: projectB, recordId: paperB.id },
        ],
        experiments: [],
      },
    });
    const receipt = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    artifactEvents.splice(0);
    const base = pendingFromRevision(receipt.studio, receipt.revision);
    const staleAttemptId = randomUUID();
    const stale: PendingLectureRevisionArtifacts = {
      ...base,
      bundleId: 'd'.repeat(64),
      revision: 2,
      attemptId: staleAttemptId,
    };
    pendingArtifacts.push(stale);

    await service.detail({ studioId: studio.id });
    expect(artifactEvents).toEqual(['reconcile-rollback']);

    artifactEvents.splice(0);
    const current = storage.getLectureStudio(studio.id)!;
    storage.beginLectureStudioTurn({
      studioId: studio.id,
      expectedVersion: current.version,
      attemptId: staleAttemptId,
      userMessage: null,
      updatedAt: new Date().toISOString(),
    });
    await service.reconcilePendingArtifacts();
    expect(artifactEvents).toEqual([]);
  });

  it('rejects unknown citations, unsafe HTML, and a talk deck outside its time budget', async () => {
    const uncitedSlideDeck = Array.from(
      { length: 10 },
      (_, index) =>
        `\\begin{frame}{Slide ${index + 1}}\n${index === 1 ? 'Unsupported synthesis.' : 'Evidence [P1].'}\n\\end{frame}`,
    ).join('\n');
    for (const slidesLatexBody of [
      '\\begin{frame}{Talk}\nUnknown evidence [P99]\n\\end{frame}',
      '\\begin{frame}{Talk}\n<script>alert(1)</script> [P1]\n\\end{frame}',
      '\\begin{frame}{Talk}\n<div>raw HTML</div> [P1]\n\\end{frame>',
      '\\begin{frame}{Talk}\n\\includegraphics{https://example.invalid/plot.png} [P1]\n\\end{frame}',
      lectureSlidesBody(['P1'], 1),
      uncitedSlideDeck,
    ]) {
      const { service, storage, codex, projectA, paperA } = fixture();
      const studio = await service.create({
        title: 'Bounded talk',
        kind: 'talk',
        durationMinutes: 20,
        outputProjectId: projectA,
        sourceProjectIds: [projectA],
        sourceSelection: {
          literature: [{ projectId: projectA, recordId: paperA.id }],
          experiments: [],
        },
      });
      codex.response = {
        reply: 'Generated.',
        lectureNotesLatexBody: lectureNotesBody(['P1']),
        slidesLatexBody,
      };

      await expect(
        service.generate({
          studioId: studio.id,
          expectedVersion: studio.version,
          requestedModelId: null,
          reasoningOptionId: null,
        }),
      ).rejects.toMatchObject({ code: 'lecture_invalid_response' });
      expect(storage.revisions).toHaveLength(0);
    }
  });
});
