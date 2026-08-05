import { describe, expect, it, vi } from 'vitest';

import {
  SshResourceCaptureInvalidatedError,
  SshResourceMonitor,
  calculateLinuxCpuResource,
  parseLinuxCpuCounters,
  parseLinuxMemoryResource,
  parseNvidiaSmiResource,
} from '../src/main/ssh-resource-monitor';
import type {
  SshCommandRunner,
  SshProcessResult,
  SshRunnableCommand,
} from '../src/main/ssh-command-runner';
import type { SshConnectionProfile } from '../src/shared/ssh-contracts';

const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const CAPTURED_AT = new Date('2026-08-06T00:00:00.000Z');
const CPU_BEFORE = [
  'cpu  100 0 50 850 0 0 0 0 0 0',
  'cpu0 50 0 25 425 0 0 0 0 0 0',
  'cpu1 50 0 25 425 0 0 0 0 0 0',
].join('\n');
const CPU_AFTER = [
  'cpu  120 0 50 930 0 0 0 0 0 0',
  'cpu0 60 0 25 465 0 0 0 0 0 0',
  'cpu1 60 0 25 465 0 0 0 0 0 0',
].join('\n');
const MEMORY = ['MemTotal:        1000 kB', 'MemAvailable:     250 kB'].join('\n');

function profileFixture(): SshConnectionProfile {
  return {
    schemaVersion: 1,
    id: CONNECTION_ID,
    label: 'Fixture GPU',
    hostAlias: 'fixture-gpu',
    version: 1,
    createdAt: CAPTURED_AT.toISOString(),
    updatedAt: CAPTURED_AT.toISOString(),
  };
}

function resultFixture(overrides: Partial<SshProcessResult> = {}): SshProcessResult {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    truncated: false,
    durationMs: 5,
    ...overrides,
  };
}

function runnerFixture(responses: readonly (SshProcessResult | Error)[]) {
  let index = 0;
  const run = vi.fn(async (_command: SshRunnableCommand) => {
    const response = responses[index];
    index += 1;
    if (!response) throw new Error('missing fixture response');
    if (response instanceof Error) throw response;
    return response;
  });
  const callable = run as unknown as SshCommandRunner;
  callable.testConnection = vi.fn(async () => undefined);
  callable.execute = vi.fn(async () => resultFixture());
  return { runner: callable, run };
}

function successfulProbeResponses() {
  return [
    resultFixture({ stdout: `${CPU_BEFORE}\n${MEMORY}\n` }),
    resultFixture({ stdout: CPU_AFTER }),
    resultFixture({ stdout: '0, NVIDIA RTX 3080, 75, 5120, 10240, 64\n' }),
  ];
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function profileGatedRunner() {
  const originalGate = deferred();
  const updatedGate = deferred();
  const run = vi.fn(async (command: SshRunnableCommand): Promise<SshProcessResult> => {
    if (command.command === '/bin/cat' && command.args?.length === 2) {
      await (command.hostAlias === 'fixture-gpu' ? originalGate.promise : updatedGate.promise);
      return resultFixture({ stdout: `${CPU_BEFORE}\n${MEMORY}\n` });
    }
    if (command.command === '/bin/cat') return resultFixture({ stdout: CPU_AFTER });
    return resultFixture({ stdout: '0, NVIDIA RTX 3080, 75, 5120, 10240, 64\n' });
  });
  const runner = run as unknown as SshCommandRunner;
  runner.testConnection = vi.fn(async () => undefined);
  runner.execute = vi.fn(async () => resultFixture());
  return { runner, run, originalGate, updatedGate };
}

describe('SSH fixed resource monitor', () => {
  it('parses Linux CPU deltas, logical processors, and memory without a shell', () => {
    expect(parseLinuxCpuCounters(CPU_BEFORE)).toEqual({
      total: 1_000,
      idle: 850,
      logicalProcessorCount: 2,
    });
    expect(calculateLinuxCpuResource(CPU_BEFORE, CPU_AFTER)).toEqual({
      state: 'available',
      utilizationPercent: 20,
      logicalProcessorCount: 2,
    });
    expect(parseLinuxMemoryResource(MEMORY)).toEqual({
      state: 'available',
      usedBytes: 768_000,
      totalBytes: 1_024_000,
      utilizationPercent: 75,
    });
  });

  it('parses bounded NVIDIA CSV including quoted names and unavailable optional metrics', () => {
    expect(parseNvidiaSmiResource('0, "NVIDIA, Fixture", N/A, 512, 1024, N/A\n')).toEqual({
      state: 'available',
      devices: [
        {
          index: 0,
          name: 'NVIDIA, Fixture',
          utilizationPercent: null,
          memoryUsedBytes: 536_870_912,
          memoryTotalBytes: 1_073_741_824,
          temperatureC: null,
        },
      ],
    });
    expect(parseNvidiaSmiResource('private malformed output')).toBeNull();
    expect(parseNvidiaSmiResource('0, Fixture, private, 512, 1024, 60')).toBeNull();
  });

  it('uses only the fixed probe commands and preserves CPU and RAM when no GPU is detected', async () => {
    const { runner, run } = runnerFixture([
      resultFixture({ stdout: `${CPU_BEFORE}\n${MEMORY}\n` }),
      resultFixture({ stdout: CPU_AFTER }),
      resultFixture({ exitCode: 127, stderr: '/usr/bin/nvidia-smi: not found' }),
    ]);
    const monitor = new SshResourceMonitor(runner, {
      now: () => CAPTURED_AT,
      sampleDelayMs: 0,
    });

    await expect(monitor.read(profileFixture())).resolves.toEqual({
      schemaVersion: 1,
      connectionId: CONNECTION_ID,
      capturedAt: CAPTURED_AT.toISOString(),
      status: 'partial',
      cpu: { state: 'available', utilizationPercent: 20, logicalProcessorCount: 2 },
      memory: {
        state: 'available',
        usedBytes: 768_000,
        totalBytes: 1_024_000,
        utilizationPercent: 75,
      },
      gpu: { state: 'not_detected' },
      issues: ['gpu_not_detected'],
    });
    expect(run.mock.calls.map(([command]) => command)).toEqual([
      expect.objectContaining({
        command: '/bin/cat',
        args: ['/proc/stat', '/proc/meminfo'],
      }),
      expect.objectContaining({ command: '/bin/cat', args: ['/proc/stat'] }),
      expect.objectContaining({
        command: '/usr/bin/nvidia-smi',
        args: [
          '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu',
          '--format=csv,noheader,nounits',
        ],
      }),
    ]);
  });

  it('deduplicates in-flight captures, caches briefly, and lets force bypass only the cache', async () => {
    let releaseDelay!: () => void;
    const delay = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseDelay = resolve;
        }),
    );
    const { runner, run } = runnerFixture([
      ...successfulProbeResponses(),
      ...successfulProbeResponses(),
    ]);
    const monitor = new SshResourceMonitor(runner, {
      now: () => CAPTURED_AT,
      cacheTtlMs: 15_000,
      sampleDelayMs: 1,
      delay,
    });

    const first = monitor.read(profileFixture());
    await vi.waitFor(() => expect(delay).toHaveBeenCalledOnce());
    const joined = monitor.read(profileFixture(), { force: true });
    releaseDelay();
    await expect(Promise.all([first, joined])).resolves.toHaveLength(2);
    expect(run).toHaveBeenCalledTimes(3);

    await monitor.read(profileFixture());
    expect(run).toHaveBeenCalledTimes(3);

    const forced = monitor.read(profileFixture(), { force: true });
    await vi.waitFor(() => expect(delay).toHaveBeenCalledTimes(2));
    releaseDelay();
    await forced;
    expect(run).toHaveBeenCalledTimes(6);
  });

  it('never joins or surfaces an in-flight capture from an older profile version', async () => {
    const { runner, run, originalGate, updatedGate } = profileGatedRunner();
    const monitor = new SshResourceMonitor(runner, {
      now: () => CAPTURED_AT,
      cacheTtlMs: 15_000,
      sampleDelayMs: 0,
    });
    const original = profileFixture();
    const updated: SshConnectionProfile = {
      ...original,
      hostAlias: 'updated-fixture-gpu',
      version: 2,
      updatedAt: '2026-08-06T00:01:00.000Z',
    };

    const obsoleteCapture = monitor.read(original);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const currentCapture = monitor.read(updated);
    const joinedCurrentCapture = monitor.read(updated, { force: true });
    expect(joinedCurrentCapture).toBe(currentCapture);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));

    originalGate.resolve();
    await expect(obsoleteCapture).rejects.toBeInstanceOf(SshResourceCaptureInvalidatedError);
    expect(
      run.mock.calls.filter(([command]) => command.hostAlias === original.hostAlias),
    ).toHaveLength(1);

    updatedGate.resolve();
    await expect(currentCapture).resolves.toMatchObject({ connectionId: CONNECTION_ID });
    expect(run).toHaveBeenCalledTimes(4);

    await monitor.read(updated);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('invalidates a pending capture generation even when the next profile has the same version', async () => {
    const { runner, run, originalGate } = profileGatedRunner();
    const monitor = new SshResourceMonitor(runner, {
      now: () => CAPTURED_AT,
      sampleDelayMs: 0,
    });
    const profile = profileFixture();

    const obsoleteCapture = monitor.read(profile);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    monitor.invalidate(profile.id);
    const replacementCapture = monitor.read(profile);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));

    originalGate.resolve();
    await expect(obsoleteCapture).rejects.toBeInstanceOf(SshResourceCaptureInvalidatedError);
    await expect(replacementCapture).resolves.toMatchObject({ connectionId: CONNECTION_ID });
  });

  it('bounds resource captures globally so polling many registered servers cannot fan out SSH', async () => {
    let releaseFirstProbes!: () => void;
    const firstProbeGate = new Promise<void>((resolve) => {
      releaseFirstProbes = resolve;
    });
    let activeRuns = 0;
    let maximumActiveRuns = 0;
    const run = vi.fn(async (command: SshRunnableCommand): Promise<SshProcessResult> => {
      activeRuns += 1;
      maximumActiveRuns = Math.max(maximumActiveRuns, activeRuns);
      try {
        if (command.command === '/bin/cat' && command.args?.length === 2) {
          await firstProbeGate;
          return resultFixture({ stdout: `${CPU_BEFORE}\n${MEMORY}\n` });
        }
        if (command.command === '/bin/cat') return resultFixture({ stdout: CPU_AFTER });
        return resultFixture({ stdout: '0, NVIDIA RTX 3080, 75, 5120, 10240, 64\n' });
      } finally {
        activeRuns -= 1;
      }
    });
    const runner = run as unknown as SshCommandRunner;
    runner.testConnection = vi.fn(async () => undefined);
    runner.execute = vi.fn(async () => resultFixture());
    const monitor = new SshResourceMonitor(runner, {
      now: () => CAPTURED_AT,
      sampleDelayMs: 0,
      maxConcurrentCaptures: 4,
    });
    const profiles = [1, 2, 3, 4, 5].map((suffix) => ({
      ...profileFixture(),
      id: `44444444-4444-4444-8444-44444444444${suffix}`,
      hostAlias: `fixture-gpu-${suffix}`,
    }));

    const snapshots = profiles.map((profile) => monitor.read(profile));
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(4));
    expect(maximumActiveRuns).toBe(4);
    releaseFirstProbes();

    await expect(Promise.all(snapshots)).resolves.toHaveLength(5);
    expect(run).toHaveBeenCalledTimes(15);
    expect(maximumActiveRuns).toBeLessThanOrEqual(4);
  });

  it('returns a bounded unavailable snapshot when every SSH transport fails', async () => {
    const { runner } = runnerFixture([
      new Error('private host diagnostic'),
      new Error('/Users/researcher/.ssh/private-key'),
    ]);
    const monitor = new SshResourceMonitor(runner, {
      now: () => CAPTURED_AT,
      sampleDelayMs: 0,
    });

    const snapshot = await monitor.read(profileFixture());
    expect(snapshot).toMatchObject({
      status: 'unavailable',
      cpu: { state: 'unavailable' },
      memory: { state: 'unavailable' },
      gpu: { state: 'unavailable' },
      issues: [
        'connection_unavailable',
        'gpu_unavailable',
        'cpu_unavailable',
        'memory_unavailable',
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain('.ssh');
    expect(JSON.stringify(snapshot)).not.toContain('private host');
  });
});
