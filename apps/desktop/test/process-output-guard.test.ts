import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import {
  handleProcessOutputError,
  installProcessOutputGuards,
  isClosedProcessOutput,
} from '../src/main/process-output-guard';

function systemError(code: string) {
  return Object.assign(new Error(code), { code });
}

describe('process output guard', () => {
  it('recognizes only closed parent stream errors', () => {
    expect(isClosedProcessOutput(systemError('EIO'))).toBe(true);
    expect(isClosedProcessOutput(systemError('EPIPE'))).toBe(true);
    expect(isClosedProcessOutput(systemError('ENOSPC'))).toBe(false);
  });

  it('keeps a revoked stdout or stderr from crashing the main process', () => {
    const stream = new EventEmitter();
    installProcessOutputGuards([stream]);

    expect(() => stream.emit('error', systemError('EIO'))).not.toThrow();
    expect(() => stream.emit('error', systemError('EPIPE'))).not.toThrow();
  });

  it('does not hide unrelated output failures', () => {
    expect(() => handleProcessOutputError(systemError('ENOSPC'))).toThrow('ENOSPC');
  });
});
