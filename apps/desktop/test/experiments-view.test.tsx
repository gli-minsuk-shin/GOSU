import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  buildExperimentLoggingExample,
  ExperimentLoggingPanel,
  ExperimentRunsPanel,
  ExperimentsView,
  formatExperimentRunProgress,
  summarizeExperimentRuns,
  type ExperimentsViewAdapter,
  validateExperimentLoggingFields,
} from '../src/renderer/src/experiments-view';
import type { ExperimentEvaluationStudioAdapter } from '../src/renderer/src/experiment-evaluation-studio-view';
import {
  EXPERIMENT_LOGGING_SYSTEM_FIELDS,
  EXPERIMENT_MAX_LOGGING_FIELDS,
  type ExperimentLoggingCustomField,
  type ExperimentLoggingTemplate,
  type ExperimentRun,
} from '../src/shared/experiment-workspace-contracts';
import type { ProjectRecord } from '../src/shared/workspace-contracts';

const project: ProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Trajectory Lab',
  slug: 'trajectory-lab',
  version: 1,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

const adapter: ExperimentsViewAdapter = {
  list: vi.fn(),
  createIdea: vi.fn(),
  updateIdea: vi.fn(),
  recordMetric: vi.fn(),
  reviseLoggingTemplate: vi.fn(),
  onEvent: vi.fn(() => () => undefined),
};

const evaluationAdapter: ExperimentEvaluationStudioAdapter = {
  list: vi.fn(),
  detail: vi.fn(),
  createSession: vi.fn(),
  send: vi.fn(),
  cancel: vi.fn(),
  approve: vi.fn(),
  reuseProfile: vi.fn(),
  onEvent: vi.fn(() => () => undefined),
};

const customField: ExperimentLoggingCustomField = {
  key: 'loss',
  label: 'Validation loss',
  type: 'number',
  category: 'metric',
  requiredAt: ['progress', 'summary'],
  unit: null,
};

const loggingTemplate: ExperimentLoggingTemplate = {
  schemaVersion: 1,
  id: '22222222-2222-4222-8222-222222222222',
  projectId: project.id,
  version: 3,
  previousRevisionId: '33333333-3333-4333-8333-333333333333',
  systemFields: EXPERIMENT_LOGGING_SYSTEM_FIELDS,
  customFields: [customField],
  templateHash: 'a'.repeat(64),
  createdAt: '2026-08-06T00:00:00.000Z',
};

const runningRun: ExperimentRun = {
  schemaVersion: 1,
  id: '44444444-4444-4444-8444-444444444444',
  projectId: project.id,
  ideaId: null,
  title: 'Exploratory baseline',
  status: 'running',
  mode: 'exploratory',
  serverLabel: 'gpu-lab',
  trialId: 'trial-7',
  objectiveId: null,
  objectiveVersion: null,
  loggingTemplate: {
    revisionId: loggingTemplate.id,
    version: loggingTemplate.version,
    systemFields: loggingTemplate.systemFields,
    customFields: loggingTemplate.customFields,
    templateHash: loggingTemplate.templateHash,
  },
  progressCurrent: 7,
  progressTotal: null,
  currentStep: 'Loading validation split',
  latestMetric: {
    key: 'loss',
    displayName: 'Validation loss',
    value: 0.875,
    unit: null,
    recordedAt: '2026-08-06T00:07:00.000Z',
  },
  logReference: {
    referenceId: '55555555-5555-4555-8555-555555555555',
    displayName: 'trial-7.jsonl',
    contentHash: 'b'.repeat(64),
    sizeBytes: 2048,
    validationState: 'incomplete',
    missingFields: ['loss'],
  },
  processExitCode: null,
  processDurationMs: null,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:07:00.000Z',
  startedAt: '2026-08-06T00:01:00.000Z',
  completedAt: null,
  version: 2,
};

const verifyingRun: ExperimentRun = {
  ...runningRun,
  id: '66666666-6666-4666-8666-666666666666',
  title: 'Verifying experiment receipt',
  status: 'verifying',
  currentStep: 'Validating required JSONL fields',
  logReference: {
    ...runningRun.logReference!,
    referenceId: '77777777-7777-4777-8777-777777777777',
    displayName: 'trial-verify.jsonl',
    validationState: 'pending',
    missingFields: [],
  },
  processExitCode: 0,
  processDurationMs: 12_345,
  updatedAt: '2026-08-06T00:08:00.000Z',
  version: 3,
};

describe('ExperimentsView', () => {
  it('exposes a stop action while the Experiment Assistant is responding', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/experiment-evaluation-studio-view.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("busy === 'send'");
    expect(source).toContain("'Stop response'");
    expect(source).toContain('adapter.cancel');
  });

  it('labels local immediacy and missing Runner streaming truthfully', () => {
    const html = renderToStaticMarkup(
      <ExperimentsView
        project={project}
        objective={undefined}
        adapter={adapter}
        evaluationAdapter={evaluationAdapter}
        requestedModelId={null}
        reasoningOptionId={null}
        onOpenObjective={vi.fn()}
      />,
    );

    expect(html).toContain('Local live');
    expect(html).toContain('Runner not connected');
    expect(html).toContain('No objective — exploratory runs remain available');
    expect(html).toContain('A numeric target value is optional');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('Overview');
    expect(html).toContain('Runs');
    expect(html).toContain('Evaluation studio');
    expect(html).toContain('Logging');
    expect(html).toContain('Idea map');
    expect(html).toContain('Report');
    expect(html).not.toContain('83.6');
    expect(html).not.toContain('Demo');
  });

  it('reports run progress honestly when a total was not received', () => {
    const html = renderToStaticMarkup(
      <ExperimentRunsPanel projectId={project.id} ideas={[]} runs={[runningRun]} />,
    );

    expect(formatExperimentRunProgress(runningRun)).toBe('7 · total not reported');
    expect(formatExperimentRunProgress({ ...runningRun, progressTotal: 10 })).toBe('7 / 10 (70%)');
    expect(summarizeExperimentRuns([runningRun])).toEqual({
      active: 1,
      queued: 0,
      completed: 0,
      needsAttention: 0,
    });
    expect(html).toContain('7 · total not reported');
    expect(html).not.toContain('7%');
    expect(html).toContain('Loading validation split');
    expect(html).toContain('Incomplete · missing loss');
    expect(html).toContain('trial-7.jsonl · 2.0 KB');
    expect(html).toContain('Raw log opening is not connected in this build.');
    expect(html).toContain('disabled=""');
  });

  it('does not add a demonstration row when a project has no tracked runs', () => {
    const html = renderToStaticMarkup(
      <ExperimentRunsPanel projectId={project.id} ideas={[]} runs={[]} />,
    );

    expect(html).toContain('No tracked runs');
    expect(html).not.toContain('gpu-lab');
    expect(html).not.toContain('trial-7');
  });

  it('counts verification as active and shows its compact process receipt', () => {
    const html = renderToStaticMarkup(
      <ExperimentRunsPanel projectId={project.id} ideas={[]} runs={[verifyingRun]} />,
    );

    expect(summarizeExperimentRuns([verifyingRun])).toEqual({
      active: 1,
      queued: 0,
      completed: 0,
      needsAttention: 0,
    });
    expect(html).toContain('Verifying');
    expect(html).toContain('Validating required JSONL fields');
    expect(html).toContain('Exit 0 · 12 sec process');
    const button = html.match(/<button[^>]*>Open log<\/button>/u)?.[0];
    expect(button).toContain('disabled=""');
    expect(html).toContain('log verification has not finished');
  });

  it('enables on-demand log viewing only when the bounded reader is connected', () => {
    const html = renderToStaticMarkup(
      <ExperimentRunsPanel
        projectId={project.id}
        ideas={[]}
        runs={[runningRun]}
        readRunLog={vi.fn()}
      />,
    );
    const button = html.match(/<button[^>]*>Open log<\/button>/u)?.[0];

    expect(button).toBeDefined();
    expect(button).not.toContain('disabled=""');
    expect(html).toContain('GOSU reads it into this view only on demand');
  });

  it('shows locked system logging fields and a deterministic current-template example', () => {
    const first = buildExperimentLoggingExample(loggingTemplate);
    const second = buildExperimentLoggingExample(loggingTemplate);
    const html = renderToStaticMarkup(
      <ExperimentLoggingPanel
        template={loggingTemplate}
        busy={false}
        onSave={vi.fn(async () => true)}
      />,
    );

    expect(first).toBe(second);
    const records = first.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({
      schema_version: 1,
      template_version: 3,
      event_type: 'run-start',
    });
    expect(records[1]).toMatchObject({
      event_type: 'progress',
      loss: 0.875,
    });
    expect(records[2]).toMatchObject({ event_type: 'run-end', status: 'succeeded' });
    expect(records[3]).toMatchObject({ event_type: 'summary', status: 'succeeded' });
    expect(html).toContain('Always present and locked');
    expect(html).toContain('schema_version');
    expect(html).toContain('Example only — not an actual run');
    expect(html).toContain('CURRENT TEMPLATE · VERSION 3');
    expect(html).toContain('Save as version 4');
  });

  it('rejects duplicate keys and more than the custom-field limit', () => {
    expect(validateExperimentLoggingFields([customField, customField])).toContain(
      'Field keys must be unique: loss.',
    );
    const tooMany = Array.from({ length: EXPERIMENT_MAX_LOGGING_FIELDS + 1 }, (_, index) => ({
      ...customField,
      key: `field_${index + 1}`,
      label: `Field ${index + 1}`,
    }));
    expect(validateExperimentLoggingFields(tooMany)).toContain(
      `A template can contain at most ${EXPERIMENT_MAX_LOGGING_FIELDS} custom fields.`,
    );
  });

  it('keeps charts, graphs, run tables, and logging layouts responsive', () => {
    const styles = readFileSync(
      new URL('../src/renderer/src/experiments-view.css', import.meta.url),
      'utf8',
    );

    expect(styles).toMatch(/\.experiment-table-scroll\s*\{[^}]*overflow:\s*auto;/su);
    expect(styles).toMatch(/\.experiment-runs-table-scroll\s*\{[^}]*overflow:\s*auto;/su);
    expect(styles).toMatch(/\.experiment-log-viewer pre\s*\{[^}]*overflow:\s*auto;/su);
    expect(styles).toMatch(/\.experiment-graph-scroll\s*\{[^}]*overflow:\s*auto;/su);
    expect(styles).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.experiment-logging-layout[\s\S]*?grid-template-columns:\s*1fr;/u,
    );
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/u);
    expect(styles).toMatch(/@media print/u);
  });
});
