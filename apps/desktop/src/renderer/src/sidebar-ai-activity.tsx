import { useCallback, useEffect, useState } from 'react';
import { uiLocale } from '@gosu/ui/language';
import {
  acknowledgeAiActivity,
  reduceAiActivity,
  parseAiActivity,
  resetAiActivitySource,
  type AiActivityState,
  type AiActivityMessage,
  type AiActivityStatus,
} from '@gosu/ui/ai-activity';
import './sidebar-ai-activity.css';
export function projectChatAiScope(
  projectId: string,
  session?: { criticalReviewMode?: string | null | undefined } | null,
) {
  return `project:${projectId}:${session?.criticalReviewMode ? 'review' : 'chat'}`;
}
export async function trackProjectAiWork<T>(
  projectId: string,
  tab: 'experiments' | 'literature',
  work: () => Promise<T>,
): Promise<T> {
  const runId = crypto.randomUUID();
  const send = (phase: AiActivityMessage['phase']) => {
    try {
      window.dispatchEvent(
        new CustomEvent('gosu-ai-project-activity', {
          detail: {
            scope: `project:${projectId}:${tab}`,
            event: { type: 'gosu-ai-activity', workload: 'chat', runId, phase },
          },
        }),
      );
    } catch {
      /* Decoration must not interrupt a task. */
    }
  };
  send('running');
  try {
    const result = await work();
    send('completed');
    return result;
  } catch (error) {
    send('failed');
    throw error;
  }
}
export function useSidebarAiActivity() {
  const [activity, setActivity] = useState<AiActivityState>({});
  const report = useCallback(
    (scope: string, event: AiActivityMessage) =>
      setActivity((state) => reduceAiActivity(state, scope, event)),
    [],
  );
  const acknowledge = useCallback(
    (scope: string) => setActivity((state) => acknowledgeAiActivity(state, scope)),
    [],
  );
  const reset = useCallback(
    (scope: string, prefix?: string) =>
      setActivity((state) => resetAiActivitySource(state, scope, prefix)),
    [],
  );
  useEffect(() => {
    const receive = (event: Event) => {
      const value = parseAiActivity((event as CustomEvent).detail);
      if (value && ['assistant', 'briefing', 'papers', 'lecture'].includes(value.workload))
        report(value.workload, value);
    };
    window.addEventListener('gosu-ai-activity-local', receive);
    const projectReceive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const value = parseAiActivity(detail?.event);
      if (
        value &&
        typeof detail?.scope === 'string' &&
        /^project:[a-f0-9-]{36}:(experiments|literature)$/.test(detail.scope)
      )
        report(detail.scope, value);
    };
    window.addEventListener('gosu-ai-project-activity', projectReceive);
    return () => {
      window.removeEventListener('gosu-ai-activity-local', receive);
      window.removeEventListener('gosu-ai-project-activity', projectReceive);
    };
  }, [report]);
  return { activity, report, acknowledge, reset };
}
export function AiActivityStar({ status }: { status: AiActivityStatus }) {
  if (!status) return null;
  const ko = uiLocale().startsWith('ko');
  const label =
    status === 'running'
      ? ko
        ? 'AI 작업 중'
        : 'AI working'
      : ko
        ? 'AI 작업 완료 · 열어서 확인'
        : 'AI complete · open to review';
  return (
    <span className={`sidebar-ai-star is-${status}`} role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path
          pathLength="1"
          d="M10 1.5 12.2 7.8 18.5 10 12.2 12.2 10 18.5 7.8 12.2 1.5 10 7.8 7.8Z"
        />
      </svg>
    </span>
  );
}
