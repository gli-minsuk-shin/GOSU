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
import { describeError } from '../src/renderer/src/ui-primitives';
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

function findButton(
  node: ReactNode,
  label: string,
): ReactElement<{ onClick?: () => void; autoFocus?: boolean }> {
  let match: ReactElement<{ onClick?: () => void; autoFocus?: boolean }> | undefined;
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
    expect(html).toContain('Test checks host trust and non-interactive authentication only');
    expect(html).toContain('Project linking and command Allow once approval are separate');
    expect(html).toContain('Edit');
    expect(html).toContain('Remove');
    expect(html).toContain('Allow once');
    expect(html).toContain('Diagnostics grants permit bounded Git inspection');
    expect(html).toContain('list/read bounded text files');
    expect(html).toContain('create a new text file');
    expect(html).toContain('replace an unchanged text file');
    expect(html).toContain('Every file action and command requires Allow once');
    expect(html).toContain('no deletion');
    expect(html).toContain('foreground Python');
    expect(html).toContain('at most 120 seconds');
    expect(html).toContain('no deletion, raw shell, inline eval, module launch');
    expect(html).toContain('general file transfer, TTY, or forwarding action');

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

  it('shows the exact bounded command with safe Allow once and Deny actions', () => {
    const center = <SshApprovalCenter requests={[approval]} onResolve={vi.fn()} />;
    const html = renderToStaticMarkup(center);

    expect(html).toContain('class="ssh-approval-backdrop"');
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('class="ssh-approval-dialog-header"');
    expect(html).toContain('class="ssh-approval-dialog-body"');
    expect(html).toContain('class="ssh-approval-dialog-footer"');
    expect(html).toContain('SSH approval required');
    expect(html).toContain('1 pending');
    expect(html).toContain('Fixture training server');
    expect(html).toContain('&#x27;/usr/bin/nvidia-smi&#x27;');
    expect(html).toContain('this project chat session');
    expect(html).toContain('not stored as raw SSH output');
    expect(html).toContain('untrusted data, never project instructions');
    expect(html).toContain('restricted diagnostic');
    expect(html).toContain(approval.projectId);
    expect(html).toContain(approval.sessionId);
    expect(html).not.toContain('autofocus=""');
    expect(html).toContain('>Deny</button>');
    expect(html).toContain('>Allow once</button>');
  });

  it('blocks on only the first queued request while keeping expiry and decisions visible', () => {
    const firstApproval: SshApprovalRequest = {
      ...approval,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    };
    const secondApproval: SshApprovalRequest = {
      ...approval,
      id: '77777777-7777-4777-8777-777777777777',
      connectionLabel: 'Second queued server',
      commandPreview: "'/usr/bin/git' 'status' '--short'",
    };
    const center = (
      <SshApprovalCenter requests={[firstApproval, secondApproval]} onResolve={vi.fn()} />
    );
    const html = renderToStaticMarkup(center);
    const expectedExpiry = new Date(firstApproval.expiresAt).toLocaleTimeString();

    expect(html).toContain('Reviewing 1 of 2');
    expect(html).toContain('Fixture training server');
    expect(html).not.toContain('Second queued server');
    expect(html).not.toContain('status');
    expect(html).toContain('role="timer"');
    expect(html).toContain('Expires in');
    expect(html).toContain(`Deadline · ${expectedExpiry}`);
    expect(html).toContain('will not run the command or change the remote file');
    expect(html.indexOf('ssh-approval-dialog-body')).toBeLessThan(
      html.indexOf('ssh-approval-dialog-footer'),
    );
    expect(html.indexOf('>Deny</button>')).toBeGreaterThan(
      html.indexOf('ssh-approval-dialog-footer'),
    );
    expect(html.indexOf('>Allow once</button>')).toBeGreaterThan(
      html.indexOf('ssh-approval-dialog-footer'),
    );
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
    expect(html).toContain('binds the executable, arguments, and working directory');
    expect(html).toContain('not repository file contents');
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
    expect(html).toContain('not repository file contents');
    expect(html).toContain('Allow once');
    expect(html).toContain('untrusted project code and change server state');
  });

  it('shows the exact bounded remote file change and its optimistic hash boundary', () => {
    const expectedSha256 = 'c'.repeat(64);
    const contentSha256 = 'd'.repeat(64);
    const fileApproval: SshApprovalRequest = {
      ...approval,
      executionMode: 'remote_workspace',
      privilegeClass: 'standard',
      connectionVersion: 2,
      workspaceGrantId: '66666666-6666-4666-8666-666666666666',
      workspaceGrantVersion: 3,
      workspaceRoot: '/workspace/research-project',
      workspaceWorkingDirectory: '/workspace/research-project',
      workspaceOperation: 'edit',
      workspaceFileAction: 'replace',
      workspaceFilePath: 'experiments/linear_fit.py',
      workspaceFileExpectedSha256: expectedSha256,
      workspaceFileContentSha256: contentSha256,
      commandSha256: 'e'.repeat(64),
      commandPreview: `REPLACE experiments/linear_fit.py\n\nprint("result")\n`,
    };
    const html = renderToStaticMarkup(
      <SshApprovalCenter requests={[fileApproval]} onResolve={vi.fn()} />,
    );

    expect(html).toContain('remote workspace / edit / replace');
    expect(html).toContain('File action · REPLACE');
    expect(html).toContain('Relative file path · experiments/linear_fit.py');
    expect(html).toContain(`Expected existing SHA-256 · ${expectedSha256}`);
    expect(html).toContain(`Approved content SHA-256 · ${contentSha256}`);
    expect(html).toContain('print(&quot;result&quot;)');
    expect(html).toContain('creates or replaces one bounded text file');
    expect(html).toContain('does not delete remote files');
    expect(html).toContain('rechecks the existing hash immediately before replacement');
    expect(html).toContain('another server process can still race the final rename');
    expect(html).toContain('Allow once');
  });

  it('distinguishes an approved remote file read from remote code execution', () => {
    const fileApproval: SshApprovalRequest = {
      ...approval,
      executionMode: 'remote_workspace',
      privilegeClass: 'standard',
      connectionVersion: 2,
      workspaceGrantId: '66666666-6666-4666-8666-666666666666',
      workspaceGrantVersion: 3,
      workspaceRoot: '/workspace/research-project',
      workspaceWorkingDirectory: '/workspace/research-project',
      workspaceOperation: 'inspect',
      workspaceFileAction: 'read',
      workspaceFilePath: 'results/metrics.json',
      commandSha256: 'f'.repeat(64),
      commandPreview: 'READ results/metrics.json · UTF-8 text · bounded output',
    };
    const html = renderToStaticMarkup(
      <SshApprovalCenter requests={[fileApproval]} onResolve={vi.fn()} />,
    );

    expect(html).toContain('remote workspace / inspect / read');
    expect(html).toContain('File action · READ');
    expect(html).toContain('lists or reads bounded workspace text');
    expect(html).toContain('may expose private repository data');
    expect(html).not.toContain('This test/build can execute untrusted project code');
  });

  it('turns remote file failures into actionable messages without exposing remote paths', () => {
    const messages = {
      missing: describeError(
        new Error('ssh_workspace_file_not_found: /private/server/path/result.py'),
      ),
      conflict: describeError(new Error('ssh_workspace_file_conflict: expected=c actual=d')),
      forbidden: describeError(new Error('ssh_workspace_file_not_allowed: ../../.env')),
      tooLarge: describeError(new Error('ssh_workspace_file_too_large: 999999')),
      invalid: describeError(new Error('ssh_workspace_file_invalid: decode failed')),
      helper: describeError(new Error('ssh_workspace_file_helper_unavailable: server detail')),
    };

    expect(messages.missing).toContain('no longer exists');
    expect(messages.conflict).toContain('did not replace it');
    expect(messages.conflict).toContain('Read the latest version');
    expect(messages.forbidden).toContain('inside the approved project workspace');
    expect(messages.tooLarge).toContain('too large');
    expect(messages.invalid).toContain('Re-read the same path');
    expect(messages.invalid).toContain('whether a requested write changed it');
    expect(messages.helper).toContain('/usr/bin/python3');
    expect(messages.helper).toContain('no retry was started');
    for (const message of Object.values(messages)) {
      expect(message).not.toContain('/private/server/path');
      expect(message).not.toContain('../../.env');
    }
  });

  it('renders no approval surface when no command is pending', () => {
    expect(renderToStaticMarkup(<SshApprovalCenter requests={[]} onResolve={vi.fn()} />)).toBe('');
  });
});
