import type { SshServerResourceSnapshot } from '../../shared/ssh-contracts';

export type SshResourceUiState =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ phase: 'loading'; snapshot?: SshServerResourceSnapshot }>
  | Readonly<{ phase: 'ready'; snapshot: SshServerResourceSnapshot }>
  | Readonly<{ phase: 'error'; snapshot?: SshServerResourceSnapshot }>;

const ISSUE_LABELS: Record<SshServerResourceSnapshot['issues'][number], string> = {
  cpu_unavailable: 'CPU unavailable',
  memory_unavailable: 'Memory unavailable',
  gpu_not_detected: 'No NVIDIA GPU detected',
  gpu_unavailable: 'GPU unavailable',
  connection_unavailable: 'Server unavailable',
  probe_output_invalid: 'Usage response invalid',
};

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

export function formatSshResourcePercent(value: number) {
  const bounded = clampPercent(value);
  return `${Number.isInteger(bounded) ? bounded.toFixed(0) : bounded.toFixed(1)}%`;
}

export function formatSshResourceBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;
  let unitIndex = 0;
  let scaled = value;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  const digits = scaled >= 10 || unitIndex === 0 ? 0 : 1;
  return `${scaled.toFixed(digits)} ${units[unitIndex]}`;
}

function ResourceMeter({
  label,
  value,
  detail,
}: Readonly<{ label: string; value: number | null; detail?: string }>) {
  const bounded = value === null ? null : clampPercent(value);
  const formatted = bounded === null ? '—' : formatSshResourcePercent(bounded);
  return (
    <div className="ssh-resource-meter">
      <div>
        <span>{label}</span>
        <strong>{formatted}</strong>
      </div>
      {bounded === null ? (
        <span className="ssh-resource-meter-unavailable">Utilization unavailable</span>
      ) : (
        <meter min={0} max={100} value={bounded} aria-label={`${label} utilization ${formatted}`} />
      )}
      {detail && <small>{detail}</small>}
    </div>
  );
}

function snapshotStatus(state: SshResourceUiState, snapshot: SshServerResourceSnapshot) {
  if (state.phase === 'loading') return 'Refreshing · showing last sample';
  if (state.phase === 'error') return 'Unavailable · showing last sample';
  if (snapshot.status === 'unavailable') return 'Unavailable';
  return snapshot.status === 'partial' ? 'Partial' : 'Live sample';
}

export function SshResourceSummary({
  state,
  serverLabel,
  compact = false,
}: Readonly<{
  state: SshResourceUiState;
  serverLabel: string;
  compact?: boolean;
}>) {
  const snapshot = state.phase === 'idle' ? undefined : state.snapshot;
  if (!snapshot) {
    return (
      <section
        className={`ssh-resource-summary ${compact ? 'compact' : ''}`}
        aria-label={`${serverLabel} resource usage`}
      >
        <div className="ssh-resource-summary-status">
          <strong>Server usage</strong>
          <span>
            {state.phase === 'loading'
              ? 'Reading usage…'
              : state.phase === 'idle'
                ? 'Usage not loaded'
                : 'Usage unavailable'}
          </span>
        </div>
      </section>
    );
  }

  const availableGpuDevices = snapshot.gpu.state === 'available' ? snapshot.gpu.devices : [];
  const issueLabels = snapshot.issues.map((issue) => ISSUE_LABELS[issue]);

  return (
    <section
      className={`ssh-resource-summary ${compact ? 'compact' : ''}`}
      aria-label={`${serverLabel} resource usage`}
    >
      <div className="ssh-resource-summary-status">
        <strong>Server usage</strong>
        <span>
          {snapshotStatus(state, snapshot)} ·{' '}
          <time dateTime={snapshot.capturedAt}>
            Last updated {formatSampleTime(snapshot.capturedAt)}
          </time>
        </span>
      </div>
      <div className="ssh-resource-meters">
        {snapshot.cpu.state === 'available' ? (
          <ResourceMeter
            label="CPU"
            value={snapshot.cpu.utilizationPercent}
            detail={`${snapshot.cpu.logicalProcessorCount} logical processors`}
          />
        ) : (
          <UnavailableMetric label="CPU" />
        )}
        {snapshot.memory.state === 'available' ? (
          <ResourceMeter
            label="Memory"
            value={snapshot.memory.utilizationPercent}
            detail={`${formatSshResourceBytes(snapshot.memory.usedBytes)} / ${formatSshResourceBytes(snapshot.memory.totalBytes)}`}
          />
        ) : (
          <UnavailableMetric label="Memory" />
        )}
        {snapshot.gpu.state === 'available' ? (
          availableGpuDevices.map((gpu) => (
            <div className="ssh-resource-gpu" key={gpu.index}>
              <ResourceMeter
                label={`GPU ${gpu.index}`}
                value={gpu.utilizationPercent}
                detail={`${gpu.name} · ${formatSshResourceBytes(gpu.memoryUsedBytes)} / ${formatSshResourceBytes(gpu.memoryTotalBytes)} VRAM${gpu.temperatureC === null ? '' : ` · ${gpu.temperatureC} °C`}`}
              />
            </div>
          ))
        ) : (
          <UnavailableMetric
            label="GPU"
            detail={snapshot.gpu.state === 'not_detected' ? 'No NVIDIA GPU detected' : undefined}
          />
        )}
      </div>
      {issueLabels.length > 0 && (
        <small className="ssh-resource-issues">{issueLabels.join(' · ')}</small>
      )}
    </section>
  );
}

function UnavailableMetric({
  label,
  detail,
}: Readonly<{ label: string; detail?: string | undefined }>) {
  return (
    <div className="ssh-resource-meter unavailable">
      <div>
        <span>{label}</span>
        <strong>—</strong>
      </div>
      <small>{detail ?? 'Unavailable'}</small>
    </div>
  );
}

function formatSampleTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'unknown';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
