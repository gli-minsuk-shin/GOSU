import { sourceResponse } from './live-client';
import { ContextUsageSchema, type ContextUsage } from './context-usage';
export async function workspaceStream<T>(
  path: string,
  input: unknown,
  signal: AbortSignal,
  onProgress: (detail: string) => void,
  onContextUsage?: (usage: ContextUsage) => void,
): Promise<T | null> {
  const response = await sourceResponse(path, input, signal);
  if (response.headers.get('content-type')?.includes('application/json')) {
    const data = (await response.json()) as { skipped?: boolean };
    if (data.skipped) return null;
    throw new Error('처리 결과 형식을 확인하지 못했습니다.');
  }
  if (!response.body) throw new Error('응답을 받지 못했습니다.');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    result: T | undefined,
    total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      total += value?.byteLength ?? 0;
      if (total > 8_000_000) throw new Error('응답 크기 제한');
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!line.trim()) continue;
        const e = JSON.parse(line) as {
          type: string;
          detail: string;
          message: string;
          result: T;
          usage?: unknown;
        };
        if (e.type === 'context-usage') {
          const usage = ContextUsageSchema.safeParse(e.usage);
          if (usage.success) onContextUsage?.(usage.data);
        }
        if (e.type === 'progress' || e.type === 'analysis-progress') onProgress(e.detail);
        if (e.type === 'error') throw new Error(e.message);
        if (e.type === 'result') result = e.result;
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!result) throw new Error('완료 결과가 없습니다. 다시 시도해주세요.');
  return result;
}
