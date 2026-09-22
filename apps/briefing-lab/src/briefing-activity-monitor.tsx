import { useEffect } from 'react';
import { beginAiActivity } from '@gosu/ui/ai-activity';
import { isGosuEmbedded } from './desktop-bridge';
import { sourceRequest } from './live-client';
import { GenerationStatusSchema, type GenerationView } from './briefing-generation-contract';

/** Observe already-running jobs even when the generation controls are not visible. Never starts a job. */
export function BriefingActivityMonitor({ routineId }: { routineId: string | undefined }) {
  useEffect(() => {
    if (!routineId || !isGosuEmbedded()) return;
    const controller = new AbortController();
    let checking = false;
    let failures = 0;
    let active: { id: string; finish: ReturnType<typeof beginAiActivity> } | null = null;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const view = await sourceRequest<GenerationView>(
          '/generation/status',
          { routineId },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (view.job === null) {
          active?.finish('cancelled');
          active = null;
          failures = 0;
          return;
        }
        const parsed = GenerationStatusSchema.safeParse(view.job);
        if (!parsed.success) throw Error('invalid generation status');
        failures = 0;
        const job = parsed.data;
        if (active && active.id !== job.id) {
          active.finish('cancelled');
          active = null;
        }
        if (job.state === 'running' && !active)
          active = { id: job.id, finish: beginAiActivity('briefing', controller.signal) };
        else if (job.state !== 'running' && active) {
          active.finish(job.state === 'complete' && !job.error ? 'completed' : 'failed');
          active = null;
        }
      } catch {
        if (++failures >= 3) {
          active?.finish('failed');
          active = null;
        }
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [routineId]);
  return null;
}
