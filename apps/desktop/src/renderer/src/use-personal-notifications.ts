import { useCallback, useEffect, useRef, useState } from 'react';
import type { BriefingNotificationSnapshot } from '../../../../briefing-lab/src/briefing-notifications';
/** Main-owned metadata feed, independent from whether the Briefing iframe was ever opened. */
export function usePersonalNotifications() {
  const [snapshot, setSnapshot] = useState<BriefingNotificationSnapshot>();
  const [error, setError] = useState(false);
  const mounted = useRef(true),
    reading = useRef(false);
  const refresh = useCallback(async () => {
    if (reading.current || !window.gosu?.briefingLab?.notifications) return;
    reading.current = true;
    try {
      const next = await window.gosu.briefingLab.notifications();
      if (mounted.current) {
        setSnapshot((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        );
        setError(false);
      }
    } catch {
      if (mounted.current) {
        setError(true);
        setSnapshot(undefined);
      }
    } finally {
      reading.current = false;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    const wake = () => void refresh();
    window.addEventListener('focus', wake);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', wake);
    };
  }, [refresh]);
  return { snapshot, error, refresh };
}
