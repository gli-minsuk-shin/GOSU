import {
  ExperimentBudgetSchema,
  MetricGuardrailSchema,
  PrimaryMetricSchema,
  StopPolicySchema,
  type ExperimentBudget,
  type MetricGuardrail,
  type PrimaryMetric,
  type StopPolicy,
} from '@gosu/contracts';
import { z } from 'zod';

export const WORKSPACE_TASK_STATUSES = [
  'backlog',
  'planned',
  'in_progress',
  'review',
  'done',
] as const;

export type WorkspaceTaskStatus = (typeof WORKSPACE_TASK_STATUSES)[number];

export type ProjectRecord = Readonly<{
  id: string;
  name: string;
  slug: string;
  repository?: string | undefined;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type WorkspaceTask = Readonly<{
  id: string;
  projectId: string;
  title: string;
  status: WorkspaceTaskStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type WorkspaceMetric = PrimaryMetric;
export type WorkspaceGuardrail = MetricGuardrail;
export type WorkspaceBudget = ExperimentBudget;
export type WorkspaceStopPolicy = StopPolicy;

export type WorkspaceObjective = Readonly<{
  id: string;
  projectId: string;
  objectiveVersion: number;
  entityVersion: number;
  locked: boolean;
  goal: string;
  primaryMetric: WorkspaceMetric;
  guardrails: readonly WorkspaceGuardrail[];
  budget: WorkspaceBudget;
  stopPolicy: WorkspaceStopPolicy;
  createdAt: string;
  updatedAt: string;
}>;

export type WorkspaceSnapshot = Readonly<{
  schemaVersion: 1;
  revision: number;
  projects: readonly ProjectRecord[];
  tasks: readonly WorkspaceTask[];
  objectives: readonly WorkspaceObjective[];
}>;

export type WorkspaceOperation = Readonly<{
  schemaVersion: 1;
  workspaceRevision: number;
  id: string;
  idempotencyKey: string;
  scope: string;
  projectId?: string | undefined;
  entityType: 'project' | 'task' | 'objective';
  entityId: string;
  commandType:
    | 'project.create'
    | 'task.create'
    | 'task.update'
    | 'objective.save'
    | 'objective.lock'
    | 'objective.start-version';
  baseVersion: number | null;
  createdAt: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export type WorkspacePendingSummary = Readonly<{
  count: number;
  latestWorkspaceRevision: number | null;
}>;

const timestampSchema = z.string().datetime({ offset: true });
const uuidSchema = z.string().uuid();
const taskStatusSchema = z.enum(WORKSPACE_TASK_STATUSES);

const projectSchema: z.ZodType<ProjectRecord> = z
  .object({
    id: uuidSchema,
    name: z.string().trim().min(2).max(120),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    repository: z.string().trim().min(1).max(500).optional(),
    version: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const taskSchema: z.ZodType<WorkspaceTask> = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    title: z.string().trim().min(2).max(240),
    status: taskStatusSchema,
    version: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const objectiveSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    objectiveVersion: z.number().int().positive(),
    entityVersion: z.number().int().positive(),
    locked: z.boolean(),
    goal: z.string().trim().min(10).max(4_000),
    primaryMetric: PrimaryMetricSchema,
    guardrails: z.array(MetricGuardrailSchema),
    budget: ExperimentBudgetSchema,
    stopPolicy: StopPolicySchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const WorkspaceSnapshotSchema: z.ZodType<WorkspaceSnapshot> = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    projects: z.array(projectSchema),
    tasks: z.array(taskSchema),
    objectives: z.array(objectiveSchema),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const projectIds = new Set(snapshot.projects.map((project) => project.id));
    const slugs = new Set<string>();
    for (const [index, project] of snapshot.projects.entries()) {
      if (slugs.has(project.slug)) {
        context.addIssue({
          code: 'custom',
          message: 'Project slugs must be unique',
          path: ['projects', index, 'slug'],
        });
      }
      slugs.add(project.slug);
    }
    for (const [index, task] of snapshot.tasks.entries()) {
      if (!projectIds.has(task.projectId)) {
        context.addIssue({
          code: 'custom',
          message: 'Task references an unknown project',
          path: ['tasks', index, 'projectId'],
        });
      }
    }
    const objectiveVersions = new Set<string>();
    for (const [index, objective] of snapshot.objectives.entries()) {
      if (!projectIds.has(objective.projectId)) {
        context.addIssue({
          code: 'custom',
          message: 'Objective references an unknown project',
          path: ['objectives', index, 'projectId'],
        });
      }
      const versionKey = `${objective.projectId}:${objective.objectiveVersion}`;
      if (objectiveVersions.has(versionKey)) {
        context.addIssue({
          code: 'custom',
          message: 'Objective versions must be unique within a project',
          path: ['objectives', index, 'objectiveVersion'],
        });
      }
      objectiveVersions.add(versionKey);
    }
  });

export const WorkspaceOperationSchema: z.ZodType<WorkspaceOperation> = z
  .object({
    schemaVersion: z.literal(1),
    workspaceRevision: z.number().int().positive(),
    id: uuidSchema,
    idempotencyKey: uuidSchema,
    scope: z.string().trim().min(1).max(500),
    projectId: uuidSchema.optional(),
    entityType: z.enum(['project', 'task', 'objective']),
    entityId: uuidSchema,
    commandType: z.enum([
      'project.create',
      'task.create',
      'task.update',
      'objective.save',
      'objective.lock',
      'objective.start-version',
    ]),
    baseVersion: z.number().int().nonnegative().nullable(),
    createdAt: timestampSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const WorkspacePendingSummarySchema: z.ZodType<WorkspacePendingSummary> = z
  .object({
    count: z.number().int().nonnegative(),
    latestWorkspaceRevision: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((summary, context) => {
    if ((summary.count === 0) !== (summary.latestWorkspaceRevision === null)) {
      context.addIssue({
        code: 'custom',
        message: 'Pending summary count and latest revision must agree',
        path: ['latestWorkspaceRevision'],
      });
    }
  });

export const CreateProjectInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    repository: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const CreateTaskInputSchema = z
  .object({
    projectId: uuidSchema,
    title: z.string().trim().min(2).max(240),
    status: taskStatusSchema.default('backlog'),
  })
  .strict();

export const UpdateTaskInputSchema = z
  .object({
    projectId: uuidSchema,
    taskId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(2).max(240).optional(),
    status: taskStatusSchema.optional(),
  })
  .strict()
  .refine((input) => input.title !== undefined || input.status !== undefined, {
    message: 'At least one task field must change',
  });

const objectiveFieldsSchema = objectiveSchema.pick({
  goal: true,
  primaryMetric: true,
  guardrails: true,
  budget: true,
  stopPolicy: true,
});

export const SaveObjectiveInputSchema = objectiveFieldsSchema
  .extend({
    projectId: uuidSchema,
    expectedEntityVersion: z.number().int().nonnegative(),
  })
  .strict();

export const ObjectiveCommandSchema = z
  .object({
    projectId: uuidSchema,
    expectedEntityVersion: z.number().int().nonnegative(),
  })
  .strict();

export type CreateProjectInput = z.input<typeof CreateProjectInputSchema>;
export type CreateTaskInput = z.input<typeof CreateTaskInputSchema>;
export type UpdateTaskInput = z.input<typeof UpdateTaskInputSchema>;
export type SaveObjectiveInput = z.input<typeof SaveObjectiveInputSchema>;
export type ObjectiveCommand = z.input<typeof ObjectiveCommandSchema>;
