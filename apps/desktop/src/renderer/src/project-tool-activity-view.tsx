import { memo, useEffect, useMemo, useState } from 'react';
import { formatUiDateTime, useUiText } from '@gosu/ui/language';

import type { ProjectChatEvent } from '../../shared/project-chat-contracts';
import type { ProjectToolActivity } from '../../shared/project-tool-activity';
import './project-tool-activity-view.css';

export type ProjectToolActivityEvent = Pick<
  Extract<ProjectChatEvent, { type: 'agent.progress' }>,
  'stage' | 'tool' | 'callId' | 'success' | 'activity' | 'occurredAt' | 'elapsedMs'
> & { readonly turnId?: string };

export type ProjectToolActivityRow = Readonly<{
  key: string;
  tool: string;
  callId: string;
  stage: 'tool_started' | 'tool_completed';
  success?: boolean | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  elapsedMs?: number | undefined;
  activity?: ProjectToolActivity | undefined;
}>;

const MAX_CALLS = 40;
const COLLAPSED_CALLS = 6;
const callKey = (event: ProjectToolActivityEvent) =>
  JSON.stringify([event.turnId ?? '', event.callId]);
const timestamp = (value?: string) => {
  const time = value === undefined ? NaN : Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
};

/** Keep oldest unfinished calls visible; fill remaining space with recent results. */
function prioritizeUnfinished<T>(
  values: readonly T[],
  limit: number,
  unfinished: (value: T) => boolean,
): T[] {
  const pending = values.filter(unfinished).slice(0, limit);
  const remaining = limit - pending.length;
  const recent =
    remaining > 0 ? values.filter((value) => !unfinished(value)).slice(-remaining) : [];
  const selected = new Set([...pending, ...recent]);
  return values.filter((value) => selected.has(value));
}

/** Keep both lifecycle facts, but only one copy of each, within the current turn. */
export function mergeProjectToolActivityEvents<T extends ProjectToolActivityEvent>(
  existing: readonly T[],
  incoming: T | readonly T[],
): T[] {
  const groups = new Map<string, Map<string, T>>();
  const additions: readonly T[] = Array.isArray(incoming) ? incoming : [incoming as T];
  for (const event of [...existing, ...additions]) {
    const key = callKey(event);
    const group = groups.get(key) ?? new Map<string, T>();
    const previous = group.get(event.stage);
    group.set(
      event.stage,
      previous
        ? {
            ...event,
            ...previous,
            activity: { ...event.activity, ...previous.activity },
            success: previous.success ?? event.success,
            occurredAt: previous.occurredAt ?? event.occurredAt,
            elapsedMs: previous.elapsedMs ?? event.elapsedMs,
          }
        : event,
    );
    groups.set(key, group);
  }
  return prioritizeUnfinished(
    [...groups.values()],
    MAX_CALLS,
    (group) => !group.has('tool_completed'),
  ).flatMap((group) => [...group.values()]);
}

export function projectToolActivityRows(
  events: readonly ProjectToolActivityEvent[],
): ProjectToolActivityRow[] {
  const calls = new Map<
    string,
    { start?: ProjectToolActivityEvent; end?: ProjectToolActivityEvent }
  >();
  for (const event of mergeProjectToolActivityEvents([], events)) {
    const key = callKey(event);
    const call = calls.get(key) ?? {};
    if (event.stage === 'tool_started') call.start = event;
    else call.end = event;
    calls.set(key, call);
  }
  return [...calls.entries()].map(([key, { start, end }]) => {
    const event = (end ?? start)!;
    const startMs = timestamp(start?.occurredAt);
    const endMs = timestamp(end?.occurredAt);
    return {
      key,
      tool: event.tool,
      callId: event.callId,
      stage: end ? 'tool_completed' : 'tool_started',
      success: end?.success,
      startedAt: start?.occurredAt,
      completedAt: end?.occurredAt,
      elapsedMs:
        end?.elapsedMs ??
        (startMs !== undefined && endMs !== undefined && endMs >= startMs
          ? endMs - startMs
          : undefined),
      activity:
        start?.activity || end?.activity ? { ...start?.activity, ...end?.activity } : undefined,
    };
  });
}

const toolTitles: Readonly<Record<string, string>> = {
  read_local_note: 'Read Research Note',
  list_turn_attachments: 'List attached files',
  read_turn_attachment_text: 'Read attached file',
  list_manuscripts: 'List manuscripts',
  list_manuscript_checkpoint_files: 'List manuscript checkpoint files',
  read_manuscript_checkpoint_file: 'Read manuscript checkpoint file',
  search_literature: 'Search research papers',
  delegate_to_hermes_agent: 'Delegate to Hermes agent',
  list_ssh_workspaces: 'List authorized server workspaces',
  read_ssh_workspace_resources: 'Check server resources',
  list_ssh_workspace_files: 'List server workspace files',
  read_ssh_workspace_file: 'Read server workspace file',
  write_ssh_workspace_file: 'Write server workspace file',
  run_ssh_workspace_command: 'Run server workspace command',
  read_experiment_setup: 'Read experiment setup',
  list_experiment_runs: 'List experiment runs',
  create_experiment_run: 'Create experiment run',
  execute_experiment_run: 'Execute experiment run',
};

function toolTitle(row: ProjectToolActivityRow): string {
  if (row.tool === 'read_workspace') {
    return row.activity?.section === 'board'
      ? 'Read project Board'
      : row.activity?.section === 'objective'
        ? 'Read project Goal & Metrics'
        : row.activity?.section === 'summary'
          ? 'Read project summary'
          : 'Read project workspace';
  }
  if (row.tool === 'list_local_notes') {
    return row.activity?.query ? 'Search Research Notes' : 'List Research Notes';
  }
  return toolTitles[row.tool] ?? 'Run project tool';
}

const countMessages: Readonly<Record<string, string>> = {
  tasks: '{count} tasks',
  notes: '{count} notes',
  files: '{count} files',
  characters: '{count} characters',
  attachments: '{count} attachments',
  papers: '{count} papers',
  runs: '{count} runs',
  matches: '{count} matches',
};

const boundedText = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, limit - 1)}…` : value;

export const ProjectToolActivityView = memo(function ProjectToolActivityView({
  events,
  providerLabel,
  turnInFlight = true,
}: Readonly<{
  events: readonly ProjectToolActivityEvent[];
  providerLabel?: string;
  turnInFlight?: boolean;
}>) {
  const t = useUiText();
  const rows = useMemo(() => projectToolActivityRows(events), [events]);
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ticking =
    turnInFlight &&
    rows.some((row) => row.stage === 'tool_started' && timestamp(row.startedAt) !== undefined);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [ticking]);

  if (rows.length === 0) return null;
  const visible = showAll
    ? rows
    : prioritizeUnfinished(rows, COLLAPSED_CALLS, (row) => row.stage === 'tool_started');
  return (
    <section
      className="project-tool-activity"
      aria-label={
        providerLabel
          ? t('Tool activity for {provider}', { provider: boundedText(providerLabel, 80) })
          : t('Tool activity')
      }
    >
      <div className="project-tool-activity-heading">
        <strong>{t('Tool activity')}</strong>
        <span>{t('{count} calls', { count: rows.length })}</span>
      </div>
      <ol>
        {visible.map((row) => {
          const activity = row.activity;
          const running = row.stage === 'tool_started';
          const status = running
            ? turnInFlight
              ? 'Running'
              : 'Result not received'
            : row.success === false
              ? 'Failed'
              : row.success === true
                ? 'Completed'
                : 'Result received';
          const startedMs = timestamp(row.startedAt);
          const elapsed = running
            ? turnInFlight && startedMs !== undefined
              ? Math.max(0, now - startedMs)
              : undefined
            : row.elapsedMs;
          const duration =
            elapsed === undefined
              ? undefined
              : t('{seconds}s', {
                  seconds:
                    elapsed < 10_000 ? (elapsed / 1_000).toFixed(1) : Math.floor(elapsed / 1_000),
                });
          return (
            <li
              key={row.key}
              data-call-id={row.callId}
              data-activity-state={
                running ? 'running' : row.success === false ? 'failed' : 'received'
              }
            >
              <details>
                <summary>
                  <div className="project-tool-activity-title">
                    <strong>{t(toolTitle(row))}</strong>
                    <span className="project-tool-activity-status">
                      {t(status)}
                      {duration && (
                        <span
                          className="project-tool-activity-duration"
                          aria-hidden={running ? true : undefined}
                        >
                          {duration}
                        </span>
                      )}
                    </span>
                  </div>
                  {(activity?.target || activity?.query) && (
                    <div className="project-tool-activity-context">
                      {activity.target && <span>{boundedText(activity.target, 240)}</span>}
                      {activity.query && (
                        <span>
                          {t('Query: {query}', { query: boundedText(activity.query, 160) })}
                        </span>
                      )}
                    </div>
                  )}
                  {((activity?.counts?.length ?? 0) > 0 || activity?.truncated) && (
                    <div className="project-tool-activity-result">
                      {activity?.counts?.slice(0, 8).map(({ kind, value }) => (
                        <span key={kind}>{t(countMessages[kind]!, { count: value })}</span>
                      ))}
                      {activity?.truncated && <span>{t('Partial result')}</span>}
                    </div>
                  )}
                </summary>
                <dl className="project-tool-activity-details">
                  <div>
                    <dt>{t('Tool')}</dt>
                    <dd>
                      <code>{boundedText(row.tool, 128)}</code>
                    </dd>
                  </div>
                  {row.startedAt && timestamp(row.startedAt) !== undefined && (
                    <div>
                      <dt>{t('Started')}</dt>
                      <dd>
                        <time dateTime={row.startedAt}>
                          {formatUiDateTime(row.startedAt, {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </time>
                      </dd>
                    </div>
                  )}
                  {row.completedAt && timestamp(row.completedAt) !== undefined && (
                    <div>
                      <dt>{t('Result received at')}</dt>
                      <dd>
                        <time dateTime={row.completedAt}>
                          {formatUiDateTime(row.completedAt, {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </time>
                      </dd>
                    </div>
                  )}
                  {activity?.offset !== undefined && (
                    <div>
                      <dt>{t('Read offset')}</dt>
                      <dd>{activity.offset}</dd>
                    </div>
                  )}
                  {activity?.limit !== undefined && (
                    <div>
                      <dt>{t('Requested limit')}</dt>
                      <dd>{activity.limit}</dd>
                    </div>
                  )}
                  {activity?.errorCode && (
                    <div>
                      <dt>{t('Error code')}</dt>
                      <dd>
                        <code>{boundedText(activity.errorCode, 80)}</code>
                      </dd>
                    </div>
                  )}
                  {!activity && (
                    <div>
                      <dd>{t('No additional tool details were provided.')}</dd>
                    </div>
                  )}
                </dl>
              </details>
            </li>
          );
        })}
      </ol>
      {rows.length > COLLAPSED_CALLS && (
        <button
          type="button"
          className="project-tool-activity-toggle"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? t('Show recent calls') : t('Show all {count} calls', { count: rows.length })}
        </button>
      )}
    </section>
  );
});
