export type AiWorkload = 'assistant' | 'briefing' | 'papers' | 'model-lab' | 'chat' | 'lecture';
export type AiActivityPhase = 'running' | 'completed' | 'failed' | 'cancelled';
export type AiActivityMessage = {
  type: 'gosu-ai-activity';
  workload: AiWorkload;
  runId: string;
  phase: AiActivityPhase;
};
export type AiActivityStatus = 'running' | 'completed' | undefined;
export type AiActivityState = Readonly<
  Record<string, { running: readonly string[]; completed: boolean }>
>;

export function parseAiActivity(value: unknown): AiActivityMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some((k) => !['type', 'workload', 'runId', 'phase'].includes(k)) ||
    v.type !== 'gosu-ai-activity' ||
    typeof v.workload !== 'string' ||
    !['assistant', 'briefing', 'papers', 'model-lab', 'chat', 'lecture'].includes(v.workload) ||
    typeof v.phase !== 'string' ||
    !['running', 'completed', 'failed', 'cancelled'].includes(v.phase) ||
    typeof v.runId !== 'string' ||
    !/^[\w:.-]{1,256}$/.test(v.runId)
  )
    return null;
  return v as AiActivityMessage;
}
export function trustedAiActivity(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  frame: Window | null,
  url: string | null,
) {
  if (!frame || !url || event.source !== frame || event.origin !== new URL(url).origin) return null;
  return parseAiActivity(event.data);
}
export function reduceAiActivity(
  state: AiActivityState,
  scope: string,
  event: AiActivityMessage,
): AiActivityState {
  const old = state[scope] ?? { running: [], completed: false };
  if (event.phase === 'running') {
    if (old.running.includes(event.runId) || old.running.length >= 128) return state;
    return { ...state, [scope]: { ...old, running: [...old.running, event.runId] } };
  }
  if (!old.running.includes(event.runId)) return state;
  return {
    ...state,
    [scope]: {
      running: old.running.filter((id) => id !== event.runId),
      completed: old.completed || event.phase === 'completed',
    },
  };
}
export function aiActivityStatus(state: AiActivityState, scope: string): AiActivityStatus {
  return state[scope]?.running.length
    ? 'running'
    : state[scope]?.completed
      ? 'completed'
      : undefined;
}
export function combineAiActivity(...states: AiActivityStatus[]): AiActivityStatus {
  return states.includes('running')
    ? 'running'
    : states.includes('completed')
      ? 'completed'
      : undefined;
}
export function acknowledgeAiActivity(state: AiActivityState, scope: string): AiActivityState {
  return state[scope]?.completed
    ? { ...state, [scope]: { ...state[scope]!, completed: false } }
    : state;
}
export function resetAiActivitySource(
  state: AiActivityState,
  scope: string,
  prefix?: string,
): AiActivityState {
  const old = state[scope];
  if (!old) return state;
  if (prefix)
    return {
      ...state,
      [scope]: { ...old, running: old.running.filter((id) => !id.startsWith(prefix)) },
    };
  const next = { ...state };
  delete next[scope];
  return next;
}

/** Metadata only; parent authenticates the exact embedded frame and binds its project scope. */
const activeMessages = new Map<string, AiActivityMessage>();
const syncedWindows = new WeakSet<Window>();
function installActivitySync() {
  if (typeof window === 'undefined' || syncedWindows.has(window)) return;
  syncedWindows.add(window);
  window.addEventListener?.('message', (event) => {
    if (
      event.source !== window.parent ||
      event.data?.type !== 'gosu-ai-activity-sync' ||
      !(event.origin === 'null' || /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(event.origin))
    )
      return;
    for (const value of activeMessages.values()) window.parent.postMessage(value, '*');
  });
}
export function beginAiActivity(workload: AiWorkload, signal?: AbortSignal) {
  const runId =
    globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let finished = false;
  const send = (phase: AiActivityPhase) => {
    const value: AiActivityMessage = { type: 'gosu-ai-activity', workload, runId, phase };
    if (phase === 'running') activeMessages.set(runId, value);
    else activeMessages.delete(runId);
    try {
      installActivitySync();
      if (typeof window !== 'undefined' && window.parent !== window)
        window.parent.postMessage(value, '*');
      else if (typeof window !== 'undefined')
        window.dispatchEvent?.(new CustomEvent('gosu-ai-activity-local', { detail: value }));
    } catch {
      /* Status decoration must never break execution. */
    }
  };
  const finish = (phase: Exclude<AiActivityPhase, 'running'>) => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener('abort', abort);
    send(signal?.aborted ? 'cancelled' : phase);
  };
  const abort = () => finish('cancelled');
  if (signal?.aborted) {
    finished = true;
    return finish;
  }
  send('running');
  signal?.addEventListener('abort', abort, { once: true });
  return finish;
}
export async function trackAiActivity<T>(
  workload: AiWorkload,
  work: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const finish = beginAiActivity(workload, signal);
  try {
    const value = await work();
    finish('completed');
    return value;
  } finally {
    finish('failed');
  }
}
