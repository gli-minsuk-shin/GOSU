import { describe, expect, it } from 'vitest';

import {
  EXPERIMENT_EVALUATION_MAX_DRAFT_CHARACTERS,
  EXPERIMENT_EVALUATION_MAX_OUTPUTS,
  EXPERIMENT_EVALUATION_MAX_PLOT_SERIES,
  EXPERIMENT_EVALUATION_MAX_TABLE_COLUMNS,
  EXPERIMENT_EVALUATION_OUTPUT_SCHEMA,
  ExperimentEvaluationCadenceSchema,
  ExperimentEvaluationDraftSchema,
  ExperimentEvaluationGenerationOutputSchema,
  ExperimentEvaluationOutputSchema,
  ExperimentEvaluationPreviewSchema,
  type ExperimentEvaluationDraft,
} from '../src/shared/experiment-evaluation-contracts';

function validDraft(overrides: Partial<ExperimentEvaluationDraft> = {}) {
  return {
    title: 'Validation evaluation',
    purpose: 'Measure held-out quality at a reproducible cadence.',
    cadence: { unit: 'step' as const, interval: 100, startAt: 0, stopAfter: null },
    metrics: [
      {
        key: 'validation_loss',
        displayName: 'Validation loss',
        direction: 'minimize' as const,
        unit: null,
        aggregation: 'minimum' as const,
        primary: true,
      },
    ],
    evaluationPolicy: 'Evaluate against the pinned validation split.',
    experimentRules: ['Do not update model weights during evaluation.'],
    loggingFields: [
      {
        key: 'validation_loss',
        label: 'Validation loss',
        type: 'number' as const,
        category: 'metric' as const,
        requiredAt: ['progress', 'summary'] as const,
        unit: null,
      },
    ],
    outputs: [
      {
        kind: 'number' as const,
        title: 'Best validation loss',
        metricKey: 'validation_loss',
        description: 'Minimum validation loss in the evaluation window.',
      },
      {
        kind: 'plot' as const,
        title: 'Validation trajectory',
        plotKind: 'line' as const,
        xField: 'step',
        yMetricKeys: ['validation_loss'],
        description: 'Validation loss by training step.',
      },
    ],
    referenceCode: {
      language: 'python' as const,
      fileName: 'evaluate_validation.py',
      content: 'def evaluate(rows):\n    return {"validation_loss": 0.5}\n',
    },
    promptTemplate: 'Evaluate the pinned validation split and emit structured JSON.',
    preview: {
      dataKind: 'synthetic-preview' as const,
      evidence: false as const,
      notice: 'Illustrative values only; no experiment was executed.',
      numbers: [{ label: 'Validation loss', value: 0.5, unit: null }],
      table: {
        title: 'Illustrative checkpoints',
        columns: ['step', 'validation_loss'],
        rows: [
          [100, 0.8],
          [200, 0.5],
        ],
      },
      plot: {
        title: 'Illustrative validation trajectory',
        subtitle: 'Synthetic preview every 100 steps',
        kind: 'line' as const,
        xLabel: 'Step',
        yLabel: 'Validation loss',
        series: [
          {
            name: 'Validation loss',
            points: [
              { x: 100, y: 0.8, label: 'step 100' },
              { x: 200, y: 0.5, label: 'step 200' },
            ],
          },
        ],
      },
      reportMarkdown: '# Synthetic preview\n\nNo experiment was executed.',
    },
    ...overrides,
  };
}

describe('Experiment Evaluation contracts', () => {
  it('accepts positive step and epoch cadences with an optional stop boundary', () => {
    expect(
      ExperimentEvaluationCadenceSchema.parse({
        unit: 'step',
        interval: 250,
        startAt: 0,
        stopAfter: null,
      }),
    ).toEqual({ unit: 'step', interval: 250, startAt: 0, stopAfter: null });
    expect(
      ExperimentEvaluationCadenceSchema.safeParse({
        unit: 'epoch',
        interval: 2,
        startAt: 1,
        stopAfter: 20,
      }).success,
    ).toBe(true);
  });

  it('rejects zero intervals and a stop boundary before evaluation starts', () => {
    expect(
      ExperimentEvaluationCadenceSchema.safeParse({
        unit: 'step',
        interval: 0,
        startAt: 0,
        stopAfter: null,
      }).success,
    ).toBe(false);
    expect(
      ExperimentEvaluationCadenceSchema.safeParse({
        unit: 'epoch',
        interval: 1,
        startAt: 10,
        stopAfter: 9,
      }).success,
    ).toBe(false);
  });

  it('keeps preview data explicitly synthetic and never accepts it as evidence', () => {
    const parsed = ExperimentEvaluationDraftSchema.parse(validDraft());

    expect(parsed.preview).toMatchObject({
      dataKind: 'synthetic-preview',
      evidence: false,
    });
    expect(
      ExperimentEvaluationPreviewSchema.safeParse({
        ...parsed.preview,
        evidence: true,
      }).success,
    ).toBe(false);
    expect(
      ExperimentEvaluationPreviewSchema.safeParse({
        ...parsed.preview,
        dataKind: 'runner-result',
      }).success,
    ).toBe(false);
  });

  it('rejects malformed preview tables, duplicate metrics, and multiple primary metrics', () => {
    const base = validDraft();
    expect(
      ExperimentEvaluationDraftSchema.safeParse({
        ...base,
        preview: {
          ...base.preview,
          table: {
            title: 'Broken table',
            columns: ['step', 'loss'],
            rows: [[100]],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      ExperimentEvaluationDraftSchema.safeParse({
        ...base,
        metrics: [base.metrics[0], base.metrics[0]],
      }).success,
    ).toBe(false);
    expect(
      ExperimentEvaluationDraftSchema.safeParse({
        ...base,
        metrics: [
          base.metrics[0],
          {
            ...base.metrics[0],
            key: 'accuracy',
            displayName: 'Accuracy',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects declared outputs without matching synthetic number, table, or plot previews', () => {
    const base = validDraft();
    expect(
      ExperimentEvaluationDraftSchema.safeParse({
        ...base,
        preview: { ...base.preview, numbers: [] },
      }).success,
    ).toBe(false);
    expect(
      ExperimentEvaluationDraftSchema.safeParse({
        ...base,
        outputs: [
          ...base.outputs,
          {
            kind: 'table',
            title: 'Per-class results',
            columns: ['class', 'f1'],
            description: 'Class metrics.',
          },
        ],
        preview: { ...base.preview, table: null },
      }).success,
    ).toBe(false);
    expect(
      ExperimentEvaluationDraftSchema.safeParse({
        ...base,
        preview: { ...base.preview, plot: { ...base.preview.plot!, kind: 'bar' } },
      }).success,
    ).toBe(false);
    expect(
      ExperimentEvaluationDraftSchema.safeParse({
        ...base,
        preview: {
          ...base.preview,
          plot: {
            ...base.preview.plot!,
            series: [{ ...base.preview.plot!.series[0], name: 'Unrelated metric' }],
          },
        },
      }).success,
    ).toBe(false);
  });

  it('aligns single table and plot output capacities with the available preview shape', () => {
    expect(EXPERIMENT_EVALUATION_OUTPUT_SCHEMA.properties.draft.properties.outputs.maxItems).toBe(
      EXPERIMENT_EVALUATION_MAX_OUTPUTS,
    );
    expect(
      EXPERIMENT_EVALUATION_OUTPUT_SCHEMA.properties.draft.properties.outputs.items.oneOf[1]
        .properties.columns.maxItems,
    ).toBe(EXPERIMENT_EVALUATION_MAX_TABLE_COLUMNS);
    expect(
      EXPERIMENT_EVALUATION_OUTPUT_SCHEMA.properties.draft.properties.outputs.items.oneOf[2]
        .properties.yMetricKeys.maxItems,
    ).toBe(EXPERIMENT_EVALUATION_MAX_PLOT_SERIES);
    expect(
      ExperimentEvaluationOutputSchema.safeParse({
        kind: 'table',
        title: 'Too wide',
        columns: Array.from({ length: 13 }, (_, index) => `column_${index}`),
        description: '',
      }).success,
    ).toBe(false);
    expect(
      ExperimentEvaluationOutputSchema.safeParse({
        kind: 'plot',
        title: 'Too many series',
        plotKind: 'line',
        xField: 'step',
        yMetricKeys: Array.from({ length: 7 }, (_, index) => `metric_${index}`),
        description: '',
      }).success,
    ).toBe(false);

    const base = validDraft();
    const plot = base.outputs.find((output) => output.kind === 'plot');
    expect(plot).toBeDefined();
    expect(
      ExperimentEvaluationDraftSchema.safeParse({
        ...base,
        outputs: [...base.outputs, { ...plot, title: 'Second plot' }],
      }).success,
    ).toBe(false);
  });

  it('rejects drafts that cannot fit back into a bounded revision context', () => {
    const base = validDraft();
    const oversized = {
      ...base,
      referenceCode: {
        ...base.referenceCode,
        content: `def evaluate(values):\n    return values\n${'# context\n'.repeat(
          Math.ceil(EXPERIMENT_EVALUATION_MAX_DRAFT_CHARACTERS / 10),
        )}`,
      },
    };

    expect(JSON.stringify(oversized).length).toBeGreaterThan(
      EXPERIMENT_EVALUATION_MAX_DRAFT_CHARACTERS,
    );
    expect(ExperimentEvaluationDraftSchema.safeParse(oversized).success).toBe(false);
  });

  it('rejects numeric and plot outputs that reference undeclared evaluation metrics', () => {
    const base = validDraft();
    expect(
      ExperimentEvaluationDraftSchema.safeParse({
        ...base,
        outputs: [
          {
            kind: 'number',
            title: 'Unknown score',
            metricKey: 'undeclared_score',
            description: 'This output has no matching metric declaration.',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ExperimentEvaluationDraftSchema.safeParse({
        ...base,
        outputs: [
          {
            kind: 'plot',
            title: 'Mixed trajectory',
            plotKind: 'line',
            xField: 'step',
            yMetricKeys: ['validation_loss', 'undeclared_score'],
            description: 'Every plotted series must be declared as an evaluation metric.',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects secret-like logging keys and unknown generation output fields', () => {
    const base = validDraft();
    expect(
      ExperimentEvaluationDraftSchema.safeParse({
        ...base,
        loggingFields: [
          {
            ...base.loggingFields[0],
            key: 'api_token',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ExperimentEvaluationGenerationOutputSchema.safeParse({
        reply: 'Draft ready for approval.',
        sessionTitle: 'Validation evaluation',
        draft: base,
        executedOnServer: true,
      }).success,
    ).toBe(false);
  });
});
