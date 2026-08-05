import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ConnectionsView } from '../src/renderer/src/connections-view';
import { SshApprovalCenter } from '../src/renderer/src/ssh-approval-center';
import {
  SshConnectionsCard,
  SshProjectLinkControl,
  canEditSshHostAlias,
  validateSshHostAliasInput,
} from '../src/renderer/src/ssh-connections-card';
import type {
  SshApprovalRequest,
  SshConnectionProfile,
  SshServerResourceSnapshot,
} from '../src/shared/ssh-contracts';

const connection: SshConnectionProfile = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  label: 'Fixture training server',
  hostAlias: 'fixture-gpu',
  version: 2,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};

const resourceSnapshot: SshServerResourceSnapshot = {
  schemaVersion: 1,
  connectionId: connection.id,
  capturedAt: '2026-08-06T01:02:03.000Z',
  status: 'partial',
  cpu: { state: 'available', utilizationPercent: 24, logicalProcessorCount: 16 },
  memory: {
    state: 'available',
    usedBytes: 4 * 1024 ** 3,
    totalBytes: 16 * 1024 ** 3,
    utilizationPercent: 25,
  },
  gpu: { state: 'not_detected' },
  issues: ['gpu_not_detected'],
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
        onImport={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onTest={vi.fn()}
      />,
    );

    expect(html).toContain('Registered SSH servers');
    expect(html).toContain('Fixture training server');
    expect(html).toContain('fixture-gpu');
    expect(html).toContain('Authentication stays in your SSH agent');
    expect(html).toContain('private keys');
    expect(html).toContain('never stored');
    expect(html).toContain('How to add an SSH server');
    expect(html).toContain('~/.ssh/config');
    expect(html).toContain('Host research-gpu');
    expect(html).toContain('HostName gpu.example.edu');
    expect(html).toContain('Paste an SSH connection command');
    expect(html).toContain('ssh -p 2222 researcher@203.0.113.10 -L 8080:localhost:8080');
    expect(html).toContain('inactive normalized plan');
    expect(html).toContain('Parse and register');
    expect(html).toContain('Register server');
    expect(html).toContain('Test');
    expect(html).toContain('Edit');
    expect(html).toContain('Remove');
    expect(html).toContain('Allow once');
    expect(html).toContain('Diagnostics grants permit bounded Git inspection');
    expect(html).toContain('foreground Python');
    expect(html).toContain('at most 120 seconds');
    expect(html).toContain('Raw shells, inline eval, module or stdin launch, interactive shells');

    const serverRowIndex = html.indexOf('Fixture training server');
    expect(serverRowIndex).toBeGreaterThan(-1);
    expect(serverRowIndex).toBeLessThan(html.indexOf('How to add an SSH server'));
    expect(serverRowIndex).toBeLessThan(html.indexOf('Paste an SSH connection command'));
    expect(serverRowIndex).toBeLessThan(html.indexOf('Parse and register'));
    expect(serverRowIndex).toBeLessThan(html.indexOf('Register server'));
  });

  it('puts the registered server inventory first on the Connections surface', () => {
    const operation = vi.fn(async () => undefined);
    const html = renderToStaticMarkup(
      <ConnectionsView
        runtime={null}
        models={[]}
        selectedModel={null}
        status="Disconnected"
        busy={false}
        apiKeyMode={false}
        apiKey=""
        onSelectedModel={vi.fn()}
        onRefresh={vi.fn()}
        onReconnect={vi.fn()}
        onToggleApiKey={vi.fn()}
        onApiKey={vi.fn()}
        onLoginChatGpt={vi.fn()}
        onLoginApiKey={vi.fn()}
        onLogout={vi.fn()}
        sshConnections={[connection]}
        sshBusy={false}
        sshTestStatus={{ [connection.id]: 'Ready' }}
        onCreateSshConnection={operation}
        onImportSshCommand={operation}
        onUpdateSshConnection={operation}
        onRemoveSshConnection={operation}
        onTestSshConnection={operation}
        activeProject={null}
        sshWorkspaces={[]}
        onCreateSshWorkspace={operation}
        onUpdateSshWorkspace={operation}
        onRemoveSshWorkspace={operation}
      />,
    );

    const serverCardIndex = html.indexOf('Registered SSH servers');
    expect(serverCardIndex).toBeGreaterThan(-1);
    expect(serverCardIndex).toBeLessThan(html.indexOf('LOCAL RUNTIME'));
    expect(serverCardIndex).toBeLessThan(html.indexOf('Local Codex'));
    expect(serverCardIndex).toBeLessThan(html.indexOf('Remote workspace access'));
  });

  it('keeps the empty server inventory above registration controls', () => {
    const html = renderToStaticMarkup(
      <SshConnectionsCard
        connections={[]}
        busy={false}
        onCreate={vi.fn()}
        onImport={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onTest={vi.fn()}
      />,
    );

    const emptyStateIndex = html.indexOf('No SSH servers registered');
    expect(emptyStateIndex).toBeGreaterThan(-1);
    expect(emptyStateIndex).toBeLessThan(html.indexOf('How to add an SSH server'));
    expect(emptyStateIndex).toBeLessThan(html.indexOf('Parse and register'));
    expect(emptyStateIndex).toBeLessThan(html.indexOf('Register server'));
  });

  it('shows resource usage and links each registered server through the active project setup', () => {
    const html = renderToStaticMarkup(
      <SshConnectionsCard
        connections={[connection]}
        busy={false}
        onCreate={vi.fn()}
        onImport={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onTest={vi.fn()}
        activeProject={{
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Active research',
          slug: 'active-research',
          version: 1,
          createdAt: '2026-08-06T00:00:00.000Z',
          updatedAt: '2026-08-06T00:00:00.000Z',
        }}
        resourceStates={{ [connection.id]: { phase: 'ready', snapshot: resourceSnapshot } }}
        onRefreshResource={vi.fn()}
        onOpenWorkspaceSetup={vi.fn()}
      />,
    );

    expect(html).toContain('Link to Active research…');
    expect(html).toContain('Refresh usage');
    expect(html).toContain('CPU utilization 24%');
    expect(html).toContain('Memory utilization 25%');
    expect(html).toContain('No NVIDIA GPU detected');
  });

  it('shows an explicit linked state and disables linking when no project is selected', () => {
    const linkedHtml = renderToStaticMarkup(
      <SshConnectionsCard
        connections={[connection]}
        busy={false}
        onCreate={vi.fn()}
        onImport={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onTest={vi.fn()}
        activeProject={{
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Active research',
          slug: 'active-research',
          version: 1,
          createdAt: '2026-08-06T00:00:00.000Z',
          updatedAt: '2026-08-06T00:00:00.000Z',
        }}
        linkedConnectionIds={new Set([connection.id])}
      />,
    );
    const noProjectHtml = renderToStaticMarkup(
      <SshConnectionsCard
        connections={[connection]}
        busy={false}
        onCreate={vi.fn()}
        onImport={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onTest={vi.fn()}
      />,
    );

    expect(linkedHtml).toContain('Linked to Active research');
    expect(linkedHtml).not.toContain('Link to Active research…');
    expect(noProjectHtml).toMatch(/<button[^>]*disabled=""[^>]*>Select project to link<\/button>/u);
  });

  it('routes the exact registered server into the existing project grant setup', () => {
    const onOpenWorkspaceSetup = vi.fn();
    const control = SshProjectLinkControl({
      connectionId: connection.id,
      activeProject: {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Active research',
        slug: 'active-research',
        version: 1,
        createdAt: '2026-08-06T00:00:00.000Z',
        updatedAt: '2026-08-06T00:00:00.000Z',
      },
      linked: false,
      busy: false,
      onOpenWorkspaceSetup,
    });

    findButton(control, 'Link to Active research').props.onClick?.();
    expect(onOpenWorkspaceSetup).toHaveBeenCalledTimes(1);
    expect(onOpenWorkspaceSetup).toHaveBeenCalledWith(connection.id);
  });

  it('accepts only a concrete SSH config Host alias', () => {
    expect(validateSshHostAliasInput('  research-gpu  ')).toEqual({
      valid: true,
      alias: 'research-gpu',
    });
    expect(validateSshHostAliasInput('')).toMatchObject({ valid: false, reason: 'empty' });
    expect(validateSshHostAliasInput('research gpu')).toMatchObject({
      valid: false,
      reason: 'invalid-format',
    });
    expect(validateSshHostAliasInput('ssh')).toEqual({ valid: true, alias: 'ssh' });
    expect(validateSshHostAliasInput('root@gpu.example.edu')).toMatchObject({
      valid: false,
      reason: 'user-host',
    });
    expect(validateSshHostAliasInput('-p')).toMatchObject({
      valid: false,
      reason: 'option',
    });
    expect(validateSshHostAliasInput('research/gpu')).toMatchObject({
      valid: false,
      reason: 'invalid-format',
    });
  });

  it('keeps imported direct targets rename-only', () => {
    expect(canEditSshHostAlias(connection)).toBe(true);
    expect(
      canEditSshHostAlias({
        ...connection,
        directTarget: {
          host: '203.0.113.10',
          user: 'researcher',
          port: 2222,
          localForwards: [],
        },
      }),
    ).toBe(false);
  });

  it('recognizes a pasted ssh command and explains that forwarding stays unavailable', () => {
    const regular = validateSshHostAliasInput('ssh -p 2222 researcher@gpu.example.edu');
    expect(regular).toMatchObject({ valid: false, reason: 'ssh-command' });
    if (!regular.valid) {
      expect(regular.message).toContain('Paste this full command');
      expect(regular.message).toContain('only a Host alias');
    }

    const forwarding = validateSshHostAliasInput(
      'ssh -p 2222 researcher@gpu.example.edu -L 8080:localhost:8080',
    );
    expect(forwarding).toMatchObject({ valid: false, reason: 'ssh-command' });
    if (!forwarding.valid) {
      expect(forwarding.message).toContain('inactive loopback forwarding plan');
    }
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
    expect(html).toContain('restricted diagnostic');
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

  it('shows exact root workspace scope and an honest root execution warning', () => {
    const workspaceApproval: SshApprovalRequest = {
      ...approval,
      targetDisplay: 'root@203.0.113.10:2222',
      rootLogin: true,
      privilegeClass: 'root',
      executionMode: 'remote_workspace',
      connectionVersion: 2,
      workspaceGrantId: '66666666-6666-4666-8666-666666666666',
      workspaceGrantVersion: 3,
      workspaceRoot: '/root/research-project',
      workspaceWorkingDirectory: '/root/research-project/packages/app',
      workspaceOperation: 'test',
      commandSha256: 'a'.repeat(64),
      commandPreview:
        "cd '/root/research-project/packages/app' && exec '/usr/bin/python3' '-m' 'pytest'",
    };
    const html = renderToStaticMarkup(
      <SshApprovalCenter requests={[workspaceApproval]} onResolve={vi.fn()} />,
    );

    expect(html).toContain('root@203.0.113.10:2222');
    expect(html).toContain('HIGH RISK');
    expect(html).toContain('project code can run as ROOT');
    expect(html).toContain('Configured root · /root/research-project');
    expect(html).toContain('Exact working directory · /root/research-project/packages/app');
    expect(html).toContain('remote workspace / test');
    expect(html).toContain('Connection v2 · Grant v3');
    expect(html).toContain('a'.repeat(64));
    expect(html).toContain('not a remote sandbox');
    expect(html).toContain('change server state');
  });

  it('labels a foreground Python experiment and preserves the one-time approval boundary', () => {
    const experimentApproval: SshApprovalRequest = {
      ...approval,
      executionMode: 'remote_workspace',
      privilegeClass: 'standard',
      connectionVersion: 2,
      workspaceGrantId: '66666666-6666-4666-8666-666666666666',
      workspaceGrantVersion: 3,
      workspaceRoot: '/workspace/research-project',
      workspaceWorkingDirectory: '/workspace/research-project',
      workspaceOperation: 'experiment',
      commandSha256: 'b'.repeat(64),
      commandPreview:
        "cd '/workspace/research-project' && exec '/usr/bin/python3' '-u' 'experiments/train.py'",
    };
    const html = renderToStaticMarkup(
      <SshApprovalCenter requests={[experimentApproval]} onResolve={vi.fn()} />,
    );

    expect(html).toContain('remote workspace / experiment');
    expect(html).toContain('foreground Python experiment');
    expect(html).toContain('at most 120 seconds');
    expect(html).toContain('not an unattended job runner');
    expect(html).toContain('Allow once');
    expect(html).toContain('untrusted project code and change server state');
  });

  it('renders no approval surface when no command is pending', () => {
    expect(SshApprovalCenter({ requests: [], onResolve: vi.fn() })).toBeNull();
  });
});
