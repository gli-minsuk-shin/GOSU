import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { filter, fromEvent, map, type Observable } from 'rxjs';
import { CurrentIdentity, type Identity } from './auth.js';
import {
  chatMessageSchema,
  createProjectSchema,
  createTaskSchema,
  lockObjectiveSchema,
  objectiveSchema,
  updateTaskSchema,
  type Role,
} from './contracts.js';
import type { SyncEvent } from './store.js';
import { SyncStore } from './store.js';

@Controller()
export class AppController {
  constructor(@Inject(SyncStore) private readonly store: SyncStore) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'gosu-sync-api',
      now: new Date().toISOString(),
      persistence: 'memory-development',
    };
  }

  @Get('v1/bootstrap')
  bootstrap(@CurrentIdentity() identity: Identity) {
    return this.store.bootstrap(identity.labId);
  }

  @Get('v1/labs/:labId/projects')
  listProjects(@Param('labId') labId: string, @CurrentIdentity() identity: Identity) {
    this.assertLab(identity, labId);
    return { data: this.store.listProjects(labId) };
  }

  @Post('v1/labs/:labId/projects')
  createProject(
    @Param('labId') labId: string,
    @CurrentIdentity() identity: Identity,
    @Body() body: unknown,
  ) {
    this.assertLab(identity, labId);
    this.assertRole(identity, ['owner']);
    return this.store.createProject(labId, identity.subject, createProjectSchema.parse(body));
  }

  @Get('v1/projects/:projectId/board')
  board(@Param('projectId') projectId: string, @CurrentIdentity() identity: Identity) {
    this.assertProject(identity, projectId);
    return { data: this.store.listTasks(projectId) };
  }

  @Post('v1/projects/:projectId/tasks')
  createTask(
    @Param('projectId') projectId: string,
    @CurrentIdentity() identity: Identity,
    @Body() body: unknown,
  ) {
    this.assertProject(identity, projectId);
    this.assertRole(identity, ['owner', 'project_lead', 'researcher']);
    return this.store.createTask(projectId, identity.subject, createTaskSchema.parse(body));
  }

  @Patch('v1/projects/:projectId/tasks/:taskId')
  updateTask(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @CurrentIdentity() identity: Identity,
    @Body() body: unknown,
  ) {
    this.assertProject(identity, projectId);
    this.assertRole(identity, ['owner', 'project_lead', 'researcher']);
    return this.store.updateTask(projectId, taskId, identity.subject, updateTaskSchema.parse(body));
  }

  @Get('v1/projects/:projectId/objective')
  objective(@Param('projectId') projectId: string, @CurrentIdentity() identity: Identity) {
    this.assertProject(identity, projectId);
    return this.store.getObjective(projectId);
  }

  @Put('v1/projects/:projectId/objective')
  putObjective(
    @Param('projectId') projectId: string,
    @CurrentIdentity() identity: Identity,
    @Body() body: unknown,
  ) {
    this.assertProject(identity, projectId);
    this.assertRole(identity, ['owner', 'project_lead', 'researcher']);
    return this.store.putObjective(projectId, identity.subject, objectiveSchema.parse(body));
  }

  @Post('v1/projects/:projectId/objective/lock')
  lockObjective(
    @Param('projectId') projectId: string,
    @CurrentIdentity() identity: Identity,
    @Body() body: unknown,
  ) {
    this.assertProject(identity, projectId);
    this.assertRole(identity, ['owner', 'project_lead']);
    return this.store.lockObjective(projectId, identity.subject, lockObjectiveSchema.parse(body));
  }

  @Get('v1/projects/:projectId/chat')
  chats(@Param('projectId') projectId: string, @CurrentIdentity() identity: Identity) {
    this.assertProject(identity, projectId);
    return { data: this.store.listChats(projectId) };
  }

  @Post('v1/projects/:projectId/chat')
  appendChat(
    @Param('projectId') projectId: string,
    @CurrentIdentity() identity: Identity,
    @Body() body: unknown,
  ) {
    this.assertProject(identity, projectId);
    this.assertRole(identity, ['owner', 'project_lead', 'researcher', 'reviewer']);
    return this.store.appendChat(
      identity.subject,
      chatMessageSchema.parse({ ...(body as object), projectId }),
    );
  }

  @Get('v1/projects/:projectId/runs')
  runSummaries(@Param('projectId') projectId: string, @CurrentIdentity() identity: Identity) {
    this.assertProject(identity, projectId);
    return { data: this.store.listRunSummaries(projectId) };
  }

  @Sse('v1/events')
  events(@CurrentIdentity() identity: Identity): Observable<MessageEvent> {
    return fromEvent<SyncEvent>(this.store.events, 'sync').pipe(
      filter((event) => event.labId === identity.labId),
      map((event) => ({ id: event.id, type: event.type, data: event })),
    );
  }

  private assertLab(identity: Identity, labId: string) {
    if (identity.labId !== labId) throw new ForbiddenException('cross_lab_access_denied');
  }

  private assertProject(identity: Identity, projectId: string) {
    this.assertLab(identity, this.store.projectLabId(projectId));
  }

  private assertRole(identity: Identity, allowed: readonly Role[]) {
    if (!allowed.includes(identity.role)) throw new ForbiddenException('role_access_denied');
  }
}
