import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ModelLabAgentProgress } from './model-lab-agent-harness';

/** A selected view is a subscriber, not the owner of an in-flight question. */
export class ModelChatRuns {
  private runs = new Map<
    string,
    { controller: AbortController; progress: readonly ModelLabAgentProgress[] }
  >();
  private listeners = new Set<() => void>();
  private revision = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  private changed() {
    this.revision++;
    this.listeners.forEach((listener) => listener());
  }
  get(key: string) {
    return this.runs.get(key);
  }
  start(key: string) {
    if (this.runs.has(key)) return null;
    const controller = new AbortController();
    this.runs.set(key, { controller, progress: [] });
    this.changed();
    return controller;
  }
  owns(key: string, controller: AbortController) {
    return this.runs.get(key)?.controller === controller;
  }
  progress(key: string, controller: AbortController, event: ModelLabAgentProgress) {
    const run = this.runs.get(key);
    if (!run || run.controller !== controller || controller.signal.aborted) return;
    this.runs.set(key, { ...run, progress: [...run.progress, event].slice(-12) });
    this.changed();
  }
  finish(key: string, controller: AbortController) {
    if (!this.owns(key, controller)) return;
    this.runs.delete(key);
    this.changed();
  }
  stop(key: string) {
    this.runs.get(key)?.controller.abort();
  }
  removeModel(modelId: string) {
    for (const [key, run] of this.runs) {
      if ((JSON.parse(key) as string[])[0] !== modelId) continue;
      run.controller.abort();
      this.runs.delete(key);
    }
    this.changed();
  }
  dispose() {
    this.runs.forEach((run) => run.controller.abort());
    this.runs.clear();
    this.changed();
  }
}
export function useModelChatRuns() {
  const ref = useRef<ModelChatRuns | null>(null);
  if (!ref.current) ref.current = new ModelChatRuns();
  const runs = ref.current;
  useSyncExternalStore(runs.subscribe, runs.snapshot, runs.snapshot);
  useEffect(() => () => runs.dispose(), [runs]);
  return runs;
}
