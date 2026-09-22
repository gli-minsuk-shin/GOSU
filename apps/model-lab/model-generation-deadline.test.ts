import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import type * as ChildProcessModule from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import {
  collectChild,
  modelBuilderTimeoutMs,
  modelCopilotExecutionLimits,
  MODEL_IR_OUTPUT_SCHEMA,
} from './model-copilot-server';
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  spawn: vi.fn(),
}));
function child() {
  const stream = () => Object.assign(new EventEmitter(), { setEncoding: vi.fn(), end: vi.fn() });
  const child = Object.assign(new EventEmitter(), {
    stdout: stream(),
    stderr: stream(),
    stdin: stream(),
    kill: vi.fn(() => true),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return child;
}
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it('accepts a provider result after six minutes instead of killing it at the old five-minute limit', async () => {
  vi.useFakeTimers();
  const c = child();
  let settled = false;
  const pending = collectChild(
    'fixture',
    [],
    'prompt',
    new AbortController().signal,
    modelBuilderTimeoutMs('short but complex architecture'),
  );
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await vi.advanceTimersByTimeAsync(300001);
  expect(c.kill).not.toHaveBeenCalled();
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(59999);
  c.stdout.emit('data', '{"schemaVersion":1}');
  c.emit('close', 0);
  await expect(pending).resolves.toMatchObject({ stdout: '{"schemaVersion":1}' });
  expect(vi.getTimerCount()).toBe(0);
});
it('still terminates a silent provider at the finite deadline, without automatically starting another call', async () => {
  vi.useFakeTimers();
  const c = child();
  const pending = collectChild(
    'fixture',
    [],
    null,
    new AbortController().signal,
    modelBuilderTimeoutMs('graph'),
  );
  const failure = expect(pending).rejects.toThrow('model_copilot_timeout');
  await vi.advanceTimersByTimeAsync(900000);
  await failure;
  expect(c.kill).toHaveBeenCalledWith('SIGTERM');
  expect(spawn).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('allows immediate user cancellation even after the previous deadline has passed', async () => {
  vi.useFakeTimers();
  const c = child();
  const signal = new AbortController();
  const pending = collectChild('fixture', [], null, signal.signal, modelBuilderTimeoutMs('graph'));
  const failure = expect(pending).rejects.toThrow('model_copilot_aborted');
  await vi.advanceTimersByTimeAsync(360000);
  signal.abort();
  await failure;
  expect(c.kill).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('uses the same graph budget for imports and chat edits, without enlarging ordinary small structured calls', () => {
  expect(modelBuilderTimeoutMs('graph')).toBe(900000);
  const large = 'x'.repeat(120000);
  expect(modelBuilderTimeoutMs(large)).toBe(1800000);
  expect(modelCopilotExecutionLimits(MODEL_IR_OUTPUT_SCHEMA, large).timeoutMs).toBe(1800000);
  expect(modelCopilotExecutionLimits(undefined, large).timeoutMs).toBe(120000);
});
