import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  SshResourceSummary,
  formatSshResourceBytes,
  formatSshResourcePercent,
} from '../src/renderer/src/ssh-resource-summary';
import type { SshServerResourceSnapshot } from '../src/shared/ssh-contracts';

const snapshot: SshServerResourceSnapshot = {
  schemaVersion: 1,
  connectionId: '11111111-1111-4111-8111-111111111111',
  capturedAt: '2026-08-06T01:02:03.000Z',
  status: 'ready',
  cpu: { state: 'available', utilizationPercent: 37.5, logicalProcessorCount: 32 },
  memory: {
    state: 'available',
    usedBytes: 8 * 1024 ** 3,
    totalBytes: 16 * 1024 ** 3,
    utilizationPercent: 50,
  },
  gpu: {
    state: 'available',
    devices: [
      {
        index: 0,
        name: 'Fixture RTX',
        utilizationPercent: 92,
        memoryUsedBytes: 12 * 1024 ** 3,
        memoryTotalBytes: 24 * 1024 ** 3,
        temperatureC: 71,
      },
      {
        index: 1,
        name: 'Fixture RTX',
        utilizationPercent: null,
        memoryUsedBytes: 2 * 1024 ** 3,
        memoryTotalBytes: 24 * 1024 ** 3,
        temperatureC: null,
      },
    ],
  },
  issues: [],
};

describe('SSH resource summary', () => {
  it('formats bounded percentages and binary byte units', () => {
    expect(formatSshResourcePercent(-4)).toBe('0%');
    expect(formatSshResourcePercent(37.54)).toBe('37.5%');
    expect(formatSshResourcePercent(120)).toBe('100%');
    expect(formatSshResourceBytes(0)).toBe('0 B');
    expect(formatSshResourceBytes(8 * 1024 ** 3)).toBe('8.0 GiB');
    expect(formatSshResourceBytes(24 * 1024 ** 3)).toBe('24 GiB');
  });

  it('renders CPU, memory, and every GPU with accessible utilization meters', () => {
    const html = renderToStaticMarkup(
      <SshResourceSummary
        state={{ phase: 'ready', snapshot }}
        serverLabel="Fixture training server"
      />,
    );

    expect(html).toContain('Fixture training server resource usage');
    expect(html).toContain('CPU utilization 37.5%');
    expect(html).toContain('32 logical processors');
    expect(html).toContain('Memory utilization 50%');
    expect(html).toContain('8.0 GiB / 16 GiB');
    expect(html).toContain('GPU 0 utilization 92%');
    expect(html).toContain('12 GiB / 24 GiB VRAM');
    expect(html).toContain('71 °C');
    expect(html).toContain('GPU 1');
    expect(html).toContain('Utilization unavailable');
    expect(html).not.toContain('GPU 1 utilization 0%');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Minimize resource details for Fixture training server');
    expect(html).toContain('Minimize');
  });

  it('can start minimized while retaining status and issue context', () => {
    const partial: SshServerResourceSnapshot = {
      ...snapshot,
      status: 'partial',
      issues: ['gpu_unavailable'],
    };
    const html = renderToStaticMarkup(
      <SshResourceSummary
        state={{ phase: 'ready', snapshot: partial }}
        serverLabel="Compact training server"
        defaultCollapsed
      />,
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Show resource details for Compact training server');
    expect(html).toContain('Show details');
    expect(html).toContain('Last updated');
    expect(html).toContain('GPU unavailable');
    expect(html).not.toContain('<meter');
  });

  it('keeps the last safe sample visible after refresh failure without exposing an error payload', () => {
    const html = renderToStaticMarkup(
      <SshResourceSummary
        state={{ phase: 'error', snapshot }}
        serverLabel="Fixture training server"
      />,
    );

    expect(html).toContain('Unavailable · showing last sample');
    expect(html).toContain('37.5%');
    expect(html).not.toContain('/Users/researcher');
    expect(html).not.toContain('stderr');
  });

  it('states partial availability and the absence of an NVIDIA GPU explicitly', () => {
    const partial: SshServerResourceSnapshot = {
      ...snapshot,
      status: 'partial',
      gpu: { state: 'not_detected' },
      issues: ['gpu_not_detected'],
    };
    const html = renderToStaticMarkup(
      <SshResourceSummary state={{ phase: 'ready', snapshot: partial }} serverLabel="CPU node" />,
    );

    expect(html).toContain('Partial');
    expect(html).toContain('No NVIDIA GPU detected');
    expect(html).toContain('CPU utilization 37.5%');
  });
});
