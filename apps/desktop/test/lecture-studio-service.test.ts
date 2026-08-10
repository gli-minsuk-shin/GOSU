import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  LectureStudioService,
  LectureStudioServiceError,
  type LectureStudioStorage,
} from '../src/main/lecture-studio-service';
import { LectureStudioStorageError } from '../src/main/lecture-studio-storage-error';
import type {
  LectureStudio,
  LectureStudioDetail,
  LectureStudioMessage,
  LectureStudioRevision,
  PendingLectureRevisionArtifacts,
} from '../src/shared/lecture-studio-contracts';
import type { LiteratureRecord } from '../src/shared/literature-contracts';
import type {
  ExperimentIdea,
  ExperimentMetricPoint,
} from '../src/shared/experiment-workspace-contracts';
import type { WorkspaceSnapshot } from '../src/shared/workspace-contracts';

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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

class MemoryStorage implements LectureStudioStorage {
  readonly studios: LectureStudio[] = [];
  readonly messages: LectureStudioMessage[] = [];
  readonly revisions: LectureStudioRevision[] = [];

  listLectureStudios() {
    return this.studios.map(
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
}

class FakeCodex extends EventEmitter {
  response: unknown = {
    reply: 'Created a cross-project synthesis.',
    lectureNotesMarkdown:
      '# Lecture notes\n\nEvidence [P1] and [P2].\n\n## Sources used\n\n- [P1] Paper A\n- [P2] Paper B',
    slidesMarkdown: Array.from(
      { length: 10 },
      (_, index) => `# Slide ${index + 1}\n\nEvidence [P${index % 2 === 0 ? 1 : 2}]`,
    ).join('\n\n---\n\n'),
  };
  startInput: Record<string, unknown> | null = null;
  prompt = '';
  deferCompletion = false;
  lastThreadId: string | null = null;
  lastTurnId: string | null = null;

  async startThread(input: Record<string, unknown>) {
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
          params: { threadId: input.threadId, turn: { id: turnId, status: 'completed' } },
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

  async releaseThread() {}
}

function fixture(
  options: Readonly<{
    artifactDestinationReady?: boolean;
    failAfterArtifactPublish?: boolean;
    pendingArtifacts?: PendingLectureRevisionArtifacts[];
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
        return [
          {
            kind: 'lecture-notes',
            relativePath: `Lecture Notes & Slides/Studio/Lecture Notes--r${input.revision}.md`,
            contentSha256: hash(input.lectureNotesMarkdown),
            savedAt: input.createdAt,
          },
          {
            kind: 'slides',
            relativePath: `Lecture Notes & Slides/Studio/Slides--r${input.revision}.md`,
            contentSha256: hash(input.slidesMarkdown),
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
    },
    codex,
    prepareDirectory: async () => '/tmp/gosu-lecture-studio-fixture',
    timeoutMs: 5_000,
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
      'Lecture Notes & Slides/Studio/Lecture Notes--r1.md',
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
    codex.response = {
      reply: 'Created a bounded experiment lecture.',
      lectureNotesMarkdown:
        '# Lecture notes\n\nExperiment evidence [E1].\n\n## Sources used\n\n- [E1] Bounded experiment history',
      slidesMarkdown: '# Lecture slides\n\n## Result\n\nExperiment evidence [E1].',
    };
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
    codex.response = {
      reply: 'Created a screening-evidence lecture.',
      lectureNotesMarkdown:
        '# Lecture notes\n\nEvidence [P1].\n\n## Sources used\n\n- [P1] Screening paper',
      slidesMarkdown: '# Lecture slides\n\nEvidence [P1].',
    };
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
    codex.response = { reply: 'missing markdown fields' };

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
    for (const lectureNotesMarkdown of [
      '# Notes\n\nEvidence [P1].',
      '# Notes\n\nEvidence [P1].\n\n## Sources used\n\nNo mapped label.',
      '# Notes\n\nPandoc citation [@fake] and evidence [P1].\n\n## Sources used\n\n- [P1] Paper A',
    ]) {
      const { service, storage, codex, projectA, paperA } = fixture();
      codex.response = {
        reply: 'Generated.',
        lectureNotesMarkdown,
        slidesMarkdown: '# Slides\n\nEvidence [P1].',
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

  it('rolls back the exact staged Markdown bundle when DB completion fails', async () => {
    const { service, storage, codex, artifactEvents, projectA, paperA } = fixture();
    vi.spyOn(storage, 'completeLectureStudioTurn').mockImplementation(() => {
      throw new Error('db_write_failed');
    });
    codex.response = {
      reply: 'Generated.',
      lectureNotesMarkdown: '# Notes\n\nEvidence [P1].\n\n## Sources used\n\n- [P1] Paper A',
      slidesMarkdown: '# Slides\n\nEvidence [P1].',
    };
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
        `# Slide ${index + 1}\n\n${index === 1 ? 'Unsupported synthesis.' : 'Evidence [P1].'}`,
    ).join('\n\n---\n\n');
    for (const slidesMarkdown of [
      '# Talk\n\nUnknown evidence [P99]',
      '# Talk\n\n<script>alert(1)</script> [P1]',
      '# Talk\n\n<div>raw HTML</div> [P1]',
      '# Talk\n\n![remote](https://example.invalid/plot.png) [P1]',
      '# One\n\nEvidence [P1]\n\n---\n\n# Two\n\nEvidence [P1]',
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
        lectureNotesMarkdown: '# Notes\n\nEvidence [P1].\n\n## Sources used\n\n- [P1] Paper A',
        slidesMarkdown,
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
