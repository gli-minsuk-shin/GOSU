import { describe, expect, it } from 'vitest';

import type { SearchHit } from '../src/shared/search-contracts';
import {
  consumePendingSearchNavigation,
  objectiveSearchHitIsCurrent,
  workspaceTabForSearchHit,
} from '../src/renderer/src/search-results-model';

const base = {
  id: 'hit',
  category: 'research-notes',
  projectId: '00000000-0000-4000-8000-000000000001',
  projectName: 'Research project',
  title: 'Note',
  snippet: 'match',
  updatedAt: null,
  matchedFields: ['content'],
};

describe('search result navigation', () => {
  it.each([
    [
      {
        kind: 'project-chat',
        sessionId: '00000000-0000-4000-8000-000000000002',
        messageId: '00000000-0000-4000-8000-000000000003',
      },
      'chat',
    ],
    [{ kind: 'research-note', path: 'Literature/Review.md' }, 'notes'],
    [{ kind: 'experiment', ideaId: '00000000-0000-4000-8000-000000000004' }, 'experiments'],
    [
      {
        kind: 'objective',
        objectiveId: '00000000-0000-4000-8000-000000000005',
        objectiveVersion: 2,
      },
      'objective',
    ],
    [{ kind: 'board-task', taskId: '00000000-0000-4000-8000-000000000006' }, 'board'],
    [{ kind: 'literature', recordId: '00000000-0000-4000-8000-000000000007' }, 'literature'],
    [{ kind: 'repository-file', path: 'src/model.ts' }, 'repository'],
  ] as const)('maps %s to %s', (target, tab) => {
    expect(workspaceTabForSearchHit({ ...base, target } as unknown as SearchHit)).toBe(tab);
  });

  it('only consumes the navigation request that actually completed', () => {
    const pending = {
      requestId: 8,
      hit: { ...base, target: { kind: 'research-note', path: 'Ideas/Plan.md' } } as SearchHit,
    };
    expect(consumePendingSearchNavigation(pending, 7)).toBe(pending);
    expect(consumePendingSearchNavigation(pending, 8)).toBeNull();
  });

  it('rejects stale objective hits instead of silently opening the latest version', () => {
    const stale = {
      ...base,
      category: 'goal-metrics',
      target: {
        kind: 'objective',
        objectiveId: '00000000-0000-4000-8000-000000000005',
        objectiveVersion: 1,
      },
    } as SearchHit;
    const current = {
      id: '00000000-0000-4000-8000-000000000006',
      projectId: base.projectId,
      objectiveVersion: 2,
      entityVersion: 1,
      locked: false,
      goal: 'Current objective must remain exact during navigation.',
      primaryMetric: {
        key: 'accuracy',
        displayName: 'Accuracy',
        direction: 'maximize' as const,
        unit: null,
        aggregation: 'mean' as const,
        evaluatorHash: 'evaluator-fixture',
        datasetHash: 'dataset-fixture',
        holdoutHash: null,
        baseline: null,
        target: null,
      },
      guardrails: [],
      budget: {
        maxTrials: 1,
        maxConcurrentTrials: 1,
        maxWallTimeSeconds: 60,
        maxGpuHours: 0,
        maxFailures: 0,
      },
      stopPolicy: {
        stopWhenTargetReached: false,
        guardrailAction: 'pause' as const,
        maxConsecutiveNoImprovement: null,
      },
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };

    expect(objectiveSearchHitIsCurrent(stale, [current])).toBe(false);
    expect(
      objectiveSearchHitIsCurrent(
        {
          ...stale,
          target: { kind: 'objective', objectiveId: current.id, objectiveVersion: 2 },
        },
        [current],
      ),
    ).toBe(true);
  });
});
