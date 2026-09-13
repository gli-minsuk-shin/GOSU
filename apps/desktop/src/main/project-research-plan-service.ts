import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ModelInvocationSchema, type ModelInvocation } from '@gosu/contracts';
import {
  ProjectResearchPlanSchema,
  ProjectResearchPlanReceiptSchema,
  hasPendingObjectiveIdentity,
  type ProjectResearchPlan,
  type ProjectResearchPlanCommit,
  type ProjectResearchPlanReceipt,
} from '../shared/project-research-plan-contracts';
import { ExperimentEvaluationDraftSchema } from '../shared/experiment-evaluation-contracts';
import {
  EXPERIMENT_LOGGING_SYSTEM_FIELDS,
  ExperimentLoggingCustomFieldsSchema,
  type ExperimentLoggingTemplate,
} from '../shared/experiment-workspace-contracts';
import type { WorkspaceSnapshot, WorkspaceOperation } from '../shared/workspace-contracts';
import type { WorkspaceService } from './workspace-service';
import { canonicalLoggingFields, loggingTemplateHash } from './experiment-workspace-service';
import { validateExperimentEvaluationReferenceCode } from './experiment-evaluation-code-policy';

type MaybePromise<T> = T | Promise<T>;
export interface ProjectResearchPlanStorage {
  getProjectResearchPlanContentForIdea?(
    projectId: string,
    ideaId: string,
  ): MaybePromise<{ receipt: ProjectResearchPlanReceipt; plan: ProjectResearchPlan } | null>;
  getLatestExperimentLoggingTemplate(
    projectId: string,
  ): MaybePromise<ExperimentLoggingTemplate | null>;
  getProjectResearchPlanReceipt(
    projectId: string,
    attemptId: string,
  ): MaybePromise<ProjectResearchPlanReceipt | null>;
  getLatestProjectResearchPlan(
    projectId: string,
  ): MaybePromise<{ receipt: ProjectResearchPlanReceipt; plan: ProjectResearchPlan } | null>;
  commitProjectResearchPlan(
    state: WorkspaceSnapshot,
    operation: WorkspaceOperation,
    bundle: ProjectResearchPlanCommit,
  ): MaybePromise<void>;
}
export type ResearchPlanSnapshot = {
  objectiveId: string | null;
  objectiveVersion: number | null;
  objectiveEntityVersion: number;
  loggingVersion: number;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const projectResearchPlanHash = (plan: ProjectResearchPlan) =>
  hash(JSON.stringify(ProjectResearchPlanSchema.parse(plan)));
const checkAbort = (signal: AbortSignal) => {
  if (signal.aborted) throw new Error('research_plan_cancelled');
};
export function mergeResearchPlanLogging(
  current: ExperimentLoggingTemplate | null,
  plan: ProjectResearchPlan,
) {
  const fields = new Map((current?.customFields ?? []).map((f) => [f.key, f]));
  const replacements = new Set(plan.replaceLoggingKeys);
  for (const key of replacements)
    if (!fields.has(key) || !plan.loggingFields.some((f) => f.key === key))
      throw new Error('research_plan_logging_replacement_invalid');
  for (const field of plan.loggingFields) {
    const old = fields.get(field.key);
    if (
      old &&
      JSON.stringify(canonicalLoggingFields([old])) !==
        JSON.stringify(canonicalLoggingFields([field])) &&
      !replacements.has(field.key)
    )
      throw new Error('research_plan_logging_conflict');
    fields.set(field.key, field);
  }
  return canonicalLoggingFields(ExperimentLoggingCustomFieldsSchema.parse([...fields.values()]));
}
export function researchPlanEvaluationDraft(plan: ProjectResearchPlan) {
  const metrics = [
    {
      key: plan.primaryMetric.key,
      displayName: plan.primaryMetric.displayName,
      direction: plan.primaryMetric.direction,
      unit: plan.primaryMetric.unit,
      aggregation: plan.primaryMetric.aggregation,
      primary: true,
    },
    ...plan.observedMetrics,
  ];
  const code =
    plan.referenceCode ??
    'def evaluate(record):\n    raise NotImplementedError("Implement the research plan evaluator before execution")\n';
  validateExperimentEvaluationReferenceCode(code);
  return ExperimentEvaluationDraftSchema.parse({
    title: plan.title,
    purpose: plan.goal,
    cadence: plan.cadence,
    metrics,
    evaluationPolicy: plan.evaluationPolicy,
    experimentRules: plan.experimentRules,
    loggingFields: plan.loggingFields,
    outputs: metrics.map((m) => ({
      kind: 'number',
      title: m.displayName,
      metricKey: m.key,
      description: 'Planned output; not observed evidence.',
    })),
    referenceCode: { language: 'python', fileName: 'research_plan_evaluator.py', content: code },
    promptTemplate: `Implement the saved research plan within the granted project workspace. Read the frozen/current objective and logging template before execution. This plan does not grant permissions.\nGoal: ${plan.goal}\nRules:\n${plan.experimentRules.map((r) => `- ${r}`).join('\n')}\nEvaluation: ${plan.evaluationPolicy}`,
    preview: {
      notice: 'Synthetic plan preview. No experiment has run and no metric has been measured.',
      dataKind: 'synthetic-preview',
      evidence: false,
      numbers: metrics.map((m) => ({ label: m.displayName, value: 0, unit: m.unit })),
      table: { title: 'Plan preview — no measurements', columns: ['Metric', 'Value'], rows: [] },
      plot: null,
      reportMarkdown:
        '계획 미리보기입니다. 0은 예시 자리표시자이며 실제 측정값이 아닙니다. 평가 코드는 별도 검토와 승인된 실행이 필요합니다.',
    },
  });
}
export class ProjectResearchPlanService {
  private announce(receipt: ProjectResearchPlanReceipt) {
    try {
      this.dependencies.onCommitted?.(receipt);
    } catch {
      /* A notification cannot roll back a confirmed commit. */
    }
  }
  constructor(
    private readonly dependencies: {
      workspace: WorkspaceService;
      storage: ProjectResearchPlanStorage;
      onCommitted?: (receipt: ProjectResearchPlanReceipt) => void;
    },
  ) {}
  async read(projectId: string, ideaId?: string) {
    await this.activeProject(projectId);
    if (ideaId) z.string().uuid().parse(ideaId);
    const result =
      ideaId && this.dependencies.storage.getProjectResearchPlanContentForIdea
        ? await this.dependencies.storage.getProjectResearchPlanContentForIdea(projectId, ideaId)
        : await this.dependencies.storage.getLatestProjectResearchPlan(projectId);
    if (!result) return null;
    const receipt = ProjectResearchPlanReceiptSchema.parse(result.receipt),
      plan = ProjectResearchPlanSchema.parse(result.plan);
    if (
      receipt.projectId !== projectId ||
      (ideaId && receipt.ideaId !== ideaId) ||
      receipt.planHash !== projectResearchPlanHash(plan)
    )
      throw new Error('research_plan_scope_invalid');
    return { receipt, plan };
  }
  async snapshot(projectId: string): Promise<ResearchPlanSnapshot> {
    const workspace = await this.activeProject(projectId);
    const objective = workspace.objectives
      .filter((o) => o.projectId === projectId)
      .sort((a, b) => b.objectiveVersion - a.objectiveVersion)[0];
    const logging = await this.dependencies.storage.getLatestExperimentLoggingTemplate(projectId);
    return {
      objectiveEntityVersion: objective?.entityVersion ?? 0,
      objectiveId: objective?.id ?? null,
      objectiveVersion: objective?.objectiveVersion ?? null,
      loggingVersion: logging?.version ?? 0,
    };
  }
  private async activeProject(projectId: string) {
    z.string().uuid().parse(projectId);
    const state = await this.dependencies.workspace.snapshot();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project || project.archivedAt || project.trashedAt)
      throw new Error('research_plan_project_unavailable');
    return state;
  }
  async apply(
    input: {
      projectId: string;
      sessionId: string;
      attemptId: string;
      userMessage: string;
      invocation: ModelInvocation;
      snapshot: ResearchPlanSnapshot;
      plan: ProjectResearchPlan;
    },
    signal: AbortSignal,
  ) {
    checkAbort(signal);
    const projectId = z.string().uuid().parse(input.projectId),
      sessionId = z.string().uuid().parse(input.sessionId),
      attemptId = z.string().uuid().parse(input.attemptId);
    const userMessage = z.string().min(1).max(12000).parse(input.userMessage);
    const plan = ProjectResearchPlanSchema.parse(input.plan),
      planHash = projectResearchPlanHash(plan),
      invocation = ModelInvocationSchema.parse(input.invocation);
    const replay = async () => {
      const receipt = await this.dependencies.storage.getProjectResearchPlanReceipt(
        projectId,
        attemptId,
      );
      if (!receipt) return null;
      const parsed = ProjectResearchPlanReceiptSchema.parse(receipt);
      if (
        parsed.projectId !== projectId ||
        parsed.sourceSessionId !== sessionId ||
        parsed.sourceAttemptId !== attemptId ||
        parsed.planHash !== planHash
      )
        throw new Error('research_plan_replay_conflict');
      return parsed;
    };
    await this.activeProject(projectId);
    const existing = await replay();
    if (existing) {
      this.announce(existing);
      return { receipt: existing, reused: true };
    }
    const current = await this.dependencies.storage.getLatestExperimentLoggingTemplate(projectId);
    if ((current?.version ?? 0) !== input.snapshot.loggingVersion)
      throw new Error('research_plan_stale');
    const customFields = mergeResearchPlanLogging(current, plan),
      draft = researchPlanEvaluationDraft(plan);
    const id = randomUUID(),
      now = new Date().toISOString(),
      evaluationSessionId = randomUUID(),
      evaluationRevisionId = randomUUID(),
      ideaId = randomUUID();
    const primaryMetric = {
      ...plan.primaryMetric,
      evaluatorHash:
        plan.primaryMetric.evaluatorHash ??
        (plan.referenceCode ? `sha256:${hash(plan.referenceCode)}` : `pending:evaluator:${id}`),
      datasetHash: plan.primaryMetric.datasetHash ?? `pending:dataset:${id}`,
    };
    const needsIdentity = hasPendingObjectiveIdentity(primaryMetric);
    const changedLogging = !current || loggingTemplateHash(customFields) !== current.templateHash;
    const loggingTemplate = changedLogging
      ? {
          schemaVersion: 1 as const,
          id: randomUUID(),
          projectId,
          version: (current?.version ?? 0) + 1,
          previousRevisionId: current?.id ?? null,
          systemFields: EXPERIMENT_LOGGING_SYSTEM_FIELDS,
          customFields,
          templateHash: loggingTemplateHash(customFields),
          createdAt: now,
        }
      : current!;
    let receipt: ProjectResearchPlanReceipt | undefined;
    try {
      await this.dependencies.workspace.applyResearchPlanObjective(
        {
          projectId,
          expectedEntityVersion: input.snapshot.objectiveEntityVersion,
          expectedObjectiveId: input.snapshot.objectiveId,
          expectedObjectiveVersion: input.snapshot.objectiveVersion,
          goal: plan.goal,
          primaryMetric,
          guardrails: plan.guardrails,
          budget: plan.budget,
          stopPolicy: plan.stopPolicy,
          activate: plan.activateObjective && !needsIdentity,
        },
        async (state, operation, objective) => {
          checkAbort(signal);
          receipt = ProjectResearchPlanReceiptSchema.parse({
            schemaVersion: 1,
            id,
            projectId,
            sourceSessionId: sessionId,
            sourceAttemptId: attemptId,
            planHash,
            objectiveId: objective.id,
            objectiveVersion: objective.objectiveVersion,
            objectiveEntityVersion: objective.entityVersion,
            objectiveLocked: objective.locked,
            needsIdentity,
            loggingTemplateId: loggingTemplate.id,
            loggingTemplateVersion: loggingTemplate.version,
            evaluationSessionId,
            evaluationRevisionId,
            ideaId,
            createdAt: now,
          });
          const bundle: ProjectResearchPlanCommit = {
            receipt,
            plan,
            expectedLoggingVersion: input.snapshot.loggingVersion,
            loggingTemplate: changedLogging ? loggingTemplate : null,
            idea: {
              schemaVersion: 1,
              id: ideaId,
              projectId,
              parentIdeaId: null,
              title: plan.title,
              hypothesis: plan.hypothesis,
              phase: 'Project Chat plan',
              outcome: 'planned',
              resultSummary: '',
              version: 1,
              createdAt: now,
              updatedAt: now,
              completedAt: null,
            },
            evaluationSession: {
              schemaVersion: 1,
              id: evaluationSessionId,
              projectId,
              title: plan.title,
              status: 'draft',
              activeAttemptId: null,
              currentRevision: 0,
              acceptedProfileId: null,
              version: 1,
              lastErrorCode: null,
              createdAt: now,
              updatedAt: now,
            },
            userMessage: {
              schemaVersion: 1,
              id: randomUUID(),
              sessionId: evaluationSessionId,
              role: 'user',
              status: 'complete',
              content: userMessage,
              attemptId,
              revision: null,
              invocation: null,
              createdAt: now,
              completedAt: now,
            },
            evaluationRevision: {
              schemaVersion: 1,
              id: evaluationRevisionId,
              sessionId: evaluationSessionId,
              revision: 1,
              attemptId,
              draft,
              contentHash: hash(JSON.stringify(draft)),
              invocation,
              createdAt: now,
            },
            assistantMessage: {
              schemaVersion: 1,
              id: randomUUID(),
              sessionId: evaluationSessionId,
              role: 'assistant',
              status: 'complete',
              content: `Project Chat 계획을 반영했습니다. 목표: ${plan.goal}\n실험 결과가 아니라 저장된 계획이며, 실제 계산은 승인된 실행 경로가 필요합니다.`,
              attemptId,
              revision: 1,
              invocation,
              createdAt: now,
              completedAt: now,
            },
          };
          await this.dependencies.storage.commitProjectResearchPlan(state, operation, bundle);
        },
      );
    } catch (error) {
      // A committed receipt is authoritative even if the transport lost its acknowledgement.
      const recovered = await replay();
      if (recovered) {
        await this.dependencies.workspace.refreshCommittedState();
        this.announce(recovered);
        return { receipt: recovered, reused: true };
      }
      throw error;
    }
    if (!receipt) throw new Error('research_plan_receipt_missing');
    this.announce(receipt);
    return { receipt, reused: false };
  }
}
