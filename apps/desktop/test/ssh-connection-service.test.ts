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
} from '../src/main/ssh-command-runner';
import {
  SSH_AGENT_TOOL_MAX_OUTPUT_CHARACTERS,
  type SshAgentCommand,
  type SshApprovalRequest,
  type SshConnectionProfile,
} from '../src/shared/ssh-contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_A = '22222222-2222-4222-8222-222222222222';
const SESSION_B = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const ATTEMPT_ID = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-08-04T00:00:00.000Z');

class MemorySshStorage implements SshConnectionStorage {
  readonly profiles = new Map<string, SshConnectionProfile>();

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

  updateSshConnection(profile: SshConnectionProfile, expectedVersion: number) {
    const current = this.profiles.get(profile.id);
    if (!current || current.version !== expectedVersion) return false;
    this.profiles.set(profile.id, profile);
    return true;
  }

  removeSshConnection(connectionId: string, expectedVersion: number) {
    const current = this.profiles.get(connectionId);
    if (!current || current.version !== expectedVersion) return false;
    return this.profiles.delete(connectionId);
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

function runnerFixture(result?: Partial<SshProcessResult>) {
  const execute = vi.fn(async (): Promise<SshProcessResult> => ({
    exitCode: 0,
    stdout: 'Fixture GPU\n',
    stderr: '',
    truncated: false,
    durationMs: 12,
    ...result,
  }));
  const testConnection = vi.fn(async () => undefined);
  const callable = vi.fn() as unknown as SshCommandRunner;
  callable.execute = execute;
  callable.testConnection = testConnection;
  return { runner: callable, execute, testConnection };
}

function nextApproval(service: SshConnectionService) {
  return new Promise<SshApprovalRequest>((resolve) => {
    service.once('event', (event) => {
      if (event.type === 'approval.requested') resolve(event.request);
    });
  });
}

afterEach(() => vi.useRealTimers());

describe('SSH connection and Allow once service', () => {
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
