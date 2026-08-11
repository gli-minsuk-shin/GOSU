import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  buildObjectiveInput,
  ObjectiveEditor,
  type ObjectiveDraft,
} from '../src/renderer/src/workspace-views';
import type { ProjectRecord, WorkspaceObjective } from '../src/shared/workspace-contracts';

const project: ProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Optional target lab',
  slug: 'optional-target-lab',
  version: 1,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
};

function objective(target: number | null, stopWhenTargetReached: boolean): WorkspaceObjective {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    projectId: project.id,
    objectiveVersion: 1,
    entityVersion: 1,
    locked: false,
    goal: 'Measure reproducible progress without requiring a target threshold.',
    primaryMetric: {
      key: 'validation-loss',
      displayName: 'Validation loss',
      direction: 'minimize',
      unit: null,
      aggregation: 'minimum',
      evaluatorHash: 'sha256:evaluator',
      datasetHash: 'sha256:dataset',
      holdoutHash: null,
      baseline: null,
      target,
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
      stopWhenTargetReached,
      guardrailAction: 'pause',
      maxConsecutiveNoImprovement: null,
    },
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
  };
}

function draft(overrides: Partial<ObjectiveDraft> = {}): ObjectiveDraft {
  return {
    goal: 'Measure reproducible progress without requiring a target threshold.',
    metricKey: 'validation-loss',
    metricDisplayName: 'Validation loss',
    direction: 'minimize',
    unit: '',
    aggregation: 'minimum',
    evaluatorHash: 'sha256:evaluator',
    datasetHash: 'sha256:dataset',
    holdoutHash: '',
    baseline: '',
    target: '',
    maxTrials: '10',
    maxConcurrentTrials: '1',
    maxWallTimeSeconds: '3600',
    maxGpuHours: '0',
    maxFailures: '3',
    stopWhenTargetReached: true,
    guardrailAction: 'pause',
    maxConsecutiveNoImprovement: '',
    ...overrides,
  };
}

function stopCheckbox(html: string) {
  const markup = html.match(/<input[^>]*id="objective-stop-when-target-reached"[^>]*>/u)?.[0];
  expect(markup).toBeDefined();
  return markup!;
}

describe('ObjectiveEditor optional target', () => {
  it('shows target-based stopping unchecked and disabled when Target is blank', () => {
    const html = renderToStaticMarkup(
      <ObjectiveEditor
        project={project}
        objective={undefined}
        busy={false}
        onSave={vi.fn()}
        onLock={vi.fn()}
        onStartVersion={vi.fn()}
      />,
    );

    expect(stopCheckbox(html)).toContain('disabled=""');
    expect(stopCheckbox(html)).not.toContain('checked=""');
    expect(html).toContain(
      'No target is set, so exploratory and comparable runs can still proceed',
    );
    expect(html).toContain('current Project Chat path only enforces its per-run timeout');
  });

  it('enables target-based stopping after a Target value is present', () => {
    const html = renderToStaticMarkup(
      <ObjectiveEditor
        project={project}
        objective={objective(0.1, false)}
        busy={false}
        onSave={vi.fn()}
        onLock={vi.fn()}
        onStartVersion={vi.fn()}
      />,
    );

    expect(stopCheckbox(html)).not.toContain('disabled=""');
    expect(html).toContain('The Runner applies this policy when it schedules campaign trials.');
  });

  it('persists target-based stopping as false whenever Target is blank', () => {
    const input = buildObjectiveInput(project.id, undefined, draft());

    expect(input.primaryMetric.target).toBeNull();
    expect(input.stopPolicy.stopWhenTargetReached).toBe(false);
  });

  it('preserves the user choice when a finite Target is present', () => {
    const input = buildObjectiveInput(
      project.id,
      undefined,
      draft({ target: '0.1', stopWhenTargetReached: true }),
    );

    expect(input.primaryMetric.target).toBe(0.1);
    expect(input.stopPolicy.stopWhenTargetReached).toBe(true);
  });

  it('renders a contradictory legacy draft safely without changing its stored record', () => {
    const html = renderToStaticMarkup(
      <ObjectiveEditor
        project={project}
        objective={objective(null, true)}
        busy={false}
        onSave={vi.fn()}
        onLock={vi.fn()}
        onStartVersion={vi.fn()}
      />,
    );

    expect(stopCheckbox(html)).toContain('disabled=""');
    expect(stopCheckbox(html)).not.toContain('checked=""');
  });
});
