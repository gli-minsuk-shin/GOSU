import { randomUUID } from 'node:crypto';
import type { ModelInvocation } from '@gosu/contracts';
import { WorkspaceService, type WorkspaceStorage } from '../src/main/workspace-service';
import {
  ProjectResearchPlanService,
  type ProjectResearchPlanStorage,
} from '../src/main/project-research-plan-service';
import {
  ProjectResearchPlanSchema,
  type ProjectResearchPlanCommit,
  type ProjectResearchPlanReceipt,
} from '../src/shared/project-research-plan-contracts';
import type { ExperimentLoggingTemplate } from '../src/shared/experiment-workspace-contracts';
import type { WorkspaceSnapshot, WorkspaceOperation } from '../src/shared/workspace-contracts';
export const planFixture = () =>
  ProjectResearchPlanSchema.parse({
    title: 'Reproducible model development',
    goal: 'Improve held-out model accuracy with controlled ablation experiments.',
    hypothesis: 'The new optimizer improves convergence.',
    primaryMetric: {
      key: 'accuracy',
      displayName: 'Accuracy',
      direction: 'maximize',
      unit: 'ratio',
      aggregation: 'mean',
      evaluatorHash: null,
      datasetHash: null,
      holdoutHash: null,
      baseline: null,
      target: null,
    },
    observedMetrics: [],
    guardrails: [],
    budget: {
      maxTrials: 3,
      maxConcurrentTrials: 1,
      maxWallTimeSeconds: 120,
      maxGpuHours: 0.1,
      maxFailures: 1,
    },
    stopPolicy: {
      stopWhenTargetReached: false,
      guardrailAction: 'pause',
      maxConsecutiveNoImprovement: null,
    },
    cadence: { unit: 'epoch', interval: 1, startAt: 0, stopAfter: 10 },
    evaluationPolicy: 'Evaluate the same held-out split after every epoch.',
    experimentRules: [
      'Use fixed seeds and the same data split.',
      'Record failures without deleting prior evidence.',
    ],
    loggingFields: [],
    replaceLoggingKeys: [],
    referenceCode: null,
    activateObjective: false,
  });
export const invocationFixture = (): ModelInvocation => ({
  schemaVersion: 1,
  invocationId: randomUUID(),
  providerId: 'codex',
  requestedModelId: 'fixture',
  resolvedModelId: 'fixture',
  catalogVersion: 'fixture-v1',
  reasoningOptionId: null,
  startedAt: new Date().toISOString(),
});
export class PlanMemoryStorage implements WorkspaceStorage, ProjectResearchPlanStorage {
  state: WorkspaceSnapshot | null = null;
  operations: WorkspaceOperation[] = [];
  templates = new Map<string, ExperimentLoggingTemplate>();
  receipts = new Map<string, ProjectResearchPlanReceipt>();
  bundles: ProjectResearchPlanCommit[] = [];
  failPlan = false;
  loseAcknowledgement = false;
  load() {
    return structuredClone(this.state);
  }
  commit(state: WorkspaceSnapshot, operation: WorkspaceOperation) {
    this.state = structuredClone(state);
    this.operations.push(structuredClone(operation));
  }
  pendingChanges() {
    return this.operations;
  }
  pendingSummary() {
    return {
      count: this.operations.length,
      latestWorkspaceRevision: this.operations.at(-1)?.workspaceRevision ?? null,
    };
  }
  getLatestExperimentLoggingTemplate(projectId: string) {
    return structuredClone(this.templates.get(projectId) ?? null);
  }
  getProjectResearchPlanReceipt(projectId: string, attemptId: string) {
    return structuredClone(this.receipts.get(`${projectId}:${attemptId}`) ?? null);
  }
  getLatestProjectResearchPlan(projectId: string) {
    const bundle = this.bundles.filter((b) => b.receipt.projectId === projectId).at(-1);
    return bundle ? structuredClone({ receipt: bundle.receipt, plan: bundle.plan }) : null;
  }
  getProjectResearchPlanContentForIdea(projectId: string, ideaId: string) {
    const b = this.bundles.find(
      (v) => v.receipt.projectId === projectId && v.receipt.ideaId === ideaId,
    );
    return b ? structuredClone({ receipt: b.receipt, plan: b.plan }) : null;
  }
  commitProjectResearchPlan(
    state: WorkspaceSnapshot,
    operation: WorkspaceOperation,
    bundle: ProjectResearchPlanCommit,
  ) {
    if (this.failPlan) throw Error('fixture_commit_failure');
    if (
      this.getProjectResearchPlanReceipt(bundle.receipt.projectId, bundle.receipt.sourceAttemptId)
    )
      throw Error('research_plan_replayed');
    if (
      (this.templates.get(bundle.receipt.projectId)?.version ?? 0) !== bundle.expectedLoggingVersion
    )
      throw Error('research_plan_stale');
    this.commit(state, operation);
    if (bundle.loggingTemplate)
      this.templates.set(bundle.receipt.projectId, structuredClone(bundle.loggingTemplate));
    this.receipts.set(
      `${bundle.receipt.projectId}:${bundle.receipt.sourceAttemptId}`,
      structuredClone(bundle.receipt),
    );
    this.bundles.push(structuredClone(bundle));
    if (this.loseAcknowledgement) throw Error('fixture_ack_lost');
  }
}
export async function researchPlanFixture(
  onCommitted?: (receipt: ProjectResearchPlanReceipt) => void,
) {
  const storage = new PlanMemoryStorage(),
    workspace = new WorkspaceService(storage);
  const project = await workspace.createProject({ name: 'Research plan fixture' });
  const service = new ProjectResearchPlanService({
    storage,
    workspace,
    ...(onCommitted ? { onCommitted } : {}),
  });
  const input = {
    projectId: project.id,
    sessionId: randomUUID(),
    attemptId: randomUUID(),
    userMessage: '모델 개발 실험 계획을 작성하고 반영해줘',
    invocation: invocationFixture(),
    snapshot: await service.snapshot(project.id),
    plan: planFixture(),
  };
  return { storage, workspace, project, service, input, signal: new AbortController().signal };
}
