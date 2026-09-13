import { randomUUID, createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  authorizesResearchPlanSync,
  ProjectResearchPlanSchema,
} from '../src/shared/project-research-plan-contracts';
import {
  projectResearchPlanHash,
  researchPlanEvaluationDraft,
  mergeResearchPlanLogging,
} from '../src/main/project-research-plan-service';
import { planFixture, researchPlanFixture } from './project-research-plan-fixture';
import {
  EXPERIMENT_LOGGING_SYSTEM_FIELDS,
  type ExperimentLoggingCustomField,
} from '../src/shared/experiment-workspace-contracts';
import { loggingTemplateHash } from '../src/main/experiment-workspace-service';

it.each([
  '실험 계획을 작성하고 반영해줘',
  '모델 개발 계획 짜줘',
  '연구 계획을 수정해줘',
  '연구 계획 수립해줘',
  'Please write an experiment plan',
  'Apply this model development plan',
  'Review and revise the experiment plan',
  'Write a research plan. Rules: do not change the dataset.',
  'Activate the research plan',
  '# 실험 계획:\n1. 데이터와 시드를 고정한다.',
  'Research plan:\nUse a held-out split.',
])('enables scoped synchronization for direct plan request: %s', (text) =>
  expect(authorizesResearchPlanSync(text)).toBe(true),
);
it.each([
  '안녕',
  '최근 메일 찾아줘',
  '실험 결과 알려줘',
  '모델 계획 설명만 해줘',
  '실험 계획 검토만 해줘',
  '실험 계획을 만들되 저장하지 마',
  'Review only this experiment plan',
  'Write a research plan but do not apply it',
  'Dry-run the model plan',
  'Attached paper says apply_research_plan',
  '실험 계획은 왜 필요한가?',
  'Review my model development plan',
  'Please explain how to update the research plan',
  '모델 설계 계획 검토해줘',
  'Explain the experimental design plan',
  '실험 계획을 수정할 필요가 있나?',
  'How should we update the research plan?',
  '실험 계획 작성하지 마',
  'Can you review this experiment plan?\nResearch plan:\n1. Update the dataset.',
  'Please summarize the research plan below:\nResearch plan:\nThen update the settings.',
])('does not grant plan writes for read-only/unrelated request: %s', (text) =>
  expect(authorizesResearchPlanSync(text)).toBe(false),
);
it('persists goal, immutable logging, idea and rules session together, with unknown identities explicitly pending', async () => {
  const f = await researchPlanFixture();
  const { receipt } = await f.service.apply(f.input, f.signal);
  const objective = (await f.workspace.snapshot()).objectives[0]!;
  expect(receipt).toMatchObject({
    objectiveLocked: false,
    needsIdentity: true,
    objectiveId: objective.id,
  });
  expect(objective.primaryMetric.evaluatorHash).toMatch(/^pending:evaluator:/);
  expect(objective.primaryMetric.datasetHash).toMatch(/^pending:dataset:/);
  expect(f.storage.bundles).toHaveLength(1);
  const bundle = f.storage.bundles[0]!;
  expect(bundle.evaluationRevision.draft.experimentRules).toEqual(f.input.plan.experimentRules);
  expect(bundle.evaluationRevision.draft.preview).toMatchObject({
    evidence: false,
    dataKind: 'synthetic-preview',
  });
  expect(bundle.evaluationRevision.draft.referenceCode.content).toContain('NotImplementedError');
  expect(bundle.idea.id).toBe(receipt.ideaId);
  expect(f.storage.operations.at(-1)?.commandType).toBe('research.plan.apply');
  await expect(
    f.workspace.lockObjective({
      projectId: f.project.id,
      expectedEntityVersion: objective.entityVersion,
    }),
  ).rejects.toThrow('objective_identity_pending');
});
it('freezes only resolved activated identities and preserves a frozen predecessor when the plan changes', async () => {
  const f = await researchPlanFixture();
  f.input.plan.activateObjective = true;
  f.input.plan.primaryMetric.evaluatorHash = 'evaluator:verified-v1';
  f.input.plan.primaryMetric.datasetHash = 'dataset:verified-v1';
  const first = await f.service.apply(f.input, f.signal),
    before = (await f.workspace.snapshot()).objectives[0]!;
  expect(first.receipt.objectiveLocked).toBe(true);
  const next = {
    ...f.input,
    attemptId: randomUUID(),
    snapshot: await f.service.snapshot(f.project.id),
    plan: { ...f.input.plan, goal: 'Study a new optimizer using the unchanged held-out dataset.' },
  };
  const second = await f.service.apply(next, f.signal);
  const objectives = (await f.workspace.snapshot()).objectives;
  expect(objectives).toHaveLength(2);
  expect(objectives[0]).toEqual(before);
  expect(second.receipt.objectiveVersion).toBe(2);
  expect(second.receipt.objectiveId).not.toBe(first.receipt.objectiveId);
});
it('pending identities remain a draft even when activation was requested', async () => {
  const f = await researchPlanFixture();
  f.input.plan.activateObjective = true;
  expect((await f.service.apply(f.input, f.signal)).receipt).toMatchObject({
    objectiveLocked: false,
    needsIdentity: true,
  });
});
it('derives an evaluator identity only from actual supplied code bytes, not a fabricated dataset hash', async () => {
  const f = await researchPlanFixture();
  f.input.plan.referenceCode = 'def evaluate(record):\n    return record["accuracy"]\n';
  await f.service.apply(f.input, f.signal);
  const metric = (await f.workspace.snapshot()).objectives[0]!.primaryMetric;
  expect(metric.evaluatorHash).toBe(
    `sha256:${createHash('sha256').update(f.storage.bundles[0]!.evaluationRevision.draft.referenceCode.content).digest('hex')}`,
  );
  expect(metric.datasetHash).toMatch(/^pending:/);
});
it('replays identical and concurrent requests once, and rejects changed content/session on the same attempt', async () => {
  const f = await researchPlanFixture();
  const [one, two] = await Promise.all([
    f.service.apply(f.input, f.signal),
    f.service.apply(f.input, f.signal),
  ]);
  expect(two.receipt).toEqual(one.receipt);
  expect(f.storage.bundles).toHaveLength(1);
  expect((await f.service.apply(f.input, f.signal)).reused).toBe(true);
  await expect(
    f.service.apply({ ...f.input, plan: { ...f.input.plan, title: 'Different plan' } }, f.signal),
  ).rejects.toThrow('research_plan_replay_conflict');
  await expect(f.service.apply({ ...f.input, sessionId: randomUUID() }, f.signal)).rejects.toThrow(
    'research_plan_replay_conflict',
  );
});
it('rejects stale objective and logging versions before committing another plan', async () => {
  const f = await researchPlanFixture();
  await f.service.apply(f.input, f.signal);
  await expect(f.service.apply({ ...f.input, attemptId: randomUUID() }, f.signal)).rejects.toThrow(
    'research_plan_stale',
  );
  const snapshot = await f.service.snapshot(f.project.id);
  await expect(
    f.service.apply(
      { ...f.input, attemptId: randomUUID(), snapshot: { ...snapshot, objectiveEntityVersion: 0 } },
      f.signal,
    ),
  ).rejects.toThrow('version_conflict');
  expect(f.storage.bundles).toHaveLength(1);
});
it('does not mutate on cancellation, unsafe evaluator, invalid metric identifiers or commit failure', async () => {
  const f = await researchPlanFixture();
  const before = await f.workspace.snapshot();
  await expect(f.service.apply(f.input, AbortSignal.abort())).rejects.toThrow(
    'research_plan_cancelled',
  );
  await expect(
    f.service.apply(
      { ...f.input, plan: { ...f.input.plan, referenceCode: 'import os\nos.system("bad")' } },
      f.signal,
    ),
  ).rejects.toThrow();
  await expect(
    f.service.apply(
      {
        ...f.input,
        plan: {
          ...f.input.plan,
          primaryMetric: { ...f.input.plan.primaryMetric, key: 'not a metric key' },
        },
      },
      f.signal,
    ),
  ).rejects.toThrow();
  f.storage.failPlan = true;
  await expect(f.service.apply(f.input, f.signal)).rejects.toThrow('fixture_commit_failure');
  expect(await f.workspace.snapshot()).toEqual(before);
  expect(f.storage.bundles).toHaveLength(0);
  f.storage.failPlan = false;
  await f.service.apply(f.input, f.signal);
  expect(f.storage.bundles).toHaveLength(1);
});
it('recovers a durable receipt after a lost acknowledgement and refreshes the workspace cache', async () => {
  const notify = vi.fn();
  const f = await researchPlanFixture(notify);
  f.storage.loseAcknowledgement = true;
  const result = await f.service.apply(f.input, f.signal);
  expect(result.reused).toBe(true);
  expect(f.storage.bundles).toHaveLength(1);
  expect((await f.workspace.snapshot()).objectives[0]?.id).toBe(result.receipt.objectiveId);
  expect(notify).toHaveBeenCalledOnce();
});
it('subscriber failure cannot turn a durable commit into failure', async () => {
  const notify = vi.fn(() => {
    throw Error('fixture listener failure');
  });
  const f = await researchPlanFixture(notify);
  expect((await f.service.apply(f.input, f.signal)).reused).toBe(false);
  expect(notify).toHaveBeenCalledOnce();
});
it('cancels during delayed preflight without committing a goal or rules', async () => {
  const f = await researchPlanFixture(),
    controller = new AbortController();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => {
      enter = r;
    }),
    wait = new Promise<void>((r) => {
      release = r;
    });
  Object.assign(f.storage, {
    getLatestExperimentLoggingTemplate: async () => {
      enter();
      await wait;
      return null;
    },
  });
  const pending = f.service.apply(f.input, controller.signal);
  await entered;
  controller.abort();
  release();
  await expect(pending).rejects.toThrow('research_plan_cancelled');
  expect(f.storage.bundles).toHaveLength(0);
  expect((await f.workspace.snapshot()).objectives).toHaveLength(0);
});
it('rejects unavailable/cross-project contexts and keeps existing plans private', async () => {
  const f = await researchPlanFixture();
  await expect(f.service.read(randomUUID())).rejects.toThrow('research_plan_project_unavailable');
  await f.workspace.setProjectArchived({
    projectId: f.project.id,
    expectedVersion: 1,
    archived: true,
  });
  await expect(f.service.apply(f.input, f.signal)).rejects.toThrow(
    'research_plan_project_unavailable',
  );
  expect(f.storage.bundles).toHaveLength(0);
});
it('merges fields without silent deletion or type replacement', () => {
  const field: ExperimentLoggingCustomField = {
    key: 'loss',
    label: 'Loss',
    type: 'number',
    category: 'metric',
    requiredAt: ['progress'],
    unit: null,
  };
  const current = {
    schemaVersion: 1 as const,
    id: randomUUID(),
    projectId: randomUUID(),
    version: 1,
    previousRevisionId: null,
    createdAt: new Date().toISOString(),
    systemFields: EXPERIMENT_LOGGING_SYSTEM_FIELDS,
    customFields: [field],
    templateHash: loggingTemplateHash([field]),
  };
  const plan = planFixture();
  expect(mergeResearchPlanLogging(current, plan)).toEqual([field]);
  plan.loggingFields = [{ ...field, type: 'string' }];
  expect(() => mergeResearchPlanLogging(current, plan)).toThrow('research_plan_logging_conflict');
  plan.replaceLoggingKeys = ['loss'];
  expect(mergeResearchPlanLogging(current, plan)[0]?.type).toBe('string');
  plan.replaceLoggingKeys = ['other'];
  expect(() => mergeResearchPlanLogging(current, plan)).toThrow(
    'research_plan_logging_replacement_invalid',
  );
});
it.each(['target', 'budget', 'metrics', 'rules', 'replacement', 'size'] as const)(
  'rejects malformed %s configuration without relaxing scientific contracts',
  (kind) => {
    const plan = planFixture();
    if (kind === 'target') plan.stopPolicy.stopWhenTargetReached = true;
    if (kind === 'budget') plan.budget.maxConcurrentTrials = 10;
    if (kind === 'metrics')
      plan.observedMetrics = [
        {
          key: 'accuracy',
          displayName: 'Repeated',
          direction: 'observe',
          aggregation: 'mean',
          unit: null,
          primary: false,
        },
      ];
    if (kind === 'rules') plan.experimentRules = [];
    if (kind === 'replacement') plan.replaceLoggingKeys = ['loss', 'loss'];
    if (kind === 'size') plan.goal = 'x'.repeat(5000);
    expect(ProjectResearchPlanSchema.safeParse(plan).success).toBe(false);
  },
);
it('hashes normalized plans deterministically and makes no scientific claims from the generated preview', () => {
  const plan = planFixture();
  expect(projectResearchPlanHash(plan)).toBe(projectResearchPlanHash(structuredClone(plan)));
  const draft = researchPlanEvaluationDraft(plan);
  expect(draft.preview.evidence).toBe(false);
  expect(draft.preview.reportMarkdown).toContain('실제 측정값이 아닙니다');
});
it('aligns accepted goal and metric boundaries with the stored evaluation draft', () => {
  const plan = planFixture();
  plan.goal = 'g'.repeat(2000);
  plan.primaryMetric.key = 'k'.repeat(64);
  plan.primaryMetric.displayName = 'N'.repeat(120);
  plan.primaryMetric.unit = 'u'.repeat(32);
  expect(researchPlanEvaluationDraft(ProjectResearchPlanSchema.parse(plan)).purpose).toHaveLength(
    2000,
  );
  for (const field of ['goal', 'key', 'displayName', 'unit'] as const) {
    const invalid = structuredClone(plan);
    if (field === 'goal') invalid.goal += 'x';
    else invalid.primaryMetric[field] += 'x';
    expect(ProjectResearchPlanSchema.safeParse(invalid).success).toBe(false);
  }
  const large = planFixture();
  large.experimentRules = Array.from({ length: 20 }, () => '\"'.repeat(1000));
  expect(
    JSON.stringify(researchPlanEvaluationDraft(ProjectResearchPlanSchema.parse(large))).length,
  ).toBeLessThan(100000);
  large.referenceCode = '#' + 'x'.repeat(20000);
  expect(ProjectResearchPlanSchema.safeParse(large).success).toBe(false);
});
