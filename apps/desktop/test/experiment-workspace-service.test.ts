import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  ExperimentWorkspaceService,
  type ExperimentWorkspaceStorage,
} from '../src/main/experiment-workspace-service';
import type {
  ExperimentIdea,
  ExperimentMetricPoint,
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
