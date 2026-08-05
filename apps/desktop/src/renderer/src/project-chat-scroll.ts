export const PROJECT_CHAT_NEAR_BOTTOM_THRESHOLD = 96;

export type ProjectChatArrivalIntent = 'none' | 'bottom' | 'latest-start';

export type ProjectChatArrivalDecision = Readonly<{
  intent: ProjectChatArrivalIntent;
  announceNewAssistantMessage: boolean;
}>;

export function isProjectChatNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = PROJECT_CHAT_NEAR_BOTTOM_THRESHOLD,
) {
  if (![scrollTop, scrollHeight, clientHeight, threshold].every(Number.isFinite)) return true;
  const distanceFromBottom = Math.max(0, scrollHeight - clientHeight - scrollTop);
  return distanceFromBottom <= Math.max(0, threshold);
}

export function resolveProjectChatArrival({
  nearBottom,
  latestRole,
  latestMessageIdChanged,
  latestContentChanged,
}: Readonly<{
  nearBottom: boolean;
  latestRole: 'user' | 'assistant' | null;
  latestMessageIdChanged: boolean;
  latestContentChanged: boolean;
}>): ProjectChatArrivalDecision {
  if (!latestContentChanged) {
    return { intent: 'none', announceNewAssistantMessage: false };
  }

  if (latestRole === 'assistant') {
    if (!nearBottom) {
      return { intent: 'none', announceNewAssistantMessage: true };
    }
    return {
      intent: latestMessageIdChanged ? 'latest-start' : 'bottom',
      announceNewAssistantMessage: false,
    };
  }

  return {
    intent: nearBottom && latestMessageIdChanged ? 'bottom' : 'none',
    announceNewAssistantMessage: false,
  };
}
