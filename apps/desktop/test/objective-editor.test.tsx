import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

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
it('treats target-only edits as dirty, blocking freeze and preserving them on plan replacement', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let ui!: ReactTestRenderer;
  const props = { project, busy: false, onSave: vi.fn(), onLock: vi.fn(), onStartVersion: vi.fn() };
  try {
    await act(() => {
      ui = create(<ObjectiveEditor {...props} objective={objective(0.5, true)} />);
    });
    const target = () =>
      ui.root
        .findAllByType('input')
        .find((n) => n.props.type === 'number' && n.props.value === '0.5')!;
    await act(() => target().props.onChange({ target: { value: '0.6' } }));
    expect(
      ui.root.findAllByType('button').find((b) => b.children.join('') === 'Freeze local revision')!
        .props.disabled,
    ).toBe(true);
    await act(() =>
      ui.update(
        <ObjectiveEditor
          {...props}
          objective={{ ...objective(0.7, true), id: '44444444-4444-4444-8444-444444444444' }}
        />,
      ),
    );
    expect(ui.root.findAllByType('input').some((n) => n.props.value === '0.6')).toBe(true);
    expect(JSON.stringify(ui.toJSON())).toContain('Your unsaved draft is preserved');
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});
it('preserves an unsaved goal when a plan arrives, blocks stale writes and reloads only on an explicit discard', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let ui!: ReactTestRenderer;
  const onSave = vi.fn(async () => true),
    onLock = vi.fn(async () => true),
    onStartVersion = vi.fn(async () => true);
  const first = objective(null, false),
    incoming = {
      ...objective(null, false),
      id: '33333333-3333-4333-8333-333333333333',
      objectiveVersion: 2,
      goal: 'The new plan goal from Project Chat is safely stored.',
    };
  const props = { project, busy: false, onSave, onLock, onStartVersion };
  try {
    await act(() => {
      ui = create(<ObjectiveEditor {...props} objective={first} />);
    });
    await act(() =>
      ui.root
        .findByType('textarea')
        .props.onChange({ target: { value: 'My unsaved manual goal is not disposable.' } }),
    );
    await act(() => ui.update(<ObjectiveEditor {...props} objective={incoming} />));
    expect(ui.root.findByType('textarea').props.value).toBe(
      'My unsaved manual goal is not disposable.',
    );
    expect(JSON.stringify(ui.toJSON())).toContain('Your unsaved draft is preserved');
    expect(ui.root.findByProps({ type: 'submit' }).props.disabled).toBe(true);
    await act(() => ui.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    expect(onSave).not.toHaveBeenCalled();
    await act(() =>
      ui.root
        .findAllByType('button')
        .find((b) => b.children.join('') === 'Discard draft and load latest')!
        .props.onClick(),
    );
    expect(ui.root.findByType('textarea').props.value).toBe(incoming.goal);
    await act(() => ui.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedObjectiveId: incoming.id,
        expectedObjectiveVersion: 2,
        expectedEntityVersion: 1,
      }),
    );
    expect(onLock).not.toHaveBeenCalled();
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});
it('automatically displays a new plan when the goal editor has no unsaved changes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let ui!: ReactTestRenderer;
  const props = { project, busy: false, onSave: vi.fn(), onLock: vi.fn(), onStartVersion: vi.fn() };
  try {
    await act(() => {
      ui = create(<ObjectiveEditor {...props} objective={undefined} />);
    });
    const incoming = objective(null, false);
    await act(() => ui.update(<ObjectiveEditor {...props} objective={incoming} />));
    expect(ui.root.findByType('textarea').props.value).toBe(incoming.goal);
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});
it('shows a saved pending plan and disables Freeze until evaluator/data identities are supplied', () => {
  const base = objective(null, false);
  const pending = {
    ...base,
    primaryMetric: { ...base.primaryMetric, datasetHash: 'pending:dataset:fixture' },
  };
  const html = renderToStaticMarkup(
    <ObjectiveEditor
      project={project}
      objective={pending}
      busy={false}
      onSave={vi.fn()}
      onLock={vi.fn()}
      onStartVersion={vi.fn()}
    />,
  );
  expect(html).toContain('pending:dataset:fixture');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Freeze local revision<\/button>/);
  expect(html).toContain('Plan saved. Supply evaluator and dataset identities');
});

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
