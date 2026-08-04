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
import { REPOSITORY_IDENTIFIER_PATTERN } from './repository-identifier';

export const WORKSPACE_TASK_STATUSES = [
  'backlog',
  'planned',
  'in_progress',
  'review',
  'done',
] as const;

export type WorkspaceTaskStatus = (typeof WORKSPACE_TASK_STATUSES)[number];

export const WORKSPACE_TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export type WorkspaceTaskPriority = (typeof WORKSPACE_TASK_PRIORITIES)[number];

export type WorkspaceBoardSettings = Readonly<{
  title: string;
  columnLabels: Readonly<Record<WorkspaceTaskStatus, string>>;
  columnOrder: readonly WorkspaceTaskStatus[];
  wipLimits: Readonly<Record<WorkspaceTaskStatus, number | null>>;
}>;

export const DEFAULT_WORKSPACE_BOARD_SETTINGS: WorkspaceBoardSettings = Object.freeze({
  title: 'Board',
  columnLabels: Object.freeze({
    backlog: 'Backlog',
    planned: 'Planned',
    in_progress: 'In Progress',
    review: 'Review',
    done: 'Done',
  }),
  columnOrder: Object.freeze([...WORKSPACE_TASK_STATUSES]),
  wipLimits: Object.freeze({
    backlog: null,
    planned: null,
    in_progress: null,
    review: null,
    done: null,
  }),
});

export function resolveWorkspaceBoardSettings(
  board: WorkspaceBoardSettings | undefined,
): WorkspaceBoardSettings {
  return structuredClone(board ?? DEFAULT_WORKSPACE_BOARD_SETTINGS);
}

export type ProjectRecord = Readonly<{
  id: string;
  name: string;
  slug: string;
  repository?: string | undefined;
  board?: WorkspaceBoardSettings | undefined;
  archivedAt?: string | undefined;
  trashedAt?: string | undefined;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type WorkspaceTask = Readonly<{
  id: string;
  projectId: string;
  title: string;
  status: WorkspaceTaskStatus;
  description?: string | undefined;
  priority?: WorkspaceTaskPriority | undefined;
  dueDate?: string | undefined;
  labels?: readonly string[] | undefined;
  archivedAt?: string | undefined;
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
    | 'project.rename'
    | 'project.repository.update'
    | 'project.archive'
    | 'project.unarchive'
    | 'project.trash'
    | 'project.restore'
    | 'project.board.update'
    | 'task.create'
    | 'task.update'
    | 'task.archive'
    | 'task.restore'
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
const taskPrioritySchema = z.enum(WORKSPACE_TASK_PRIORITIES);

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month! - 1 &&
      date.getUTCDate() === day
    );
  }, 'Due date must be a valid local calendar date');

const columnLabelsSchema = z
  .object({
    backlog: z.string().trim().min(1).max(40),
    planned: z.string().trim().min(1).max(40),
    in_progress: z.string().trim().min(1).max(40),
    review: z.string().trim().min(1).max(40),
    done: z.string().trim().min(1).max(40),
  })
  .strict()
  .superRefine((labels, context) => {
    const seen = new Set<string>();
    for (const status of WORKSPACE_TASK_STATUSES) {
      const normalized = labels[status].normalize('NFKC').toLocaleLowerCase('en-US');
      if (seen.has(normalized)) {
        context.addIssue({
          code: 'custom',
          message: 'Column labels must be unique ignoring case',
          path: [status],
        });
      }
      seen.add(normalized);
    }
  });

const columnOrderSchema = z
  .array(taskStatusSchema)
  .length(WORKSPACE_TASK_STATUSES.length)
  .refine(
    (order) =>
      new Set(order).size === WORKSPACE_TASK_STATUSES.length &&
      WORKSPACE_TASK_STATUSES.every((status) => order.includes(status)),
    'Column order must contain every canonical status exactly once',
  );

const wipLimitsSchema = z
  .object({
    backlog: z.number().int().min(1).max(999).nullable(),
    planned: z.number().int().min(1).max(999).nullable(),
    in_progress: z.number().int().min(1).max(999).nullable(),
    review: z.number().int().min(1).max(999).nullable(),
    done: z.number().int().min(1).max(999).nullable(),
  })
  .strict();

export const WorkspaceBoardSettingsSchema: z.ZodType<WorkspaceBoardSettings> = z
  .object({
    title: z.string().trim().min(1).max(120),
    columnLabels: columnLabelsSchema,
    columnOrder: columnOrderSchema,
    wipLimits: wipLimitsSchema,
  })
  .strict();

function normalizeLabels(labels: readonly string[]) {
  const seen = new Set<string>();
  return labels.filter((label) => {
    const key = label.normalize('NFKC').toLocaleLowerCase('en-US');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const taskLabelsSchema = z
  .array(z.string().trim().min(1).max(32))
  .max(8)
  .transform(normalizeLabels);

const projectSchema: z.ZodType<ProjectRecord> = z
  .object({
    id: uuidSchema,
    name: z.string().trim().min(2).max(120),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    repository: z.string().trim().min(1).max(500).optional(),
    board: WorkspaceBoardSettingsSchema.optional(),
    archivedAt: timestampSchema.optional(),
    trashedAt: timestampSchema.optional(),
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
    description: z.string().trim().min(1).max(4_000).optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: localDateSchema.optional(),
    labels: taskLabelsSchema.optional(),
    archivedAt: timestampSchema.optional(),
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
      'project.rename',
      'project.repository.update',
      'project.archive',
      'project.unarchive',
      'project.trash',
      'project.restore',
      'project.board.update',
      'task.create',
      'task.update',
      'task.archive',
      'task.restore',
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
    repository: z.string().trim().regex(REPOSITORY_IDENTIFIER_PATTERN).optional(),
    board: WorkspaceBoardSettingsSchema.optional(),
  })
  .strict();

export const RenameProjectInputSchema = z
  .object({
    projectId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    name: z.string().trim().min(2).max(120),
  })
  .strict();

export const UpdateProjectRepositoryInputSchema = z
  .object({
    projectId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    repository: z.string().trim().regex(REPOSITORY_IDENTIFIER_PATTERN),
  })
  .strict();

export const ProjectVersionCommandSchema = z
  .object({
    projectId: uuidSchema,
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const SetProjectArchivedInputSchema = ProjectVersionCommandSchema.extend({
  archived: z.boolean(),
}).strict();

export const CreateTaskInputSchema = z
  .object({
    projectId: uuidSchema,
    title: z.string().trim().min(2).max(240),
    status: taskStatusSchema.default('backlog'),
    description: z.string().trim().max(4_000).optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: localDateSchema.optional(),
    labels: taskLabelsSchema.optional(),
  })
  .strict();

const optionalTaskDescriptionUpdateSchema = z.string().trim().max(4_000).nullable().optional();
const optionalTaskPriorityUpdateSchema = z
  .union([taskPrioritySchema, z.literal(''), z.null()])
  .optional();
const optionalTaskDueDateUpdateSchema = z
  .union([localDateSchema, z.literal(''), z.null()])
  .optional();

export const UpdateTaskInputSchema = z
  .object({
    projectId: uuidSchema,
    taskId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(2).max(240).optional(),
    status: taskStatusSchema.optional(),
    description: optionalTaskDescriptionUpdateSchema,
    priority: optionalTaskPriorityUpdateSchema,
    dueDate: optionalTaskDueDateUpdateSchema,
    labels: taskLabelsSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.status !== undefined ||
      Object.prototype.hasOwnProperty.call(input, 'description') ||
      Object.prototype.hasOwnProperty.call(input, 'priority') ||
      Object.prototype.hasOwnProperty.call(input, 'dueDate') ||
      input.labels !== undefined,
    { message: 'At least one task field must change' },
  );

export const UpdateBoardSettingsInputSchema = z
  .object({
    projectId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    board: WorkspaceBoardSettingsSchema,
  })
  .strict();

export const SetTaskArchivedInputSchema = z
  .object({
    projectId: uuidSchema,
    taskId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    archived: z.boolean(),
  })
  .strict();

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
export type RenameProjectInput = z.input<typeof RenameProjectInputSchema>;
export type UpdateProjectRepositoryInput = z.input<typeof UpdateProjectRepositoryInputSchema>;
export type ProjectVersionCommand = z.input<typeof ProjectVersionCommandSchema>;
export type SetProjectArchivedInput = z.input<typeof SetProjectArchivedInputSchema>;
export type CreateTaskInput = z.input<typeof CreateTaskInputSchema>;
export type UpdateTaskInput = z.input<typeof UpdateTaskInputSchema>;
export type UpdateBoardSettingsInput = z.input<typeof UpdateBoardSettingsInputSchema>;
export type SetTaskArchivedInput = z.input<typeof SetTaskArchivedInputSchema>;
export type SaveObjectiveInput = z.input<typeof SaveObjectiveInputSchema>;
export type ObjectiveCommand = z.input<typeof ObjectiveCommandSchema>;
