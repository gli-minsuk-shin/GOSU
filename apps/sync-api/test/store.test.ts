import type { RunnerEventV1 } from '@gosu/contracts';
import { describe, expect, it } from 'vitest';
import type { RunnerEventTransport } from '../src/contracts.js';
import { SyncStore } from '../src/store.js';

const NOW = '2026-08-03T08:00:00.000Z';

function transport(event: RunnerEventV1, projectId = 'project-vision'): RunnerEventTransport {
  return { type: 'runner.event', projectId, runnerId: event.runnerId, event };
}

function event(input: {
  kind: RunnerEventV1['kind'];
  eventId: string;
  sequence: number;
  runnerId?: string;
  campaignId?: string;
  trialId?: string;
  attemptId?: string;
  occurredAt?: string;
  [key: string]: unknown;
}): RunnerEventV1 {
  return {
    schemaVersion: 1,
    runnerId: input.runnerId ?? 'runner-1',
    campaignId: input.campaignId ?? 'campaign-1',
    trialId: input.trialId ?? 'trial-1',
    attemptId: input.attemptId ?? 'attempt-1',
    occurredAt: input.occurredAt ?? NOW,
    ...input,
  } as unknown as RunnerEventV1;
}

describe('SyncStore', () => {
  it('rejects stale optimistic task updates', () => {
    const store = new SyncStore();
    expect(() =>
      store.updateTask('project-vision', 'task-1', 'user-demo', {
        status: 'planned',
        expectedVersion: 9,
        idempotencyKey: '00000000-0000-4000-8000-000000000001',
      }),
    ).toThrow();
  });

  it('does not retain raw log or intermediate metric payloads in run summaries', () => {
    const store = new SyncStore();
    store.projectRunnerEvent(
      transport(
        event({
          kind: 'log',
          eventId: 'event-log-1',
          sequence: 1,
          stream: 'stdout',
          chunk: 'local-only source excerpt',
        }),
      ),
    );
    store.projectRunnerEvent(
      transport(
        event({
          kind: 'metric',
          eventId: 'event-metric-1',
          sequence: 2,
          metricKey: 'accuracy',
          value: 0.5,
          step: 1,
          isSummary: false,
        }),
      ),
    );

    expect(store.listRunSummaries('project-vision')[0]).toMatchObject({
      attemptId: 'attempt-1',
      metrics: {},
      lastSequence: 2,
    });
    expect(JSON.stringify(store.listRunSummaries('project-vision'))).not.toContain(
      'local-only source excerpt',
    );
  });

  it('retains only metrics explicitly marked as summaries', () => {
    const store = new SyncStore();
    store.projectRunnerEvent(
      transport(
        event({
          kind: 'metric',
          eventId: 'event-metric-2',
          sequence: 1,
          metricKey: 'accuracy',
          value: 0.874,
          step: 18,
          isSummary: true,
        }),
      ),
    );
    expect(store.listRunSummaries('project-vision')[0]?.metrics).toEqual({ accuracy: 0.874 });
  });

  it('tracks sequence and deduplication independently for each attempt', () => {
    const store = new SyncStore();
    const first = transport(
      event({ kind: 'state', eventId: 'event-a', sequence: 3, state: 'running' }),
    );
    const secondAttempt = transport(
      event({
        kind: 'state',
        eventId: 'event-b',
        sequence: 0,
        state: 'leased',
        attemptId: 'attempt-2',
      }),
    );

    expect(store.projectRunnerEvent(first).disposition).toBe('accepted');
    expect(store.projectRunnerEvent(first).disposition).toBe('deduplicated');
    expect(store.projectRunnerEvent(secondAttempt).disposition).toBe('accepted');
    expect(
      store.projectRunnerEvent(
        transport(event({ kind: 'state', eventId: 'event-c', sequence: 2, state: 'leased' })),
      ).disposition,
    ).toBe('stale');
    expect(store.listRunSummaries('project-vision')).toHaveLength(2);
  });

  it('scopes event identifiers to the runner within a project', () => {
    const store = new SyncStore();
    const first = transport(
      event({ kind: 'state', eventId: 'event-1', sequence: 1, state: 'running' }),
    );
    const second = transport(
      event({
        kind: 'state',
        eventId: 'event-1',
        sequence: 1,
        state: 'running',
        runnerId: 'runner-2',
        attemptId: 'attempt-2',
      }),
    );

    expect(store.projectRunnerEvent(first).disposition).toBe('accepted');
    expect(store.projectRunnerEvent(second).disposition).toBe('accepted');
  });

  it('requires optimistic versions and idempotency when locking an objective', () => {
    const store = new SyncStore();
    const objective = store.putObjective('project-vision', 'researcher-fixture', {
      goal: 'Improve validation accuracy with a fixed evaluator',
      expectedVersion: 0,
      idempotencyKey: '00000000-0000-4000-8000-000000000006',
    });
    expect(objective.version).toBe(1);

    expect(() =>
      store.putObjective('project-vision', 'researcher-fixture', {
        goal: 'A stale replacement objective must not be accepted',
        expectedVersion: 0,
        idempotencyKey: '00000000-0000-4000-8000-000000000007',
      }),
    ).toThrow();

    const command = {
      expectedVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000008',
    };
    const locked = store.lockObjective('project-vision', 'lead-fixture', command);
    expect(store.lockObjective('project-vision', 'lead-fixture', command)).toEqual(locked);
    expect(() =>
      store.lockObjective('project-vision', 'lead-fixture', {
        expectedVersion: 1,
        idempotencyKey: '00000000-0000-4000-8000-000000000099',
      }),
    ).toThrow();
  });

  it('makes project creation idempotent within a lab', () => {
    const store = new SyncStore();
    const command = {
      name: 'Second project',
      slug: 'second-project',
      idempotencyKey: '00000000-0000-4000-8000-000000000009',
    };
    const first = store.createProject('lab-demo', 'owner-fixture', command);
    const replay = store.createProject('lab-demo', 'owner-fixture', command);
    expect(replay).toEqual(first);
  });

  it('scopes idempotency records to a project', () => {
    const store = new SyncStore();
    const second = store.createProject('lab-demo', 'owner-fixture', {
      name: 'Second project',
      slug: 'second-project',
      idempotencyKey: '00000000-0000-4000-8000-000000000009',
    });
    const idempotencyKey = '00000000-0000-4000-8000-000000000010';

    const firstTask = store.createTask('project-vision', 'researcher-fixture', {
      title: 'Project one task',
      status: 'backlog',
      idempotencyKey,
    });
    const secondTask = store.createTask(second.id, 'researcher-fixture', {
      title: 'Project two task',
      status: 'backlog',
      idempotencyKey,
    });

    expect(firstTask.projectId).toBe('project-vision');
    expect(secondTask.projectId).toBe(second.id);
    expect(secondTask.id).not.toBe(firstTask.id);
  });

  it('rejects an idempotency key reused with a different command', () => {
    const store = new SyncStore();
    const idempotencyKey = '00000000-0000-4000-8000-000000000011';
    store.createTask('project-vision', 'researcher-fixture', {
      title: 'Original task',
      status: 'backlog',
      idempotencyKey,
    });

    expect(() =>
      store.createTask('project-vision', 'researcher-fixture', {
        title: 'Different task',
        status: 'backlog',
        idempotencyKey,
      }),
    ).toThrowError(/Conflict/);
  });

  it('rejects credential-like visible chat before retaining it', () => {
    const store = new SyncStore();

    expect(() =>
      store.appendChat('researcher-fixture', {
        projectId: 'project-vision',
        role: 'user',
        content: 'Authorization: Bearer fixturecredentialvalue1234567890',
        idempotencyKey: '00000000-0000-4000-8000-000000000012',
      }),
    ).toThrowError(/Bad Request/);
    expect(store.listChats('project-vision')).toEqual([]);
  });
});
