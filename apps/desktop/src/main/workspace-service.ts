import { randomUUID } from 'node:crypto';

import {
  CreateProjectInputSchema,
  CreateTaskInputSchema,
  ObjectiveCommandSchema,
  ProjectVersionCommandSchema,
  RenameProjectInputSchema,
  SaveObjectiveInputSchema,
  SetProjectArchivedInputSchema,
  SetTaskArchivedInputSchema,
  UpdateBoardSettingsInputSchema,
  UpdateTaskInputSchema,
  WorkspaceOperationSchema,
  WorkspacePendingSummarySchema,
  WorkspaceSnapshotSchema,
  resolveWorkspaceBoardSettings,
  type CreateProjectInput,
  type CreateTaskInput,
  type ObjectiveCommand,
  type ProjectRecord,
  type ProjectVersionCommand,
  type RenameProjectInput,
  type SaveObjectiveInput,
  type SetProjectArchivedInput,
  type SetTaskArchivedInput,
  type UpdateBoardSettingsInput,
  type UpdateTaskInput,
  type WorkspaceObjective,
  type WorkspaceOperation,
  type WorkspacePendingSummary,
  type WorkspaceSnapshot,
  type WorkspaceTask,
} from '../shared/workspace-contracts';

type WorkspaceOperationDraft = Omit<WorkspaceOperation, 'workspaceRevision'>;
type MutableWorkspaceTask = { -readonly [Key in keyof WorkspaceTask]: WorkspaceTask[Key] };

type MaybePromise<T> = T | Promise<T>;

/**
 * Implementations must persist the state and append the operation in one atomic transaction.
 * Returning successfully from commit means both values are durable; throwing means neither is.
 */
export interface WorkspaceStorage {
  load(): MaybePromise<WorkspaceSnapshot | null>;
  commit(state: WorkspaceSnapshot, operation: WorkspaceOperation): MaybePromise<void>;
  pendingChanges(): MaybePromise<readonly WorkspaceOperation[]>;
  pendingSummary(): MaybePromise<WorkspacePendingSummary>;
}

export class WorkspaceServiceError extends Error {
  constructor(
    readonly code:
      | 'project_not_found'
      | 'project_archived'
      | 'project_not_archived'
      | 'project_trashed'
      | 'project_not_trashed'
      | 'task_not_found'
      | 'cross_project_access_denied'
      | 'objective_not_found'
      | 'objective_locked'
      | 'objective_not_locked'
      | 'version_conflict',
    readonly details: Readonly<Record<string, string | number>> = {},
  ) {
    super(code);
    this.name = 'WorkspaceServiceError';
  }
}

const emptySnapshot = (): WorkspaceSnapshot => ({
  schemaVersion: 1,
  revision: 0,
  projects: [],
  tasks: [],
  objectives: [],
});

function copy<T>(value: T): T {
  return structuredClone(value);
}

function conflict(entityId: string, expectedVersion: number, currentVersion: number) {
  return new WorkspaceServiceError('version_conflict', {
    entityId,
    expectedVersion,
    currentVersion,
  });
}

function deriveSlug(name: string, projects: readonly ProjectRecord[]) {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const base = normalized || 'project';
  const used = new Set(projects.map((project) => project.slug));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function currentObjective(state: WorkspaceSnapshot, projectId: string) {
  return state.objectives
    .filter((objective) => objective.projectId === projectId)
    .sort((left, right) => right.objectiveVersion - left.objectiveVersion)[0];
}

export class WorkspaceService {
  private state: WorkspaceSnapshot | undefined;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly storage: WorkspaceStorage) {}

  async snapshot(): Promise<WorkspaceSnapshot> {
    await this.mutationTail;
    return copy(await this.load());
  }

  async pendingChanges(): Promise<readonly WorkspaceOperation[]> {
    await this.mutationTail;
    return WorkspaceOperationSchema.array()
      .parse(copy(await this.storage.pendingChanges()))
      .sort((left, right) => left.workspaceRevision - right.workspaceRevision);
  }

  async pendingSummary(): Promise<WorkspacePendingSummary> {
    await this.mutationTail;
    return WorkspacePendingSummarySchema.parse(copy(await this.storage.pendingSummary()));
  }

  createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    return this.mutate(async (state) => {
      const command = CreateProjectInputSchema.parse(input);
      const now = new Date().toISOString();
      const board = resolveWorkspaceBoardSettings(command.board);
      const project: ProjectRecord = {
        id: randomUUID(),
        name: command.name,
        slug: deriveSlug(command.name, state.projects),
        ...(command.repository === undefined ? {} : { repository: command.repository }),
        board,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      return {
        state: { ...state, projects: [...state.projects, project] },
        operation: this.operation(
          'project.create',
          `workspace:${project.id}:project:create`,
          project.id,
          'project',
          project.id,
          null,
          now,
          {
            name: project.name,
            slug: project.slug,
            ...(project.repository === undefined ? {} : { repository: project.repository }),
            board,
          },
        ),
        value: project,
      };
    });
  }

  renameProject(input: RenameProjectInput): Promise<ProjectRecord> {
    return this.mutate(async (state) => {
      const command = RenameProjectInputSchema.parse(input);
      const project = this.requireActiveProject(state, command.projectId);
      if (project.version !== command.expectedVersion) {
        throw conflict(project.id, command.expectedVersion, project.version);
      }
      const now = new Date().toISOString();
      const updated: ProjectRecord = {
        ...project,
        name: command.name,
        version: project.version + 1,
        updatedAt: now,
      };
      return {
        state: {
          ...state,
          projects: state.projects.map((candidate) =>
            candidate.id === project.id ? updated : candidate,
          ),
        },
        operation: this.operation(
          'project.rename',
          `workspace:${project.id}:project:${project.id}:rename`,
          project.id,
          'project',
          project.id,
          project.version,
          now,
          { name: updated.name, newEntityVersion: updated.version },
        ),
        value: updated,
      };
    });
  }

  setProjectArchived(input: SetProjectArchivedInput): Promise<ProjectRecord> {
    return this.mutate(async (state) => {
      const command = SetProjectArchivedInputSchema.parse(input);
      const project = this.requireProject(state, command.projectId);
      if (project.version !== command.expectedVersion) {
        throw conflict(project.id, command.expectedVersion, project.version);
      }
      if (project.trashedAt !== undefined) {
        throw new WorkspaceServiceError('project_trashed', { projectId: project.id });
      }
      if (command.archived === (project.archivedAt !== undefined)) {
        throw new WorkspaceServiceError(
          command.archived ? 'project_archived' : 'project_not_archived',
          { projectId: project.id },
        );
      }
      const now = new Date().toISOString();
      const updated: ProjectRecord = command.archived
        ? {
            ...project,
            archivedAt: now,
            version: project.version + 1,
            updatedAt: now,
          }
        : (() => {
            const { archivedAt: _archivedAt, ...activeProject } = project;
            return {
              ...activeProject,
              version: project.version + 1,
              updatedAt: now,
            };
          })();
      return {
        state: {
          ...state,
          projects: state.projects.map((candidate) =>
            candidate.id === project.id ? updated : candidate,
          ),
        },
        operation: this.operation(
          command.archived ? 'project.archive' : 'project.unarchive',
          `workspace:${project.id}:project:${project.id}:${command.archived ? 'archive' : 'unarchive'}`,
          project.id,
          'project',
          project.id,
          project.version,
          now,
          {
            archivedAt: updated.archivedAt ?? null,
            newEntityVersion: updated.version,
          },
        ),
        value: updated,
      };
    });
  }

  trashProject(input: ProjectVersionCommand): Promise<ProjectRecord> {
    return this.mutate(async (state) => {
      const command = ProjectVersionCommandSchema.parse(input);
      const project = this.requireProject(state, command.projectId);
      if (project.version !== command.expectedVersion) {
        throw conflict(project.id, command.expectedVersion, project.version);
      }
      if (project.trashedAt !== undefined) {
        throw new WorkspaceServiceError('project_trashed', { projectId: project.id });
      }
      const now = new Date().toISOString();
      const updated: ProjectRecord = {
        ...project,
        trashedAt: now,
        version: project.version + 1,
        updatedAt: now,
      };
      return {
        state: {
          ...state,
          projects: state.projects.map((candidate) =>
            candidate.id === project.id ? updated : candidate,
          ),
        },
        operation: this.operation(
          'project.trash',
          `workspace:${project.id}:project:${project.id}:trash`,
          project.id,
          'project',
          project.id,
          project.version,
          now,
          { trashedAt: updated.trashedAt, newEntityVersion: updated.version },
        ),
        value: updated,
      };
    });
  }

  restoreProject(input: ProjectVersionCommand): Promise<ProjectRecord> {
    return this.mutate(async (state) => {
      const command = ProjectVersionCommandSchema.parse(input);
      const project = this.requireProject(state, command.projectId);
      if (project.version !== command.expectedVersion) {
        throw conflict(project.id, command.expectedVersion, project.version);
      }
      if (project.trashedAt === undefined) {
        throw new WorkspaceServiceError('project_not_trashed', { projectId: project.id });
      }
      const now = new Date().toISOString();
      const { trashedAt: _trashedAt, ...activeProject } = project;
      const updated: ProjectRecord = {
        ...activeProject,
        version: project.version + 1,
        updatedAt: now,
      };
      return {
        state: {
          ...state,
          projects: state.projects.map((candidate) =>
            candidate.id === project.id ? updated : candidate,
          ),
        },
        operation: this.operation(
          'project.restore',
          `workspace:${project.id}:project:${project.id}:restore`,
          project.id,
          'project',
          project.id,
          project.version,
          now,
          { trashedAt: null, newEntityVersion: updated.version },
        ),
        value: updated,
      };
    });
  }

  createTask(input: CreateTaskInput): Promise<WorkspaceTask> {
    return this.mutate(async (state) => {
      const command = CreateTaskInputSchema.parse(input);
      this.requireActiveProject(state, command.projectId);
      const now = new Date().toISOString();
      const task: WorkspaceTask = {
        id: randomUUID(),
        projectId: command.projectId,
        title: command.title,
        status: command.status,
        ...(command.description ? { description: command.description } : {}),
        ...(command.priority === undefined ? {} : { priority: command.priority }),
        ...(command.dueDate === undefined ? {} : { dueDate: command.dueDate }),
        ...(command.labels === undefined || command.labels.length === 0
          ? {}
          : { labels: command.labels }),
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      return {
        state: { ...state, tasks: [...state.tasks, task] },
        operation: this.operation(
          'task.create',
          `workspace:${task.projectId}:task:create`,
          task.projectId,
          'task',
          task.id,
          null,
          now,
          {
            title: task.title,
            status: task.status,
            ...(task.description === undefined ? {} : { description: task.description }),
            ...(task.priority === undefined ? {} : { priority: task.priority }),
            ...(task.dueDate === undefined ? {} : { dueDate: task.dueDate }),
            ...(task.labels === undefined ? {} : { labels: task.labels }),
          },
        ),
        value: task,
      };
    });
  }

  updateTask(input: UpdateTaskInput): Promise<WorkspaceTask> {
    return this.mutate(async (state) => {
      const command = UpdateTaskInputSchema.parse(input);
      this.requireActiveProject(state, command.projectId);
      const task = state.tasks.find((candidate) => candidate.id === command.taskId);
      if (!task) throw new WorkspaceServiceError('task_not_found', { taskId: command.taskId });
      if (task.projectId !== command.projectId) {
        throw new WorkspaceServiceError('cross_project_access_denied', {
          projectId: command.projectId,
          entityId: command.taskId,
        });
      }
      if (task.version !== command.expectedVersion) {
        throw conflict(task.id, command.expectedVersion, task.version);
      }
      const now = new Date().toISOString();
      const updated: MutableWorkspaceTask = {
        ...task,
        ...(command.title === undefined ? {} : { title: command.title }),
        ...(command.status === undefined ? {} : { status: command.status }),
        version: task.version + 1,
        updatedAt: now,
      };
      if (Object.prototype.hasOwnProperty.call(command, 'description')) {
        if (command.description) updated.description = command.description;
        else delete updated.description;
      }
      if (Object.prototype.hasOwnProperty.call(command, 'priority')) {
        if (command.priority) updated.priority = command.priority;
        else delete updated.priority;
      }
      if (Object.prototype.hasOwnProperty.call(command, 'dueDate')) {
        if (command.dueDate) updated.dueDate = command.dueDate;
        else delete updated.dueDate;
      }
      if (command.labels !== undefined) {
        if (command.labels.length > 0) updated.labels = command.labels;
        else delete updated.labels;
      }
      return {
        state: {
          ...state,
          tasks: state.tasks.map((candidate) => (candidate.id === task.id ? updated : candidate)),
        },
        operation: this.operation(
          'task.update',
          `workspace:${task.projectId}:task:${task.id}:update`,
          task.projectId,
          'task',
          task.id,
          task.version,
          now,
          {
            ...(command.title === undefined ? {} : { title: command.title }),
            ...(command.status === undefined ? {} : { status: command.status }),
            ...(Object.prototype.hasOwnProperty.call(command, 'description')
              ? { description: updated.description ?? null }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(command, 'priority')
              ? { priority: updated.priority ?? null }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(command, 'dueDate')
              ? { dueDate: updated.dueDate ?? null }
              : {}),
            ...(command.labels === undefined ? {} : { labels: updated.labels ?? [] }),
            newEntityVersion: updated.version,
          },
        ),
        value: updated,
      };
    });
  }

  updateBoardSettings(input: UpdateBoardSettingsInput): Promise<ProjectRecord> {
    return this.mutate(async (state) => {
      const command = UpdateBoardSettingsInputSchema.parse(input);
      const project = this.requireActiveProject(state, command.projectId);
      if (project.version !== command.expectedVersion) {
        throw conflict(project.id, command.expectedVersion, project.version);
      }
      const now = new Date().toISOString();
      const updated: ProjectRecord = {
        ...project,
        board: command.board,
        version: project.version + 1,
        updatedAt: now,
      };
      return {
        state: {
          ...state,
          projects: state.projects.map((candidate) =>
            candidate.id === project.id ? updated : candidate,
          ),
        },
        operation: this.operation(
          'project.board.update',
          `workspace:${project.id}:project:${project.id}:board:update`,
          project.id,
          'project',
          project.id,
          project.version,
          now,
          { board: updated.board, newEntityVersion: updated.version },
        ),
        value: updated,
      };
    });
  }

  setTaskArchived(input: SetTaskArchivedInput): Promise<WorkspaceTask> {
    return this.mutate(async (state) => {
      const command = SetTaskArchivedInputSchema.parse(input);
      this.requireActiveProject(state, command.projectId);
      const task = state.tasks.find((candidate) => candidate.id === command.taskId);
      if (!task) throw new WorkspaceServiceError('task_not_found', { taskId: command.taskId });
      if (task.projectId !== command.projectId) {
        throw new WorkspaceServiceError('cross_project_access_denied', {
          projectId: command.projectId,
          entityId: command.taskId,
        });
      }
      if (task.version !== command.expectedVersion) {
        throw conflict(task.id, command.expectedVersion, task.version);
      }
      const now = new Date().toISOString();
      const updated: MutableWorkspaceTask = {
        ...task,
        version: task.version + 1,
        updatedAt: now,
      };
      if (command.archived) updated.archivedAt = now;
      else delete updated.archivedAt;
      return {
        state: {
          ...state,
          tasks: state.tasks.map((candidate) => (candidate.id === task.id ? updated : candidate)),
        },
        operation: this.operation(
          command.archived ? 'task.archive' : 'task.restore',
          `workspace:${task.projectId}:task:${task.id}:${command.archived ? 'archive' : 'restore'}`,
          task.projectId,
          'task',
          task.id,
          task.version,
          now,
          {
            archivedAt: updated.archivedAt ?? null,
            newEntityVersion: updated.version,
          },
        ),
        value: updated,
      };
    });
  }

  saveObjective(input: SaveObjectiveInput): Promise<WorkspaceObjective> {
    return this.mutate(async (state) => {
      const command = SaveObjectiveInputSchema.parse(input);
      this.requireActiveProject(state, command.projectId);
      const current = currentObjective(state, command.projectId);
      const actualVersion = current?.entityVersion ?? 0;
      if (actualVersion !== command.expectedEntityVersion) {
        throw conflict(
          current?.id ?? command.projectId,
          command.expectedEntityVersion,
          actualVersion,
        );
      }
      if (current?.locked) {
        throw new WorkspaceServiceError('objective_locked', { objectiveId: current.id });
      }
      const now = new Date().toISOString();
      const { projectId, expectedEntityVersion: _expectedEntityVersion, ...fields } = command;
      const objective: WorkspaceObjective = current
        ? {
            ...current,
            ...fields,
            entityVersion: current.entityVersion + 1,
            updatedAt: now,
          }
        : {
            id: randomUUID(),
            projectId,
            objectiveVersion: 1,
            entityVersion: 1,
            locked: false,
            ...fields,
            createdAt: now,
            updatedAt: now,
          };
      return {
        state: {
          ...state,
          objectives: current
            ? state.objectives.map((candidate) =>
                candidate.id === current.id ? objective : candidate,
              )
            : [...state.objectives, objective],
        },
        operation: this.operation(
          'objective.save',
          `workspace:${projectId}:objective:save`,
          projectId,
          'objective',
          objective.id,
          current?.entityVersion ?? null,
          now,
          {
            objectiveVersion: objective.objectiveVersion,
            newEntityVersion: objective.entityVersion,
            locked: false,
            goal: objective.goal,
            primaryMetric: objective.primaryMetric,
            guardrails: objective.guardrails,
            budget: objective.budget,
            stopPolicy: objective.stopPolicy,
          },
        ),
        value: objective,
      };
    });
  }

  lockObjective(input: ObjectiveCommand): Promise<WorkspaceObjective> {
    return this.mutate(async (state) => {
      const command = ObjectiveCommandSchema.parse(input);
      this.requireActiveProject(state, command.projectId);
      const current = currentObjective(state, command.projectId);
      if (!current) throw new WorkspaceServiceError('objective_not_found');
      if (current.entityVersion !== command.expectedEntityVersion) {
        throw conflict(current.id, command.expectedEntityVersion, current.entityVersion);
      }
      if (current.locked) {
        throw new WorkspaceServiceError('objective_locked', { objectiveId: current.id });
      }
      const now = new Date().toISOString();
      const objective: WorkspaceObjective = {
        ...current,
        locked: true,
        entityVersion: current.entityVersion + 1,
        updatedAt: now,
      };
      return {
        state: {
          ...state,
          objectives: state.objectives.map((candidate) =>
            candidate.id === current.id ? objective : candidate,
          ),
        },
        operation: this.operation(
          'objective.lock',
          `workspace:${current.projectId}:objective:lock`,
          current.projectId,
          'objective',
          current.id,
          current.entityVersion,
          now,
          {
            objectiveVersion: objective.objectiveVersion,
            newEntityVersion: objective.entityVersion,
            locked: true,
          },
        ),
        value: objective,
      };
    });
  }

  startObjectiveVersion(input: ObjectiveCommand): Promise<WorkspaceObjective> {
    return this.mutate(async (state) => {
      const command = ObjectiveCommandSchema.parse(input);
      this.requireActiveProject(state, command.projectId);
      const current = currentObjective(state, command.projectId);
      if (!current) throw new WorkspaceServiceError('objective_not_found');
      if (current.entityVersion !== command.expectedEntityVersion) {
        throw conflict(current.id, command.expectedEntityVersion, current.entityVersion);
      }
      if (!current.locked) {
        throw new WorkspaceServiceError('objective_not_locked', { objectiveId: current.id });
      }
      const now = new Date().toISOString();
      const objective: WorkspaceObjective = {
        ...current,
        id: randomUUID(),
        objectiveVersion: current.objectiveVersion + 1,
        entityVersion: 1,
        locked: false,
        createdAt: now,
        updatedAt: now,
      };
      return {
        state: { ...state, objectives: [...state.objectives, objective] },
        operation: this.operation(
          'objective.start-version',
          `workspace:${current.projectId}:objective:start-version`,
          current.projectId,
          'objective',
          objective.id,
          current.entityVersion,
          now,
          {
            objectiveVersion: objective.objectiveVersion,
            newEntityVersion: objective.entityVersion,
            previousObjectiveId: current.id,
          },
        ),
        value: objective,
      };
    });
  }

  private async load(): Promise<WorkspaceSnapshot> {
    if (this.state === undefined) {
      const persisted = await this.storage.load();
      this.state =
        persisted === null ? emptySnapshot() : WorkspaceSnapshotSchema.parse(copy(persisted));
    }
    return this.state;
  }

  private mutate<T>(
    mutation: (state: WorkspaceSnapshot) => MaybePromise<{
      state: WorkspaceSnapshot;
      operation: WorkspaceOperationDraft;
      value: T;
    }>,
  ): Promise<T> {
    const result = this.mutationTail.then(async () => {
      const current = await this.load();
      const mutationResult = await mutation(copy(current));
      const state = WorkspaceSnapshotSchema.parse({
        ...mutationResult.state,
        revision: current.revision + 1,
      });
      const operation = WorkspaceOperationSchema.parse({
        ...mutationResult.operation,
        workspaceRevision: state.revision,
      });
      await this.storage.commit(copy(state), copy(operation));
      this.state = state;
      return copy(mutationResult.value);
    });
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private requireProject(state: WorkspaceSnapshot, projectId: string) {
    const project = state.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new WorkspaceServiceError('project_not_found', { projectId });
    return project;
  }

  private requireActiveProject(state: WorkspaceSnapshot, projectId: string) {
    const project = this.requireProject(state, projectId);
    if (project.trashedAt !== undefined) {
      throw new WorkspaceServiceError('project_trashed', { projectId });
    }
    if (project.archivedAt !== undefined) {
      throw new WorkspaceServiceError('project_archived', { projectId });
    }
    return project;
  }

  private operation(
    commandType: WorkspaceOperation['commandType'],
    scope: string,
    projectId: string | undefined,
    entityType: WorkspaceOperation['entityType'],
    entityId: string,
    baseVersion: number | null,
    createdAt: string,
    payload: WorkspaceOperation['payload'],
  ): WorkspaceOperationDraft {
    const id = randomUUID();
    return {
      schemaVersion: 1,
      id,
      idempotencyKey: id,
      scope,
      ...(projectId === undefined ? {} : { projectId }),
      entityType,
      entityId,
      commandType,
      baseVersion,
      createdAt,
      payload,
    };
  }
}
