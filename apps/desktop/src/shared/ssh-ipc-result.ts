import { SSH_IPC_ERROR_CODES } from './ssh-contracts';

export type { SshIpcErrorCode, SshIpcResult } from './ssh-contracts';

const knownCodes = new Set<string>(SSH_IPC_ERROR_CODES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function unwrapSshIpcResult<T>(result: unknown): T {
  if (isRecord(result) && result.ok === true && 'value' in result) return result.value as T;
  if (isRecord(result) && result.ok === false && isRecord(result.error)) {
    const code = result.error.code;
    if (typeof code === 'string' && knownCodes.has(code)) throw new Error(code);
  }
  throw new Error('ssh_unavailable');
}
