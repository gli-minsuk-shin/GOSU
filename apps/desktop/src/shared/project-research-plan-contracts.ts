import { z } from 'zod';
import {
  ExperimentBudgetSchema,
  MetricGuardrailSchema,
  PrimaryMetricSchema,
  StopPolicySchema,
} from '@gosu/contracts';
import {
  ExperimentEvaluationCadenceSchema,
  ExperimentEvaluationMetricSchema,
  type ExperimentEvaluationSession,
  type ExperimentEvaluationMessage,
  type ExperimentEvaluationRevision,
} from './experiment-evaluation-contracts';
import {
  ExperimentLoggingCustomFieldsSchema,
  type ExperimentIdea,
  type ExperimentLoggingTemplate,
} from './experiment-workspace-contracts';

/** Draft identity is explicit; unresolved hashes never confer comparable-run readiness. */
export const ResearchPlanMetricSchema = PrimaryMetricSchema.extend({
  key: ExperimentEvaluationMetricSchema.shape.key,
  displayName: ExperimentEvaluationMetricSchema.shape.displayName,
  unit: ExperimentEvaluationMetricSchema.shape.unit,
  evaluatorHash: PrimaryMetricSchema.shape.evaluatorHash.nullable(),
  datasetHash: PrimaryMetricSchema.shape.datasetHash.nullable(),
}).strict();
export const ProjectResearchPlanSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    goal: z.string().trim().min(10).max(2000),
    hypothesis: z.string().trim().max(4000),
    primaryMetric: ResearchPlanMetricSchema,
    observedMetrics: z.array(ExperimentEvaluationMetricSchema).max(7),
    guardrails: z.array(MetricGuardrailSchema).max(24),
    budget: ExperimentBudgetSchema,
    stopPolicy: StopPolicySchema,
    cadence: ExperimentEvaluationCadenceSchema,
    evaluationPolicy: z.string().trim().min(1).max(8000),
    experimentRules: z.array(z.string().trim().min(1).max(1000)).min(1).max(24),
    loggingFields: ExperimentLoggingCustomFieldsSchema,
    replaceLoggingKeys: z.array(z.string().max(128)).max(32),
    referenceCode: z.string().trim().min(1).max(24000).nullable(),
    activateObjective: z.boolean(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (plan.primaryMetric.target === null && plan.stopPolicy.stopWhenTargetReached)
      ctx.addIssue({
        code: 'custom',
        path: ['stopPolicy', 'stopWhenTargetReached'],
        message: 'A target is required for target stopping',
      });
    const keys = [plan.primaryMetric.key, ...plan.observedMetrics.map((m) => m.key)];
    if (new Set(keys).size !== keys.length || plan.observedMetrics.some((m) => m.primary))
      ctx.addIssue({
        code: 'custom',
        path: ['observedMetrics'],
        message: 'One primary metric and unique metric keys are required',
      });
    if (new Set(plan.replaceLoggingKeys).size !== plan.replaceLoggingKeys.length)
      ctx.addIssue({
        code: 'custom',
        path: ['replaceLoggingKeys'],
        message: 'Replacement keys must be unique',
      });
    if (JSON.stringify(plan).length > 45000)
      ctx.addIssue({ code: 'custom', message: 'Research plan too large' });
  });
export type ProjectResearchPlan = z.infer<typeof ProjectResearchPlanSchema>;
export const ApplyProjectResearchPlanArgumentsSchema = z
  .object({
    snapshotToken: z.string().uuid(),
    plan: ProjectResearchPlanSchema,
  })
  .strict();
export const ProjectResearchPlanReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    sourceSessionId: z.string().uuid(),
    sourceAttemptId: z.string().uuid(),
    planHash: z.string().regex(/^[a-f0-9]{64}$/),
    objectiveId: z.string().uuid(),
    objectiveVersion: z.number().int().positive(),
    objectiveEntityVersion: z.number().int().positive(),
    objectiveLocked: z.boolean(),
    needsIdentity: z.boolean(),
    loggingTemplateId: z.string().uuid(),
    loggingTemplateVersion: z.number().int().positive(),
    evaluationSessionId: z.string().uuid(),
    evaluationRevisionId: z.string().uuid(),
    ideaId: z.string().uuid(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ProjectResearchPlanReceipt = z.infer<typeof ProjectResearchPlanReceiptSchema>;
export type ProjectResearchPlanCommit = {
  receipt: ProjectResearchPlanReceipt;
  plan: ProjectResearchPlan;
  expectedLoggingVersion: number;
  loggingTemplate: ExperimentLoggingTemplate | null;
  idea: ExperimentIdea;
  evaluationSession: ExperimentEvaluationSession;
  userMessage: ExperimentEvaluationMessage;
  evaluationRevision: ExperimentEvaluationRevision;
  assistantMessage: ExperimentEvaluationMessage;
};
export const hasPendingObjectiveIdentity = (metric: {
  evaluatorHash: string;
  datasetHash: string;
  holdoutHash: string | null;
}) =>
  [metric.evaluatorHash, metric.datasetHash, metric.holdoutHash].some((v) =>
    v?.startsWith('pending:'),
  );

/** Conservative capability gate on the current direct user request, never attached/remembered text. */
export function authorizesResearchPlanSync(message: string) {
  const text = message.normalize('NFKC').toLowerCase();
  const lead = text.split(/[\n:：]/u)[0]!.trim();
  if (
    /(?:검토만|설명만|분석만|작성하지|만들지|수립하지|설계하지|활성화하지|동결하지|저장하지|반영하지|수정하지|실행하지\s*말고\s*설명|review only|explain only|do not (?:save|apply|update|write|create|activate|freeze)|don't (?:save|apply|update|write|create|activate|freeze)|(?:do not|don't) change (?:the )?(?:plan|goal|rules|settings)|without (?:saving|applying)|read[- ]only|dry[- ]run)/u.test(
      text,
    )
  )
    return false;
  if (
    /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:review|explain|summari[sz]e|analy[sz]e|compare|assess|evaluate)\b/u.test(
      lead,
    ) &&
    !/\b(?:and|then)\s+(?:apply|save|update|revise|rewrite|create|write|implement)\b/u.test(lead)
  )
    return false;
  if (/(?:검토|설명|요약|분석|비교)해/u.test(lead) && !/(?:반영|적용|수정|작성|수립)해/u.test(lead))
    return false;
  if (
    !/(?:실험|모델|연구|\bexperiments?\b|\bmodels?\b|\bresearch\b)/u.test(text) ||
    !/(?:계획|프로토콜|\bplans?\b|\bprotocols?\b)/u.test(text)
  )
    return false;
  const heading =
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:(?:실험|모델\s*개발|연구)\s*계획\s*[:：\n]|(?:experiment|model development|research)\s+plan\s*[:\n])/u.test(
      text,
    );
  if (
    !heading &&
    /(?:어떻게|왜|가능|필요|할까요|있나|\bhow\b|\bwhy\b|\bwhether\b)/u.test(text) &&
    !/(?:해줘|해주세요|해\s*주세요|만들어줘|세워줘|짜줘|\bplease\b)/u.test(text)
  )
    return false;
  return (
    /(?:만들|작성|세워|세우|짜줘|짜\s*주|반영|적용|업데이트|갱신|수정|등록|진행|수립|설계|구체화|보완|활성화|동결|\b(?:create|write|draft|develop|design|apply|update|implement|revise|execute|build|activate|freeze)\b)/u.test(
      text,
    ) || heading
  );
}
