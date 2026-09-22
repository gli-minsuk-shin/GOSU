import { uiLocale, uiText } from '@gosu/ui/language';
import type { ReactNode } from 'react';

import { localDateString } from './kanban-board-model';

export type CompactTaskDue = Readonly<{
  state: 'overdue' | 'today' | 'tomorrow' | 'upcoming';
  /** Whole calendar days from today; negative when the date has passed. */
  days: number;
}>;

const dayOrdinal = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round(Date.UTC(year!, month! - 1, day!) / 86_400_000);
};

/** What a dense row says about a due date: the days that matter by name, the rest as a short date. */
export function compactTaskDue(
  dueDate: string | undefined,
  _dueAt?: string,
  today = localDateString(),
): CompactTaskDue | null {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/u.test(dueDate)) return null;
  const days = dayOrdinal(dueDate) - dayOrdinal(today);
  return {
    state: days < 0 ? 'overdue' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'upcoming',
    days,
  };
}

/**
 * A due date in a few characters ("Today", "Tomorrow 9:00 PM", "3d late", "9/25"). The full date
 * stays in the title and the dateTime attribute; only today and overdue are colored.
 */
export function TaskDue({
  dueDate,
  dueAt,
  today,
}: {
  dueDate: string | undefined;
  dueAt: string | undefined;
  today?: string;
}) {
  const due = compactTaskDue(dueDate, dueAt, today);
  if (!due || !dueDate) return null;
  const locale = uiLocale();
  const [year, month, day] = dueDate.split('-').map(Number);
  const date = new Date(year!, month! - 1, day!);
  const sameYear = (today ?? localDateString()).slice(0, 4) === dueDate.slice(0, 4);
  const time = dueAt
    ? new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
        new Date(dueAt),
      )
    : '';
  const dayText =
    due.state === 'today'
      ? uiText('Today')
      : due.state === 'tomorrow'
        ? uiText('Tomorrow')
        : due.state === 'overdue'
          ? uiText('{days}d late', { days: -due.days })
          : new Intl.DateTimeFormat(locale, {
              month: 'numeric',
              day: 'numeric',
              ...(sameYear ? {} : { year: '2-digit' }),
            }).format(date);
  const full = `${
    due.state === 'overdue'
      ? uiText('Overdue · ')
      : due.state === 'today'
        ? uiText('Today · ')
        : uiText('Due · ')
  }${dueAt ? new Date(dueAt).toLocaleString(locale) : dueDate}`;
  return (
    <time
      className={`task-due ${due.state === 'tomorrow' ? 'upcoming' : due.state}`}
      dateTime={dueDate}
      title={full}
    >
      {time && due.state !== 'overdue' ? `${dayText} ${time}` : dayText}
    </time>
  );
}

export type TaskIconName = 'edit' | 'trash' | 'left' | 'right' | 'plus';
const ICONS: Record<TaskIconName, ReactNode> = {
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  left: <path d="M19 12H5M11 6l-6 6 6 6" />,
  right: <path d="M5 12h14M13 6l6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
};

/** Decorative stroke icon on the same grid as the sidebar icons; the button carries the name. */
export function TaskIcon({ name }: { name: TaskIconName }) {
  return (
    <svg className="task-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}
