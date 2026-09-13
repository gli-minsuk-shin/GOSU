import { Temporal } from 'temporal-polyfill';
import type { BriefingSnapshot } from './briefing-history-snapshot';
import { briefingTargetId } from './briefing-jump';
import { upcomingTodos, type BriefingTodo } from './briefing-todos';
import { isGosuEmbedded } from './desktop-bridge';
import { openBriefingItem } from './briefing-item-navigation';

type AgendaEvent = NonNullable<BriefingSnapshot['calendar']>[number] & { jumpId?: string };
export function briefingDate(value: string, timeZone = 'Asia/Seoul', includeTime = true) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    ...(includeTime ? ({ hour: 'numeric', minute: '2-digit' } as const) : {}),
  }).format(new Date(value));
}
export function agendaDays(referenceAt: string, timeZone: string, events: readonly AgendaEvent[]) {
  const today = Temporal.Instant.from(referenceAt).toZonedDateTimeISO(timeZone).startOfDay();
  return [0, 1].map((offset) => {
    const start = today.add({ days: offset }),
      end = start.add({ days: 1 });
    return {
      label: `${offset === 0 ? '오늘' : '내일'} 일정 (${briefingDate(start.toInstant().toString(), timeZone, false)})`,
      events: events.filter(
        (e) =>
          Date.parse(e.start) < end.epochMilliseconds &&
          Date.parse(e.end) > start.epochMilliseconds,
      ),
      date: start.toPlainDate().toString(),
    };
  });
}
export function BriefingAgendaDays({
  events,
  referenceAt,
  timeZone,
  navigationScope,
  showEmpty = true,
  todos,
}: {
  events: readonly AgendaEvent[];
  referenceAt: string;
  timeZone: string;
  navigationScope?: string | undefined;
  showEmpty?: boolean;
  todos?: readonly BriefingTodo[] | undefined;
}) {
  const targetIds = new Set<string>();
  const days = agendaDays(referenceAt, timeZone, events);
  const tasks = upcomingTodos(todos ?? [], days[1]!.date).slice(0, 6);
  const statusLabel = {
    backlog: '대기',
    planned: '예정',
    in_progress: '진행 중',
    review: '검토',
    done: '완료',
  };
  return (
    <div className="briefing-agenda-days">
      {days.map((day, dayIndex) => (
        <section className="briefing-agenda-day" key={day.date} aria-label={day.label}>
          <h3>{todos ? day.label.replace(' 일정', '') : day.label}</h3>
          {day.events.map((e, index) => {
            const anchorId = e.jumpId ?? e.id;
            const target =
              navigationScope && anchorId && !targetIds.has(anchorId)
                ? briefingTargetId(navigationScope, 'calendar', anchorId)
                : undefined;
            if (anchorId) targetIds.add(anchorId);
            const time = new Intl.DateTimeFormat('ko-KR', {
              timeZone,
              hour: 'numeric',
              minute: '2-digit',
            });
            return (
              <article
                className={todos ? 'briefing-agenda-calendar' : undefined}
                key={`${e.id ?? index}:${e.start}`}
                id={target}
                data-briefing-jump-target={target ? 'true' : undefined}
                tabIndex={target ? -1 : undefined}
                aria-label={target ? e.title : undefined}
              >
                {todos && <span className="briefing-agenda-kind calendar">▦ 일정</span>}
                {isGosuEmbedded() && e.id ? (
                  <button
                    className="briefing-item-link"
                    onClick={() =>
                      openBriefingItem({ kind: 'calendar', id: e.id!, start: e.start })
                    }
                    title="Calendar에서 일정 열기"
                  >
                    {e.title} ↗
                  </button>
                ) : (
                  <strong>{e.title}</strong>
                )}
                <span>
                  <strong>
                    {e.allDay
                      ? '종일'
                      : `${time.format(new Date(e.start))} ~ ${time.format(new Date(e.end))}`}
                  </strong>
                  {e.location ? ` · ${e.location}` : ''}
                </span>
              </article>
            );
          })}
          {tasks
            .filter((t) =>
              dayIndex === 0
                ? !t.dueDate || t.dueDate.slice(0, 10) <= day.date
                : t.dueDate?.slice(0, 10) === day.date,
            )
            .map((t) => (
              <article
                key={`todo:${t.id}`}
                className="briefing-agenda-todo"
                aria-label={`할 일 · ${t.title}`}
              >
                <span className="briefing-agenda-kind todo">☐ 할 일</span>
                <div className="briefing-todo-copy">
                  {isGosuEmbedded() ? (
                    <button
                      className="briefing-item-link"
                      onClick={() => openBriefingItem({ kind: 'task', id: t.id })}
                      title="To-do list에서 할 일 열기"
                    >
                      {t.title} ↗
                    </button>
                  ) : (
                    <strong>{t.title}</strong>
                  )}
                  <small>
                    {t.projectName} · {statusLabel[t.status]} ·{' '}
                    {t.dueDate
                      ? `${t.dueDate.slice(0, 10)} 마감${t.dueDate.slice(0, 10) < days[0]!.date ? ' · 기한 지남' : ''}`
                      : '기한 없음'}
                  </small>
                </div>
              </article>
            ))}
          {!day.events.length && showEmpty && (
            <p className="briefing-muted">
              {todos ? '캘린더 일정은 없습니다.' : '등록된 일정이 없습니다.'}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
