import { RunnerEventMessageV1Schema, type RunnerEventMessageV1 } from '@gosu/contracts';
import { z } from 'zod';

export const roleSchema = z.enum(['owner', 'project_lead', 'researcher', 'reviewer', 'viewer']);
export type Role = z.infer<typeof roleSchema>;

export const taskStatusSchema = z.enum(['backlog', 'planned', 'in_progress', 'review', 'done']);

export const createProjectSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  repository: z.string().optional(),
  idempotencyKey: z.string().uuid(),
});

export const createTaskSchema = z.object({
  title: z.string().min(2).max(240),
  status: taskStatusSchema.default('backlog'),
  assigneeId: z.string().optional(),
  resourceType: z.enum(['experiment', 'revision', 'review', 'reference']).optional(),
  resourceId: z.string().optional(),
  idempotencyKey: z.string().uuid(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(2).max(240).optional(),
  status: taskStatusSchema.optional(),
  assigneeId: z.string().nullable().optional(),
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().uuid(),
});

export const objectiveSchema = z.object({
  goal: z.string().min(10),
  metric: z.object({
    name: z.string().min(1),
    direction: z.enum(['maximize', 'minimize', 'target']),
    unit: z.string().min(1),
    aggregation: z.enum(['last', 'best', 'mean']),
    baseline: z.number(),
    target: z.number(),
  }),
  evaluatorCommit: z.string().min(7),
  datasetHash: z.string().min(16),
  guardrails: z.array(
    z.object({ name: z.string(), operator: z.enum(['lte', 'gte']), threshold: z.number() }),
  ),
  budget: z.object({
    maxTrials: z.number().int().positive(),
    maxConcurrency: z.number().int().positive(),
    maxGpuHours: z.number().nonnegative(),
    maxWallMinutes: z.number().int().positive(),
    maxConsecutiveFailures: z.number().int().positive(),
  }),
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().uuid(),
});

export const lockObjectiveSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
});

export const chatMessageSchema = z.object({
  projectId: z.string(),
  role: z.literal('user'),
  content: z.string().min(1).max(100_000),
  modelId: z.string().optional(),
  idempotencyKey: z.string().uuid(),
});

export const runnerEventTransportSchema = RunnerEventMessageV1Schema;
export type RunnerEventTransport = RunnerEventMessageV1;
