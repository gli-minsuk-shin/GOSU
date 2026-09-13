import { useEffect, useState } from 'react';
import { sourceRequest } from './live-client';
import type { FeedbackDecision } from './briefing-insight-card';
import type { LiveSourceResult } from './live-types';

export function useLiveFeedback(routineId: string, results: readonly LiveSourceResult[]) {
  const receiptKey = JSON.stringify([
    ...new Set(
      results
        .filter((r) => r.items.some((i) => i.kind === 'email' || i.kind === 'papers'))
        .flatMap((r) => (r.receiptId ? [r.receiptId] : [])),
    ),
  ]);
  const [choices, setChoices] = useState<Record<string, FeedbackDecision>>({});
  const [warning, setWarning] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    setChoices({});
    setWarning('');
    const ids = JSON.parse(receiptKey) as string[];
    if (ids.length)
      void Promise.all(
        ids.map((receiptId) =>
          sourceRequest<{ choices: Record<string, FeedbackDecision> }>(
            '/memory/feedback/choices',
            { routineId, receiptId },
            abort.signal,
          ),
        ),
      )
        .then((values) => {
          if (abort.signal.aborted) return;
          if (
            values.some(
              (v) =>
                !v.choices ||
                typeof v.choices !== 'object' ||
                Object.values(v.choices).some((c) => c !== 'important' && c !== 'not-interested'),
            )
          )
            throw new Error('invalid_feedback');
          const restored = Object.assign({}, ...values.map((v) => v.choices)) as Record<
            string,
            FeedbackDecision
          >;
          // A vote saved while this read was pending wins over the older read snapshot.
          setChoices((current) => ({ ...restored, ...current }));
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setWarning('저장된 관심 선택을 확인하지 못했습니다. 기존 선택 기록은 유지됩니다.');
        });
    return () => abort.abort();
  }, [routineId, receiptKey]);
  return {
    choices,
    warning,
    saved: (id: string, decision: FeedbackDecision) =>
      setChoices((current) => ({ ...current, [id]: decision })),
  };
}
