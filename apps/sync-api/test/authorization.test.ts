import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AppController } from '../src/app.controller.js';
import type { Identity } from '../src/auth.js';
import { lockObjectiveSchema, objectiveSchema } from '../src/contracts.js';
import { SyncStore } from '../src/store.js';

const owner: Identity = {
  issuer: 'gosu:test',
  subject: 'owner-fixture',
  labId: 'lab-demo',
  role: 'owner',
};

describe('tenant and role authorization', () => {
  it('rejects project reads across labs without returning a redacted payload', () => {
    const controller = new AppController(new SyncStore());
    const outsider = { ...owner, labId: 'another-lab' };

    expect(() => controller.board('project-vision', outsider)).toThrow(ForbiddenException);
  });

  it('keeps Viewer read-only while allowing board reads', () => {
    const controller = new AppController(new SyncStore());
    const viewer: Identity = { ...owner, subject: 'viewer-fixture', role: 'viewer' };

    expect(controller.board('project-vision', viewer).data.length).toBeGreaterThan(0);
    expect(() =>
      controller.createTask('project-vision', viewer, {
        title: 'Viewer must not create this',
        status: 'backlog',
        idempotencyKey: '00000000-0000-4000-8000-000000000002',
      }),
    ).toThrow(ForbiddenException);
  });

  it('does not let a human HTTP caller forge an assistant chat message', () => {
    const controller = new AppController(new SyncStore());

    expect(() =>
      controller.appendChat('project-vision', owner, {
        role: 'assistant',
        content: 'This message was forged by a human client.',
        idempotencyKey: '00000000-0000-4000-8000-000000000004',
      }),
    ).toThrow();
    expect(controller.chats('project-vision', owner).data).toEqual([]);
  });

  it('requires optimistic versions for objective creation and locking', () => {
    expect(
      objectiveSchema.safeParse({
        goal: 'Improve the deterministic evaluation score',
        metric: {
          name: 'accuracy',
          direction: 'maximize',
          unit: 'ratio',
          aggregation: 'best',
          baseline: 0.8,
          target: 0.9,
        },
        evaluatorCommit: 'abcdef123',
        datasetHash: '0123456789abcdef',
        guardrails: [],
        budget: {
          maxTrials: 10,
          maxConcurrency: 1,
          maxGpuHours: 2,
          maxWallMinutes: 120,
          maxConsecutiveFailures: 3,
        },
        idempotencyKey: '00000000-0000-4000-8000-000000000005',
      }).success,
    ).toBe(false);
    expect(lockObjectiveSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
  });
});
