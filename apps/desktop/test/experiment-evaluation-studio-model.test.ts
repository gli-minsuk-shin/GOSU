import { describe, expect, it } from 'vitest';

import {
  buildEvaluationLoggingReview,
  currentEvaluationDetail,
  currentEvaluationSnapshot,
  isCurrentEvaluationOperation,
  isCurrentEvaluationRequest,
} from '../src/renderer/src/experiment-evaluation-studio-model';
import type {
  ExperimentEvaluationListSnapshot,
  ExperimentEvaluationSessionDetail,
} from '../src/shared/experiment-evaluation-contracts';
import type { ExperimentLoggingCustomField } from '../src/shared/experiment-workspace-contracts';

function field(
  key: string,
  label: string,
  requiredAt: ExperimentLoggingCustomField['requiredAt'] = ['summary'],
): ExperimentLoggingCustomField {
  return {
    key,
    label,
    type: 'number',
    category: 'metric',
    requiredAt,
    unit: null,
  };
}

describe('Experiment Evaluation Studio state model', () => {
  it('discards list, detail, and mutation continuations from a previous project or request', () => {
    expect(isCurrentEvaluationOperation('project-b', 'project-a')).toBe(false);
    expect(isCurrentEvaluationOperation('project-b', 'project-b')).toBe(true);
    expect(isCurrentEvaluationRequest('project-b', 'project-a', 2, 2)).toBe(false);
    expect(isCurrentEvaluationRequest('project-b', 'project-b', 1, 2)).toBe(false);
    expect(isCurrentEvaluationRequest('project-b', 'project-b', 2, 2)).toBe(true);
  });

  it('hides stale project and session payloads while replacement requests are pending', () => {
    const projectA = '11111111-1111-4111-8111-111111111111';
    const projectB = '22222222-2222-4222-8222-222222222222';
    const sessionA = '33333333-3333-4333-8333-333333333333';
    const sessionB = '44444444-4444-4444-8444-444444444444';
    const session = {
      schemaVersion: 1 as const,
      id: sessionA,
      projectId: projectA,
      title: 'Evaluation A',
      status: 'draft' as const,
      activeAttemptId: null,
      currentRevision: 0,
      acceptedProfileId: null,
      version: 1,
      lastErrorCode: null,
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    };
    const snapshot: ExperimentEvaluationListSnapshot = {
      schemaVersion: 1,
      projectId: projectA,
      sessions: [session],
      profiles: [],
    };
    const detail: ExperimentEvaluationSessionDetail = {
      schemaVersion: 1,
      session,
      messages: [],
      currentRevision: null,
    };

    expect(currentEvaluationSnapshot(snapshot, projectA)).toBe(snapshot);
    expect(currentEvaluationSnapshot(snapshot, projectB)).toBeNull();
    expect(currentEvaluationDetail(detail, projectA, sessionA)).toBe(detail);
    expect(currentEvaluationDetail(detail, projectA, sessionB)).toBeNull();
    expect(currentEvaluationDetail(detail, projectB, sessionA)).toBeNull();
    expect(currentEvaluationDetail(detail, projectA, null)).toBeNull();
  });

  it('keeps conflicting logging definitions untouched until replacement is explicit', () => {
    const current = [field('loss', 'Training loss'), field('seed', 'Seed')];
    const suggestions = [
      field('loss', 'Validation loss', ['progress', 'summary']),
      field('seed', 'Seed'),
      field('accuracy', 'Accuracy'),
    ];

    const reviewed = buildEvaluationLoggingReview(current, suggestions, false);
    expect(reviewed.added.map((candidate) => candidate.key)).toEqual(['accuracy']);
    expect(reviewed.unchanged.map((candidate) => candidate.key)).toEqual(['seed']);
    expect(reviewed.conflicts.map(({ suggested }) => suggested.key)).toEqual(['loss']);
    expect(reviewed.changeCount).toBe(1);
    expect(reviewed.mergedFields.find((candidate) => candidate.key === 'loss')?.label).toBe(
      'Training loss',
    );

    const consented = buildEvaluationLoggingReview(current, suggestions, true);
    expect(consented.changeCount).toBe(2);
    expect(consented.mergedFields.find((candidate) => candidate.key === 'loss')?.label).toBe(
      'Validation loss',
    );
  });
});
