import { randomUUID } from 'node:crypto';

import {
  CreateExperimentIdeaInputSchema,
  EXPERIMENT_MAX_IDEAS_PER_PROJECT,
  EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT,
  ExperimentIdeaSchema,
  ExperimentMetricPointSchema,
  ExperimentWorkspaceEventSchema,
  ExperimentWorkspaceSnapshotSchema,
  ListExperimentWorkspaceInputSchema,
  RecordExperimentMetricInputSchema,
  UpdateExperimentIdeaInputSchema,
  type CreateExperimentIdeaInput,
  type ExperimentIdea,
  type ExperimentIpcErrorCode,
  type ExperimentMetricPoint,
  type ExperimentWorkspaceEvent,
  type ExperimentWorkspaceSnapshot,
  type RecordExperimentMetricInput,
  type UpdateExperimentIdeaInput,
} from '../shared/experiment-workspace-contracts';
import type { WorkspaceObjective } from '../shared/workspace-contracts';
import { ExperimentWorkspaceStorageError } from './experiment-workspace-storage-error';
import type { WorkspaceService } from './workspace-service';

type MaybePromise<T> = T | Promise<T>;
type ExperimentMetricPointDraft = Omit<ExperimentMetricPoint, 'sequence'>;

export interface ExperimentWorkspaceStorage {
  listExperimentIdeas(projectId: string): MaybePromise<readonly ExperimentIdea[]>;
  listExperimentMetricPoints(projectId: string): MaybePromise<readonly ExperimentMetricPoint[]>;
  getExperimentIdea(projectId: string, ideaId: string): MaybePromise<ExperimentIdea | null>;
  createExperimentIdea(idea: ExperimentIdea): MaybePromise<boolean>;
  updateExperimentIdea(
    idea: ExperimentIdea,
    expectedVersion: number,
  ): MaybePromise<ExperimentIdea | null>;
  appendExperimentMetricPoint(
    point: ExperimentMetricPointDraft,
  ): MaybePromise<ExperimentMetricPoint>;
}

export class ExperimentWorkspaceServiceError extends Error {
  constructor(readonly code: Exclude<ExperimentIpcErrorCode, 'invalid_experiment_input'>) {
    super(code);
    this.name = 'ExperimentWorkspaceServiceError';
  }
}

type ExperimentWorkspaceServiceOptions = Readonly<{
  storage: ExperimentWorkspaceStorage;
  workspace: WorkspaceService;
  now?: () => Date;
}>;

const TERMINAL_OUTCOMES = new Set<ExperimentIdea['outcome']>([
  'success',
  'partial',
  'failed',
  'inconclusive',
]);

function mapStorageError(error: unknown): ExperimentWorkspaceServiceError | null {
  if (!(error instanceof ExperimentWorkspaceStorageError)) return null;
  const code = {
    idea_limit_reached: 'experiment_idea_limit_reached',
    metric_limit_reached: 'experiment_metric_limit_reached',
    parent_not_found: 'experiment_parent_not_found',
    idea_not_found: 'experiment_idea_not_found',
  } as const;
  return new ExperimentWorkspaceServiceError(code[error.code]);
}

export class ExperimentWorkspaceService {
  private readonly storage: ExperimentWorkspaceStorage;
  private readonly workspace: WorkspaceService;
  private readonly now: () => Date;
  private readonly listeners = new Set<(event: ExperimentWorkspaceEvent) => void>();

  constructor(options: ExperimentWorkspaceServiceOptions) {
    this.storage = options.storage;
    this.workspace = options.workspace;
    this.now = options.now ?? (() => new Date());
  }

  onEvent(listener: (event: ExperimentWorkspaceEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async list(input: { projectId: string }): Promise<ExperimentWorkspaceSnapshot> {
    const command = ListExperimentWorkspaceInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const [ideas, metricPoints] = await Promise.all([
      this.storage.listExperimentIdeas(command.projectId),
      this.storage.listExperimentMetricPoints(command.projectId),
    ]);
    if (ideas.length > EXPERIMENT_MAX_IDEAS_PER_PROJECT) {
      throw new ExperimentWorkspaceServiceError('experiment_idea_limit_reached');
    }
    if (metricPoints.length > EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT) {
      throw new ExperimentWorkspaceServiceError('experiment_metric_limit_reached');
    }
    return ExperimentWorkspaceSnapshotSchema.parse({
      schemaVersion: 1,
      projectId: command.projectId,
      ideas,
      metricPoints,
    });
  }

  async createIdea(input: CreateExperimentIdeaInput): Promise<ExperimentIdea> {
    const command = CreateExperimentIdeaInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const parentIdeaId = command.parentIdeaId ?? null;
    if (parentIdeaId) {
      const parent = await this.storage.getExperimentIdea(command.projectId, parentIdeaId);
      if (!parent) throw new ExperimentWorkspaceServiceError('experiment_parent_not_found');
    }
    const now = this.now().toISOString();
    const idea = ExperimentIdeaSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      projectId: command.projectId,
      parentIdeaId,
      title: command.title,
      hypothesis: command.hypothesis,
      phase: command.phase,
      outcome: 'planned',
      resultSummary: '',
      version: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
    try {
      if (!(await this.storage.createExperimentIdea(idea))) {
        throw new ExperimentWorkspaceServiceError('experiment_unavailable');
      }
    } catch (error) {
      const mapped = mapStorageError(error);
      if (mapped) throw mapped;
      throw error;
    }
    this.publish(idea.projectId, 'idea', idea.id, now);
    return idea;
  }

  async updateIdea(input: UpdateExperimentIdeaInput): Promise<ExperimentIdea> {
    const command = UpdateExperimentIdeaInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const current = await this.storage.getExperimentIdea(command.projectId, command.ideaId);
    if (!current) throw new ExperimentWorkspaceServiceError('experiment_idea_not_found');
    if (current.version !== command.expectedVersion) {
      throw new ExperimentWorkspaceServiceError('experiment_idea_conflict');
    }
    const now = this.now().toISOString();
    const updated = ExperimentIdeaSchema.parse({
      ...current,
      title: command.title,
      hypothesis: command.hypothesis,
      phase: command.phase,
      outcome: command.outcome,
      resultSummary: command.resultSummary,
      version: current.version + 1,
      updatedAt: now,
      completedAt: TERMINAL_OUTCOMES.has(command.outcome) ? (current.completedAt ?? now) : null,
    });
    const stored = await this.storage.updateExperimentIdea(updated, command.expectedVersion);
    if (!stored) throw new ExperimentWorkspaceServiceError('experiment_idea_conflict');
    this.publish(updated.projectId, 'idea', updated.id, now);
    return ExperimentIdeaSchema.parse(stored);
  }

  async recordMetric(input: RecordExperimentMetricInput): Promise<ExperimentMetricPoint> {
    const command = RecordExperimentMetricInputSchema.parse(input);
    const objective = await this.requireLockedObjective(command.projectId);
    const idea = await this.storage.getExperimentIdea(command.projectId, command.ideaId);
    if (!idea) throw new ExperimentWorkspaceServiceError('experiment_idea_not_found');
    const recordedAt = this.now().toISOString();
    const point = ExperimentMetricPointSchema.omit({ sequence: true }).parse({
      schemaVersion: 1,
      id: randomUUID(),
      projectId: command.projectId,
      ideaId: idea.id,
      objectiveId: objective.id,
      objectiveVersion: objective.objectiveVersion,
      metricKey: objective.primaryMetric.key,
      metricDisplayName: objective.primaryMetric.displayName,
      direction: objective.primaryMetric.direction,
      unit: objective.primaryMetric.unit,
      aggregation: objective.primaryMetric.aggregation,
      evaluatorHash: objective.primaryMetric.evaluatorHash,
      datasetHash: objective.primaryMetric.datasetHash,
      holdoutHash: objective.primaryMetric.holdoutHash,
      baseline: objective.primaryMetric.baseline,
      target: objective.primaryMetric.target,
      value: command.value,
      source: 'manual',
      trialId: command.trialId ?? null,
      recordedAt,
    });
    let stored: ExperimentMetricPoint;
    try {
      stored = await this.storage.appendExperimentMetricPoint(point);
    } catch (error) {
      const mapped = mapStorageError(error);
      if (mapped) throw mapped;
      throw error;
    }
    this.publish(stored.projectId, 'metric-point', stored.id, recordedAt);
    return ExperimentMetricPointSchema.parse(stored);
  }

  private publish(
    projectId: string,
    entityType: ExperimentWorkspaceEvent['entityType'],
    entityId: string,
    occurredAt: string,
  ) {
    const event = ExperimentWorkspaceEventSchema.parse({
      schemaVersion: 1,
      type: 'experiment.workspace.changed',
      projectId,
      entityType,
      entityId,
      occurredAt,
    });
    for (const listener of this.listeners) listener(event);
  }

  private async requireActiveProject(projectId: string) {
    const snapshot = await this.workspace.snapshot();
    const project = snapshot.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new ExperimentWorkspaceServiceError('experiment_project_not_found');
    if (project.archivedAt || project.trashedAt) {
      throw new ExperimentWorkspaceServiceError('experiment_project_unavailable');
    }
    return { project, snapshot };
  }

  private async requireLockedObjective(projectId: string): Promise<WorkspaceObjective> {
    const { snapshot } = await this.requireActiveProject(projectId);
    const objective = snapshot.objectives
      .filter((candidate) => candidate.projectId === projectId)
      .sort((left, right) => right.objectiveVersion - left.objectiveVersion)[0];
    if (!objective?.locked) {
      throw new ExperimentWorkspaceServiceError('experiment_objective_required');
    }
    return objective;
  }
}
