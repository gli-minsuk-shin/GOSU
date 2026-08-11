import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  ExperimentWorkspaceService,
  type ExperimentRunExecutionBinding,
  type ExperimentRunExecutionIntent,
  type ExperimentRunLogSource,
  type ExperimentWorkspaceStorage,
} from '../src/main/experiment-workspace-service';
import type {
  ExperimentIdea,
  ExperimentLoggingTemplate,
  ExperimentMetricPoint,
  ExperimentRun,
} from '../src/shared/experiment-workspace-contracts';
import type { WorkspaceObjective, WorkspaceSnapshot } from '../src/shared/workspace-contracts';
import type { WorkspaceService } from '../src/main/workspace-service';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-06T00:00:00.000Z');

function objective(overrides: Partial<WorkspaceObjective> = {}): WorkspaceObjective {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    projectId: PROJECT_ID,
    objectiveVersion: 2,
    entityVersion: 4,
    locked: true,
    goal: 'Improve the held-out evaluation score with reproducible experiments.',
    primaryMetric: {
      key: 'held-out-score',
      displayName: 'Held-out score',
      direction: 'maximize',
      unit: '%',
      aggregation: 'mean',
      evaluatorHash: 'sha256:evaluator',
      datasetHash: 'sha256:dataset',
      holdoutHash: 'sha256:holdout',
      baseline: 49.58,
      target: 55,
    },
    guardrails: [],
    budget: {
      maxTrials: 20,
      maxConcurrentTrials: 2,
      maxWallTimeSeconds: 86_400,
      maxGpuHours: 24,
      maxFailures: 4,
    },
    stopPolicy: {
      stopWhenTargetReached: true,
      guardrailAction: 'pause',
      maxConsecutiveNoImprovement: 5,
    },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function workspaceSnapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    schemaVersion: 1,
    revision: 1,
    projects: [
      {
        id: PROJECT_ID,
        name: 'Trajectory fixture',
        slug: 'trajectory-fixture',
        version: 1,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    ],
    tasks: [],
    objectives: [objective()],
    ...overrides,
  };
}

function workspace(snapshot: WorkspaceSnapshot = workspaceSnapshot()) {
  return { snapshot: vi.fn(async () => snapshot) } as unknown as WorkspaceService;
}

class MemoryExperimentStorage implements ExperimentWorkspaceStorage {
  readonly ideas: ExperimentIdea[] = [];
  readonly metricPoints: ExperimentMetricPoint[] = [];
  readonly loggingTemplates: ExperimentLoggingTemplate[] = [];
  readonly runs: ExperimentRun[] = [];
  readonly logSources: ExperimentRunLogSource[] = [];
  readonly executionBindings: ExperimentRunExecutionBinding[] = [];
  readonly executionIntents: ExperimentRunExecutionIntent[] = [];

  listExperimentIdeas(projectId: string) {
    return this.ideas.filter((idea) => idea.projectId === projectId);
  }

  listExperimentMetricPoints(projectId: string) {
    return this.metricPoints.filter((point) => point.projectId === projectId);
  }

  getExperimentIdea(projectId: string, ideaId: string) {
    return this.ideas.find((idea) => idea.projectId === projectId && idea.id === ideaId) ?? null;
  }

  createExperimentIdea(idea: ExperimentIdea) {
    this.ideas.push(idea);
    return true;
  }

  updateExperimentIdea(idea: ExperimentIdea, expectedVersion: number) {
    const index = this.ideas.findIndex(
      (candidate) =>
        candidate.projectId === idea.projectId &&
        candidate.id === idea.id &&
        candidate.version === expectedVersion,
    );
    if (index < 0) return null;
    this.ideas[index] = idea;
    return idea;
  }

  appendExperimentMetricPoint(point: Omit<ExperimentMetricPoint, 'sequence'>) {
    const stored = { ...point, sequence: this.metricPoints.length + 1 };
    this.metricPoints.push(stored);
    return stored;
  }

  findExperimentMetricPointByTrial(projectId: string, trialId: string) {
    return (
      this.metricPoints.find(
        (point) =>
          point.projectId === projectId &&
          point.trialId === trialId &&
          point.source === 'runner-summary',
      ) ?? null
    );
  }

  getLatestExperimentLoggingTemplate(projectId: string) {
    return (
      this.loggingTemplates
        .filter((template) => template.projectId === projectId)
        .sort((left, right) => right.version - left.version)[0] ?? null
    );
  }

  appendExperimentLoggingTemplate(template: ExperimentLoggingTemplate, expectedVersion: number) {
    const current = this.getLatestExperimentLoggingTemplate(template.projectId);
    if ((current?.version ?? 0) !== expectedVersion) return null;
    this.loggingTemplates.push(template);
    return template;
  }

  listExperimentRuns(projectId: string) {
    return this.runs
      .filter((run) => run.projectId === projectId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getExperimentRun(projectId: string, runId: string) {
    return this.runs.find((run) => run.projectId === projectId && run.id === runId) ?? null;
  }

  getExperimentRunByTrial(projectId: string, trialId: string) {
    return this.runs.find((run) => run.projectId === projectId && run.trialId === trialId) ?? null;
  }

  createExperimentRun(run: ExperimentRun) {
    if (this.runs.some((candidate) => candidate.id === run.id)) return false;
    this.runs.push(run);
    return true;
  }

  updateExperimentRun(run: ExperimentRun, expectedVersion: number) {
    const index = this.runs.findIndex(
      (candidate) =>
        candidate.projectId === run.projectId &&
        candidate.id === run.id &&
        candidate.version === expectedVersion,
    );
    if (index < 0) return null;
    this.runs[index] = run;
    return run;
  }

  linkExperimentRunLogSource(source: ExperimentRunLogSource) {
    const existing = this.logSources.find(({ referenceId }) => referenceId === source.referenceId);
    if (existing) return JSON.stringify(existing) === JSON.stringify(source);
    this.logSources.push(source);
    return true;
  }

  getExperimentRunLogSource(projectId: string, runId: string, referenceId: string) {
    return (
      this.logSources.find(
        (source) =>
          source.projectId === projectId &&
          source.runId === runId &&
          source.referenceId === referenceId,
      ) ?? null
    );
  }

  bindExperimentRunExecution(binding: ExperimentRunExecutionBinding) {
    const existing = this.executionBindings.find(
      (candidate) => candidate.projectId === binding.projectId && candidate.runId === binding.runId,
    );
    if (existing) return existing.workspaceGrantId === binding.workspaceGrantId;
    this.executionBindings.push(binding);
    return true;
  }

  getExperimentRunExecutionBinding(projectId: string, runId: string) {
    return (
      this.executionBindings.find(
        (binding) => binding.projectId === projectId && binding.runId === runId,
      ) ?? null
    );
  }

  stageExperimentRunExecutionIntent(intent: ExperimentRunExecutionIntent) {
    const existing = this.executionIntents.find(
      (candidate) => candidate.projectId === intent.projectId && candidate.runId === intent.runId,
    );
    if (existing) {
      return JSON.stringify(existing) === JSON.stringify(intent);
    }
    this.executionIntents.push(intent);
    return true;
  }

  getExperimentRunExecutionIntent(projectId: string, runId: string) {
    return (
      this.executionIntents.find(
        (intent) => intent.projectId === projectId && intent.runId === runId,
      ) ?? null
    );
  }
}

describe('Experiment workspace service', () => {
  it('creates a same-project idea lineage and publishes bounded change events', async () => {
    const storage = new MemoryExperimentStorage();
    const service = new ExperimentWorkspaceService({
      storage,
      workspace: workspace(),
      now: () => NOW,
    });
    const events = vi.fn();
    service.onEvent(events);

    const root = await service.createIdea({
      projectId: PROJECT_ID,
      title: 'Idea A',
      hypothesis: 'A reproducible baseline will expose the bottleneck.',
      phase: 'Reproduce',
    });
    const child = await service.createIdea({
      projectId: PROJECT_ID,
      parentIdeaId: root.id,
      title: 'Idea A-1',
      hypothesis: 'Change only the gating rule.',
      phase: 'Improve',
    });

    expect(child.parentIdeaId).toBe(root.id);
    expect(child.outcome).toBe('planned');
    expect(events).toHaveBeenCalledTimes(2);
    expect(events.mock.calls[1]?.[0]).toMatchObject({
      projectId: PROJECT_ID,
      entityType: 'idea',
      entityId: child.id,
    });
  });

  it('rejects a parent outside the requested project', async () => {
    const storage = new MemoryExperimentStorage();
    storage.ideas.push({
      schemaVersion: 1,
      id: randomUUID(),
      projectId: OTHER_PROJECT_ID,
      parentIdeaId: null,
      title: 'Foreign idea',
      hypothesis: '',
      phase: '',
      outcome: 'planned',
      resultSummary: '',
      version: 1,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      completedAt: null,
    });
    const service = new ExperimentWorkspaceService({ storage, workspace: workspace() });

    await expect(
      service.createIdea({
        projectId: PROJECT_ID,
        parentIdeaId: storage.ideas[0]!.id,
        title: 'Invalid child',
      }),
    ).rejects.toMatchObject({ code: 'experiment_parent_not_found' });
  });

  it('uses optimistic versions and manages terminal completion timestamps', async () => {
    const storage = new MemoryExperimentStorage();
    const service = new ExperimentWorkspaceService({
      storage,
      workspace: workspace(),
      now: () => NOW,
    });
    const created = await service.createIdea({ projectId: PROJECT_ID, title: 'Idea A' });
    const completed = await service.updateIdea({
      projectId: PROJECT_ID,
      ideaId: created.id,
      expectedVersion: 1,
      title: created.title,
      hypothesis: created.hypothesis,
      phase: created.phase,
      outcome: 'partial',
      resultSummary: 'Improved one split but not the holdout.',
    });

    expect(completed.version).toBe(2);
    expect(completed.completedAt).toBe(NOW.toISOString());
    await expect(
      service.updateIdea({
        projectId: PROJECT_ID,
        ideaId: created.id,
        expectedVersion: 1,
        title: created.title,
        hypothesis: '',
        phase: '',
        outcome: 'running',
        resultSummary: '',
      }),
    ).rejects.toMatchObject({ code: 'experiment_idea_conflict' });

    const running = await service.updateIdea({
      projectId: PROJECT_ID,
      ideaId: created.id,
      expectedVersion: completed.version,
      title: created.title,
      hypothesis: '',
      phase: '',
      outcome: 'running',
      resultSummary: '',
    });
    expect(running.completedAt).toBeNull();
  });

  it('records a self-contained metric snapshot only from the locked latest objective', async () => {
    const storage = new MemoryExperimentStorage();
    const service = new ExperimentWorkspaceService({
      storage,
      workspace: workspace(),
      now: () => NOW,
    });
    const idea = await service.createIdea({ projectId: PROJECT_ID, title: 'Idea A' });
    const point = await service.recordMetric({
      projectId: PROJECT_ID,
      ideaId: idea.id,
      value: 52.29,
      trialId: 'trial-17',
    });

    expect(point).toMatchObject({
      projectId: PROJECT_ID,
      ideaId: idea.id,
      sequence: 1,
      objectiveVersion: 2,
      metricKey: 'held-out-score',
      direction: 'maximize',
      aggregation: 'mean',
      evaluatorHash: 'sha256:evaluator',
      datasetHash: 'sha256:dataset',
      holdoutHash: 'sha256:holdout',
      baseline: 49.58,
      target: 55,
      value: 52.29,
      source: 'manual',
      trialId: 'trial-17',
    });
  });

  it('rejects metric evidence when the latest objective is editable', async () => {
    const storage = new MemoryExperimentStorage();
    const service = new ExperimentWorkspaceService({
      storage,
      workspace: workspace(workspaceSnapshot({ objectives: [objective({ locked: false })] })),
    });
    const idea = await service.createIdea({ projectId: PROJECT_ID, title: 'Idea A' });

    await expect(
      service.recordMetric({ projectId: PROJECT_ID, ideaId: idea.id, value: 1 }),
    ).rejects.toMatchObject({ code: 'experiment_objective_required' });
    expect(storage.metricPoints).toHaveLength(0);
  });

  it('creates a deterministic default logging template and revises it with CAS', async () => {
    const storage = new MemoryExperimentStorage();
    const service = new ExperimentWorkspaceService({
      storage,
      workspace: workspace(),
      now: () => NOW,
    });

    const first = await service.list({ projectId: PROJECT_ID });
    const second = await service.list({ projectId: PROJECT_ID });
    expect(first.loggingTemplate).toEqual(second.loggingTemplate);
    expect(first.loggingTemplate.systemFields).toContain('objective_version');
    expect(first.loggingTemplate.customFields.map(({ key }) => key)).toEqual([
      'step',
      'elapsed_seconds',
    ]);

    const revised = await service.reviseLoggingTemplate({
      projectId: PROJECT_ID,
      expectedVersion: 1,
      customFields: [
        {
          key: 'validation_loss',
          label: 'Validation loss',
          type: 'number',
          category: 'metric',
          requiredAt: ['progress', 'summary'],
          unit: null,
        },
      ],
    });
    expect(revised.version).toBe(2);
    expect(revised.previousRevisionId).toBe(first.loggingTemplate.id);
    await expect(
      service.reviseLoggingTemplate({
        projectId: PROJECT_ID,
        expectedVersion: 1,
        customFields: [],
      }),
    ).rejects.toMatchObject({ code: 'experiment_logging_template_conflict' });
  });

  it('rejects duplicate, reserved, and secret-like custom logging fields', async () => {
    const storage = new MemoryExperimentStorage();
    const service = new ExperimentWorkspaceService({ storage, workspace: workspace() });
    await service.list({ projectId: PROJECT_ID });
    const field = {
      key: 'loss',
      label: 'Loss',
      type: 'number' as const,
      category: 'metric' as const,
      requiredAt: ['summary' as const],
      unit: null,
    };

    await expect(
      service.reviseLoggingTemplate({
        projectId: PROJECT_ID,
        expectedVersion: 1,
        customFields: [field, field],
      }),
    ).rejects.toBeTruthy();
    for (const key of ['run_id', 'api_key']) {
      await expect(
        service.reviseLoggingTemplate({
          projectId: PROJECT_ID,
          expectedVersion: 1,
          customFields: [{ ...field, key }],
        }),
      ).rejects.toBeTruthy();
    }
  });

  it('supports objective-free exploratory runs and comparable runs with a null target', async () => {
    const storage = new MemoryExperimentStorage();
    const service = new ExperimentWorkspaceService({
      storage,
      workspace: workspace(
        workspaceSnapshot({
          objectives: [
            objective({ primaryMetric: { ...objective().primaryMetric, target: null } }),
          ],
        }),
      ),
      now: () => NOW,
    });
    const exploratory = await service.createRun({
      projectId: PROJECT_ID,
      ideaId: null,
      title: 'Explore representation statistics',
      mode: 'exploratory',
      serverLabel: 'GPU lab',
      trialId: 'explore-1',
    });
    expect(exploratory).toMatchObject({ objectiveId: null, objectiveVersion: null });

    const idea = await service.createIdea({ projectId: PROJECT_ID, title: 'Idea A' });
    const comparable = await service.createRun({
      projectId: PROJECT_ID,
      ideaId: idea.id,
      title: 'Comparable baseline',
      mode: 'comparable',
      serverLabel: 'GPU lab',
      trialId: 'trial-no-target',
    });
    expect(comparable).toMatchObject({
      objectiveId: objective().id,
      objectiveVersion: 2,
      status: 'queued',
    });
  });

  it('creates a trial idempotently and rejects a conflicting reuse of the same trial id', async () => {
    const storage = new MemoryExperimentStorage();
    const service = new ExperimentWorkspaceService({
      storage,
      workspace: workspace(),
      now: () => NOW,
    });
    const input = {
      projectId: PROJECT_ID,
      ideaId: null,
      title: 'Retry-safe exploratory run',
      mode: 'exploratory' as const,
      serverLabel: 'GPU lab',
      trialId: 'retry-safe-trial',
    };

    const created = await service.createRun(input);
    const repeated = await service.createRun(input);

    expect(repeated.id).toBe(created.id);
    expect(storage.runs).toHaveLength(1);
    await expect(service.createRun({ ...input, title: 'Conflicting retry' })).rejects.toMatchObject(
      {
        code: 'experiment_run_conflict',
      },
    );
  });

  it('enforces terminal run transitions and idempotently ingests validated summaries', async () => {
    const storage = new MemoryExperimentStorage();
    const service = new ExperimentWorkspaceService({
      storage,
      workspace: workspace(),
      now: () => NOW,
    });
    const idea = await service.createIdea({ projectId: PROJECT_ID, title: 'Idea A' });
    const created = await service.createRun({
      projectId: PROJECT_ID,
      ideaId: idea.id,
      title: 'Tracked run',
      mode: 'comparable',
      serverLabel: '8x RTX 3080',
      trialId: 'tracked-17',
    });
    const running = await service.updateRun({
      projectId: PROJECT_ID,
      runId: created.id,
      expectedVersion: created.version,
      status: 'running',
      progressCurrent: 1,
      progressTotal: 10,
      currentStep: 'training',
    });
    const logReference = {
      referenceId: randomUUID(),
      displayName: 'trial-17.jsonl',
      contentHash: `sha256:${'a'.repeat(64)}`,
      sizeBytes: 4096,
      validationState: 'pending' as const,
      missingFields: [],
    };
    const verifying = await service.updateRun({
      projectId: PROJECT_ID,
      runId: running.id,
      expectedVersion: running.version,
      status: 'verifying',
      progressCurrent: 10,
      processExitCode: 0,
      processDurationMs: 12_345,
      logReference,
    });
    const succeeded = await service.updateRun({
      projectId: PROJECT_ID,
      runId: verifying.id,
      expectedVersion: verifying.version,
      status: 'succeeded',
      latestMetric: {
        key: 'held-out-score',
        displayName: 'Held-out score',
        value: 52.29,
        unit: '%',
      },
      logReference: {
        ...logReference,
        validationState: 'valid',
      },
    });
    expect(succeeded.completedAt).toBe(NOW.toISOString());
    const workspaceGrantId = randomUUID();
    await service.bindRunExecution({
      projectId: PROJECT_ID,
      runId: succeeded.id,
      workspaceGrantId,
    });
    await expect(
      service.linkRunLogSource({
        referenceId: succeeded.logReference!.referenceId,
        projectId: PROJECT_ID,
        runId: succeeded.id,
        workspaceGrantId: randomUUID(),
        workspaceSubdirectory: null,
        relativePath: 'runs/trial-17.jsonl',
      }),
    ).rejects.toMatchObject({ code: 'experiment_run_log_source_invalid' });
    await service.linkRunLogSource({
      referenceId: succeeded.logReference!.referenceId,
      projectId: PROJECT_ID,
      runId: succeeded.id,
      workspaceGrantId,
      workspaceSubdirectory: null,
      relativePath: 'runs/trial-17.jsonl',
    });
    await expect(
      service.updateRun({
        projectId: PROJECT_ID,
        runId: succeeded.id,
        expectedVersion: succeeded.version,
        status: 'running',
      }),
    ).rejects.toMatchObject({ code: 'experiment_run_transition_invalid' });
    await expect(
      service.updateRun({
        projectId: PROJECT_ID,
        runId: succeeded.id,
        expectedVersion: succeeded.version,
        latestMetric: {
          key: 'held-out-score',
          displayName: 'Held-out score',
          value: 99,
          unit: '%',
        },
      }),
    ).rejects.toMatchObject({ code: 'experiment_run_transition_invalid' });

    const point = await service.recordRunSummaryMetric({
      projectId: PROJECT_ID,
      runId: succeeded.id,
      value: 52.29,
    });
    const repeated = await service.recordRunSummaryMetric({
      projectId: PROJECT_ID,
      runId: succeeded.id,
      value: 52.29,
    });
    expect(point).toMatchObject({ source: 'runner-summary', trialId: 'tracked-17' });
    expect(repeated.id).toBe(point.id);
    expect(storage.metricPoints).toHaveLength(1);
  });

  it('persists an immutable execution intent and resumes pending log verification', async () => {
    const storage = new MemoryExperimentStorage();
    const service = new ExperimentWorkspaceService({
      storage,
      workspace: workspace(),
      now: () => NOW,
    });
    const created = await service.createRun({
      projectId: PROJECT_ID,
      ideaId: null,
      title: 'Recoverable exploratory run',
      mode: 'exploratory',
      serverLabel: 'GPU lab',
      trialId: 'recoverable-exploratory-1',
    });
    const workspaceGrantId = randomUUID();
    const executionOrigin = {
      grantVersion: 3,
      connectionId: randomUUID(),
      connectionVersion: 4,
      canonicalRoot: '/workspace/recoverable',
      canonicalRootHash: 'd'.repeat(64),
      policyVersion: 1,
      executionPolicyHash: 'e'.repeat(64),
    } as const;
    await service.bindRunExecution({
      projectId: PROJECT_ID,
      runId: created.id,
      workspaceGrantId,
    });
    const staged = await service.stageRunExecutionIntent({
      projectId: PROJECT_ID,
      runId: created.id,
      workspaceGrantId,
      ...executionOrigin,
      intentHash: 'b'.repeat(64),
      workspaceSubdirectory: 'experiments/recoverable',
      relativePath: 'logs/run.jsonl',
    });
    const repeated = await service.stageRunExecutionIntent({
      projectId: PROJECT_ID,
      runId: created.id,
      workspaceGrantId,
      ...executionOrigin,
      intentHash: 'b'.repeat(64),
      workspaceSubdirectory: 'experiments/recoverable',
      relativePath: 'logs/run.jsonl',
    });
    expect(repeated).toEqual(staged);
    await expect(
      service.stageRunExecutionIntent({
        projectId: PROJECT_ID,
        runId: created.id,
        workspaceGrantId,
        ...executionOrigin,
        intentHash: 'c'.repeat(64),
        workspaceSubdirectory: 'experiments/recoverable',
        relativePath: 'logs/changed.jsonl',
      }),
    ).rejects.toMatchObject({ code: 'experiment_run_conflict' });

    const running = await service.updateRun({
      projectId: PROJECT_ID,
      runId: created.id,
      expectedVersion: created.version,
      status: 'running',
    });
    const referenceId = randomUUID();
    const verifying = await service.updateRun({
      projectId: PROJECT_ID,
      runId: running.id,
      expectedVersion: running.version,
      status: 'verifying',
      processExitCode: 0,
      processDurationMs: 1_234,
      logReference: {
        referenceId,
        displayName: 'Recoverable exploratory run JSONL log',
        contentHash: 'd'.repeat(64),
        sizeBytes: 512,
        validationState: 'pending',
        missingFields: [],
      },
    });
    await expect(
      service.updateRun({
        projectId: PROJECT_ID,
        runId: verifying.id,
        expectedVersion: verifying.version,
        processExitCode: 1,
      }),
    ).rejects.toMatchObject({ code: 'experiment_run_transition_invalid' });
    const succeeded = await service.updateRun({
      projectId: PROJECT_ID,
      runId: verifying.id,
      expectedVersion: verifying.version,
      status: 'succeeded',
      logReference: {
        ...verifying.logReference!,
        validationState: 'valid',
      },
    });
    expect(succeeded).toMatchObject({
      status: 'succeeded',
      processExitCode: 0,
      processDurationMs: 1_234,
    });
  });

  it('rejects archived projects before reading or mutating experiment data', async () => {
    const storage = new MemoryExperimentStorage();
    const archived = workspaceSnapshot({
      projects: [
        {
          ...workspaceSnapshot().projects[0]!,
          archivedAt: NOW.toISOString(),
        },
      ],
    });
    const service = new ExperimentWorkspaceService({ storage, workspace: workspace(archived) });

    await expect(service.list({ projectId: PROJECT_ID })).rejects.toMatchObject({
      code: 'experiment_project_unavailable',
    });
  });
});
