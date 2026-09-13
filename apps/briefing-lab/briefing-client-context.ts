import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
export const briefingClientContext = new AsyncLocalStorage<string>();
export function briefingClientHash() {
  const token = briefingClientContext.getStore();
  return token && /^[a-f0-9]{64}$/.test(token)
    ? createHash('sha256').update(token).digest('hex')
    : null;
}
