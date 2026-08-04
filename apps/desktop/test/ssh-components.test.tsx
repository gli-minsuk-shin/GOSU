import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SshApprovalCenter } from '../src/renderer/src/ssh-approval-center';
import { SshConnectionsCard } from '../src/renderer/src/ssh-connections-card';
import type { SshApprovalRequest, SshConnectionProfile } from '../src/shared/ssh-contracts';

const connection: SshConnectionProfile = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  label: 'Fixture training server',
  hostAlias: 'fixture-gpu',
  version: 2,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};

const approval: SshApprovalRequest = {
  schemaVersion: 1,
  id: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
  attemptId: '55555555-5555-4555-8555-555555555555',
  turnId: 'turn-fixture',
  toolCallId: 'tool-call-fixture',
  connectionId: connection.id,
  connectionLabel: connection.label,
  hostAlias: connection.hostAlias,
  commandPreview: "'/usr/bin/nvidia-smi' '--query-gpu=name'",
  requestedAt: '2026-08-04T00:00:00.000Z',
  expiresAt: '2026-08-04T00:02:00.000Z',
};

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<{ children?: ReactNode }>(node)) return '';
  return Children.toArray(node.props.children).map(nodeText).join('');
}

function findButton(node: ReactNode, label: string): ReactElement<{ onClick?: () => void }> {
  let match: ReactElement<{ onClick?: () => void }> | undefined;
  const visit = (candidate: ReactNode) => {
    if (match || !isValidElement<{ children?: ReactNode; onClick?: () => void }>(candidate)) return;
    if (candidate.type === 'button' && nodeText(candidate).includes(label)) {
      match = candidate;
      return;
    }
    Children.forEach(candidate.props.children, visit);
  };
  visit(node);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

describe('independent SSH connection UI', () => {
  it('explains alias and SSH Agent boundaries while exposing basic connection management', () => {
    const html = renderToStaticMarkup(
      <SshConnectionsCard
        connections={[connection]}
        busy={false}
        testStatus={{ [connection.id]: 'Ready' }}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onTest={vi.fn()}
      />,
    );

    expect(html).toContain('Registered server aliases');
    expect(html).toContain('Fixture training server');
    expect(html).toContain('fixture-gpu');
    expect(html).toContain('SSH agent or existing config');
    expect(html).toContain('private keys are never stored');
    expect(html).toContain('Register server');
    expect(html).toContain('Test');
    expect(html).toContain('Edit');
    expect(html).toContain('Remove');
    expect(html).toContain('Allow once');
    expect(html).toContain('fixed read-only diagnostics allowlist');
    expect(html).toContain('disables scripts, mutation, interactive shells');
  });

  it('shows the exact bounded command and wires Allow once and Deny decisions', () => {
    const onResolve = vi.fn();
    const center = SshApprovalCenter({ requests: [approval], onResolve });
    const html = renderToStaticMarkup(center);

    expect(html).toContain('SSH approval required');
    expect(html).toContain('Fixture training server');
    expect(html).toContain('&#x27;/usr/bin/nvidia-smi&#x27;');
    expect(html).toContain('this project chat session');
    expect(html).toContain('not stored as raw SSH output');
    expect(html).toContain('untrusted data, never project instructions');
    expect(html).toContain('read-only diagnostics allowlist');
    expect(html).toContain(approval.projectId);
    expect(html).toContain(approval.sessionId);

    findButton(center, 'Allow once').props.onClick?.();
    findButton(center, 'Deny').props.onClick?.();
    expect(onResolve).toHaveBeenNthCalledWith(1, {
      approvalId: approval.id,
      decision: 'allow_once',
    });
    expect(onResolve).toHaveBeenNthCalledWith(2, {
      approvalId: approval.id,
      decision: 'deny',
    });
  });

  it('renders no approval surface when no command is pending', () => {
    expect(SshApprovalCenter({ requests: [], onResolve: vi.fn() })).toBeNull();
  });
});
