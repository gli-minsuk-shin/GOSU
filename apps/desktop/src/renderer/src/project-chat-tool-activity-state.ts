import type { ProjectChatEvent } from '../../shared/project-chat-contracts';
import { projectChatSessionKey } from './project-chat-session-state';
import { mergeProjectToolActivityEvents } from './project-tool-activity-view';

type ToolEvent = Extract<ProjectChatEvent, { type: 'agent.progress' }>;
type ActivityEvent = Extract<
  ProjectChatEvent,
  { type: 'agent.progress' | 'turn.started' | 'turn.completed' }
>;
export type ProjectChatToolActivityState = Readonly<
  Record<
    string,
    Readonly<{
      turnId: string;
      finished: boolean;
      events: readonly ToolEvent[];
    }>
  >
>;

/** Volatile, project/session/turn-bound observations, never added to LLM memory or user messages. */
export function reduceProjectChatToolActivity(
  state: ProjectChatToolActivityState,
  event: ActivityEvent,
): ProjectChatToolActivityState {
  const key = projectChatSessionKey(event.projectId, event.sessionId);
  const previous = state[key];
  if (event.type === 'turn.started') {
    if (previous?.turnId === event.turnId) return state;
    return { ...state, [key]: { turnId: event.turnId, finished: false, events: [] } };
  }
  if (previous && (previous.turnId !== event.turnId || previous.finished)) return state;
  if (event.type === 'turn.completed') {
    return previous ? { ...state, [key]: { ...previous, finished: true } } : state;
  }
  return {
    ...state,
    [key]: {
      turnId: event.turnId,
      finished: false,
      events: mergeProjectToolActivityEvents(previous?.events ?? [], event),
    },
  };
}
