import type { InterestProfile, LiveSettings } from '@gosu/briefing-core';
import type { LiveProgress, LiveSourceResult } from './live-types';
import { briefingHeaders } from './briefing-client-session';
const BASE = '/api/briefing-agent';
export async function sourceResponse(path: string, value: unknown, signal: AbortSignal) {
  const result = await fetch(`${BASE}/sources${path}`, {
    method: 'POST',
    headers: await briefingHeaders(signal),
    body: JSON.stringify(value),
    signal,
  });
  if (!result.ok) {
    let message = '소스 연결 요청에 실패했습니다.';
    try {
      message = ((await result.json()) as { error: string }).error || message;
    } catch {
      /* Keep bounded public fallback. */
    }
    throw new Error(message);
  }
  return result;
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
