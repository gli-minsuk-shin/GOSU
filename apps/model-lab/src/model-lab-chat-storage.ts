import type { ModelChatSession, ChatMessage } from './model-lab-app';
import type { ModelLabStorage } from './model-lab-environment';
import { ContextUsageSchema } from '../../briefing-lab/src/context-usage';
import { readModuleQuestionRef } from './module-detail-flow';
import { modelChatContextStart, trimmedModelChatContextStart } from './model-chat-commands';

export const MODEL_LAB_CHAT_STORAGE_KEY = 'gosu.model-lab.chat-sessions.v1';
export function modelLabConversationWorkspace(storage: ModelLabStorage | null) {
  if (!storage) return undefined;
  const key = 'gosu.model-lab.conversation-owner.v1';
  try {
    const existing = storage.getItem(key);
    if (existing) return /^[a-f0-9-]{36}$/i.test(existing) ? existing : undefined;
    const id = crypto.randomUUID();
    storage.setItem(key, id);
    return id;
  } catch {
    return undefined;
  }
}
export function loadModelLabChats(
  storage: ModelLabStorage | null,
): Record<string, ModelChatSession> {
  try {
    const text = storage?.getItem(MODEL_LAB_CHAT_STORAGE_KEY);
    if (!text || text.length > 8_000_000) return {};
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .slice(-100)
        .flatMap(([key, raw]) => {
          if (
            !raw ||
            typeof raw !== 'object' ||
            !('messages' in raw) ||
            !Array.isArray(raw.messages)
          )
            return [];
          const messages: ChatMessage[] = (raw.messages as unknown[])
            .slice(-200)
            .filter((candidate): candidate is ChatMessage => {
              const message = candidate as ChatMessage | null;
              return Boolean(
                message &&
                typeof message === 'object' &&
                typeof message.id === 'string' &&
                typeof message.modelId === 'string' &&
                typeof message.modelVersion === 'string' &&
                typeof message.createdAt === 'string' &&
                ['user', 'assistant'].includes(message.role) &&
                typeof message.body === 'string' &&
                message.body.length <= 100_000 &&
                (message.trace === undefined ||
                  (Array.isArray(message.trace) &&
                    message.trace.every((item: unknown) => typeof item === 'string'))) &&
                (message.attachmentNames === undefined ||
                  (Array.isArray(message.attachmentNames) &&
                    message.attachmentNames.every((item: unknown) => typeof item === 'string'))),
              );
            });
          const draft =
            'draft' in raw && typeof raw.draft === 'string' ? raw.draft.slice(0, 100_000) : '';
          // Sessions stored before "/new" existed simply have no divider.
          const contextStartsAt = modelChatContextStart(
            'contextStartsAt' in raw ? raw.contextStartsAt : undefined,
            messages.length,
          );
          return [
            [
              key,
              {
                draft,
                ...(contextStartsAt ? { contextStartsAt } : {}),
                messages: messages.map(({ usage, contextUsage, moduleRef, ...message }) => {
                  const module = readModuleQuestionRef(moduleRef);
                  const context = ContextUsageSchema.safeParse(contextUsage);
                  const validUsage =
                    usage &&
                    [
                      'inputTokens',
                      'outputTokens',
                      'cachedReadTokens',
                      'cachedWriteTokens',
                      'totalTokens',
                    ].every(
                      (key) =>
                        Number.isSafeInteger(usage[key as keyof typeof usage]) &&
                        usage[key as keyof typeof usage] >= 0,
                    );
                  return {
                    ...message,
                    ...(module ? { moduleRef: module } : {}),
                    ...(validUsage ? { usage } : {}),
                    ...(context.success ? { contextUsage: context.data } : {}),
                  };
                }),
                attachments: [],
              },
            ],
          ];
        }),
    );
  } catch {
    return {};
  }
}

export function saveModelLabChats(
  storage: ModelLabStorage | null,
  sessions: Readonly<Record<string, ModelChatSession>>,
  drafts: Readonly<Record<string, string>>,
) {
  const snapshot = Object.fromEntries(
    Object.entries(sessions)
      .slice(-100)
      .map(([key, session]) => {
        const messages = session.messages.slice(-200);
        const contextStartsAt = trimmedModelChatContextStart(
          session.contextStartsAt ?? 0,
          session.messages.length,
          messages.length,
        );
        return [
          key,
          {
            draft: (drafts[key] ?? session.draft).slice(0, 100_000),
            ...(contextStartsAt ? { contextStartsAt } : {}),
            messages,
          },
        ];
      }),
  );
  const text = JSON.stringify(snapshot);
  if (text.length > 8_000_000) throw new Error('Model Lab chat storage limit reached');
  storage?.setItem(MODEL_LAB_CHAT_STORAGE_KEY, text);
}
