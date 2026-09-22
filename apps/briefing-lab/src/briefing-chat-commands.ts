import type { ChatSlashCommand } from '@gosu/ui/chat-slash-commands';
import type { ConversationMessage } from './briefing-conversation';
import type { ContextUsage } from './context-usage';

/** One line per command for the menu that opens while the draft is a single word starting with "/". */
export const CHAT_COMMAND_DETAILS: Record<ChatSlashCommand, string> = {
  '/new': '새 문맥으로 시작 · 이전 메시지는 화면에 남고 AI에는 전달하지 않습니다',
  '/compact': '이전 대화를 지금 요약해 문맥을 줄입니다 · 원본은 보존됩니다',
};

/**
 * Where the "new conversation" line goes: the index of the first message of the current context,
 * `messages.length` while that context is still empty, and -1 when `/new` was never used.
 * Compared as instants: a stored time with and without milliseconds does not sort as text.
 */
export function contextDividerIndex(
  messages: readonly Pick<ConversationMessage, 'createdAt'>[],
  contextStartedAt: string | undefined,
) {
  const start = contextStartedAt ? Date.parse(contextStartedAt) : Number.NaN;
  if (!Number.isFinite(start)) return -1;
  const index = messages.findIndex((message) => Date.parse(message.createdAt) >= start);
  return index < 0 ? messages.length : index;
}

/** The meter after a reload: the latest report of the current context, never one from before `/new`. */
export function latestContextUsage(
  messages: readonly Pick<ConversationMessage, 'createdAt' | 'contextUsage'>[],
  contextStartedAt: string | undefined,
): ContextUsage | undefined {
  const from = Math.max(0, contextDividerIndex(messages, contextStartedAt));
  return [...messages.slice(from)].reverse().find((message) => message.contextUsage)?.contextUsage;
}

export function newContextStatus(result: { started: boolean; setAside: number }) {
  return result.started
    ? `새 대화를 시작했습니다. 이전 메시지 ${result.setAside}개는 화면에 남지만 AI에 전달하지 않습니다.`
    : '이미 새 대화 상태입니다. AI에 전달할 이전 메시지가 없습니다.';
}

export function compactStatus(result: { compacted: boolean; summarizedMessages: number }) {
  return result.compacted
    ? `이전 메시지 ${result.summarizedMessages}개를 요약으로 바꿨습니다. 원본 대화는 그대로 보존됩니다.`
    : '아직 요약할 이전 대화가 없습니다. 최근 메시지 4개는 항상 원문 그대로 전달합니다.';
}

export function contextCommandRefusal(command: ChatSlashCommand) {
  return `답변이 진행 중이거나 대기 질문이 있어 ${command}를 실행하지 않았습니다. 끝난 뒤 다시 입력해주세요.`;
}
