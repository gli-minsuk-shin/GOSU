import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  CreateExperimentIdeaInputSchema,
  CreateExperimentRunInputSchema,
  EXPERIMENT_MAX_IDEAS_PER_PROJECT,
  EXPERIMENT_MAX_LOGGING_TEMPLATE_REVISIONS_PER_PROJECT,
  EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT,
  EXPERIMENT_MAX_RUNS_PER_PROJECT,
  EXPERIMENT_LOGGING_SYSTEM_FIELDS,
  ExperimentIdeaSchema,
  ExperimentLoggingTemplateSchema,
  ExperimentMetricPointSchema,
  ExperimentRunSchema,
  ExperimentWorkspaceEventSchema,
  ExperimentWorkspaceSnapshotSchema,
  ListExperimentWorkspaceInputSchema,
  RecordExperimentMetricInputSchema,
  ReviseExperimentLoggingTemplateInputSchema,
  UpdateExperimentRunInputSchema,
  UpdateExperimentIdeaInputSchema,
  type CreateExperimentIdeaInput,
  type CreateExperimentRunInput,
  type ExperimentIdea,
  type ExperimentIpcErrorCode,
  type ExperimentLoggingCustomField,
  type ExperimentLoggingTemplate,
  type ExperimentMetricPoint,
  type ExperimentRun,
  type ExperimentRunStatus,
  type ExperimentWorkspaceEvent,
  type ExperimentWorkspaceSnapshot,
  type RecordExperimentMetricInput,
  type ReviseExperimentLoggingTemplateInput,
  type UpdateExperimentRunInput,
  type UpdateExperimentIdeaInput,
} from '../shared/experiment-workspace-contracts';
import {
  RemoteWorkspaceFilePathSchema,
  RemoteWorkspaceRootSchema,
  RemoteWorkspaceSubdirectorySchema,
} from '../shared/ssh-workspace-contracts';
import type { WorkspaceObjective } from '../shared/workspace-contracts';
import { ExperimentWorkspaceStorageError } from './experiment-workspace-storage-error';
import type { WorkspaceService } from './workspace-service';

type MaybePromise<T> = T | Promise<T>;
type ExperimentMetricPointDraft = Omit<ExperimentMetricPoint, 'sequence'>;

export const ExperimentRunLogSourceSchema = z
  .object({
    referenceId: z.string().uuid(),
    projectId: z.string().uuid(),
    runId: z.string().uuid(),
    workspaceGrantId: z.string().uuid(),
    workspaceSubdirectory: RemoteWorkspaceSubdirectorySchema.nullable(),
    relativePath: RemoteWorkspaceFilePathSchema,
  })
  .strict();

export type ExperimentRunLogSource = z.infer<typeof ExperimentRunLogSourceSchema>;

export const ExperimentRunExecutionBindingSchema = z
  .object({
    projectId: z.string().uuid(),
    runId: z.string().uuid(),
    workspaceGrantId: z.string().uuid(),
  })
  .strict();

export type ExperimentRunExecutionBinding = z.infer<typeof ExperimentRunExecutionBindingSchema>;

export const ExperimentRunExecutionIntentSchema = z
  .object({
    projectId: z.string().uuid(),
    runId: z.string().uuid(),
    workspaceGrantId: z.string().uuid(),
    grantVersion: z.number().int().positive(),
    connectionId: z.string().uuid(),
    connectionVersion: z.number().int().positive(),
    canonicalRoot: RemoteWorkspaceRootSchema,
    canonicalRootHash: z.string().regex(/^[0-9a-f]{64}$/),
    policyVersion: z.number().int().positive(),
    executionPolicyHash: z.string().regex(/^[0-9a-f]{64}$/),
    intentHash: z.string().regex(/^[0-9a-f]{64}$/),
    workspaceSubdirectory: RemoteWorkspaceSubdirectorySchema.nullable(),
    relativePath: RemoteWorkspaceFilePathSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ExperimentRunExecutionIntent = z.infer<typeof ExperimentRunExecutionIntentSchema>;

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
  getLatestExperimentLoggingTemplate(
    projectId: string,
  ): MaybePromise<ExperimentLoggingTemplate | null>;
  appendExperimentLoggingTemplate(
    template: ExperimentLoggingTemplate,
    expectedVersion: number,
  ): MaybePromise<ExperimentLoggingTemplate | null>;
  listExperimentRuns(projectId: string): MaybePromise<readonly ExperimentRun[]>;
  getExperimentRun(projectId: string, runId: string): MaybePromise<ExperimentRun | null>;
  getExperimentRunByTrial(projectId: string, trialId: string): MaybePromise<ExperimentRun | null>;
  createExperimentRun(run: ExperimentRun): MaybePromise<boolean>;
  updateExperimentRun(
    run: ExperimentRun,
    expectedVersion: number,
  ): MaybePromise<ExperimentRun | null>;
  linkExperimentRunLogSource(source: ExperimentRunLogSource): MaybePromise<boolean>;
  getExperimentRunLogSource(
    projectId: string,
    runId: string,
    referenceId: string,
  ): MaybePromise<ExperimentRunLogSource | null>;
  bindExperimentRunExecution(binding: ExperimentRunExecutionBinding): MaybePromise<boolean>;
  getExperimentRunExecutionBinding(
    projectId: string,
    runId: string,
  ): MaybePromise<ExperimentRunExecutionBinding | null>;
  stageExperimentRunExecutionIntent(intent: ExperimentRunExecutionIntent): MaybePromise<boolean>;
  getExperimentRunExecutionIntent(
    projectId: string,
    runId: string,
  ): MaybePromise<ExperimentRunExecutionIntent | null>;
  findExperimentMetricPointByTrial(
    projectId: string,
    trialId: string,
  ): MaybePromise<ExperimentMetricPoint | null>;
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

const TERMINAL_RUN_STATUSES = new Set<ExperimentRunStatus>([
  'succeeded',
  'failed',
  'cancelled',
  'lost',
]);

const RUN_TRANSITIONS: Readonly<Record<ExperimentRunStatus, readonly ExperimentRunStatus[]>> = {
  queued: ['running', 'cancelled', 'lost'],
  running: ['verifying', 'failed', 'cancelled', 'lost'],
  verifying: ['succeeded', 'failed', 'cancelled', 'lost'],
  succeeded: [],
  failed: [],
  cancelled: [],
  lost: [],
};

const DEFAULT_LOGGING_FIELDS: readonly ExperimentLoggingCustomField[] = [
  {
    key: 'step',
    label: 'Step',
    type: 'string',
    category: 'progress',
    requiredAt: ['progress'],
    unit: null,
  },
  {
    key: 'elapsed_seconds',
    label: 'Elapsed time',
    type: 'number',
    category: 'progress',
    requiredAt: ['progress', 'run-end'],
    unit: 's',
  },
];

function mapStorageError(error: unknown): ExperimentWorkspaceServiceError | null {
  if (!(error instanceof ExperimentWorkspaceStorageError)) return null;
  const code = {
    idea_limit_reached: 'experiment_idea_limit_reached',
    metric_limit_reached: 'experiment_metric_limit_reached',
    parent_not_found: 'experiment_parent_not_found',
    idea_not_found: 'experiment_idea_not_found',
    logging_template_conflict: 'experiment_logging_template_conflict',
    logging_template_limit_reached: 'experiment_logging_template_limit_reached',
    run_not_found: 'experiment_run_not_found',
    run_conflict: 'experiment_run_conflict',
    run_limit_reached: 'experiment_run_limit_reached',
    run_log_source_conflict: 'experiment_run_log_source_invalid',
    run_execution_binding_conflict: 'experiment_run_conflict',
    run_execution_intent_conflict: 'experiment_run_conflict',
  } as const;
  return new ExperimentWorkspaceServiceError(code[error.code]);
}

function deterministicRevisionId(projectId: string, version: number) {
  const bytes = createHash('sha256')
    .update(`gosu:experiment-logging-template:${projectId}:${version}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hexadecimal = bytes.toString('hex');
  return `${hexadecimal.slice(0, 8)}-${hexadecimal.slice(8, 12)}-${hexadecimal.slice(12, 16)}-${hexadecimal.slice(16, 20)}-${hexadecimal.slice(20)}`;
}

const requiredAtOrder = new Map([
  ['run-start', 0],
  ['progress', 1],
  ['run-end', 2],
  ['summary', 3],
]);

function canonicalLoggingFields(fields: readonly ExperimentLoggingCustomField[]) {
  return fields.map((field) => ({
    ...field,
    requiredAt: [...field.requiredAt].sort(
      (left, right) => requiredAtOrder.get(left)! - requiredAtOrder.get(right)!,
    ),
  }));
}

function loggingTemplateHash(fields: readonly ExperimentLoggingCustomField[]) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 1,
        systemFields: EXPERIMENT_LOGGING_SYSTEM_FIELDS,
        customFields: fields,
      }),
      'utf8',
    )
    .digest('hex');
}

function loggingTemplateSnapshot(template: ExperimentLoggingTemplate) {
  return {
    revisionId: template.id,
    version: template.version,
    systemFields: template.systemFields,
    customFields: template.customFields,
    templateHash: template.templateHash,
  } as const;
}

function canTransitionRun(current: ExperimentRunStatus, next: ExperimentRunStatus) {
  return current === next || RUN_TRANSITIONS[current].includes(next);
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
    const loggingTemplate = await this.ensureLoggingTemplate(command.projectId);
    const [ideas, metricPoints, runs] = await Promise.all([
      this.storage.listExperimentIdeas(command.projectId),
      this.storage.listExperimentMetricPoints(command.projectId),
      this.storage.listExperimentRuns(command.projectId),
    ]);
    if (ideas.length > EXPERIMENT_MAX_IDEAS_PER_PROJECT) {
      throw new ExperimentWorkspaceServiceError('experiment_idea_limit_reached');
    }
    if (metricPoints.length > EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT) {
      throw new ExperimentWorkspaceServiceError('experiment_metric_limit_reached');
    }
    if (runs.length > EXPERIMENT_MAX_RUNS_PER_PROJECT) {
      throw new ExperimentWorkspaceServiceError('experiment_run_limit_reached');
    }
    return ExperimentWorkspaceSnapshotSchema.parse({
      schemaVersion: 1,
      projectId: command.projectId,
      loggingTemplate,
      ideas,
      metricPoints,
      runs,
    });
  }

  async reviseLoggingTemplate(
    input: ReviseExperimentLoggingTemplateInput,
  ): Promise<ExperimentLoggingTemplate> {
    const command = ReviseExperimentLoggingTemplateInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const current = await this.ensureLoggingTemplate(command.projectId);
    if (current.version !== command.expectedVersion) {
      throw new ExperimentWorkspaceServiceError('experiment_logging_template_conflict');
    }
    if (current.version >= EXPERIMENT_MAX_LOGGING_TEMPLATE_REVISIONS_PER_PROJECT) {
      throw new ExperimentWorkspaceServiceError('experiment_logging_template_limit_reached');
    }
    const customFields = canonicalLoggingFields(command.customFields);
    const createdAt = this.now().toISOString();
    const template = ExperimentLoggingTemplateSchema.parse({
      schemaVersion: 1,
      id: deterministicRevisionId(command.projectId, current.version + 1),
      projectId: command.projectId,
      version: current.version + 1,
      previousRevisionId: current.id,
      systemFields: EXPERIMENT_LOGGING_SYSTEM_FIELDS,
      customFields,
      templateHash: loggingTemplateHash(customFields),
      createdAt,
    });
    let stored: ExperimentLoggingTemplate | null;
    try {
      stored = await this.storage.appendExperimentLoggingTemplate(template, current.version);
    } catch (error) {
      const mapped = mapStorageError(error);
      if (mapped) throw mapped;
      throw error;
    }
    if (!stored) {
      throw new ExperimentWorkspaceServiceError('experiment_logging_template_conflict');
    }
    const parsed = ExperimentLoggingTemplateSchema.parse(stored);
    this.publish(parsed.projectId, 'logging-template', parsed.id, createdAt);
    return parsed;
  }

  async createRun(input: CreateExperimentRunInput): Promise<ExperimentRun> {
    const command = CreateExperimentRunInputSchema.parse(input);
    const { snapshot } = await this.requireActiveProject(command.projectId);
    const existing = await this.storage.getExperimentRunByTrial(command.projectId, command.trialId);
    if (existing) {
      if (
        existing.ideaId === command.ideaId &&
        existing.title === command.title &&
        existing.mode === command.mode &&
        existing.serverLabel === command.serverLabel
      ) {
        return ExperimentRunSchema.parse(existing);
      }
      throw new ExperimentWorkspaceServiceError('experiment_run_conflict');
    }
    if (command.ideaId !== null) {
      const idea = await this.storage.getExperimentIdea(command.projectId, command.ideaId);
      if (!idea) throw new ExperimentWorkspaceServiceError('experiment_idea_not_found');
    }
    const objective =
      command.mode === 'comparable'
        ? this.latestLockedObjective(snapshot.objectives, command.projectId)
        : null;
    if (command.mode === 'comparable' && !objective) {
      throw new ExperimentWorkspaceServiceError('experiment_objective_required');
    }
    const template = await this.ensureLoggingTemplate(command.projectId);
    const timestamp = this.now().toISOString();
    const run = ExperimentRunSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      projectId: command.projectId,
      ideaId: command.ideaId,
      title: command.title,
      status: 'queued',
      mode: command.mode,
      serverLabel: command.serverLabel,
      trialId: command.trialId,
      objectiveId: objective?.id ?? null,
      objectiveVersion: objective?.objectiveVersion ?? null,
      loggingTemplate: loggingTemplateSnapshot(template),
      progressCurrent: null,
      progressTotal: null,
      currentStep: null,
      latestMetric: null,
      logReference: null,
      processExitCode: null,
      processDurationMs: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
      version: 1,
    });
    try {
      if (!(await this.storage.createExperimentRun(run))) {
        const raced = await this.storage.getExperimentRunByTrial(
          command.projectId,
          command.trialId,
        );
        if (
          raced &&
          raced.ideaId === command.ideaId &&
          raced.title === command.title &&
          raced.mode === command.mode &&
          raced.serverLabel === command.serverLabel
        ) {
          return ExperimentRunSchema.parse(raced);
        }
        throw new ExperimentWorkspaceServiceError('experiment_run_conflict');
      }
    } catch (error) {
      const mapped = mapStorageError(error);
      if (mapped) throw mapped;
      throw error;
    }
    this.publish(run.projectId, 'run', run.id, timestamp);
    return run;
  }

  async updateRun(input: UpdateExperimentRunInput): Promise<ExperimentRun> {
    const command = UpdateExperimentRunInputSchema.parse(input);
    const { snapshot } = await this.requireActiveProject(command.projectId);
    const current = await this.storage.getExperimentRun(command.projectId, command.runId);
    if (!current) throw new ExperimentWorkspaceServiceError('experiment_run_not_found');
    if (current.version !== command.expectedVersion) {
      throw new ExperimentWorkspaceServiceError('experiment_run_conflict');
    }
    if (TERMINAL_RUN_STATUSES.has(current.status)) {
      throw new ExperimentWorkspaceServiceError('experiment_run_transition_invalid');
    }
    const status = command.status ?? current.status;
    if (!canTransitionRun(current.status, status)) {
      throw new ExperimentWorkspaceServiceError('experiment_run_transition_invalid');
    }
    const progressCurrent =
      command.progressCurrent === undefined ? current.progressCurrent : command.progressCurrent;
    const progressTotal =
      command.progressTotal === undefined ? current.progressTotal : command.progressTotal;
    if (
      current.progressCurrent !== null &&
      progressCurrent !== null &&
      progressCurrent < current.progressCurrent
    ) {
      throw new ExperimentWorkspaceServiceError('experiment_run_transition_invalid');
    }
    const timestamp = this.now().toISOString();
    const latestMetric =
      command.latestMetric === undefined
        ? current.latestMetric
        : command.latestMetric === null
          ? null
          : { ...command.latestMetric, recordedAt: timestamp };
    if (current.mode === 'comparable' && latestMetric !== null) {
      const objective = snapshot.objectives.find(
        (candidate) =>
          candidate.projectId === current.projectId &&
          candidate.id === current.objectiveId &&
          candidate.objectiveVersion === current.objectiveVersion,
      );
      if (!objective || latestMetric.key !== objective.primaryMetric.key) {
        throw new ExperimentWorkspaceServiceError('experiment_run_transition_invalid');
      }
    }
    const logReference =
      command.logReference === undefined ? current.logReference : command.logReference;
    const resolvesPendingLog =
      current.status === 'verifying' &&
      current.logReference?.validationState === 'pending' &&
      command.logReference !== undefined &&
      command.logReference !== null &&
      command.logReference.referenceId === current.logReference.referenceId &&
      command.logReference.displayName === current.logReference.displayName &&
      command.logReference.contentHash === current.logReference.contentHash &&
      command.logReference.sizeBytes === current.logReference.sizeBytes &&
      command.logReference.validationState !== 'pending';
    if (
      current.logReference !== null &&
      command.logReference !== undefined &&
      JSON.stringify(command.logReference) !== JSON.stringify(current.logReference) &&
      !resolvesPendingLog
    ) {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_source_invalid');
    }
    if (logReference) {
      const loggingKeys = new Set([
        ...current.loggingTemplate.systemFields,
        ...current.loggingTemplate.customFields.map(({ key }) => key),
      ]);
      if (logReference.missingFields.some((key) => !loggingKeys.has(key))) {
        throw new ExperimentWorkspaceServiceError('experiment_run_log_source_invalid');
      }
    }
    if (status === 'succeeded' && logReference?.validationState !== 'valid') {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_source_invalid');
    }
    if (status === 'succeeded' && current.mode === 'comparable' && latestMetric === null) {
      throw new ExperimentWorkspaceServiceError('experiment_run_transition_invalid');
    }
    const processExitCode =
      command.processExitCode === undefined ? current.processExitCode : command.processExitCode;
    const processDurationMs =
      command.processDurationMs === undefined
        ? current.processDurationMs
        : command.processDurationMs;
    if (
      (current.processExitCode !== null && processExitCode !== current.processExitCode) ||
      (current.processDurationMs !== null && processDurationMs !== current.processDurationMs)
    ) {
      throw new ExperimentWorkspaceServiceError('experiment_run_transition_invalid');
    }
    if (status === 'succeeded' && (processExitCode !== 0 || processDurationMs === null)) {
      throw new ExperimentWorkspaceServiceError('experiment_run_transition_invalid');
    }
    const updated = ExperimentRunSchema.parse({
      ...current,
      status,
      progressCurrent,
      progressTotal,
      currentStep: command.currentStep === undefined ? current.currentStep : command.currentStep,
      latestMetric,
      logReference,
      processExitCode,
      processDurationMs,
      startedAt:
        status === 'running' || status === 'verifying'
          ? (current.startedAt ?? timestamp)
          : current.startedAt,
      completedAt: TERMINAL_RUN_STATUSES.has(status) ? (current.completedAt ?? timestamp) : null,
      updatedAt: timestamp,
      version: current.version + 1,
    });
    let stored: ExperimentRun | null;
    try {
      stored = await this.storage.updateExperimentRun(updated, command.expectedVersion);
    } catch (error) {
      const mapped = mapStorageError(error);
      if (mapped) throw mapped;
      throw error;
    }
    if (!stored) throw new ExperimentWorkspaceServiceError('experiment_run_conflict');
    const parsed = ExperimentRunSchema.parse(stored);
    this.publish(parsed.projectId, 'run', parsed.id, timestamp);
    return parsed;
  }

  async linkRunLogSource(input: ExperimentRunLogSource): Promise<ExperimentRunLogSource> {
    const source = ExperimentRunLogSourceSchema.parse(input);
    await this.requireActiveProject(source.projectId);
    const run = await this.storage.getExperimentRun(source.projectId, source.runId);
    if (!run || run.logReference?.referenceId !== source.referenceId) {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_source_invalid');
    }
    const execution = await this.storage.getExperimentRunExecutionBinding(
      source.projectId,
      source.runId,
    );
    if (!execution || execution.workspaceGrantId !== source.workspaceGrantId) {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_source_invalid');
    }
    try {
      if (!(await this.storage.linkExperimentRunLogSource(source))) {
        throw new ExperimentWorkspaceServiceError('experiment_run_log_source_invalid');
      }
    } catch (error) {
      const mapped = mapStorageError(error);
      if (mapped) throw mapped;
      throw error;
    }
    return source;
  }

  async getRunLogSource(input: {
    projectId: string;
    runId: string;
    referenceId: string;
  }): Promise<ExperimentRunLogSource | null> {
    const command = z
      .object({
        projectId: z.string().uuid(),
        runId: z.string().uuid(),
        referenceId: z.string().uuid(),
      })
      .strict()
      .parse(input);
    await this.requireActiveProject(command.projectId);
    const run = await this.storage.getExperimentRun(command.projectId, command.runId);
    if (!run) throw new ExperimentWorkspaceServiceError('experiment_run_not_found');
    if (run.logReference?.referenceId !== command.referenceId) {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_source_invalid');
    }
    const source = await this.storage.getExperimentRunLogSource(
      command.projectId,
      command.runId,
      command.referenceId,
    );
    return source ? ExperimentRunLogSourceSchema.parse(source) : null;
  }

  async bindRunExecution(
    input: ExperimentRunExecutionBinding,
  ): Promise<ExperimentRunExecutionBinding> {
    const binding = ExperimentRunExecutionBindingSchema.parse(input);
    await this.requireActiveProject(binding.projectId);
    if (!(await this.storage.getExperimentRun(binding.projectId, binding.runId))) {
      throw new ExperimentWorkspaceServiceError('experiment_run_not_found');
    }
    try {
      if (!(await this.storage.bindExperimentRunExecution(binding))) {
        throw new ExperimentWorkspaceServiceError('experiment_run_conflict');
      }
    } catch (error) {
      const mapped = mapStorageError(error);
      if (mapped) throw mapped;
      throw error;
    }
    return binding;
  }

  async getRunExecutionBinding(input: {
    projectId: string;
    runId: string;
  }): Promise<ExperimentRunExecutionBinding | null> {
    const command = z
      .object({ projectId: z.string().uuid(), runId: z.string().uuid() })
      .strict()
      .parse(input);
    await this.requireActiveProject(command.projectId);
    if (!(await this.storage.getExperimentRun(command.projectId, command.runId))) {
      throw new ExperimentWorkspaceServiceError('experiment_run_not_found');
    }
    const binding = await this.storage.getExperimentRunExecutionBinding(
      command.projectId,
      command.runId,
    );
    return binding ? ExperimentRunExecutionBindingSchema.parse(binding) : null;
  }

  async stageRunExecutionIntent(
    input: Omit<ExperimentRunExecutionIntent, 'createdAt'>,
  ): Promise<ExperimentRunExecutionIntent> {
    const command = ExperimentRunExecutionIntentSchema.omit({ createdAt: true }).parse(input);
    await this.requireActiveProject(command.projectId);
    const run = await this.storage.getExperimentRun(command.projectId, command.runId);
    if (!run) throw new ExperimentWorkspaceServiceError('experiment_run_not_found');
    const binding = await this.storage.getExperimentRunExecutionBinding(
      command.projectId,
      command.runId,
    );
    if (!binding || binding.workspaceGrantId !== command.workspaceGrantId) {
      throw new ExperimentWorkspaceServiceError('experiment_run_conflict');
    }
    const intent = ExperimentRunExecutionIntentSchema.parse({
      ...command,
      createdAt: this.now().toISOString(),
    });
    try {
      if (!(await this.storage.stageExperimentRunExecutionIntent(intent))) {
        throw new ExperimentWorkspaceServiceError('experiment_run_conflict');
      }
    } catch (error) {
      const mapped = mapStorageError(error);
      if (mapped) throw mapped;
      throw error;
    }
    const stored = await this.storage.getExperimentRunExecutionIntent(
      command.projectId,
      command.runId,
    );
    if (!stored) throw new ExperimentWorkspaceServiceError('experiment_run_conflict');
    return ExperimentRunExecutionIntentSchema.parse(stored);
  }

  async getRunExecutionIntent(input: {
    projectId: string;
    runId: string;
  }): Promise<ExperimentRunExecutionIntent | null> {
    const command = z
      .object({ projectId: z.string().uuid(), runId: z.string().uuid() })
      .strict()
      .parse(input);
    await this.requireActiveProject(command.projectId);
    if (!(await this.storage.getExperimentRun(command.projectId, command.runId))) {
      throw new ExperimentWorkspaceServiceError('experiment_run_not_found');
    }
    const intent = await this.storage.getExperimentRunExecutionIntent(
      command.projectId,
      command.runId,
    );
    return intent ? ExperimentRunExecutionIntentSchema.parse(intent) : null;
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

  /** Main-only ingestion path for a validated comparable run summary. */
  async recordRunSummaryMetric(input: {
    projectId: string;
    runId: string;
    value: number;
  }): Promise<ExperimentMetricPoint> {
    const command = z
      .object({
        projectId: z.string().uuid(),
        runId: z.string().uuid(),
        value: z.number().finite(),
      })
      .strict()
      .parse(input);
    const { snapshot } = await this.requireActiveProject(command.projectId);
    const run = await this.storage.getExperimentRun(command.projectId, command.runId);
    if (!run) throw new ExperimentWorkspaceServiceError('experiment_run_not_found');
    if (
      run.mode !== 'comparable' ||
      run.status !== 'succeeded' ||
      run.ideaId === null ||
      run.objectiveId === null ||
      run.objectiveVersion === null
    ) {
      throw new ExperimentWorkspaceServiceError('experiment_run_transition_invalid');
    }
    if (run.logReference?.validationState !== 'valid') {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_source_invalid');
    }
    const [binding, logSource] = await Promise.all([
      this.storage.getExperimentRunExecutionBinding(command.projectId, run.id),
      this.storage.getExperimentRunLogSource(
        command.projectId,
        run.id,
        run.logReference.referenceId,
      ),
    ]);
    if (!binding || !logSource || binding.workspaceGrantId !== logSource.workspaceGrantId) {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_source_invalid');
    }
    if (
      run.loggingTemplate.templateHash !== loggingTemplateHash(run.loggingTemplate.customFields)
    ) {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_source_invalid');
    }
    const objective = snapshot.objectives.find(
      (candidate) =>
        candidate.projectId === command.projectId &&
        candidate.id === run.objectiveId &&
        candidate.objectiveVersion === run.objectiveVersion &&
        candidate.locked,
    );
    if (!objective) throw new ExperimentWorkspaceServiceError('experiment_objective_required');
    if (
      run.latestMetric === null ||
      run.latestMetric.key !== objective.primaryMetric.key ||
      !Object.is(run.latestMetric.value, command.value)
    ) {
      throw new ExperimentWorkspaceServiceError('experiment_run_transition_invalid');
    }
    const existing = await this.storage.findExperimentMetricPointByTrial(
      command.projectId,
      run.trialId,
    );
    if (existing) {
      if (
        existing.ideaId === run.ideaId &&
        existing.objectiveId === objective.id &&
        existing.objectiveVersion === objective.objectiveVersion &&
        existing.metricKey === objective.primaryMetric.key &&
        Object.is(existing.value, command.value) &&
        existing.source === 'runner-summary'
      ) {
        return ExperimentMetricPointSchema.parse(existing);
      }
      throw new ExperimentWorkspaceServiceError('experiment_run_conflict');
    }
    const recordedAt = this.now().toISOString();
    const point = ExperimentMetricPointSchema.omit({ sequence: true }).parse({
      schemaVersion: 1,
      id: randomUUID(),
      projectId: command.projectId,
      ideaId: run.ideaId,
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
      source: 'runner-summary',
      trialId: run.trialId,
      recordedAt,
    });
    let stored: ExperimentMetricPoint;
    try {
      stored = await this.storage.appendExperimentMetricPoint(point);
    } catch (error) {
      const raced = await this.storage.findExperimentMetricPointByTrial(
        command.projectId,
        run.trialId,
      );
      if (
        raced &&
        raced.ideaId === run.ideaId &&
        raced.objectiveId === objective.id &&
        raced.objectiveVersion === objective.objectiveVersion &&
        raced.metricKey === objective.primaryMetric.key &&
        Object.is(raced.value, command.value) &&
        raced.source === 'runner-summary'
      ) {
        return ExperimentMetricPointSchema.parse(raced);
      }
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

  private latestLockedObjective(
    objectives: readonly WorkspaceObjective[],
    projectId: string,
  ): WorkspaceObjective | null {
    return (
      objectives
        .filter((candidate) => candidate.projectId === projectId && candidate.locked)
        .sort((left, right) => right.objectiveVersion - left.objectiveVersion)[0] ?? null
    );
  }

  private async ensureLoggingTemplate(projectId: string): Promise<ExperimentLoggingTemplate> {
    const existing = await this.storage.getLatestExperimentLoggingTemplate(projectId);
    if (existing) return ExperimentLoggingTemplateSchema.parse(existing);
    const customFields = canonicalLoggingFields(DEFAULT_LOGGING_FIELDS);
    const createdAt = this.now().toISOString();
    const initial = ExperimentLoggingTemplateSchema.parse({
      schemaVersion: 1,
      id: deterministicRevisionId(projectId, 1),
      projectId,
      version: 1,
      previousRevisionId: null,
      systemFields: EXPERIMENT_LOGGING_SYSTEM_FIELDS,
      customFields,
      templateHash: loggingTemplateHash(customFields),
      createdAt,
    });
    let stored: ExperimentLoggingTemplate | null;
    try {
      stored = await this.storage.appendExperimentLoggingTemplate(initial, 0);
    } catch (error) {
      const raced = await this.storage.getLatestExperimentLoggingTemplate(projectId);
      if (raced) return ExperimentLoggingTemplateSchema.parse(raced);
      const mapped = mapStorageError(error);
      if (mapped) throw mapped;
      throw error;
    }
    if (stored) return ExperimentLoggingTemplateSchema.parse(stored);
    const raced = await this.storage.getLatestExperimentLoggingTemplate(projectId);
    if (raced) return ExperimentLoggingTemplateSchema.parse(raced);
    throw new ExperimentWorkspaceServiceError('experiment_logging_template_conflict');
  }

  private async requireLockedObjective(projectId: string): Promise<WorkspaceObjective> {
    const { snapshot } = await this.requireActiveProject(projectId);
    const objective = this.latestLockedObjective(snapshot.objectives, projectId);
    if (!objective) {
      throw new ExperimentWorkspaceServiceError('experiment_objective_required');
    }
    return objective;
  }
}
