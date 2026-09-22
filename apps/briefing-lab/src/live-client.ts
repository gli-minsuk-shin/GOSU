import type { InterestProfile, LiveSettings } from '@gosu/briefing-core';
import type { LiveProgress, LiveSourceResult } from './live-types';
import { briefingHeaders } from './briefing-client-session';
const BASE = '/api/briefing-agent';
/**
 * The server turns away a fourth concurrent request with 429 routine_busy before reading it, so the
 * same request can be sent again without repeating any action.
 */
const BUSY_RETRY_MS = [300, 700, 1500];
const BUSY_MESSAGE =
  'Briefing Lab이 다른 요청을 처리하는 중이라 이 요청을 받지 못했습니다(동시 요청 3개 제한). 잠시 뒤 다시 시도해주세요.';
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
export async function sourceResponse(path: string, value: unknown, signal: AbortSignal) {
  const body = JSON.stringify(value);
  for (let attempt = 0; ; attempt++) {
    const result = await fetch(`${BASE}/sources${path}`, {
      method: 'POST',
      headers: await briefingHeaders(signal),
      body,
      signal,
    });
    if (result.ok) return result;
    let message = '소스 연결 요청에 실패했습니다.';
    try {
      message = ((await result.json()) as { error: string }).error || message;
    } catch {
      /* Keep bounded public fallback. */
    }
    if (result.status === 429 && message === 'routine_busy') {
      if (attempt < BUSY_RETRY_MS.length) {
        await pause(BUSY_RETRY_MS[attempt]!, signal);
        continue;
      }
      throw Object.assign(new Error(BUSY_MESSAGE), { code: 'routine_busy' });
    }
    throw new Error(message);
  }
}
export function sourceRequest<T>(path: string, value: unknown): Promise<T>;
export function sourceRequest<T>(path: string, value: unknown, signal: AbortSignal): Promise<T>;
export async function sourceRequest<T>(
  path: string,
  value: unknown,
  signal: AbortSignal = new AbortController().signal,
): Promise<T> {
  return (await sourceResponse(path, value, signal)).json() as Promise<T>;
}
export async function collectSources(
  input: { routineId: string; live: LiveSettings; interest: InterestProfile },
  signal: AbortSignal,
  progress: (value: LiveProgress) => void,
): Promise<LiveSourceResult[]> {
  const res = await sourceResponse('/collect', input, signal);
  if (!res.body) throw new Error('소스 응답이 없습니다.');
  const reader = res.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    result: LiveSourceResult[] | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 2_000_000) throw new Error('소스 응답이 너무 큽니다.');
      let pos: number;
      while ((pos = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, pos);
        buffer = buffer.slice(pos + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line) as {
          type: string;
          progress: LiveProgress;
          result: LiveSourceResult[];
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
  if (!result) throw new Error('조회를 완료하지 못했습니다. 다시 시도해주세요.');
  return result;
}
