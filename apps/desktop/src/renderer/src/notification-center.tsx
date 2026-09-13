import { useEffect, useId, useRef, useState } from 'react';
import { uiLocale, useUiText } from '@gosu/ui/language';
import { SidebarIcon } from './sidebar-icon';
import {
  emptyNotificationInbox,
  notificationCounts,
  type NotificationInbox,
  type NotificationMarkAction,
  type WorkspaceNotification,
} from './workspace-notifications';
import './notification-center.css';

export type NotificationCenterProps = Readonly<{
  items: readonly WorkspaceNotification[];
  inbox: NotificationInbox;
  onMark: (ids: readonly string[], action: NotificationMarkAction) => void;
  onOpen: (item: WorkspaceNotification) => void;
  onRefresh?: () => void;
  loading?: boolean;
  storageError?: boolean;
  suppressed?: boolean;
}>;
export const EMPTY_NOTIFICATION_CENTER: NotificationCenterProps = {
  items: [],
  inbox: emptyNotificationInbox(),
  onMark: () => undefined,
  onOpen: () => undefined,
};

export function NotificationCenter({
  items,
  inbox,
  onMark,
  onOpen,
  onRefresh,
  loading = false,
  storageError = false,
  suppressed = false,
}: NotificationCenterProps) {
  const t = useUiText();
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const [limit, setLimit] = useState(40);
  const counts = notificationCounts(items, inbox);
  const visible = items.filter(
    (item) => !inbox.marks[item.id]?.dismissed && (filter === 'all' || !inbox.marks[item.id]?.read),
  );
  const position = () => {
    const anchor = button.current?.getBoundingClientRect();
    if (!anchor || !panel.current) return;
    const width = Math.min(440, window.innerWidth - 24);
    const top = Math.max(12, Math.min(anchor.bottom + 10, window.innerHeight - 230));
    panel.current.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))}px`;
    panel.current.style.top = `${top}px`;
    panel.current.style.maxHeight = `${Math.max(180, window.innerHeight - top - 12)}px`;
  };
  const close = (restoreFocus = false) => {
    panel.current?.hidePopover?.();
    setOpen(false);
    if (restoreFocus) button.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (suppressed) {
      panel.current?.hidePopover?.();
      setOpen(false);
    }
  }, [suppressed]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [open]);
  return (
    <>
      <button
        ref={button}
        className={`project-quick-action notification-bell${open ? ' active' : ''}`}
        type="button"
        title={t('Notifications')}
        aria-label={t('Notifications, {count} unread', { count: counts.unread })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        disabled={suppressed}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          onRefresh?.();
          position();
          panel.current?.showPopover?.();
          setOpen(true);
          setLimit(40);
        }}
      >
        <SidebarIcon name="notifications" />
        {counts.unread > 0 && (
          <span className="notification-count" aria-hidden="true">
            {counts.badge}
          </span>
        )}
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={t('Notifications')}
        className="notification-popover"
        onToggle={(event) => setOpen(event.newState === 'open')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close(true);
          }
        }}
      >
        <header>
          <div>
            <h2>{t('Notifications')}</h2>
            <p>{t('{count} unread', { count: counts.unread })}</p>
          </div>
          <button
            className="notification-close"
            type="button"
            aria-label={t('Close notifications')}
            onClick={() => close(true)}
          >
            ×
          </button>
        </header>
        <div className="notification-toolbar">
          <div role="group" aria-label={t('Notification filter')}>
            <button
              type="button"
              aria-pressed={filter === 'unread'}
              onClick={() => {
                setFilter('unread');
                setLimit(40);
              }}
            >
              {t('Unread')}
            </button>
            <button
              type="button"
              aria-pressed={filter === 'all'}
              onClick={() => {
                setFilter('all');
                setLimit(40);
              }}
            >
              {t('All')}
            </button>
          </div>
          <button
            type="button"
            disabled={counts.unread === 0}
            onClick={() =>
              onMark(
                items.filter((item) => !inbox.marks[item.id]?.dismissed).map((item) => item.id),
                'read',
              )
            }
          >
            {t('Mark all as read')}
          </button>
        </div>
        {storageError && (
          <p className="notification-storage-warning" role="status">
            {t('Notification read state could not be saved. Changes may be lost after restarting.')}
          </p>
        )}
        <div className="notification-list-scroll">
          {loading && (
            <p className="notification-empty" role="status">
              {t('Checking task deadlines…')}
            </p>
          )}
          {!loading && visible.length === 0 && (
            <div className="notification-empty">
              <strong>
                {t(filter === 'unread' ? 'You are all caught up' : 'No notifications')}
              </strong>
              <p>{t('Unfinished task deadlines and important workspace updates appear here.')}</p>
            </div>
          )}
          <ol>
            {visible.slice(0, limit).map((item) => {
              const read = inbox.marks[item.id]?.read ?? false;
              const title =
                item.kind === 'deadline' || item.kind === 'calendar' ? item.title : t(item.title);
              const summary =
                item.kind === 'deadline'
                  ? item.phase === 'overdue'
                    ? Math.abs(item.daysUntilDue ?? 0) === 1
                      ? t('1 day overdue')
                      : t('{days} days overdue', { days: Math.abs(item.daysUntilDue ?? 0) })
                    : item.phase === 'today'
                      ? t('Due today')
                      : item.phase === 'tomorrow'
                        ? t('Due tomorrow')
                        : t('Due in {days} days', { days: item.daysUntilDue ?? 0 })
                  : item.kind === 'calendar'
                    ? t(
                        item.calendarPhase === 'soon'
                          ? 'Calendar · starting soon'
                          : item.calendarPhase === 'ongoing'
                            ? 'Calendar · in progress'
                            : item.calendarPhase === 'today'
                              ? 'Calendar · today'
                              : item.calendarPhase === 'tomorrow'
                                ? 'Calendar · tomorrow'
                                : 'Calendar · upcoming',
                      )
                    : t(
                        item.kind === 'briefing'
                          ? 'Briefing update'
                          : item.kind === 'chat'
                            ? 'Project Chat'
                            : 'Workspace update',
                      );
              return (
                <li
                  key={item.id}
                  className={`notification-item ${item.severity}${read ? ' read' : ' unread'}`}
                >
                  <div className="notification-item-heading">
                    <span className="notification-severity">{summary}</span>
                    {!read && <span className="notification-unread-dot" aria-label={t('Unread')} />}
                  </div>
                  <button
                    type="button"
                    className="notification-open-item"
                    aria-label={t('Open notification: {title}', { title })}
                    onClick={() => {
                      onMark([item.id], 'read');
                      onOpen(item);
                      close();
                    }}
                  >
                    <strong>{title}</strong>
                    {item.projectName && <span>{item.projectName}</span>}
                    {item.detail && <p>{item.detail}</p>}
                    {item.emailCounts && (
                      <p>
                        {item.emailCounts.state === 'failed'
                          ? t('Email check failed; new-email count is unknown')
                          : item.emailCounts.state === 'disabled'
                            ? t('Email checking is disabled')
                            : t('{emails} new emails · {important} important', {
                                emails: item.emailCounts.total,
                                important: item.emailCounts.important,
                              })}
                        {item.emailCounts.unclassified > 0 &&
                          ` · ${t('{count} awaiting priority analysis', { count: item.emailCounts.unclassified })}`}
                        {item.emailCounts.partial && ` · ${t('Some sources need checking')}`}
                      </p>
                    )}
                  </button>
                  <footer>
                    {item.calendarStart && item.allDay ? (
                      <time dateTime={item.calendarStart}>
                        {new Date(item.calendarStart).toLocaleDateString(uiLocale(), {
                          timeZone: item.calendarTimeZone,
                          month: 'short',
                          day: 'numeric',
                        })}{' '}
                        · {t('All day')}
                      </time>
                    ) : item.dueDate ? (
                      <time dateTime={item.dueDate}>{item.dueDate}</time>
                    ) : item.createdAt ? (
                      <time dateTime={item.createdAt}>
                        {new Date(item.createdAt).toLocaleString(uiLocale(), {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    ) : (
                      <span />
                    )}
                    <div>
                      <button
                        type="button"
                        onClick={() => onMark([item.id], read ? 'unread' : 'read')}
                      >
                        {t(read ? 'Mark unread' : 'Mark read')}
                      </button>
                      <button
                        type="button"
                        aria-label={t('Hide notification: {title}', { title })}
                        title={t('Hide notification only; keep the original task or message')}
                        onClick={() => onMark([item.id], 'dismiss')}
                      >
                        {t('Hide')}
                      </button>
                    </div>
                  </footer>
                </li>
              );
            })}
          </ol>
          {visible.length > limit && (
            <button
              type="button"
              className="notification-show-more"
              onClick={() => setLimit((value) => value + 40)}
            >
              {t('Show more notifications')}
            </button>
          )}
        </div>
        <footer className="notification-panel-footer">
          <p>
            {t(
              'Deadlines: overdue, today, and the next 7 days. Dates use this Mac’s local calendar.',
            )}
          </p>
          {counts.hidden > 0 && (
            <button
              type="button"
              onClick={() =>
                onMark(
                  items.filter((item) => inbox.marks[item.id]?.dismissed).map((item) => item.id),
                  'restore',
                )
              }
            >
              {t('Restore {count} hidden notifications', { count: counts.hidden })}
            </button>
          )}
        </footer>
      </div>
    </>
  );
}
