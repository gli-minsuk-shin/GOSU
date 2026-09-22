import { useEffect, useRef, type RefObject } from 'react';
import {
  briefingNotificationAnchor,
  type BriefingNotificationTarget,
} from './briefing-notifications';
import { scrollBriefingElement } from './briefing-jump';

export function useBriefingNotificationJump(
  root: RefObject<HTMLElement | null>,
  target: BriefingNotificationTarget | undefined,
  historyRevision: unknown,
) {
  const completed = useRef('');
  useEffect(() => {
    if (!target) return;
    const key = JSON.stringify(target);
    if (completed.current === key) return;
    const jump = () => {
      const element = document.getElementById(
        briefingNotificationAnchor(target.routineId, target.runId),
      );
      if (root.current && element && scrollBriefingElement(root.current, element, 'auto'))
        completed.current = key;
    };
    if (typeof requestAnimationFrame !== 'function') {
      jump();
      return;
    }
    // Allow retained iframe visibility and tab restoration to settle first.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(jump);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, historyRevision, root]);
}
