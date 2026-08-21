import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  acknowledgeSshWorkspaceSetupRequest,
  resolveSshWorkspaceSetupConnectionId,
  resolveSshWorkspaceSetupTarget,
  shouldCompleteSshWorkspaceRootOnTab,
  shouldHandleSshWorkspaceSetupRequest,
  suggestedSshWorkspaceRoot,
  SshWorkspaceGrantsCard,
} from '../src/renderer/src/ssh-workspace-grants-card';
import type { GrantedRemoteWorkspace } from '../src/shared/ssh-workspace-contracts';
import type { ProjectRecord } from '../src/shared/workspace-contracts';

const project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Remote research',
  version: 1,
} as ProjectRecord;

const workspace: GrantedRemoteWorkspace = {
  grant: {
    schemaVersion: 1,
    id: '22222222-2222-4222-8222-222222222222',
    projectId: project.id,
    connectionId: '33333333-3333-4333-8333-333333333333',
    canonicalRoot: '/root/research-project',
    permissionMode: 'workspace',
    version: 2,
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
  },
  connection: {
    schemaVersion: 1,
    id: '33333333-3333-4333-8333-333333333333',
    label: 'Fixture root GPU',
    hostAlias: 'direct-fixture',
    directTarget: {
      host: '203.0.113.10',
      user: 'root',
      port: 2222,
      localForwards: [],
    },
    version: 1,
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
  },
};

describe('project-scoped remote workspace settings', () => {
  it('preselects an explicitly requested server or the sole available server only', () => {
    expect(resolveSshWorkspaceSetupConnectionId('server-b', ['server-a', 'server-b'])).toBe(
      'server-b',
    );
    expect(resolveSshWorkspaceSetupConnectionId(null, ['server-a'])).toBe('server-a');
    expect(resolveSshWorkspaceSetupConnectionId(null, ['server-a', 'server-b'])).toBe('');
    expect(resolveSshWorkspaceSetupConnectionId('already-granted', ['server-a'])).toBe('');
  });

  it('opens an already-linked server as an edit without bypassing the grant boundary', () => {
    expect(resolveSshWorkspaceSetupTarget(workspace.connection.id, [], [workspace])).toEqual({
      kind: 'edit',
      workspace,
    });
    expect(resolveSshWorkspaceSetupTarget('server-a', ['server-a'], [workspace])).toEqual({
      kind: 'create',
      connectionId: 'server-a',
    });
  });

  it('applies a setup request only to its active project and only once', () => {
    const request = {
      requestId: 2,
      projectId: project.id,
      connectionId: workspace.connection.id,
    } as const;

    expect(shouldHandleSshWorkspaceSetupRequest(request, project.id, 1)).toBe(true);
    expect(shouldHandleSshWorkspaceSetupRequest(request, project.id, 2)).toBe(false);
    expect(
      shouldHandleSshWorkspaceSetupRequest(request, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1),
    ).toBe(false);
    expect(shouldHandleSshWorkspaceSetupRequest(request, null, 1)).toBe(false);
    expect(acknowledgeSshWorkspaceSetupRequest(request, 1)).toBe(request);
    expect(acknowledgeSshWorkspaceSetupRequest(request, 2)).toBeNull();
  });

  it('accepts the suggested canonical root with forward Tab only when the field is empty', () => {
    expect(suggestedSshWorkspaceRoot('generative-bootstrap-sampler')).toBe(
      '/root/generative-bootstrap-sampler',
    );
    expect(suggestedSshWorkspaceRoot('')).toBe('/root/my-research-project');
    expect(
      shouldCompleteSshWorkspaceRootOnTab({
        key: 'Tab',
        shiftKey: false,
        isComposing: false,
        currentValue: '',
      }),
    ).toBe(true);
    expect(
      shouldCompleteSshWorkspaceRootOnTab({
        key: 'Tab',
        shiftKey: false,
        isComposing: false,
        currentValue: '   ',
      }),
    ).toBe(true);
    expect(
      shouldCompleteSshWorkspaceRootOnTab({
        key: 'Tab',
        shiftKey: false,
        isComposing: false,
        currentValue: '/workspace/custom',
      }),
    ).toBe(false);
    expect(
      shouldCompleteSshWorkspaceRootOnTab({
        key: 'Tab',
        shiftKey: true,
        isComposing: false,
        currentValue: '',
      }),
    ).toBe(false);
    expect(
      shouldCompleteSshWorkspaceRootOnTab({
        key: 'Enter',
        shiftKey: false,
        isComposing: false,
        currentValue: '',
      }),
    ).toBe(false);
    expect(
      shouldCompleteSshWorkspaceRootOnTab({
        key: 'Tab',
        shiftKey: false,
        isComposing: true,
        currentValue: '',
      }),
    ).toBe(false);
  });

  it('shows explicit project scope, root, permission mode, and high-risk confirmation', () => {
    const html = renderToStaticMarkup(
      <SshWorkspaceGrantsCard
        project={project}
        connections={[workspace.connection]}
        workspaces={[workspace]}
        busy={false}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onEnableTrustedWorkspace={vi.fn()}
        onRevokeTrustedWorkspace={vi.fn()}
        onTest={vi.fn()}
        testStatus={{ [workspace.connection.id]: 'Ready' }}
      />,
    );

    expect(html).toContain('Remote workspace access');
    expect(html).toContain('1 granted to Remote research');
    expect(html).toContain('/root/research-project');
    expect(html).toContain(
      'Workspace · inspection, approved tests/builds, and foreground Python experiments',
    );
    expect(html).toContain('experiments may execute repository code');
    expect(html).toContain('HIGH RISK · ROOT account');
    expect(html).toContain('not a remote sandbox');
    expect(html).toContain('every command and file action requires a separate Allow once decision');
    expect(html).toContain('Project trusted execution');
    expect(html).toContain('Enable ROOT auto-run…');
    expect(html).toContain('Allow once required · Project auto-run is off');
    expect(html).toContain('Press Tab from an empty field to use');
    expect(html).toContain('Test server');
    expect(html).toContain('Ready');
  });

  it('keeps registered servers unavailable when there is no active project', () => {
    const html = renderToStaticMarkup(
      <SshWorkspaceGrantsCard
        project={null}
        connections={[workspace.connection]}
        workspaces={[]}
        busy={false}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(html).toContain('No active project');
    expect(html).toContain('Open a project');
  });
});
