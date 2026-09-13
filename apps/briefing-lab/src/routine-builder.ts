import { z } from 'zod';
import type { NativeTokenUsage } from './context-usage';
import { nextOccurrences, validateRoutine, type BriefingRoutine } from '@gosu/briefing-core';

// No IDs, credentials, executable commands, permission flags, or activation state from the LLM.
export const RoutineProposalSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    kind: z.enum(['personal', 'funding']),
    schedule: z
      .object({
        frequency: z.enum(['daily', 'weekly', 'monthly']),
        interval: z.number().int().min(1).max(99),
        anchorDate: z.string().max(10),
        timeZone: z.string().min(1).max(100),
        times: z.array(z.string().max(5)).min(1).max(24),
        weekdays: z.array(z.number().int().min(0).max(6)).max(7),
        monthDay: z.number().int().min(1).max(31),
      })
      .strict(),
    interest: z
      .object({
        keywords: z
          .array(
            z
              .object({
                term: z.string().trim().min(1).max(120),
                weight: z.number().int().min(1).max(5),
                synonyms: z.array(z.string().trim().min(1).max(120)).max(12),
              })
              .strict(),
          )
          .max(40),
        excluded: z.array(z.string().trim().min(1).max(120)).max(40),
      })
      .strict(),
    sourceIds: z.array(z.string().min(1).max(128)).max(40),
    countries: z.array(z.string().min(1).max(80)).max(30),
  })
  .strict();
export type RoutineProposal = z.infer<typeof RoutineProposalSchema>;
export const RoutineAnswerSchema = z
  .object({
    answer: z.string().trim().min(1).max(12000),
    proposal: RoutineProposalSchema.nullable(),
  })
  .strict();
export const RoutineRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(6000),
    providerId: z.enum(['codex', 'claude-code']),
    modelId: z.string().min(1).max(256),
    reasoning: z.string().max(128).nullable(),
    history: z
      .array(
        z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(12000) }).strict(),
      )
      .max(6),
    previousProposal: RoutineProposalSchema.nullable(),
  })
  .strict();
export type RoutineRequest = z.infer<typeof RoutineRequestSchema>;
export type RoutineResult = z.infer<typeof RoutineAnswerSchema> & {
  nativeUsage?: NativeTokenUsage;
  providerId: string;
  model: string;
  reasoning: string | null;
  nextDates: string[];
};
export type RoutineProgress = { stage: string; detail: string };

export function materializeProposal(value: unknown, id: string, now: string): BriefingRoutine {
  const proposal = RoutineProposalSchema.parse(value);
  // Connections are selected in real-source settings, never invented or granted by a proposal.
  if (proposal.sourceIds.length) throw new Error('routine_source_unknown');
  const { sourceIds: _sourceIds, ...fields } = proposal;
  const routine: BriefingRoutine = {
    ...fields,
    id,
    sources: [],
    state: 'draft',
    createdAt: now,
    updatedAt: now,
  };
  const errors = validateRoutine(routine);
  if (errors.length) throw new Error(`routine_invalid: ${errors.join('; ')}`);
  return routine;
}

export function proposalPreview(value: unknown, now: string) {
  const routine = materializeProposal(value, 'proposal-preview', now);
  return nextOccurrences(routine.schedule, now, 5).map((item) => item.scheduledFor);
}

export function routineErrorMessage(code: string) {
  if (/auth|subscription|not_detected|unavailable|connection_required/.test(code))
    return '구독 로그인을 다시 확인해주세요. GOSU에서 해당 Codex/Claude 계정에 재로그인한 뒤 모델 목록을 새로고침하세요. API 키로 자동 전환하지 않습니다.';
  if (/abort|cancel/.test(code)) return '요청을 중단했습니다. 루틴은 저장되지 않았습니다.';
  if (/timeout/.test(code))
    return '응답 제한 시간을 초과했습니다. 루틴은 저장되지 않았습니다. 다시 시도해주세요.';
  if (/busy/.test(code)) return '진행 중인 요청이 많습니다. 잠시 후 다시 시도해주세요.';
  if (/model|reasoning/.test(code))
    return '선택한 모델 또는 reasoning을 사용할 수 없습니다. 목록을 새로고침해주세요.';
  if (/invalid|source_unknown|proposal/.test(code))
    return 'AI 제안이 루틴 검증을 통과하지 못했습니다. 조건을 구체화해 다시 요청해주세요.';
  return 'LLM 연결에 실패했습니다. Briefing Lab 서버와 GOSU 로그인 상태를 확인해주세요.';
}
