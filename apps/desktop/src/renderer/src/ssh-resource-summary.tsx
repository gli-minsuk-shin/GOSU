import { useState } from 'react';

import type {
  SshConnectionTestResult,
  SshServerResourceSnapshot,
} from '../../shared/ssh-contracts';
import { CollapseChevron } from './ui-primitives';

export type SshResourceUiErrorReason =
  | 'project_grant_required'
  | 'project_unavailable'
  | 'unknown_host_key'
  | 'authentication_failed'
  | 'connection_failed'
  | 'timed_out'
  | 'approval_denied'
  | 'approval_expired'
  | 'approval_cancelled'
  | 'unavailable';

export type SshResourceUiState =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ phase: 'loading'; snapshot?: SshServerResourceSnapshot }>
  | Readonly<{ phase: 'ready'; snapshot: SshServerResourceSnapshot }>
  | Readonly<{
      phase: 'error';
      snapshot?: SshServerResourceSnapshot;
      reason?: SshResourceUiErrorReason;
    }>;

const ISSUE_LABELS: Record<SshServerResourceSnapshot['issues'][number], string> = {
  ssh_client_unavailable: 'The local OpenSSH client is unavailable',
  unknown_host_key: 'Host key not trusted — verify it and connect once in Terminal',
  authentication_failed: 'Authentication failed — check ssh-agent or Keychain in Terminal',
  connection_failed: 'Connection failed — check the host, port, and network',
  timed_out: 'Connection timed out — check the server and network',
  cpu_unavailable: 'CPU unavailable',
  memory_unavailable: 'Memory unavailable',
  gpu_not_detected: 'nvidia-smi reports no NVIDIA GPU',
  gpu_unavailable: 'GPU unavailable',
  nvidia_smi_unavailable:
    'nvidia-smi is not available in the supported server installation locations',
  connection_unavailable: 'Server unavailable',
  probe_output_invalid: 'Usage response invalid',
};

const ERROR_REASON_LABELS: Record<SshResourceUiErrorReason, string> = {
  project_grant_required:
    'Project link required — grant this server to the active project in Connections.',
  project_unavailable: 'Select an active, non-archived project before reading linked resources.',
  unknown_host_key: 'Host key not trusted — verify its fingerprint and connect once in Terminal.',
  authentication_failed: 'Authentication failed — check ssh-agent, Keychain, or the SSH alias.',
  connection_failed: 'Connection failed — check the registered host, port, and network.',
  timed_out: 'Connection timed out — check that the server is running and reachable.',
  approval_denied: 'The separate remote command approval was denied; the command did not run.',
  approval_expired: 'The separate Allow once request expired before the command ran.',
  approval_cancelled: 'The separate Allow once request was cancelled; the command did not run.',
  unavailable: 'Usage diagnostics are unavailable. Run Test for a more specific connection check.',
};

export function sshResourceErrorReason(error: unknown): SshResourceUiErrorReason {
  const message = error instanceof Error ? error.message : '';
  const mappings = [
    ['ssh_workspace_grant_not_found', 'project_grant_required'],
    ['ssh_workspace_project_unavailable', 'project_unavailable'],
    ['ssh_unknown_host_key', 'unknown_host_key'],
    ['ssh_authentication_failed', 'authentication_failed'],
    ['ssh_connection_failed', 'connection_failed'],
    ['ssh_timed_out', 'timed_out'],
    ['ssh_approval_denied', 'approval_denied'],
    ['ssh_approval_expired', 'approval_expired'],
    ['ssh_approval_cancelled', 'approval_cancelled'],
  ] as const satisfies readonly (readonly [string, SshResourceUiErrorReason])[];
  return mappings.find(([code]) => message.includes(code))?.[1] ?? 'unavailable';
}

export function sshResourceErrorLabel(reason: SshResourceUiErrorReason) {
  return ERROR_REASON_LABELS[reason];
}

export function sshConnectionTestStatus(result: SshConnectionTestResult) {
  if (result.reachable) return 'Ready · non-interactive authentication verified';
  switch (result.code) {
    case 'unknown_host_key':
      return 'Host key not trusted · verify its fingerprint and connect once in Terminal';
    case 'authentication_failed':
      return 'Authentication failed · check ssh-agent, Keychain, or the SSH alias';
    case 'timed_out':
      return 'Connection timed out · check the server and network';
    case 'connection_failed':
      return 'Connection failed · check the registered host, port, and network';
    case 'ready':
      return 'Ready · non-interactive authentication verified';
    case undefined:
      return 'Connection failed · run Test again after checking the server';
  }
}

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

type CompactResourceMetric = Readonly<{
  label: string;
  value: string;
  qualifier?: string;
  accessibleDetail?: string;
}>;

export function compactSshResourceMetrics(
  snapshot?: SshServerResourceSnapshot,
): readonly CompactResourceMetric[] {
  if (!snapshot) {
    return [
      { label: 'CPU', value: '—' },
      { label: 'Memory', value: '—' },
      { label: 'GPU', value: '—' },
    ];
  }

  const cpu =
    snapshot.cpu.state === 'available'
      ? formatSshResourcePercent(snapshot.cpu.utilizationPercent)
      : '—';
  const memory =
    snapshot.memory.state === 'available'
      ? formatSshResourcePercent(snapshot.memory.utilizationPercent)
      : '—';

  if (snapshot.gpu.state !== 'available') {
    return [
      { label: 'CPU', value: cpu },
      { label: 'Memory', value: memory },
      {
        label: 'GPU',
        value: snapshot.gpu.state === 'not_detected' ? 'None' : '—',
      },
    ];
  }

  const gpuCount = snapshot.gpu.devices.length;
  const reportingGpuValues = snapshot.gpu.devices.flatMap((device) =>
    device.utilizationPercent === null ? [] : [clampPercent(device.utilizationPercent)],
  );
  const reportingGpuCount = reportingGpuValues.length;
  const gpuValue =
    reportingGpuCount === 0 ? '—' : formatSshResourcePercent(Math.max(...reportingGpuValues));
  const isMultiGpu = gpuCount > 1;
  const qualifier =
    reportingGpuCount < gpuCount ? `${reportingGpuCount}/${gpuCount} reporting` : undefined;

  return [
    { label: 'CPU', value: cpu },
    { label: 'Memory', value: memory },
    {
      label: isMultiGpu ? 'GPU max' : 'GPU',
      value: gpuValue,
      ...(qualifier ? { qualifier } : {}),
      ...(isMultiGpu
        ? {
            accessibleDetail: `peak utilization across ${reportingGpuCount} of ${gpuCount} GPUs reporting`,
          }
        : {}),
    },
  ];
}

function CompactResourceValues({
  state,
  snapshot,
}: Readonly<{
  state: SshResourceUiState;
  snapshot: SshServerResourceSnapshot | undefined;
}>) {
  const metrics = compactSshResourceMetrics(snapshot);
  const stale = state.phase === 'error' && snapshot !== undefined;

  return (
    <span
      className="ssh-resource-summary-compact-values"
      aria-label={`${metrics
        .map(
          (metric) =>
            `${metric.label} ${metric.value}${metric.qualifier ? `, ${metric.qualifier}` : ''}${
              metric.accessibleDetail ? `, ${metric.accessibleDetail}` : ''
            }`,
        )
        .join('; ')}${stale ? '; stale sample' : ''}`}
    >
      {metrics.map((metric) => (
        <span className="ssh-resource-summary-compact-metric" key={metric.label}>
          <span>{metric.label}</span>
          <b>{metric.value}</b>
          {metric.qualifier && <small>{metric.qualifier}</small>}
        </span>
      ))}
      {stale && <span className="ssh-resource-summary-stale">Stale</span>}
    </span>
  );
}

export function SshResourceSummary({
  state,
  serverLabel,
  compact = false,
  defaultCollapsed = false,
}: Readonly<{
  state: SshResourceUiState;
  serverLabel: string;
  compact?: boolean;
  defaultCollapsed?: boolean;
}>) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const snapshot = state.phase === 'idle' ? undefined : state.snapshot;
  const stateIssue =
    state.phase === 'error' ? sshResourceErrorLabel(state.reason ?? 'unavailable') : null;
  if (!snapshot) {
    return (
      <section
        className={`ssh-resource-summary ${compact ? 'compact' : ''} ${collapsed ? 'collapsed' : ''}`}
        aria-label={`${serverLabel} resource usage`}
      >
        <div className="ssh-resource-summary-status">
          <div>
            <strong>Server usage</strong>
            {collapsed && <CompactResourceValues state={state} snapshot={snapshot} />}
            <span>
              {state.phase === 'loading'
                ? 'Reading usage…'
                : state.phase === 'idle'
                  ? 'Usage not loaded'
                  : 'Usage unavailable'}
            </span>
          </div>
        </div>
        {stateIssue && <small className="ssh-resource-issues">{stateIssue}</small>}
        {state.phase === 'error' && (
          <small className="ssh-resource-probe-boundary">
            Usage probes do not wait for Allow once. Remote files and commands are separate: they
            need a project grant and may show an Allow once request.
          </small>
        )}
      </section>
    );
  }

  const availableGpuDevices = snapshot.gpu.state === 'available' ? snapshot.gpu.devices : [];
  const issueLabels = [
    ...snapshot.issues.map((issue) => ISSUE_LABELS[issue]),
    ...(stateIssue ? [stateIssue] : []),
  ];

  return (
    <section
      className={`ssh-resource-summary ${compact ? 'compact' : ''} ${collapsed ? 'collapsed' : ''}`}
      aria-label={`${serverLabel} resource usage`}
    >
      <div className="ssh-resource-summary-status">
        <div>
          <strong>Server usage</strong>
          {collapsed && <CompactResourceValues state={state} snapshot={snapshot} />}
          <span>
            {snapshotStatus(state, snapshot)} ·{' '}
            <time dateTime={snapshot.capturedAt}>
              Last updated {formatSampleTime(snapshot.capturedAt)}
            </time>
          </span>
        </div>
        <button
          type="button"
          className="ssh-resource-summary-toggle"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Show' : 'Minimize'} resource details for ${serverLabel}`}
          onClick={() => setCollapsed((current) => !current)}
        >
          <CollapseChevron direction={collapsed ? 'down' : 'up'} />
          {collapsed ? 'Show details' : 'Minimize'}
        </button>
      </div>
      {!collapsed && (
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
      )}
      {issueLabels.length > 0 && (
        <small className="ssh-resource-issues">{issueLabels.join(' · ')}</small>
      )}
      {(snapshot.status !== 'ready' || state.phase === 'error') && (
        <small className="ssh-resource-probe-boundary">
          Usage probes do not wait for Allow once. Remote files and commands are separate: they need
          a project grant and may show an Allow once request.
        </small>
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
