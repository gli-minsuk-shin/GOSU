import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  classifyLectureEvidenceLabelDirective,
  classifyLectureSourcesUsedDirective,
  classifyLectureTitleSlideDirective,
  applyLectureStudioRevisionPatch,
  LectureStudioService,
  LectureStudioServiceError,
  type LectureStudioStorage,
} from '../src/main/lecture-studio-service';
import type {
  LectureStudioAttachmentService,
  PreparedLectureStudioAttachments,
} from '../src/main/lecture-studio-attachment-service';
import {
  LECTURE_STUDIO_AUTHORING_POLICY_VERSION,
  LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS,
  LECTURE_STUDIO_RETIRED_TURN_ATTACHMENT_CITATION_MARKER,
} from '../src/main/lecture-studio-prompt';
import { CodexRequestError } from '../src/main/codex-app-server';
import {
  LectureDocumentCompilerError,
  type LectureDocumentCompiler,
} from '../src/main/lecture-document-compiler';
import type { LectureArtifactPlatform } from '../src/main/lecture-artifact-platform';
import type { LectureStudioFigureService } from '../src/main/lecture-studio-figure-service';
import { LectureStudioStorageError } from '../src/main/lecture-studio-storage-error';
import { extractEditableLectureLatexBody } from '../src/main/lecture-latex-source';
import type { ModelUsageService } from '../src/main/model-usage-service';
import type {
  LectureStudio,
  LectureStudioDetail,
  LectureStudioEvent,
  LectureStudioMessage,
  LectureStudioRevision,
  LectureStudioAttempt,
  LectureStudioAttemptPhase,
  LectureStudioAttemptValidation,
  EmptyLectureStudioTrashInput,
  EmptyLectureStudioTrashReceipt,
  PendingLectureRevisionArtifacts,
  LectureStudioFigureAsset,
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

const DEFAULT_DOCUMENT_FEATURES = {
  includeSlideTitlePage: true,
  showInlineEvidenceLabels: true,
  includeSourcesUsedSection: true,
} as const;

function lectureNotesBody(labels: readonly string[], title = 'Lecture notes') {
  return [
    `\\section{${title}}`,
    `Evidence ${labels.map((label) => `[${label}]`).join(' ')}.`,
    '\\section{Sources used}',
    ...labels.map((label) => `[${label}] Fixture source ${label}`),
  ].join('\n');
}

function lectureNotesBodyWithoutSources(labels: readonly string[], title = 'Lecture notes') {
  return [`\\section{${title}}`, `Evidence ${labels.map((label) => `[${label}]`).join(' ')}.`].join(
    '\n',
  );
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

function localizedFixtureEdit(document: 'lecture-notes' | 'slides', before: string, after: string) {
  if (before === after) return null;
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const originalEnd = before.length - suffix;
  let start = prefix;
  let end = originalEnd;
  if (start === end) {
    if (start > 0) start -= 1;
    else end = Math.min(before.length, end + 1);
  }
  while (
    before.indexOf(before.slice(start, end), start + Math.max(1, end - start)) >= 0 &&
    (start > 0 || end < before.length)
  ) {
    if (start > 0) start -= 1;
    if (end < before.length) end += 1;
  }
  return {
    document,
    find: before.slice(start, end),
    replace: `${before.slice(start, prefix)}${after.slice(prefix, after.length - suffix)}${before.slice(originalEnd, end)}`,
  } as const;
}

function legacyCanonicalLectureDocument(
  kind: 'lecture-notes' | 'slides',
  title: string,
  body: string,
) {
  const prefix =
    kind === 'lecture-notes'
      ? [
          '% GOSU-LECTURE-LATEX v1 lecture-notes',
          '\\documentclass[11pt]{article}',
          '\\usepackage{fontspec}',
          '\\usepackage{kotex}',
          '\\usepackage{amsmath,amssymb,mathtools}',
          '\\usepackage{amsthm}',
          '\\usepackage{bm}',
          '\\usepackage{booktabs,array,longtable}',
          '\\usepackage[margin=1in]{geometry}',
          '\\usepackage[hidelinks]{hyperref}',
          '\\newtheorem{theorem}{Theorem}',
          '\\newtheorem{proposition}{Proposition}',
          '\\newtheorem{lemma}{Lemma}',
          '\\newtheorem{definition}{Definition}',
          '\\newtheorem{remark}{Remark}',
          '\\newtheorem{example}{Example}',
          `\\title{${title}}`,
          '\\author{GOSU Lecture Studio}',
          '\\date{}',
          '\\begin{document}',
          '\\maketitle',
          '% GOSU-CONTENT-BEGIN',
        ]
      : [
          '% GOSU-LECTURE-LATEX v1 slides',
          '\\documentclass[aspectratio=169]{beamer}',
          '\\usepackage{fontspec}',
          '\\usepackage{kotex}',
          '\\usepackage{amsmath,amssymb,mathtools}',
          '\\usepackage{bm}',
          '\\usepackage{booktabs,array}',
          '\\usetheme{default}',
          '\\setbeamertemplate{navigation symbols}{}',
          '\\setbeamertemplate{footline}[frame number]',
          `\\title{${title}}`,
          '\\author{GOSU Lecture Studio}',
          '\\date{}',
          '\\begin{document}',
          '\\begin{frame}',
          '\\titlepage',
          '\\end{frame}',
          '% GOSU-CONTENT-BEGIN',
        ];
  return [...prefix, body, '% GOSU-CONTENT-END', '\\end{document}', ''].join('\n');
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
  readonly attempts: LectureStudioAttempt[] = [];
  readonly figures: LectureStudioFigureAsset[] = [];
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
          lastAttempt:
            this.attempts
              .filter((attempt) => attempt.studioId === studioId)
              .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null,
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

  listLectureStudioFigures(studioId: string) {
    return this.figures.filter((figure) => figure.studioId === studioId);
  }

  createLectureStudio(studio: LectureStudio) {
    this.studios.push(studio);
    return true;
  }

  updateLectureStudioGenerationBrief(
    studioId: string,
    expectedVersion: number,
    generationBrief: LectureStudio['generationBrief'],
    updatedAt: string,
  ) {
    const index = this.studios.findIndex(
      (studio) => studio.id === studioId && studio.version === expectedVersion,
    );
    if (index < 0) return null;
    const current = this.studios[index]!;
    if (current.trashedAt || current.status === 'generating' || current.activeAttemptId)
      return null;
    const updated: LectureStudio = {
      ...current,
      generationBrief,
      version: current.version + 1,
      updatedAt,
    };
    this.studios[index] = updated;
    return updated;
  }

  beginLectureStudioTurn(input: {
    studioId: string;
    expectedVersion: number;
    attemptId: string;
    userMessage: LectureStudioMessage | null;
    updatedAt: string;
    generationBrief?: LectureStudio['generationBrief'];
    attempt?: LectureStudioAttempt;
  }) {
    const index = this.studios.findIndex(
      (studio) => studio.id === input.studioId && studio.version === input.expectedVersion,
    );
    if (index < 0) return null;
    const current = this.studios[index]!;
    if (current.trashedAt !== undefined) return null;
    const generating: LectureStudio = {
      ...current,
      generationBrief: input.generationBrief ?? current.generationBrief,
      status: 'generating',
      activeAttemptId: input.attemptId,
      lastErrorCode: null,
      version: current.version + 1,
      updatedAt: input.updatedAt,
    };
    this.studios[index] = generating;
    if (input.userMessage) this.messages.push(input.userMessage);
    if (input.attempt) this.attempts.push(structuredClone(input.attempt));
    return generating;
  }

  recordLectureStudioAttemptInvocation(
    studioId: string,
    attemptId: string,
    input: ModelInvocation,
  ) {
    const index = this.attempts.findIndex(
      (attempt) =>
        attempt.id === attemptId && attempt.studioId === studioId && attempt.status === 'running',
    );
    if (index < 0) return null;
    const current = this.attempts[index]!;
    const updated: LectureStudioAttempt = {
      ...current,
      resolvedModelId: input.resolvedModelId,
      providerId: input.providerId,
      catalogVersion: input.catalogVersion,
    };
    this.attempts[index] = updated;
    return updated;
  }

  recordLectureStudioAttemptPhase(
    studioId: string,
    attemptId: string,
    input: LectureStudioAttemptPhase,
  ) {
    const index = this.attempts.findIndex(
      (attempt) =>
        attempt.id === attemptId && attempt.studioId === studioId && attempt.status === 'running',
    );
    if (index < 0) return null;
    const current = this.attempts[index]!;
    if (current.phases.some((phase) => phase.phase === input.phase)) return current;
    const updated: LectureStudioAttempt = {
      ...current,
      phases: [...current.phases, structuredClone(input)],
    };
    this.attempts[index] = updated;
    return updated;
  }

  recordLectureStudioAttemptValidation(
    studioId: string,
    attemptId: string,
    input: LectureStudioAttemptValidation,
  ) {
    const index = this.attempts.findIndex(
      (attempt) =>
        attempt.id === attemptId && attempt.studioId === studioId && attempt.status === 'running',
    );
    if (index < 0) return null;
    const current = this.attempts[index]!;
    if (current.validations.some((validation) => validation.pass === input.pass)) return null;
    const updated: LectureStudioAttempt = {
      ...current,
      validations: [...current.validations, structuredClone(input)],
    };
    this.attempts[index] = updated;
    return updated;
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
    const attemptIndex = this.attempts.findIndex(
      (attempt) => attempt.id === input.revision.attemptId && attempt.status === 'running',
    );
    if (attemptIndex >= 0) {
      const revisionInvocation = input.revision.invocation;
      this.attempts[attemptIndex] = {
        ...this.attempts[attemptIndex]!,
        status: 'succeeded',
        resolvedModelId:
          revisionInvocation?.resolvedModelId ?? this.attempts[attemptIndex]!.resolvedModelId,
        providerId: revisionInvocation?.providerId ?? this.attempts[attemptIndex]!.providerId,
        catalogVersion:
          revisionInvocation?.catalogVersion ?? this.attempts[attemptIndex]!.catalogVersion,
        reasoningOptionId:
          revisionInvocation?.reasoningOptionId ?? this.attempts[attemptIndex]!.reasoningOptionId,
        terminalCode: null,
        completedAt: input.studio.updatedAt,
      };
    }
    return input.studio;
  }

  commitManualLectureStudioRevision(input: {
    studioId: string;
    expectedVersion: number;
    expectedCurrentRevision: number;
    revision: Extract<LectureStudioRevision, { schemaVersion: 4 }>;
    updatedAt: string;
  }) {
    const index = this.studios.findIndex(
      (studio) =>
        studio.id === input.studioId &&
        studio.version === input.expectedVersion &&
        studio.currentRevision === input.expectedCurrentRevision &&
        !studio.activeAttemptId &&
        (studio.status === 'ready' || studio.status === 'failed'),
    );
    if (index < 0 || input.revision.revision !== input.expectedCurrentRevision + 1) return null;
    const current = this.studios[index]!;
    const updated: LectureStudio = {
      ...current,
      status: 'ready',
      activeAttemptId: null,
      currentRevision: input.revision.revision,
      version: current.version + 1,
      lastErrorCode: null,
      updatedAt: input.updatedAt,
    };
    this.revisions.push(input.revision);
    this.studios[index] = updated;
    return updated;
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
    const attemptIndex = this.attempts.findIndex(
      (attempt) => attempt.id === input.attemptId && attempt.status === 'running',
    );
    if (attemptIndex >= 0) {
      this.attempts[attemptIndex] = {
        ...this.attempts[attemptIndex]!,
        status: input.messageStatus === 'interrupted' ? 'interrupted' : 'failed',
        terminalCode: input.errorCode as LectureStudioAttempt['terminalCode'],
        completedAt: input.updatedAt,
      };
    }
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
    const actualTargets = doomed
      .map((studio) => ({
        studioId: studio.id,
        expectedVersion: studio.version,
        trashedAt: studio.trashedAt!,
      }))
      .sort((left, right) => left.studioId.localeCompare(right.studioId));
    if (JSON.stringify(actualTargets) !== JSON.stringify(input.targets)) {
      throw new LectureStudioStorageError('trash_changed');
    }
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
      '\\section{Lecture notes}\nEvidence [P1] [P2].\n\\section{Sources used}\n[P1] Paper A\n[P2] Paper B',
    slidesLatexBody: Array.from(
      { length: 10 },
      (_, index) =>
        `\\begin{frame}{Slide ${index + 1}}\nEvidence [P${index % 2 === 0 ? 1 : 2}]\n\\end{frame}`,
    ).join('\n'),
  };
  startInput: Record<string, unknown> | null = null;
  prompt = '';
  prompts: string[] = [];
  outputSchemas: Array<Readonly<Record<string, unknown>> | null> = [];
  localImagePaths: readonly string[] = [];
  responseQueue: unknown[] = [];
  invocations: ModelInvocation[] = [];
  runTurnErrors = new Map<number, Error>();
  deferCompletion = false;
  deferTurnNumbers = new Set<number>();
  deferredTurnActive = false;
  interruptions: Array<{ threadId: string; turnId: string }> = [];
  terminalStatus = 'completed';
  terminalError: unknown = null;
  terminalGosuErrorCode: string | null = null;
  rejectNativeImageBeforeRunTurnReturn = false;
  startError: Error | null = null;
  lastThreadId: string | null = null;
  lastTurnId: string | null = null;
  turnSequence = 0;
  revisionPatchBase: { lectureNotes: string; slides: string } | null = null;

  async startThread(input: Record<string, unknown>) {
    if (this.startError) throw this.startError;
    this.startInput = input;
    return { threadId: 'lecture-thread' };
  }

  async runTurn(input: {
    threadId: string;
    prompt: string;
    requestedModelId: string | null;
    localImagePaths?: readonly string[];
    outputSchema?: Readonly<Record<string, unknown>>;
  }) {
    this.prompt = input.prompt;
    this.prompts.push(input.prompt);
    this.outputSchemas.push(input.outputSchema ?? null);
    this.localImagePaths = input.localImagePaths ?? [];
    this.turnSequence += 1;
    const runTurnError = this.runTurnErrors.get(this.turnSequence);
    if (runTurnError) throw runTurnError;
    const turnId = this.turnSequence === 1 ? 'lecture-turn' : `lecture-turn-${this.turnSequence}`;
    let response = this.responseQueue.shift() ?? this.response;
    const payloadStart = input.prompt.indexOf('\n\n');
    if (payloadStart >= 0) {
      try {
        const payload = JSON.parse(input.prompt.slice(payloadStart + 2)) as {
          currentDraft?: {
            sourceFormat?: string;
            lectureNotes?: string;
            slides?: string;
          } | null;
        };
        if (
          payload.currentDraft?.sourceFormat === 'latex' &&
          typeof payload.currentDraft.lectureNotes === 'string' &&
          typeof payload.currentDraft.slides === 'string'
        ) {
          this.revisionPatchBase = {
            lectureNotes: payload.currentDraft.lectureNotes,
            slides: payload.currentDraft.slides,
          };
        }
      } catch {
        // Correction prompts intentionally reuse the original thread payload.
      }
    }
    const outputRequired = Array.isArray(input.outputSchema?.required)
      ? input.outputSchema.required
      : [];
    if (
      outputRequired.includes('edits') &&
      this.revisionPatchBase &&
      response !== null &&
      typeof response === 'object' &&
      typeof (response as { reply?: unknown }).reply === 'string' &&
      typeof (response as { lectureNotesLatexBody?: unknown }).lectureNotesLatexBody === 'string' &&
      typeof (response as { slidesLatexBody?: unknown }).slidesLatexBody === 'string'
    ) {
      const full = response as {
        reply: string;
        lectureNotesLatexBody: string;
        slidesLatexBody: string;
      };
      const edits = [
        localizedFixtureEdit(
          'lecture-notes',
          this.revisionPatchBase.lectureNotes,
          full.lectureNotesLatexBody,
        ),
        localizedFixtureEdit('slides', this.revisionPatchBase.slides, full.slidesLatexBody),
      ].filter((edit): edit is NonNullable<typeof edit> => edit !== null);
      response = { reply: full.reply, edits };
    }
    const turnInvocation = invocation(input.requestedModelId);
    this.invocations.push(turnInvocation);
    this.lastThreadId = input.threadId;
    this.lastTurnId = turnId;
    if (this.rejectNativeImageBeforeRunTurnReturn) {
      this.emit('notification', {
        method: 'gosu/attachment-model-modality-rejected',
        params: { threadId: input.threadId, turnId },
      });
    }
    this.deferredTurnActive = this.deferCompletion || this.deferTurnNumbers.has(this.turnSequence);
    if (!this.deferredTurnActive) {
      queueMicrotask(() => {
        this.emit('notification', {
          method: 'item/completed',
          params: {
            threadId: input.threadId,
            turnId,
            item: {
              type: 'agentMessage',
              phase: 'final_answer',
              text: JSON.stringify(response),
            },
          },
        });
        this.emit('notification', {
          method: 'turn/completed',
          params: {
            threadId: input.threadId,
            turn: { id: turnId, status: this.terminalStatus, error: this.terminalError },
            ...(this.terminalGosuErrorCode ? { gosuErrorCode: this.terminalGosuErrorCode } : {}),
          },
        });
      });
    }
    return { turnId, invocation: turnInvocation };
  }

  async interruptTurn(threadId: string, turnId: string) {
    this.interruptions.push({ threadId, turnId });
    if (!this.deferredTurnActive) return;
    this.deferCompletion = false;
    this.deferredTurnActive = false;
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
    this.deferredTurnActive = false;
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
        turn: { id: this.lastTurnId, status, error: this.terminalError },
        ...(this.terminalGosuErrorCode ? { gosuErrorCode: this.terminalGosuErrorCode } : {}),
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
    externalSourceContent?: string;
    pdfCompiler?: Pick<LectureDocumentCompiler, 'compile'>;
    artifactPlatform?: LectureArtifactPlatform;
    attachments?: Pick<LectureStudioAttachmentService, 'prepare'>;
    figures?: Pick<
      LectureStudioFigureService,
      'list' | 'snapshotFigures' | 'snapshotRevisionFigures' | 'materializeActiveFigures'
    >;
    prepareDirectory?: (outputProjectId: string) => Promise<string>;
    timeoutMs?: number;
    hardTimeoutMs?: number;
    usage?: Pick<ModelUsageService, 'bindThread' | 'releaseThread'>;
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
  const externalSourceCalls = {
    claimed: [] as Array<{
      projectId: string;
      studioId: string;
      sourceSetId: string;
      selectedSourceIds: readonly string[];
    }>,
    discarded: [] as Array<{ projectId: string; sourceSetId: string }>,
    snapshotted: [] as Array<{ projectId: string; studioId: string; sourceIds: readonly string[] }>,
    purged: [] as Array<{ projectId: string; studioId: string }>,
    rolledBack: [] as Array<{ projectId: string; studioId: string }>,
  };
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
    externalSources: {
      claim: async (input) => {
        externalSourceCalls.claimed.push(input);
        return { schemaVersion: 1 as const, ...input, sources: [] };
      },
      discard: async (input) => {
        externalSourceCalls.discarded.push(input);
        return { discarded: true as const };
      },
      snapshots: async (input) => {
        externalSourceCalls.snapshotted.push(input);
        const content = options.externalSourceContent;
        if (content === undefined) return [];
        const sourceId = input.sourceIds[0]!;
        return [
          {
            schemaVersion: 1 as const,
            id: sourceId,
            projectId: input.projectId,
            studioId: input.studioId,
            sourceLabel: 'F1',
            displayName: 'external-evidence.md',
            kind: 'markdown' as const,
            mediaType: 'text/markdown' as const,
            byteSize: Buffer.byteLength(content, 'utf8'),
            sourceSha256: hash(content),
            extraction: {
              policyVersion: 1 as const,
              characterBudget: 40_000,
              unitLabel: 'part' as const,
              unitCount: 1,
              content,
              contentSha256: hash(content),
              extractedCharacters: content.length,
              truncated: false,
              textAvailable: true,
              reconstructionNotice: 'Exact UTF-8 source text.',
            },
            importedAt: new Date().toISOString(),
          },
        ];
      },
      purgeStudio: async (input) => {
        externalSourceCalls.purged.push(input);
        return { purged: true as const };
      },
      rollbackClaim: async (input) => {
        externalSourceCalls.rolledBack.push(input);
        return { rolledBack: true as const, cleanupPending: false };
      },
    },
    ...(options.attachments ? { attachments: options.attachments } : {}),
    ...(options.figures ? { figures: options.figures } : {}),
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
          return revision.schemaVersion !== 1
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
    ...(options.usage ? { usage: options.usage } : {}),
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
    prepareDirectory: options.prepareDirectory ?? (async () => '/tmp/gosu-lecture-studio-fixture'),
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
    externalSourceCalls,
    pendingArtifacts: options.pendingArtifacts ?? [],
    usage: options.usage,
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
    ...(revision.schemaVersion === 3
      ? {
          generationBriefSha256: revision.generationBriefSha256,
          authoringPolicyVersion: revision.authoringPolicyVersion,
          authoringPolicySha256: revision.authoringPolicySha256,
        }
      : {}),
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
  it.each([
    ['Remove Sources used but keep inline citations.', 'omitted'],
    ["Don't include the Sources used section.", 'omitted'],
    ["Remove Sources used and don't add it back.", 'omitted'],
    ['Sources used 섹션을 삭제하지 마.', 'required'],
    ['Sources used 섹션은 넣지 마.', 'omitted'],
    ['Sources used 섹션을 지우고 inline citation은 유지해.', 'omitted'],
    ['I did not ask to remove Sources used.', 'required'],
    ['Sources used 앞의 17만 지워줘.', null],
    ['Sources used section 을 아예 빼달라니까.', 'omitted'],
    ['Sources used" 이부분 지워줘', 'omitted'],
    ['Sources used를 아예 빼달라고 했잖아.', 'omitted'],
    ['Sources used를 없애면 출처는 어떻게 확인해?', null],
    ['Sources used section 다시 넣어줘.', 'required'],
    ['Do not exclude the Sources used section.', 'required'],
    ["Don't get rid of Sources used.", 'required'],
    ["Don't bring back Sources used.", 'omitted'],
    ['Sources used section 추가 안 해도 돼.', 'omitted'],
    ['Sources used 없어도 돼.', 'omitted'],
    ['Sources used 필요 없어.', 'omitted'],
    ['Sources used 안 넣어도 돼.', 'omitted'],
    ['Sources used는 없어도 돼.', 'omitted'],
    ['Sources used 섹션은 필요 없어.', 'omitted'],
    ['Sources used를 안 넣어도 돼.', 'omitted'],
    ['출처 섹션은 필요 없어.', 'omitted'],
    ["I don't want a Sources used section.", 'omitted'],
    ["I don't need a Sources used section.", 'omitted'],
    ['Leave out Sources used.', 'omitted'],
    ['Can you generate without Sources used?', 'omitted'],
    ['What happens without Sources used?', null],
    ["What happens if we don't include Sources used?", null],
    ['The phrase says “remove Sources used”; what does it mean?', null],
    ['The phrase says ‘remove Sources used’; what does it mean?', null],
    ['The phrase says `remove Sources used`; what does it mean?', null],
    ["I don't want to remove Sources used.", 'required'],
    ["I don't want you to remove Sources used.", 'required'],
    ["Don't leave out Sources used.", 'required'],
    ['Can you not remove Sources used?', 'required'],
    ["Don't ever remove Sources used.", 'required'],
    ['Sources used를 삭제하고 싶지 않아.', 'required'],
    [
      '"반드시 마지막에 Sources used 출처 매핑으로 끝나야 하므로 해당 섹션을 완전히 삭제할 수 없습니다." 이게 무슨이야기야?',
      null,
    ],
    ['Sources used를 삭제하라는 게 무슨 뜻이야?', null],
  ] as const)('classifies a target-scoped source-list directive: %s', (request, expected) => {
    expect(classifyLectureSourcesUsedDirective(request)).toBe(expected);
  });

  it('applies ordered exact localized revision edits without regenerating either document', () => {
    expect(
      applyLectureStudioRevisionPatch(
        {
          lectureNotes: '\\section{Intro}\nKeep this.\n\\section{Sources used}\n[P1] Paper',
          slides: '\\begin{frame}{Intro}\nKeep this. [P1]\n\\end{frame}',
        },
        {
          reply: 'Removed the source list.',
          edits: [
            {
              document: 'lecture-notes',
              find: '\n\\section{Sources used}\n[P1] Paper',
              replace: '',
            },
          ],
        },
      ),
    ).toEqual({
      lectureNotes: '\\section{Intro}\nKeep this.',
      slides: '\\begin{frame}{Intro}\nKeep this. [P1]\n\\end{frame}',
    });
  });

  it('rejects missing, ambiguous, no-op, and near-full-document revision edits', () => {
    const base = { lectureNotes: 'Repeated. Repeated.', slides: 'x'.repeat(5_000) };
    for (const edit of [
      { document: 'lecture-notes' as const, find: 'Missing', replace: 'Changed' },
      { document: 'lecture-notes' as const, find: 'Repeated.', replace: 'Changed.' },
      {
        document: 'lecture-notes' as const,
        find: 'Repeated. Repeated.',
        replace: base.lectureNotes,
      },
      { document: 'slides' as const, find: 'x'.repeat(4_500), replace: 'Changed' },
    ]) {
      expect(() =>
        applyLectureStudioRevisionPatch(base, { reply: 'Edit.', edits: [edit] }),
      ).toThrow();
    }
    expect(() =>
      applyLectureStudioRevisionPatch(
        {
          lectureNotes: `${'a'.repeat(2_100)}x${'b'.repeat(2_100)}y${'c'.repeat(800)}`,
          slides: 'Slide [P1].',
        },
        {
          reply: 'Rewrite.',
          edits: [
            { document: 'lecture-notes', find: 'a'.repeat(2_100), replace: 'd'.repeat(2_100) },
            { document: 'lecture-notes', find: 'b'.repeat(2_100), replace: 'e'.repeat(2_100) },
          ],
        },
      ),
    ).toThrow('lecture_revision_patch_not_localized');
    expect(() =>
      applyLectureStudioRevisionPatch(
        { lectureNotes: `Target\n${'a'.repeat(4_999)}`, slides: 'Slide [P1].' },
        {
          reply: 'Rewrite.',
          edits: [
            {
              document: 'lecture-notes',
              find: 'Target',
              replace: 'Replacement'.repeat(410),
            },
          ],
        },
      ),
    ).toThrow('lecture_revision_patch_not_localized');
  });

  it('corrects a non-unique model edit against the same frozen draft without requesting full bodies', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    codex.response = latexResponse(['P1']);
    const studio = await service.create({
      title: 'Localized revision correction',
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
    if (initial.revision.schemaVersion === 1) throw new Error('expected LaTeX revision');
    codex.responseQueue = [
      {
        reply: 'Ambiguous edit.',
        edits: [{ document: 'lecture-notes', find: '[P1]', replace: '[P1] revised' }],
      },
      {
        reply: 'Updated only the heading.',
        edits: [
          {
            document: 'lecture-notes',
            find: '\\section{Lecture notes}',
            replace: '\\section{Revised lecture notes}',
          },
        ],
      },
    ];

    const revised = await service.send({
      studioId: studio.id,
      expectedVersion: initial.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: '첫 section 제목만 더 명확하게 고쳐줘.',
    });

    if (revised.revision.schemaVersion === 1) throw new Error('expected LaTeX revision');
    expect(revised.revision.lectureNotesLatex).toContain('\\section{Revised lecture notes}');
    expect(revised.revision.slidesLatex).toBe(initial.revision.slidesLatex);
    expect(codex.outputSchemas.slice(-2).map((schema) => schema?.required)).toEqual([
      ['reply', 'edits'],
      ['reply', 'edits'],
    ]);
    expect(codex.prompts.at(-1)).toContain('smallest corrected edits');
    expect(codex.prompts.at(-1)).toContain('never resend a complete body');
    expect(storage.attempts.at(-1)?.validations).toEqual([
      expect.objectContaining({ pass: 'initial', category: 'response_schema' }),
    ]);
  });

  it.each([
    ['Remove the title slide.', false],
    ["Don't remove the title slide.", true],
    ['제목 슬라이드를 빼줘.', false],
    ['제목 슬라이드를 빼달라고 했는데 왜 안 돼?', false],
    ['제목 슬라이드를 빼면 어떻게 돼?', null],
    ['타이틀 슬라이드를 다시 넣어줘.', true],
    ['Remove the introduction slide.', null],
    ['Can you generate without the title slide?', false],
    ['What would the deck look like without the title slide?', null],
    ["What happens if I don't remove the title slide?", null],
    ['"Remove the title slide" 이게 무슨 뜻이야?', null],
    ['제목 슬라이드를 없애라는 게 무슨 뜻이야?', null],
  ] as const)('classifies a target-scoped title-slide directive: %s', (request, expected) => {
    expect(classifyLectureTitleSlideDirective(request)).toBe(expected);
  });

  it.each([
    ['Hide the source markers.', false],
    ["Don't hide the citation markers.", true],
    ['Evidence citations을 숨겨줘.', false],
    ['출처 마커를 숨겨달라고 했는데 왜 안 돼?', false],
    ['출처 마커를 숨기면 어떤 문제가 생겨?', null],
    ['인용 마커를 다시 표시해줘.', true],
    ['Hide the slide numbers.', null],
    ['"Hide the evidence citations" 이게 무슨 이야기야?', null],
    ['출처 마커를 숨기라는 게 무슨 뜻이야?', null],
  ] as const)('classifies a target-scoped evidence-label directive: %s', (request, expected) => {
    expect(classifyLectureEvidenceLabelDirective(request)).toBe(expected);
  });

  it('uses one-turn attachments as A-labelled evidence and commits them only with the revision', async () => {
    const attachmentId = randomUUID();
    const attachmentContent = '# Attached theorem\n\nThe variance is bounded by the cited lemma.';
    const commit = vi.fn(async () => undefined);
    const rollback = vi.fn(async () => undefined);
    const prepare = vi.fn(
      async (studio: LectureStudio, _attachmentIds: readonly string[]) =>
        ({
          cards: [
            {
              id: attachmentId,
              displayName: 'revision-evidence.md',
              format: 'markdown',
              byteSize: Buffer.byteLength(attachmentContent, 'utf8'),
              sha256: hash(attachmentContent),
              unitLabel: 'part',
              unitCount: 1,
              extractedCharacters: attachmentContent.length,
              truncated: false,
              textAvailable: true,
              reconstructionNotice: 'Exact UTF-8 source text.',
              expiresAt: '2026-08-16T01:00:00.000Z',
            },
          ],
          snapshots: [
            {
              sourceLabel: 'A1',
              attachmentId,
              projectId: studio.outputProjectId,
              studioId: studio.id,
              displayName: 'revision-evidence.md',
              format: 'markdown',
              byteSize: Buffer.byteLength(attachmentContent, 'utf8'),
              sourceSha256: hash(attachmentContent),
              unitLabel: 'part',
              unitCount: 1,
              content: attachmentContent,
              contentSha256: hash(attachmentContent),
              extractedCharacters: attachmentContent.length,
              truncated: false,
              reconstructionNotice: 'Exact UTF-8 source text.',
              capturedAt: '2026-08-16T00:00:00.000Z',
            },
          ],
          commit,
          rollback,
        }) satisfies PreparedLectureStudioAttachments,
    );
    const { service, storage, codex, projectA, paperA } = fixture({
      attachments: { prepare },
    });
    codex.response = latexResponse(['P1']);
    const studio = await service.create({
      title: 'Attachment-backed edit',
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

    codex.response = latexResponse(['A1'], 1, 'Applied the attached evidence.');
    const edited = await service.send({
      studioId: studio.id,
      expectedVersion: initial.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: 'Use the attached lemma to revise the explanation.',
      attachmentIds: [attachmentId],
    });

    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ id: studio.id, version: initial.studio.version }),
      [attachmentId],
    );
    expect(codex.prompt).toContain('"sourceLabel":"A1"');
    expect(codex.prompt).toContain(JSON.stringify(attachmentContent));
    expect(edited.revision.sourceManifest.schemaVersion).toBe(4);
    if (edited.revision.sourceManifest.schemaVersion !== 4) {
      throw new Error('Expected a turn-attachment source manifest');
    }
    expect(edited.revision.sourceManifest.turnAttachments).toEqual([
      expect.objectContaining({
        sourceLabel: 'A1',
        attachmentId,
        studioId: studio.id,
        content: attachmentContent,
        contentSha256: hash(attachmentContent),
      }),
    ]);
    expect(
      storage.messages.find((message) => message.content.startsWith('Use the attached')),
    ).toMatchObject({
      role: 'user',
      status: 'complete',
      attachments: [
        expect.objectContaining({ id: attachmentId, displayName: 'revision-evidence.md' }),
      ],
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();

    codex.response = latexResponse(['P1'], 1, 'Edited without the prior attachment.');
    const later = await service.send({
      studioId: studio.id,
      expectedVersion: edited.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: 'Tighten the introduction without added files.',
    });
    expect(later.revision.sourceManifest.schemaVersion).not.toBe(4);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(codex.prompt).not.toContain(attachmentContent);
    const laterPromptPayload = JSON.parse(codex.prompt.slice(codex.prompt.indexOf('\n\n') + 2)) as {
      currentDraft: { lectureNotes: string; slides: string };
    };
    expect(laterPromptPayload.currentDraft.lectureNotes).toContain(
      LECTURE_STUDIO_RETIRED_TURN_ATTACHMENT_CITATION_MARKER,
    );
    expect(laterPromptPayload.currentDraft.slides).toContain(
      LECTURE_STUDIO_RETIRED_TURN_ATTACHMENT_CITATION_MARKER,
    );
    expect(laterPromptPayload.currentDraft.lectureNotes).not.toContain('[A1]');
    expect(laterPromptPayload.currentDraft.slides).not.toContain('[A1]');
    expect(laterPromptPayload.currentDraft.lectureNotes).not.toContain('Fixture source A1');
  });

  it('does not silently rebind an unchanged prior A1 draft to unrelated new A1 evidence', async () => {
    const oldAttachmentId = randomUUID();
    const newAttachmentId = randomUUID();
    const oldContent = 'PRIVATE-OLD-ATTACHMENT-RAW-CONTENT';
    const newContent = 'Unrelated new attachment evidence.';
    const sharedRawSourceSha256 = hash('same-raw-file-bytes');
    const attachmentById = new Map<
      string,
      { displayName: string; content: string; sourceSha256: string }
    >([
      [
        oldAttachmentId,
        {
          displayName: 'same-raw-source.md',
          content: oldContent,
          sourceSha256: sharedRawSourceSha256,
        },
      ],
      [
        newAttachmentId,
        {
          displayName: 'same-raw-source.md',
          content: newContent,
          sourceSha256: sharedRawSourceSha256,
        },
      ],
    ]);
    const prepare = vi.fn(async (studio: LectureStudio, attachmentIds: readonly string[]) => {
      const selected = attachmentIds.map((id) => {
        const attachment = attachmentById.get(id);
        if (!attachment) throw new Error('unknown_attachment');
        return { id, ...attachment };
      });
      return {
        cards: selected.map((attachment) => ({
          id: attachment.id,
          displayName: attachment.displayName,
          format: 'markdown' as const,
          byteSize: Buffer.byteLength(attachment.content, 'utf8'),
          sha256: attachment.sourceSha256,
          unitLabel: 'part' as const,
          unitCount: 1,
          extractedCharacters: attachment.content.length,
          truncated: false,
          textAvailable: true as const,
          reconstructionNotice: 'Exact UTF-8 source text.',
          expiresAt: '2026-08-16T01:00:00.000Z',
        })),
        snapshots: selected.map((attachment, index) => ({
          sourceLabel: `A${index + 1}` as 'A1',
          attachmentId: attachment.id,
          projectId: studio.outputProjectId,
          studioId: studio.id,
          displayName: attachment.displayName,
          format: 'markdown' as const,
          byteSize: Buffer.byteLength(attachment.content, 'utf8'),
          sourceSha256: attachment.sourceSha256,
          unitLabel: 'part' as const,
          unitCount: 1,
          content: attachment.content,
          contentSha256: hash(attachment.content),
          extractedCharacters: attachment.content.length,
          truncated: false,
          reconstructionNotice: 'Exact UTF-8 source text.',
          capturedAt: '2026-08-16T00:00:00.000Z',
        })),
        commit: vi.fn(async () => undefined),
        rollback: vi.fn(async () => undefined),
      } satisfies PreparedLectureStudioAttachments;
    });
    const { service, storage, codex, projectA, paperA } = fixture({ attachments: { prepare } });
    codex.response = latexResponse(['P1']);
    const studio = await service.create({
      title: 'Attachment label isolation',
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
    const oldDraftResponse = {
      reply: 'Applied the old attachment as [A1].',
      lectureNotesLatexBody: [
        '\\section{Old attachment result}',
        'A claim from the old attachment [A1].',
        '\\section{Sources used}',
        '[A1] same-raw-source.md',
      ].join('\n'),
      slidesLatexBody: [
        '\\begin{frame}{Old attachment result}',
        'A claim from the old attachment [A1].',
        '\\end{frame}',
      ].join('\n'),
    };
    codex.response = oldDraftResponse;
    const oldAttachmentRevision = await service.send({
      studioId: studio.id,
      expectedVersion: initial.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: 'Use the old attachment as [A1].',
      attachmentIds: [oldAttachmentId],
    });
    const promptCountBeforeRebindAttempt = codex.prompts.length;

    await expect(
      service.send({
        studioId: studio.id,
        expectedVersion: oldAttachmentRevision.studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
        message: 'Use this unrelated replacement attachment as [A1].',
        attachmentIds: [newAttachmentId],
      }),
    ).rejects.toMatchObject({ code: 'lecture_invalid_citation_mapping' });

    const rebindPrompt = codex.prompts[promptCountBeforeRebindAttempt]!;
    const rebindPayload = JSON.parse(rebindPrompt.slice(rebindPrompt.indexOf('\n\n') + 2)) as {
      sourceManifest: {
        turnAttachments: Array<{ sourceLabel: string; displayName: string; content: string }>;
      };
      currentDraft: { lectureNotes: string; slides: string };
      recentStudioChat: Array<{ role: string; content: string }>;
      request: string;
    };
    expect(rebindPayload.sourceManifest.turnAttachments).toEqual([
      expect.objectContaining({
        sourceLabel: 'A1',
        displayName: 'same-raw-source.md',
        content: newContent,
      }),
    ]);
    expect(rebindPayload.currentDraft.lectureNotes).toContain(
      LECTURE_STUDIO_RETIRED_TURN_ATTACHMENT_CITATION_MARKER,
    );
    expect(rebindPayload.currentDraft.slides).toContain(
      LECTURE_STUDIO_RETIRED_TURN_ATTACHMENT_CITATION_MARKER,
    );
    expect(rebindPayload.currentDraft.lectureNotes).not.toContain('[A1]');
    expect(rebindPayload.currentDraft.slides).not.toContain('[A1]');
    expect(rebindPayload.recentStudioChat.some((message) => message.content.includes('[A1]'))).toBe(
      false,
    );
    expect(
      rebindPayload.recentStudioChat.some((message) =>
        message.content.includes(LECTURE_STUDIO_RETIRED_TURN_ATTACHMENT_CITATION_MARKER),
      ),
    ).toBe(true);
    expect(rebindPayload.request).toBe('Use this unrelated replacement attachment as [A1].');
    expect(rebindPrompt).not.toContain(oldContent);
    expect(oldAttachmentRevision.revision).toMatchObject({
      schemaVersion: 3,
      lectureNotesLatex: expect.stringContaining('\\gosuevidence{A1} same-raw-source.md'),
    });
    expect(storage.revisions.at(-1)).toMatchObject({
      schemaVersion: 3,
      lectureNotesLatex: expect.stringContaining('\\gosuevidence{A1} same-raw-source.md'),
    });
  });

  it('preserves staged one-turn attachments when an edit fails so the same IDs can retry', async () => {
    const attachmentId = randomUUID();
    const content = 'Retryable attachment evidence.';
    const commits: Array<ReturnType<typeof vi.fn>> = [];
    const rollbacks: Array<ReturnType<typeof vi.fn>> = [];
    const prepare = vi.fn(async (studio: LectureStudio) => {
      const commit = vi.fn(async () => undefined);
      const rollback = vi.fn(async () => undefined);
      commits.push(commit);
      rollbacks.push(rollback);
      return {
        cards: [
          {
            id: attachmentId,
            displayName: 'retry.md',
            format: 'markdown' as const,
            byteSize: content.length,
            sha256: hash(content),
            unitLabel: 'part' as const,
            unitCount: 1,
            extractedCharacters: content.length,
            truncated: false,
            textAvailable: true as const,
            reconstructionNotice: 'Exact UTF-8 source text.',
            expiresAt: '2026-08-16T01:00:00.000Z',
          },
        ],
        snapshots: [
          {
            sourceLabel: 'A1',
            attachmentId,
            projectId: studio.outputProjectId,
            studioId: studio.id,
            displayName: 'retry.md',
            format: 'markdown' as const,
            byteSize: content.length,
            sourceSha256: hash(content),
            unitLabel: 'part' as const,
            unitCount: 1,
            content,
            contentSha256: hash(content),
            extractedCharacters: content.length,
            truncated: false,
            reconstructionNotice: 'Exact UTF-8 source text.',
            capturedAt: '2026-08-16T00:00:00.000Z',
          },
        ],
        commit,
        rollback,
      } satisfies PreparedLectureStudioAttachments;
    });
    const { service, storage, codex, projectA, paperA } = fixture({ attachments: { prepare } });
    codex.response = latexResponse(['P1']);
    const studio = await service.create({
      title: 'Retryable attachment edit',
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
    codex.response = { reply: 'Missing both required documents.' };

    await expect(
      service.send({
        studioId: studio.id,
        expectedVersion: initial.studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
        message: 'Apply this attachment.',
        attachmentIds: [attachmentId],
      }),
    ).rejects.toMatchObject({ code: 'lecture_invalid_response_schema' });
    expect(commits[0]).not.toHaveBeenCalled();
    expect(rollbacks[0]).toHaveBeenCalledTimes(1);

    const failed = storage.getLectureStudio(studio.id)!;
    codex.response = latexResponse(['A1']);
    await service.send({
      studioId: studio.id,
      expectedVersion: failed.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: 'Retry with the same attachment.',
      attachmentIds: [attachmentId],
    });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(commits[1]).toHaveBeenCalledTimes(1);
    expect(rollbacks[1]).not.toHaveBeenCalled();
  });

  it('creates and generates from one frozen external file with F-label provenance', async () => {
    const externalSourceId = randomUUID();
    const sourceSetId = randomUUID();
    const externalContent = '# External theorem\n\nThe estimator is consistent under assumption A.';
    const { service, codex, projectA, externalSourceCalls } = fixture({
      externalSourceContent: externalContent,
    });
    codex.response = latexResponse(['F1'], 1, 'Created from the frozen external source.');

    const studio = await service.create({
      title: 'External source lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [],
        experiments: [],
        manuscripts: [],
        externalSources: { sourceSetId, sourceIds: [externalSourceId] },
      },
    });

    expect(externalSourceCalls.claimed).toEqual([
      {
        projectId: projectA,
        studioId: studio.id,
        sourceSetId,
        selectedSourceIds: [externalSourceId],
      },
    ]);
    expect(externalSourceCalls.discarded).toEqual([{ projectId: projectA, sourceSetId }]);

    const receipt = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });

    expect(receipt.revision.sourceManifest.schemaVersion).toBe(3);
    if (receipt.revision.sourceManifest.schemaVersion !== 3) {
      throw new Error('Expected an external-source manifest');
    }
    expect(receipt.revision.sourceManifest.externalSources).toEqual([
      expect.objectContaining({
        sourceLabel: 'F1',
        projectId: projectA,
        studioId: studio.id,
        id: externalSourceId,
        sourceSha256: hash(externalContent),
        extraction: expect.objectContaining({ content: externalContent, truncated: false }),
      }),
    ]);
    expect(codex.prompt).toContain(JSON.stringify(externalContent));
    expect(codex.prompt).toContain('"sourceLabel":"F1"');
    if (receipt.revision.schemaVersion === 1) {
      throw new Error('Expected canonical LaTeX lecture documents');
    }
    expect(receipt.revision.lectureNotesLatex).toContain('\\gosuevidence{F1}');
    expect(receipt.revision.slidesLatex).toContain('\\gosuevidence{F1}');
    expect(externalSourceCalls.snapshotted).toHaveLength(2);
  });

  it('publishes ordered content-free progress while a generation is active', async () => {
    const { service, codex, projectA, paperA } = fixture();
    codex.response = latexResponse(['P1'], 1, 'Private completion text must stay out of progress.');
    const events: LectureStudioEvent[] = [];
    service.onEvent((event) => events.push(event));
    const studio = await service.create({
      title: 'Progress receipt lecture',
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

    const progress = events.filter((event) => event.type === 'lecture.generation.progress');
    expect(progress.map((event) => event.phase)).toEqual([
      'preparing_sources',
      'preparing_edit_context',
      'starting_model',
      'generating_draft',
      'model_active',
      'validating_output',
      'compiling_documents',
      'saving_revision',
      'committing_revision',
    ]);
    expect(progress.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(progress.map((event) => event.attemptId))).toEqual(
      new Set([progress[0]!.attemptId]),
    );
    expect(JSON.stringify(progress)).not.toContain('Private completion text');
    expect(JSON.stringify(progress)).not.toContain('/tmp/');
    expect(JSON.stringify(progress)).not.toContain('lecture-thread');

    events.length = 0;
    codex.response = latexResponse(['P1'], 1, 'Revised the current complete documents.');
    await service.send({
      studioId: studio.id,
      expectedVersion: generated.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: 'Make one small wording change.',
    });
    const revisionProgress = events.filter((event) => event.type === 'lecture.generation.progress');
    expect(revisionProgress.map((event) => event.phase)).toEqual([
      'preparing_sources',
      'loading_current_revision',
      'preparing_edit_context',
      'starting_model',
      'revising_draft',
      'model_active',
      'validating_output',
      'compiling_documents',
      'saving_revision',
      'committing_revision',
    ]);
    expect(codex.prompt).toContain('"mode":"revision"');
    expect(codex.prompt).toContain('"currentDraft":{');
  });

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
    const emptyCommand: EmptyLectureStudioTrashInput = {
      idempotencyKey: randomUUID(),
      confirmation: 'EMPTY LECTURE TRASH',
      targets: [
        {
          studioId: trashedAgain.id,
          expectedVersion: trashedAgain.version,
          trashedAt: trashedAgain.trashedAt!,
        },
      ],
    };
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

  it('fails closed when Lecture Studio Trash changes after the displayed target fence', async () => {
    const { service, storage, projectA, paperA } = fixture();
    const create = (title: string) =>
      service.create({
        title,
        kind: 'lecture',
        durationMinutes: null,
        outputProjectId: projectA,
        sourceProjectIds: [projectA],
        sourceSelection: {
          literature: [{ projectId: projectA, recordId: paperA.id }],
          experiments: [],
        },
      });
    const first = await create('First displayed Studio');
    const firstTrashed = await service.trash({
      studioId: first.id,
      expectedVersion: first.version,
    });
    const staleCommand: EmptyLectureStudioTrashInput = {
      idempotencyKey: randomUUID(),
      confirmation: 'EMPTY LECTURE TRASH',
      targets: [
        {
          studioId: firstTrashed.id,
          expectedVersion: firstTrashed.version,
          trashedAt: firstTrashed.trashedAt!,
        },
      ],
    };
    const second = await create('Added after confirmation view');
    const secondTrashed = await service.trash({
      studioId: second.id,
      expectedVersion: second.version,
    });

    await expect(service.emptyTrash(staleCommand)).rejects.toEqual(
      new LectureStudioServiceError('lecture_trash_changed'),
    );
    expect(storage.studios.map(({ id }) => id).sort()).toEqual([first.id, second.id].sort());
    expect(storage.trashReceipts.has(staleCommand.idempotencyKey)).toBe(false);

    const exactTargets = [firstTrashed, secondTrashed]
      .map((studio) => ({
        studioId: studio.id,
        expectedVersion: studio.version,
        trashedAt: studio.trashedAt!,
      }))
      .sort((left, right) => left.studioId.localeCompare(right.studioId));
    await expect(
      service.emptyTrash({
        ...staleCommand,
        idempotencyKey: randomUUID(),
        targets: exactTargets.map((target, index) =>
          index === 0 ? { ...target, expectedVersion: target.expectedVersion + 1 } : target,
        ),
      }),
    ).rejects.toEqual(new LectureStudioServiceError('lecture_trash_changed'));
    expect(storage.studios).toHaveLength(2);

    const secondRestored = await service.restore({
      studioId: secondTrashed.id,
      expectedVersion: secondTrashed.version,
    });
    await expect(
      service.emptyTrash({ ...staleCommand, idempotencyKey: randomUUID(), targets: exactTargets }),
    ).rejects.toEqual(new LectureStudioServiceError('lecture_trash_changed'));
    expect(storage.studios).toHaveLength(2);
    const secondTrashedAgain = await service.trash({
      studioId: secondRestored.id,
      expectedVersion: secondRestored.version,
    });
    const currentTargets = [firstTrashed, secondTrashedAgain]
      .map((studio) => ({
        studioId: studio.id,
        expectedVersion: studio.version,
        trashedAt: studio.trashedAt!,
      }))
      .sort((left, right) => left.studioId.localeCompare(right.studioId));
    await expect(
      service.emptyTrash({
        ...staleCommand,
        idempotencyKey: randomUUID(),
        targets: currentTargets.map((target, index) =>
          index === 0 ? { ...target, trashedAt: '2026-08-14T00:00:00.000Z' } : target,
        ),
      }),
    ).rejects.toEqual(new LectureStudioServiceError('lecture_trash_changed'));
    expect(storage.studios).toHaveLength(2);

    const exactCommand: EmptyLectureStudioTrashInput = {
      ...staleCommand,
      idempotencyKey: randomUUID(),
      targets: currentTargets,
    };
    const receipt = await service.emptyTrash(exactCommand);
    expect(receipt.removedStudios.map(({ studioId }) => studioId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    await expect(service.emptyTrash(exactCommand)).resolves.toEqual(receipt);
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
    const events: LectureStudioEvent[] = [];
    service.onEvent((event) => events.push(event));
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

    codex.emitActivity();
    await vi.advanceTimersByTimeAsync(4_000);
    codex.emitActivity();
    expect(
      events.filter(
        (event) => event.type === 'lecture.generation.progress' && event.phase === 'model_active',
      ),
    ).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    codex.emitActivity();
    expect(
      events.filter(
        (event) => event.type === 'lecture.generation.progress' && event.phase === 'model_active',
      ),
    ).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(settled).toBe(false);

    codex.completeDeferred();
    await expect(running).resolves.toMatchObject({ studio: { status: 'ready' } });
  });

  it('does not let a cancelled attempt cleanup delete a newer active attempt', async () => {
    let releaseFirstPreparation!: () => void;
    const firstPreparation = new Promise<void>((resolve) => {
      releaseFirstPreparation = resolve;
    });
    let preparationCalls = 0;
    const { service, storage, codex, projectA, paperA } = fixture({
      prepareDirectory: async () => {
        preparationCalls += 1;
        if (preparationCalls === 1) await firstPreparation;
        return '/tmp/gosu-lecture-studio-fixture';
      },
    });
    const events: LectureStudioEvent[] = [];
    service.onEvent((event) => events.push(event));
    const studio = await service.create({
      title: 'Attempt cleanup fence',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    const first = service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    await vi.waitFor(() => expect(preparationCalls).toBe(1));
    const activeExecutions = (
      service as unknown as {
        activeByStudio: Map<string, { attemptId: string }>;
      }
    ).activeByStudio;
    const oldActive = activeExecutions.get(studio.id)!;
    const firstGenerating = storage.getLectureStudio(studio.id)!;
    const cancelled = await service.cancel({
      studioId: studio.id,
      attemptId: firstGenerating.activeAttemptId!,
      expectedVersion: firstGenerating.version,
    });

    // Simulate a scheduler handing the now-cancelled studio to a retry before the old source
    // preparation promise unwinds. The old finally block must be fenced to its own identity.
    activeExecutions.delete(studio.id);
    codex.deferCompletion = true;
    const second = service.generate({
      studioId: studio.id,
      expectedVersion: cancelled.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    await vi.waitFor(() => {
      expect(preparationCalls).toBe(2);
      expect(codex.lastTurnId).toBe('lecture-turn');
    });
    const newActive = activeExecutions.get(studio.id)!;
    expect(newActive).not.toBe(oldActive);

    releaseFirstPreparation();
    await expect(first).rejects.toMatchObject({ code: 'lecture_cancelled' });
    expect(activeExecutions.get(studio.id)).toBe(newActive);

    const progressBeforeActivity = events.filter(
      (event) =>
        event.type === 'lecture.generation.progress' && event.attemptId === newActive.attemptId,
    ).length;
    codex.emitActivity();
    expect(
      events.filter(
        (event) =>
          event.type === 'lecture.generation.progress' && event.attemptId === newActive.attemptId,
      ),
    ).toHaveLength(progressBeforeActivity + 1);

    const secondGenerating = storage.getLectureStudio(studio.id)!;
    await service.cancel({
      studioId: studio.id,
      attemptId: secondGenerating.activeAttemptId!,
      expectedVersion: secondGenerating.version,
    });
    await expect(second).rejects.toMatchObject({ code: 'lecture_cancelled' });
  });

  it('enforces the hard generation deadline even while Codex remains active', async () => {
    vi.useFakeTimers();
    const { service, codex, projectA, paperA } = fixture({
      timeoutMs: 5_000,
      hardTimeoutMs: 12_000,
    });
    const events: LectureStudioEvent[] = [];
    service.onEvent((event) => events.push(event));
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
    const progressCount = events.filter(
      (event) => event.type === 'lecture.generation.progress',
    ).length;
    codex.emitActivity();
    codex.completeDeferred();
    expect(events.filter((event) => event.type === 'lecture.generation.progress')).toHaveLength(
      progressCount,
    );
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
    await vi.waitFor(() => expect(disconnected.codex.lastTurnId).not.toBeNull());
    disconnected.codex.disconnect();
    await expect(disconnectedTurn).rejects.toMatchObject({ code: 'lecture_codex_unavailable' });
  });

  it('preserves a native-image model rejection across terminal and disconnect orderings', async () => {
    const terminal = fixture();
    terminal.codex.terminalStatus = 'failed';
    terminal.codex.terminalGosuErrorCode = 'attachment_model_modality_unsupported';
    const terminalStudio = await terminal.service.create({
      title: 'Late native-image rejection',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: terminal.projectA,
      sourceProjectIds: [terminal.projectA],
      sourceSelection: {
        literature: [{ projectId: terminal.projectA, recordId: terminal.paperA.id }],
        experiments: [],
      },
    });
    await expect(
      terminal.service.generate({
        studioId: terminalStudio.id,
        expectedVersion: terminalStudio.version,
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toMatchObject({ code: 'lecture_figure_model_unsupported' });

    const disconnected = fixture();
    disconnected.codex.deferCompletion = true;
    disconnected.codex.rejectNativeImageBeforeRunTurnReturn = true;
    const disconnectedStudio = await disconnected.service.create({
      title: 'Disconnected native-image rejection',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: disconnected.projectA,
      sourceProjectIds: [disconnected.projectA],
      sourceSelection: {
        literature: [{ projectId: disconnected.projectA, recordId: disconnected.paperA.id }],
        experiments: [],
      },
    });
    const turn = disconnected.service.generate({
      studioId: disconnectedStudio.id,
      expectedVersion: disconnectedStudio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    for (let index = 0; index < 100 && !disconnected.codex.lastTurnId; index += 1) {
      await Promise.resolve();
    }
    await vi.waitFor(() => expect(disconnected.codex.lastTurnId).not.toBeNull());
    disconnected.codex.disconnect();
    await expect(turn).rejects.toMatchObject({ code: 'lecture_figure_model_unsupported' });
  });

  it.each([
    ['contextWindowExceeded', 'lecture_context_too_large'],
    ['sessionBudgetExceeded', 'lecture_context_too_large'],
    ['usageLimitExceeded', 'lecture_usage_limit_exceeded'],
    ['serverOverloaded', 'lecture_generation_interrupted'],
    ['internalServerError', 'lecture_generation_interrupted'],
    ['unauthorized', 'lecture_auth_required'],
    ['cyberPolicy', 'lecture_generation_failed'],
    ['badRequest', 'lecture_generation_failed'],
    ['threadRollbackFailed', 'lecture_generation_failed'],
    ['sandboxError', 'lecture_generation_failed'],
    ['activeTurnNotSteerable', 'lecture_generation_failed'],
    ['other', 'lecture_generation_failed'],
  ] as const)('maps safe Codex terminal reason %s to %s', async (reason, expectedCode) => {
    const { service, codex, projectA, paperA } = fixture();
    codex.terminalStatus = 'failed';
    codex.terminalError = {
      message: 'must not leave the main process',
      codexErrorInfo: reason,
      additionalDetails: 'must not be persisted',
    };
    const studio = await service.create({
      title: `Terminal reason ${reason}`,
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
    ).rejects.toMatchObject({ code: expectedCode, message: expectedCode });
    const detail = await service.detail({ studioId: studio.id });
    expect(detail.studio.lastErrorCode).toBe(expectedCode);
    expect(JSON.stringify(detail)).not.toContain('must not');
  });

  it.each([
    ['httpConnectionFailed', { httpStatusCode: 503 }, 'lecture_generation_interrupted'],
    ['responseStreamConnectionFailed', { httpStatusCode: 502 }, 'lecture_generation_interrupted'],
    ['responseStreamDisconnected', { httpStatusCode: null }, 'lecture_generation_interrupted'],
    ['responseTooManyFailedAttempts', { httpStatusCode: 429 }, 'lecture_generation_interrupted'],
    [
      'activeTurnNotSteerable',
      { expectedTurnId: 'expected', actualTurnId: 'actual' },
      'lecture_generation_failed',
    ],
  ] as const)(
    'maps structured Codex terminal reason %s without exposing details',
    async (reason, details, expectedCode) => {
      const { service, codex, projectA, paperA } = fixture();
      codex.terminalStatus = 'failed';
      codex.terminalError = {
        message: 'private request context',
        codexErrorInfo: { [reason]: details },
        additionalDetails: 'private provider details',
      };
      const studio = await service.create({
        title: `Structured terminal reason ${reason}`,
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
      ).rejects.toMatchObject({ code: expectedCode });
      expect(JSON.stringify(await service.detail({ studioId: studio.id }))).not.toContain(
        'private',
      );
    },
  );

  it.each([null, undefined, 'unknownFutureReason', { futureReason: {} }])(
    'falls back safely for an unknown Codex terminal reason %#',
    async (codexErrorInfo) => {
      const { service, codex, projectA, paperA } = fixture();
      codex.terminalStatus = 'failed';
      codex.terminalError =
        codexErrorInfo === undefined
          ? null
          : { message: 'private', codexErrorInfo, additionalDetails: 'private' };
      const studio = await service.create({
        title: 'Unknown terminal reason',
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
      ).rejects.toMatchObject({ code: 'lecture_generation_failed' });
      expect(JSON.stringify(await service.detail({ studioId: studio.id }))).not.toContain(
        'private',
      );
    },
  );

  it.each([
    ['codex_auth_required', 'lecture_auth_required'],
    ['codex_usage_limit_exceeded', 'lecture_usage_limit_exceeded'],
    ['codex_context_too_large', 'lecture_context_too_large'],
    ['codex_request_interrupted', 'lecture_generation_interrupted'],
    ['codex_request_failed', 'lecture_generation_failed'],
  ] as const)(
    'maps a synchronous Codex request failure %s before the turn starts to %s',
    async (requestCode, expectedCode) => {
      const { service, codex, projectA, paperA } = fixture();
      codex.startError = new CodexRequestError(requestCode);
      const studio = await service.create({
        title: `Synchronous ${requestCode}`,
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
      ).rejects.toMatchObject({ code: expectedCode });
      expect((await service.detail({ studioId: studio.id })).studio.lastErrorCode).toBe(
        expectedCode,
      );
    },
  );

  it('exports, opens, and reveals only the exact committed Research Notes artifact revision', async () => {
    const exported: Array<{ format: string; suggestedFileName: string; bytes: Buffer }> = [];
    const artifactPlatform: LectureArtifactPlatform = {
      exportFile: vi.fn(async (input) => {
        exported.push(input);
        return { status: 'exported' as const, fileName: input.suggestedFileName };
      }),
      openExisting: vi.fn(async () => undefined),
      openPdf: vi.fn(async () => 'Lecture Notes.pdf'),
      revealPdf: vi.fn(async () => 'Lecture Notes.pdf'),
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
    if (receipt.revision.schemaVersion === 1) throw new Error('Expected a LaTeX revision');
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
    await expect(service.revealArtifact({ ...binding, format: 'latex' })).resolves.toMatchObject({
      status: 'revealed',
      format: 'latex',
      fileName: 'Lecture Notes.tex',
      relativePath: artifact.relativePath,
    });
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
    await expect(
      service.revealArtifact({ ...binding, revisionId: randomUUID(), format: 'latex' }),
    ).rejects.toEqual(new LectureStudioServiceError('lecture_artifact_not_found'));
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
      revealPdf: vi.fn(async () => 'Lecture Notes.pdf'),
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
    if (generated.revision.schemaVersion === 1) throw new Error('Expected a LaTeX revision');
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
    await expect(
      service.revealArtifact({
        studioId: studio.id,
        revisionId: generated.revision.id,
        revision: generated.revision.revision,
        kind: 'lecture-notes',
        artifactContentSha256: artifact.contentSha256,
        format: 'pdf',
      }),
    ).resolves.toMatchObject({
      status: 'revealed',
      format: 'pdf',
      fileName: 'Lecture Notes.pdf',
      relativePath: null,
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
      document: await compile.mock.results.at(-2)?.value,
    });
    expect(artifactPlatform.revealPdf).toHaveBeenCalledWith({
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
    if (receipt.revision.schemaVersion === 1) throw new Error('Expected a LaTeX revision');
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
    expect(receipt.revision.invocation?.resolvedModelId).toBe('opaque-model-id');
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

  it('saves a direct source edit as one append-only manual revision without a chat turn', async () => {
    const { service, storage, projectA, projectB, paperA, paperB, artifactEvents } = fixture();
    const studio = await service.create({
      title: 'Direct source edit',
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
    const generated = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    if (generated.revision.schemaVersion === 1) throw new Error('Expected a LaTeX revision');
    if (generated.revision.schemaVersion !== 3) throw new Error('Expected a v3 model revision');
    const inheritedPolicySha256 = 'b'.repeat(64);
    const { documentFeatures: _documentFeatures, ...legacyGenerationBrief } =
      generated.revision.generationBriefSnapshot;
    const inheritedGenerationBriefSha256 = createHash('sha256')
      .update(JSON.stringify(legacyGenerationBrief), 'utf8')
      .digest('hex');
    const legacyNotesLatex = legacyCanonicalLectureDocument(
      'lecture-notes',
      studio.title,
      extractEditableLectureLatexBody(
        'lecture-notes',
        studio.title,
        generated.revision.lectureNotesLatex,
      ).body,
    );
    const legacySlidesLatex = legacyCanonicalLectureDocument(
      'slides',
      studio.title,
      extractEditableLectureLatexBody('slides', studio.title, generated.revision.slidesLatex)
        .body.replace('\\begin{frame}{Slide 1}', '\\begin{frame}[allowframebreaks]{Slide 1}')
        .replace('Evidence [P1]', '\\pause Evidence ([P1], [P2]).'),
    );
    storage.revisions[0] = {
      ...generated.revision,
      lectureNotesLatex: legacyNotesLatex,
      slidesLatex: legacySlidesLatex,
      generationBriefSnapshot: legacyGenerationBrief,
      generationBriefSha256: inheritedGenerationBriefSha256,
      authoringPolicyVersion: 6,
      authoringPolicySha256: inheritedPolicySha256,
      artifacts: generated.revision.artifacts.map((artifact) => ({
        ...artifact,
        contentSha256: hash(
          artifact.kind === 'lecture-notes' ? legacyNotesLatex : legacySlidesLatex,
        ),
      })),
    };
    const originalRevision = structuredClone(storage.revisions[0]!);
    const messageCount = storage.messages.length;
    const draft = await service.editDraft({
      studioId: studio.id,
      expectedVersion: generated.studio.version,
      baseRevisionId: generated.revision.id,
      baseRevision: generated.revision.revision,
    });
    const editedNotes = draft.lectureNotesLatexBody.replace(
      '\\section{Lecture notes}',
      '\\section{Lecture notes edited directly}',
    );

    const receipt = await service.saveManualRevision({
      studioId: studio.id,
      expectedVersion: draft.studioVersion,
      baseRevisionId: draft.baseRevisionId,
      baseRevision: draft.baseRevision,
      lectureNotesLatexBody: editedNotes,
      slidesLatexBody: draft.slidesLatexBody,
    });

    expect(receipt.revision).toMatchObject({
      schemaVersion: 4,
      revision: 2,
      invocation: null,
      authorship: {
        kind: 'manual',
        baseRevisionId: generated.revision.id,
        baseRevision: 1,
        editedKinds: ['lecture-notes'],
      },
      figureAssets: [],
      generationBriefSnapshot: legacyGenerationBrief,
      generationBriefSha256: inheritedGenerationBriefSha256,
      authoringPolicyVersion: 6,
      authoringPolicySha256: inheritedPolicySha256,
    });
    expect(receipt.revision.lectureNotesLatex).toContain('Lecture notes edited directly');
    expect(receipt.revision.slidesLatex).toBe(legacySlidesLatex);
    expect(receipt.revision.slidesLatex).toContain('% GOSU-LECTURE-LATEX v1 slides');
    expect(receipt.revision.slidesLatex).toContain('\\begin{frame}[allowframebreaks]');
    expect(receipt.revision.slidesLatex).toContain('\\pause Evidence ([P1], [P2]).');
    expect(receipt.studio.currentRevision).toBe(2);
    expect(receipt.studio.status).toBe('ready');
    expect(storage.messages).toHaveLength(messageCount);
    expect(storage.revisions[0]).toEqual(originalRevision);
    expect(artifactEvents.slice(-3)).toEqual(['preflight', 'stage', 'confirm']);
  });

  it('supplies active figures as native model inputs and freezes only referenced images', async () => {
    const figureId = randomUUID();
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
    const figureFor = (studioId: string) => ({
      id: figureId,
      studioId,
      displayName: 'Estimator geometry.png',
      fileName: `Figure-${figureId}.jpg`,
      mediaType: 'image/jpeg' as const,
      sourceFormat: 'png' as const,
      byteSize: jpegBytes.byteLength,
      width: 32,
      height: 24,
      sha256: createHash('sha256').update(jpegBytes).digest('hex'),
      origin: 'user' as const,
      createdAt: new Date().toISOString(),
    });
    const cleanup = vi.fn(async () => undefined);
    const exportFile = vi.fn(
      async (input: Parameters<LectureArtifactPlatform['exportFile']>[0]) => ({
        status: 'exported' as const,
        fileName: input.suggestedFileName,
      }),
    );
    const artifactPlatform: LectureArtifactPlatform = {
      exportFile,
      openExisting: vi.fn(async () => undefined),
      openPdf: vi.fn(async () => 'Lecture Notes.pdf'),
      revealPdf: vi.fn(async () => 'Lecture Notes.pdf'),
      revealExisting: vi.fn(async () => undefined),
    };
    const compile = vi.fn(async (input: Parameters<LectureDocumentCompiler['compile']>[0]) => {
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
    });
    const figures = {
      list: async ({ studioId }: { studioId: string }) => [figureFor(studioId)],
      snapshotFigures: async (studioId: string) => [
        { asset: figureFor(studioId), bytes: jpegBytes },
      ],
      snapshotRevisionFigures: async (
        studioId: string,
        assets: readonly LectureStudioFigureAsset[],
      ) => assets.map((asset) => ({ asset: { ...asset, studioId }, bytes: jpegBytes })),
      materializeActiveFigures: async (studioId: string) => ({
        figures: [figureFor(studioId)],
        localImagePaths: [`/private/native-input/Figure-${figureId}.jpg`],
        cleanup,
      }),
    } satisfies Pick<
      LectureStudioFigureService,
      'list' | 'snapshotFigures' | 'snapshotRevisionFigures' | 'materializeActiveFigures'
    >;
    const { service, codex, projectA, paperA } = fixture({
      figures,
      pdfCompiler: { compile },
      artifactPlatform,
    });
    const studio = await service.create({
      title: 'Figure-aware lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    codex.response = {
      reply: 'Used the supplied figure.',
      lectureNotesLatexBody: `\\section{Geometry}\n\\begin{figure}\n\\centering\n\\gosuimage{${figureId}}\n\\caption{Estimator geometry}\n\\end{figure}\nEvidence [P1].\n\\section{Sources used}\n[P1] Paper A`,
      slidesLatexBody: `\\begin{frame}{Geometry}\n\\begin{center}\n\\gosuimage{${figureId}}\n\\end{center}\nEvidence [P1].\n\\end{frame}`,
    };

    const receipt = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    if (receipt.revision.schemaVersion !== 4) throw new Error('Expected a figure revision');
    const promptPayload = JSON.parse(codex.prompt.slice(codex.prompt.indexOf('\n\n') + 2)) as {
      figureAssets: Array<{ id: string }>;
    };

    expect(codex.localImagePaths).toEqual([`/private/native-input/Figure-${figureId}.jpg`]);
    expect(promptPayload.figureAssets).toEqual([expect.objectContaining({ id: figureId })]);
    expect(codex.prompt).not.toContain('/private/native-input');
    expect(receipt.revision).toMatchObject({
      schemaVersion: 4,
      authorship: { kind: 'model' },
      figureAssets: [expect.objectContaining({ id: figureId })],
    });
    expect(receipt.revision.invocation).not.toBeNull();
    expect(compile).toHaveBeenCalledTimes(2);
    expect(compile).toHaveBeenCalledWith(
      expect.objectContaining({
        figureAssets: [
          expect.objectContaining({ asset: expect.objectContaining({ id: figureId }) }),
        ],
      }),
    );
    expect(cleanup).toHaveBeenCalledOnce();
    const notesArtifact = receipt.revision.artifacts.find(
      (artifact) => artifact.kind === 'lecture-notes',
    )!;
    await expect(
      service.exportArtifact({
        studioId: studio.id,
        revisionId: receipt.revision.id,
        revision: receipt.revision.revision,
        kind: 'lecture-notes',
        artifactContentSha256: notesArtifact.contentSha256,
        format: 'latex',
      }),
    ).resolves.toMatchObject({
      status: 'exported',
      format: 'latex',
      fileName: 'Lecture Notes bundle.zip',
    });
    expect(exportFile).toHaveBeenCalledOnce();
    const exportedBundle = unzipSync(exportFile.mock.calls[0]![0].bytes);
    expect(Object.keys(exportedBundle).sort()).toEqual(
      [`Figure-${figureId}.jpg`, 'Lecture Notes.tex'].sort(),
    );
    expect(Buffer.from(exportedBundle['Lecture Notes.tex']!)).toEqual(
      Buffer.from(receipt.revision.lectureNotesLatex, 'utf8'),
    );
    expect(Buffer.from(exportedBundle[`Figure-${figureId}.jpg`]!)).toEqual(jpegBytes);
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
    if (receipt.revision.schemaVersion === 1) throw new Error('Expected a LaTeX revision');

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
    expect(receipt.revision.lectureNotesLatex).toContain('\\gosuevidence{M1}');

    manuscriptFiles.set('main.tex', 'mutated after generation');
    const detail = await service.detail({ studioId: studio.id });
    expect(
      detail.revisions[0]?.sourceManifest.schemaVersion === 2
        ? detail.revisions[0].sourceManifest.manuscripts[0]?.files[0]?.content
        : null,
    ).toBe(mainTex);
  });

  it('copies a normalized custom structure into the Studio, initial prompt, and v3 provenance', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    codex.response = latexResponse(['P1']);
    const mutableSettingsDefault = {
      mode: 'custom' as const,
      sections: [
        { title: '  Cafe\u0301 foundations  ', coverage: 'notes-and-slides' as const },
        { title: 'Proof details', coverage: 'notes-only' as const },
        { title: 'Takeaways', coverage: 'notes-and-slides' as const },
      ],
    };
    const studio = await service.create({
      title: 'Frozen custom structure',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
      generationBrief: {
        notesTargetPages: 14,
        slidesTargetPages: null,
        detailLevel: 'detailed',
        structure: mutableSettingsDefault,
        customInstructions: 'Keep the requested content flow.',
      },
    });
    const frozenBrief = {
      notesTargetPages: 14,
      slidesTargetPages: null,
      detailLevel: 'detailed' as const,
      structure: {
        mode: 'custom' as const,
        sections: [
          { title: 'Café foundations', coverage: 'notes-and-slides' as const },
          { title: 'Proof details', coverage: 'notes-only' as const },
          { title: 'Takeaways', coverage: 'notes-and-slides' as const },
        ],
      },
      documentFeatures: DEFAULT_DOCUMENT_FEATURES,
      customInstructions: 'Keep the requested content flow.',
    };

    expect(studio.generationBrief).toEqual(frozenBrief);
    expect(storage.getLectureStudio(studio.id)?.generationBrief).toEqual(frozenBrief);
    mutableSettingsDefault.sections[0]!.title = 'Changed later in Settings';
    expect(storage.getLectureStudio(studio.id)?.generationBrief).toEqual(frozenBrief);

    const receipt = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    const initialPayload = JSON.parse(
      codex.prompts[0]!.slice(codex.prompts[0]!.indexOf('\n\n') + 2),
    ) as { generationBrief: LectureStudio['generationBrief'] };
    expect(initialPayload.generationBrief).toEqual(frozenBrief);
    expect(JSON.stringify(initialPayload.generationBrief.structure)).not.toContain(
      'Changed later in Settings',
    );

    expect(receipt.revision.schemaVersion).toBe(3);
    if (receipt.revision.schemaVersion !== 3) throw new Error('Expected v3 authoring provenance');
    expect(receipt.revision.generationBriefSnapshot).toEqual(frozenBrief);
    expect(receipt.revision.generationBriefSha256).toBe(hash(JSON.stringify(frozenBrief)));
    expect(receipt.revision.authoringPolicyVersion).toBe(LECTURE_STUDIO_AUTHORING_POLICY_VERSION);
    expect(receipt.revision.authoringPolicySha256).toBe(
      hash(LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS),
    );
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
        structure: { mode: 'adaptive' },
        customInstructions: 'Emphasize the theorem and ablations.',
      },
    });

    expect(studio.status).toBe('draft');
    expect(codex.startInput).toBeNull();
    expect(studio.generationBrief).toEqual({
      notesTargetPages: 12,
      slidesTargetPages: 18,
      detailLevel: 'detailed',
      structure: { mode: 'adaptive' },
      documentFeatures: DEFAULT_DOCUMENT_FEATURES,
      customInstructions: 'Emphasize the theorem and ablations.',
    });
  });

  it('updates future generation options without mutating committed revisions', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    codex.response = latexResponse(['P1']);
    const created = await service.create({
      title: 'Editable generation options',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    const initialBrief = {
      notesTargetPages: 18,
      slidesTargetPages: null,
      detailLevel: 'detailed' as const,
      structure: { mode: 'adaptive' as const },
      documentFeatures: DEFAULT_DOCUMENT_FEATURES,
      customInstructions: 'INITIAL-UPDATED-BRIEF',
    };
    const configured = await service.updateGenerationBrief({
      studioId: created.id,
      expectedVersion: created.version,
      generationBrief: initialBrief,
    });
    expect(configured).toMatchObject({
      generationBrief: initialBrief,
      version: created.version + 1,
    });

    const initial = await service.generate({
      studioId: configured.id,
      expectedVersion: configured.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    expect(codex.prompt).toContain('INITIAL-UPDATED-BRIEF');
    expect(codex.prompt).toContain('"notesTargetPages":18');
    expect(initial.revision.schemaVersion).toBe(3);
    if (initial.revision.schemaVersion !== 3) throw new Error('Expected v3 authoring provenance');
    expect(initial.revision.generationBriefSnapshot).toEqual(initialBrief);
    expect(initial.revision.generationBriefSha256).toBe(hash(JSON.stringify(initialBrief)));
    const immutableFirstRevision = structuredClone(initial.revision);

    const revisionBrief = {
      notesTargetPages: null,
      slidesTargetPages: null,
      detailLevel: 'exhaustive' as const,
      structure: {
        mode: 'custom' as const,
        sections: [
          { title: 'Problem and assumptions', coverage: 'notes-and-slides' as const },
          { title: 'Proof details', coverage: 'notes-only' as const },
          { title: 'Takeaways', coverage: 'notes-and-slides' as const },
        ],
      },
      documentFeatures: DEFAULT_DOCUMENT_FEATURES,
      customInstructions: 'REVISION-UPDATED-BRIEF',
    };
    const reconfigured = await service.updateGenerationBrief({
      studioId: created.id,
      expectedVersion: initial.studio.version,
      generationBrief: revisionBrief,
    });
    const noOp = await service.updateGenerationBrief({
      studioId: created.id,
      expectedVersion: reconfigured.version,
      generationBrief: revisionBrief,
    });
    expect(noOp.version).toBe(reconfigured.version);
    expect(storage.revisions).toEqual([immutableFirstRevision]);

    await expect(
      service.updateGenerationBrief({
        studioId: created.id,
        expectedVersion: initial.studio.version,
        generationBrief: initialBrief,
      }),
    ).rejects.toEqual(new LectureStudioServiceError('lecture_version_conflict'));

    const revisionPromptIndex = codex.prompts.length;
    codex.responseQueue = [
      { reply: 'Rejected candidate without the required document pair.' },
      latexResponse(['P1'], 1, 'Corrected with the frozen revised generation plan.'),
    ];
    const edited = await service.send({
      studioId: created.id,
      expectedVersion: reconfigured.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: 'Use the revised generation plan.',
    });
    const revisionPayload = JSON.parse(
      codex.prompts[revisionPromptIndex]!.slice(
        codex.prompts[revisionPromptIndex]!.indexOf('\n\n') + 2,
      ),
    ) as { generationBrief: LectureStudio['generationBrief'] };
    expect(revisionPayload.generationBrief).toEqual(revisionBrief);
    expect(codex.prompts[revisionPromptIndex]).toContain('REVISION-UPDATED-BRIEF');
    expect(codex.prompts[revisionPromptIndex]).toContain('"detailLevel":"exhaustive"');
    expect(codex.prompts[revisionPromptIndex + 1]).toContain('bounded response_schema check');
    expect(codex.prompts[revisionPromptIndex + 1]).not.toContain('Problem and assumptions');
    expect(codex.prompts).toHaveLength(revisionPromptIndex + 2);
    expect(storage.revisions[0]).toEqual(immutableFirstRevision);
    expect(storage.revisions).toHaveLength(2);
    expect(edited.revision.schemaVersion).toBe(3);
    if (edited.revision.schemaVersion !== 3) throw new Error('Expected v3 authoring provenance');
    expect(edited.revision.generationBriefSnapshot).toEqual(revisionBrief);
    expect(edited.revision.generationBriefSha256).toBe(hash(JSON.stringify(revisionBrief)));
    expect(edited.revision.authoringPolicyVersion).toBe(LECTURE_STUDIO_AUTHORING_POLICY_VERSION);
    expect(edited.revision.authoringPolicySha256).toBe(hash(LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS));
  });

  it('rejects new source-list aliases on create and when introduced by an update', async () => {
    const { service, storage, projectA, paperA } = fixture();
    const sourceSelection = {
      literature: [{ projectId: projectA, recordId: paperA.id }],
      experiments: [],
    };
    const aliasBrief = {
      notesTargetPages: null,
      slidesTargetPages: null,
      detailLevel: 'standard' as const,
      structure: {
        mode: 'custom' as const,
        sections: [{ title: 'References', coverage: 'notes-and-slides' as const }],
      },
      documentFeatures: DEFAULT_DOCUMENT_FEATURES,
      customInstructions: '',
    };
    await expect(
      service.create({
        title: 'Rejected alias create',
        kind: 'lecture',
        durationMinutes: null,
        outputProjectId: projectA,
        sourceProjectIds: [projectA],
        sourceSelection,
        generationBrief: aliasBrief,
      }),
    ).rejects.toEqual(new LectureStudioServiceError('invalid_lecture_input'));
    await expect(
      service.create({
        title: 'Rejected canonical lookalike create',
        kind: 'lecture',
        durationMinutes: null,
        outputProjectId: projectA,
        sourceProjectIds: [projectA],
        sourceSelection,
        generationBrief: {
          ...aliasBrief,
          structure: {
            mode: 'custom',
            sections: [{ title: 'Sources   used', coverage: 'notes-and-slides' }],
          },
        },
      }),
    ).rejects.toEqual(new LectureStudioServiceError('invalid_lecture_input'));
    expect(storage.studios).toEqual([]);

    const studio = await service.create({
      title: 'Rejected alias update',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection,
    });
    await expect(
      service.updateGenerationBrief({
        studioId: studio.id,
        expectedVersion: studio.version,
        generationBrief: aliasBrief,
      }),
    ).rejects.toEqual(new LectureStudioServiceError('invalid_lecture_input'));
    expect(storage.getLectureStudio(studio.id)?.version).toBe(studio.version);
  });

  it('permits an existing legacy source-list alias to stay unchanged or be removed only', async () => {
    const { service, storage, projectA, paperA } = fixture();
    const studio = await service.create({
      title: 'Grandfathered structure edits',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    const legacyBrief: LectureStudio['generationBrief'] = {
      ...studio.generationBrief,
      structure: {
        mode: 'custom',
        sections: [{ title: 'References', coverage: 'notes-and-slides' }],
      },
    };
    const index = storage.studios.findIndex((candidate) => candidate.id === studio.id);
    storage.studios[index] = { ...storage.studios[index]!, generationBrief: legacyBrief };

    const retained = await service.updateGenerationBrief({
      studioId: studio.id,
      expectedVersion: studio.version,
      generationBrief: {
        ...legacyBrief,
        customInstructions: 'Keep the historical topic.',
        documentFeatures: DEFAULT_DOCUMENT_FEATURES,
      },
    });
    await expect(
      service.updateGenerationBrief({
        studioId: studio.id,
        expectedVersion: retained.version,
        generationBrief: {
          ...retained.generationBrief,
          structure: {
            mode: 'custom',
            sections: [{ title: 'Bibliography', coverage: 'notes-and-slides' }],
          },
          documentFeatures: DEFAULT_DOCUMENT_FEATURES,
        },
      }),
    ).rejects.toEqual(new LectureStudioServiceError('invalid_lecture_input'));
    const removed = await service.updateGenerationBrief({
      studioId: studio.id,
      expectedVersion: retained.version,
      generationBrief: {
        ...retained.generationBrief,
        structure: { mode: 'adaptive' },
        documentFeatures: DEFAULT_DOCUMENT_FEATURES,
      },
    });
    expect(removed.generationBrief.structure).toEqual({ mode: 'adaptive' });
  });

  it('uses an updated custom structure for a failed Studio retry only', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    const created = await service.create({
      title: 'Retry with updated structure',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    codex.response = { reply: 'Missing both generated documents.' };
    await expect(
      service.generate({
        studioId: created.id,
        expectedVersion: created.version,
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toMatchObject({ code: 'lecture_invalid_response_schema' });
    expect(storage.revisions).toEqual([]);

    const retryBrief = {
      notesTargetPages: null,
      slidesTargetPages: null,
      detailLevel: 'standard' as const,
      structure: {
        mode: 'custom' as const,
        sections: [
          { title: 'Motivation', coverage: 'notes-and-slides' as const },
          { title: 'Technical appendix', coverage: 'notes-only' as const },
          { title: 'Conclusion', coverage: 'notes-and-slides' as const },
        ],
      },
      documentFeatures: DEFAULT_DOCUMENT_FEATURES,
      customInstructions: '',
    };
    const failed = storage.getLectureStudio(created.id)!;
    const reconfigured = await service.updateGenerationBrief({
      studioId: created.id,
      expectedVersion: failed.version,
      generationBrief: retryBrief,
    });
    const retryPromptIndex = codex.prompts.length;
    codex.response = latexResponse(['P1']);
    const retried = await service.generate({
      studioId: created.id,
      expectedVersion: reconfigured.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    const retryPayload = JSON.parse(
      codex.prompts[retryPromptIndex]!.slice(codex.prompts[retryPromptIndex]!.indexOf('\n\n') + 2),
    ) as { generationBrief: LectureStudio['generationBrief'] };
    expect(retryPayload.generationBrief).toEqual(retryBrief);
    expect(retried.revision.schemaVersion).toBe(3);
    if (retried.revision.schemaVersion !== 3) throw new Error('Expected v3 authoring provenance');
    expect(retried.revision.generationBriefSnapshot).toEqual(retryBrief);
    expect(retried.revision.generationBriefSha256).toBe(hash(JSON.stringify(retryBrief)));
    expect(storage.revisions).toEqual([retried.revision]);
  });

  it('rejects generation-option edits while generating or after moving to Trash', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    codex.response = latexResponse(['P1']);
    const created = await service.create({
      title: 'Guarded generation options',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    const nextBrief = {
      notesTargetPages: 10,
      slidesTargetPages: null,
      detailLevel: 'concise' as const,
      structure: { mode: 'adaptive' as const },
      documentFeatures: DEFAULT_DOCUMENT_FEATURES,
      customInstructions: 'Guarded update.',
    };
    codex.deferCompletion = true;
    const running = service.generate({
      studioId: created.id,
      expectedVersion: created.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    await vi.waitFor(() => expect(storage.getLectureStudio(created.id)?.status).toBe('generating'));
    await expect(
      service.updateGenerationBrief({
        studioId: created.id,
        expectedVersion: storage.getLectureStudio(created.id)!.version,
        generationBrief: nextBrief,
      }),
    ).rejects.toEqual(new LectureStudioServiceError('lecture_busy'));
    codex.completeDeferred();
    const completed = await running;
    const trashed = await service.trash({
      studioId: created.id,
      expectedVersion: completed.studio.version,
    });
    await expect(
      service.updateGenerationBrief({
        studioId: created.id,
        expectedVersion: trashed.version,
        generationBrief: nextBrief,
      }),
    ).rejects.toEqual(new LectureStudioServiceError('lecture_studio_trashed'));
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
        code: 'lecture_invalid_response_schema',
      }),
    );
    expect(storage.revisions).toEqual([]);
    expect(storage.studios[0]).toMatchObject({
      status: 'failed',
      lastErrorCode: 'lecture_invalid_response_schema',
    });
    expect(codex.turnSequence).toBe(2);
  });

  it('repairs JSON-decoded backspace and form-feed LaTeX prefixes before validation', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    const studio = await service.create({
      title: 'JSON-safe LaTeX lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    codex.response = {
      reply: 'Generated JSON-safe LaTeX.',
      lectureNotesLatexBody: [
        '\\section{Result}',
        `The ratio is $${'\f'}rac{1}{2}$ [P1].`,
        '\\section{Sources used}',
        '[P1] Paper A',
      ].join('\n'),
      slidesLatexBody: [
        `${'\b'}egin{frame}{Result}`,
        `The ratio is $${'\f'}rac{1}{2}$ [P1].`,
        '\\end{frame}',
      ].join('\n'),
    };

    const receipt = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });

    expect(codex.turnSequence).toBe(1);
    expect(receipt.revision.schemaVersion).toBe(3);
    if (receipt.revision.schemaVersion === 1) throw new Error('Expected canonical LaTeX revision');
    expect(receipt.revision.lectureNotesLatex).toContain('\\frac{1}{2}');
    expect(receipt.revision.slidesLatex).toContain('\\begin{frame}{Result}');
    expect(storage.revisions).toHaveLength(1);
  });

  it('repairs one exact slide-count failure on the same thread and records the accepted invocation', async () => {
    const usage = {
      bindThread: vi.fn<ModelUsageService['bindThread']>(),
      releaseThread: vi.fn<ModelUsageService['releaseThread']>(),
    };
    const { service, storage, codex, projectA, paperA } = fixture({ usage });
    const events: LectureStudioEvent[] = [];
    service.onEvent((event) => events.push(event));
    codex.responseQueue = [
      latexResponse(['P1'], 18, 'PRIVATE-FIRST-CANDIDATE'),
      latexResponse(['P1'], 19, 'Corrected exact page count.'),
    ];
    const studio = await service.create({
      title: 'Twenty-page lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
      generationBrief: {
        notesTargetPages: 10,
        slidesTargetPages: 20,
        detailLevel: 'exhaustive',
        structure: { mode: 'adaptive' },
        customInstructions: '',
      },
    });

    const receipt = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: 'ultra',
    });

    expect(codex.turnSequence).toBe(2);
    expect(usage.bindThread).toHaveBeenCalledTimes(1);
    expect(usage.bindThread).toHaveBeenCalledWith(expect.any(String), {
      workloadKind: 'lecture_generation',
      projectId: projectA,
      lectureStudioId: studio.id,
      lectureAttemptId: receipt.revision.attemptId,
    });
    expect(usage.releaseThread).toHaveBeenCalledWith(usage.bindThread.mock.calls[0]?.[0]);
    expect(codex.prompts[1]).toContain('bounded slide_count check');
    expect(codex.prompts[1]).toContain(
      'exactly 19 content frames; GOSU adds one title frame for exactly 20 PDF pages',
    );
    expect(codex.prompts[1]).not.toContain('PRIVATE-FIRST-CANDIDATE');
    expect(receipt.revision.invocation?.invocationId).toBe(codex.invocations[1]?.invocationId);
    if (receipt.revision.schemaVersion === 1) throw new Error('Expected canonical LaTeX revision');
    expect(receipt.revision.slidesLatex.match(/\\begin\{frame\}/gu)).toHaveLength(20);
    expect(storage.revisions).toHaveLength(1);
    expect(codex.interruptions).toEqual([]);
    expect(
      events
        .filter((event) => event.type === 'lecture.generation.progress')
        .map((event) => event.phase),
    ).toContain('correcting_output');
  });

  it('stops after one correction and publishes only a bounded grammar error category', async () => {
    const { service, storage, saved, codex, projectA, paperA } = fixture();
    const unsafe = {
      reply: 'PRIVATE-UNSAFE-CANDIDATE',
      lectureNotesLatexBody:
        '\\section{Notes}\n\\includegraphics{/tmp/private.png} [P1].\n\\section{Sources used}\n[P1] Paper A',
      slidesLatexBody: lectureSlidesBody(['P1']),
    };
    codex.responseQueue = [unsafe, unsafe, latexResponse(['P1'])];
    const studio = await service.create({
      title: 'One repair only',
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
    ).rejects.toMatchObject({ code: 'lecture_invalid_latex_grammar' });

    expect(codex.turnSequence).toBe(2);
    expect(codex.responseQueue).toHaveLength(1);
    expect(codex.prompts[1]).toContain('bounded latex_grammar check');
    expect(codex.prompts[1]).toContain('lecture-notes: unsupported_command');
    expect(codex.prompts[1]).toContain('Offending token examples: \\includegraphics');
    expect(codex.prompts[1]).not.toContain('PRIVATE-UNSAFE-CANDIDATE');
    expect(storage.revisions).toHaveLength(0);
    expect(saved).toHaveLength(0);
    expect(storage.attempts).toHaveLength(1);
    expect(storage.attempts[0]).toMatchObject({
      status: 'failed',
      resolvedModelId: 'provider-default',
      terminalCode: 'lecture_invalid_latex_grammar',
      validations: [
        {
          pass: 'initial',
          category: 'latex_grammar',
          diagnostics: [
            { document: 'lecture-notes', reason: 'unsupported_command', tokenCount: 1 },
          ],
        },
        {
          pass: 'correction',
          category: 'latex_grammar',
          diagnostics: [
            { document: 'lecture-notes', reason: 'unsupported_command', tokenCount: 1 },
          ],
        },
      ],
    });
    expect(JSON.stringify(storage.attempts[0])).not.toContain('includegraphics');
    expect(JSON.stringify(storage.attempts[0])).not.toContain('PRIVATE-UNSAFE-CANDIDATE');
  });

  it('keeps generation alive when best-effort attempt diagnostics throw synchronously', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    storage.recordLectureStudioAttemptPhase = () => {
      throw new Error('diagnostic phase unavailable');
    };
    storage.recordLectureStudioAttemptInvocation = () => {
      throw new Error('diagnostic invocation unavailable');
    };
    storage.recordLectureStudioAttemptValidation = () => {
      throw new Error('diagnostic validation unavailable');
    };
    codex.responseQueue = [
      { reply: 'missing body fields' },
      latexResponse(['P1'], 1, 'Recovered without diagnostics.'),
    ];
    const studio = await service.create({
      title: 'Best-effort diagnostics',
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

    expect(receipt.studio.status).toBe('ready');
    expect(receipt.revision.revision).toBe(1);
    expect(storage.getLectureStudio(studio.id)).toMatchObject({
      status: 'ready',
      activeAttemptId: null,
    });
  });

  it('gives one correction bounded diagnostics for both documents and source-defined aliases', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    const sourceNativeMacros = {
      reply: 'PRIVATE-SOURCE-NATIVE-MACROS',
      lectureNotesLatexBody: String.raw`\section{Notation}
Use $\R$, $\E[X]$, $\PP(A)$, and \mainref only as source-native aliases [P1].
\section{Sources used}
[P1] Paper A.`,
      slidesLatexBody: String.raw`\begin{frame}{Notation}
Use $\1$ only as a source-native alias [P1].
\end{frame}`,
    };
    codex.responseQueue = [sourceNativeMacros, latexResponse(['P1'])];
    const studio = await service.create({
      title: 'Expand source aliases',
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

    expect(codex.turnSequence).toBe(2);
    expect(codex.prompts[1]).toContain('lecture-notes: unsupported_command');
    expect(codex.prompts[1]).toContain('Offending token examples: \\R, \\E, \\PP, \\mainref');
    expect(codex.prompts[1]).toContain('slides: unsupported_escape');
    expect(codex.prompts[1]).toContain('Offending token examples: \\1');
    expect(codex.prompts[1]).toContain('scan both complete bodies');
    expect(codex.prompts[1]).not.toContain('PRIVATE-SOURCE-NATIVE-MACROS');
    expect(receipt.revision.revision).toBe(1);
    expect(storage.revisions).toHaveLength(1);
  });

  it('classifies unsafe LaTeX before a simultaneously missing Sources used section', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    const unsafeWithoutSources = {
      reply: 'unsafe without source mapping',
      lectureNotesLatexBody: '\\section{Notes}\n\\includegraphics{/tmp/private.png} [P1].',
      slidesLatexBody: lectureSlidesBody(['P1']),
    };
    codex.responseQueue = [unsafeWithoutSources, unsafeWithoutSources];
    const studio = await service.create({
      title: 'Grammar classification order',
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
    ).rejects.toMatchObject({ code: 'lecture_invalid_latex_grammar' });

    expect(codex.prompts[1]).toContain('bounded latex_grammar check');
    expect(storage.revisions).toHaveLength(0);
  });

  it('keeps cancellation actionable while the correction turn is active', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    const events: LectureStudioEvent[] = [];
    service.onEvent((event) => events.push(event));
    codex.responseQueue = [{ reply: 'missing documents' }];
    codex.deferTurnNumbers.add(2);
    const studio = await service.create({
      title: 'Cancelled correction',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
    });
    const generation = service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    await vi.waitFor(() => expect(codex.turnSequence).toBe(2));
    const generating = storage.getLectureStudio(studio.id)!;

    await service.cancel({
      studioId: studio.id,
      expectedVersion: generating.version,
      attemptId: generating.activeAttemptId!,
    });

    await expect(generation).rejects.toMatchObject({ code: 'lecture_cancelled' });
    expect(codex.interruptions).toContainEqual({
      threadId: 'lecture-thread',
      turnId: 'lecture-turn-2',
    });
    expect(storage.revisions).toHaveLength(0);
    const progressCount = events.filter(
      (event) => event.type === 'lecture.generation.progress',
    ).length;
    codex.emitActivity();
    expect(events.filter((event) => event.type === 'lecture.generation.progress')).toHaveLength(
      progressCount,
    );
  });

  it('does not interrupt the completed primary turn when correction startup fails', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    codex.responseQueue = [{ reply: 'missing documents' }];
    codex.runTurnErrors.set(2, new Error('correction request failed'));
    const studio = await service.create({
      title: 'Correction startup failure',
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
    ).rejects.toMatchObject({ code: 'lecture_codex_unavailable' });

    expect(codex.turnSequence).toBe(2);
    expect(codex.interruptions).toEqual([]);
    expect(storage.revisions).toHaveLength(0);
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
    expect(codex.interruptions).toEqual([]);
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
    ).rejects.toMatchObject({ code: 'lecture_invalid_response_schema' });
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
    if (!generated.invocation) throw new Error('Expected model invocation');
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
    expect(migrated.revision.schemaVersion).toBe(3);
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

  it.each([
    {
      name: 'punctuated evidence cluster',
      lectureNotesLatexBody:
        '\\section{Notes}\nSupported claim [P1], [P2].\n\\section{Sources used}\n[P1] Paper A\n[P2] Paper B',
      slidesLatexBody: '\\begin{frame}{Evidence}\nSupported claim [P1] [P2].\n\\end{frame}',
    },
    {
      name: 'parenthesized evidence label',
      lectureNotesLatexBody:
        '\\section{Notes}\nSupported claim [P1] [P2].\n\\section{Sources used}\n[P1] Paper A\n[P2] Paper B',
      slidesLatexBody: '\\begin{frame}{Evidence}\nSupported claim ([P1]).\n\\end{frame}',
    },
    {
      name: 'sentence punctuation before evidence',
      lectureNotesLatexBody:
        '\\section{Notes}\nSupported claim, [P1].\n\\section{Sources used}\n[P1] Paper A\n[P2] Paper B',
      slidesLatexBody: '\\begin{frame}{Evidence}\nSupported claim [P1] [P2].\n\\end{frame}',
    },
    {
      name: 'spaced sentence punctuation after evidence',
      lectureNotesLatexBody:
        '\\section{Notes}\nSupported claim [P1] .\n\\section{Sources used}\n[P1] Paper A\n[P2] Paper B',
      slidesLatexBody: '\\begin{frame}{Evidence}\nSupported claim [P1] [P2].\n\\end{frame}',
    },
  ])('rejects hidden-mode $name before anchoring', async (candidate) => {
    const { service, storage, codex, projectA, projectB, paperA, paperB } = fixture();
    codex.response = {
      reply: 'Generated unsafe hidden-label typography.',
      lectureNotesLatexBody: candidate.lectureNotesLatexBody,
      slidesLatexBody: candidate.slidesLatexBody,
    };
    const studio = await service.create({
      title: 'Hidden-label typography',
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
      generationBrief: {
        notesTargetPages: null,
        slidesTargetPages: null,
        detailLevel: 'standard',
        structure: { mode: 'adaptive' },
        documentFeatures: {
          ...DEFAULT_DOCUMENT_FEATURES,
          showInlineEvidenceLabels: false,
        },
        customInstructions: '',
      },
    });

    await expect(
      service.generate({
        studioId: studio.id,
        expectedVersion: studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toMatchObject({ code: 'lecture_invalid_latex_grammar' });
    expect(codex.prompts.at(-1)).toContain('evidence_label_typography');
    expect(codex.prompts.at(-1)).toContain('whitespace only');
    expect(storage.revisions).toEqual([]);
  });

  it.each([
    String.raw`\section{References}`,
    String.raw`\section{Sources}`,
    String.raw`\section{Source list}`,
    String.raw`\section{출처 목록}`,
    String.raw`\section{\textrm{References}}`,
    String.raw`\section{Refer{ences}}`,
    String.raw`\subsection{References}`,
  ])(
    'rejects an unconfigured renamed source list while Sources used is hidden: %s',
    async (heading) => {
      const { service, storage, codex, projectA, paperA } = fixture();
      codex.response = {
        reply: 'Renamed the hidden list.',
        lectureNotesLatexBody: `${String.raw`\section{Notes}
Supported claim [P1].`}
${heading}
[P1] Paper A`,
        slidesLatexBody: lectureSlidesBody(['P1']),
      };
      const studio = await service.create({
        title: 'Renamed hidden source list',
        kind: 'lecture',
        durationMinutes: null,
        outputProjectId: projectA,
        sourceProjectIds: [projectA],
        sourceSelection: {
          literature: [{ projectId: projectA, recordId: paperA.id }],
          experiments: [],
        },
        generationBrief: {
          notesTargetPages: null,
          slidesTargetPages: null,
          detailLevel: 'standard',
          structure: { mode: 'adaptive' },
          documentFeatures: {
            ...DEFAULT_DOCUMENT_FEATURES,
            includeSourcesUsedSection: false,
          },
          customInstructions: '',
        },
      });

      await expect(
        service.generate({
          studioId: studio.id,
          expectedVersion: studio.version,
          requestedModelId: null,
          reasoningOptionId: null,
        }),
      ).rejects.toMatchObject({ code: 'lecture_invalid_citation_mapping' });
      expect(storage.revisions).toEqual([]);
    },
  );

  it('rejects a nonterminal Sources used mapping after automatic correction', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    codex.response = {
      reply: 'Placed more content after the source mapping.',
      lectureNotesLatexBody: `${lectureNotesBody(['P1'])}
${String.raw`\subsection{Later content}
Later claim [P1].`}`,
      slidesLatexBody: lectureSlidesBody(['P1']),
    };
    const studio = await service.create({
      title: 'Terminal source mapping',
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
    ).rejects.toMatchObject({ code: 'lecture_invalid_citation_mapping' });
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

  it('keeps Sources used by default for a new Studio', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    codex.response = {
      reply: 'Missing the default source list.',
      lectureNotesLatexBody: lectureNotesBodyWithoutSources(['P1']),
      slidesLatexBody: lectureSlidesBody(['P1']),
    };
    const studio = await service.create({
      title: 'Default source list',
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
    ).rejects.toMatchObject({ code: 'lecture_invalid_citation_mapping' });
    expect(codex.prompts.at(-1)).toContain('Finish the notes with a complete Sources used mapping');
    expect(storage.revisions).toEqual([]);
  });

  it.each(
    [true, false].flatMap((includeSlideTitlePage) =>
      [true, false].flatMap((showInlineEvidenceLabels) =>
        [true, false].map((includeSourcesUsedSection) => ({
          includeSlideTitlePage,
          showInlineEvidenceLabels,
          includeSourcesUsedSection,
        })),
      ),
    ),
  )('commits the full document-feature combination %o', async (documentFeatures) => {
    const { service, codex, projectA, paperA } = fixture();
    codex.response = {
      reply: 'Generated with the frozen document features.',
      lectureNotesLatexBody: documentFeatures.includeSourcesUsedSection
        ? lectureNotesBody(['P1'])
        : lectureNotesBodyWithoutSources(['P1']),
      slidesLatexBody: lectureSlidesBody(['P1'], documentFeatures.includeSlideTitlePage ? 1 : 2),
    };
    const studio = await service.create({
      title: 'Document feature matrix',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
      generationBrief: {
        notesTargetPages: null,
        slidesTargetPages: 2,
        detailLevel: 'standard',
        structure: { mode: 'adaptive' },
        documentFeatures,
        customInstructions: '',
      },
    });

    const result = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });

    expect(result.revision.schemaVersion).toBe(3);
    if (result.revision.schemaVersion !== 3) throw new Error('expected v3 revision');
    expect(result.revision.generationBriefSnapshot.documentFeatures).toEqual(documentFeatures);
    expect(result.revision.slidesLatex.includes('\\titlepage')).toBe(
      documentFeatures.includeSlideTitlePage,
    );
    expect(result.revision.lectureNotesLatex).toContain(
      documentFeatures.showInlineEvidenceLabels
        ? '\\newcommand{\\gosuevidence}[1]{[#1]}'
        : '\\newcommand{\\gosuevidence}[1]{\\ifhmode\\unskip\\fi}',
    );
    expect(result.revision.lectureNotesLatex.includes('\\section{Sources used}')).toBe(
      documentFeatures.includeSourcesUsedSection,
    );
    expect(result.revision.lectureNotesLatex).toContain('\\gosuevidence{P1}');
    expect(codex.prompts[0]).toContain(JSON.stringify(documentFeatures));
  });

  it.each([
    {
      name: 'notes',
      lectureNotesLatexBody:
        '\\section{Notes}\nEvidence [P1] and unknown markers [Z1] [L1].\n\\section{Sources used}\n[P1] Paper A',
      slidesLatexBody: '\\begin{frame}{Evidence}\nSupported result [P1].\n\\end{frame}',
    },
    {
      name: 'frame',
      lectureNotesLatexBody:
        '\\section{Notes}\nSupported result [P1].\n\\section{Sources used}\n[P1] Paper A',
      slidesLatexBody:
        '\\begin{frame}{Evidence}\nSupported result [P1] and lowercase marker [p1].\n\\end{frame}',
    },
  ])('rejects an evidence-like unknown marker in hidden mode: $name', async (candidate) => {
    const { service, storage, codex, projectA, paperA } = fixture();
    codex.response = {
      reply: 'Generated with a bogus hidden marker.',
      lectureNotesLatexBody: candidate.lectureNotesLatexBody,
      slidesLatexBody: candidate.slidesLatexBody,
    };
    const studio = await service.create({
      title: 'Hidden marker validation',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
      generationBrief: {
        notesTargetPages: null,
        slidesTargetPages: null,
        detailLevel: 'standard',
        structure: { mode: 'adaptive' },
        documentFeatures: {
          ...DEFAULT_DOCUMENT_FEATURES,
          showInlineEvidenceLabels: false,
        },
        customInstructions: '',
      },
    });

    await expect(
      service.generate({
        studioId: studio.id,
        expectedVersion: studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toMatchObject({ code: 'lecture_invalid_citation_mapping' });
    expect(storage.revisions).toEqual([]);
  });

  it('allows ordinary bracketed prose while hiding validated evidence anchors', async () => {
    const { service, codex, projectA, paperA } = fixture();
    codex.response = {
      reply: 'Generated with ordinary bracketed prose.',
      lectureNotesLatexBody:
        '\\section{Notes}\nEvidence [P1]; see [Table 1], cohort [2026], and index [n].\n\\section{Sources used}\n[P1] Paper A',
      slidesLatexBody:
        '\\begin{frame}{Evidence}\nSupported result [P1]; see [Table 1].\n\\end{frame}',
    };
    const studio = await service.create({
      title: 'Ordinary bracket prose',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
      generationBrief: {
        notesTargetPages: null,
        slidesTargetPages: null,
        detailLevel: 'standard',
        structure: { mode: 'adaptive' },
        documentFeatures: {
          ...DEFAULT_DOCUMENT_FEATURES,
          showInlineEvidenceLabels: false,
        },
        customInstructions: '',
      },
    });

    const result = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    expect(result.revision.schemaVersion).toBe(3);
    if (result.revision.schemaVersion !== 3) throw new Error('expected v3 revision');
    expect(result.revision.lectureNotesLatex).toContain('\\gosuevidence{P1}');
    expect(result.revision.lectureNotesLatex).toContain('[Table 1]');
    expect(result.revision.lectureNotesLatex).toContain('[2026]');
    expect(result.revision.lectureNotesLatex).toContain('[n]');
  });

  it('persists current-message document directives without treating quoted questions as edits', async () => {
    const { service, codex, projectA, paperA } = fixture();
    codex.response = latexResponse(['P1']);
    const studio = await service.create({
      title: 'Assistant document controls',
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

    codex.response = {
      reply: 'Removed the visible document elements.',
      lectureNotesLatexBody: lectureNotesBodyWithoutSources(['P1']),
      slidesLatexBody: lectureSlidesBody(['P1']),
    };
    const hidden = await service.send({
      studioId: studio.id,
      expectedVersion: initial.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: '제목 슬라이드를 빼고 출처 마커를 숨기고 Sources used section을 지워줘.',
    });
    const allHidden = {
      includeSlideTitlePage: false,
      showInlineEvidenceLabels: false,
      includeSourcesUsedSection: false,
    };
    expect(hidden.studio.generationBrief.documentFeatures).toEqual(allHidden);
    expect(hidden.revision.schemaVersion).toBe(3);
    if (hidden.revision.schemaVersion !== 3) throw new Error('expected v3 revision');
    expect(hidden.revision.generationBriefSnapshot.documentFeatures).toEqual(allHidden);
    expect(hidden.revision.slidesLatex).not.toContain('\\titlepage');
    expect(hidden.revision.lectureNotesLatex).toContain(
      '\\newcommand{\\gosuevidence}[1]{\\ifhmode\\unskip\\fi}',
    );

    codex.response = {
      reply: 'Kept the existing Studio options.',
      lectureNotesLatexBody: lectureNotesBodyWithoutSources(['P1']),
      slidesLatexBody: lectureSlidesBody(['P1']),
    };
    const metaQuestion = await service.send({
      studioId: studio.id,
      expectedVersion: hidden.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message:
        '"제목 슬라이드를 넣고 출처 마커를 표시하고 Sources used를 넣어줘" 이게 무슨 뜻이야?',
    });
    expect(metaQuestion.studio.generationBrief.documentFeatures).toEqual(allHidden);
  });

  it('preserves one content frame when the Assistant explicitly enables a title page', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    const titleOffFeatures = {
      ...DEFAULT_DOCUMENT_FEATURES,
      includeSlideTitlePage: false,
    };
    codex.response = latexResponse(['P1']);
    const studio = await service.create({
      title: 'One-page title reconciliation',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
      generationBrief: {
        notesTargetPages: null,
        slidesTargetPages: 1,
        detailLevel: 'standard',
        structure: { mode: 'adaptive' },
        documentFeatures: titleOffFeatures,
        customInstructions: '',
      },
    });
    const initial = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });

    codex.response = latexResponse(['P1'], 1, 'Kept the one-page title-off plan.');
    const unrelated = await service.send({
      studioId: studio.id,
      expectedVersion: initial.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: 'Tighten the explanation.',
    });
    expect(unrelated.studio.generationBrief).toMatchObject({
      slidesTargetPages: 1,
      documentFeatures: titleOffFeatures,
    });

    const explicitPromptIndex = codex.prompts.length;
    codex.response = { reply: 'Incomplete replacement.' };
    await expect(
      service.send({
        studioId: studio.id,
        expectedVersion: unrelated.studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
        message: 'Add the title slide back.',
      }),
    ).rejects.toMatchObject({ code: 'lecture_invalid_response_schema' });
    const failed = storage.getLectureStudio(studio.id)!;
    expect(failed).toMatchObject({
      status: 'failed',
      generationBrief: {
        slidesTargetPages: 2,
        documentFeatures: DEFAULT_DOCUMENT_FEATURES,
      },
    });
    const explicitPayload = JSON.parse(
      codex.prompts[explicitPromptIndex]!.slice(
        codex.prompts[explicitPromptIndex]!.indexOf('\n\n') + 2,
      ),
    ) as { generationBrief: LectureStudio['generationBrief'] };
    expect(explicitPayload.generationBrief).toMatchObject({
      slidesTargetPages: 2,
      documentFeatures: DEFAULT_DOCUMENT_FEATURES,
    });

    codex.response = latexResponse(['P1'], 1, 'Retried with one content frame and a title page.');
    const retried = await service.generate({
      studioId: studio.id,
      expectedVersion: failed.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    expect(retried.revision.schemaVersion).toBe(3);
    if (retried.revision.schemaVersion !== 3) throw new Error('expected v3 revision');
    expect(retried.revision.generationBriefSnapshot).toMatchObject({
      slidesTargetPages: 2,
      documentFeatures: DEFAULT_DOCUMENT_FEATURES,
    });
    expect(retried.revision.slidesLatex).toContain('\\titlepage');
  });

  it('infers a legacy Studio source-list preference from its latest canonical notes', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    const withoutSources = {
      ...DEFAULT_DOCUMENT_FEATURES,
      includeSourcesUsedSection: false,
    };
    codex.response = {
      reply: 'Generated without a visible source list.',
      lectureNotesLatexBody: lectureNotesBodyWithoutSources(['P1']),
      slidesLatexBody: lectureSlidesBody(['P1']),
    };
    const studio = await service.create({
      title: 'Legacy source-list inference',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectA,
      sourceProjectIds: [projectA],
      sourceSelection: {
        literature: [{ projectId: projectA, recordId: paperA.id }],
        experiments: [],
      },
      generationBrief: {
        notesTargetPages: null,
        slidesTargetPages: null,
        detailLevel: 'standard',
        structure: { mode: 'adaptive' },
        documentFeatures: withoutSources,
        customInstructions: '',
      },
    });
    const initial = await service.generate({
      studioId: studio.id,
      expectedVersion: studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    if (initial.revision.schemaVersion !== 3) throw new Error('expected v3 revision');

    const legacyStudioBrief: LectureStudio['generationBrief'] = {
      ...initial.studio.generationBrief,
    };
    delete legacyStudioBrief.documentFeatures;
    const studioIndex = storage.studios.findIndex((candidate) => candidate.id === studio.id);
    storage.studios[studioIndex] = {
      ...storage.studios[studioIndex]!,
      generationBrief: legacyStudioBrief,
    };
    const legacySnapshot: LectureStudio['generationBrief'] = {
      ...initial.revision.generationBriefSnapshot,
    };
    delete legacySnapshot.documentFeatures;
    const revisionIndex = storage.revisions.findIndex(
      (candidate) => candidate.id === initial.revision.id,
    );
    storage.revisions[revisionIndex] = {
      ...initial.revision,
      generationBriefSnapshot: legacySnapshot,
    };

    const regenerated = await service.generate({
      studioId: studio.id,
      expectedVersion: initial.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });
    expect(regenerated.studio.generationBrief.documentFeatures).toEqual(withoutSources);
    expect(codex.prompts.at(-1)).toContain('"includeSourcesUsedSection":false');
  });

  it.each(['References', 'Sources   used'])(
    'reopens and regenerates a legacy custom %s topic without treating it as a source list',
    async (legacySectionTitle) => {
      const { service, storage, codex, projectA, paperA } = fixture();
      const withoutSources = {
        ...DEFAULT_DOCUMENT_FEATURES,
        includeSourcesUsedSection: false,
      };
      codex.response = {
        reply: 'Generated the initial source-list-free revision.',
        lectureNotesLatexBody: lectureNotesBodyWithoutSources(['P1']),
        slidesLatexBody: lectureSlidesBody(['P1']),
      };
      const studio = await service.create({
        title: 'Legacy References topic',
        kind: 'lecture',
        durationMinutes: null,
        outputProjectId: projectA,
        sourceProjectIds: [projectA],
        sourceSelection: {
          literature: [{ projectId: projectA, recordId: paperA.id }],
          experiments: [],
        },
        generationBrief: {
          notesTargetPages: null,
          slidesTargetPages: null,
          detailLevel: 'standard',
          structure: { mode: 'adaptive' },
          documentFeatures: withoutSources,
          customInstructions: '',
        },
      });
      const initial = await service.generate({
        studioId: studio.id,
        expectedVersion: studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
      });
      if (initial.revision.schemaVersion !== 3) throw new Error('expected v3 revision');

      const legacyBrief: LectureStudio['generationBrief'] = {
        ...initial.studio.generationBrief,
        structure: {
          mode: 'custom',
          sections: [{ title: legacySectionTitle, coverage: 'notes-and-slides' }],
        },
      };
      delete legacyBrief.documentFeatures;
      const studioIndex = storage.studios.findIndex((candidate) => candidate.id === studio.id);
      storage.studios[studioIndex] = {
        ...storage.studios[studioIndex]!,
        generationBrief: legacyBrief,
      };
      const legacySnapshot: LectureStudio['generationBrief'] = {
        ...initial.revision.generationBriefSnapshot,
        structure: legacyBrief.structure,
      };
      delete legacySnapshot.documentFeatures;
      const revisionIndex = storage.revisions.findIndex(
        (candidate) => candidate.id === initial.revision.id,
      );
      storage.revisions[revisionIndex] = {
        ...initial.revision,
        generationBriefSnapshot: legacySnapshot,
        generationBriefSha256: hash(JSON.stringify(legacySnapshot)),
        authoringPolicyVersion: 6,
      };

      codex.response = {
        reply: 'Regenerated the historical References content topic.',
        lectureNotesLatexBody: `\\section{${legacySectionTitle}}\nReference-estimator content remains supported [P1].`,
        slidesLatexBody: lectureSlidesBody(['P1']),
      };
      const regenerated = await service.generate({
        studioId: studio.id,
        expectedVersion: initial.studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
      });
      expect(regenerated.studio.generationBrief).toMatchObject({
        structure: legacyBrief.structure,
        documentFeatures: withoutSources,
      });
      expect(regenerated.revision.schemaVersion).toBe(3);
      if (regenerated.revision.schemaVersion !== 3) throw new Error('expected v3 revision');
      expect(regenerated.revision.lectureNotesLatex).toContain(`\\section{${legacySectionTitle}}`);
      expect(regenerated.revision.lectureNotesLatex).toContain('\\gosuevidence{P1}');
      expect(regenerated.revision.lectureNotesLatex).not.toContain('\\section{Sources used}');
      expect(regenerated.revision.artifacts.map((artifact) => artifact.kind).sort()).toEqual([
        'lecture-notes',
        'slides',
      ]);
      await expect(service.detail({ studioId: studio.id })).resolves.toMatchObject({
        studio: { id: studio.id, currentRevision: 2 },
        revisions: [{ id: regenerated.revision.id }],
      });
    },
  );

  it('uses only the current request to change Sources used and freezes it across correction', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    codex.response = latexResponse(['P1']);
    const studio = await service.create({
      title: 'Optional source list',
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
    const priorDirectionAt = new Date().toISOString();
    storage.messages.push({
      schemaVersion: 1,
      id: randomUUID(),
      studioId: studio.id,
      role: 'user',
      status: 'complete',
      content: 'Source used section 을 아예 빼달라니까',
      attemptId: null,
      revision: initial.revision.revision,
      invocation: null,
      createdAt: priorDirectionAt,
      completedAt: priorDirectionAt,
    });
    codex.response = latexResponse(['P1'], 1, 'Kept the current Studio preference.');
    const unchanged = await service.send({
      studioId: studio.id,
      expectedVersion: initial.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: '왜 아직 남아 있어?',
    });
    if (unchanged.revision.schemaVersion === 1) throw new Error('expected LaTeX revision');
    expect(unchanged.revision.lectureNotesLatex).toContain('Sources used');
    expect(unchanged.studio.generationBrief.documentFeatures).toEqual(DEFAULT_DOCUMENT_FEATURES);

    const promptCountBeforeOmission = codex.prompts.length;
    codex.response = {
      reply: 'Removed only the requested source list.',
      edits: [
        {
          document: 'lecture-notes',
          find: '\n\\section{Sources used}\n[P1] Fixture source P1',
          replace: '',
        },
      ],
    };

    const omitted = await service.send({
      studioId: studio.id,
      expectedVersion: unchanged.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: 'Sources used" 이부분 지워줘',
    });

    expect(omitted.revision.schemaVersion).toBe(3);
    if (omitted.revision.schemaVersion !== 3) throw new Error('expected model v3 revision');
    expect(omitted.revision.invocation).not.toBeNull();
    expect(omitted.revision.lectureNotesLatex).not.toContain('Sources used');
    expect(omitted.revision.lectureNotesLatex).toContain('\\gosuevidence{P1}');
    expect(omitted.studio.generationBrief.documentFeatures).toEqual({
      ...DEFAULT_DOCUMENT_FEATURES,
      includeSourcesUsedSection: false,
    });
    expect(omitted.assistantMessage.content).toContain('Removed only the requested source list.');
    expect(codex.prompts).toHaveLength(promptCountBeforeOmission + 1);
    const omissionPrompt = codex.prompts.at(-1)!;
    const omissionPayload = JSON.parse(
      omissionPrompt.slice(omissionPrompt.indexOf('\n\n') + 2),
    ) as {
      request: string;
      currentDraft: { lectureNotes: string; slides: string };
    };
    expect(omissionPayload.request).toBe('Sources used" 이부분 지워줘');
    expect(omissionPayload.currentDraft.lectureNotes).toContain('\\section{Sources used}');
    expect(omissionPayload.currentDraft.lectureNotes).not.toContain('\\documentclass');
    expect(omissionPayload.currentDraft.slides).not.toContain('\\documentclass');
    expect(codex.outputSchemas.at(-1)?.required).toEqual(['reply', 'edits']);

    codex.response = latexResponse(['P1'], 1, 'Restored the visible source list.');
    const restored = await service.send({
      studioId: studio.id,
      expectedVersion: omitted.studio.version,
      requestedModelId: null,
      reasoningOptionId: null,
      message: 'Sources used section은 삭제하지 말고 그대로 유지해줘.',
    });
    expect(restored.revision.schemaVersion).toBe(3);
    if (restored.revision.schemaVersion !== 3) throw new Error('expected LaTeX revision');
    expect(restored.revision.lectureNotesLatex).toContain('\\section{Sources used}');
    expect(restored.studio.generationBrief.documentFeatures).toEqual(DEFAULT_DOCUMENT_FEATURES);
  });

  it('preserves an explicit source-list direction when a failed edit is retried', async () => {
    const { service, storage, codex, projectA, paperA } = fixture();
    codex.response = latexResponse(['P1']);
    const studio = await service.create({
      title: 'Retry source-list direction',
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
    codex.response = { reply: 'Incomplete replacement.' };

    await expect(
      service.send({
        studioId: studio.id,
        expectedVersion: initial.studio.version,
        requestedModelId: null,
        reasoningOptionId: null,
        message: 'Sources used section을 완전히 없애고 도입부도 간결하게 고쳐줘.',
      }),
    ).rejects.toMatchObject({ code: 'lecture_invalid_response_schema' });
    const failed = storage.getLectureStudio(studio.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.generationBrief.documentFeatures).toEqual({
      ...DEFAULT_DOCUMENT_FEATURES,
      includeSourcesUsedSection: false,
    });
    expect(
      storage.messages.find(
        (message) => message.role === 'user' && message.content.includes('도입부도 간결하게'),
      ),
    ).toMatchObject({ status: 'failed' });

    codex.response = {
      reply: 'Retried without the visible source list.',
      lectureNotesLatexBody: lectureNotesBodyWithoutSources(['P1']),
      slidesLatexBody: lectureSlidesBody(['P1']),
    };
    const retried = await service.generate({
      studioId: studio.id,
      expectedVersion: failed.version,
      requestedModelId: null,
      reasoningOptionId: null,
    });

    expect(retried.revision.schemaVersion).toBe(3);
    if (retried.revision.schemaVersion !== 3) throw new Error('expected LaTeX revision');
    expect(retried.revision.lectureNotesLatex).not.toContain('Sources used');
    expect(codex.prompts.at(-1)).toContain('"includeSourcesUsedSection":false');
    expect(retried.revision.generationBriefSnapshot.documentFeatures).toEqual({
      ...DEFAULT_DOCUMENT_FEATURES,
      includeSourcesUsedSection: false,
    });
  });

  it('requires a complete mapping when Sources used is present and rejects unsupported syntax', async () => {
    for (const lectureNotesLatexBody of [
      '\\section{Notes}\nUncited factual prose.\n\\section{Sources used}\n[P1] Paper A',
      '\\section{Notes}\nEvidence [P1].\n\\section{Sources used}\nNo mapped label.',
      '\\section{Notes}\nEvidence [P1].\n\\section{Sources used}\n[P1]',
      '\\section{Notes}\nPandoc citation [@fake] and evidence [P1].\n\\section{Sources used}\n[P1] Paper A',
      '\\section{Notes}\nUnsupported \\cite[see][p. 2]{not-in-manifest} and evidence [P1].\n\\section{Sources used}\n[P1] Paper A',
      `\\section{Notes}\n${LECTURE_STUDIO_RETIRED_TURN_ATTACHMENT_CITATION_MARKER} Evidence [P1].\n\\section{Sources used}\n[P1] Paper A`,
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
      ).rejects.toMatchObject({ code: 'lecture_invalid_citation_mapping' });
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

  it('does not seal a v3 pending bundle when its generation provenance was stripped', async () => {
    const pendingArtifacts: PendingLectureRevisionArtifacts[] = [];
    const { service, artifactEvents, projectA, projectB, paperA, paperB } = fixture({
      pendingArtifacts,
    });
    const studio = await service.create({
      title: 'Strict restart recovery',
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
    const {
      generationBriefSha256: _generationBriefSha256,
      authoringPolicyVersion: _authoringPolicyVersion,
      authoringPolicySha256: _authoringPolicySha256,
      ...stripped
    } = pendingFromRevision(receipt.studio, receipt.revision);
    pendingArtifacts.push(stripped);

    await service.list({});

    expect(artifactEvents).toEqual([]);
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
    for (const [slidesLatexBody, expectedCode] of [
      [
        '\\begin{frame}{Talk}\nUnknown evidence [P99]\n\\end{frame}',
        'lecture_invalid_citation_mapping',
      ],
      [
        '\\begin{frame}{Talk}\n<script>alert(1)</script> [P1]\n\\end{frame>',
        'lecture_invalid_latex_grammar',
      ],
      [
        '\\begin{frame}{Talk}\n<div>raw HTML</div> [P1]\n\\end{frame>',
        'lecture_invalid_latex_grammar',
      ],
      [
        '\\begin{frame}{Talk}\n\\includegraphics{https://example.invalid/plot.png} [P1]\n\\end{frame}',
        'lecture_invalid_latex_grammar',
      ],
      [lectureSlidesBody(['P1'], 1), 'lecture_invalid_slide_count'],
      [uncitedSlideDeck, 'lecture_invalid_citation_mapping'],
    ] as const) {
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
      ).rejects.toMatchObject({ code: expectedCode });
      expect(storage.revisions).toHaveLength(0);
    }
  });
});
