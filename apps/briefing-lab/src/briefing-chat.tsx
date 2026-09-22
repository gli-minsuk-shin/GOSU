import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { restoreScrollWhenShown } from '@gosu/ui/scroll-settle';
import {
  chatSlashSuggestions,
  parseChatSlashCommand,
  type ChatSlashCommand,
} from '@gosu/ui/chat-slash-commands';
import { beginAiActivity } from '@gosu/ui/ai-activity';
import type { BriefingRoutine } from '@gosu/briefing-core';
import type { AssistantAnswer, EventDraft } from './workspace-contracts';
import { workspaceStream } from './workspace-client';
import { BriefingMarkdown } from './briefing-insight-card';
import { CalendarEventEditor } from './calendar-event-editor';
import { initialEvent, calendarInstant } from './calendar-dates';
import { EmailDeliveryMeta } from './email-delivery-meta';
import { BriefingTodoButton } from './briefing-todo-button';
import type { EmailPreparedActions } from './email-prepared-actions';
import type { MailAccountContext } from './mail-account';
import { PaperSummarySaveOffer, type PaperSaveReplyHandler } from './paper-summary-offer';
import { asksPaperLibraryQuestion, type PaperSummarySaveReceipt } from './paper-summary-contract';
import { sourceRequest } from './live-client';
import { restoreBriefingConversation } from './briefing-conversation-restore';
import {
  CHAT_COMMAND_DETAILS,
  compactStatus,
  contextCommandRefusal,
  contextDividerIndex,
  latestContextUsage,
  newContextStatus,
} from './briefing-chat-commands';
import { ContextUsageMeter } from './context-usage-meter';
import type { ContextUsage } from './context-usage';
import { ConversationMessageSchema, type ConversationMessage } from './briefing-conversation';
import type { PaperChatReference } from './paper-chat-reference';
import { paperConversationKey } from './paper-identity';
import { DEFAULT_BRIEFING_QUESTIONS } from './briefing-questions';
import { settingsProposalText, type SettingsProposal } from './assistant-settings-proposal';
import { AssistantQueue, useAssistantQueue } from './assistant-queue';
import { useChatFileDrop } from '../../desktop/src/renderer/src/chat-file-drop';
import { reserveBriefingFileDrop } from './briefing-file-drop';
import type { AssistantQueuedMessage } from './assistant-queue-contract';
import {
  ProjectChatAttachmentSchema,
  type ProjectChatAttachment,
} from '../../desktop/src/shared/project-chat-attachment-contracts';

/**
 * Every paper an answer drew on is already in the routine's paper library: asking about a saved
 * paper is not a reason to offer saving it again. An answer that also read a new paper keeps the
 * offer, for that paper only.
 */
export function answersFromSavedPapers(
  sources: readonly { kind?: string | undefined; saved?: boolean | undefined }[],
) {
  const papers = sources.filter((source) => source.kind === 'paper');
  return papers.length > 0 && papers.every((source) => source.saved === true);
}
type ChatAnswer = AssistantAnswer & {
  savedPapers?: (PaperSummarySaveReceipt & { title: string })[];
  contextUsage?: ContextUsage;
  persistenceWarning?: string;
  /** The answer arrived but this paper's 대화 기록 could not be written. Never hides the answer. */
  conversationWarning?: string;
  settingsProposal?: SettingsProposal;
  sources: {
    id: string;
    title: string;
    url?: string;
    paperUrl?: string;
    /** Read from the routine's paper library, so there is nothing to offer to add. */
    saved?: boolean;
    kind?: 'paper' | 'email' | 'news' | 'history' | 'calendar';
    mailAccount?: MailAccountContext | undefined;
    mailSender?: string | undefined;
    receivedAt?: string | undefined;
  }[];
  invocation: { providerId: string; model: string; reasoning: string | null };
  writesPerformed: number;
};
type BriefingChatSource = ChatAnswer['sources'][number];
/** Where `/new` cut the context: above it is kept for reading, below it is what the AI is given. */
function NewContextDivider() {
  return (
    <p role="separator" className="briefing-chat-context-divider">
      여기부터 새 대화 · 위 메시지는 AI에 전달되지 않습니다
    </p>
  );
}
type Message = ConversationMessage & {
  result?: ChatAnswer;
};
function chatTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
const isoDateTimePattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/gu;
/** A chat task proposal as the reviewed to-do dialog's draft; the user edits and saves it. */
export function chatTaskDraft(
  task: AssistantAnswer['tasks'][number],
  timeZone: string,
): NonNullable<EmailPreparedActions['task']> {
  const deadline = task.deadline?.trim() ?? '';
  const dueDate = /^\d{4}-\d{2}-\d{2}/u.exec(deadline)?.[0] ?? null;
  const dueAt =
    dueDate &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(deadline)
      ? deadline
      : null;
  const title = task.title.trim().slice(0, 240);
  return {
    title: title.length >= 2 ? title : `할 일: ${title}`,
    notes: task.description.slice(0, 4000),
    dueDate,
    dueAt,
    timeZone,
    evidenceQuote: title || '할 일',
    deadlineQuote: deadline.slice(0, 1000),
    notice: 'AI 비서가 제안한 할 일입니다',
  };
}
export function formatBriefingEventTime(value: string | null, timeZone: string, allDay = false) {
  if (!value) return allDay ? '날짜 미정' : '시각 미정';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    ...(allDay ? {} : { hour: '2-digit', minute: '2-digit', hour12: false }),
    timeZone,
  }).format(date);
}
export function formatBriefingEventRange(
  start: string | null,
  end: string | null,
  timeZone: string,
  allDay = false,
) {
  if (!start && !end) return allDay ? '날짜 미정' : '시각 미정';
  if (allDay) return `${formatBriefingEventTime(start, timeZone, true)} · 종일`;
  return `${formatBriefingEventTime(start, timeZone)}–${formatBriefingEventTime(end, timeZone)}`;
}
export function formatBriefingEvidence(value: string, timeZone: string) {
  return value.replace(isoDateTimePattern, (iso) => formatBriefingEventTime(iso, timeZone));
}
export function hasExistingCalendarEvent(
  sources: readonly BriefingChatSource[],
  proposal: AssistantAnswer['events'][number],
) {
  return sources.some(
    (source) =>
      source.kind === 'calendar' &&
      (source.id === proposal.sourceId || source.title.trim() === proposal.title.trim()),
  );
}
/** Project Chat's rule: within 96px of the end still counts as reading the newest message. */
export function isNearLatestMessage(
  node: Readonly<{ scrollTop: number; scrollHeight: number; clientHeight: number }>,
) {
  const values = [node.scrollTop, node.scrollHeight, node.clientHeight];
  if (!values.every(Number.isFinite)) return true;
  return Math.max(0, node.scrollHeight - node.clientHeight - node.scrollTop) <= 96;
}

export function BriefingChat({
  globalMode = false,
  autoSuggestions = true,
  paperChat,
  routine,
  onSettings,
  onBusyChange,
  visible = true,
  recommendationRequest = 0,
}: {
  routine: BriefingRoutine;
  globalMode?: boolean;
  /** Settings -> Agent: whether opening this chat also opens its suggested questions. */
  autoSuggestions?: boolean;
  /**
   * 논문 요약 AI: this whole chat belongs to one paper. Its transcript is that paper's own, never
   * the AI 비서's, and every turn carries the paper. The AI 비서 is never handed a paper: asking
   * about one opens that paper's own conversation in 논문 요약, and only it carries the paper.
   * a paper to one question in the assistant's chat.
   */
  paperChat?: PaperChatReference | undefined;
  onSettings: (proposal?: SettingsProposal) => void;
  onBusyChange?: (busy: boolean) => void;
  visible?: boolean;
  recommendationRequest?: number;
}) {
  const [attachments, setAttachments] = useState<ProjectChatAttachment[]>([]);
  const [choosingFiles, setChoosingFiles] = useState(false);
  const attachmentPickLock = useRef(false);
  const attachmentPaneMounted = useRef(true);
  useEffect(() => {
    attachmentPaneMounted.current = true;
    return () => {
      attachmentPaneMounted.current = false;
    };
  }, []);
  const enqueueLock = useRef(false);
  const [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [event, setEvent] = useState<EventDraft | null>(null),
    [showSuggestions, setShowSuggestions] = useState(autoSuggestions);
  const [restored, setRestored] = useState(false);
  /** False once the reader scrolls up, which offers the jump back to the newest message. */
  const [nearLatest, setNearLatest] = useState(true);
  const [contextUsage, setContextUsage] = useState<ContextUsage>();
  const [restoreError, setRestoreError] = useState('');
  const [otherScopeMessages, setOtherScopeMessages] = useState(0);
  /** When `/new` last started a context: where the line is drawn. The server owns the real cut. */
  const [contextStartedAt, setContextStartedAt] = useState<string>();
  /** What the running indicator says: an answer, or a `/compact` that adds no message. */
  const [busyKind, setBusyKind] = useState<'turn' | 'compact'>('turn');
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setRestored(false);
    setRestoreError('');
    void (async () => {
      try {
        const result = await restoreBriefingConversation(
          routine.id,
          c.signal,
          undefined,
          paperChat,
        );
        const saved = ConversationMessageSchema.array().parse(result?.messages ?? []);
        if (!c.signal.aborted) {
          const startedAt =
            typeof result?.contextStartedAt === 'string' ? result.contextStartedAt : undefined;
          setMessages(saved);
          setContextStartedAt(startedAt);
          setContextUsage(latestContextUsage(saved, startedAt));
          setRestored(true);
          setOtherScopeMessages(
            Number.isSafeInteger(result?.otherScopeMessages)
              ? Math.max(0, result.otherScopeMessages!)
              : 0,
          );
        }
      } catch {
        if (!c.signal.aborted)
          setRestoreError('이전 대화를 불러오지 못했습니다. 기존 기록은 유지됩니다.');
      }
    })();
    return () => c.abort();
  }, [routine.id, restoreAttempt, paperChat && paperConversationKey(paperChat)]);
  const approvalNoteId = useId();
  const controller = useRef<AbortController | null>(null),
    paperReply = useRef<PaperSaveReplyHandler | null>(null),
    log = useRef<HTMLDivElement | null>(null),
    composer = useRef<HTMLTextAreaElement | null>(null),
    suggestions = useRef<HTMLElement | null>(null),
    suggestionsToggle = useRef<HTMLButtonElement | null>(null),
    focusComposer = useRef(false),
    readingPosition = useRef({ top: 0, count: 0, atBottom: true }),
    visibleNow = useRef(visible),
    reshow = useRef<ReturnType<typeof restoreScrollWhenShown> | null>(null),
    sendLock = useRef(false);
  visibleNow.current = visible;
  // The desktop hides this whole Lab (an iframe) with display: none. The log then has no box, the
  // browser resets its scroll position, and nothing here re-renders when the Lab is shown again.
  useEffect(() => {
    const node = log.current;
    if (!node) return;
    reshow.current = restoreScrollWhenShown(node, () => {
      if (!visibleNow.current) return null;
      const position = readingPosition.current;
      return position.atBottom ? { kind: 'bottom' } : { kind: 'offset', top: position.top };
    });
    return () => reshow.current?.dispose();
  }, []);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useLayoutEffect(() => {
    if (visible) {
      // The setting only governs what opening the chat does by itself. The suggestions button
      // still opens them, and a recommendation the user asked for still arrives.
      if (autoSuggestions) setShowSuggestions(true);
      composer.current?.focus({ preventScroll: true });
    }
  }, [visible, recommendationRequest, autoSuggestions]);
  useEffect(() => {
    if (!visible || !showSuggestions || typeof document === 'undefined') return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        !target ||
        suggestions.current?.contains(target) ||
        suggestionsToggle.current?.contains(target)
      )
        return;
      setShowSuggestions(false);
    };
    // Losing iframe focus also covers clicks in the surrounding GOSU workspace.
    const dismiss = () => setShowSuggestions(false);
    document.addEventListener?.('pointerdown', dismissOutside, true);
    window.addEventListener?.('blur', dismiss);
    return () => {
      document.removeEventListener?.('pointerdown', dismissOutside, true);
      window.removeEventListener?.('blur', dismiss);
    };
  }, [visible, showSuggestions]);
  useLayoutEffect(() => {
    if (!visible) return;
    const node = log.current,
      position = readingPosition.current;
    if (node && node.clientHeight > 0) {
      node.scrollTo?.({
        top:
          messages.length > position.count || position.atBottom ? node.scrollHeight : position.top,
      });
      position.count = messages.length;
      position.top = node.scrollTop;
      setNearLatest(isNearLatestMessage(node));
    }
    if (focusComposer.current) {
      composer.current?.focus();
      focusComposer.current = false;
    }
  }, [visible, messages.length, showSuggestions]);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  /** `/new` and `/compact` are handled here: never sent to a model, queued or stored as a message. */
  const runContextCommand = async (command: ChatSlashCommand) => {
    // Both change the context that a running or waiting question was written for.
    if (
      sendLock.current ||
      queue.state.active ||
      queue.state.items.some((q) => q.state === 'queued')
    ) {
      setStatus(contextCommandRefusal(command));
      return;
    }
    sendLock.current = true;
    const c = new AbortController();
    controller.current = c;
    setShowSuggestions(false);
    setDraft('');
    try {
      if (command === '/new') {
        const result = await sourceRequest<{
          started: boolean;
          contextStartedAt: string;
          setAside: number;
        }>('/assistant/conversation/new', { routineId: routine.id }, c.signal);
        if (c.signal.aborted) return;
        if (result.started) {
          setContextStartedAt(result.contextStartedAt);
          setContextUsage(undefined);
        }
        setStatus(newContextStatus(result));
        return;
      }
      setBusyKind('compact');
      setBusy(true);
      setStatus('대화 문맥을 정리하는 중…');
      const reportActivity = beginAiActivity('assistant', c.signal);
      try {
        const result = await workspaceStream<{
          compacted: boolean;
          summarizedMessages: number;
          contextUsage: ContextUsage;
        }>(
          '/assistant/conversation/compact',
          { routineId: routine.id },
          c.signal,
          (detail) => {
            if (!c.signal.aborted) setStatus(detail);
          },
          (usage) => {
            if (!c.signal.aborted) setContextUsage(usage);
          },
        );
        if (result && !c.signal.aborted) {
          setContextUsage(result.contextUsage);
          setStatus(compactStatus(result));
          reportActivity('completed');
        }
      } finally {
        reportActivity('failed');
      }
    } catch (e) {
      if (!c.signal.aborted)
        setStatus(
          `${command} 실패 · ${e instanceof Error && e.message ? e.message : '원인을 확인하지 못했습니다.'}`,
        );
    } finally {
      sendLock.current = false;
      if (controller.current === c) {
        controller.current = null;
        setBusy(false);
        setBusyKind('turn');
      }
    }
  };
  const send = async (suggestion?: string, queued?: AssistantQueuedMessage) => {
    if (!queued && attachmentPickLock.current) return;
    const prompt = (queued?.prompt ?? suggestion ?? draft).trim();
    if (!prompt || (!visible && !queued) || !restored || enqueueLock.current) return;
    const command = !queued && !suggestion ? parseChatSlashCommand(prompt) : null;
    if (command) return runContextCommand(command);
    if (
      !queued &&
      (sendLock.current ||
        queue.state.active ||
        queue.state.items.some((q) => q.state === 'queued'))
    ) {
      enqueueLock.current = true;
      try {
        await sourceRequest('/assistant/queue/enqueue', {
          routineId: routine.id,
          id: crypto.randomUUID(),
          prompt,
          attachmentIds: attachments.map((f) => f.id),
        });
        setDraft((current) => (current.trim() === prompt ? '' : current));
        setAttachments((current) =>
          current.filter((f) => !attachments.some((sent) => sent.id === f.id)),
        );
        setStatus('대기 질문에 저장했습니다. 실행 전에 수정하거나 삭제할 수 있습니다.');
        await queue.refresh();
      } catch (e) {
        setStatus(e instanceof Error ? e.message : '대기 질문 저장 실패');
      } finally {
        enqueueLock.current = false;
      }
      return;
    }
    if (sendLock.current) throw new Error('이미 실행 중인 질문이 있습니다.');
    if (!suggestion && !queued && !attachments.length && paperReply.current?.(prompt)) {
      setDraft('');
      return;
    }
    sendLock.current = true;
    const c = new AbortController();
    controller.current = c;
    setShowSuggestions(false);
    if (!queued) {
      setDraft('');
      setAttachments([]);
    }
    setBusy(true);
    const reportActivity = beginAiActivity('assistant', c.signal);
    setContextUsage(undefined);
    setStatus('GOSU LLM 연결 · 필요한 자료를 확인하는 중…');
    setMessages((m) => [...m, { role: 'user', text: prompt, createdAt: new Date().toISOString() }]);
    try {
      const result = await workspaceStream<ChatAnswer>(
        '/assistant/chat',
        {
          routineId: routine.id,
          ...((paperChat ?? queued?.paperReference)
            ? { paperReference: paperChat ?? queued?.paperReference }
            : {}),
          ...(queued ? { queueId: queued.id, queueToken: queued.token } : {}),
          attachmentIds: queued?.attachmentIds ?? attachments.map((f) => f.id),
          prompt,
          history: [], // The owned encrypted transcript is assembled by the server, not resent/truncated by this browser.
        },
        c.signal,
        (detail) => {
          if (!c.signal.aborted) setStatus(detail);
        },
        (usage) => {
          if (!c.signal.aborted) setContextUsage(usage);
        },
      );
      if (result && !c.signal.aborted) {
        if (result.savedPapers?.length)
          window.dispatchEvent(new Event('gosu-paper-library-updated'));
        if (result.contextUsage) setContextUsage(result.contextUsage);
        setMessages((m) => [
          ...m,
          { role: 'assistant', text: result.answer, createdAt: new Date().toISOString(), result },
        ]);
        setStatus(
          result.persistenceWarning ||
            result.conversationWarning ||
            (result.events.length || result.tasks.length
              ? '답변 완료 · 제안은 아직 실행되지 않았습니다.'
              : '답변 완료'),
        );
        reportActivity('completed');
      }
    } catch (e) {
      if (!c.signal.aborted) setStatus(e instanceof Error ? e.message : '답변 실패');
    } finally {
      reportActivity('failed');
      sendLock.current = false;
      if (controller.current === c) {
        controller.current = null;
        setBusy(false);
      }
    }
  };
  const queue = useAssistantQueue(
    routine.id,
    restored,
    busy,
    (item) => send(undefined, item),
    setStatus,
  );
  const commandSuggestions = chatSlashSuggestions(draft);
  const dividerIndex = contextDividerIndex(messages, contextStartedAt);
  const chooseFiles = async (dropped?: File[]) => {
    if (attachmentPickLock.current) return;
    attachmentPickLock.current = true;
    setChoosingFiles(true);
    setStatus('첨부 파일을 준비하는 중…');
    try {
      const ticket = dropped ? await reserveBriefingFileDrop(routine.id, dropped) : undefined;
      const result = await sourceRequest<{ attachments: ProjectChatAttachment[] }>(
        dropped ? '/assistant/attachments/drop' : '/assistant/attachments/choose',
        { routineId: routine.id, ...(ticket ? { ticket } : {}) },
      );
      const all = ProjectChatAttachmentSchema.array().parse(result.attachments);
      const release = (file: ProjectChatAttachment) =>
        sourceRequest('/assistant/attachments/release', {
          routineId: routine.id,
          attachmentId: file.id,
        });
      if (!attachmentPaneMounted.current) {
        await Promise.all(all.map(release));
        return;
      }
      const hashes = new Set(attachments.map((f) => f.sha256));
      const selected = all.filter((file) => {
        if (hashes.has(file.sha256)) {
          void release(file).catch(() => undefined);
          return false;
        }
        hashes.add(file.sha256);
        return true;
      });
      if (
        attachments.length + selected.length > 5 ||
        [...attachments, ...selected].reduce((n, f) => n + f.byteSize, 0) > 50 * 1024 * 1024
      ) {
        await Promise.all(
          selected.map((f) =>
            sourceRequest('/assistant/attachments/release', {
              routineId: routine.id,
              attachmentId: f.id,
            }),
          ),
        );
        throw new Error('첨부는 최대 5개, 합계 50MB까지 가능합니다.');
      }
      setAttachments((files) => [...files, ...selected]);
      setStatus(
        selected.length
          ? `${selected.length}개 파일을 첨부했습니다. 질문을 입력하고 보내주세요.`
          : '이미 첨부된 파일은 중복 추가하지 않았습니다.',
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : '파일 첨부 실패');
    } finally {
      attachmentPickLock.current = false;
      setChoosingFiles(false);
      composer.current?.focus();
    }
  };
  const fileDrop = useChatFileDrop(
    visible && !choosingFiles && attachments.length < 5,
    chooseFiles,
  );
  const proposeEvent = (proposal: AssistantAnswer['events'][number]) => {
    try {
      const base = initialEvent(
        routine.schedule.timeZone,
        routine.live?.assistant?.calendarIds[0] ?? '',
      );
      setEvent({
        ...base,
        title: proposal.title,
        location: proposal.location,
        notes: proposal.notes,
        allDay: proposal.allDay,
        alarmMinutes: proposal.alarmMinutes,
        ...(proposal.start
          ? { start: calendarInstant(proposal.start, routine.schedule.timeZone) }
          : {}),
        ...(proposal.end ? { end: calendarInstant(proposal.end, routine.schedule.timeZone) } : {}),
      });
    } catch {
      setStatus('제안한 날짜를 해석하지 못했습니다. 날짜와 시간대를 다시 알려주세요.');
    }
  };
  const exportTask = (task: AssistantAnswer['tasks'][number]) => {
    const blob = new Blob(
        [
          JSON.stringify(
            {
              schema: 'gosu.briefing.task-proposal.v1',
              routineId: routine.id,
              state: 'draft',
              task,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'gosu-task-proposal.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section
      className={`briefing-chat chat-file-drop-target ${fileDrop.dragging ? 'is-file-dragging' : ''}`}
      {...fileDrop.handlers}
      aria-label="Briefing AI 대화"
      data-chat-engine="gosu-native"
    >
      {fileDrop.dragging && (
        <div className="chat-file-drop-notice" role="status">
          파일을 놓으면 이 대화에 첨부됩니다
        </div>
      )}
      <div className="briefing-chat-context">
        <b>{routine.name}</b>
      </div>
      {!paperChat && showSuggestions && restored && (
        <section ref={suggestions} className="briefing-chat-welcome" aria-label="추천 질문">
          <header className="briefing-chat-welcome-heading">
            {globalMode ? (
              <div className="briefing-chat-intro">
                {!messages.length && (
                  <span className="briefing-chat-avatar" aria-hidden="true">
                    G
                  </span>
                )}
                <h3>{messages.length ? '대화를 이어가세요' : '무엇을 도와드릴까요?'}</h3>
              </div>
            ) : (
              <h3>오늘 필요한 것부터 물어보세요</h3>
            )}
            <button
              type="button"
              className="briefing-chat-dismiss"
              aria-label="추천 질문 닫기"
              title="추천 질문만 닫고 대화 이어가기"
              onClick={() => {
                focusComposer.current = true;
                setShowSuggestions(false);
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </header>
          <p>
            {globalMode
              ? '허용한 일정·메일·논문과 프로젝트를 함께 살펴봅니다.'
              : '메일·논문 검색, 이전 브리핑, 오늘 일정과 일정 제안을 함께 확인합니다.'}
          </p>
          {(routine.suggestedQuestions ?? DEFAULT_BRIEFING_QUESTIONS).length === 0 && (
            <p>
              등록된 추천 질문이 없습니다. 아래 입력창에서 바로 질문하거나 설정에서 추가해주세요.
            </p>
          )}
          <div className="briefing-chat-suggestions">
            {(routine.suggestedQuestions ?? DEFAULT_BRIEFING_QUESTIONS).map((p) => (
              <button
                type="button"
                className="briefing-button"
                key={p}
                disabled={busy || !restored}
                onClick={() => void send(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="briefing-chat-log-region">
        <div
          className="briefing-chat-log"
          ref={log}
          tabIndex={0}
          aria-label="브리핑 대화 기록"
          onScroll={(e) => {
            // While the position is being put back, scrollTop is a temporary value, not the reader's.
            if (!visible || !e.currentTarget.clientHeight || reshow.current?.holding) return;
            const node = e.currentTarget;
            readingPosition.current = {
              top: node.scrollTop,
              count: messages.length,
              atBottom: node.scrollHeight - node.scrollTop - node.clientHeight < 32,
            };
            setNearLatest(isNearLatestMessage(node));
          }}
        >
          {!messages.length && !showSuggestions && (
            <p className="briefing-chat-empty">아래 입력창에서 대화를 시작하세요.</p>
          )}
          {/* Where the restored conversation begins, instead of a standing notice above the input. */}
          {otherScopeMessages > 0 && (
            <p role="note" className="briefing-chat-restored-note">
              이전 설정의 대화 {otherScopeMessages}개도 복원했습니다. 화면에만 표시하며, 현재
              권한으로 AI에 자동 재전송하지 않습니다.
            </p>
          )}
          {messages.map((m, i) => (
            <Fragment key={i}>
              {i > 0 && i === dividerIndex && <NewContextDivider />}
              <article className={`briefing-chat-message ${m.role}`}>
                <header>
                  <strong>{m.role === 'user' ? 'YOU' : 'GOSU'}</strong>
                  <span>{chatTime(m.createdAt)}</span>
                </header>
                <div className="briefing-chat-message-copy">
                  <BriefingMarkdown
                    webMedia={m.role === 'assistant'}
                    text={m.text}
                    restrained={m.role === 'assistant'}
                    emphasizedTitles={
                      m.role === 'assistant'
                        ? (m.result?.sources
                            .filter((s) => !s.kind || ['paper', 'email', 'news'].includes(s.kind))
                            .map((s) => s.title) ?? [])
                        : []
                    }
                  />
                </div>
                {!m.result && m.invocation && (
                  <footer className="briefing-chat-message-meta">
                    {m.invocation.providerId} · {m.invocation.model} ·{' '}
                    {m.invocation.reasoning || '기본 reasoning'}
                  </footer>
                )}
                {m.role === 'assistant' &&
                  m.result &&
                  !m.result.savedPapers?.length &&
                  // No offer for an answer that only read papers already in the library, unless the
                  // answer itself asks ("이 설명도 … 추가할까요?"): a question gets its two buttons.
                  (asksPaperLibraryQuestion(m.text) ||
                    !answersFromSavedPapers(m.result.sources)) && (
                    <PaperSummarySaveOffer
                      asked={asksPaperLibraryQuestion(m.text)}
                      question={
                        messages
                          .slice(0, i)
                          .reverse()
                          .find((v) => v.role === 'user')?.text ?? ''
                      }
                      answer={m.text}
                      references={m.result.sources.flatMap((s) =>
                        // A saved paper is offered again only when the answer asked about it.
                        s.kind === 'paper' &&
                        s.url &&
                        (!s.saved || asksPaperLibraryQuestion(m.text))
                          ? [{ title: s.title, url: s.paperUrl ?? s.url }]
                          : [],
                      )}
                      allowBareYes={
                        !m.result.events.length &&
                        !m.result.tasks.length &&
                        !m.result.settingsProposal
                      }
                      onReplyReady={
                        i === messages.length - 1
                          ? (handler) => {
                              paperReply.current = handler;
                            }
                          : undefined
                      }
                      onAsk={i === messages.length - 1 ? (prompt) => void send(prompt) : undefined}
                      onSave={(candidate) =>
                        sourceRequest<PaperSummarySaveReceipt>(
                          '/papers/shared/save',
                          {
                            candidate: {
                              ...candidate,
                              sourceUrls: [
                                ...new Set(
                                  candidate.sourceUrls.map(
                                    (url) =>
                                      m.result!.sources.find(
                                        (s) => s.kind === 'paper' && s.url === url,
                                      )?.paperUrl ?? url,
                                  ),
                                ),
                              ],
                            },
                            confirmed: true,
                          },
                          new AbortController().signal,
                        )
                      }
                    />
                  )}
                {m.result?.settingsProposal && (
                  <div className="briefing-settings-offer">
                    <strong>설정 변경안 · 아직 저장되지 않음</strong>
                    <p>{settingsProposalText(m.result.settingsProposal)}</p>
                    <button
                      type="button"
                      disabled={
                        !routine.live?.mail &&
                        (m.result.settingsProposal.mailDays !== undefined ||
                          m.result.settingsProposal.mailLimit !== undefined)
                      }
                      onClick={() => onSettings(m.result!.settingsProposal)}
                    >
                      설정에서 검토하기
                    </button>
                  </div>
                )}
                {m.result && (
                  <>
                    <footer className="briefing-chat-message-meta">
                      {m.result.invocation.providerId === 'claude-code' ? 'Claude Code' : 'Codex'} ·{' '}
                      {m.result.invocation.model} ·{' '}
                      {m.result.invocation.reasoning || '기본 reasoning'}
                    </footer>
                    <div className="briefing-chat-sources">
                      {m.result.sources.map((s) => (
                        <span key={s.id}>
                          {s.url?.startsWith('https://') ? (
                            <a href={s.url} target="_blank" rel="noreferrer">
                              <strong>{s.title}</strong> ↗
                            </a>
                          ) : (
                            <strong>{s.title}</strong>
                          )}
                          {s.kind === 'email' && (
                            <EmailDeliveryMeta
                              sender={s.mailSender}
                              account={s.mailAccount}
                              receivedAt={s.receivedAt}
                              timeZone={routine.schedule.timeZone}
                            />
                          )}
                        </span>
                      ))}
                    </div>
                    {m.result.events.map((p, index) => {
                      const existing = hasExistingCalendarEvent(m.result!.sources, p);
                      const eventTime = formatBriefingEventRange(
                        p.start,
                        p.end,
                        p.timeZone || routine.schedule.timeZone,
                        p.allDay,
                      );
                      return (
                        <div className="briefing-action-review" key={index}>
                          <strong>
                            {existing ? '일정 확인 · ' : '일정 제안 · '}
                            {p.title}
                          </strong>
                          <p>
                            {existing ? (
                              '이미 Calendar에 등록된 일정입니다.'
                            ) : (
                              <BriefingMarkdown inline text={p.reason} />
                            )}
                          </p>
                          <small className="briefing-action-time">
                            <strong>{eventTime}</strong>
                          </small>
                          {!existing && p.evidence && (
                            <small className="briefing-action-evidence">
                              근거 · {formatBriefingEvidence(p.evidence, routine.schedule.timeZone)}
                            </small>
                          )}
                          {existing ? (
                            <small className="briefing-action-confirmed">
                              Calendar에 이미 저장됨
                            </small>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="briefing-button"
                                disabled={!p.start || !p.end}
                                onClick={() => proposeEvent(p)}
                              >
                                검토 후 Calendar에 추가
                              </button>
                              {(!p.start || !p.end) && (
                                <small>날짜와 시간을 대화로 확정한 후 추가하세요.</small>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                    {m.result.tasks.map((t, index) => (
                      <div className="briefing-action-review" key={index}>
                        <strong>할 일 초안 · {t.title}</strong>
                        <BriefingMarkdown text={t.description} />
                        <small>
                          {t.deadline ? `마감 ${t.deadline}` : '마감 미정'} · {t.target} · GOSU에
                          아직 생성되지 않음
                        </small>
                        <BriefingTodoButton
                          routineId={routine.id}
                          title={t.title}
                          text={t.description}
                          sourceKey={`assistant-proposal:${m.createdAt}:${index}`}
                          preparedTask={chatTaskDraft(t, routine.schedule.timeZone)}
                        />
                        <button
                          type="button"
                          className="briefing-button"
                          onClick={() => exportTask(t)}
                        >
                          연동용 초안 JSON 저장
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </article>
            </Fragment>
          ))}
          {messages.length > 0 && dividerIndex === messages.length && <NewContextDivider />}
          {busy && (
            <article className="briefing-chat-message assistant thinking" role="status">
              <header>
                <strong>GOSU</strong>
                <span>
                  {busyKind === 'compact' ? '문맥 정리 중' : 'turn active'} · {elapsed}초
                </span>
              </header>
              <div className="briefing-chat-thinking">
                <i />
                <i />
                <i />
                <span>{status || '프로젝트 컨텍스트를 검토하고 있습니다.'}</span>
              </div>
            </article>
          )}
        </div>
        {/* The same control as Project Chat: shown only while the newest message is out of view. */}
        {!nearLatest && (
          <button
            type="button"
            className="briefing-chat-jump"
            aria-label="최신 메시지로 이동"
            title="최신으로 이동"
            onClick={() => {
              const node = log.current;
              if (!node) return;
              node.scrollTo?.({ top: node.scrollHeight, behavior: 'smooth' });
              readingPosition.current = {
                top: node.scrollHeight,
                count: messages.length,
                atBottom: true,
              };
              setNearLatest(true);
            }}
          >
            <span aria-hidden="true">↓</span>
            최신
          </button>
        )}
      </div>
      {/* While a turn runs its progress and time are in the "turn active" message above. */}
      {!busy && status && (
        <p
          role="status"
          className="briefing-chat-status"
          data-quiet={status === '답변 완료' ? 'true' : undefined}
        >
          {status}
        </p>
      )}
      <form
        className="briefing-chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <AssistantQueue state={queue.state} action={queue.action} />
        {restoreError && (
          <div role="alert">
            {restoreError}{' '}
            <button type="button" onClick={() => setRestoreAttempt((n) => n + 1)}>
              다시 불러오기
            </button>
          </div>
        )}
        {!restored && !restoreError && <small role="status">이전 대화 불러오는 중…</small>}
        <div className="briefing-chat-input-box">
          {!!attachments.length && (
            <div className="assistant-attachment-pills">
              {attachments.map((file) => (
                <span key={file.id} title={file.reconstructionNotice ?? file.displayName}>
                  {file.displayName}
                  <button
                    type="button"
                    aria-label={`${file.displayName} 첨부 해제`}
                    onClick={() => {
                      void sourceRequest('/assistant/attachments/release', {
                        routineId: routine.id,
                        attachmentId: file.id,
                      })
                        .then(() => setAttachments((all) => all.filter((f) => f.id !== file.id)))
                        .catch(() => setStatus('첨부 해제 실패'));
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {commandSuggestions.length > 0 && (
            <div className="briefing-chat-commands" role="listbox" aria-label="대화 명령">
              {commandSuggestions.map((command) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={draft.trim().toLowerCase() === command}
                  key={command}
                  onClick={() => {
                    setDraft(command);
                    composer.current?.focus();
                  }}
                >
                  <code>{command}</code>
                  <span>{CHAT_COMMAND_DETAILS[command]}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={composer}
            aria-label="Briefing 메시지"
            placeholder="메일, 논문, 일정, 이전 브리핑에 대해 질문하세요…"
            value={draft}
            maxLength={6000}
            onPointerDown={() => setShowSuggestions(false)}
            onChange={(e) => {
              setShowSuggestions(false);
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                // "/c" + Enter completes the command instead of sending "/c" to the model.
                const completion = commandSuggestions[0];
                if (completion && !parseChatSlashCommand(draft)) setDraft(completion);
                else void send();
              }
            }}
          />
          <div className="briefing-chat-input-toolbar">
            <div className="briefing-chat-input-shortcuts">
              <button
                type="button"
                className="briefing-chat-shortcut"
                aria-label="파일 첨부"
                title="문서·이미지 첨부 · 최대 5개/50MB · 현재 질문에만 사용"
                disabled={!queue.state.canAttach || choosingFiles || attachments.length >= 5}
                onClick={() => void chooseFiles()}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path
                    d="m8 12 7-7a3 3 0 0 1 4 4L9 19a5 5 0 0 1-7-7L13 1M5 15l9-9"
                    transform="translate(2 2) scale(.85)"
                  />
                </svg>
              </button>
              {!paperChat && (
                <button
                  type="button"
                  className="briefing-chat-shortcut"
                  aria-label="추천 질문"
                  ref={suggestionsToggle}
                  aria-expanded={showSuggestions}
                  title={showSuggestions ? '추천 질문 숨기기' : '추천 질문 보기'}
                  onClick={() => {
                    focusComposer.current = showSuggestions;
                    setShowSuggestions((open) => !open);
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 18h6m-5 3h4M8.5 14.5a6 6 0 1 1 7 0c-1 .7-1.5 1.5-1.5 3.5h-4c0-2-.5-2.8-1.5-3.5Z" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                className="briefing-chat-shortcut"
                aria-label="권한 설정"
                title="메일·일정 접근 권한 설정"
                onClick={() => onSettings()}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h3m4 0h11M3 12h11m4 0h3M3 18h5m4 0h9" />
                  <circle cx="8" cy="6" r="2" />
                  <circle cx="16" cy="12" r="2" />
                  <circle cx="10" cy="18" r="2" />
                </svg>
              </button>
            </div>
            <div className="briefing-chat-composer-actions">
              <div className="briefing-chat-composer-meta">
                <ContextUsageMeter usage={contextUsage} busy={busy} />
                <small id={approvalNoteId} className="briefing-chat-approval-note">
                  일정은 승인 후 실행 · 할 일은 연동용 초안
                </small>
              </div>
              {busy ? (
                <button
                  type="button"
                  className="briefing-button"
                  onClick={() => {
                    controller.current?.abort();
                    setStatus('요청을 중단했습니다.');
                  }}
                >
                  중단
                </button>
              ) : null}
              <button
                type="submit"
                className="briefing-primary"
                disabled={!draft.trim() || !restored || choosingFiles}
                title="일정은 승인 후 실행 · 할 일은 연동용 초안"
                aria-describedby={approvalNoteId}
              >
                {busy || queue.state.active ? '대기열에 추가 ↑' : '보내기 ↑'}
              </button>
            </div>
          </div>
        </div>
      </form>
      {event && (
        <CalendarEventEditor
          routineId={routine.id}
          initial={event}
          calendarIds={routine.live?.assistant?.calendarIds ?? []}
          onClose={() => setEvent(null)}
          onSaved={() =>
            setMessages((m) => [
              ...m,
              {
                role: 'assistant',
                text: '확인한 일정이 Apple Calendar에 저장되었습니다.',
                createdAt: new Date().toISOString(),
              },
            ])
          }
        />
      )}
    </section>
  );
}
