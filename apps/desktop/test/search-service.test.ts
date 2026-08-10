import { describe, expect, it } from 'vitest';

import type { SearchHit } from '../src/shared/search-contracts';
import type { WorkspaceSnapshot } from '../src/shared/workspace-contracts';
import { SearchService, matchFields } from '../src/main/search-service';

const PROJECT_A = '00000000-0000-4000-8000-000000000001';
const PROJECT_B = '00000000-0000-4000-8000-000000000002';
const TASK_A = '00000000-0000-4000-8000-000000000011';
const OBJECTIVE_A = '00000000-0000-4000-8000-000000000021';
const SESSION_A = '00000000-0000-4000-8000-000000000031';
const MESSAGE_A = '00000000-0000-4000-8000-000000000041';

const snapshot: WorkspaceSnapshot = {
  schemaVersion: 1,
  revision: 1,
  projects: [
    {
      id: PROJECT_A,
      name: '표 모델 연구',
      slug: 'table-model',
      version: 1,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    },
    {
      id: PROJECT_B,
      name: 'Trashed work',
      slug: 'trashed-work',
      trashedAt: '2026-08-08T00:00:00.000Z',
      version: 2,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    },
  ],
  tasks: [
    {
      id: TASK_A,
      projectId: PROJECT_A,
      title: 'Tabular baseline 재현',
      description: '표 데이터셋에서 기준 성능을 검증한다.',
      status: 'planned',
      labels: ['baseline'],
      version: 1,
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
  ],
  objectives: [
    {
      id: OBJECTIVE_A,
      projectId: PROJECT_A,
      objectiveVersion: 1,
      entityVersion: 1,
      locked: false,
      goal: '표 데이터 예측 정확도를 안정적으로 개선한다.',
      primaryMetric: {
        key: 'accuracy',
        displayName: 'Holdout accuracy',
        direction: 'maximize',
        unit: '%',
        aggregation: 'mean',
        evaluatorHash: 'a'.repeat(64),
        datasetHash: 'b'.repeat(64),
        holdoutHash: 'c'.repeat(64),
        baseline: 0.5,
        target: 0.7,
      },
      guardrails: [],
      budget: {
        maxTrials: 10,
        maxConcurrentTrials: 2,
        maxWallTimeSeconds: 3600,
        maxGpuHours: 2,
        maxFailures: 3,
      },
      stopPolicy: {
        stopWhenTargetReached: true,
        guardrailAction: 'pause',
        maxConsecutiveNoImprovement: null,
      },
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    },
  ],
};

function chatHit(projectName = '표 모델 연구'): SearchHit {
  return {
    id: `chat:${MESSAGE_A}`,
    category: 'project-chat',
    projectId: PROJECT_A,
    projectName,
    title: 'Baseline discussion',
    snippet: 'tabular baseline discussion',
    updatedAt: '2026-08-10T00:00:00.000Z',
    matchedFields: ['content'],
    target: { kind: 'project-chat', sessionId: SESSION_A, messageId: MESSAGE_A },
  };
}

describe('SearchService', () => {
  it('groups Korean and ASCII matches by tab and excludes trashed projects', async () => {
    const seenProjectIds: string[][] = [];
    const service = new SearchService({
      workspace: { snapshot: () => snapshot },
      application: {
        search: (input) => {
          seenProjectIds.push([...input.projectIds]);
          return {
            hits: [chatHit(), { ...chatHit('Trashed work'), projectId: PROJECT_B }],
            reports: [],
          };
        },
      },
      now: () => new Date('2026-08-10T01:00:00.000Z'),
    });

    const result = await service.search({
      query: 'baseline',
      scope: { kind: 'global' },
      categories: ['project-chat', 'board', 'goal-metrics'],
      limitPerCategory: 20,
    });

    expect(seenProjectIds).toEqual([[PROJECT_A]]);
    expect(result.groups.map((group) => group.category)).toEqual([
      'project-chat',
      'goal-metrics',
      'board',
    ]);
    expect(result.groups.find((group) => group.category === 'project-chat')?.items).toHaveLength(1);
    expect(result.groups.find((group) => group.category === 'board')?.items[0]?.title).toBe(
      'Tabular baseline 재현',
    );
  });

  it('requires every normalized query token across searchable fields', () => {
    expect(matchFields('표 정확도', { title: '표 기반 모델', body: '정확도 개선' })).toEqual({
      fields: ['title', 'body'],
      snippet: '표 기반 모델',
    });
    expect(matchFields('표 손실', { title: '표 기반 모델', body: '정확도 개선' })).toBeNull();
  });

  it('indexes only the currently displayed objective and includes its metric policy fields', async () => {
    const currentObjectiveId = '00000000-0000-4000-8000-000000000022';
    const objectiveSnapshot: WorkspaceSnapshot = {
      ...snapshot,
      objectives: [
        {
          ...snapshot.objectives[0]!,
          goal: 'Obsolete objective phrase retained only as historical provenance.',
        },
        {
          ...snapshot.objectives[0]!,
          id: currentObjectiveId,
          objectiveVersion: 2,
          goal: 'Improve the current robust table benchmark without regressions.',
          primaryMetric: {
            ...snapshot.objectives[0]!.primaryMetric,
            baseline: 0.61,
            target: 0.8,
          },
          guardrails: [{ metricKey: 'latency_ms', operator: 'lte', threshold: 120 }],
          budget: {
            maxTrials: 40,
            maxConcurrentTrials: 4,
            maxWallTimeSeconds: 72_000,
            maxGpuHours: 12,
            maxFailures: 6,
          },
          stopPolicy: {
            stopWhenTargetReached: true,
            guardrailAction: 'pause',
            maxConsecutiveNoImprovement: 5,
          },
          updatedAt: '2026-08-10T02:00:00.000Z',
        },
      ],
    };
    const service = new SearchService({ workspace: { snapshot: () => objectiveSnapshot } });

    const historical = await service.search({
      query: 'obsolete objective phrase',
      scope: { kind: 'project', projectId: PROJECT_A },
      categories: ['goal-metrics'],
      limitPerCategory: 20,
    });
    expect(historical.groups[0]?.items).toEqual([]);

    for (const query of [
      'baseline 0.61',
      'target 0.8',
      'latency_ms lte 120',
      'GPU hours 12',
      'no improvement 5',
    ]) {
      const current = await service.search({
        query,
        scope: { kind: 'project', projectId: PROJECT_A },
        categories: ['goal-metrics'],
        limitPerCategory: 20,
      });
      expect(current.groups[0]?.items).toMatchObject([
        {
          target: {
            kind: 'objective',
            objectiveId: currentObjectiveId,
            objectiveVersion: 2,
          },
        },
      ]);
    }
  });

  it('isolates project-scoped queries and rejects trashed projects', async () => {
    const service = new SearchService({ workspace: { snapshot: () => snapshot } });
    await expect(
      service.search({
        query: 'accuracy',
        scope: { kind: 'project', projectId: PROJECT_A },
        limitPerCategory: 20,
      }),
    ).resolves.toMatchObject({ scope: { kind: 'project', projectId: PROJECT_A } });
    await expect(
      service.search({
        query: 'anything',
        scope: { kind: 'project', projectId: PROJECT_B },
        limitPerCategory: 20,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'search_project_not_found',
      }),
    );
  });

  it('keeps healthy result groups available when one local source fails', async () => {
    const service = new SearchService({
      workspace: { snapshot: () => snapshot },
      researchNotes: { search: () => Promise.reject(new Error('private-path-do-not-leak')) },
    });
    const result = await service.search({
      query: 'baseline',
      scope: { kind: 'global' },
      categories: ['board', 'research-notes'],
      limitPerCategory: 20,
    });
    expect(result.groups.find((group) => group.category === 'board')?.items).toHaveLength(1);
    expect(
      result.groups.find((group) => group.category === 'research-notes')?.unavailableReason,
    ).toBe('This local source could not be searched. Other sections remain available.');
    expect(result.groups.find((group) => group.category === 'research-notes')?.incomplete).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toContain('private-path');
  });

  it('returns healthy groups when a local source times out', async () => {
    const service = new SearchService({
      workspace: { snapshot: () => snapshot },
      researchNotes: { search: () => new Promise(() => undefined) },
      sourceTimeoutMs: 10,
    });
    const result = await service.search({
      query: 'baseline',
      scope: { kind: 'global' },
      categories: ['board', 'research-notes'],
      limitPerCategory: 20,
    });
    expect(result.groups.find((group) => group.category === 'board')?.items).toHaveLength(1);
    expect(result.groups.find((group) => group.category === 'research-notes')).toMatchObject({
      incomplete: true,
      unavailableReason:
        'This local source took too long to search. Other sections remain available.',
    });
  });

  it('propagates a scoped deadline and keeps cooperative partial hits on timeout', async () => {
    let receivedDeadline = 0;
    let receivedSignal: AbortSignal | undefined;
    const service = new SearchService({
      workspace: { snapshot: () => snapshot },
      application: {
        search: ({ signal, deadlineAt }) => {
          receivedSignal = signal;
          receivedDeadline = deadlineAt ?? 0;
          return new Promise((resolve) => {
            signal?.addEventListener(
              'abort',
              () =>
                resolve({
                  hits: [chatHit()],
                  reports: [
                    {
                      category: 'project-chat',
                      truncated: true,
                      incomplete: true,
                      unavailableReason:
                        'Conversation search reached its time limit. Available messages are still shown.',
                    },
                  ],
                }),
              { once: true },
            );
          });
        },
      },
      sourceTimeoutMs: 10,
    });

    const result = await service.search({
      query: 'baseline',
      scope: { kind: 'global' },
      categories: ['project-chat'],
      limitPerCategory: 20,
    });

    expect(receivedSignal?.aborted).toBe(true);
    expect(receivedDeadline).toBeGreaterThan(0);
    expect(result.groups[0]).toMatchObject({
      items: [{ id: `chat:${MESSAGE_A}` }],
      truncated: true,
      incomplete: true,
      unavailableReason:
        'Conversation search reached its time limit. Available messages are still shown.',
    });
  });

  it('does not stack a source that ignored cancellation on repeated searches', async () => {
    let calls = 0;
    let receivedSignal: AbortSignal | undefined;
    const source = {
      search: ({ signal }: { signal?: AbortSignal }) => {
        calls += 1;
        receivedSignal = signal;
        return new Promise<never>(() => undefined);
      },
    };
    const service = new SearchService({
      workspace: { snapshot: () => snapshot },
      researchNotes: source,
      sourceTimeoutMs: 10,
    });
    const command = {
      query: 'baseline',
      scope: { kind: 'global' as const },
      categories: ['research-notes' as const],
      limitPerCategory: 20,
    };

    const first = await service.search(command);
    const second = await service.search(command);

    expect(calls).toBe(1);
    expect(receivedSignal?.aborted).toBe(true);
    expect(first.groups[0]?.unavailableReason).toContain('took too long');
    expect(second.groups[0]?.unavailableReason).toContain('previous local search');
  });

  it('propagates structured partial-source warnings without dropping healthy hits', async () => {
    const service = new SearchService({
      workspace: { snapshot: () => snapshot },
      application: {
        search: () => ({
          hits: [chatHit()],
          reports: [
            {
              category: 'project-chat',
              truncated: true,
              incomplete: true,
              unavailableReason: 'Some conversations could not be searched.',
            },
          ],
        }),
      },
    });
    const result = await service.search({
      query: 'baseline',
      scope: { kind: 'global' },
      categories: ['project-chat'],
      limitPerCategory: 20,
    });
    expect(result.groups[0]).toMatchObject({
      truncated: true,
      incomplete: true,
      unavailableReason: 'Some conversations could not be searched.',
      items: [{ id: `chat:${MESSAGE_A}` }],
    });
  });
});
