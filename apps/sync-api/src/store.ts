import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RunnerEventTransport } from './contracts.js';
import { toSafePersistableObject } from './postgres-store.js';

export type ProjectRecord = {
  id: string;
  labId: string;
  name: string;
  slug: string;
  repository?: string | undefined;
  version: number;
  createdAt: string;
};

export type TaskRecord = {
  id: string;
  projectId: string;
  title: string;
  status: 'backlog' | 'planned' | 'in_progress' | 'review' | 'done';
  assigneeId?: string | undefined;
  resourceType?: 'experiment' | 'revision' | 'review' | 'reference' | undefined;
  resourceId?: string | undefined;
  version: number;
  updatedAt: string;
};

export type SyncEvent = {
  id: string;
  labId: string;
  projectId?: string;
  actorId: string;
  type: string;
  schemaVersion: 1;
  entityVersion: number;
  occurredAt: string;
  payload: Record<string, unknown>;
};

type ObjectiveRecord = Record<string, unknown> & {
  projectId: string;
  version: number;
  locked: boolean;
  updatedAt: string;
};
type ChatRecord = {
  id: string;
  projectId: string;
  role: 'user' | 'assistant';
  content: string;
  modelId?: string | undefined;
  createdAt: string;
  actorId: string;
};
type RunSummary = {
  projectId: string;
  runnerId: string;
  campaignId: string;
  trialId: string;
  attemptId: string;
  state?: string;
  metrics: Record<string, number>;
  updatedAt: string;
  lastSequence: number;
};
type IdempotencyRecord = { requestFingerprint: string; response: unknown };
const MAX_RUNNER_EVENT_FINGERPRINTS = 100_000;

export type RunnerProjectionResult =
  | { disposition: 'accepted'; summary: RunSummary }
  | { disposition: 'deduplicated'; summary: RunSummary }
  | { disposition: 'stale'; summary: RunSummary };

@Injectable()
export class SyncStore {
  readonly events = new EventEmitter();
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly objectives = new Map<string, ObjectiveRecord>();
  private readonly chats: ChatRecord[] = [];
  private readonly summaries = new Map<string, RunSummary>();
  private readonly runnerEventFingerprints = new Map<string, string>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();

  constructor() {
    if (process.env.SEED_DEMO !== 'false') this.seed();
  }

  listProjects(labId: string) {
    return [...this.projects.values()].filter((project) => project.labId === labId);
  }

  projectLabId(projectId: string) {
    return this.requireProject(projectId).labId;
  }

  createProject(
    labId: string,
    actorId: string,
    input: {
      name: string;
      slug: string;
      repository?: string | undefined;
      idempotencyKey: string;
    },
  ) {
    const scope = `project:create:${labId}`;
    const cached = this.idempotentReplay<ProjectRecord>(scope, input.idempotencyKey, input);
    if (cached) return cached;
    const { idempotencyKey, ...fields } = input;
    const project: ProjectRecord = {
      id: randomUUID(),
      labId,
      ...fields,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    this.rememberIdempotent(scope, idempotencyKey, input, project);
    this.emit({
      labId,
      projectId: project.id,
      actorId,
      type: 'project.created',
      entityVersion: project.version,
      payload: { name: project.name, slug: project.slug },
    });
    return project;
  }

  listTasks(projectId: string) {
    this.requireProject(projectId);
    return [...this.tasks.values()].filter((task) => task.projectId === projectId);
  }

  createTask(
    projectId: string,
    actorId: string,
    input: Omit<TaskRecord, 'id' | 'projectId' | 'version' | 'updatedAt'> & {
      idempotencyKey: string;
    },
  ) {
    const scope = `task:create:${projectId}`;
    const cached = this.idempotentReplay<TaskRecord>(scope, input.idempotencyKey, input);
    if (cached) return cached;
    const { idempotencyKey, ...fields } = input;
    const task: TaskRecord = {
      id: randomUUID(),
      projectId,
      ...fields,
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);
    this.rememberIdempotent(scope, idempotencyKey, input, task);
    this.emit({
      labId: this.requireProject(projectId).labId,
      projectId,
      actorId,
      type: 'task.created',
      entityVersion: task.version,
      payload: { taskId: task.id, status: task.status },
    });
    return task;
  }

  updateTask(
    projectId: string,
    taskId: string,
    actorId: string,
    input: {
      title?: string | undefined;
      status?: TaskRecord['status'] | undefined;
      assigneeId?: string | null | undefined;
      expectedVersion: number;
      idempotencyKey: string;
    },
  ) {
    const scope = `task:update:${projectId}:${taskId}`;
    const cached = this.idempotentReplay<TaskRecord>(scope, input.idempotencyKey, input);
    if (cached) return cached;
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) throw new NotFoundException('task_not_found');
    if (task.version !== input.expectedVersion)
      throw new ConflictException({ code: 'version_conflict', currentVersion: task.version });
    const next: TaskRecord = {
      ...task,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId ?? undefined }),
      version: task.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, next);
    this.rememberIdempotent(scope, input.idempotencyKey, input, next);
    this.emit({
      labId: this.requireProject(projectId).labId,
      projectId,
      actorId,
      type: 'task.updated',
      entityVersion: next.version,
      payload: { taskId, status: next.status },
    });
    return next;
  }

  getObjective(projectId: string) {
    this.requireProject(projectId);
    return this.objectives.get(projectId) ?? null;
  }

  putObjective(
    projectId: string,
    actorId: string,
    input: Record<string, unknown> & {
      expectedVersion: number;
      idempotencyKey: string;
    },
  ) {
    const scope = `objective:put:${projectId}`;
    const cached = this.idempotentReplay<ObjectiveRecord>(scope, input.idempotencyKey, input);
    if (cached) return cached;
    const current = this.objectives.get(projectId);
    if (current?.locked)
      throw new ConflictException({ code: 'objective_locked', currentVersion: current.version });
    if ((current?.version ?? 0) !== input.expectedVersion)
      throw new ConflictException({
        code: 'version_conflict',
        currentVersion: current?.version ?? 0,
      });
    const { expectedVersion: _expected, idempotencyKey, ...fields } = input;
    const next: ObjectiveRecord = {
      ...fields,
      projectId,
      version: (current?.version ?? 0) + 1,
      locked: false,
      updatedAt: new Date().toISOString(),
    };
    this.objectives.set(projectId, next);
    this.rememberIdempotent(scope, idempotencyKey, input, next);
    this.emit({
      labId: this.requireProject(projectId).labId,
      projectId,
      actorId,
      type: 'objective.version.created',
      entityVersion: next.version,
      payload: { objectiveVersion: next.version },
    });
    return next;
  }

  lockObjective(
    projectId: string,
    actorId: string,
    input: { expectedVersion: number; idempotencyKey: string },
  ) {
    const scope = `objective:lock:${projectId}`;
    const cached = this.idempotentReplay<ObjectiveRecord>(scope, input.idempotencyKey, input);
    if (cached) return cached;
    const current = this.objectives.get(projectId);
    if (!current) throw new NotFoundException('objective_not_found');
    if (current.locked) {
      throw new ConflictException({ code: 'objective_locked', currentVersion: current.version });
    }
    if (current.version !== input.expectedVersion) {
      throw new ConflictException({ code: 'version_conflict', currentVersion: current.version });
    }
    const next = {
      ...current,
      locked: true,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.objectives.set(projectId, next);
    this.rememberIdempotent(scope, input.idempotencyKey, input, next);
    this.emit({
      labId: this.requireProject(projectId).labId,
      projectId,
      actorId,
      type: 'objective.locked',
      entityVersion: next.version,
      payload: { objectiveVersion: next.version },
    });
    return next;
  }

  appendChat(
    actorId: string,
    input: {
      projectId: string;
      role: 'user' | 'assistant';
      content: string;
      modelId?: string | undefined;
      idempotencyKey: string;
    },
  ) {
    try {
      toSafePersistableObject({ content: input.content });
    } catch {
      throw new BadRequestException({ code: 'unsafe_hosted_payload' });
    }
    const scope = `chat:append:${input.projectId}`;
    const cached = this.idempotentReplay<ChatRecord>(scope, input.idempotencyKey, input);
    if (cached) return cached;
    const chat: ChatRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      role: input.role,
      content: input.content,
      modelId: input.modelId,
      actorId,
      createdAt: new Date().toISOString(),
    };
    this.chats.push(chat);
    this.rememberIdempotent(scope, input.idempotencyKey, input, chat);
    this.emit({
      labId: this.requireProject(input.projectId).labId,
      projectId: input.projectId,
      actorId,
      type: 'chat.message.appended',
      entityVersion: this.chats.length,
      payload: { messageId: chat.id, role: chat.role, modelId: chat.modelId },
    });
    return chat;
  }

  listChats(projectId: string) {
    this.requireProject(projectId);
    return this.chats.filter((chat) => chat.projectId === projectId);
  }

  projectRunnerEvent(transport: RunnerEventTransport): RunnerProjectionResult {
    this.requireProject(transport.projectId);
    const event = transport.event;
    const key = `${transport.projectId}:${transport.runnerId}:${event.trialId}:${event.attemptId}`;
    const current = this.summaries.get(key) ?? {
      projectId: transport.projectId,
      runnerId: transport.runnerId,
      campaignId: event.campaignId,
      trialId: event.trialId,
      attemptId: event.attemptId,
      metrics: {},
      updatedAt: event.occurredAt,
      lastSequence: -1,
    };
    const eventKey = `${transport.projectId}:${transport.runnerId}:${event.eventId}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(transport)).digest('hex');
    const recordedFingerprint = this.runnerEventFingerprints.get(eventKey);
    if (recordedFingerprint !== undefined) {
      if (recordedFingerprint !== fingerprint) {
        throw new ConflictException({ code: 'runner_event_id_reused', eventId: event.eventId });
      }
      return { disposition: 'deduplicated', summary: current };
    }
    if (event.sequence <= current.lastSequence) {
      return { disposition: 'stale', summary: current };
    }
    const next: RunSummary = {
      ...current,
      updatedAt: event.occurredAt,
      lastSequence: event.sequence,
    };
    if (event.kind === 'metric' && event.isSummary) {
      next.metrics = { ...next.metrics, [event.metricKey]: event.value };
    }
    if (event.kind === 'state') {
      next.state = event.state;
    }
    this.summaries.set(key, next);
    this.runnerEventFingerprints.set(eventKey, fingerprint);
    if (this.runnerEventFingerprints.size > MAX_RUNNER_EVENT_FINGERPRINTS) {
      const oldestKey = this.runnerEventFingerprints.keys().next().value as string | undefined;
      if (oldestKey !== undefined) this.runnerEventFingerprints.delete(oldestKey);
    }
    // Logs, resource samples, and metric points without isSummary are never retained.
    return { disposition: 'accepted', summary: next };
  }

  listRunSummaries(projectId: string) {
    return [...this.summaries.values()].filter((summary) => summary.projectId === projectId);
  }

  bootstrap(labId: string) {
    const projects = this.listProjects(labId);
    return {
      lab: { id: labId, name: 'Alpha Research Lab' },
      projects,
      tasks: [...this.tasks.values()].filter((task) =>
        projects.some((project) => project.id === task.projectId),
      ),
      runSummaries: [...this.summaries.values()].filter((summary) =>
        projects.some((project) => project.id === summary.projectId),
      ),
    };
  }

  private emit(input: Omit<SyncEvent, 'id' | 'schemaVersion' | 'occurredAt'>) {
    const event: SyncEvent = {
      ...input,
      id: randomUUID(),
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
    };
    this.events.emit('sync', event);
  }

  private requireProject(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project) throw new NotFoundException('project_not_found');
    return project;
  }

  private idempotentReplay<T>(scope: string, key: string, request: unknown): T | undefined {
    const record = this.idempotency.get(`${scope}:${key}`);
    if (!record) return undefined;
    if (record.requestFingerprint !== JSON.stringify(request)) {
      throw new ConflictException({ code: 'idempotency_key_reused' });
    }
    return record.response as T;
  }

  private rememberIdempotent(scope: string, key: string, request: unknown, response: unknown) {
    this.idempotency.set(`${scope}:${key}`, {
      requestFingerprint: JSON.stringify(request),
      response,
    });
  }

  private seed() {
    const project: ProjectRecord = {
      id: 'project-vision',
      labId: 'lab-demo',
      name: 'Efficient Vision Adaptation',
      slug: 'efficient-vision-adaptation',
      repository: 'gli-minsuk-shin/GOSU',
      version: 1,
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    for (const [index, status] of (
      ['backlog', 'planned', 'in_progress', 'review', 'done'] as const
    ).entries()) {
      const task: TaskRecord = {
        id: `task-${index + 1}`,
        projectId: project.id,
        title: [
          'Evaluate augmentation ablation',
          'Run seed robustness sweep',
          'Trial 8 · adapter rank 24',
          'Results paragraph revision',
          'Lock validation protocol v3',
        ][index]!,
        status,
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      this.tasks.set(task.id, task);
    }
  }
}
