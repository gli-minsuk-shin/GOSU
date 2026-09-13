import type { ModelCatalog } from '@gosu/contracts';
import type { RoutineProgress, RoutineRequest, RoutineResult } from './routine-builder';

const BASE = '/api/briefing-agent';
export type RoutineConnection = {
  providerId: 'codex' | 'claude-code';
  catalog: ModelCatalog | null;
  error: string | null;
};
export interface RoutineClient {
  models(signal: AbortSignal): Promise<RoutineConnection[]>;
  run(
    request: RoutineRequest,
    signal: AbortSignal,
    progress: (value: RoutineProgress) => void,
  ): Promise<RoutineResult>;
}
export function createRoutineClient(): RoutineClient {
  let token = '';
  const headers = async (signal: AbortSignal) => {
    if (!token) {
      const response = await fetch(`${BASE}/session`, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('routine_unavailable');
      token = ((await response.json()) as { token: string }).token;
    }
    return { 'Content-Type': 'application/json', 'X-Gosu-Routine-Token': token };
  };
  return {
    async models(signal) {
      token = ''; // Refresh also reconciles a restarted local server.
      const response = await fetch(`${BASE}/models`, {
        signal,
        headers: await headers(signal),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('routine_unavailable');
      return ((await response.json()) as { providers: RoutineConnection[] }).providers;
    },
    async run(request, signal, progress) {
      const response = await fetch(BASE, {
        method: 'POST',
        headers: await headers(signal),
        body: JSON.stringify(request),
        signal,
      });
      if (!response.ok || !response.body) throw new Error('routine_unavailable');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let result: RoutineResult | undefined;
      try {
        while (true) {
          const { done, value } = await reader.read();
          pending += decoder.decode(value, { stream: !done });
          if (pending.length > 128000) throw new Error('routine_response_limit');
          let boundary: number;
          while ((boundary = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, boundary);
            pending = pending.slice(boundary + 1);
            if (!line.trim()) continue;
            const event = JSON.parse(line) as {
              type: string;
              progress: RoutineProgress;
              result: RoutineResult;
              message: string;
            };
            if (event.type === 'progress') progress(event.progress);
            if (event.type === 'result') result = event.result;
            if (event.type === 'error') throw new Error(event.message);
          }
          if (done) break;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (!result) throw new Error('routine_result_missing');
      return result;
    },
  };
}
