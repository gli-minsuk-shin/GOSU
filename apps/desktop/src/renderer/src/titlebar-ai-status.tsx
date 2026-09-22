import { uiText, useUiText } from '@gosu/ui/language';
import { useEffect, useState } from 'react';
import type { AiActivityState } from '@gosu/ui/ai-activity';

import { AiActivityStar } from './sidebar-ai-activity';

export type AiWorkItem = Readonly<{
  scope: string;
  label: string;
  status: 'running' | 'completed';
}>;

/** How long one job's line stands before the next one takes its place. */
export const AI_WORK_ROTATE_MS = 2_000;

/**
 * What AI is doing right now, from the same state the sidebar stars read. Running work comes
 * first, then work that finished and has not been looked at; a scope the caller cannot name is
 * left out rather than shown as an id. The order is stable so the rotation does not jump about.
 */
export function aiWorkItems(
  activity: AiActivityState,
  describe: (scope: string) => string | null,
): AiWorkItem[] {
  const items: AiWorkItem[] = [];
  for (const status of ['running', 'completed'] as const)
    for (const scope of Object.keys(activity).sort()) {
      const entry = activity[scope];
      if (!entry) continue;
      const matches = status === 'running' ? entry.running.length > 0 : entry.completed;
      if (!matches || (status === 'completed' && entry.running.length > 0)) continue;
      const label = describe(scope);
      if (label) items.push({ scope, label, status });
    }
  return items;
}

/**
 * The title bar's AI slot. One job is described at a time; with several, each takes its turn every
 * `rotateMs`. Running work turns the working star, finished work shows the yellow one, and clicking
 * the line opens the chat or screen that did the work. Nothing is shown while nothing is running,
 * so an idle title bar stays quiet.
 */
export function TitlebarAiStatus({
  items,
  onOpen,
  rotateMs = AI_WORK_ROTATE_MS,
}: {
  items: readonly AiWorkItem[];
  onOpen: (scope: string) => void;
  rotateMs?: number;
}) {
  useUiText();
  const [index, setIndex] = useState(0);
  const key = items.map((item) => `${item.scope}:${item.status}`).join('|');
  useEffect(() => {
    setIndex(0);
  }, [key]);
  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => setIndex((value) => value + 1), Math.max(300, rotateMs));
    return () => clearInterval(timer);
  }, [key, items.length, rotateMs]);

  if (!items.length) return null;
  const current = items[index % items.length]!;
  const running = items.filter((item) => item.status === 'running').length;
  return (
    <button
      type="button"
      className="titlebar-ai-status"
      data-status={current.status}
      aria-live="polite"
      title={
        items.length > 1
          ? `${items.map((item) => item.label).join('\n')}\n${uiText('Click to open the one shown')}`
          : uiText('Click to open')
      }
      onClick={() => onOpen(current.scope)}
    >
      <AiActivityStar status={current.status} />
      <span className="titlebar-ai-status-label">{current.label}</span>
      {items.length > 1 && (
        <em>
          {running > 0
            ? uiText('{count} running', { count: running })
            : uiText('{count} done', { count: items.length })}
        </em>
      )}
    </button>
  );
}
