import type { ModelBuildProgress } from './src/model-lab-builder';

/** Keep the streamed request alive while the provider is generating its final JSON. */
export function startModelBuilderHeartbeat(options: {
  phase: 'llm-running' | 'model-ir-repairing';
  attempt: number;
  timeoutMs: number;
  responseKind?: 'model-ir' | 'narrative-patches';
  onProgress?: ((progress: ModelBuildProgress) => void) | undefined;
}) {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    options.onProgress?.({
      phase: options.phase,
      message: `LLM call ${options.attempt} is still running · ${Math.floor((Date.now() - startedAt) / 1000)} seconds elapsed · ${options.timeoutMs / 60_000} minute limit. Waiting for the provider's ${options.responseKind === 'narrative-patches' ? 'targeted formula/description patches' : 'complete ModelIR response'}.`,
    });
  }, 15_000);
  return () => clearInterval(timer);
}
