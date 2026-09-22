import { AsyncLocalStorage } from 'node:async_hooks';
import type { ModelInvocation } from '@gosu/contracts';
import type { NativeTokenUsage } from './src/context-usage';
export type NativeUsageScope = {
  workloadKind:
    | 'briefing_assistant'
    | 'briefing_summary'
    | 'paper_summary'
    | 'context_compaction'
    | 'daily_quote'
    | 'model_lab';
  projectId: string | null;
};
export type NativeUsageObservation = NativeUsageScope & {
  invocation: ModelInvocation;
  usage: NativeTokenUsage | undefined;
  completedAt: string;
  successful: boolean;
};
const context = new AsyncLocalStorage<NativeUsageScope>();
let observer: ((event: NativeUsageObservation) => Promise<void>) | undefined;
export const withNativeUsageScope = <T>(scope: NativeUsageScope, run: () => T) =>
  context.run(scope, run);
export function configureNativeUsageObserver(next: typeof observer) {
  observer = next;
}
export async function observeNativeUsage(
  event: Omit<NativeUsageObservation, keyof NativeUsageScope>,
) {
  if (!observer) return;
  try {
    await observer({
      ...event,
      ...(context.getStore() ?? { workloadKind: 'briefing_summary', projectId: null }),
    });
  } catch {
    console.error('[GOSU] Native token usage could not be recorded; totals may be incomplete.');
  }
}
