import {
  SshServerResourceSnapshotSchema,
  type SshConnectionProfile,
  type SshServerResourceIssue,
  type SshServerResourceSnapshot,
} from '../shared/ssh-contracts';
import type { SshCommandRunner, SshProcessResult } from './ssh-command-runner';

const DEFAULT_CACHE_TTL_MS = 12_000;
const DEFAULT_SAMPLE_DELAY_MS = 250;
const DEFAULT_MAX_CONCURRENT_CAPTURES = 4;
const PROBE_TIMEOUT_SECONDS = 10;
const PROBE_OUTPUT_LIMIT = 64_000;
const MEBIBYTE = 1_048_576;
const KIBIBYTE = 1_024;

type CpuCounters = Readonly<{
  total: number;
  idle: number;
  logicalProcessorCount: number;
}>;

type CpuResource = SshServerResourceSnapshot['cpu'];
type MemoryResource = SshServerResourceSnapshot['memory'];
type GpuResource = SshServerResourceSnapshot['gpu'];

type ResourceCaptureToken = Readonly<{
  connectionId: string;
  profileKey: string;
  connectionGeneration: number;
  globalGeneration: number;
}>;

type InFlightCapture = Readonly<{
  token: ResourceCaptureToken;
  promise: Promise<SshServerResourceSnapshot>;
}>;

export type SshResourceMonitorOptions = Readonly<{
  cacheTtlMs?: number;
  sampleDelayMs?: number;
  now?: () => Date;
  delay?: (milliseconds: number) => Promise<void>;
  maxConcurrentCaptures?: number;
}>;

/** A bounded internal race signal. No remote output or connection details are attached. */
export class SshResourceCaptureInvalidatedError extends Error {
  constructor() {
    super('ssh_resource_capture_invalidated');
    this.name = 'SshResourceCaptureInvalidatedError';
  }
}

function resourceProfileKey(profile: SshConnectionProfile) {
  return JSON.stringify([profile.version, profile.hostAlias, profile.directTarget ?? null]);
}

function clampPercent(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

function finiteNonnegative(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseLinuxCpuCounters(output: string): CpuCounters | null {
  const lines = output.split(/\r?\n/u);
  const aggregate = lines.find((line) => /^cpu\s+/u.test(line));
  if (!aggregate) return null;
  const values = aggregate.trim().split(/\s+/u).slice(1).map(finiteNonnegative);
  if (values.length < 4 || values.some((value) => value === null)) return null;
  const counters = values as number[];
  const total = counters.slice(0, 8).reduce((sum, value) => sum + value, 0);
  const idle = (counters[3] ?? 0) + (counters[4] ?? 0);
  const logicalProcessorCount = lines.filter((line) => /^cpu\d+\s+/u.test(line)).length;
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(idle) ||
    total <= 0 ||
    idle < 0 ||
    idle > total ||
    logicalProcessorCount <= 0
  ) {
    return null;
  }
  return { total, idle, logicalProcessorCount };
}

export function calculateLinuxCpuResource(
  beforeOutput: string,
  afterOutput: string,
): CpuResource | null {
  const before = parseLinuxCpuCounters(beforeOutput);
  const after = parseLinuxCpuCounters(afterOutput);
  if (!before || !after || before.logicalProcessorCount !== after.logicalProcessorCount)
    return null;
  const totalDelta = after.total - before.total;
  const idleDelta = after.idle - before.idle;
  if (totalDelta <= 0 || idleDelta < 0 || idleDelta > totalDelta) return null;
  return {
    state: 'available',
    utilizationPercent: clampPercent(((totalDelta - idleDelta) / totalDelta) * 100),
    logicalProcessorCount: after.logicalProcessorCount,
  };
}

export function parseLinuxMemoryResource(output: string): MemoryResource | null {
  const values = new Map<string, number>();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^([A-Za-z_()]+):\s+(\d+)\s+kB\s*$/u.exec(line);
    if (!match) continue;
    const key = match[1];
    const amount = match[2] ? Number(match[2]) : Number.NaN;
    if (key && Number.isSafeInteger(amount) && amount >= 0) values.set(key, amount);
  }
  const totalKib = values.get('MemTotal');
  if (!totalKib || totalKib <= 0) return null;
  const fallbackAvailableKib =
    (values.get('MemFree') ?? 0) +
    (values.get('Buffers') ?? 0) +
    (values.get('Cached') ?? 0) +
    (values.get('SReclaimable') ?? 0) -
    (values.get('Shmem') ?? 0);
  const availableKib = values.get('MemAvailable') ?? fallbackAvailableKib;
  if (!Number.isSafeInteger(availableKib) || availableKib < 0) return null;
  const boundedAvailableKib = Math.min(totalKib, availableKib);
  const totalBytes = totalKib * KIBIBYTE;
  const usedBytes = (totalKib - boundedAvailableKib) * KIBIBYTE;
  if (!Number.isSafeInteger(totalBytes) || !Number.isSafeInteger(usedBytes)) return null;
  return {
    state: 'available',
    usedBytes,
    totalBytes,
    utilizationPercent: clampPercent((usedBytes / totalBytes) * 100),
  };
}

function parseCsvRow(row: string) {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === '"') {
      if (quoted && row[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === ',' && !quoted) {
      fields.push(field.trim());
      field = '';
      continue;
    }
    field += character;
  }
  if (quoted) return null;
  fields.push(field.trim());
  return fields;
}

function nullableMetric(value: string) {
  if (/^(?:n\/?a|not supported|\[not supported\]|-)$/iu.test(value.trim())) {
    return { valid: true as const, value: null };
  }
  const parsed = finiteNonnegative(value.trim());
  return parsed === null
    ? { valid: false as const, value: null }
    : { valid: true as const, value: parsed };
}

export function parseNvidiaSmiResource(output: string): GpuResource | null {
  const rows = output
    .split(/\r?\n/u)
    .map((row) => row.trim())
    .filter(Boolean);
  if (rows.length === 0 || rows.length > 64) return null;
  const devices = rows.map((row) => {
    const fields = parseCsvRow(row);
    if (!fields || fields.length !== 6) return null;
    const [
      indexText = '',
      name = '',
      utilizationText = '',
      usedText = '',
      totalText = '',
      tempText = '',
    ] = fields;
    const index = Number(indexText);
    const utilization = nullableMetric(utilizationText);
    const memoryUsedMib = finiteNonnegative(usedText);
    const memoryTotalMib = finiteNonnegative(totalText);
    const temperature = nullableMetric(tempText);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index > 65_535 ||
      name.length === 0 ||
      name.length > 256 ||
      !utilization.valid ||
      !temperature.valid ||
      memoryUsedMib === null ||
      memoryTotalMib === null ||
      memoryTotalMib <= 0 ||
      memoryUsedMib > memoryTotalMib ||
      (utilization.value !== null && utilization.value > 100) ||
      (temperature.value !== null && temperature.value > 1_000)
    ) {
      return null;
    }
    const memoryUsedBytes = Math.round(memoryUsedMib * MEBIBYTE);
    const memoryTotalBytes = Math.round(memoryTotalMib * MEBIBYTE);
    if (!Number.isSafeInteger(memoryUsedBytes) || !Number.isSafeInteger(memoryTotalBytes)) {
      return null;
    }
    return {
      index,
      name,
      utilizationPercent: utilization.value,
      memoryUsedBytes,
      memoryTotalBytes,
      temperatureC: temperature.value,
    };
  });
  if (devices.some((device) => device === null)) return null;
  return {
    state: 'available',
    devices: devices as Extract<GpuResource, { state: 'available' }>['devices'],
  };
}

function gpuNotDetected(result: SshProcessResult) {
  return (
    result.exitCode === 127 ||
    /no devices were found|command not found|not found/iu.test(`${result.stdout}\n${result.stderr}`)
  );
}

function successfulOutput(result: SshProcessResult | null) {
  return result !== null && result.exitCode === 0 && !result.truncated;
}

function snapshotStatus(cpu: CpuResource, memory: MemoryResource, gpu: GpuResource) {
  const available =
    Number(cpu.state === 'available') +
    Number(memory.state === 'available') +
    Number(gpu.state === 'available');
  if (available === 3) return 'ready' as const;
  return available === 0 ? ('unavailable' as const) : ('partial' as const);
}

function uniqueIssues(issues: readonly SshServerResourceIssue[]) {
  return [...new Set(issues)];
}

export class SshResourceMonitor {
  private readonly cache = new Map<
    string,
    Readonly<{ profileKey: string; capturedAtMs: number; snapshot: SshServerResourceSnapshot }>
  >();
  private readonly inFlight = new Map<string, InFlightCapture>();
  private readonly profileKeys = new Map<string, string>();
  private readonly connectionGenerations = new Map<string, number>();
  private globalGeneration = 0;
  private readonly cacheTtlMs: number;
  private readonly sampleDelayMs: number;
  private readonly now: () => Date;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private readonly maxConcurrentCaptures: number;
  private activeCaptures = 0;
  private readonly captureQueue: Array<() => void> = [];

  constructor(
    private readonly runner: SshCommandRunner,
    options: SshResourceMonitorOptions = {},
  ) {
    this.cacheTtlMs = Math.max(0, Math.min(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, 60_000));
    this.sampleDelayMs = Math.max(
      0,
      Math.min(options.sampleDelayMs ?? DEFAULT_SAMPLE_DELAY_MS, 2_000),
    );
    this.now = options.now ?? (() => new Date());
    this.delay =
      options.delay ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.maxConcurrentCaptures = Math.max(
      1,
      Math.min(options.maxConcurrentCaptures ?? DEFAULT_MAX_CONCURRENT_CAPTURES, 8),
    );
  }

  read(
    profile: SshConnectionProfile,
    options: Readonly<{ force?: boolean }> = {},
  ): Promise<SshServerResourceSnapshot> {
    const token = this.activateProfile(profile);
    const pending = this.inFlight.get(profile.id);
    if (pending && this.sameCapture(pending.token, token)) return pending.promise;
    const nowMs = this.now().getTime();
    const cached = this.cache.get(profile.id);
    if (
      !options.force &&
      cached?.profileKey === token.profileKey &&
      nowMs - cached.capturedAtMs < this.cacheTtlMs
    ) {
      return Promise.resolve(structuredClone(cached.snapshot));
    }
    const capture = this.scheduleCapture(() => this.capture(profile, token)).then((snapshot) => {
      this.assertCurrent(token);
      return snapshot;
    });
    this.inFlight.set(profile.id, { token, promise: capture });
    const clearCapture = () => {
      if (this.inFlight.get(profile.id)?.promise === capture) {
        this.inFlight.delete(profile.id);
      }
    };
    void capture.then(clearCapture, clearCapture);
    return capture;
  }

  invalidate(connectionId?: string) {
    if (connectionId) {
      this.connectionGenerations.set(
        connectionId,
        (this.connectionGenerations.get(connectionId) ?? 0) + 1,
      );
      this.profileKeys.delete(connectionId);
      this.cache.delete(connectionId);
      return;
    }
    this.globalGeneration += 1;
    this.profileKeys.clear();
    this.cache.clear();
  }

  private activateProfile(profile: SshConnectionProfile): ResourceCaptureToken {
    const profileKey = resourceProfileKey(profile);
    const activeProfileKey = this.profileKeys.get(profile.id);
    if (activeProfileKey !== undefined && activeProfileKey !== profileKey) {
      this.connectionGenerations.set(
        profile.id,
        (this.connectionGenerations.get(profile.id) ?? 0) + 1,
      );
      this.cache.delete(profile.id);
    }
    this.profileKeys.set(profile.id, profileKey);
    return {
      connectionId: profile.id,
      profileKey,
      connectionGeneration: this.connectionGenerations.get(profile.id) ?? 0,
      globalGeneration: this.globalGeneration,
    };
  }

  private sameCapture(left: ResourceCaptureToken, right: ResourceCaptureToken) {
    return (
      left.connectionId === right.connectionId &&
      left.profileKey === right.profileKey &&
      left.connectionGeneration === right.connectionGeneration &&
      left.globalGeneration === right.globalGeneration
    );
  }

  private isCurrent(token: ResourceCaptureToken) {
    return (
      token.globalGeneration === this.globalGeneration &&
      token.connectionGeneration === (this.connectionGenerations.get(token.connectionId) ?? 0) &&
      token.profileKey === this.profileKeys.get(token.connectionId)
    );
  }

  private assertCurrent(token: ResourceCaptureToken) {
    if (!this.isCurrent(token)) throw new SshResourceCaptureInvalidatedError();
  }

  private scheduleCapture(operation: () => Promise<SshServerResourceSnapshot>) {
    return new Promise<SshServerResourceSnapshot>((resolve, reject) => {
      const start = () => {
        this.activeCaptures += 1;
        void operation()
          .then(resolve, reject)
          .finally(() => {
            this.activeCaptures -= 1;
            this.captureQueue.shift()?.();
          });
      };
      if (this.activeCaptures < this.maxConcurrentCaptures) start();
      else this.captureQueue.push(start);
    });
  }

  private async capture(profile: SshConnectionProfile, token: ResourceCaptureToken) {
    this.assertCurrent(token);
    let processResponses = 0;
    const run = async (command: string, args: readonly string[]) => {
      try {
        const result = await this.runner(
          {
            hostAlias: profile.hostAlias,
            ...(profile.directTarget ? { directTarget: profile.directTarget } : {}),
            command,
            args,
            timeoutSeconds: PROBE_TIMEOUT_SECONDS,
          },
          { maxOutputCharacters: PROBE_OUTPUT_LIMIT, failOnOutputLimit: true },
        );
        processResponses += 1;
        return result;
      } catch {
        return null;
      }
    };

    const first = await run('/bin/cat', ['/proc/stat', '/proc/meminfo']);
    this.assertCurrent(token);
    let second: SshProcessResult | null = null;
    if (successfulOutput(first)) {
      await this.delay(this.sampleDelayMs);
      this.assertCurrent(token);
      second = await run('/bin/cat', ['/proc/stat']);
      this.assertCurrent(token);
    }
    const gpuResult = await run('/usr/bin/nvidia-smi', [
      '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu',
      '--format=csv,noheader,nounits',
    ]);
    this.assertCurrent(token);

    const issues: SshServerResourceIssue[] = [];
    const cpu =
      first !== null && second !== null && successfulOutput(first) && successfulOutput(second)
        ? calculateLinuxCpuResource(first.stdout, second.stdout)
        : null;
    const memory =
      first !== null && successfulOutput(first) ? parseLinuxMemoryResource(first.stdout) : null;
    let gpu: GpuResource;
    if (!gpuResult) {
      gpu = { state: 'unavailable' };
      issues.push('gpu_unavailable');
    } else if (gpuNotDetected(gpuResult)) {
      gpu = { state: 'not_detected' };
      issues.push('gpu_not_detected');
    } else if (successfulOutput(gpuResult)) {
      const parsedGpu = parseNvidiaSmiResource(gpuResult.stdout);
      if (parsedGpu) gpu = parsedGpu;
      else {
        gpu = { state: 'unavailable' };
        issues.push('gpu_unavailable', 'probe_output_invalid');
      }
    } else {
      gpu = { state: 'unavailable' };
      issues.push('gpu_unavailable');
    }

    if (!cpu) issues.push('cpu_unavailable');
    if (!memory) issues.push('memory_unavailable');
    if ((successfulOutput(first) && (!cpu || !memory)) || (successfulOutput(second) && !cpu)) {
      issues.push('probe_output_invalid');
    }
    if (processResponses === 0) issues.unshift('connection_unavailable');

    const capturedAt = this.now();
    const snapshot = SshServerResourceSnapshotSchema.parse({
      schemaVersion: 1,
      connectionId: profile.id,
      capturedAt: capturedAt.toISOString(),
      status: snapshotStatus(
        cpu ?? { state: 'unavailable' },
        memory ?? { state: 'unavailable' },
        gpu,
      ),
      cpu: cpu ?? { state: 'unavailable' },
      memory: memory ?? { state: 'unavailable' },
      gpu,
      issues: uniqueIssues(issues),
    });
    this.assertCurrent(token);
    this.cache.set(profile.id, {
      profileKey: token.profileKey,
      capturedAtMs: capturedAt.getTime(),
      snapshot,
    });
    return structuredClone(snapshot);
  }
}
