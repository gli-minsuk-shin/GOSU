import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SSH_MAX_PENDING_APPROVALS_PER_TURN,
  SshConnectionService,
  type SshConnectionServiceError,
  type SshConnectionStorage,
} from '../src/main/ssh-connection-service';
import {
  SshCommandRunnerError,
  type SshCommandRunner,
  type SshCommandRunOptions,
  type SshProcessResult,
  type SshRunnableCommand,
} from '../src/main/ssh-command-runner';
import {
  SSH_AGENT_TOOL_MAX_OUTPUT_CHARACTERS,
  SSH_APPROVAL_DEFAULT_TTL_MS,
  type SshAgentCommand,
  type SshApprovalRequest,
  type SshConnectionProfile,
} from '../src/shared/ssh-contracts';
import type {
  RemoteWorkspaceGrant,
  SshTrustedWorkspaceAuditRecord,
  SshWorkspaceAgentCommand,
  SshWorkspaceFileOperation,
} from '../src/shared/ssh-workspace-contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_A = '22222222-2222-4222-8222-222222222222';
const SESSION_B = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const ATTEMPT_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_PROJECT_ID = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-08-04T00:00:00.000Z');

class MemorySshStorage implements SshConnectionStorage {
  readonly profiles = new Map<string, SshConnectionProfile>();
  readonly workspaceGrants = new Map<string, RemoteWorkspaceGrant>();
  readonly trustedWorkspaceAudit: SshTrustedWorkspaceAuditRecord[] = [];

  constructor(profile: SshConnectionProfile | null = connectionFixture()) {
    if (profile) this.profiles.set(profile.id, profile);
  }

  listSshConnections(): readonly SshConnectionProfile[] | Promise<readonly SshConnectionProfile[]> {
    return [...this.profiles.values()];
  }

  createSshConnection(profile: SshConnectionProfile) {
    if (this.profiles.has(profile.id)) return false;
    this.profiles.set(profile.id, profile);
    return true;
  }

  updateSshConnection(
    profile: SshConnectionProfile,
    expectedVersion: number,
  ): boolean | Promise<boolean> {
    const current = this.profiles.get(profile.id);
    if (!current || current.version !== expectedVersion) return false;
    this.profiles.set(profile.id, profile);
    return true;
  }

  removeSshConnection(connectionId: string, expectedVersion: number): boolean | Promise<boolean> {
    const current = this.profiles.get(connectionId);
    if (!current || current.version !== expectedVersion) return false;
    return this.profiles.delete(connectionId);
  }

  listSshWorkspaceGrants(projectId: string) {
    return [...this.workspaceGrants.values()].filter((grant) => grant.projectId === projectId);
  }

  createSshWorkspaceGrant(grant: RemoteWorkspaceGrant): boolean | Promise<boolean> {
    if (
      this.workspaceGrants.has(grant.id) ||
      [...this.workspaceGrants.values()].some(
        (existing) =>
          existing.projectId === grant.projectId && existing.connectionId === grant.connectionId,
      )
    ) {
      return false;
    }
    this.workspaceGrants.set(grant.id, grant);
    return true;
  }

  updateSshWorkspaceGrant(
    grant: RemoteWorkspaceGrant,
    expectedVersion: number,
  ): boolean | Promise<boolean> {
    const current = this.workspaceGrants.get(grant.id);
    if (!current || current.version !== expectedVersion) return false;
    this.workspaceGrants.set(grant.id, grant);
    return true;
  }

  removeSshWorkspaceGrant(
    projectId: string,
    grantId: string,
    expectedVersion: number,
  ): boolean | Promise<boolean> {
    const current = this.workspaceGrants.get(grantId);
    if (!current || current.projectId !== projectId || current.version !== expectedVersion) {
      return false;
    }
    return this.workspaceGrants.delete(grantId);
  }

  appendSshTrustedWorkspaceAudit(
    record: SshTrustedWorkspaceAuditRecord,
  ): boolean | Promise<boolean> {
    if (this.trustedWorkspaceAudit.some((entry) => entry.id === record.id)) return false;
    this.trustedWorkspaceAudit.push(record);
    return true;
  }
}

function connectionFixture(overrides: Partial<SshConnectionProfile> = {}): SshConnectionProfile {
  return {
    schemaVersion: 1,
    id: CONNECTION_ID,
    label: 'Fixture GPU',
    hostAlias: 'fixture-gpu',
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function commandFixture(overrides: Partial<SshAgentCommand> = {}): SshAgentCommand {
  return {
    projectId: PROJECT_ID,
    sessionId: SESSION_A,
    attemptId: ATTEMPT_ID,
    turnId: 'turn-fixture',
    toolCallId: 'tool-call-fixture',
    connectionId: CONNECTION_ID,
    command: '/usr/bin/nvidia-smi',
    args: ['--query-gpu=name'],
    timeoutSeconds: 30,
    ...overrides,
  };
}

function workspaceCommandFixture(
  grant: RemoteWorkspaceGrant,
  overrides: Partial<SshWorkspaceAgentCommand> = {},
): SshWorkspaceAgentCommand {
  return {
    projectId: grant.projectId,
    sessionId: SESSION_A,
    attemptId: ATTEMPT_ID,
    turnId: 'turn-workspace',
    toolCallId: 'tool-workspace',
    connectionId: grant.connectionId,
    grantId: grant.id,
    command: '/usr/bin/git',
    args: ['status', '--short'],
    timeoutSeconds: 30,
    ...overrides,
  };
}

function workspaceFileWriteFixture(
  grant: RemoteWorkspaceGrant,
  overrides: Partial<Extract<SshWorkspaceFileOperation, { action: 'write' }>> = {},
): Extract<SshWorkspaceFileOperation, { action: 'write' }> {
  return {
    projectId: grant.projectId,
    sessionId: SESSION_A,
    attemptId: ATTEMPT_ID,
    turnId: 'turn-workspace-file',
    toolCallId: 'tool-workspace-file',
    connectionId: grant.connectionId,
    grantId: grant.id,
    action: 'write',
    relativePath: 'experiments/linear_fit.py',
    content: 'print("metric=1.0")\n',
    expectedSha256: null,
    ...overrides,
  };
}

function runnerFixture(result?: Partial<SshProcessResult>) {
  const resultFactory = async (): Promise<SshProcessResult> => ({
    exitCode: 0,
    stdout: 'Fixture GPU\n',
    stderr: '',
    truncated: false,
    durationMs: 12,
    ...result,
  });
  const execute = vi.fn(resultFactory);
  const testConnection = vi.fn(async () => undefined);
  const executeWorkspaceFileHelper = vi.fn(resultFactory);
  const callable = vi.fn() as unknown as SshCommandRunner;
  callable.execute = execute;
  callable.executeWorkspaceFileHelper = executeWorkspaceFileHelper;
  callable.testConnection = testConnection;
  return { runner: callable, execute, executeWorkspaceFileHelper, testConnection };
}

function nextApproval(service: SshConnectionService) {
  return new Promise<SshApprovalRequest>((resolve) => {
    service.once('event', (event) => {
      if (event.type === 'approval.requested') resolve(event.request);
    });
  });
}

function deferredSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe('SSH connection and Allow once service', () => {
  it('serializes project inactivation after an in-flight grant commit and blocks later grant mutations', async () => {
    const storage = new MemorySshStorage();
    const { runner } = runnerFixture();
    const service = new SshConnectionService(storage, runner, { now: () => NOW });
    const grantWriteStarted = deferredSignal();
    const releaseGrantWrite = deferredSignal();
    const inactivationStarted = deferredSignal();
    const releaseInactivation = deferredSignal();
    const trace: string[] = [];
    const originalCreate = storage.createSshWorkspaceGrant.bind(storage);
    vi.spyOn(storage, 'createSshWorkspaceGrant').mockImplementationOnce(async (grant) => {
      grantWriteStarted.resolve();
      await releaseGrantWrite.promise;
      const created = originalCreate(grant);
      trace.push('grant:committed');
      return created;
    });

    const grantPromise = service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace',
      permissionMode: 'diagnostics',
      confirmWorkspaceRisk: true,
    });
    await grantWriteStarted.promise;

    const inactivation = service.runWhenProjectsIdle([PROJECT_ID], async () => {
      trace.push('project:inactive');
      inactivationStarted.resolve();
      await releaseInactivation.promise;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(trace).toEqual([]);

    releaseGrantWrite.resolve();
    const grant = await grantPromise;
    await inactivationStarted.promise;
    expect(trace).toEqual(['grant:committed', 'project:inactive']);

    expect(() =>
      service.updateWorkspaceGrant({
        grantId: grant.id,
        projectId: PROJECT_ID,
        expectedVersion: grant.version,
        canonicalRoot: '/workspace/changed',
        permissionMode: 'diagnostics',
        confirmWorkspaceRisk: true,
      }),
    ).toThrow('ssh_unavailable');
    expect(storage.workspaceGrants.get(grant.id)).toEqual(grant);

    releaseInactivation.resolve();
    await inactivation;
  });

  it('owns versioned CRUD behind its storage port', async () => {
    const storage = new MemorySshStorage(null);
    const { runner } = runnerFixture();
    const service = new SshConnectionService(storage, runner, { now: () => NOW });

    const created = await service.createConnection({ label: 'Lab server', hostAlias: 'lab-gpu' });
    expect(created).toMatchObject({ label: 'Lab server', hostAlias: 'lab-gpu', version: 1 });
    await expect(service.listConnections()).resolves.toEqual([created]);

    const updated = await service.updateConnection({
      connectionId: created.id,
      expectedVersion: 1,
      label: 'Lab server 2',
      hostAlias: 'lab-gpu-2',
    });
    expect(updated).toMatchObject({ label: 'Lab server 2', version: 2 });
    await expect(
      service.removeConnection({ connectionId: created.id, expectedVersion: 1 }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({
        code: 'ssh_connection_version_conflict',
      }),
    );
    await expect(
      service.removeConnection({ connectionId: created.id, expectedVersion: 2 }),
    ).resolves.toEqual({ removed: true });
  });

  it('owns project-scoped workspace grants with optimistic versions', async () => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: { host: '203.0.113.10', user: 'researcher', port: 2222, localForwards: [] },
      }),
    );
    const { runner } = runnerFixture();
    const service = new SshConnectionService(storage, runner, { now: () => NOW });
    const created = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace',
      permissionMode: 'diagnostics',
      confirmWorkspaceRisk: true,
    });

    await expect(service.listWorkspaceGrants(PROJECT_ID)).resolves.toMatchObject([
      { grant: created, connection: { id: CONNECTION_ID } },
    ]);
    const updated = await service.updateWorkspaceGrant({
      grantId: created.id,
      projectId: PROJECT_ID,
      expectedVersion: created.version,
      canonicalRoot: '/root/project',
      permissionMode: 'workspace',
      confirmWorkspaceRisk: true,
    });
    expect(updated).toMatchObject({ version: 2, canonicalRoot: '/root/project' });
    await expect(
      service.removeWorkspaceGrant({
        grantId: updated.id,
        projectId: OTHER_PROJECT_ID,
        expectedVersion: updated.version,
      }),
    ).rejects.toMatchObject({ code: 'ssh_workspace_grant_not_found' });
    await expect(
      service.removeWorkspaceGrant({
        grantId: updated.id,
        projectId: PROJECT_ID,
        expectedVersion: updated.version,
      }),
    ).resolves.toEqual({ removed: true });
  });

  it('links one registered server to multiple projects with independent workspace grants', async () => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: { host: '203.0.113.10', user: 'researcher', port: 2222, localForwards: [] },
      }),
    );
    const { runner } = runnerFixture();
    const service = new SshConnectionService(storage, runner, { now: () => NOW });

    const firstGrant = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace/project-a',
      permissionMode: 'diagnostics',
      confirmWorkspaceRisk: true,
    });
    const secondGrant = await service.createWorkspaceGrant({
      projectId: OTHER_PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace/project-b',
      permissionMode: 'workspace',
      confirmWorkspaceRisk: true,
    });

    expect(firstGrant.connectionId).toBe(CONNECTION_ID);
    expect(secondGrant.connectionId).toBe(CONNECTION_ID);
    expect(secondGrant.id).not.toBe(firstGrant.id);
    await expect(service.listWorkspaceGrants(PROJECT_ID)).resolves.toMatchObject([
      {
        grant: {
          projectId: PROJECT_ID,
          connectionId: CONNECTION_ID,
          canonicalRoot: '/workspace/project-a',
          permissionMode: 'diagnostics',
        },
      },
    ]);
    await expect(service.listWorkspaceGrants(OTHER_PROJECT_ID)).resolves.toMatchObject([
      {
        grant: {
          projectId: OTHER_PROJECT_ID,
          connectionId: CONNECTION_ID,
          canonicalRoot: '/workspace/project-b',
          permissionMode: 'workspace',
        },
      },
    ]);
  });

  it('reports resources only for servers granted to the requested project', async () => {
    const storage = new MemorySshStorage(connectionFixture());
    storage.profiles.set(
      '77777777-7777-4777-8777-777777777777',
      connectionFixture({
        id: '77777777-7777-4777-8777-777777777777',
        label: 'Unlinked server',
        hostAlias: 'unlinked-server',
      }),
    );
    const responses = [
      {
        stdout:
          'cpu 100 0 50 850 0 0 0 0\ncpu0 100 0 50 850 0 0 0 0\nMemTotal: 1000 kB\nMemAvailable: 250 kB\n',
      },
      { stdout: 'cpu 120 0 50 930 0 0 0 0\ncpu0 120 0 50 930 0 0 0 0\n' },
      { stdout: '0, Fixture GPU, 50, 512, 1024, 60\n' },
    ];
    const run = vi.fn(async (_command: SshRunnableCommand): Promise<SshProcessResult> => ({
      exitCode: 0,
      stderr: '',
      truncated: false,
      durationMs: 5,
      ...(responses.shift() ?? { stdout: '' }),
    }));
    const runner = run as unknown as SshCommandRunner;
    runner.execute = vi.fn(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      truncated: false,
      durationMs: 5,
    }));
    runner.testConnection = vi.fn(async () => undefined);
    const service = new SshConnectionService(storage, runner, {
      now: () => NOW,
      resourceSampleDelayMs: 0,
    });
    await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace',
      permissionMode: 'diagnostics',
      confirmWorkspaceRisk: true,
    });

    await expect(
      service.listProjectResourceSnapshots({ projectId: PROJECT_ID, force: true }),
    ).resolves.toMatchObject([{ connectionId: CONNECTION_ID, status: 'ready' }]);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls.every(([command]) => command.hostAlias === 'fixture-gpu')).toBe(true);
    await expect(
      service.listProjectResourceSnapshots({ projectId: OTHER_PROJECT_ID }),
    ).resolves.toEqual([]);
    await expect(
      service.readProjectResourceSnapshot({
        projectId: PROJECT_ID,
        connectionId: CONNECTION_ID,
      }),
    ).resolves.toMatchObject({ connectionId: CONNECTION_ID, status: 'ready' });
    await expect(
      service.readProjectResourceSnapshot({
        projectId: OTHER_PROJECT_ID,
        connectionId: CONNECTION_ID,
        force: true,
      }),
    ).rejects.toMatchObject({ code: 'ssh_workspace_grant_not_found' });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('requires a normalized direct target before enabling test/build workspace mode', async () => {
    const { runner } = runnerFixture();
    const service = new SshConnectionService(new MemorySshStorage(connectionFixture()), runner);

    await expect(
      service.createWorkspaceGrant({
        projectId: PROJECT_ID,
        connectionId: CONNECTION_ID,
        canonicalRoot: '/workspace',
        permissionMode: 'workspace',
        confirmWorkspaceRisk: true,
      }),
    ).rejects.toMatchObject({ code: 'ssh_workspace_command_not_allowed' });
  });

  it('enables audited trusted workspace execution only after explicit two-part consent', async () => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: {
          host: '203.0.113.10',
          user: 'researcher',
          localForwards: [],
        },
      }),
    );
    const { runner, execute } = runnerFixture({ stdout: ' M src/model.py\n' });
    const service = new SshConnectionService(storage, runner, { now: () => NOW });
    const created = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace/research-project',
      permissionMode: 'workspace',
      confirmWorkspaceRisk: true,
    });
    const trusted = await service.enableTrustedWorkspace({
      projectId: PROJECT_ID,
      grantId: created.id,
      expectedVersion: created.version,
      confirmTrustedWorkspaceRisk: true,
      confirmNoRemoteSandbox: true,
    });
    const events: unknown[] = [];
    service.on('event', (event) => events.push(event));

    await expect(
      service.runAgentWorkspaceCommand(
        workspaceCommandFixture(trusted, { args: ['status', '--short'] }),
      ),
    ).resolves.toMatchObject({ stdout: ' M src/model.py\n' });

    expect(events).toEqual([]);
    expect(execute).toHaveBeenCalledOnce();
    expect(storage.trustedWorkspaceAudit).toHaveLength(1);
    expect(storage.trustedWorkspaceAudit[0]).toMatchObject({
      projectId: PROJECT_ID,
      grantId: trusted.id,
      grantVersion: trusted.version,
      connectionId: CONNECTION_ID,
      connectionVersion: 1,
      policyVersion: 1,
      operation: 'inspect',
      commandSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    await expect(
      service.runAgentWorkspaceCommand(
        workspaceCommandFixture(trusted, {
          command: '/bin/sh',
          args: ['-c', 'rm -rf /'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'ssh_workspace_command_not_allowed' });
    expect(storage.trustedWorkspaceAudit).toHaveLength(1);
    expect(execute).toHaveBeenCalledOnce();
    await expect(
      service.revokeTrustedWorkspace({
        projectId: PROJECT_ID,
        grantId: trusted.id,
        expectedVersion: trusted.version,
      }),
    ).resolves.toMatchObject({ version: trusted.version + 1, trustedAccess: null });
  });

  it('expires trusted access when the exact server binding changes and returns to Allow once', async () => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: {
          host: '203.0.113.10',
          user: 'researcher',
          localForwards: [],
        },
      }),
    );
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(storage, runner, { now: () => NOW });
    const created = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace/research-project',
      permissionMode: 'workspace',
      confirmWorkspaceRisk: true,
    });
    const trusted = await service.enableTrustedWorkspace({
      projectId: PROJECT_ID,
      grantId: created.id,
      expectedVersion: created.version,
      confirmTrustedWorkspaceRisk: true,
      confirmNoRemoteSandbox: true,
    });
    await service.updateConnection({
      connectionId: CONNECTION_ID,
      expectedVersion: 1,
      label: 'Fixture GPU changed',
      hostAlias: 'fixture-gpu-changed',
    });
    await expect(service.listWorkspaceGrants(PROJECT_ID)).resolves.toMatchObject([
      { grant: { id: trusted.id, trustedAccess: null } },
    ]);

    const approval = nextApproval(service);
    const execution = service.runAgentWorkspaceCommand(workspaceCommandFixture(trusted));
    const request = await approval;
    expect(execute).not.toHaveBeenCalled();
    service.resolveApproval({ approvalId: request.id, decision: 'deny' });
    await expect(execution).rejects.toMatchObject({ code: 'ssh_approval_denied' });
    expect(storage.trustedWorkspaceAudit).toEqual([]);
  });

  it('fails closed before transport when the trusted-operation audit cannot be stored', async () => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: {
          host: '203.0.113.10',
          user: 'researcher',
          localForwards: [],
        },
      }),
    );
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(storage, runner, { now: () => NOW });
    const created = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace/research-project',
      permissionMode: 'workspace',
      confirmWorkspaceRisk: true,
    });
    const trusted = await service.enableTrustedWorkspace({
      projectId: PROJECT_ID,
      grantId: created.id,
      expectedVersion: created.version,
      confirmTrustedWorkspaceRisk: true,
      confirmNoRemoteSandbox: true,
    });
    vi.spyOn(storage, 'appendSshTrustedWorkspaceAudit').mockReturnValue(false);

    await expect(
      service.runAgentWorkspaceCommand(workspaceCommandFixture(trusted)),
    ).rejects.toMatchObject({ code: 'ssh_trusted_workspace_audit_failed' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('reserves per-turn and global trusted capacity before delayed audits complete', async () => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: {
          host: '203.0.113.10',
          user: 'researcher',
          localForwards: [],
        },
      }),
    );
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(storage, runner, { now: () => NOW });
    const created = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace/research-project',
      permissionMode: 'workspace',
      confirmWorkspaceRisk: true,
    });
    const trusted = await service.enableTrustedWorkspace({
      projectId: PROJECT_ID,
      grantId: created.id,
      expectedVersion: created.version,
      confirmTrustedWorkspaceRisk: true,
      confirmNoRemoteSandbox: true,
    });
    const firstAuditStarted = deferredSignal();
    const fourAuditsStarted = deferredSignal();
    const releaseAudit = deferredSignal();
    let auditStarts = 0;
    vi.spyOn(storage, 'appendSshTrustedWorkspaceAudit').mockImplementation(async (record) => {
      auditStarts += 1;
      if (auditStarts === 1) firstAuditStarted.resolve();
      if (auditStarts === 4) fourAuditsStarted.resolve();
      await releaseAudit.promise;
      storage.trustedWorkspaceAudit.push(record);
      return true;
    });

    const first = service.runAgentWorkspaceCommand(
      workspaceCommandFixture(trusted, { toolCallId: 'trusted-tool-a' }),
    );
    await firstAuditStarted.promise;
    await expect(
      service.runAgentWorkspaceCommand(
        workspaceCommandFixture(trusted, { toolCallId: 'trusted-tool-b' }),
      ),
    ).rejects.toMatchObject({ code: 'ssh_capacity_exceeded' });
    expect(execute).not.toHaveBeenCalled();

    const otherTurns = ['b', 'c', 'd'].map((suffix) =>
      service.runAgentWorkspaceCommand(
        workspaceCommandFixture(trusted, {
          turnId: `trusted-turn-${suffix}`,
          toolCallId: `trusted-tool-${suffix}`,
        }),
      ),
    );
    await fourAuditsStarted.promise;
    await expect(
      service.runAgentWorkspaceCommand(
        workspaceCommandFixture(trusted, {
          turnId: 'trusted-turn-over-global-cap',
          toolCallId: 'trusted-tool-over-global-cap',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ssh_capacity_exceeded' });

    releaseAudit.resolve();
    await expect(Promise.all([first, ...otherTurns])).resolves.toHaveLength(4);
    expect(storage.trustedWorkspaceAudit).toHaveLength(4);
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('cancels a trusted reservation during delayed audit and never starts it later', async () => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: {
          host: '203.0.113.10',
          user: 'researcher',
          localForwards: [],
        },
      }),
    );
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(storage, runner, { now: () => NOW });
    const created = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace/research-project',
      permissionMode: 'workspace',
      confirmWorkspaceRisk: true,
    });
    const trusted = await service.enableTrustedWorkspace({
      projectId: PROJECT_ID,
      grantId: created.id,
      expectedVersion: created.version,
      confirmTrustedWorkspaceRisk: true,
      confirmNoRemoteSandbox: true,
    });
    const auditStarted = deferredSignal();
    const releaseAudit = deferredSignal();
    const auditFinished = deferredSignal();
    vi.spyOn(storage, 'appendSshTrustedWorkspaceAudit').mockImplementation(async (record) => {
      auditStarted.resolve();
      await releaseAudit.promise;
      storage.trustedWorkspaceAudit.push(record);
      auditFinished.resolve();
      return true;
    });

    const execution = service.runAgentWorkspaceCommand(workspaceCommandFixture(trusted));
    await auditStarted.promise;
    expect(service.cancelSession(PROJECT_ID, SESSION_A)).toBe(1);
    await expect(execution).rejects.toMatchObject({ code: 'ssh_cancelled' });

    releaseAudit.resolve();
    await auditFinished.promise;
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
  });

  it('cancels a trusted reservation on shutdown and never starts it after delayed audit', async () => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: {
          host: '203.0.113.10',
          user: 'researcher',
          localForwards: [],
        },
      }),
    );
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(storage, runner, { now: () => NOW });
    const created = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace/research-project',
      permissionMode: 'workspace',
      confirmWorkspaceRisk: true,
    });
    const trusted = await service.enableTrustedWorkspace({
      projectId: PROJECT_ID,
      grantId: created.id,
      expectedVersion: created.version,
      confirmTrustedWorkspaceRisk: true,
      confirmNoRemoteSandbox: true,
    });
    const auditStarted = deferredSignal();
    const releaseAudit = deferredSignal();
    const auditFinished = deferredSignal();
    vi.spyOn(storage, 'appendSshTrustedWorkspaceAudit').mockImplementation(async (record) => {
      auditStarted.resolve();
      await releaseAudit.promise;
      storage.trustedWorkspaceAudit.push(record);
      auditFinished.resolve();
      return true;
    });

    const execution = service.runAgentWorkspaceCommand(workspaceCommandFixture(trusted));
    await auditStarted.promise;
    expect(service.shutdown()).toBe(1);
    await expect(execution).rejects.toMatchObject({ code: 'ssh_cancelled' });

    releaseAudit.resolve();
    await auditFinished.promise;
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
    await expect(
      service.runAgentWorkspaceCommand(
        workspaceCommandFixture(trusted, { toolCallId: 'after-shutdown' }),
      ),
    ).rejects.toMatchObject({ code: 'ssh_unavailable' });
  });

  it('does not permit trusted workspace mode for root SSH accounts', async () => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: { host: '203.0.113.10', user: 'root', localForwards: [] },
      }),
    );
    const { runner } = runnerFixture();
    const service = new SshConnectionService(storage, runner, { now: () => NOW });
    const grant = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/root/research-project',
      permissionMode: 'workspace',
      confirmWorkspaceRisk: true,
    });
    await expect(
      service.enableTrustedWorkspace({
        projectId: PROJECT_ID,
        grantId: grant.id,
        expectedVersion: grant.version,
        confirmTrustedWorkspaceRisk: true,
        confirmNoRemoteSandbox: true,
      }),
    ).rejects.toMatchObject({ code: 'ssh_trusted_workspace_not_allowed' });
  });

  it('binds a root workspace command to exact grant, root, cwd, hash, and fresh approval', async () => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: { host: '203.0.113.10', user: 'root', port: 2222, localForwards: [] },
      }),
    );
    const { runner, execute } = runnerFixture({ stdout: ' M src/model.py\n' });
    const service = new SshConnectionService(storage, runner, { now: () => NOW });
    const grant = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/root/research-project',
      permissionMode: 'workspace',
      confirmWorkspaceRisk: true,
    });
    const approval = nextApproval(service);
    const execution = service.runAgentWorkspaceCommand(
      workspaceCommandFixture(grant, {
        args: ['--no-pager', 'diff', '--stat'],
        workspaceSubdirectory: 'packages/app',
      }),
    );
    const request = await approval;

    expect(execute).not.toHaveBeenCalled();
    expect(request).toMatchObject({
      executionMode: 'remote_workspace',
      targetDisplay: 'root@203.0.113.10:2222',
      privilegeClass: 'root',
      rootLogin: true,
      workspaceGrantId: grant.id,
      workspaceGrantVersion: 1,
      workspaceRoot: '/root/research-project',
      workspaceWorkingDirectory: '/root/research-project/packages/app',
      workspaceOperation: 'inspect',
      connectionVersion: 1,
      commandSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(request.commandPreview).toContain("'core.fsmonitor=false'");
    expect(request.commandPreview).toContain("'core.hooksPath=/dev/null'");
    expect(request.commandPreview).toContain("'--no-ext-diff'");
    expect(request.commandPreview).toContain("'--no-textconv'");
    expect(request.commandPreview).toContain("cd '/root/research-project/packages/app'");
    service.resolveApproval({ approvalId: request.id, decision: 'allow_once' });

    await expect(execution).resolves.toMatchObject({ stdout: ' M src/model.py\n' });
    expect(execute).toHaveBeenCalledWith(
      'fixture-gpu',
      expect.objectContaining({
        args: expect.arrayContaining([
          '-c',
          'core.fsmonitor=false',
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--stat',
        ]),
        workingDirectory: '/root/research-project/packages/app',
      }),
      expect.any(Object),
      expect.objectContaining({ user: 'root', host: '203.0.113.10', port: 2222 }),
    );
  });

  it('runs a bounded foreground Python experiment only after a fresh Allow once decision', async () => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: {
          host: '203.0.113.10',
          user: 'researcher',
          localForwards: [],
        },
      }),
    );
    const { runner, execute } = runnerFixture({ stdout: 'metric=0.91\n' });
    const service = new SshConnectionService(storage, runner, { now: () => NOW });
    const grant = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace/research-project',
      permissionMode: 'workspace',
      confirmWorkspaceRisk: true,
    });
    const approval = nextApproval(service);
    const execution = service.runAgentWorkspaceCommand(
      workspaceCommandFixture(grant, {
        command: '/usr/bin/python3',
        args: ['-u', 'experiments/train.py'],
        workspaceSubdirectory: 'model',
        timeoutSeconds: 120,
      }),
    );
    const request = await approval;

    expect(execute).not.toHaveBeenCalled();
    expect(request).toMatchObject({
      executionMode: 'remote_workspace',
      workspaceRoot: '/workspace/research-project',
      workspaceWorkingDirectory: '/workspace/research-project/model',
      workspaceOperation: 'experiment',
      commandPreview: expect.stringContaining("'/usr/bin/python3' '-u' 'experiments/train.py'"),
    });

    service.resolveApproval({ approvalId: request.id, decision: 'allow_once' });

    await expect(execution).resolves.toMatchObject({ stdout: 'metric=0.91\n' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      'fixture-gpu',
      expect.objectContaining({
        command: '/usr/bin/python3',
        args: ['-u', 'experiments/train.py'],
        workingDirectory: '/workspace/research-project/model',
        timeoutSeconds: 120,
      }),
      expect.any(Object),
      expect.objectContaining({ user: 'researcher', host: '203.0.113.10' }),
    );
  });

  it('creates one reviewed text file through the fixed helper only after Allow once', async () => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: {
          host: '203.0.113.10',
          user: 'researcher',
          localForwards: [],
        },
      }),
    );
    const helperResult = JSON.stringify({
      schemaVersion: 1,
      action: 'write',
      relativePath: 'experiments/linear_fit.py',
      created: true,
      previousSha256: null,
      contentSha256: 'b'.repeat(64),
      sizeBytes: 20,
    });
    const { runner, execute, executeWorkspaceFileHelper } = runnerFixture({ stdout: helperResult });
    const service = new SshConnectionService(storage, runner, { now: () => NOW });
    const grant = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace/research-project',
      permissionMode: 'workspace',
      confirmWorkspaceRisk: true,
    });
    const approvalPromise = nextApproval(service);
    const execution = service.runAgentWorkspaceFileOperation(workspaceFileWriteFixture(grant));
    const approval = await approvalPromise;

    expect(execute).not.toHaveBeenCalled();
    expect(approval).toMatchObject({
      executionMode: 'remote_workspace',
      workspaceRoot: '/workspace/research-project',
      workspaceWorkingDirectory: '/workspace/research-project',
      workspaceOperation: 'edit',
      workspaceFileAction: 'create',
      workspaceFilePath: 'experiments/linear_fit.py',
      workspaceFileContentSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      commandSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(approval.commandPreview).toContain('CREATE WORKSPACE TEXT FILE');
    expect(approval.commandPreview).not.toContain('print("metric=1.0")');
    expect(approval.commandPreview).not.toContain('python3');
    expect(approval.workspaceFileContent).toBe('print("metric=1.0")\n');

    service.resolveApproval({ approvalId: approval.id, decision: 'allow_once' });
    await expect(execution).resolves.toMatchObject({ stdout: helperResult });
    expect(execute).not.toHaveBeenCalled();
    expect(executeWorkspaceFileHelper).toHaveBeenCalledWith(
      'fixture-gpu',
      expect.objectContaining({
        command: '/usr/bin/python3',
        args: expect.arrayContaining(['-I', '-S', '-c']),
      }),
      expect.stringContaining('experiments/linear_fit.py'),
      expect.objectContaining({ failOnOutputLimit: false }),
      expect.objectContaining({ user: 'researcher', host: '203.0.113.10' }),
    );
  });

  it('rejects remote file access without an explicit workspace-mode grant', async () => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: { host: '203.0.113.10', user: 'researcher', localForwards: [] },
      }),
    );
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(storage, runner);
    const grant = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace',
      permissionMode: 'diagnostics',
      confirmWorkspaceRisk: true,
    });

    await expect(
      service.runAgentWorkspaceFileOperation(workspaceFileWriteFixture(grant)),
    ).rejects.toMatchObject({ code: 'ssh_workspace_file_not_allowed' });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { workspaceSubdirectory: '../outside' },
    { command: '/bin/bash', args: ['-lc', 'touch owned'] },
    { command: '/usr/bin/git', args: ['clean', '-fdx'] },
    { command: '/usr/bin/python3', args: ['-c', 'print(1)'] },
  ])('rejects forged or escaping workspace command before approval', async (override) => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: { host: '203.0.113.10', user: 'researcher', localForwards: [] },
      }),
    );
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(storage, runner);
    const grant = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace',
      permissionMode: 'workspace',
      confirmWorkspaceRisk: true,
    });

    await expect(
      service.runAgentWorkspaceCommand(workspaceCommandFixture(grant, override)),
    ).rejects.toMatchObject({ code: 'ssh_workspace_command_not_allowed' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('revalidates the exact grant version immediately after approval', async () => {
    const storage = new MemorySshStorage(
      connectionFixture({
        directTarget: { host: '203.0.113.10', user: 'researcher', localForwards: [] },
      }),
    );
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(storage, runner);
    const grant = await service.createWorkspaceGrant({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      canonicalRoot: '/workspace',
      permissionMode: 'diagnostics',
      confirmWorkspaceRisk: true,
    });
    const approval = nextApproval(service);
    const execution = service.runAgentWorkspaceCommand(workspaceCommandFixture(grant));
    const request = await approval;
    storage.workspaceGrants.set(grant.id, { ...grant, version: 2 });

    service.resolveApproval({ approvalId: request.id, decision: 'allow_once' });
    await expect(execution).rejects.toMatchObject({ code: 'ssh_workspace_grant_conflict' });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['grant update', 'grant removal', 'connection update', 'connection removal'] as const)(
    'waits for an in-flight %s before post-approval revalidation and never starts the runner',
    async (mutationKind) => {
      const profile = connectionFixture({
        directTarget: {
          host: '203.0.113.10',
          user: 'researcher',
          port: 2222,
          localForwards: [],
        },
      });
      const storage = new MemorySshStorage(profile);
      const { runner, execute } = runnerFixture();
      const service = new SshConnectionService(storage, runner);
      const grant = await service.createWorkspaceGrant({
        projectId: PROJECT_ID,
        connectionId: CONNECTION_ID,
        canonicalRoot: '/workspace',
        permissionMode: 'diagnostics',
        confirmWorkspaceRisk: true,
      });
      const approvalPromise = nextApproval(service);
      const execution = service.runAgentWorkspaceCommand(workspaceCommandFixture(grant));
      const settledExecution = execution.catch((error: unknown) => error);
      const approval = await approvalPromise;
      const mutationStarted = deferredSignal();
      const releaseMutation = deferredSignal();
      let mutation: Promise<unknown>;

      if (mutationKind === 'grant update') {
        const original = storage.updateSshWorkspaceGrant.bind(storage);
        vi.spyOn(storage, 'updateSshWorkspaceGrant').mockImplementationOnce(
          async (nextGrant, expectedVersion) => {
            mutationStarted.resolve();
            await releaseMutation.promise;
            return original(nextGrant, expectedVersion);
          },
        );
        mutation = service.updateWorkspaceGrant({
          grantId: grant.id,
          projectId: PROJECT_ID,
          expectedVersion: grant.version,
          canonicalRoot: '/workspace/changed',
          permissionMode: 'diagnostics',
          confirmWorkspaceRisk: true,
        });
      } else if (mutationKind === 'grant removal') {
        const original = storage.removeSshWorkspaceGrant.bind(storage);
        vi.spyOn(storage, 'removeSshWorkspaceGrant').mockImplementationOnce(
          async (projectId, grantId, expectedVersion) => {
            mutationStarted.resolve();
            await releaseMutation.promise;
            return original(projectId, grantId, expectedVersion);
          },
        );
        mutation = service.removeWorkspaceGrant({
          grantId: grant.id,
          projectId: PROJECT_ID,
          expectedVersion: grant.version,
        });
      } else if (mutationKind === 'connection update') {
        const original = storage.updateSshConnection.bind(storage);
        vi.spyOn(storage, 'updateSshConnection').mockImplementationOnce(
          async (nextProfile, expectedVersion) => {
            mutationStarted.resolve();
            await releaseMutation.promise;
            return original(nextProfile, expectedVersion);
          },
        );
        mutation = service.updateConnection({
          connectionId: profile.id,
          expectedVersion: profile.version,
          label: 'Renamed fixture GPU',
          hostAlias: profile.hostAlias,
        });
      } else {
        const original = storage.removeSshConnection.bind(storage);
        vi.spyOn(storage, 'removeSshConnection').mockImplementationOnce(
          async (connectionId, expectedVersion) => {
            mutationStarted.resolve();
            await releaseMutation.promise;
            return original(connectionId, expectedVersion);
          },
        );
        mutation = service.removeConnection({
          connectionId: profile.id,
          expectedVersion: profile.version,
        });
      }

      await mutationStarted.promise;
      service.resolveApproval({ approvalId: approval.id, decision: 'allow_once' });
      await Promise.resolve();
      await Promise.resolve();
      expect(execute).not.toHaveBeenCalled();

      releaseMutation.resolve();
      await mutation;
      const executionError = await settledExecution;
      expect(executionError).toMatchObject({
        code:
          mutationKind === 'connection update'
            ? 'ssh_connection_version_conflict'
            : 'ssh_cancelled',
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('imports a normalized direct target idempotently and preserves an existing custom label', async () => {
    const storage = new MemorySshStorage(null);
    const { runner } = runnerFixture();
    const service = new SshConnectionService(storage, runner, { now: () => NOW });
    const command = 'ssh -p 2222 researcher@203.0.113.10 -L 8080:localhost:8080';

    const created = await service.importCommand({ label: 'Private label', command });
    expect(created).toMatchObject({
      label: 'Private label',
      hostAlias: 'direct-203.0.113.10-2222',
      version: 1,
      directTarget: {
        host: '203.0.113.10',
        user: 'researcher',
        port: 2222,
        localForwards: [{ bindAddress: '127.0.0.1', localPort: 8080 }],
      },
    });

    await expect(service.importCommand({ command })).resolves.toEqual(created);
    expect(storage.profiles.size).toBe(1);
    expect(JSON.stringify([...storage.profiles.values()])).not.toContain('ssh -p');
  });

  it('uses distinct opaque default labels instead of exposing imported endpoints to the model', async () => {
    const storage = new MemorySshStorage(null);
    const { runner } = runnerFixture();
    const service = new SshConnectionService(storage, runner, { now: () => NOW });

    const first = await service.importCommand({
      command: 'ssh -p 2222 researcher@203.0.113.10',
    });
    const second = await service.importCommand({
      command: 'ssh -p 2223 researcher@203.0.113.11',
    });

    expect(first.label).toBe('Imported SSH server');
    expect(second.label).toBe('Imported SSH server 2');
    expect(`${first.label} ${second.label}`).not.toContain('203.0.113');
  });

  it('restricts an imported root login to non-file diagnostics and labels the exact approval target', async () => {
    const profile = connectionFixture({
      hostAlias: 'direct-203.0.113.10-2222',
      directTarget: {
        host: '203.0.113.10',
        user: 'root',
        port: 2222,
        localForwards: [],
      },
    });
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(new MemorySshStorage(profile), runner);

    for (const command of ['/usr/bin/cat', '/usr/bin/head', '/usr/bin/grep', '/usr/bin/ps']) {
      await expect(service.runAgentCommand(commandFixture({ command, args: [] }))).rejects.toEqual(
        expect.objectContaining<Partial<SshConnectionServiceError>>({
          code: 'ssh_command_not_allowed',
        }),
      );
    }
    expect(execute).not.toHaveBeenCalled();

    const approvalPromise = nextApproval(service);
    const execution = service.runAgentCommand(commandFixture());
    const approval = await approvalPromise;
    expect(approval).toMatchObject({
      targetDisplay: 'root@203.0.113.10:2222',
      rootLogin: true,
    });
    service.resolveApproval({ approvalId: approval.id, decision: 'deny' });
    await expect(execution).rejects.toMatchObject({ code: 'ssh_approval_denied' });
  });

  it('revalidates a direct target version after approval before starting the transport', async () => {
    const profile = connectionFixture({
      directTarget: {
        host: '203.0.113.10',
        user: 'researcher',
        port: 2222,
        localForwards: [],
      },
    });
    const storage = new MemorySshStorage(profile);
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(storage, runner);
    const approvalPromise = nextApproval(service);
    const execution = service.runAgentCommand(commandFixture());
    const approval = await approvalPromise;
    storage.profiles.set(profile.id, {
      ...profile,
      version: 2,
      directTarget: { ...profile.directTarget!, host: '203.0.113.11' },
    });

    service.resolveApproval({ approvalId: approval.id, decision: 'allow_once' });

    await expect(execution).rejects.toMatchObject({ code: 'ssh_connection_version_conflict' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not execute before a single-use Allow once decision', async () => {
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(new MemorySshStorage(), runner, { now: () => NOW });
    const approval = nextApproval(service);
    const execution = service.runAgentCommand(commandFixture());
    const request = await approval;

    expect(execute).not.toHaveBeenCalled();
    expect(request).toMatchObject({
      projectId: PROJECT_ID,
      sessionId: SESSION_A,
      attemptId: ATTEMPT_ID,
      turnId: 'turn-fixture',
      toolCallId: 'tool-call-fixture',
      connectionId: CONNECTION_ID,
      connectionLabel: 'Fixture GPU',
      hostAlias: 'fixture-gpu',
    });
    expect(request.commandPreview).toBe("exec '/usr/bin/nvidia-smi' '--query-gpu=name'");
    expect(service.resolveApproval({ approvalId: request.id, decision: 'allow_once' })).toEqual({
      outcome: 'allowed',
    });

    await expect(execution).resolves.toMatchObject({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Fixture GPU',
      stdout: 'Fixture GPU\n',
      commandSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(() =>
      service.resolveApproval({ approvalId: request.id, decision: 'allow_once' }),
    ).toThrow(expect.objectContaining({ code: 'ssh_approval_not_found' }));
  });

  it('fails closed when its Main-owned scope is revoked during connection lookup', async () => {
    const storage = new MemorySshStorage();
    let releaseLookup!: (profiles: SshConnectionProfile[]) => void;
    vi.spyOn(storage, 'listSshConnections').mockImplementationOnce(
      () =>
        new Promise<SshConnectionProfile[]>((resolve) => {
          releaseLookup = resolve;
        }),
    );
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(storage, runner);
    const events = vi.fn();
    service.on('event', events);
    const controller = new AbortController();
    const execution = service.runAgentCommand(commandFixture(), controller.signal);
    await vi.waitFor(() => expect(storage.listSshConnections).toHaveBeenCalledOnce());

    controller.abort();
    releaseLookup([connectionFixture()]);

    await expect(execution).rejects.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({ code: 'ssh_cancelled' }),
    );
    expect(events).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a pre-aborted scope before reading connection state', async () => {
    const storage = new MemorySshStorage();
    const listConnections = vi.spyOn(storage, 'listSshConnections');
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(storage, runner);
    const controller = new AbortController();
    controller.abort();

    await expect(service.runAgentCommand(commandFixture(), controller.signal)).rejects.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({ code: 'ssh_cancelled' }),
    );
    expect(listConnections).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('cancels a pending approval when its caller aborts and removes the signal listener', async () => {
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(new MemorySshStorage(), runner);
    const controller = new AbortController();
    const removeAbortListener = vi.spyOn(controller.signal, 'removeEventListener');
    const approval = nextApproval(service);
    const execution = service.runAgentCommand(commandFixture(), controller.signal);
    const request = await approval;

    controller.abort();

    await expect(execution).rejects.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({ code: 'ssh_cancelled' }),
    );
    expect(removeAbortListener).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(() =>
      service.resolveApproval({ approvalId: request.id, decision: 'allow_once' }),
    ).toThrow(expect.objectContaining({ code: 'ssh_approval_not_found' }));
  });

  it('links caller abort to an approved transport and cleans the listener after settlement', async () => {
    let runnerSignal: AbortSignal | undefined;
    const execute = vi.fn(
      async (
        _hostAlias: string,
        _command: SshAgentCommand,
        options?: SshCommandRunOptions,
      ): Promise<SshProcessResult> => {
        runnerSignal = options?.signal;
        if (!runnerSignal) throw new Error('missing abort signal');
        return new Promise<SshProcessResult>((_resolve, reject) => {
          runnerSignal!.addEventListener(
            'abort',
            () => reject(new SshCommandRunnerError('cancelled')),
            { once: true },
          );
        });
      },
    );
    const runner = vi.fn() as unknown as SshCommandRunner;
    runner.execute = execute;
    runner.testConnection = vi.fn(async () => undefined);
    const service = new SshConnectionService(new MemorySshStorage(), runner);
    const controller = new AbortController();
    const removeAbortListener = vi.spyOn(controller.signal, 'removeEventListener');
    const approval = nextApproval(service);
    const execution = service.runAgentCommand(commandFixture(), controller.signal);
    const request = await approval;
    service.resolveApproval({ approvalId: request.id, decision: 'allow_once' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());

    controller.abort();

    await expect(execution).rejects.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({ code: 'ssh_cancelled' }),
    );
    expect(runnerSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(removeAbortListener).toHaveBeenCalledOnce());
  });

  it('does not call the runner when its caller aborts during approved connection revalidation', async () => {
    const storage = new MemorySshStorage();
    let releaseRevalidation!: (profiles: SshConnectionProfile[]) => void;
    const listConnections = vi
      .spyOn(storage, 'listSshConnections')
      .mockImplementationOnce(() => [connectionFixture()])
      .mockImplementationOnce(
        () =>
          new Promise<SshConnectionProfile[]>((resolve) => {
            releaseRevalidation = resolve;
          }),
      );
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(storage, runner);
    const controller = new AbortController();
    const removeAbortListener = vi.spyOn(controller.signal, 'removeEventListener');
    const approval = nextApproval(service);
    const execution = service.runAgentCommand(commandFixture(), controller.signal);
    const request = await approval;
    service.resolveApproval({ approvalId: request.id, decision: 'allow_once' });
    await vi.waitFor(() => expect(listConnections).toHaveBeenCalledTimes(2));

    controller.abort();

    await expect(execution).rejects.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({ code: 'ssh_cancelled' }),
    );
    releaseRevalidation([connectionFixture()]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(execute).not.toHaveBeenCalled();
    expect(removeAbortListener).toHaveBeenCalledOnce();
  });

  it('keeps an active caller abort terminal when a signal-ignoring runner later succeeds', async () => {
    let finishRunner!: (result: SshProcessResult) => void;
    const { runner, execute } = runnerFixture();
    execute.mockImplementationOnce(
      () =>
        new Promise<SshProcessResult>((resolve) => {
          finishRunner = resolve;
        }),
    );
    const service = new SshConnectionService(new MemorySshStorage(), runner);
    const controller = new AbortController();
    const removeAbortListener = vi.spyOn(controller.signal, 'removeEventListener');
    const approval = nextApproval(service);
    const execution = service.runAgentCommand(commandFixture(), controller.signal);
    const request = await approval;
    service.resolveApproval({ approvalId: request.id, decision: 'allow_once' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());

    controller.abort();

    await expect(execution).rejects.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({ code: 'ssh_cancelled' }),
    );
    finishRunner({
      exitCode: 0,
      stdout: 'late success',
      stderr: '',
      truncated: false,
      durationMs: 10,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(removeAbortListener).toHaveBeenCalledOnce();
  });

  it('lets abort win when runner success is queued but not yet observed by the service', async () => {
    let finishRunner!: (result: SshProcessResult) => void;
    const { runner, execute } = runnerFixture();
    execute.mockImplementationOnce(
      () =>
        new Promise<SshProcessResult>((resolve) => {
          finishRunner = resolve;
        }),
    );
    const service = new SshConnectionService(new MemorySshStorage(), runner);
    const controller = new AbortController();
    const approval = nextApproval(service);
    const execution = service.runAgentCommand(commandFixture(), controller.signal);
    const request = await approval;
    service.resolveApproval({ approvalId: request.id, decision: 'allow_once' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());

    finishRunner({
      exitCode: 0,
      stdout: 'queued success',
      stderr: '',
      truncated: false,
      durationMs: 10,
    });
    controller.abort();

    await expect(execution).rejects.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({ code: 'ssh_cancelled' }),
    );
  });

  it('denies without executing and has no raw-output persistence method', async () => {
    const { runner, execute } = runnerFixture();
    const storage = new MemorySshStorage();
    const service = new SshConnectionService(storage, runner, { now: () => NOW });
    const approval = nextApproval(service);
    const execution = service.runAgentCommand(commandFixture());
    const rejection = execution.catch((error: unknown) => error);
    const request = await approval;

    service.resolveApproval({ approvalId: request.id, decision: 'deny' });
    await expect(rejection).resolves.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({ code: 'ssh_approval_denied' }),
    );
    expect(execute).not.toHaveBeenCalled();
    expect('saveSshOutput' in storage).toBe(false);
  });

  it('expires unanswered approvals without executing', async () => {
    vi.useFakeTimers();
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(new MemorySshStorage(), runner, {
      now: () => NOW,
      approvalTimeoutMs: 100,
    });
    const approval = nextApproval(service);
    const execution = service.runAgentCommand(commandFixture());
    const rejection = execution.catch((error: unknown) => error);
    await approval;

    await vi.advanceTimersByTimeAsync(101);
    await expect(rejection).resolves.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({ code: 'ssh_approval_expired' }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('defaults approval recovery to a five-minute TTL', async () => {
    const { runner } = runnerFixture();
    const service = new SshConnectionService(new MemorySshStorage(), runner, { now: () => NOW });
    const approval = nextApproval(service);
    const rejection = service.runAgentCommand(commandFixture()).catch((error: unknown) => error);
    const request = await approval;

    expect(Date.parse(request.expiresAt) - Date.parse(request.requestedAt)).toBe(
      SSH_APPROVAL_DEFAULT_TTL_MS,
    );
    service.resolveApproval({ approvalId: request.id, decision: 'deny' });
    await rejection;
  });

  it('recovers copied, unexpired approvals for only the exact project and session scope', async () => {
    let now = NOW;
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(new MemorySshStorage(), runner, { now: () => now });
    const requests: SshApprovalRequest[] = [];
    const resolvedEvents: Array<{ approvalId: string; outcome: string }> = [];
    service.on('event', (event) => {
      if (event.type === 'approval.requested') requests.push(event.request);
      else resolvedEvents.push(event);
    });
    const executionA = service.runAgentCommand(commandFixture()).catch((error: unknown) => error);
    const executionB = service
      .runAgentCommand(commandFixture({ sessionId: SESSION_B }))
      .catch((error: unknown) => error);
    const executionOtherProject = service
      .runAgentCommand(commandFixture({ projectId: OTHER_PROJECT_ID }))
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(requests).toHaveLength(3));

    const recovered = service.listPendingApprovals(PROJECT_ID, SESSION_A);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ projectId: PROJECT_ID, sessionId: SESSION_A });
    (recovered[0] as { connectionLabel: string }).connectionLabel = 'mutated renderer copy';
    expect(service.listPendingApprovals(PROJECT_ID, SESSION_A)[0]?.connectionLabel).toBe(
      'Fixture GPU',
    );
    expect(service.listPendingApprovals(PROJECT_ID, SESSION_B)).toHaveLength(1);
    expect(service.listPendingApprovals(OTHER_PROJECT_ID, SESSION_A)).toHaveLength(1);

    now = new Date(NOW.getTime() + SSH_APPROVAL_DEFAULT_TTL_MS);
    expect(service.listPendingApprovals(PROJECT_ID, SESSION_A)).toEqual([]);
    await expect(executionA).resolves.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({ code: 'ssh_approval_expired' }),
    );
    expect(resolvedEvents).toContainEqual({
      type: 'approval.resolved',
      approvalId: recovered[0]!.id,
      outcome: 'expired',
    });

    now = NOW;
    for (const request of requests.filter((candidate) => candidate.id !== recovered[0]!.id)) {
      service.resolveApproval({ approvalId: request.id, decision: 'deny' });
    }
    await Promise.all([executionB, executionOtherProject]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('cancels only approvals belonging to the requested project session', async () => {
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(new MemorySshStorage(), runner, { now: () => NOW });
    const requests: SshApprovalRequest[] = [];
    service.on('event', (event) => {
      if (event.type === 'approval.requested') requests.push(event.request);
    });
    const executionA = service.runAgentCommand(commandFixture());
    const executionB = service.runAgentCommand(commandFixture({ sessionId: SESSION_B }));
    const rejectionA = executionA.catch((error: unknown) => error);
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(service.cancelSession(PROJECT_ID, SESSION_A)).toBe(1);
    const requestB = requests.find((request) => request.sessionId === SESSION_B)!;
    service.resolveApproval({ approvalId: requestB.id, decision: 'allow_once' });

    await expect(rejectionA).resolves.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({
        code: 'ssh_approval_cancelled',
      }),
    );
    await expect(executionB).resolves.toMatchObject({ exitCode: 0 });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('aborts an approved session transport without affecting another session', async () => {
    const signals = new Map<string, AbortSignal>();
    const execute = vi.fn(
      async (
        _hostAlias: string,
        command: SshAgentCommand,
        options?: SshCommandRunOptions,
      ): Promise<SshProcessResult> => {
        const signal = options?.signal;
        if (!signal) throw new Error('missing abort signal');
        signals.set(command.sessionId, signal);
        return new Promise<SshProcessResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new SshCommandRunnerError('cancelled')), {
            once: true,
          });
        });
      },
    );
    const testConnection = vi.fn(async () => undefined);
    const runner = vi.fn() as unknown as SshCommandRunner;
    runner.execute = execute;
    runner.testConnection = testConnection;
    const service = new SshConnectionService(new MemorySshStorage(), runner, { now: () => NOW });
    const requests: SshApprovalRequest[] = [];
    service.on('event', (event) => {
      if (event.type === 'approval.requested') requests.push(event.request);
    });

    const executionA = service.runAgentCommand(commandFixture({ sessionId: SESSION_A }));
    const executionB = service.runAgentCommand(
      commandFixture({
        sessionId: SESSION_B,
        attemptId: '66666666-6666-4666-8666-666666666666',
        turnId: 'turn-session-b',
      }),
    );
    const rejectionA = executionA.catch((error: unknown) => error);
    const rejectionB = executionB.catch((error: unknown) => error);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    for (const request of requests) {
      service.resolveApproval({ approvalId: request.id, decision: 'allow_once' });
    }
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));

    expect(service.cancelSession(PROJECT_ID, SESSION_A)).toBe(1);
    expect(signals.get(SESSION_A)?.aborted).toBe(true);
    expect(signals.get(SESSION_B)?.aborted).toBe(false);
    expect(service.cancelSession(PROJECT_ID, SESSION_B)).toBe(1);

    await expect(rejectionA).resolves.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({ code: 'ssh_cancelled' }),
    );
    await expect(rejectionB).resolves.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({ code: 'ssh_cancelled' }),
    );
  });

  it('can revoke exactly one attempt/turn/tool-call capability', async () => {
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(new MemorySshStorage(), runner);
    const requests: SshApprovalRequest[] = [];
    service.on('event', (event) => {
      if (event.type === 'approval.requested') requests.push(event.request);
    });
    const executionA = service.runAgentCommand(commandFixture({ toolCallId: 'tool-call-a' }));
    const executionB = service.runAgentCommand(commandFixture({ toolCallId: 'tool-call-b' }));
    const rejectionA = executionA.catch((error: unknown) => error);
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(
      service.cancelExecution({
        projectId: PROJECT_ID,
        sessionId: SESSION_A,
        attemptId: ATTEMPT_ID,
        turnId: 'turn-fixture',
        toolCallId: 'tool-call-a',
      }),
    ).toBe(1);
    service.resolveApproval({
      approvalId: requests.find((request) => request.toolCallId === 'tool-call-b')!.id,
      decision: 'allow_once',
    });

    await expect(rejectionA).resolves.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({
        code: 'ssh_approval_cancelled',
      }),
    );
    await expect(executionB).resolves.toMatchObject({ exitCode: 0 });
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each([
    ['rm', []],
    ['/bin/bash', []],
    ['sudo', []],
    ['python3', ['-c', "open('/tmp/result', 'w')"]],
    ['node', ['--eval', "require('fs').rmSync('/tmp/result')"]],
    ['find', ['/tmp', '-delete']],
    ['git', ['clean', '-fdx']],
    ['docker', ['run', 'fixture-image']],
    ['env', ['python3', '-c', "open('/tmp/result', 'w')"]],
    ['/usr/bin/setsid', ['/bin/sh', '-c', 'touch /tmp/result']],
    ['/usr/bin/awk', ['BEGIN { system("touch /tmp/result") }']],
    ['/usr/bin/make', ['fixture-target']],
    ['/usr/bin/file', ['--compile', '-m', '/tmp/fixture.magic']],
    ['/tmp/nvidia-smi', ['--query-gpu=name']],
    ['/usr/bin/truncate', ['-s', '0', '/tmp/result']],
    ['/usr/bin/nvidia-smi', ['--gpu-reset']],
    ['/usr/bin/hostname', ['changed-hostname']],
    ['/usr/bin/date', ['--set=tomorrow']],
  ] as const)(
    'fail-closes the non-diagnostic command form %s before asking for approval',
    async (command, args) => {
      const { runner, execute } = runnerFixture();
      const service = new SshConnectionService(new MemorySshStorage(), runner);

      await expect(
        service.runAgentCommand(commandFixture({ command, args: [...args] })),
      ).rejects.toEqual(
        expect.objectContaining<Partial<SshConnectionServiceError>>({
          code: 'ssh_command_not_allowed',
        }),
      );
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['/usr/bin/nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']],
    ['/bin/hostname', ['--fqdn']],
    ['/usr/bin/date', ['-u', '+%FT%TZ']],
    ['/bin/df', ['-h']],
    ['/usr/bin/tail', ['-n', '20', '/var/log/fixture.log']],
  ] as const)(
    'offers the read-only diagnostic command %s for exact approval',
    async (command, args) => {
      const { runner } = runnerFixture();
      const service = new SshConnectionService(new MemorySshStorage(), runner);
      const approval = nextApproval(service);
      const execution = service.runAgentCommand(commandFixture({ command, args: [...args] }));
      const request = await approval;

      expect(request.commandPreview).toContain(`'${command}'`);
      service.resolveApproval({ approvalId: request.id, decision: 'deny' });
      await expect(execution).rejects.toEqual(
        expect.objectContaining<Partial<SshConnectionServiceError>>({
          code: 'ssh_approval_denied',
        }),
      );
    },
  );

  it('rejects invalid or unreviewably long typed commands with a bounded error', async () => {
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(new MemorySshStorage(), runner);
    const invalid = { ...commandFixture(), args: ['line one\nline two'] } as SshAgentCommand;

    await expect(service.runAgentCommand(invalid)).rejects.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({
        code: 'ssh_command_not_allowed',
      }),
    );
    await expect(
      service.runAgentCommand(
        commandFixture({ args: Array.from({ length: 5 }, () => 'x'.repeat(1_000)) }),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({
        code: 'ssh_command_not_allowed',
      }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('bounds escaped combined output inside the 48k agent result envelope', async () => {
    const { runner } = runnerFixture({
      stdout: `stdout-head-${'"'.repeat(40_000)}-stdout-tail`,
      stderr: `stderr-head-${'\\'.repeat(40_000)}-stderr-tail`,
    });
    const service = new SshConnectionService(new MemorySshStorage(), runner);
    const approval = nextApproval(service);
    const execution = service.runAgentCommand(commandFixture());
    const request = await approval;
    service.resolveApproval({ approvalId: request.id, decision: 'allow_once' });

    const result = await execution;
    expect(result.truncated).toBe(true);
    expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(
      SSH_AGENT_TOOL_MAX_OUTPUT_CHARACTERS,
    );
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(SSH_AGENT_TOOL_MAX_OUTPUT_CHARACTERS);
    expect(result.stdout).toMatch(/^stdout-head-/u);
    expect(result.stdout).toMatch(/-stdout-tail$/u);
    expect(result.stderr).toMatch(/^stderr-head-/u);
    expect(result.stderr).toMatch(/-stderr-tail$/u);
    expect(result.stdout).toContain('[GOSU output cropped]');
  });

  it('caps pending approvals per bound project/session/attempt/turn', async () => {
    const { runner, execute } = runnerFixture();
    const service = new SshConnectionService(new MemorySshStorage(), runner);
    const requests: SshApprovalRequest[] = [];
    service.on('event', (event) => {
      if (event.type === 'approval.requested') requests.push(event.request);
    });
    const pending = Array.from({ length: SSH_MAX_PENDING_APPROVALS_PER_TURN }, (_, index) =>
      service
        .runAgentCommand(commandFixture({ toolCallId: `tool-call-${index}` }))
        .catch((error: unknown) => error),
    );
    await vi.waitFor(() => expect(requests).toHaveLength(SSH_MAX_PENDING_APPROVALS_PER_TURN));

    await expect(
      service.runAgentCommand(commandFixture({ toolCallId: 'tool-call-over-cap' })),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({
        code: 'ssh_capacity_exceeded',
      }),
    );
    for (const request of requests) {
      service.resolveApproval({ approvalId: request.id, decision: 'deny' });
    }
    await Promise.all(pending);
    expect(execute).not.toHaveBeenCalled();
  });

  it('caps concurrent execution to one command per bound turn', async () => {
    const { runner, execute } = runnerFixture();
    let finishFirst!: (result: SshProcessResult) => void;
    execute.mockImplementationOnce(
      () =>
        new Promise<SshProcessResult>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const service = new SshConnectionService(new MemorySshStorage(), runner);
    const firstApproval = nextApproval(service);
    const firstExecution = service.runAgentCommand(
      commandFixture({ toolCallId: 'tool-call-active' }),
    );
    const firstRequest = await firstApproval;
    service.resolveApproval({ approvalId: firstRequest.id, decision: 'allow_once' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());

    const secondApproval = nextApproval(service);
    const secondExecution = service.runAgentCommand(
      commandFixture({ toolCallId: 'tool-call-over-active-cap' }),
    );
    const secondRejection = secondExecution.catch((error: unknown) => error);
    const secondRequest = await secondApproval;
    expect(() =>
      service.resolveApproval({ approvalId: secondRequest.id, decision: 'allow_once' }),
    ).toThrow(
      expect.objectContaining<Partial<SshConnectionServiceError>>({
        code: 'ssh_capacity_exceeded',
      }),
    );
    await expect(secondRejection).resolves.toEqual(
      expect.objectContaining<Partial<SshConnectionServiceError>>({
        code: 'ssh_capacity_exceeded',
      }),
    );

    finishFirst({
      exitCode: 0,
      stdout: 'done',
      stderr: '',
      truncated: false,
      durationMs: 10,
    });
    await expect(firstExecution).resolves.toMatchObject({ stdout: 'done' });
  });

  it.each([
    ['unknown_host_key', 'unknown_host_key'],
    ['authentication_failed', 'authentication_failed'],
    ['timed_out', 'timed_out'],
  ] as const)('maps runner %s errors to a bounded test result', async (kind, code) => {
    const { runner, testConnection } = runnerFixture();
    testConnection.mockRejectedValueOnce(new SshCommandRunnerError(kind));
    const service = new SshConnectionService(new MemorySshStorage(), runner);

    await expect(service.testConnection({ connectionId: CONNECTION_ID })).resolves.toEqual({
      connectionId: CONNECTION_ID,
      reachable: false,
      code,
    });
  });
});
