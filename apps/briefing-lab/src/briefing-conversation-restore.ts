import { sourceRequest } from './live-client';
import type { ConversationMessage } from './briefing-conversation';
import type { PaperChatReference } from './paper-chat-reference';
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
/** Only retry this read-only restoration, never a model turn or a saved action. */
export async function restoreBriefingConversation(
  routineId: string,
  signal: AbortSignal,
  pause = wait,
  /** 논문 요약 restores its one page conversation, not the assistant's. The reference only says
   *  which paper the screen has attached; the transcript is the page's either way. */
  paperReference?: PaperChatReference,
  papersChat = false,
) {
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await sourceRequest<{
        messages: ConversationMessage[];
        otherScopeMessages?: number;
        /** Set once `/new` was used: where the screen draws the "new conversation" line. */
        contextStartedAt?: string;
      }>(
        '/assistant/conversation/get',
        {
          routineId,
          ...(papersChat || paperReference ? { papersChat: true } : {}),
          ...(paperReference ? { paperReference } : {}),
        },
        signal,
      );
    } catch (error) {
      const transient =
        error instanceof TypeError ||
        (error instanceof Error &&
          ['routine_busy', 'routine_token_denied'].includes(
            (error as Error & { code?: string }).code ?? error.message,
          ));
      if (signal.aborted || !transient || attempt >= 2) throw error;
      await pause(400 * (attempt + 1), signal);
    }
  }
}
