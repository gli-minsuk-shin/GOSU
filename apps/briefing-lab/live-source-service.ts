import type { IncomingMessage, ServerResponse } from 'node:http';
import { BriefingChatQueue } from './briefing-chat-queue';
import type { ProjectBridge } from './briefing-project-bridge';
import type { ModelRouting } from '@gosu/contracts';
import { routedBriefingPreferences } from './briefing-model-routing';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { newPaperResults, summarizedPaperKeys } from './new-paper-results';
import { BriefingTodosSchema, type TodoReader } from './src/briefing-todos';
import { sameVerifiedMail, deduplicateVerifiedMail } from './src/mail-duplicates';
import { isPriorityOnlyEmailSummary } from './src/email-summary-quality';
import {
  InterestProfileSchema,
  LiveSettingsSchema,
  MailScopeSchema,
  mailTargets,
  MAX_MAIL_LIMIT,
  MAIL_LIMIT_ERROR,
} from '@gosu/briefing-core';
import { AppleMailConnection, type MailReadProgress } from './live-mail';
import {
  CityQuerySchema,
  findWeatherCities,
  readWeather,
  searchPapers,
} from './live-public-sources';
import type { LiveKind, LiveItem, LiveProgress, LiveSourceResult } from './src/live-types';
import { AnalysisRequestSchema, analyzeBriefing, type FeedbackProfile } from './briefing-analysis';
import { confirmPrivateBriefing } from './briefing-native-consent';
import { enrichPaper, loadPaperFigure, scholarCandidates } from './briefing-paper-evidence';
import { BriefingMemoryStore } from './briefing-memory-store';
import { BriefingMemoryEntrySchema, type PaperInsight } from './src/briefing-intelligence';
import { BriefingWorkspaceStore, type BriefingHistory } from './briefing-workspace-store';
import { CalendarService } from './calendar-service';
import {
  assistantModel,
  runBriefingAssistant,
  ChatRequestSchema,
  calendarWindow,
} from './briefing-assistant';
import { defaultAssistantPreferences, EventDraftSchema } from './src/workspace-contracts';
import { briefingClientContext, briefingClientHash } from './briefing-client-context';
import { SourceRateLimitError, SourceReadError } from './live-public-http';
import { PublicPaperLookup } from './briefing-public-paper-lookup';
import { saveHistoryFeedback } from './briefing-history-feedback';
import { BriefingModelSaveSchema, saveBriefingModelSelection } from './briefing-model-settings';
import { summarySourceDigest, summaryContextDigest } from './briefing-summary-cache';
import type { SummaryProvenance } from './src/summary-provenance';
import { MailOpenRequestSchema } from './src/mail-open-contract';
import { markOriginalMailRead, readOriginalMailStatus } from './briefing-mail-mark-read';
import { catalogForHistory, curateHistoryTags } from './briefing-paper-tags';
import { assignPaperTags } from './src/paper-tags';
import { safeAppleMailUrl } from './src/apple-mail-url';
import { openOriginalMail } from './briefing-mail-open';
import { readSavedPaperLibrary } from './briefing-knowledge';
import { resolveMailSearch } from './briefing-mail-search';
import { BriefingGeneration } from './briefing-generation';
import { BriefingGenerationStore, generationProfileDigest } from './briefing-generation-store';
import {
  GenerationRequestSchema,
  GenerationScheduleRequestSchema,
  type GenerationStatus,
} from './src/briefing-generation-contract';
import { savedPaperKey, type SavedPaper } from './src/paper-library-index';
import { indexSavedPapers } from './src/paper-library-index';
import type { classifySavedPaperTexts } from './paper-classification';
import {
  classificationGuard,
  classifyResolvedPapers,
  editResolvedPaper,
} from './paper-classification-service';
import { ClassifyPapersRequestSchema, EditClassificationSchema } from './src/paper-classification';
import type { SharedPaperSummaryLibrary } from './paper-summary-library';
import { approvedPaperSaveScope } from './briefing-paper-save-approval';
import {
  BriefingNotificationSnapshotSchema,
  type BriefingNotificationSnapshot,
} from './src/briefing-notifications';
import { PaperSummarySaveSchema } from './src/paper-summary-contract';
import { sharedPaperView } from './src/shared-paper-view';
import {
  historyPlan,
  prepareConversationContext,
  searchConversationRecords,
} from './briefing-context';
import { compactConversation } from './briefing-compaction';
import type { ContextUsage } from './src/context-usage';
import { BriefingAttachments } from './briefing-attachments';
import type {
  ProjectChatAttachmentService,
  ProjectChatAttachmentsForAgent,
} from '../desktop/src/main/project-chat-attachment-service';
import { HistoryRemovalTargetSchema, HistoryRestoreSchema } from './src/briefing-history-removal';
import {
  findSavedPaper,
  paperMetadataDigest,
  restorePaperEvidence,
  savedPaperProvenance,
} from './briefing-paper-cache';

const routineId = z.string().min(1).max(128);
function mailProgressDetail(value: MailReadProgress) {
  const label = {
    account: '계정 확인',
    mailbox: '메일함 확인',
    metadata: '메일 목록 읽기',
    body: '본문 미리보기 읽기',
  }[value.stage];
  return `${label} · ${value.scanned}건 확인`;
}
const AutomaticSummaryStartSchema = z
  .object({ routineId, receiptId: z.string().uuid(), force: z.boolean().optional().default(false) })
  .strict();
export const AutomaticSummaryBatchSchema = z
  .object({
    routineId,
    receiptId: z.string().uuid(),
    kind: z.enum(['papers', 'email']),
    offset: z.number().int().min(0).max(MAX_MAIL_LIMIT).default(0),
  })
  .strict();
const AutomaticSummaryJobSchema = z.object({
  id: z.string().uuid(),
  routineId,
  receiptId: z.string().uuid(),
  clientHash: z.string().length(64),
  feedbackProfileRevision: z.number().int().nonnegative().nullable(),
  state: z.enum(['running', 'complete', 'failed', 'cancelled']),
  percent: z.number().int().min(0).max(100),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  kind: z.enum(['email', 'papers', 'done']),
  range: z.string().max(80),
  detail: z.string().max(600),
  results: z.array(z.unknown()).max(30),
  error: z.string().max(600).nullable(),
  updatedAt: z.number().int().nonnegative(),
});
type AutomaticSummaryJob = z.infer<typeof AutomaticSummaryJobSchema> & {
  controller: AbortController;
  clientToken: string;
};
export function automaticSummaryPlan(
  items: readonly LiveItem[],
  preferences: ReturnType<typeof defaultAssistantPreferences>,
) {
  const selected = items.filter(
    (item) =>
      (item.kind === 'email' && preferences.mailRead && preferences.mailAi) ||
      (item.kind === 'papers' &&
        preferences.autoPaperSummary &&
        (!item.privateOrigin || preferences.mailAi)),
  );
  const kinds: ('email' | 'papers')[] = [];
  if (selected.some((item) => item.kind === 'email')) kinds.push('email');
  if (selected.some((item) => item.kind === 'papers')) kinds.push('papers');
  return { selected, kinds, total: selected.length };
}
export const LiveCollectSchema = z
  .object({ routineId, live: LiveSettingsSchema, interest: InterestProfileSchema })
  .strict();
export function sourceError(error: unknown) {
  if (error instanceof z.ZodError)
    return error.issues.some(
      (issue) =>
        issue.message === MAIL_LIMIT_ERROR ||
        ['live.mail.limit', 'scope.limit'].includes(issue.path.join('.')),
    )
      ? MAIL_LIMIT_ERROR
      : '조회 조건을 확인해주세요.';
  const code = error instanceof Error ? error.message : '';
  if (code === 'source_challenge_required')
    return '공개 원문 서버가 자동 접근 검증 페이지로 연결했습니다. 검증을 우회하지 않고 다른 공식 원문 경로를 확인합니다.';
  if (error instanceof SourceReadError && error.phase === 'timeout')
    return `${error.host} 응답이 GOSU의 대기 제한 시간을 초과해 중단했습니다. HTTP 429나 접속 차단이 확인된 것은 아닙니다.`;
  if (error instanceof SourceRateLimitError && error.phase === 'cooldown')
    return `${error.host}의 이전 요청 제한 이후 GOSU가 재요청을 대기 중입니다. 이번 요청은 서버에 보내지 않았습니다. ${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(error.retryAt)}(한국 시간) 이후 다시 확인할 수 있습니다.`;
  if (code === 'assistant_attachments_unavailable')
    return '파일 첨부는 설치된 GOSU 앱에서 사용할 수 있습니다.';
  if (code === 'attachment_expired' || code === 'attachment_scope_mismatch')
    return '첨부 파일이 만료됐거나 현재 대화 범위와 다릅니다. 파일을 다시 선택해주세요.';
  if (code === 'attachment_model_modality_unsupported')
    return '현재 모델은 이미지 입력을 지원하지 않습니다. 이미지 지원 모델을 선택해주세요.';
  if (code.startsWith('attachment_'))
    return '첨부 파일을 처리하지 못했습니다. 지원 형식·파일당 20MB·전체 50MB·최대 5개 제한을 확인해주세요.';
  if (code === 'assistant_queue_conflict')
    return '대기 질문이 이미 변경되었거나 실행을 시작했습니다. 최신 목록을 확인해주세요.';
  if (code === 'assistant_queue_limit')
    return '대기 질문은 최대 20개입니다. 기존 질문을 실행하거나 삭제해주세요.';
  if (code === 'assistant_chat_busy') return '이미 답변 중입니다. 질문을 대기열에 추가해주세요.';
  if (code === 'assistant_steer_text_only')
    return '현재 작업에는 텍스트만 보충할 수 있습니다. 첨부 질문은 먼저 실행을 사용해주세요.';
  if (code.startsWith('steer_') || code === 'assistant_turn_finished')
    return '보충 내용 전달을 확인하지 못했습니다. 자동 재전송하지 않습니다. 현재 작업 상태를 확인해주세요.';
  if (/^(assistant_context_too_large|assistant_compaction_)/.test(code))
    return '문맥 정리를 완료하지 못했습니다. 원본 대화는 유지됩니다. 짧은 질문으로 다시 시도하거나 모델 설정을 확인해주세요.';
  if (
    [
      '확인 가능한 arXiv 논문 링크가 필요합니다. 일반 대화나 검색 결과 페이지는 저장하지 않습니다.',
      '논문 원문 정보를 확인하지 못했습니다. 저장하지 않았습니다.',
      '논문 요약을 완료하지 못했습니다. 불완전한 항목은 저장하지 않습니다.',
      'Briefing Lab에서 논문 요약 모델을 설정해주세요.',
    ].includes(code)
  )
    return code;
  if (code === 'model_routing_provider_permission_required')
    return '설정의 역할별 모델과 Briefing 제공자가 다릅니다. Briefing 설정에서 제공자와 개인정보 전송 권한을 확인해주세요. 자동으로 제공자를 바꾸지 않습니다.';
  if (code === 'model_routing_unreadable')
    return 'GOSU 모델 사용 설정을 읽지 못했습니다. 다른 모델로 자동 전환하지 않습니다.';
  if (code === 'assistant_calendar_permission_required')
    return 'GOSU 연결 승인이 필요합니다. 설정의 Briefing Lab에서 캘린더를 확인하고 설정 저장을 눌러주세요. macOS 캘린더 권한은 별도입니다.';
  if (code === 'assistant_todo_permission_required')
    return '설정에서 GOSU 할 일 조회를 허용하고 저장해주세요.';
  if (code === 'assistant_todo_unavailable')
    return 'GOSU 앱 안의 Briefing Lab에서 할 일에 접근할 수 있습니다.';
  if (code === 'generation_always_required')
    return '자동 생성에는 요청 허용 설정의 ‘항상 허용’이 필요합니다. 설정에서 직접 선택해주세요.';
  if (code === 'generation_settings_changed')
    return '설정 또는 자동 실행 권한이 변경되어 생성을 중단했습니다. 저장된 항목은 유지됩니다.';
  if (code === 'generation_busy') return '다른 브리핑을 생성 중입니다. 잠시 후 다시 눌러주세요.';
  if (code === 'generation_unavailable') return '자동 생성 서버를 사용할 수 없습니다.';
  if (code === 'paper_classification_invalid')
    return 'AI 분류 결과를 검증하지 못했습니다. 기존 요약과 분류는 유지됩니다.';
  if (code === 'paper_classification_changed')
    return '요약 또는 분류가 변경됐습니다. 목록을 새로고침한 뒤 다시 선택해주세요.';
  if (code === 'paper_classification_unavailable')
    return '현재 서버에서 AI 분류를 사용할 수 없습니다. 기존 요약은 유지됩니다.';
  if (code === 'paper_classification_capacity')
    return '저장 가능한 분류 수에 도달했습니다. 기존 분류는 유지됩니다.';
  if (code === 'mail_mark_target_missing')
    return '현재 연결된 계정·메일함에서 이 메일을 정확히 찾지 못했습니다. 메일 위치와 연결 설정을 확인해주세요.';
  if (code === 'mail_mark_unconfirmed')
    return '읽음 처리 결과를 아직 확인하지 못했습니다. 이미 반영됐을 수 있습니다. 옆의 상태 확인 버튼으로 다시 확인해주세요.';
  if (code === 'mail_mark_locate_timeout')
    return '메일을 찾는 데 시간이 걸려 중단했습니다. 읽음 변경은 실행하지 않았습니다. 잠시 후 다시 눌러주세요.';
  if (code === 'mail_mark_locate_failed')
    return '메일 위치를 확인하지 못해 읽음 변경을 실행하지 않았습니다. Mail 앱 상태를 확인해주세요.';
  if (code === 'mail_mark_not_applied')
    return 'Apple Mail에서 아직 읽지 않은 상태로 확인됐습니다. 원하시면 읽음 처리를 다시 요청해주세요.';
  if (code === 'mail_mark_busy') return '이 메일을 읽음 처리하는 중입니다.';
  if (code === 'mail_open_target_missing' || code === 'mail_open_target_invalid')
    return '이 항목의 원본 메일 연결 정보를 확인하지 못했습니다. 메일을 다시 조회한 뒤 열어주세요.';
  if (code === 'mail_open_timeout')
    return 'Apple Mail 열기 요청의 완료를 확인하지 못했습니다. Mail에서 열린 상태인지 확인한 뒤 다시 눌러주세요.';
  if (code === 'mail_open_busy') return '이 메일의 열기 요청을 처리 중입니다.';
  if (code === 'mail_open_macos_required') return 'Apple Mail 원본 열기는 macOS에서만 지원합니다.';
  if (code === 'mail_open_failed')
    return 'Apple Mail에 열기 요청을 전달하지 못했습니다. Mail 앱을 실행할 수 있는지 확인해주세요.';
  if (code === 'assistant_model_selection_stale')
    return '다른 화면에서 모델 설정이 바뀌었습니다. 목록을 새로고침한 뒤 다시 선택해주세요.';
  if (code === 'assistant_model_busy')
    return '이 루틴의 자동 요약이 진행 중입니다. 완료 또는 중단 후 모델을 변경해주세요.';
  if (code === 'assistant_settings_required')
    return '먼저 루틴 설정을 한 번 저장해주세요. 기존 메일·Calendar 권한을 모델 메뉴에서 자동으로 만들지 않습니다.';
  if (code === 'briefing_refresh_busy')
    return '이 루틴의 요약이 진행 중입니다. 완료된 뒤 다시 요약해주세요.';
  if (code === 'briefing_refresh_source_missing')
    return '현재 허용된 조회 범위에서 같은 원자료를 찾지 못했습니다. 기존 요약은 유지했습니다. 메일함·조회 기간 또는 논문 버전을 확인해주세요.';
  if (code.startsWith('briefing_refresh_read_failed:'))
    return code.slice('briefing_refresh_read_failed:'.length);
  if (code === 'briefing_history_item_missing')
    return '저장된 항목을 찾지 못했습니다. 브리핑 이력을 다시 열어주세요.';
  if (/assistant_.*permission|assistant_private_ai|assistant_client|assistant_settings/.test(code))
    return '이 브라우저의 루틴 설정에서 해당 자료 접근·AI 사용을 허용하고 설정을 저장해주세요.';
  if (/calendar_permission/.test(code))
    return '설정에서 Apple Calendar 연결을 누르고 macOS Calendar 접근을 허용해주세요.';
  if (/calendar_event_changed/.test(code))
    return '일정 내용이 다른 곳에서 변경되어 저장·삭제를 중단했습니다. 최신 일정을 불러온 뒤 다시 실행해주세요.';
  if (/calendar_action_stale/.test(code))
    return '요청이 만료되었거나 이미 처리 중입니다. Calendar를 새로고침해 결과를 확인해주세요.';
  if (/calendar_readonly|calendar_invitation/.test(code))
    return '읽기 전용 캘린더 또는 참석자가 있는 초대 일정은 여기서 변경하지 않습니다. Apple Calendar에서 관리해주세요.';
  if (/calendar_/.test(code))
    return 'Calendar 작업을 완료하지 못했습니다. OS 접근 권한·캘린더 선택·일정 시간을 확인해주세요. 쓰기 결과가 불확실하면 자동 재시도하지 않습니다.';
  if (/routine_timeout|codex_timeout|claude_code_timeout/.test(code))
    return 'AI 요약 응답 시간이 초과됐습니다. 메일 연결 실패가 아닙니다. 항목 수나 reasoning을 줄여 다시 시도해주세요.';
  if (/routine_model_unavailable|routine_reasoning_unavailable/.test(code))
    return '선택한 AI 모델 또는 reasoning을 현재 사용할 수 없습니다. 모델 목록을 새로고침해주세요.';
  if (code === 'routine_output_schema_invalid')
    return 'AI 요청의 응답 형식이 서버 규칙과 맞지 않습니다. 앱 업데이트가 필요한 오류이며, 메일 연결을 다시 설정해도 해결되지 않습니다.';
  if (/routine_native_failed|routine_result_missing/.test(code))
    return 'LLM이 요약을 완료하지 못했습니다. 메일 읽기 연결과는 별개의 AI 실행 오류입니다.';
  if (/assistant_jobs_busy/.test(code))
    return '백그라운드 요약 작업이 이미 많습니다. 기존 작업이 끝난 뒤 다시 시도해주세요.';
  if (/assistant_confirmation_required/.test(code))
    return '이 루틴은 private 요청을 매번 확인하도록 설정되어 있어 자동 요약을 실행하지 않았습니다. 설정에서 항상 허용으로 바꾸거나 수동 요약을 실행해주세요.';
  if (/source_rate_limited/.test(code))
    return `${error instanceof SourceRateLimitError && error.phase === 'http' ? `${error.host}에서 HTTP 429 요청 제한 응답을 받았습니다.` : '논문 소스의 요청 제한이 보고됐습니다. 원래 HTTP 응답 정보는 기록되지 않았습니다.'}${error instanceof SourceRateLimitError ? ` ${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(error.retryAt)}(한국 시간)까지 추가 요청을 보내지 않습니다.` : ''} 이후에도 서비스 제한이 지속될 수 있습니다.`;
  if (/assistant_job_not_found/.test(code))
    return '이 브리핑 요약 작업을 찾지 못했습니다. 실제 자료를 다시 조회해주세요.';
  if (/native_consent/.test(code))
    return 'macOS 확인창에서 허용하지 않아 private 요청을 실행하지 않았습니다.';
  if (/briefing_memory_keychain/.test(code))
    return '자동 기억 저장소의 macOS Keychain을 사용할 수 없습니다. Keychain 확인창과 Mac 잠금 상태를 확인해주세요.';
  if (/briefing_memory_stale/.test(code))
    return '다른 분석이 기억을 갱신했습니다. 기억 목록을 다시 불러온 후 수정해주세요.';
  if (/briefing_memory/.test(code))
    return '자동 기억 저장소를 읽거나 저장하지 못했습니다. 기존 기억은 초기화하지 않았습니다.';
  if (/receipt_expired/.test(code))
    return '분석할 자료의 확인 정보가 만료됐습니다. 실제 자료를 다시 조회해주세요.';
  if (/quote_unverified/.test(code))
    return '한 차례 수정 후에도 인용 근거가 원문과 일치하지 않았습니다. 요약을 채택하지 않았습니다.';
  if (/email_content_missing/.test(code))
    return 'AI가 중요도 설명만 출력하고 메일 내용 요약을 누락했습니다. 이 결과는 정상 요약으로 저장하지 않았습니다.';
  if (/template_invalid/.test(code))
    return '한 차례 수정 후에도 논문 요약 템플릿(연구 질문·강점·약점과 한계·방법과 가정·보고된 결과)을 채우지 못했습니다. 요약을 채택하지 않았습니다.';
  if (/reference_invalid/.test(code))
    return '한 차례 수정 후에도 수식·그림의 원문 참조가 일치하지 않았습니다. 요약을 채택하지 않았습니다.';
  if (/briefing_analysis/.test(code))
    return 'AI 응답의 근거·항목·수식/그림 검증을 통과하지 못했습니다. 항목 수를 줄여 다시 시도해주세요.';
  if (/auth_required/.test(code))
    return '선택한 LLM 구독 계정에 다시 로그인해주세요. 다른 제공자로 전환하지 않았습니다.';
  if (
    /assistant_mail_scope_required|assistant_mail_permission_required|mail_scope_required|mail_account_refresh_required|mail_scope_response_invalid/.test(
      code,
    )
  )
    return 'Apple Mail 계정·메일함 또는 저장된 읽기 권한이 현재 설정과 다릅니다. 설정에서 계정·메일함 목록을 새로고침하고 선택한 범위를 다시 저장해주세요.';
  if (/scope_required|account_refresh/.test(code))
    return '메일 연결 조건이 없거나 만료되었습니다. 루틴 설정에서 계정·메일함을 확인하고 읽기 연결을 허용해주세요.';
  if (/permission_denied/.test(code))
    return 'Apple Mail 자동화 접근이 거부됐습니다. macOS 시스템 설정 → 개인정보 보호 및 보안 → 자동화에서 로컬 실행기의 Mail 접근을 확인해주세요.';
  if (/mail_timeout/.test(code)) {
    const stage = code.endsWith('_account')
      ? '계정 응답'
      : code.endsWith('_mailbox')
        ? '메일함 응답'
        : code.endsWith('_body')
          ? '본문 읽기'
          : '메일 목록 읽기';
    return `Apple Mail의 ${stage}가 지연되고 있습니다. Mail 앱에서 선택한 메일함이 열리는지 확인해주세요. 아직 가져오지 못한 자료는 요약하지 않았습니다.`;
  }
  if (/mail_macos/.test(code)) return 'Apple Mail 연결은 macOS에서 사용할 수 있습니다.';
  if (/cancel|abort/i.test(code)) return '조회가 중단됐습니다.';
  if (/timeout/.test(code)) return '소스 응답 시간이 초과됐습니다. 잠시 후 다시 시도해주세요.';
  if (/rate_limited/.test(code))
    return '소스의 요청 제한에 도달했습니다. 잠시 후 다시 시도해주세요.';
  if (/papers_keywords/.test(code)) return '루틴 설정에서 연구 키워드를 먼저 저장해주세요.';
  if (/query_too_large/.test(code))
    return '연구 키워드·동의어가 너무 많아 검색 요청을 만들지 못했습니다. 검색 주제를 줄여주세요.';
  if (/mail_/.test(code))
    return 'Apple Mail을 조회하지 못했습니다. Mail 앱 로그인·메일함 선택·자동화 권한을 확인해주세요.';
  return '소스를 조회하지 못했습니다. 네트워크 또는 응답 형식을 확인해주세요. 샘플로 대체하지 않았습니다.';
}
type CachedHistoryItem = BriefingHistory['items'][number];
function inferHistoryKind(item: Pick<CachedHistoryItem, 'kind' | 'readScope'>): LiveItem['kind'] {
  return item.kind ?? (item.readScope.startsWith('mail') ? 'email' : 'papers');
}
function toCachedInsight(item: LiveItem, cached: CachedHistoryItem): PaperInsight {
  const detail = item.kind === 'papers' ? (cached.detail ?? '') : '';
  const equations =
    item.kind === 'papers' && item.paper?.equations && cached.equations
      ? cached.equations.reduce(
          (result, equation) => {
            const candidate = item.paper?.equations.find((entry) => entry.latex === equation.latex);
            if (!candidate) return result;
            result.ids.push(candidate.id);
            result.explanations.push({
              equationId: candidate.id,
              explanation: equation.explanation,
            });
            return result;
          },
          {
            ids: [] as string[],
            explanations: [] as Array<{ equationId: string; explanation: string }>,
          },
        )
      : { ids: [], explanations: [] as Array<{ equationId: string; explanation: string }> };
  return {
    id: item.id,
    summary: cached.summary,
    importance: ['high', 'medium', 'low', 'uncertain'].includes(cached.importance)
      ? (cached.importance as PaperInsight['importance'])
      : 'uncertain',
    importanceReason:
      cached.importanceReason ?? '이전 요약에 중요도 근거가 별도로 기록되지 않았습니다.',
    relevance: item.kind === 'email' ? '' : (cached.relevance ?? ''),
    action: cached.action ?? '',
    detail,
    researchQuestion: item.kind === 'papers' ? cached.researchQuestion : undefined,
    strengths: item.kind === 'papers' ? cached.strengths : undefined,
    limitations: item.kind === 'papers' ? cached.limitations : undefined,
    methodsAndAssumptions: item.kind === 'papers' ? cached.methodsAndAssumptions : undefined,
    reportedResults: item.kind === 'papers' ? cached.reportedResults : undefined,
    keywords: item.kind === 'papers' ? cached.keywords : [],
    tags: item.kind === 'papers' ? cached.tags : [],
    // A saved interpretation is not an original-source quotation.
    evidenceQuote: '',
    equationIds: item.kind === 'papers' ? equations.ids : [],
    equationExplanations: equations.explanations.length ? equations.explanations : undefined,
    figureIds: (cached.figures ?? []).flatMap((f) =>
      item.paper?.figures.some(
        (v) => v.id === f.id && v.caption === f.caption && v.assetUrl === f.assetUrl,
      )
        ? [f.id]
        : [],
    ),
    memorySuggestion: null,
  };
}
export class LiveSourceService {
  private publicPaperLookup?: PublicPaperLookup;
  private paperLookup() {
    return (this.publicPaperLookup ??= new PublicPaperLookup({ arxiv: this.providers.papers }));
  }
  private chatQueue?: BriefingChatQueue;
  private attachments?: BriefingAttachments;
  setAttachments(service: ProjectChatAttachmentService) {
    this.attachments = new BriefingAttachments(this.workspace, service);
  }
  private openingMail = new Set<string>();
  private markingMail = new Set<string>();
  private refreshing = new Set<string>();
  private calendarClients = new Map<string, number>();
  private memoryEditors = new Map<string, { routineId: string; expiresAt: number }>();
  private receipts = new Map<
    string,
    { input: z.infer<typeof LiveCollectSchema>; results: LiveSourceResult[]; expiresAt: number }
  >();
  private automaticSummaryJobs = new Map<string, AutomaticSummaryJob>();
  // Wired only by the production host or explicitly injected test store; never an agent tool.
  sharedPaperLibrary?: Pick<SharedPaperSummaryLibrary, 'save' | 'list'> &
    Partial<Pick<SharedPaperSummaryLibrary, 'remove'>>;
  paperClassifier?: typeof classifySavedPaperTexts;
  generation?: BriefingGeneration;
  todoReader?: TodoReader;
  projectBridge?: ProjectBridge;
  modelRouting?: () => Promise<ModelRouting>;
  desktopConfiguration() {
    return this.workspace.desktopConfiguration();
  }
  private notificationRead: Promise<BriefingNotificationSnapshot> | undefined;
  private notificationCalendar:
    | {
        key: string;
        at: number;
        items: BriefingNotificationSnapshot['calendar'];
        state: BriefingNotificationSnapshot['calendarState'];
        limited: boolean;
      }
    | undefined;
  notificationSnapshot(): Promise<BriefingNotificationSnapshot> {
    if (this.notificationRead) return this.notificationRead;
    this.notificationRead = this.readNotificationSnapshot().finally(() => {
      this.notificationRead = undefined;
    });
    return this.notificationRead;
  }
  private async readNotificationSnapshot(): Promise<BriefingNotificationSnapshot> {
    const data = await this.workspace.desktopNotificationData();
    const key = JSON.stringify(data.calendarIds);
    let calendar: BriefingNotificationSnapshot['calendar'] = [];
    let calendarState: BriefingNotificationSnapshot['calendarState'] =
      data.calendarConfirmationRequired ? 'confirmation-required' : 'disabled';
    let calendarLimited = false;
    if (data.calendarIds.length) {
      if (
        !this.notificationCalendar ||
        this.notificationCalendar.key !== key ||
        Date.now() - this.notificationCalendar.at >= 60000
      ) {
        try {
          const now = Date.now();
          const events: Awaited<ReturnType<CalendarService['events']>>['events'] = [];
          let limited = false,
            failed = false;
          const signal = AbortSignal.timeout(15000);
          for (let offset = 0; offset < data.calendarIds.length; offset += 30) {
            try {
              const batch = await this.calendar.events(
                data.calendarIds.slice(offset, offset + 30),
                new Date(now).toISOString(),
                new Date(now + 8 * 86400000).toISOString(),
                signal,
              );
              events.push(...batch.events.filter((event) => Date.parse(event.end) > now));
              limited ||= batch.limited;
            } catch {
              failed = true;
              if (signal.aborted) break;
            }
          }
          events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
          const response = {
            events: events.slice(0, 500),
            limited: limited || events.length > 500,
          };
          this.notificationCalendar = {
            key,
            at: Date.now(),
            state: failed ? 'unavailable' : 'ready',
            limited: response.limited,
            items: response.events.map(
              ({ id, calendarId, title, start, end, allDay, timeZone, alarmMinutes }) => ({
                routineId: data.calendarOwners[calendarId]!,
                id,
                calendarId,
                title,
                start,
                end,
                allDay,
                timeZone,
                alarmMinutes,
              }),
            ),
          };
        } catch {
          this.notificationCalendar = {
            key,
            at: Date.now(),
            state: 'unavailable',
            items: [],
            limited: false,
          };
        }
      }
      const current = await this.workspace.desktopNotificationData();
      if (JSON.stringify(current.calendarIds) === key && this.notificationCalendar) {
        calendar = this.notificationCalendar.items.map((event) => ({
          ...event,
          routineId: current.calendarOwners[event.calendarId]!,
        }));
        calendarState = this.notificationCalendar.state;
        calendarLimited = this.notificationCalendar.limited;
      }
    } else this.notificationCalendar = undefined;
    return BriefingNotificationSnapshotSchema.parse({
      briefings: data.briefings,
      calendar,
      calendarState,
      calendarLimited,
    });
  }
  enableGeneration(store = new BriefingGenerationStore(), timer = true) {
    this.generation = new BriefingGeneration(
      this.workspace,
      (p, signal, update, scheduled) => this.generateDaily(p, signal, update, scheduled),
      sourceError,
      store,
      Date.now,
      (profile, job, signal, result) =>
        this.workspace.recordBriefingNotification(profile, job, signal, result?.emailKeys),
    );
    if (timer) this.generation.startTimer();
    return this.generation;
  }
  private async generateDaily(
    profile: NonNullable<Awaited<ReturnType<BriefingWorkspaceStore['profile']>>>,
    signal: AbortSignal,
    update: (value: Partial<GenerationStatus>) => void,
    scheduled: boolean,
  ) {
    const digest = generationProfileDigest(profile);
    const guard = async () => {
      if (signal.aborted) throw new Error('source_cancelled');
      const current = await this.workspace.profile(profile.routineId);
      if (!current || !this.workspace.owns(current) || generationProfileDigest(current) !== digest)
        throw new Error('generation_settings_changed');
      if (scheduled) {
        const schedule = await this.generation?.store.record(profile.routineId);
        if (
          !schedule?.intervalHours ||
          schedule.profileDigest !== digest ||
          profile.preferences.confirmationPolicy !== 'always'
        )
          throw new Error('generation_settings_changed');
      }
    };
    await guard();
    const daily = await this.workspace.dailyRun(profile, signal);
    update({
      runId: daily.runId,
      detail: '오늘 브리핑에 새 자료를 확인하는 중…',
      progress: { stage: 'collect', completed: 0, total: null },
    });
    const live = {
      ...profile.live,
      ...(daily.hasWeather ? { weather: null } : {}),
      ...(!profile.preferences.mailRead ? { mail: null } : {}),
    };
    const results =
      live.weather || live.mail || live.papers.enabled
        ? await this.collect(
            { routineId: profile.routineId, live, interest: profile.interest },
            signal,
            (value) => update({ detail: value.detail ?? `${value.kind} 자료 확인 중…` }),
            true,
            daily.runId,
            guard,
          )
        : [];
    await guard();
    const warnings = results.flatMap((r) => [
      ...(r.status === 'failed' ? [r.error ?? '자료 조회 실패'] : []),
      ...(r.historyWarning ? [r.historyWarning] : []),
    ]);
    const knownEmails = new Set(await this.workspace.dailyItemKeys(profile.routineId, daily.runId));
    const emailKeys = [
      ...new Set(
        deduplicateVerifiedMail(results.flatMap((r) => r.items))
          .filter((i) => i.kind === 'email' && !knownEmails.has(`email:${savedPaperKey(i)}`))
          .map((i) => savedPaperKey(i)),
      ),
    ];
    update({
      discoveredEmails: emailKeys.length,
      emailSourceState: results.find((r) => r.kind === 'email')?.status ?? 'disabled',
    });
    if (
      !daily.hasCalendar &&
      profile.preferences.calendarRead &&
      profile.preferences.calendarIds.length
    ) {
      try {
        update({
          detail: '오늘·내일 일정 준비 중…',
          progress: { stage: 'calendar', completed: 0, total: null },
        });
        await this.workspace.assertCalendar(profile.routineId, profile.preferences.calendarIds);
        if (this.workspace.requiresPerRequestConfirmation(profile))
          await this.consent('이번 브리핑에 승인된 Calendar 일정을 불러올까요?', signal);
        const range = calendarWindow(profile.timeZone);
        const agenda = await this.calendar.events(
          profile.preferences.calendarIds,
          range.start,
          range.end,
          signal,
        );
        await guard();
        await this.workspace.saveAgendaSnapshot(
          profile.routineId,
          daily.runId,
          agenda.events,
          profile,
          signal,
          range.start,
        );
      } catch (e) {
        if (signal.aborted) throw e;
        warnings.push(sourceError(e));
      }
    }
    if (profile.preferences.todoRead) {
      try {
        await guard();
        await this.workspace.assertTodoRead(profile.routineId);
        if (!this.todoReader) throw new Error('assistant_todo_unavailable');
        if (this.workspace.requiresPerRequestConfirmation(profile))
          await this.consent('GOSU의 미완료 할 일을 읽어 이번 일정 브리핑에 포함할까요?', signal);
        update({ detail: 'GOSU 할 일 확인 중…' });
        const todos = BriefingTodosSchema.parse(await this.todoReader());
        await guard();
        await this.workspace.saveTodoSnapshot(
          profile.routineId,
          daily.runId,
          todos,
          profile,
          signal,
        );
        update({ todoCount: todos.items.length });
      } catch (error) {
        if (signal.aborted) throw error;
        const message = sourceError(error);
        warnings.push(message);
        await this.workspace.saveTodoSnapshot(
          profile.routineId,
          daily.runId,
          null,
          profile,
          signal,
          message,
        );
      }
    }
    const receiptId = results[0]?.receiptId;
    if (receiptId) {
      const known = new Set(await this.workspace.dailyItemKeys(profile.routineId, daily.runId));
      const { selected, kinds } = automaticSummaryPlan(
        results
          .flatMap((r) => r.items)
          .filter((item) => !known.has(`${item.kind}:${savedPaperKey(item)}`)),
        profile.preferences,
      );
      let count = 0;
      const addedSummaries = { email: 0, papers: 0 };
      update({ progress: { stage: 'summarize', completed: 0, total: selected.length } });
      let model: Awaited<ReturnType<typeof assistantModel>> | undefined;
      for (const kind of kinds) {
        const items = selected.filter((i) => i.kind === kind);
        for (let offset = 0; offset < items.length; offset += 6) {
          await guard();
          // Analysis may outlive the original ten-minute UI receipt; only this owned active job extends it.
          const receipt = this.receipts.get(receiptId);
          if (receipt) receipt.expiresAt = Date.now() + 10 * 60000;
          const batch = items.slice(offset, offset + 6);
          update({
            detail: `${kind === 'email' ? '이메일' : '논문'} ${offset + 1}–${offset + batch.length}번째 요약 준비 중`,
          });
          const result = await this.analyze(
            {
              routineId: profile.routineId,
              receiptId,
              itemIds: batch.map((i) => i.id),
              providerId: profile.preferences.providerId,
              modelId: profile.preferences.modelId || 'auto',
              reasoning: profile.preferences.reasoning,
              includeMail: profile.preferences.mailAi,
              memory: [],
            },
            signal,
            (detail) => update({ detail }),
            scheduled,
            daily.runId,
            async () => {
              await guard();
              model ??= await this.modelResolver(profile.preferences);
              return model.modelId;
            },
            guard,
          );
          if (!result.historyId) throw new Error('briefing_memory_unavailable');
          count += batch.length;
          addedSummaries[kind] += batch.length;
          update({
            newCount: count,
            addedSummaries: { ...addedSummaries },
            progress: { stage: 'summarize', completed: count, total: selected.length },
            detail: `새 ${kind === 'email' ? '이메일' : '논문'} 요약 저장됨`,
          });
        }
      }
    }
    await guard();
    update({
      progress: { stage: 'finalize', completed: 0, total: null },
      detail: '브리핑 마무리 중…',
    });
    if (warnings.length) update({ error: warnings.join(' ').slice(0, 1000) });
    return { emailKeys };
  }
  constructor(
    readonly mail = new AppleMailConnection(),
    private readonly providers = {
      cities: findWeatherCities,
      weather: readWeather,
      papers: searchPapers,
    },
    private readonly consent = confirmPrivateBriefing,
    private readonly analyzer = analyzeBriefing,
    private readonly memory = new BriefingMemoryStore(),
    private readonly workspace = new BriefingWorkspaceStore(),
    private readonly calendar = new CalendarService(),
    private readonly modelResolver: typeof assistantModel = assistantModel,
    private readonly openMail = openOriginalMail,
    private readonly markMail = markOriginalMailRead,
    private readonly checkMail = readOriginalMailStatus,
  ) {}
  close() {
    this.generation?.close();
    this.mail.close();
    this.receipts.clear();
    this.memoryEditors.clear();
    for (const job of this.automaticSummaryJobs.values()) job.controller.abort();
    this.automaticSummaryJobs.clear();
  }
  private publicAutomaticSummaryJob(job: AutomaticSummaryJob) {
    const { controller: _controller, clientToken: _clientToken, ...publicJob } = job;
    return AutomaticSummaryJobSchema.parse(publicJob);
  }
  private async runAutomaticSummaryJob(job: AutomaticSummaryJob) {
    await briefingClientContext.run(job.clientToken, async () => {
      try {
        const receipt = this.receipts.get(job.receiptId),
          profile = await this.workspace.profile(job.routineId);
        if (!receipt || receipt.expiresAt < Date.now() || receipt.input.routineId !== job.routineId)
          throw new Error('briefing_receipt_expired');
        if (profile && !this.workspace.owns(profile)) throw new Error('assistant_client_required');
        const preferences = profile?.preferences ?? defaultAssistantPreferences(),
          plan = automaticSummaryPlan(
            receipt.results.flatMap((result) => result.items),
            preferences,
          ),
          { selected, kinds } = plan;
        if (selected.some((item) => item.kind === 'email')) {
          if (!profile) throw new Error('assistant_private_ai_required');
          if (!profile.live.mail) throw new Error('assistant_mail_scope_required');
          await this.workspace.assertMail(
            job.routineId,
            profile.live.mail!,
            true,
            preferences.providerId,
          );
        }
        const total = plan.total;
        job.total = total;
        if (!total) {
          job.percent = 100;
          job.kind = 'done';
          job.range = '0/0';
          job.detail = '자동 요약할 항목 없음';
          job.state = 'complete';
          job.updatedAt = Date.now();
          return;
        }
        let model: Awaited<ReturnType<typeof assistantModel>> | undefined;
        for (const kind of kinds) {
          const items = selected.filter((item) => item.kind === kind);
          for (let offset = 0; offset < items.length; offset += 6) {
            if (job.controller.signal.aborted) throw new Error('source_cancelled');
            const batch = items.slice(offset, offset + 6),
              end = offset + batch.length;
            job.kind = kind;
            job.range = `${offset + 1}–${end}/${items.length}`;
            job.percent = Math.round((job.completed / total) * 100);
            job.detail = `${kind === 'email' ? '이메일' : '논문'} 이전 요약 및 근거 확인 중`;
            job.updatedAt = Date.now();
            const result = await this.analyze(
              {
                routineId: job.routineId,
                receiptId: job.receiptId,
                itemIds: batch.map((item) => item.id),
                providerId: preferences.providerId,
                modelId: preferences.modelId || 'auto',
                reasoning: preferences.reasoning,
                includeMail: kind === 'email',
                memory: [],
              },
              job.controller.signal,
              (detail) => {
                job.detail = detail;
                job.updatedAt = Date.now();
              },
              true,
              undefined,
              async () => {
                model ??= await this.modelResolver(preferences);
                return model.modelId;
              },
            );
            job.results.push({ ...result, kind });
            job.completed += batch.length;
            job.percent = Math.round((job.completed / total) * 100);
            job.range = `${job.completed}/${total}`;
            job.detail = `${kind === 'email' ? '이메일' : '논문'} 요약 완료`;
            job.updatedAt = Date.now();
          }
        }
        job.kind = 'done';
        job.percent = 100;
        job.range = `${job.completed}/${total}`;
        job.detail = '이메일 요약 후 논문 요약까지 완료';
        job.state = 'complete';
        job.updatedAt = Date.now();
      } catch (error) {
        job.state = job.controller.signal.aborted ? 'cancelled' : 'failed';
        job.error = sourceError(error);
        job.detail = job.state === 'cancelled' ? '사용자가 요약을 중단했습니다.' : '자동 요약 실패';
        job.updatedAt = Date.now();
      }
    });
  }
  private async startAutomaticSummary(raw: unknown) {
    const input = AutomaticSummaryStartSchema.parse(raw),
      clientToken = briefingClientContext.getStore();
    if (!clientToken || !/^[a-f0-9]{64}$/.test(clientToken))
      throw new Error('assistant_client_required');
    const clientHash = briefingClientHash()!;
    let feedbackProfileRevision: number | null = null;
    try {
      const status = await this.memory.status?.(input.routineId);
      if (
        Number.isSafeInteger(status?.feedbackProfileRevision) &&
        status.feedbackProfileRevision >= 0
      )
        feedbackProfileRevision = status.feedbackProfileRevision;
    } catch {
      /* No verified revision: never reconnect to a completed personalized result. */
    }
    const cutoff = Date.now() - 30 * 60_000;
    for (const [id, job] of this.automaticSummaryJobs)
      if (job.state !== 'running' && job.updatedAt < cutoff) this.automaticSummaryJobs.delete(id);
    for (const job of this.automaticSummaryJobs.values())
      if (
        job.routineId === input.routineId &&
        job.receiptId === input.receiptId &&
        job.clientHash === clientHash &&
        (job.state === 'running' ||
          (!input.force &&
            feedbackProfileRevision !== null &&
            job.feedbackProfileRevision === feedbackProfileRevision))
      )
        return this.publicAutomaticSummaryJob(job);
    const receipt = this.receipts.get(input.receiptId);
    if (!receipt || receipt.expiresAt < Date.now() || receipt.input.routineId !== input.routineId)
      throw new Error('briefing_receipt_expired');
    const profile = await this.workspace.profile(input.routineId);
    if (profile && !this.workspace.owns(profile)) throw new Error('assistant_client_required');
    const preferences = profile?.preferences ?? defaultAssistantPreferences(),
      sourceItems = receipt.results.flatMap((r) => r.items),
      plan = automaticSummaryPlan(sourceItems, preferences);
    if (
      plan.selected.some((item) => item.kind === 'email') &&
      (!profile || !preferences.mailRead || !preferences.mailAi || !profile.live.mail)
    )
      throw new Error('assistant_private_ai_required');
    if (this.automaticSummaryJobs.size >= 8) throw new Error('assistant_jobs_busy');
    const job: AutomaticSummaryJob = {
      id: randomUUID(),
      routineId: input.routineId,
      receiptId: input.receiptId,
      clientHash,
      feedbackProfileRevision,
      state: 'running',
      percent: 0,
      completed: 0,
      total: 0,
      kind: 'email',
      range: '준비 중',
      detail: '자동 요약 job 준비 중',
      results: [],
      error: null,
      updatedAt: Date.now(),
      controller: new AbortController(),
      clientToken,
    };
    this.automaticSummaryJobs.set(job.id, job);
    void this.runAutomaticSummaryJob(job);
    return this.publicAutomaticSummaryJob(job);
  }
  private automaticSummaryJob(id: string, routine: string) {
    const job = this.automaticSummaryJobs.get(id);
    if (!job || job.routineId !== routine || job.clientHash !== briefingClientHash())
      throw new Error('assistant_job_not_found');
    return job;
  }
  async collect(
    raw: unknown,
    signal: AbortSignal,
    progress: (value: LiveProgress) => void,
    persistSnapshot = true,
    historyRunId?: string,
    beforeSave?: () => Promise<void>,
  ) {
    const input = LiveCollectSchema.parse(raw);
    const summarized =
      persistSnapshot &&
      input.live.papers.enabled &&
      typeof this.workspace.summaryHistory === 'function'
        ? summarizedPaperKeys(await this.workspace.summaryHistory(input.routineId))
        : new Set<string>();
    if (signal.aborted) throw new Error('source_cancelled');
    let mailProfileSnapshot: string | undefined;
    const tasks: { kind: LiveKind; run: () => Promise<{ items: LiveItem[]; note: string }> }[] = [];
    if (input.live.weather)
      tasks.push({
        kind: 'weather',
        run: async () => ({
          items: await this.providers.weather(input.live.weather!, signal),
          note: '선택한 도시의 Open-Meteo 예보. 위치를 자동 추적하지 않습니다.',
        }),
      });
    if (input.live.papers.enabled)
      tasks.push({
        kind: 'papers',
        run: async () => ({
          items: await this.providers.papers(
            input.interest,
            input.live.papers,
            signal,
            undefined,
            undefined,
            summarized,
          ),
          note: `루틴 키워드·저자·최근 ${input.live.papers.days}일 조건. 최신 후보 최대 ${Math.min(60, input.live.papers.limit * 3)}개 안에서 관련성으로 정렬하고, 저장된 동일 버전 요약을 먼저 제외한 뒤 최대 ${input.live.papers.limit}개를 선택합니다. AI 요약과 원문 발췌는 별도로 표시합니다.`,
        }),
      });
    if (input.live.mail)
      tasks.push({
        kind: 'email',
        run: async () => {
          const mailProgress = (value: MailReadProgress) => {
            progress({
              kind: 'email',
              state: 'started',
              detail: mailProgressDetail(value),
            });
          };
          const profile = await this.workspace.profile(input.routineId);
          mailProfileSnapshot = JSON.stringify(profile);
          if (profile) {
            await this.workspace.assertMail(input.routineId, input.live.mail!);
            if (this.workspace.requiresPerRequestConfirmation(profile))
              await this.consent(
                `Apple Mail 읽기 요청\n루틴 ${input.routineId}\n설정한 메일 범위만 읽습니다.`,
                signal,
              );
            await this.mail.restorePolicyGrant(input.routineId, input.live.mail!, signal);
            const plan = persistSnapshot
              ? await this.workspace.mailReadPlan(input.routineId, input.live.mail!)
              : undefined;
            const result = await this.mail.collect(
              input.routineId,
              input.live.mail!,
              signal,
              mailProgress,
              plan,
            );
            await this.workspace.assertMail(input.routineId, input.live.mail!);
            if (plan)
              await this.workspace.completeMailRead(
                profile,
                result.completedAccounts ?? [],
                signal,
              );
            const { completedAccounts: _completed, ...display } = result;
            return display;
          }
          this.mail.assertScope(input.routineId, input.live.mail!);
          await this.consent(
            `Apple Mail 읽기 요청\n루틴 ${input.routineId}\n최근 ${input.live.mail!.days}일 · 최대 ${input.live.mail!.limit}개 · ${input.live.mail!.bodyPreview ? '본문 앞부분 포함' : '메타데이터만'}\nLLM 전송은 별도 허용이 필요합니다. 직접 시작한 요청일 때만 허용하세요.`,
            signal,
          );
          return this.mail.collect(input.routineId, input.live.mail!, signal, mailProgress);
        },
      });
    if (!tasks.length) throw new Error('source_selection_required');
    const results = await Promise.all(
      tasks.map(async ({ kind, run }): Promise<LiveSourceResult> => {
        progress({ kind, state: 'started' });
        try {
          const value = await run();
          if (signal.aborted) throw new Error('source_cancelled');
          progress({ kind, state: 'completed', count: value.items.length });
          return {
            kind,
            status: value.items.length ? 'ready' : 'empty',
            fetchedAt: new Date().toISOString(),
            ...value,
          };
        } catch (error) {
          if (signal.aborted) throw error;
          progress({ kind, state: 'completed', count: 0 });
          return {
            kind,
            status: 'failed',
            fetchedAt: new Date().toISOString(),
            items: [],
            note: '조회 실패는 결과 0건과 다릅니다.',
            error: sourceError(error),
          };
        }
      }),
    );
    const checkCollectedMail = async () => {
      if (!input.live.mail || !results.some((r) => r.kind === 'email' && r.items.length)) return;
      const profile = await this.workspace.profile(input.routineId);
      if (signal.aborted) throw new Error('source_cancelled');
      if (JSON.stringify(profile) !== mailProfileSnapshot)
        throw new Error('assistant_settings_changed');
      if (profile) await this.workspace.assertMail(input.routineId, input.live.mail);
      this.mail.assertScope(input.routineId, input.live.mail);
    };
    await checkCollectedMail();
    if (input.live.mail && input.live.papers.scholarAlerts !== false) {
      const candidates = input.live.mail.bodyPreview
        ? scholarCandidates(results.find((r) => r.kind === 'email')?.items ?? [])
        : [];
      let papers = results.find((r) => r.kind === 'papers');
      if (!papers) {
        papers = {
          kind: 'papers',
          status: 'empty',
          items: [],
          fetchedAt: new Date().toISOString(),
          note: 'Google Scholar 알림에서 발견한 논문 후보.',
        };
        results.push(papers);
      }
      const ids = new Set(papers.items.map((item) => item.id));
      for (const candidate of candidates)
        if (!ids.has(candidate.id)) {
          papers.items.push(candidate);
          ids.add(candidate.id);
        }
      if (papers.items.length) papers.status = 'ready';
      papers.note += input.live.mail.bodyPreview
        ? ` 조회한 메일에서 Google Scholar 알림의 논문 후보 ${candidates.length}개를 추출해 중복을 제거했습니다. 명백한 상업 광고 항목만 제외하며 애매한 항목은 유지합니다. 원본 메일은 삭제하지 않습니다. 메일함·기간·조회 개수 범위 안에서만 가져오며 발신 진위는 검증하지 않았습니다.`
        : ' Google Scholar 알림 추출에는 메일 본문 미리보기 허용이 필요합니다.';
    }
    if (
      persistSnapshot &&
      results.some((r) => r.kind === 'papers') &&
      typeof this.workspace.summaryHistory === 'function'
    ) {
      const previous = await this.workspace.summaryHistory(input.routineId);
      if (signal.aborted) throw new Error('source_cancelled');
      await checkCollectedMail();
      const filtered = newPaperResults(results, previous);
      results.splice(0, results.length, ...filtered);
    }
    const receiptId = randomUUID();
    for (const [id, receipt] of this.receipts)
      if (receipt.expiresAt < Date.now()) this.receipts.delete(id);
    while (this.receipts.size >= 12) this.receipts.delete(this.receipts.keys().next().value!);
    this.receipts.set(receiptId, {
      input,
      results: structuredClone(results),
      expiresAt: Date.now() + 10 * 60_000,
    });
    try {
      await beforeSave?.();
      if (persistSnapshot)
        await this.workspace.saveCollection?.(
          input.routineId,
          historyRunId ?? receiptId,
          results,
          await this.workspace.profile(input.routineId),
          signal,
        );
    } catch (error) {
      if (signal.aborted) {
        this.receipts.delete(receiptId);
        throw error;
      }
      results[0]!.historyWarning = `브리핑 이력 저장 실패: ${sourceError(error)}`;
    }
    try {
      await checkCollectedMail();
    } catch (error) {
      this.receipts.delete(receiptId);
      throw error;
    }
    return results.map((result) => ({ ...result, receiptId }));
  }
  async analyze(
    raw: unknown,
    signal: AbortSignal,
    progress: (detail: string) => void,
    automatic = false,
    historyRunId?: string,
    resolveModel?: () => Promise<string>,
    executionGuard?: () => Promise<void>,
  ) {
    const input = AnalysisRequestSchema.parse(raw),
      receipt = this.receipts.get(input.receiptId);
    if (!receipt || receipt.expiresAt < Date.now() || receipt.input.routineId !== input.routineId)
      throw new Error('briefing_receipt_expired');
    if (new Set(input.itemIds).size !== input.itemIds.length)
      throw new Error('briefing_analysis_id_invalid');
    const available = receipt.results.flatMap((result) => result.items),
      rawItems = input.itemIds.map((id) => {
        const item = available.find((item) => item.id === id && item.kind !== 'weather');
        if (!item) throw new Error('briefing_analysis_id_invalid');
        return item;
      });
    const items = structuredClone(rawItems);
    const privateItems = items.filter(
      (item) => item.kind === 'email' || item.privateOrigin === 'mail',
    );
    if (privateItems.length) {
      if (!input.includeMail || !receipt.input.live.mail)
        throw new Error('briefing_mail_analysis_consent_required');
      this.mail.assertScope(input.routineId, receipt.input.live.mail);
    }
    const profile = await this.workspace.profile(input.routineId);
    const routedPreferences = profile
      ? routedBriefingPreferences(profile.preferences, await this.modelRouting?.(), 'briefing')
      : undefined;
    const usesRouting = Boolean(profile && routedPreferences !== profile.preferences);
    if (usesRouting && routedPreferences) {
      input.providerId = routedPreferences.providerId;
      input.modelId = routedPreferences.modelId!;
      input.reasoning = routedPreferences.reasoning;
    }
    if (profile && privateItems.length)
      await this.workspace.assertMail(
        input.routineId,
        receipt.input.live.mail!,
        true,
        input.providerId,
      );
    let stored: Awaited<ReturnType<BriefingMemoryStore['related']>> = [],
      memoryWarning = '';
    try {
      stored = await this.memory.related(input.routineId, items.map((i) => i.title).join(' '));
    } catch (error) {
      memoryWarning = sourceError(error);
      progress(`${memoryWarning} 이번 요약은 현재 자료만 사용합니다.`);
    }
    const privateAi = await this.workspace.canPrivateAi(input.routineId, input.providerId);
    const perRequestConfirmation = Boolean(
      profile && this.workspace.requiresPerRequestConfirmation(profile),
    );
    let feedbackProfile: FeedbackProfile = {
      total: 0,
      important: 0,
      notInterested: 0,
      kindScores: { papers: 0, email: 0 },
      preferredKeywords: [],
      avoidedKeywords: [],
    };
    const feedbackProfileReader = (
      this.memory as unknown as {
        feedbackProfile?: (routineId: string, includePrivate?: boolean) => Promise<FeedbackProfile>;
      }
    ).feedbackProfile;
    if (typeof feedbackProfileReader === 'function') {
      try {
        feedbackProfile = await feedbackProfileReader.call(this.memory, input.routineId, privateAi);
      } catch (error) {
        progress(
          `개인화 피드백을 읽지 못했습니다. 현재 자료만으로 진행합니다: ${sourceError(error)}`,
        );
      }
    }
    const feedbackProfileRevision =
      Number.isSafeInteger(feedbackProfile.feedbackProfileRevision) &&
      feedbackProfile.feedbackProfileRevision! >= 0
        ? feedbackProfile.feedbackProfileRevision!
        : null;
    if ((profile || automatic) && !privateAi) stored = stored.filter((entry) => !entry.private);
    const guard = async () => {
      await executionGuard?.();
      if (signal.aborted) throw new Error('source_cancelled');
      if (privateItems.length) {
        this.mail.assertScope(input.routineId, receipt.input.live.mail!);
        if (profile)
          await this.workspace.assertMail(
            input.routineId,
            receipt.input.live.mail!,
            true,
            input.providerId,
          );
      }
      if (privateAi && !(await this.workspace.canPrivateAi(input.routineId, input.providerId)))
        throw new Error('assistant_settings_changed');
    };
    const memoryInput = [
      ...input.memory,
      ...stored.map(({ id, routineId, kind, text, sourceId, createdAt }) => ({
        id,
        routineId,
        kind,
        text,
        sourceId,
        createdAt,
      })),
    ]
      .filter(
        (entry, index, all) =>
          entry.routineId === input.routineId && all.findIndex((e) => e.id === entry.id) === index,
      )
      .slice(0, 12);
    const hasPrivateContext =
      privateItems.length > 0 ||
      input.memory.length > 0 ||
      stored.some((entry) => entry.private) ||
      Boolean(feedbackProfile.hasPrivateFeedback);
    let privateReadConfirmed = !perRequestConfirmation;
    if (hasPrivateContext && (!privateAi || perRequestConfirmation)) {
      if (perRequestConfirmation && automatic) throw new Error('assistant_confirmation_required');
      if (!perRequestConfirmation && (profile || automatic))
        throw new Error('assistant_private_ai_required');
      await this.consent(
        `Briefing AI 분석 요청\n${input.providerId} · ${input.modelId}\n항목 ${items.length}개 (메일 유래 ${privateItems.length}개), Briefing memory ${memoryInput.length}개를 전달합니다.\n검증된 요약은 로컬 backend 기억에 자동 저장합니다. 제공자/CLI의 대화 보관 정책도 적용됩니다.\n직접 요청한 분석일 때만 허용하세요.`,
        signal,
      );
      privateReadConfirmed = true;
    }
    let cachedHistory: Awaited<ReturnType<BriefingWorkspaceStore['history']>> = [];
    let paperHistory: typeof cachedHistory = [];
    try {
      const historyInput = await this.workspace.summaryHistory(input.routineId);
      paperHistory = historyInput.filter(
        (entry) =>
          entry.kind === 'briefing' && ((privateAi && privateReadConfirmed) || !entry.private),
      );
      cachedHistory = historyInput
        .filter((entry) => entry.kind === 'briefing')
        .filter(
          (entry) =>
            feedbackProfileRevision !== null &&
            entry.feedbackProfileRevision === feedbackProfileRevision,
        )
        .filter((entry) => (privateAi && privateReadConfirmed ? true : !entry.private));
    } catch (error) {
      progress(`캐시 조회 실패: ${sourceError(error)} 기존 자료만으로 진행합니다.`);
    }
    const cachedItems = new Map<string, PaperInsight>();
    const provenance: Record<string, SummaryProvenance> = {};
    const cachedCandidates = cachedHistory.flatMap((entry) =>
      entry.items.map((item) => ({ item, private: entry.private })),
    );
    let cachedPrivateContext = false;
    // Version-bound saved summaries precede all arXiv HTML/figure work. Explicit refresh bypasses it.
    for (let index = 0; index < items.length; index++) {
      await guard();
      const rawItem = items[index]!;
      const metadataDigest = paperMetadataDigest(rawItem);
      const rawContextDigest = summaryContextDigest(
        rawItem,
        receipt.input.interest,
        receipt.input.live.mail,
      );
      const saved =
        !input.refresh && profile && this.workspace.owns?.(profile)
          ? findSavedPaper(rawItem, paperHistory)
          : null;
      if (saved) {
        const restored = restorePaperEvidence(rawItem, saved.cached);
        items[index] = restored;
        cachedItems.set(rawItem.id, toCachedInsight(restored, saved.cached));
        cachedPrivateContext ||= saved.entry.private;
        provenance[rawItem.id] = savedPaperProvenance(
          saved,
          rawContextDigest,
          feedbackProfileRevision,
        );
        continue;
      }
      const item = (items[index] =
        items[index]!.kind === 'papers' ? await enrichPaper(items[index]!, signal) : items[index]!);
      const sourceDigest = summarySourceDigest(item);
      const legacyMailDigest =
        item.kind === 'email' && item.mailContentProof
          ? summarySourceDigest({ ...item, mailContentProof: undefined })
          : null;
      const contextDigest = summaryContextDigest(
        item,
        receipt.input.interest,
        receipt.input.live.mail,
      );
      const source =
        !input.refresh &&
        cachedCandidates.find(
          ({ item: cached }) =>
            inferHistoryKind(cached) === item.kind &&
            !(item.kind === 'email' && isPriorityOnlyEmailSummary(cached.summary)) &&
            (cached.id === item.id || sameVerifiedMail(cached, item)) &&
            cached.provenance?.version === 1 &&
            (cached.provenance.sourceDigest === sourceDigest ||
              (cached.id === item.id &&
                legacyMailDigest !== null &&
                cached.provenance.sourceDigest === legacyMailDigest)) &&
            cached.provenance.contextDigest === contextDigest,
        );
      if (source) {
        cachedItems.set(item.id, toCachedInsight(item, source.item));
        cachedPrivateContext ||= source.private;
      }
      provenance[item.id] = {
        version: 1,
        sourceDigest,
        contextDigest,
        summarizedAt: source ? (source.item.provenance!.summarizedAt ?? '') : '',
        reused: Boolean(source),
        ...(item.kind === 'papers'
          ? { sourceMetadataDigest: metadataDigest, feedbackProfileRevision }
          : {}),
      };
    }
    const analysisItems = items.filter((item) => !cachedItems.has(item.id));
    const tagCatalog = catalogForHistory(
      paperHistory,
      input.routineId,
      privateAi && privateReadConfirmed,
    );
    const privateTagContext =
      tagCatalog.length > 0 &&
      paperHistory.some((h) => h.private && h.items.some((i) => i.kind === 'papers'));
    const cache = {
      feedbackProfileRevision,
      reusedItemIds: [...cachedItems.keys()],
      generatedItemIds: analysisItems.map((item) => item.id),
    };
    if (cachedItems.size)
      progress(
        analysisItems.length
          ? `캐시 ${cachedItems.size}건 재사용 · ${analysisItems.length}건 새로 요약`
          : '캐시 재사용 · LLM 호출 없음',
      );
    if (signal.aborted) throw new Error('source_cancelled');
    const enriched = analysisItems;
    if (analysisItems.length && usesRouting && routedPreferences)
      input.modelId = (await this.modelResolver(routedPreferences)).modelId;
    else if (analysisItems.length && resolveModel) input.modelId = await resolveModel();
    await guard();
    if (privateItems.length) this.mail.assertScope(input.routineId, receipt.input.live.mail!);
    if (signal.aborted) throw new Error('source_cancelled');
    const result =
      analysisItems.length > 0
        ? await this.analyzer(
            { ...input, memory: memoryInput },
            enriched,
            receipt.input.interest,
            signal,
            progress,
            undefined,
            guard,
            feedbackProfile,
            tagCatalog,
          )
        : {
            overview: '',
            items: [],
            invocation: { providerId: input.providerId, model: 'cached', reasoning: null },
            memoryUsed: [],
          };
    await guard();
    if (analysisItems.length > 0) {
      const analyzed = new Set(result.items.map((i) => i.id));
      if (analyzed.size !== result.items.length)
        throw new Error('briefing_analysis_coverage_invalid');
      for (const item of items) {
        if (!cachedItems.has(item.id) && !analyzed.has(item.id))
          throw new Error('briefing_analysis_id_invalid');
      }
    }
    {
      progress(
        analysisItems.length
          ? '새 요약의 선택된 수식·그림을 확인하는 중'
          : '저장된 수식·그림 불러오기 · arXiv 재조회 없음',
      );
      for (const item of items) {
        if (cachedItems.has(item.id)) continue;
        const insight = cachedItems.get(item.id) ?? result.items.find((i) => i.id === item.id);
        let imageCount = 0;
        for (const figure of item.paper?.figures ?? []) {
          if (!insight?.figureIds.includes(figure.id) || imageCount >= 2) continue;
          try {
            figure.imageData = await loadPaperFigure(
              figure.assetUrl,
              item.paper!.sourceUrl,
              signal,
            );
            imageCount++;
          } catch {
            if (signal.aborted) throw new Error('source_cancelled');
          }
        }
      }
    }
    const cachedOverview = Array.from(cachedItems.values())
      .map((cached) => cached.summary)
      .join(' · ');
    if (result.overview)
      result.overview = [result.overview, cachedOverview].filter(Boolean).join(' · ');
    else result.overview = cachedOverview || '저장된 요약에서 재사용한 결과가 없습니다.';
    if (result.overview.length > 800) result.overview = `${result.overview.slice(0, 780)}...`;
    result.items = items
      .map((item) => cachedItems.get(item.id) ?? result.items.find((i) => i.id === item.id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    for (const insight of result.items)
      if (items.find((i) => i.id === insight.id)?.kind === 'papers') {
        insight.tags = assignPaperTags(
          insight.tags ?? insight.keywords ?? [],
          tagCatalog,
          !cachedItems.has(insight.id),
        );
      }
    const summarizedAt = new Date().toISOString();
    for (const entry of Object.values(provenance))
      if (!entry.reused) entry.summarizedAt = summarizedAt;
    if (privateItems.length) this.mail.assertScope(input.routineId, receipt.input.live.mail!);
    if (signal.aborted) throw new Error('source_cancelled');
    let memorySave: {
      state: 'saved' | 'failed';
      saved: number;
      revision: number | null;
      warning: string;
    } = { state: 'failed', saved: 0, revision: null, warning: memoryWarning };
    progress('요약 완료 · Briefing memory를 backend에 자동 저장하는 중');
    await guard();
    try {
      const saved = await this.memory.record(
        input.routineId,
        items,
        result,
        receipt.input.interest,
        signal,
        guard,
        hasPrivateContext || cachedPrivateContext || privateTagContext,
      );
      memorySave = { state: 'saved', ...saved, warning: memoryWarning };
    } catch (error) {
      if (signal.aborted) throw error;
      memorySave.warning = sourceError(error);
      progress(`요약은 완료됐지만 ${memorySave.warning}`);
    }
    if (privateItems.length) this.mail.assertScope(input.routineId, receipt.input.live.mail!);
    if (signal.aborted) throw new Error('source_cancelled');
    let historyId: string | null = null;
    await guard();
    try {
      historyId = await this.workspace.saveBriefing(
        input.routineId,
        result,
        items,
        hasPrivateContext || cachedPrivateContext || privateTagContext,
        profile,
        feedbackProfileRevision,
        historyRunId ?? input.receiptId,
        provenance,
      );
    } catch (error) {
      memorySave.warning = [memorySave.warning, sourceError(error)].filter(Boolean).join(' ');
    }
    // Classify only freshly generated, durably saved paper summaries. Cache-only reads stay zero-inference.
    if (historyId && profile && this.paperClassifier && cache.generatedItemIds.length) {
      try {
        const fresh = await this.workspace.classificationViews(
          input.routineId,
          indexSavedPapers(await this.workspace.summaryHistory(input.routineId)).filter(
            (p) =>
              p.historyId === historyId &&
              cache.generatedItemIds.includes(p.item.id) &&
              p.item.classification?.source !== 'user',
          ),
        );
        for (let start = 0; start < fresh.length; start += 6) {
          progress('저장한 논문 요약에서 연구 분야를 분류하는 중 · 원문 재조회 없음');
          await classifyResolvedPapers(
            this.workspace,
            profile,
            fresh.slice(start, start + 6),
            input,
            this.paperClassifier,
            signal,
            progress,
          );
        }
      } catch (error) {
        if (signal.aborted) throw error;
        progress(
          `요약은 저장됐습니다. 분류는 논문 요약 탭에서 다시 실행할 수 있습니다. ${sourceError(error)}`,
        );
      }
    }
    return {
      ...result,
      cache,
      provenance,
      memorySave,
      historyId,
      evidence: items.map((item) => ({
        id: item.id,
        paper: item.paper ? { ...item.paper, excerpt: '' } : undefined,
      })),
    };
  }
  async refreshSummary(raw: unknown, signal: AbortSignal, progress: (detail: string) => void) {
    const input = z
      .object({
        routineId,
        itemId: z.string().min(1).max(160),
        receiptId: z.string().uuid().optional(),
        historyId: z.string().min(1).max(128).optional(),
      })
      .strict()
      .refine((v) => Boolean(v.receiptId) !== Boolean(v.historyId))
      .parse(raw);
    const profile = await this.workspace.profile(input.routineId);
    if (!briefingClientHash() || !profile || !this.workspace.owns(profile))
      throw new Error('assistant_client_required');
    if (
      this.refreshing.has(input.routineId) ||
      [...this.automaticSummaryJobs.values()].some(
        (j) => j.routineId === input.routineId && j.state === 'running',
      )
    )
      throw new Error('briefing_refresh_busy');
    this.refreshing.add(input.routineId);
    try {
      let receiptId = input.receiptId;
      let historyRunId: string | undefined;
      if (input.historyId) {
        const history = (await this.workspace.summaryHistory(input.routineId)).find(
          (h) => h.id === input.historyId && h.kind === 'briefing',
        );
        const saved = history?.items.find((i) => i.id === input.itemId);
        if (!history || !saved || saved.kind === 'weather')
          throw new Error('briefing_history_item_missing');
        const kind = inferHistoryKind(saved);
        const match = (item: LiveItem) =>
          item.id === saved.id &&
          item.kind === kind &&
          (!saved.sourceUrl || item.sourceUrl === saved.sourceUrl);
        const existing = [...this.receipts.entries()]
          .reverse()
          .find(
            ([, r]) =>
              r.expiresAt > Date.now() &&
              r.input.routineId === input.routineId &&
              JSON.stringify(r.input.interest) === JSON.stringify(profile.interest) &&
              r.results.some((s) => s.items.some(match)),
          );
        if (existing) receiptId = existing[0];
        else {
          // No raw email archive: reacquire only the selected source in the saved permission scope.
          // Never send the old AI summary as if it were an original document.
          if (kind === 'email' && (!profile.live.mail || !profile.preferences.mailRead))
            throw new Error('assistant_private_ai_required');
          if (kind === 'papers' && !profile.live.papers.enabled)
            throw new Error('briefing_refresh_source_missing');
          if (
            (kind === 'email' || history.private) &&
            !(await this.workspace.canPrivateAi(input.routineId, profile.preferences.providerId))
          )
            throw new Error('assistant_private_ai_required');
          progress('같은 원자료를 저장된 조회 범위에서 다시 확인하는 중');
          const results = await this.collect(
            {
              routineId: input.routineId,
              interest: profile.interest,
              live: {
                ...profile.live,
                weather: null,
                mail: kind === 'email' ? profile.live.mail : null,
                papers: {
                  ...profile.live.papers,
                  enabled: kind === 'papers',
                  scholarAlerts: false,
                },
              },
            },
            signal,
            (p) => {
              if (p.detail) progress(p.detail);
            },
            false,
          );
          if (!results.some((s) => s.items.some(match))) {
            const failure = results.find((s) => s.status === 'failed');
            if (failure?.error) throw new Error(`briefing_refresh_read_failed:${failure.error}`);
            throw new Error('briefing_refresh_source_missing');
          }
          receiptId = results[0]!.receiptId;
        }
        historyRunId = history.runId ?? history.id;
      }
      if (JSON.stringify(await this.workspace.profile(input.routineId)) !== JSON.stringify(profile))
        throw new Error('assistant_settings_changed');
      const model = await this.modelResolver(profile.preferences);
      const result = await this.analyze(
        {
          routineId: input.routineId,
          receiptId,
          itemIds: [input.itemId],
          providerId: profile.preferences.providerId,
          modelId: model.modelId,
          reasoning: profile.preferences.reasoning,
          includeMail: profile.preferences.mailAi,
          memory: [],
          refresh: true,
        },
        signal,
        progress,
        false,
        historyRunId,
      );
      // A completed automatic job must not replay its older snapshot after an explicit refresh.
      for (const [id, job] of this.automaticSummaryJobs)
        if (job.routineId === input.routineId && job.state !== 'running')
          this.automaticSummaryJobs.delete(id);
      return result;
    } finally {
      this.refreshing.delete(input.routineId);
    }
  }
  async handle(req: IncomingMessage, res: ServerResponse, signal: AbortSignal) {
    const json = (status: number, value: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json'))
      return json(405, { error: 'POST JSON 요청이 필요합니다.' });
    let bytes = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req) {
        const value = Buffer.from(chunk as Uint8Array);
        bytes += value.length;
        const bodyLimit = req.url?.split('?')[0]?.endsWith('/papers/shared/save') ? 256000 : 64000;
        if (bytes > bodyLimit) return json(413, { error: '요청이 너무 큽니다.' });
        chunks.push(value);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (signal.aborted) return;
      const path =
        new URL(req.url!, 'http://127.0.0.1:4318').pathname
          .replace('/api/briefing-agent/sources', '')
          .replace(/\/+$/u, '') || '/';
      if (path.startsWith('/generation/')) {
        if (!this.generation) throw new Error('generation_unavailable');
        if (path === '/generation/schedule') {
          const input = GenerationScheduleRequestSchema.parse(body);
          return json(
            200,
            await this.generation.configure(input.routineId, input.intervalHours, signal),
          );
        }
        const input = GenerationRequestSchema.parse(body);
        if (path === '/generation/start')
          return json(200, await this.generation.start(input.routineId));
        if (path === '/generation/status')
          return json(200, await this.generation.status(input.routineId));
        if (path === '/generation/cancel')
          return json(200, await this.generation.cancel(input.routineId));
      }
      if (path === '/papers/shared/save') {
        if (!this.sharedPaperLibrary) throw new Error('paper_library_unavailable');
        const input = PaperSummarySaveSchema.parse(body);
        return json(200, await this.sharedPaperLibrary.save(input, 'Briefing Lab', signal));
      }
      if (path === '/papers/saved/delete') {
        const input = z
          .object({
            routineId,
            confirmed: z.literal(true),
            targets: z
              .array(
                z.object({ historyId: z.string().max(200), itemId: z.string().max(200) }).strict(),
              )
              .min(1)
              .max(100),
          })
          .strict()
          .parse(body);
        const profile = await this.workspace.profile(input.routineId);
        if (!profile || !this.workspace.owns(profile)) throw new Error('assistant_client_required');
        if (new Set(input.targets.map((t) => JSON.stringify(t))).size !== input.targets.length)
          throw new Error('paper_delete_duplicate');
        const library = await readSavedPaperLibrary(this.workspace, input.routineId, signal);
        const shared = ((await this.sharedPaperLibrary?.list()) ?? []).map(sharedPaperView);
        const selected = input.targets.map((target) =>
          [...library.papers, ...shared].find(
            (p) => p.historyId === target.historyId && p.item.id === target.itemId,
          ),
        );
        if (selected.some((p) => !p))
          throw new Error('삭제할 항목이 변경됐습니다. 목록을 새로 불러와 주세요.');
        const sharedIds = selected
          .filter((p) => p!.historyId.startsWith('shared:'))
          .map((p) => p!.historyId.slice(7));
        if (sharedIds.length && !this.sharedPaperLibrary?.remove)
          throw new Error('paper_library_unavailable');
        if (signal.aborted) throw new Error('source_cancelled');
        if (sharedIds.length) await this.sharedPaperLibrary!.remove!(sharedIds);
        await this.workspace.removeLibraryPapers(
          profile,
          selected.filter((p) => !p!.historyId.startsWith('shared:')) as SavedPaper[],
        );
        return json(200, { deleted: input.targets.length });
      }
      if (path === '/papers/saved') {
        const input = z.object({ routineId }).strict().parse(body);
        const profile = await this.workspace.profile(input.routineId);
        const { papers: routinePapers, privateOmitted } = profile
          ? await readSavedPaperLibrary(this.workspace, input.routineId, signal)
          : { papers: [], privateOmitted: false };
        let sharedWarning = '';
        const shared = (
          (await this.sharedPaperLibrary?.list().catch(() => {
            sharedWarning =
              '대화에서 저장한 공유 분석을 읽지 못했습니다. 기존 브리핑 요약은 유지됩니다.';
            return [];
          })) ?? []
        ).map(sharedPaperView);
        const papers = (
          await this.workspace.classificationViews(input.routineId, [...routinePapers, ...shared])
        ).sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
        let feedback: Record<string, 'important' | 'not-interested'> = {};
        try {
          feedback = await this.memory.feedbackChoices(
            input.routineId,
            papers.map((p) => p.item.id),
          );
        } catch {
          /* Summary reading does not depend on feedback availability. */
        }
        if (signal.aborted) throw new Error('source_cancelled');
        if (
          JSON.stringify(await this.workspace.profile(input.routineId)) !== JSON.stringify(profile)
        )
          throw new Error('assistant_settings_changed');
        return json(200, {
          papers,
          feedback,
          ...(sharedWarning ? { warning: sharedWarning } : {}),
          privateOmitted,
        });
      }
      if (path === '/papers/classify' || path === '/papers/classification/edit') {
        const manual = path.endsWith('/edit');
        const input = manual
          ? EditClassificationSchema.parse(body)
          : ClassifyPapersRequestSchema.parse(body);
        const profile = await this.workspace.profile(input.routineId);
        if (!profile || !this.workspace.owns(profile)) throw new Error('assistant_client_required');
        const library = await readSavedPaperLibrary(this.workspace, input.routineId, signal);
        const shared = ((await this.sharedPaperLibrary?.list()) ?? []).map(sharedPaperView);
        const papers = await this.workspace.classificationViews(input.routineId, [
          ...library.papers,
          ...shared,
        ]);
        const targets = 'target' in input ? [input.target] : input.targets;
        if (new Set(targets.map((t) => t.key)).size !== targets.length)
          throw new Error('paper_classification_invalid');
        const selected = targets.map((t) => {
          const p = papers.find((paper) => paper.classificationKey === t.key);
          if (!p || (p.item.classification?.revision ?? 0) !== t.expectedRevision)
            throw new Error('paper_classification_changed');
          return p;
        });
        await classificationGuard(this.workspace, profile, signal);
        let saved: string[];
        if ('categoryId' in input) {
          saved = await editResolvedPaper(
            this.workspace,
            profile,
            selected[0]!,
            input.target.expectedRevision,
            input.categoryId,
            signal,
          );
        } else {
          if (!this.paperClassifier) throw new Error('paper_classification_unavailable');
          const pending = selected.filter(
            (p) =>
              p.item.classification?.source !== 'user' &&
              (input.refresh || !p.item.classification || p.item.classification.stale),
          );
          if (!pending.length) return json(200, { saved: [], skipped: selected.length });
          const privateAi = pending.some((p) => p.private || p.historyId.startsWith('shared:'));
          await classificationGuard(this.workspace, profile, signal, privateAi);
          if (privateAi && this.workspace.requiresPerRequestConfirmation(profile))
            await this.consent(
              '저장된 비공개 논문 요약을 선택한 AI에 보내 연구 분야를 분류합니다. 원문은 다시 조회하지 않습니다.',
              signal,
            );
          const model = await this.modelResolver(profile.preferences);
          saved = await classifyResolvedPapers(
            this.workspace,
            profile,
            pending,
            {
              providerId: profile.preferences.providerId,
              modelId: model.modelId,
              reasoning: profile.preferences.reasoning,
            },
            this.paperClassifier,
            signal,
            () => undefined,
          );
        }
        return json(200, { saved, skipped: selected.length - saved.length });
      }
      if (path === '/mail/mark-read' || path === '/mail/read-status') {
        const readOnly = path === '/mail/read-status';
        const input = MailOpenRequestSchema.parse(body);
        const profile = await this.workspace.profile(input.routineId);
        if (!profile?.live.mail) throw new Error('assistant_mail_permission_required');
        const check = async () => {
          if (signal.aborted) throw new Error('source_cancelled');
          const current = await this.workspace.assertMail(input.routineId, profile.live.mail!);
          if (JSON.stringify(current) !== JSON.stringify(profile))
            throw new Error('assistant_settings_changed');
        };
        await check();
        const key = JSON.stringify([input.routineId, input.itemId]);
        if (this.markingMail.has(key)) throw new Error('mail_mark_busy');
        this.markingMail.add(key);
        try {
          const resolve = async () => {
            await check();
            if ('receiptId' in input) {
              const receipt = this.receipts.get(input.receiptId);
              if (
                !receipt ||
                receipt.expiresAt < Date.now() ||
                receipt.input.routineId !== input.routineId
              )
                throw new Error('briefing_receipt_expired');
              return receipt.results
                .flatMap((r) => r.items)
                .find((i) => i.kind === 'email' && i.id === input.itemId);
            }
            return (await this.workspace.summaryHistory(input.routineId))
              .find((h) => h.id === input.historyId)
              ?.items.find(
                (i) =>
                  (i.kind === 'email' || i.readScope.startsWith('mail')) && i.id === input.itemId,
              );
          };
          const item = await resolve(),
            url = safeAppleMailUrl(item?.mailMessageUrl);
          const targets = mailTargets(profile.live.mail);
          const target = item?.mailAccount
            ? targets.find((candidate) => candidate.accountId === item.mailAccount!.id)
            : targets.length === 1
              ? targets[0]
              : undefined;
          if (!url || !target) throw new Error('mail_mark_target_missing');
          if (this.workspace.requiresPerRequestConfirmation(profile))
            await this.consent(
              readOnly
                ? '이메일 읽음 상태 확인\n선택한 한 통의 읽음 상태만 확인합니다. 메일을 변경하거나 열지 않습니다.'
                : '이메일 읽음 처리\n선택한 한 통만 Apple Mail에서 읽음으로 표시합니다. 메일을 열거나 보내거나 삭제하지 않습니다.',
              signal,
            );
          const mailbox = await this.mail.resolveMailbox(
            { ...profile.live.mail, ...target },
            signal,
          );
          const beforeWrite = async () => {
            const current = await resolve();
            if (safeAppleMailUrl(current?.mailMessageUrl) !== url)
              throw new Error('mail_mark_target_missing');
          };
          const result = readOnly
            ? await this.checkMail(
                mailbox,
                input.itemId,
                url,
                signal,
                beforeWrite,
                undefined,
                item?.mailNativeId,
              )
            : await this.markMail(
                mailbox,
                input.itemId,
                url,
                signal,
                beforeWrite,
                undefined,
                item?.mailNativeId,
              );
          if (result.status !== 'read') return json(200, { status: 'unread' });
          for (const receipt of this.receipts.values())
            if (receipt.input.routineId === input.routineId)
              for (const source of receipt.results)
                for (const value of source.items) {
                  if (
                    value.id === input.itemId &&
                    value.kind === 'email' &&
                    value.mailMessageUrl === url
                  )
                    value.mailMarkedReadAt = result.markedAt;
                }
          let historyWarning = '';
          try {
            await this.workspace.markMailRead(
              input.routineId,
              input.itemId,
              url,
              result.markedAt,
              profile,
              signal,
            );
          } catch {
            historyWarning = 'Apple Mail은 읽음 처리됐지만 브리핑 표시를 저장하지 못했습니다.';
          }
          return json(200, { ...result, ...(historyWarning ? { historyWarning } : {}) });
        } catch (error) {
          if (error instanceof Error && error.message === 'mail_mark_unconfirmed')
            return json(200, { status: 'unconfirmed', error: sourceError(error) });
          throw error;
        } finally {
          this.markingMail.delete(key);
        }
      }
      if (path === '/mail/open') {
        const input = MailOpenRequestSchema.parse(body);
        const profile = await this.workspace.profile(input.routineId);
        if (!profile) throw new Error('assistant_settings_required');
        if (!this.workspace.owns(profile)) throw new Error('assistant_client_required');
        const key = JSON.stringify([briefingClientHash(), input.routineId, input.itemId]);
        if (this.openingMail.has(key)) throw new Error('mail_open_busy');
        this.openingMail.add(key);
        try {
          const assertProfile = async () => {
            const current = await this.workspace.profile(input.routineId);
            if (signal.aborted) throw new Error('source_cancelled');
            if (
              !current ||
              !this.workspace.owns(current) ||
              JSON.stringify(current) !== JSON.stringify(profile)
            )
              throw new Error('assistant_settings_changed');
          };
          const resolveTarget = async () => {
            await assertProfile();
            if ('receiptId' in input) {
              const receipt = this.receipts.get(input.receiptId);
              if (
                !receipt ||
                receipt.expiresAt < Date.now() ||
                receipt.input.routineId !== input.routineId
              )
                throw new Error('briefing_receipt_expired');
              return receipt.results
                .flatMap((r) => r.items)
                .find((i) => i.kind === 'email' && i.id === input.itemId);
            }
            const history = (await this.workspace.history(input.routineId, '', 600)).find(
              (h) => h.id === input.historyId,
            );
            return history?.items.find(
              (i) =>
                (i.kind === 'email' || (!i.kind && i.readScope.startsWith('mail'))) &&
                i.id === input.itemId,
            );
          };
          const item = await resolveTarget();
          const url = safeAppleMailUrl(item?.mailMessageUrl);
          if (!url) throw new Error('mail_open_target_missing');
          if (profile.preferences.mailOpenConfirmation === 'ask')
            await this.consent(
              'Apple Mail 원본 열기\n선택한 메일을 Apple Mail에서 열까요? Mail 앱 설정에 따라 읽음 처리될 수 있습니다. 메일 보내기·삭제·AI 분석은 실행하지 않습니다.',
              signal,
            );
          const latest = await resolveTarget();
          if (signal.aborted) throw new Error('source_cancelled');
          if (safeAppleMailUrl(latest?.mailMessageUrl) !== url)
            throw new Error('mail_open_target_missing');
          await assertProfile();
          await this.openMail(url, signal);
          return json(200, { status: 'requested' });
        } finally {
          this.openingMail.delete(key);
        }
      }
      if (path === '/assistant/model/save') {
        const input = BriefingModelSaveSchema.parse(body);
        const idle = () => {
          if (
            [...this.automaticSummaryJobs.values()].some(
              (j) => j.routineId === input.routineId && j.state === 'running',
            )
          )
            throw new Error('assistant_model_busy');
        };
        idle();
        return json(
          200,
          await saveBriefingModelSelection(
            input,
            this.workspace,
            this.modelResolver,
            this.consent,
            signal,
            idle,
          ),
        );
      }
      if (path === '/assistant/model/current') {
        const input = z.object({ routineId }).strict().parse(body);
        const profile = await this.workspace.profile(input.routineId);
        if (!profile) throw new Error('assistant_settings_required');
        const preferences = routedBriefingPreferences(
          profile.preferences,
          await this.modelRouting?.(),
          'briefingAssistant',
        );
        const model = await this.modelResolver(preferences);
        return json(200, {
          modelId: model.modelId,
          displayName: model.displayName,
          reasoning: preferences.reasoning,
        });
      }
      if (path === '/assistant/settings/get') {
        const input = z.object({ routineId }).strict().parse(body);
        return json(200, await this.workspace.publicProfile(input.routineId));
      }
      if (
        path === '/assistant/settings/connection-status' ||
        path === '/assistant/settings/reconnect'
      ) {
        const input = z.object({ routineId }).strict().parse(body);
        const profile = await this.workspace.profile(input.routineId);
        const needsApproval = Boolean(
          profile &&
          this.workspace.requiresApproval(profile) &&
          (!this.workspace.owns(profile) || !this.workspace.approved(profile)),
        );
        if (path.endsWith('/reconnect') && profile && needsApproval) {
          const {
            owners: _owners,
            approvedScope: _approved,
            updatedAt: _updated,
            ...saved
          } = profile;
          await this.workspace.save(
            saved,
            (message) => this.consent(message, signal),
            profile,
            signal,
          );
          return json(200, { needsApproval: false });
        }
        return json(200, { needsApproval });
      }
      if (path === '/assistant/settings/deactivate') {
        const input = z.object({ routineId }).strict().parse(body),
          p = await this.workspace.profile(input.routineId);
        if (p) {
          if (!this.workspace.owns(p)) throw new Error('assistant_client_required');
          const { approvedScope: _approved, updatedAt: _updated, owners: _owners, ...data } = p;
          await this.workspace.save(
            {
              ...data,
              preferences: {
                ...p.preferences,
                mailRead: false,
                mailAi: false,
                calendarRead: false,
                autoPaperSummary: false,
                calendarIds: [],
              },
            },
            (message) => this.consent(message, signal),
          );
        }
        this.mail.revoke(input.routineId);
        return json(200, { deactivated: true });
      }
      if (path === '/assistant/settings/save') {
        const input = z
          .object({
            routineId,
            name: z.string().min(1).max(160),
            timeZone: z.string().max(100),
            live: LiveSettingsSchema,
            interest: InterestProfileSchema,
          })
          .strict()
          .parse(body);
        const preferences = input.live.assistant ?? defaultAssistantPreferences();
        if (preferences.calendarRead && !preferences.calendarIds.length)
          throw new Error('calendar_scope_missing');
        const nextLive = {
          ...input.live,
          mail: input.live.mail
            ? { ...input.live.mail, bodyPreview: preferences.mailBodyPreview }
            : input.live.mail,
        };
        const saved = await this.workspace.save(
          { ...input, live: nextLive, preferences },
          (message) => this.consent(message, signal),
        );
        this.mail.revoke(input.routineId);
        return json(200, {
          saved: true,
          preferences: saved.preferences,
          approved: this.workspace.approved(saved),
        });
      }
      if (path === '/summary/refresh') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
        res.flushHeaders();
        const send = (value: unknown) => {
          if (!signal.aborted && !res.destroyed) res.write(`${JSON.stringify(value)}\n`);
        };
        try {
          const result = await this.refreshSummary(body, signal, (detail) =>
            send({ type: 'analysis-progress', detail }),
          );
          send({ type: 'result', result });
        } catch (error) {
          send({ type: 'error', message: sourceError(error) });
        } finally {
          res.end();
        }
        return;
      }
      if (path === '/assistant/auto-analyze') {
        const input = AutomaticSummaryBatchSchema.parse(body);
        const receipt = this.receipts.get(input.receiptId);
        if (
          !receipt ||
          receipt.input.routineId !== input.routineId ||
          receipt.expiresAt < Date.now()
        )
          throw new Error('briefing_receipt_expired');
        const profile = await this.workspace.profile(input.routineId),
          preferences = profile?.preferences ?? defaultAssistantPreferences();
        if (input.kind === 'papers' && !preferences.autoPaperSummary)
          return json(200, { skipped: true });
        if (
          input.kind === 'email' &&
          (!profile ||
            !(await this.workspace.canPrivateAi(input.routineId, preferences.providerId)))
        )
          throw new Error('assistant_private_ai_required');
        const ids = receipt.results
          .flatMap((r) => r.items)
          .filter((i) =>
            input.kind === 'email'
              ? i.kind === 'email'
              : i.kind === 'papers' && (!i.privateOrigin || preferences.mailAi),
          )
          .slice(input.offset, input.offset + 6)
          .map((i) => i.id);
        if (!ids.length) return json(200, { skipped: true });
        const model = await assistantModel(preferences);
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
        res.flushHeaders();
        const send = (value: unknown) => {
          if (!signal.aborted && !res.destroyed) res.write(`${JSON.stringify(value)}\n`);
        };
        try {
          const result = await this.analyze(
            {
              routineId: input.routineId,
              receiptId: input.receiptId,
              itemIds: ids,
              providerId: preferences.providerId,
              modelId: model.modelId,
              reasoning: preferences.reasoning,
              includeMail: preferences.mailAi,
              memory: [],
            },
            signal,
            (detail) => send({ type: 'analysis-progress', detail }),
            true,
          );
          send({ type: 'result', result: { ...result, kind: input.kind } });
        } catch (error) {
          send({ type: 'error', message: sourceError(error) });
        } finally {
          res.end();
        }
        return;
      }
      if (path === '/assistant/auto-summary/start') {
        const job = await this.startAutomaticSummary(body);
        return json(202, job);
      }
      if (path === '/assistant/auto-summary/status') {
        const input = z.object({ routineId, jobId: z.string().uuid() }).strict().parse(body),
          job = this.automaticSummaryJob(input.jobId, input.routineId);
        return json(200, this.publicAutomaticSummaryJob(job));
      }
      if (path === '/assistant/auto-summary/cancel') {
        const input = z.object({ routineId, jobId: z.string().uuid() }).strict().parse(body),
          job = this.automaticSummaryJob(input.jobId, input.routineId);
        job.controller.abort();
        job.state = 'cancelled';
        job.error = null;
        job.detail = '사용자가 요약을 중단했습니다.';
        job.updatedAt = Date.now();
        return json(200, this.publicAutomaticSummaryJob(job));
      }
      if (
        path === '/assistant/attachments/choose' ||
        path === '/assistant/attachments/release' ||
        path === '/assistant/attachments/drop'
      ) {
        if (!this.attachments) throw new Error('assistant_attachments_unavailable');
        const input = z
          .object({
            routineId,
            attachmentId: z.string().uuid().optional(),
            ticket: z.string().uuid().optional(),
          })
          .strict()
          .parse(body);
        if (path.endsWith('/choose'))
          return json(200, { attachments: await this.attachments.choose(input.routineId) });
        if (path.endsWith('/drop')) {
          if (!input.ticket) throw new Error('attachment_invalid');
          return json(200, {
            attachments: await this.attachments.choose(input.routineId, input.ticket),
          });
        }
        if (!input.attachmentId) throw new Error('attachment_invalid');
        return json(200, await this.attachments.release(input.routineId, input.attachmentId));
      }
      if (path === '/assistant/conversation/get') {
        const input = z.object({ routineId }).strict().parse(body);
        const profile = await this.workspace.profile(input.routineId);
        if (!profile) throw new Error('assistant_settings_required');
        return json(200, await this.workspace.conversationDisplay(profile));
      }
      if (path.startsWith('/assistant/queue/')) {
        this.chatQueue ??= new BriefingChatQueue(this.workspace, () => this.attachments);
        return json(200, await this.chatQueue.handle(path, body));
      }
      if (path === '/assistant/chat') {
        const input = ChatRequestSchema.parse(body),
          profile = await this.workspace.profile(input.routineId);
        if (!profile) throw new Error('assistant_settings_required');
        if (!this.workspace.owns(profile)) throw new Error('assistant_client_required');
        if (!!input.queueId !== !!input.queueToken) throw new Error('assistant_queue_invalid');
        if (input.queueId && input.queueToken) {
          const queued = await this.workspace.queuedChat(profile, input.queueId, input.queueToken);
          input.prompt = queued.prompt;
          input.attachmentIds = queued.attachmentIds;
          if (queued.paperReference) input.paperReference = queued.paperReference;
          else delete input.paperReference;
        }
        this.chatQueue ??= new BriefingChatQueue(this.workspace, () => this.attachments);
        const chat = this.chatQueue.begin(profile, signal);
        let queueError: string | undefined;
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
        res.flushHeaders();
        const send = (value: unknown) => {
          if (!signal.aborted && !res.destroyed) res.write(`${JSON.stringify(value)}\n`);
        };
        let attached: ProjectChatAttachmentsForAgent | undefined;
        try {
          if (input.attachmentIds?.length) {
            if (!this.attachments) throw new Error('assistant_attachments_unavailable');
            attached = this.attachments.claim(profile, input.attachmentIds);
          }
          const past = await this.workspace.conversation(profile);
          const paperSaveScope = approvedPaperSaveScope(
            input.prompt,
            past,
            !input.queueId && !input.attachmentIds?.length,
          );
          const checkpoint = await this.workspace.conversationCheckpoint(profile);
          const policy = await this.modelRouting?.();
          await this.workspace.appendConversation(profile, {
            role: 'user',
            text: input.prompt,
            createdAt: new Date().toISOString(),
          });
          const feedbackProfileReader = (
            this.memory as unknown as {
              feedbackProfile?: (routineId: string) => Promise<FeedbackProfile>;
            }
          ).feedbackProfile;
          const feedbackProfile =
            typeof feedbackProfileReader === 'function'
              ? await feedbackProfileReader.call(this.memory, input.routineId)
              : undefined;
          // Share identical searches, not one unfiltered sample across different sender/date queries.
          const mailSearchAt = Date.now();
          const mailReads = new Map<
            string,
            Promise<Awaited<ReturnType<AppleMailConnection['collect']>>>
          >();
          let mailReady: Promise<void> | undefined;
          let mailFailure: unknown;
          const result = await runBriefingAssistant(
            input,
            profile,
            this.workspace,
            {
              ...(this.projectBridge ? { projectBridge: this.projectBridge } : {}),
              ...(attached ? { attachments: attached } : {}),
              onActiveTurn: chat.onActiveTurn,
              modelPreferences: routedBriefingPreferences(
                profile.preferences,
                policy,
                'briefingAssistant',
              ),
              onContextUsage: (usage) => send({ type: 'context-usage', usage }),
              prepareContext: async (model, fixedText) => {
                if (!past.length)
                  return historyPlan(
                    model,
                    input.history.map((m) => ({ ...m, createdAt: new Date().toISOString() })),
                    fixedText,
                  );
                const maintenance: NonNullable<ContextUsage['maintenance']> = {
                  calls: 0,
                  inputTokens: 0,
                  outputTokens: 0,
                };
                const initial = historyPlan(model, past, fixedText, checkpoint);
                send({ type: 'context-usage', usage: initial.report });
                const prepared = await prepareConversationContext(
                  model,
                  past,
                  fixedText,
                  checkpoint,
                  async (older, summary) => {
                    const current = await this.workspace.profile(input.routineId);
                    if (
                      !current ||
                      !this.workspace.owns(current) ||
                      JSON.stringify(current) !== JSON.stringify(profile)
                    )
                      throw new Error('assistant_settings_changed');
                    return compactConversation(
                      older,
                      summary,
                      routedBriefingPreferences(profile.preferences, policy, 'briefing'),
                      chat.signal,
                      (detail) => send({ type: 'progress', detail }),
                      undefined,
                      (usage) => {
                        maintenance.calls++;
                        maintenance.inputTokens =
                          maintenance.inputTokens === null ||
                          usage?.inputTokens === null ||
                          usage?.inputTokens === undefined
                            ? null
                            : maintenance.inputTokens + usage.inputTokens;
                        maintenance.outputTokens =
                          maintenance.outputTokens === null ||
                          usage?.outputTokens === null ||
                          usage?.outputTokens === undefined
                            ? null
                            : maintenance.outputTokens + usage.outputTokens;
                        send({ type: 'context-usage', usage: { ...initial.report, maintenance } });
                      },
                    );
                  },
                  (next) => this.workspace.saveConversationCheckpoint(profile, next),
                );
                return {
                  ...prepared,
                  report: { ...prepared.report, ...(maintenance.calls ? { maintenance } : {}) },
                };
              },
              searchConversation: async (query, from, to) =>
                searchConversationRecords(
                  await this.workspace.conversation(profile),
                  query,
                  from,
                  to,
                ),
              ...(this.sharedPaperLibrary
                ? {
                    ...(paperSaveScope
                      ? {
                          approvedPaperSave: {
                            scope: paperSaveScope,
                            save: async (item: LiveItem, sig: AbortSignal) =>
                              this.sharedPaperLibrary!.save(
                                {
                                  confirmed: true,
                                  candidate: {
                                    title: item.title.slice(0, 240),
                                    question: `논문 요약: ${item.title}`.slice(0, 12000),
                                    markdown: '승인된 논문을 원문 근거로 요약합니다.',
                                    sourceUrls: [item.sourceUrl!],
                                  },
                                },
                                'Briefing Lab',
                                sig,
                                async () => {
                                  const current = await this.workspace.profile(profile.routineId);
                                  if (
                                    sig.aborted ||
                                    !current ||
                                    !this.workspace.owns(current) ||
                                    JSON.stringify(current) !== JSON.stringify(profile)
                                  )
                                    throw new Error('assistant_settings_changed');
                                },
                              ),
                          },
                        }
                      : {}),
                    sharedPapers: async () =>
                      this.workspace.classificationViews(
                        input.routineId,
                        (await this.sharedPaperLibrary!.list()).map(sharedPaperView),
                      ),
                  }
                : {}),
              papers: (query, sig, options) =>
                this.paperLookup().search(
                  query,
                  profile.interest,
                  profile.live.papers,
                  sig,
                  options,
                ),
              readPublicPaper: (item, sig, offset) => this.paperLookup().read(item, sig, offset),
              mail: async (query, sig, filters = {}) => {
                if (!profile.live.mail) throw new Error('assistant_mail_permission_required');
                await this.workspace.assertMail(
                  profile.routineId,
                  profile.live.mail,
                  true,
                  profile.preferences.providerId,
                );
                const scope = profile.live.mail;
                const search = resolveMailSearch(
                  { query, ...filters },
                  scope,
                  profile.timeZone,
                  mailSearchAt,
                );
                const key = JSON.stringify(search ?? null);
                if (mailFailure) throw mailFailure;
                mailReady ??= (async () => {
                  if (this.workspace.requiresPerRequestConfirmation(profile))
                    await this.consent(
                      'AI 비서가 설정된 Apple Mail 범위를 읽습니다. 현재 요청에만 허용할까요?',
                      sig,
                    );
                  await this.mail.restorePolicyGrant(profile.routineId, scope, sig);
                })();
                await mailReady;
                if (!mailReads.has(key)) {
                  if (mailReads.size >= 4) throw new Error('mail_search_turn_limit');
                  const pending = this.mail
                    .collect(
                      profile.routineId,
                      scope,
                      sig,
                      (value) => {
                        if (!sig.aborted)
                          send({ type: 'progress', detail: mailProgressDetail(value) });
                      },
                      undefined,
                      search,
                    )
                    .catch((error: unknown) => {
                      mailFailure = error;
                      throw error;
                    });
                  mailReads.set(key, pending);
                }
                const result = await mailReads.get(key)!;
                if (sig.aborted) throw new Error('source_cancelled');
                await this.workspace.assertMail(
                  profile.routineId,
                  profile.live.mail,
                  true,
                  profile.preferences.providerId,
                );
                return {
                  note: result.note,
                  items: result.items,
                };
              },
              calendar: async (start, end, sig) => {
                await this.workspace.assertCalendar(
                  profile.routineId,
                  profile.preferences.calendarIds,
                );
                if (this.workspace.requiresPerRequestConfirmation(profile))
                  await this.consent(
                    'AI 비서가 선택한 Calendar를 읽습니다. 현재 요청에만 허용할까요?',
                    sig,
                  );
                const result = await this.calendar.events(
                  profile.preferences.calendarIds,
                  start,
                  end,
                  sig,
                );
                if (sig.aborted) throw new Error('source_cancelled');
                await this.workspace.assertCalendar(
                  profile.routineId,
                  profile.preferences.calendarIds,
                );
                return {
                  ...result,
                  limited: result.limited || result.events.length > 30,
                  events: result.events.slice(0, 30).map((e) => ({
                    id: e.id,
                    title: e.title,
                    start: e.start,
                    end: e.end,
                    allDay: e.allDay,
                    location: e.location.slice(0, 300),
                  })),
                };
              },
              ...(feedbackProfile ? { feedbackProfile } : {}),
              todos: async (sig) => {
                const p = await this.workspace.assertTodoRead(input.routineId);
                if (!this.todoReader) throw new Error('assistant_todo_unavailable');
                if (this.workspace.requiresPerRequestConfirmation(p))
                  await this.consent('GOSU 할 일을 읽고 선택한 AI에 전달할까요?', sig);
                const result = BriefingTodosSchema.parse(await this.todoReader());
                if (sig.aborted) throw new Error('source_cancelled');
                await this.workspace.assertTodoRead(input.routineId);
                return result;
              },
            },
            chat.signal,
            (detail) => send({ type: 'progress', detail }),
          );
          let persistenceWarning: string | undefined;
          try {
            await this.workspace.appendConversation(profile, {
              role: 'assistant',
              text: result.answer,
              createdAt: new Date().toISOString(),
              invocation: result.invocation,
              hasOtherPendingActions: Boolean(
                result.events.length || result.tasks.length || result.settingsProposal,
              ),
              ...(result.contextUsage ? { contextUsage: result.contextUsage } : {}),
            });
          } catch {
            persistenceWarning =
              '답변은 완료됐지만 대화 저장에 실패했습니다. 앱을 닫기 전에 내용을 복사해주세요. 요청을 자동으로 다시 실행하지 않습니다.';
          }
          send({
            type: 'result',
            result: { ...result, ...(persistenceWarning ? { persistenceWarning } : {}) },
          });
        } catch (error) {
          queueError = sourceError(error);
          send({ type: 'error', message: sourceError(error) });
        } finally {
          try {
            await attached?.revoke().catch(() => undefined);
            if (input.queueId && input.queueToken)
              await this.workspace.finishChatQueue(
                profile,
                input.queueId,
                input.queueToken,
                queueError,
              );
          } finally {
            chat.finish();
            res.end();
          }
        }
        return;
      }
      if (path === '/history/delete') {
        const input = HistoryRemovalTargetSchema.parse(body);
        const receipt = await this.workspace.removeHistoryRun(input, signal);
        if (
          receipt.runId &&
          this.generation &&
          (await this.generation.status(input.routineId)).job?.runId === receipt.runId
        )
          await this.generation.cancel(input.routineId);
        if (receipt.runId) {
          if (this.receipts.get(receipt.runId)?.input.routineId === receipt.routineId)
            this.receipts.delete(receipt.runId);
          for (const job of this.automaticSummaryJobs.values())
            if (job.routineId === receipt.routineId && job.receiptId === receipt.runId) {
              if (job.state === 'running') job.controller.abort();
              job.state = 'cancelled';
              job.results = [];
              job.detail = '브리핑이 삭제되어 요약을 중단했습니다.';
              job.updatedAt = Date.now();
            }
        }
        return json(200, receipt);
      }
      if (path === '/history/deleted') {
        const input = z.object({ routineId }).strict().parse(body);
        return json(200, { removed: await this.workspace.removedBriefings(input.routineId) });
      }
      if (path === '/history/restore') {
        const input = HistoryRestoreSchema.parse(body);
        return json(
          200,
          await this.workspace.restoreHistoryRun(input.routineId, input.deletionId, signal),
        );
      }
      if (path === '/history/list') {
        const input = z
          .object({
            routineId,
            query: z.string().max(300).optional(),
            offset: z.number().int().min(0).max(10000).optional(),
          })
          .strict()
          .parse(body);
        const rawHistory = await this.workspace.history(
          input.routineId,
          input.query ?? '',
          600,
          input.offset ?? 0,
        );
        const history = curateHistoryTags(
          rawHistory,
          await this.workspace.summaryHistory(input.routineId),
        );
        const p = await this.workspace.profile(input.routineId);
        if (
          history.some((h) => h.private) &&
          (!p ||
            !(await this.workspace.canPrivateAi(input.routineId, p.preferences.providerId)) ||
            this.workspace.requiresPerRequestConfirmation(p))
        )
          await this.consent(
            '이 브라우저에서 선택한 루틴의 private 브리핑 이력을 읽습니다.',
            signal,
          );
        let feedback: Record<string, 'important' | 'not-interested'> = {};
        let feedbackWarning = '';
        try {
          feedback =
            (await this.memory.feedbackChoices?.(
              input.routineId,
              history.flatMap((h) => h.items.map((i) => i.id)),
            )) ?? {};
        } catch {
          feedbackWarning = '저장된 중요함/관심 없음 선택을 불러오지 못했습니다.';
        }
        if (signal.aborted) throw new Error('source_cancelled');
        if (JSON.stringify(await this.workspace.profile(input.routineId)) !== JSON.stringify(p))
          throw new Error('assistant_settings_changed');
        return json(200, {
          history,
          feedback,
          nextOffset: history.length === 600 ? (input.offset ?? 0) + 600 : null,
          ...(feedbackWarning ? { feedbackWarning } : {}),
        });
      }
      if (path === '/history/feedback')
        return json(
          200,
          await saveHistoryFeedback(body, this.workspace, this.memory, this.consent, signal),
        );
      if (path === '/calendar/authorize') {
        const input = z.object({ routineId }).strict().parse(body);
        const client = briefingClientHash();
        if (!client) throw new Error('assistant_client_required');
        const p = await this.workspace.profile(input.routineId);
        if (!p || !this.workspace.owns(p))
          await this.consent(
            'Apple Calendar 연결\n이 브라우저에서 캘린더 목록을 가져옵니다. 실제 일정 조회 범위는 설정에서 선택하고, 쓰기는 별도로 승인합니다.',
            signal,
          );
        await this.calendar.authorize(signal);
        this.calendarClients.set(client, Date.now() + 600000);
        return json(200, { calendars: await this.calendar.calendars(signal) });
      }
      if (path === '/calendar/catalog') {
        const input = z.object({ routineId }).strict().parse(body),
          p = await this.workspace.profile(input.routineId),
          client = briefingClientHash();
        if (
          (!p || !this.workspace.owns(p)) &&
          (!client || (this.calendarClients.get(client) ?? 0) < Date.now())
        )
          throw new Error('calendar_permission_required');
        return json(200, { calendars: await this.calendar.calendars(signal) });
      }
      if (path === '/calendar/events' || path === '/calendar/agenda') {
        const input = z
            .object({
              routineId,
              start: z.string().optional(),
              end: z.string().optional(),
              receiptId: z.string().uuid().optional(),
            })
            .strict()
            .parse(body),
          p = await this.workspace.profile(input.routineId);
        if (!p) throw new Error('assistant_calendar_permission_required');
        await this.workspace.assertCalendar(input.routineId, p.preferences.calendarIds);
        if (path === '/calendar/agenda' && input.receiptId) {
          const receipt = this.receipts.get(input.receiptId);
          if (
            !receipt ||
            receipt.input.routineId !== input.routineId ||
            receipt.expiresAt < Date.now()
          )
            throw new Error('briefing_receipt_expired');
        }
        const range = calendarWindow(p.timeZone);
        const result = await this.calendar.events(
          p.preferences.calendarIds,
          input.start ?? range.start,
          input.end ?? range.end,
          signal,
        );
        await this.workspace.assertCalendar(input.routineId, p.preferences.calendarIds);
        if (path === '/calendar/agenda' && input.receiptId) {
          try {
            await this.workspace.saveAgendaSnapshot(
              input.routineId,
              input.receiptId,
              result.events,
              p,
              signal,
              range.start,
            );
          } catch (error) {
            if (signal.aborted) throw error;
            await this.workspace.assertCalendar(input.routineId, p.preferences.calendarIds);
            return json(200, {
              ...result,
              referenceAt: range.start,
              historyWarning: `일정 이력 저장 실패: ${sourceError(error)}`,
            });
          }
        }
        await this.workspace.assertCalendar(input.routineId, p.preferences.calendarIds);
        return json(
          200,
          path === '/calendar/agenda' ? { ...result, referenceAt: range.start } : result,
        );
      }
      if (path === '/calendar/prepare') {
        const input = z
          .object({
            routineId,
            kind: z.enum(['create', 'update', 'delete']),
            draft: EventDraftSchema,
            eventId: z.string().nullable(),
            fingerprint: z.string().nullable(),
          })
          .strict()
          .parse(body);
        await this.workspace.assertCalendar(input.routineId, [input.draft.calendarId]);
        if (
          input.kind !== 'create' &&
          (!input.eventId || !this.calendar.observedEvent(input.eventId))
        )
          throw new Error('calendar_event_missing');
        return json(200, { action: await this.workspace.action(input) });
      }
      if (path === '/calendar/apply') {
        const input = z
            .object({ routineId, actionId: z.string().uuid(), direct: z.boolean().optional() })
            .strict()
            .parse(body),
          action = await this.workspace.getAction(input.actionId, input.routineId);
        if (!action) throw new Error('calendar_action_stale');
        await this.workspace.assertCalendar(input.routineId, [action.draft.calendarId]);
        if (action.state === 'complete')
          return json(200, { id: action.resultId, alreadyApplied: true });
        if (action.state !== 'pending' || Date.now() - Date.parse(action.createdAt) > 900000)
          throw new Error('calendar_action_stale');
        const targetCalendar = (await this.calendar.calendars(signal)).find(
          (c) => c.id === action.draft.calendarId && c.writable,
        );
        if (!targetCalendar) throw new Error('calendar_readonly');
        // Direct UI requests skip extra review only when the helper verifies its certificate-signed
        // installed GOSU parent. AI/CLI and untrusted-parent calls retain native confirmation.
        await this.workspace.assertCalendar(input.routineId, [action.draft.calendarId]);
        if (signal.aborted) throw new Error('source_cancelled');
        await this.workspace.transition(action.id, 'pending', 'applying');
        try {
          const result = await this.calendar.apply(action, signal, input.direct === true);
          this.notificationCalendar = undefined;
          await this.workspace.transition(action.id, 'applying', 'complete', result.id);
          return json(200, result);
        } catch (error) {
          await this.workspace.transition(action.id, 'applying', 'unknown');
          throw error;
        }
      }
      if (path === '/memory/status') {
        const input = z.object({ routineId }).strict().parse(body);
        return json(200, await this.memory.status(input.routineId));
      }
      if (path === '/memory/review') {
        const input = z.object({ routineId, token: z.string().optional() }).strict().parse(body);
        const editor = input.token ? this.memoryEditors.get(input.token) : undefined;
        if (!editor || editor.routineId !== input.routineId || editor.expiresAt < Date.now())
          await this.consent(
            'Briefing memory 검토\n이 브라우저에서 선택한 루틴의 자동 기억을 읽고 수정/삭제할 수 있도록 5분간 허용합니다. 직접 요청한 경우에만 허용하세요.',
            signal,
          );
        if (signal.aborted) throw new Error('source_cancelled');
        for (const [token, value] of this.memoryEditors)
          if (value.expiresAt < Date.now()) this.memoryEditors.delete(token);
        if (this.memoryEditors.size >= 12)
          this.memoryEditors.delete(this.memoryEditors.keys().next().value!);
        const token =
          editor && editor.expiresAt > Date.now() && editor.routineId === input.routineId
            ? input.token!
            : randomUUID();
        this.memoryEditors.set(token, {
          routineId: input.routineId,
          expiresAt:
            editor && editor.routineId === input.routineId && editor.expiresAt > Date.now()
              ? editor.expiresAt
              : Date.now() + 300000,
        });
        return json(200, { ...(await this.memory.review(input.routineId)), token });
      }
      if (path === '/memory/edit' || path === '/memory/import') {
        const input = (
          path === '/memory/edit'
            ? z.object({
                routineId,
                token: z.string(),
                id: z.string(),
                revision: z.number().int(),
                text: z.string().max(4000).nullable(),
              })
            : z.object({
                routineId,
                token: z.string(),
                entries: z.array(BriefingMemoryEntrySchema).max(12),
              })
        )
          .strict()
          .parse(body);
        const editor = this.memoryEditors.get(input.token);
        if (!editor || editor.routineId !== input.routineId || editor.expiresAt < Date.now())
          throw new Error('briefing_memory_editor_required');
        if ('entries' in input)
          await this.memory.importEntries(input.routineId, input.entries, signal);
        else await this.memory.edit(input.routineId, input.id, input.revision, input.text, signal);
        return json(200, { ...(await this.memory.review(input.routineId)), token: input.token });
      }
      if (path === '/memory/feedback/choices') {
        const input = z.object({ routineId, receiptId: z.string().uuid() }).strict().parse(body);
        const receipt = this.receipts.get(input.receiptId);
        if (
          !receipt ||
          receipt.expiresAt < Date.now() ||
          receipt.input.routineId !== input.routineId
        )
          throw new Error('briefing_receipt_expired');
        const profile = await this.workspace.profile(input.routineId);
        if (!profile || !this.workspace.owns(profile)) throw new Error('assistant_client_required');
        const items = receipt.results
          .flatMap((r) => r.items)
          .filter((i) => i.kind === 'email' || i.kind === 'papers');
        const guard = async () => {
          if (signal.aborted) throw new Error('source_cancelled');
          if (
            JSON.stringify(await this.workspace.profile(input.routineId)) !==
            JSON.stringify(profile)
          )
            throw new Error('assistant_settings_changed');
          if (items.some((i) => i.kind === 'email' || i.privateOrigin === 'mail')) {
            if (!receipt.input.live.mail) throw new Error('mail_scope_required');
            await this.workspace.assertMail(input.routineId, receipt.input.live.mail);
          }
        };
        await guard();
        const choices = await this.memory.feedbackChoices(
          input.routineId,
          items.map((i) => i.id),
        );
        await guard();
        return json(200, { choices });
      }
      if (path === '/memory/feedback') {
        const input = z
          .object({
            routineId,
            receiptId: z.string().uuid(),
            itemId: z.string(),
            decision: z.enum(['important', 'not-interested']),
            keywords: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
          })
          .strict()
          .parse(body);
        const receipt = this.receipts.get(input.receiptId),
          item = receipt?.results.flatMap((r) => r.items).find((i) => i.id === input.itemId);
        if (
          !receipt ||
          receipt.expiresAt < Date.now() ||
          receipt.input.routineId !== input.routineId ||
          !item
        )
          throw new Error('briefing_receipt_expired');
        if (item.kind === 'email' || item.privateOrigin === 'mail') {
          if (!receipt.input.live.mail) throw new Error('mail_scope_required');
          this.mail.assertScope(input.routineId, receipt.input.live.mail);
          const profile = await this.workspace.profile(input.routineId);
          if (!profile || this.workspace.requiresPerRequestConfirmation(profile))
            await this.consent(
              '메일 관련 Briefing 선호 저장\n선택한 메일의 제목과 중요/관심 없음 피드백을 로컬 암호화 backend에 저장합니다.',
              signal,
            );
          this.mail.assertScope(input.routineId, receipt.input.live.mail);
        } else {
          const profile = await this.workspace.profile(input.routineId);
          if (profile && this.workspace.requiresPerRequestConfirmation(profile))
            await this.consent(
              'Briefing 선호 저장\n선택한 논문의 제목·키워드와 중요/관심 없음 피드백을 로컬 암호화 backend에 저장합니다.',
              signal,
            );
        }
        await this.memory.feedback(
          input.routineId,
          item,
          input.decision,
          signal,
          () => {
            if (item.kind === 'email' || item.privateOrigin === 'mail')
              this.mail.assertScope(input.routineId, receipt.input.live.mail!);
          },
          input.keywords,
        );
        return json(200, await this.memory.status(input.routineId));
      }
      if (path === '/cities') {
        const { query } = CityQuerySchema.parse(body);
        return json(200, { cities: await this.providers.cities(query, signal) });
      }
      if (path === '/mail/accounts') {
        z.object({}).strict().parse(body);
        return json(200, { accounts: await this.mail.listAccounts(signal) });
      }
      if (path === '/mail/discover') {
        z.object({}).strict().parse(body);
        return json(200, await this.mail.discover(signal));
      }
      if (path === '/mail/status') {
        const input = z.object({ routineId, scope: MailScopeSchema }).strict().parse(body);
        const p = await this.workspace.profile(input.routineId);
        if (p) {
          const live = this.mail.status(input.routineId, input.scope);
          try {
            await this.workspace.assertMail(input.routineId, input.scope);
            if (live.state === 'connected')
              return json(200, {
                ...live,
                mailRead: p.preferences.mailRead,
                mailAi: p.preferences.mailAi,
                approved: true,
              });
            return json(200, {
              ...live,
              state: 'configured',
              expiresAt: null,
              mailRead: p.preferences.mailRead,
              mailAi: p.preferences.mailAi,
              approved: true,
            });
          } catch {
            return json(200, {
              state: live.state === 'scope-changed' ? 'scope-changed' : 'disconnected',
              expiresAt: live.expiresAt ?? null,
              mailRead: p.preferences.mailRead,
              mailAi: p.preferences.mailAi,
              approved: false,
            });
          }
        }
        return json(200, this.mail.status(input.routineId, input.scope));
      }
      if (path === '/mail/mailboxes') {
        const { accountId } = z
          .object({ accountId: z.string().max(128) })
          .strict()
          .parse(body);
        return json(200, { mailboxes: await this.mail.listMailboxes(accountId, signal) });
      }
      if (path === '/mail/authorize') {
        const input = z.object({ routineId, scope: MailScopeSchema }).strict().parse(body);
        await this.consent(
          `Apple Mail 연결 요청\n루틴 ${input.routineId}\n최근 ${input.scope.days}일 · 최대 ${input.scope.limit}개 · ${input.scope.bodyPreview ? '본문 앞부분 포함' : '메타데이터만'}\n30분간 이 범위의 읽기 연결을 허용합니다. 직접 요청한 연결일 때만 허용하세요.`,
          signal,
        );
        return json(200, this.mail.authorize(input.routineId, input.scope));
      }
      if (path === '/mail/revoke') {
        const input = z.object({ routineId }).strict().parse(body);
        const p = await this.workspace.profile(input.routineId);
        if (p) {
          if (!this.workspace.owns(p)) throw new Error('assistant_client_required');
          const { approvedScope: _approved, updatedAt: _updated, owners: _owners, ...data } = p;
          await this.workspace.save(
            { ...data, preferences: { ...p.preferences, mailRead: false } },
            (message) => this.consent(message, signal),
          );
        }
        this.mail.revoke(input.routineId);
        for (const [id, receipt] of this.receipts)
          if (receipt.input.routineId === input.routineId) this.receipts.delete(id);
        return json(200, { revoked: true });
      }
      if (path !== '/collect' && path !== '/analyze')
        return json(404, { error: '알 수 없는 소스 요청입니다.' });
      const input =
        path === '/analyze' ? AnalysisRequestSchema.parse(body) : LiveCollectSchema.parse(body);
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.flushHeaders();
      const send = (value: unknown) => {
        if (!res.destroyed && !signal.aborted) res.write(`${JSON.stringify(value)}\n`);
      };
      try {
        const result =
          path === '/analyze'
            ? await this.analyze(input, signal, (detail) =>
                send({ type: 'analysis-progress', detail }),
              )
            : await this.collect(input, signal, (progress) => send({ type: 'progress', progress }));
        send({ type: 'result', result });
      } catch (error) {
        send({ type: 'error', message: sourceError(error) });
      } finally {
        res.end();
      }
    } catch (error) {
      if (!res.headersSent && !res.destroyed)
        json(400, {
          error: sourceError(error),
        });
      else res.end();
    }
  }
}
