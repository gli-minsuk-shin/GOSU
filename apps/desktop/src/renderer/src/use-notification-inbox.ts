import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectChatEvent } from '../../shared/project-chat-contracts';
import {
  emptyNotificationInbox,
  markNotifications,
  NOTIFICATION_STORAGE_KEY,
  parseNotificationInbox,
  recordChatNotification,
  type NotificationMarkAction,
} from './workspace-notifications';

export function useNotificationInbox() {
  const [loaded] = useState(() => {
    try {
      const raw = window.localStorage.getItem(NOTIFICATION_STORAGE_KEY);
      if (raw === null) return { value: emptyNotificationInbox(), error: false };
      if (raw.length > 4_000_000) throw Error('oversized_inbox');
      const value = parseNotificationInbox(JSON.parse(raw));
      if (!value) throw Error('invalid_inbox');
      return { value, error: false };
    } catch {
      return { value: emptyNotificationInbox(), error: true };
    }
  });
  const [inbox, setInbox] = useState(loaded.value);
  const [storageError, setStorageError] = useState(loaded.error);
  const lastSaved = useRef(JSON.stringify(loaded.value));
  useEffect(() => {
    const next = JSON.stringify(inbox);
    if (next === lastSaved.current) return;
    try {
      if (next.length > 4_000_000) throw new Error('notification_storage_limit');
      window.localStorage.setItem(NOTIFICATION_STORAGE_KEY, next);
      lastSaved.current = next;
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [inbox]);
  const mark = useCallback((ids: readonly string[], action: NotificationMarkAction) => {
    const now = new Date().toISOString();
    setInbox((current) => markNotifications(current, ids, action, now));
  }, []);
  const recordTurn = useCallback(
    (event: Extract<ProjectChatEvent, { type: 'turn.completed' }>, read: boolean) => {
      const now = new Date().toISOString();
      setInbox((current) => recordChatNotification(current, event, now, read));
    },
    [],
  );
  return { inbox, mark, recordTurn, storageError };
}
