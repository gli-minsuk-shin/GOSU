import { AsyncLocalStorage } from 'node:async_hooks';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const modelLabBackendContext = new AsyncLocalStorage<{
  projectId: string;
  directory: string;
}>();

export function modelLabBackendDirectory(kind: string, standalone?: string) {
  const context = modelLabBackendContext.getStore();
  return context
    ? join(context.directory, kind)
    : (standalone ?? join(homedir(), '.gosu', 'model-lab', kind));
}
