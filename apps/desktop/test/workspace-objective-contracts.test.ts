import { describe, expect, it } from 'vitest';

import {
  SaveObjectiveInputSchema,
  WorkspaceSnapshotSchema,
} from '../src/shared/workspace-contracts';

const project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Legacy objective lab',
  slug: 'legacy-objective-lab',
  version: 1,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
};

const fields = {
  goal: 'Measure reproducible progress without requiring a target threshold.',
  primaryMetric: {
    key: 'validation-loss',
    displayName: 'Validation loss',
    direction: 'minimize' as const,
    unit: null,
    aggregation: 'minimum' as const,
    evaluatorHash: 'sha256:evaluator',
    datasetHash: 'sha256:dataset',
    holdoutHash: null,
    baseline: null,
    target: null,
  },
  guardrails: [],
  budget: {
    maxTrials: 10,
    maxConcurrentTrials: 1,
    maxWallTimeSeconds: 3_600,
    maxGpuHours: 0,
    maxFailures: 3,
  },
  stopPolicy: {
    stopWhenTargetReached: true,
    guardrailAction: 'pause' as const,
    maxConsecutiveNoImprovement: null,
  },
};

describe('Desktop objective target compatibility', () => {
  it('rejects new save commands that request target-based stopping without a target', () => {
    expect(
      SaveObjectiveInputSchema.safeParse({
        projectId: project.id,
        expectedEntityVersion: 0,
        ...fields,
      }).success,
    ).toBe(false);
    expect(
      SaveObjectiveInputSchema.safeParse({
        projectId: project.id,
        expectedEntityVersion: 0,
        ...fields,
        stopPolicy: { ...fields.stopPolicy, stopWhenTargetReached: false },
      }).success,
    ).toBe(true);
  });

  it('continues reading a contradictory legacy snapshot so startup is not blocked', () => {
    expect(
      WorkspaceSnapshotSchema.safeParse({
        schemaVersion: 1,
        revision: 1,
        projects: [project],
        tasks: [],
        objectives: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            projectId: project.id,
            objectiveVersion: 1,
            entityVersion: 1,
            locked: false,
            ...fields,
            createdAt: '2026-08-11T00:00:00.000Z',
            updatedAt: '2026-08-11T00:00:00.000Z',
          },
        ],
      }).success,
    ).toBe(true);
  });
});
