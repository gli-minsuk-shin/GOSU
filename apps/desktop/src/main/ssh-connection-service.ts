import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  SSH_AGENT_TOOL_MAX_OUTPUT_CHARACTERS,
  CreateSshConnectionInputSchema,
  RemoveSshConnectionInputSchema,
  ResolveSshApprovalInputSchema,
  SshAgentCommandSchema,
  SshCommandResultSchema,
  SshConnectionProfileSchema,
  TestSshConnectionInputSchema,
  UpdateSshConnectionInputSchema,
  type CreateSshConnectionInput,
  type RemoveSshConnectionInput,
  type ResolveSshApprovalInput,
  type SshAgentCommand,
  type SshApprovalRequest,
  type SshCommandResult,
  type SshConnectionProfile,
  type SshConnectionTestResult,
  type SshEvent,
  type TestSshConnectionInput,
  type UpdateSshConnectionInput,
} from '../shared/ssh-contracts';
import type { SshIpcErrorCode } from '../shared/ssh-ipc-result';
import {
  SshCommandRunnerError,
  buildRemoteCommand,
  type SshCommandRunner,
  type SshProcessResult,
} from './ssh-command-runner';

type MaybePromise<T> = T | Promise<T>;

/** The encrypted local database implements this port. No output or credentials enter the port. */
export interface SshConnectionStorage {
  listSshConnections(): MaybePromise<readonly SshConnectionProfile[]>;
  createSshConnection(profile: SshConnectionProfile): MaybePromise<boolean>;
  updateSshConnection(
    profile: SshConnectionProfile,
    expectedVersion: number,
  ): MaybePromise<boolean>;
  removeSshConnection(connectionId: string, expectedVersion: number): MaybePromise<boolean>;
}

export class SshConnectionServiceError extends Error {
  constructor(readonly code: Exclude<SshIpcErrorCode, 'invalid_ssh_input'>) {
    super(code);
    this.name = 'SshConnectionServiceError';
  }
}

type PendingApproval = Readonly<{
  request: SshApprovalRequest;
  profile: SshConnectionProfile;
  command: SshAgentCommand;
  timer: NodeJS.Timeout;
  cancellation: ExecutionCancellation;
  settlement: ExecutionSettlement;
}>;

type ExecutionCancellation = Readonly<{
  controller: AbortController;
  detach(): void;
}>;

type ExecutionSettlement = Readonly<{
  resolve(result: SshCommandResult): boolean;
  reject(error: SshConnectionServiceError): boolean;
}>;

type ActiveExecution = Readonly<{
  approvalId: string;
  projectId: string;
  sessionId: string;
  attemptId: string;
  turnId: string;
  toolCallId: string;
  connectionId: string;
  cancellation: ExecutionCancellation;
  settlement: ExecutionSettlement;
}>;

const MAX_CONNECTIONS = 100;
const DEFAULT_APPROVAL_TTL_MS = 30_000;
export const SSH_MAX_PENDING_APPROVALS = 16;
export const SSH_MAX_PENDING_APPROVALS_PER_TURN = 4;
export const SSH_MAX_ACTIVE_EXECUTIONS = 4;
export const SSH_MAX_ACTIVE_EXECUTIONS_PER_TURN = 1;
const ALLOWED_SYSTEM_DIRECTORIES = new Set(['/bin', '/sbin', '/usr/bin', '/usr/sbin']);
const READ_ONLY_EXECUTABLES = new Set([
  'cat',
  'cut',
  'df',
  'du',
  'free',
  'grep',
  'head',
  'id',
  'iostat',
  'ls',
  'lsblk',
  'lscpu',
  'md5sum',
  'ps',
  'pwd',
  'readlink',
  'realpath',
  'sha256sum',
  'stat',
  'tail',
  'test',
  'tr',
  'true',
  'uname',
  'uptime',
  'vmstat',
  'wc',
  'whoami',
]);

function copy<T>(value: T): T {
  return structuredClone(value);
}

function linkedCancellation(signal: AbortSignal | undefined, onAbort: () => void) {
  const controller = new AbortController();
  let detached = false;
  const handleControllerAbort = () => onAbort();
  const forwardAbort = () => controller.abort(signal?.reason);
  controller.signal.addEventListener('abort', handleControllerAbort, { once: true });
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) forwardAbort();
  return {
    controller,
    detach: () => {
      if (detached) return;
      detached = true;
      controller.signal.removeEventListener('abort', handleControllerAbort);
      signal?.removeEventListener('abort', forwardAbort);
    },
  } satisfies ExecutionCancellation;
}

function singleSettlement(
  resolve: (result: SshCommandResult) => void,
  reject: (error: SshConnectionServiceError) => void,
): ExecutionSettlement {
  let settled = false;
  return {
    resolve: (result) => {
      if (settled) return false;
      settled = true;
      resolve(result);
      return true;
    },
    reject: (error) => {
      if (settled) return false;
      settled = true;
      reject(error);
      return true;
    },
  };
}

function systemExecutableBasename(command: string) {
  const separator = command.lastIndexOf('/');
  if (separator <= 0 || separator === command.length - 1) return null;
  const directory = command.slice(0, separator);
  const basename = command.slice(separator + 1);
  return ALLOWED_SYSTEM_DIRECTORIES.has(directory) && /^[a-z0-9][a-z0-9+._-]*$/u.test(basename)
    ? basename
    : null;
}

function isSafeNvidiaSmiQuery(arguments_: readonly string[]) {
  let expectsSelector = false;
  for (const argument of arguments_) {
    if (expectsSelector) {
      if (!/^[A-Za-z0-9,._:-]+$/u.test(argument)) return false;
      expectsSelector = false;
      continue;
    }
    if (argument === '-i' || argument === '--id' || argument === '-d') {
      expectsSelector = true;
      continue;
    }
    if (
      argument === '-L' ||
      argument === '--list-gpus' ||
      argument === '-q' ||
      argument === '--query' ||
      argument === '-x' ||
      argument === '--xml-format' ||
      argument === '-h' ||
      argument === '--help' ||
      argument.startsWith('--id=') ||
      argument.startsWith('--display=') ||
      argument.startsWith('--query-gpu=') ||
      argument.startsWith('--query-compute-apps=') ||
      argument.startsWith('--query-accounted-apps=') ||
      argument.startsWith('--query-retired-pages=') ||
      argument.startsWith('--format=')
    ) {
      continue;
    }
    return false;
  }
  return !expectsSelector;
}

function isAllowedReadOnlyCommand(command: SshAgentCommand) {
  const basename = systemExecutableBasename(command.command);
  if (!basename) return false;
  if (READ_ONLY_EXECUTABLES.has(basename)) return true;
  if (basename === 'hostname') {
    return command.args.every((argument) =>
      ['-f', '--fqdn', '-s', '--short', '-i', '--ip-address', '-I', '--all-ip-addresses'].includes(
        argument,
      ),
    );
  }
  if (basename === 'date') {
    return command.args.every(
      (argument) =>
        argument === '-u' ||
        argument === '--utc' ||
        argument === '-I' ||
        argument.startsWith('--iso-8601=') ||
        argument.startsWith('--rfc-3339=') ||
        argument.startsWith('+'),
    );
  }
  return basename === 'nvidia-smi' && isSafeNvidiaSmiQuery(command.args);
}

function sameTurn(
  left: Pick<SshAgentCommand, 'projectId' | 'sessionId' | 'attemptId' | 'turnId'>,
  right: Pick<SshAgentCommand, 'projectId' | 'sessionId' | 'attemptId' | 'turnId'>,
) {
  return (
    left.projectId === right.projectId &&
    left.sessionId === right.sessionId &&
    left.attemptId === right.attemptId &&
    left.turnId === right.turnId
  );
}

export type SshExecutionBinding = Pick<
  SshAgentCommand,
  'projectId' | 'sessionId' | 'attemptId' | 'turnId' | 'toolCallId'
>;

function executionError(error: unknown) {
  if (!(error instanceof SshCommandRunnerError)) {
    return new SshConnectionServiceError('ssh_unavailable');
  }
  const code = {
    unavailable: 'ssh_unavailable',
    unknown_host_key: 'ssh_unknown_host_key',
    authentication_failed: 'ssh_authentication_failed',
    connection_failed: 'ssh_connection_failed',
    timed_out: 'ssh_timed_out',
    output_too_large: 'ssh_output_too_large',
    cancelled: 'ssh_cancelled',
  } as const;
  return new SshConnectionServiceError(code[error.kind]);
}

function hashCommand(command: SshAgentCommand) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        command: command.command,
        args: command.args,
        workingDirectory: command.workingDirectory ?? null,
        timeoutSeconds: command.timeoutSeconds,
      }),
      'utf8',
    )
    .digest('hex');
}

const OUTPUT_CROPPED_MARKER = '\n…[GOSU output cropped]…\n';

function cropText(value: string, maximumCharacters: number) {
  if (value.length <= maximumCharacters) return value;
  if (maximumCharacters <= OUTPUT_CROPPED_MARKER.length) {
    return value.slice(0, maximumCharacters);
  }
  const retainedCharacters = maximumCharacters - OUTPUT_CROPPED_MARKER.length;
  const headCharacters = Math.ceil(retainedCharacters / 2);
  const tailCharacters = retainedCharacters - headCharacters;
  return `${value.slice(0, headCharacters)}${OUTPUT_CROPPED_MARKER}${value.slice(
    value.length - tailCharacters,
  )}`;
}

function cropOutput(stdout: string, stderr: string, maximumCombinedCharacters: number) {
  const total = stdout.length + stderr.length;
  if (total <= maximumCombinedCharacters) return { stdout, stderr };
  const stdoutCharacters = Math.min(
    stdout.length,
    Math.floor((maximumCombinedCharacters * stdout.length) / total),
  );
  const stderrCharacters = Math.min(stderr.length, maximumCombinedCharacters - stdoutCharacters);
  const unused = maximumCombinedCharacters - stdoutCharacters - stderrCharacters;
  return {
    stdout: cropText(stdout, stdoutCharacters + Math.min(unused, stdout.length - stdoutCharacters)),
    stderr: cropText(stderr, stderrCharacters),
  };
}

/** Keep the complete JSON tool result under the agent transport boundary, including escaping. */
function boundedCommandResult(
  connectionLabel: string,
  command: SshAgentCommand,
  result: SshProcessResult,
) {
  const maximumOutput = Math.min(
    SSH_AGENT_TOOL_MAX_OUTPUT_CHARACTERS,
    result.stdout.length + result.stderr.length,
  );
  const create = (outputCharacters: number) => {
    const output = cropOutput(result.stdout, result.stderr, outputCharacters);
    return {
      schemaVersion: 1 as const,
      trust: 'untrusted_remote_output' as const,
      connectionLabel,
      commandSha256: hashCommand(command),
      exitCode: result.exitCode,
      stdout: output.stdout,
      stderr: output.stderr,
      truncated:
        result.truncated ||
        output.stdout.length < result.stdout.length ||
        output.stderr.length < result.stderr.length,
      durationMs: result.durationMs,
    };
  };
  let lower = 0;
  let upper = maximumOutput;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (JSON.stringify(create(middle)).length <= SSH_AGENT_TOOL_MAX_OUTPUT_CHARACTERS)
      lower = middle;
    else upper = middle - 1;
  }
  return SshCommandResultSchema.parse(create(lower));
}

function commandPreview(command: SshAgentCommand) {
  const preview = buildRemoteCommand(command);
  if (preview.length > 4_096) throw new SshConnectionServiceError('ssh_command_not_allowed');
  return preview;
}

function compareConnections(left: SshConnectionProfile, right: SshConnectionProfile) {
  return left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
}

export type SshConnectionServiceOptions = Readonly<{
  approvalTimeoutMs?: number;
  now?: () => Date;
}>;

export class SshConnectionService extends EventEmitter {
  private readonly storage: SshConnectionStorage;
  private readonly runner: SshCommandRunner;
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly activeExecutions = new Map<string, ActiveExecution>();
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly approvalTtlMs: number;
  private readonly now: () => number;
  private shuttingDown = false;

  constructor(
    storage: SshConnectionStorage,
    runner: SshCommandRunner,
    options: SshConnectionServiceOptions = {},
  ) {
    super();
    this.storage = storage;
    this.runner = runner;
    this.approvalTtlMs = Math.max(1, options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TTL_MS);
    this.now = () => (options.now ?? (() => new Date()))().getTime();
  }

  async listConnections(): Promise<readonly SshConnectionProfile[]> {
    await this.mutationTail;
    return SshConnectionProfileSchema.array()
      .parse(copy(await this.storage.listSshConnections()))
      .sort(compareConnections);
  }

  createConnection(input: CreateSshConnectionInput): Promise<SshConnectionProfile> {
    return this.mutate(async () => {
      const command = CreateSshConnectionInputSchema.parse(input);
      const existing = SshConnectionProfileSchema.array().parse(
        copy(await this.storage.listSshConnections()),
      );
      if (existing.length >= MAX_CONNECTIONS) {
        throw new SshConnectionServiceError('ssh_connection_limit_reached');
      }
      const now = new Date(this.now()).toISOString();
      const profile = SshConnectionProfileSchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        label: command.label,
        hostAlias: command.hostAlias,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      if (!(await this.storage.createSshConnection(profile))) {
        throw new SshConnectionServiceError('ssh_unavailable');
      }
      return copy(profile);
    });
  }

  updateConnection(input: UpdateSshConnectionInput): Promise<SshConnectionProfile> {
    return this.mutate(async () => {
      const command = UpdateSshConnectionInputSchema.parse(input);
      const current = await this.readRequiredConnection(command.connectionId);
      if (current.version !== command.expectedVersion) {
        throw new SshConnectionServiceError('ssh_connection_version_conflict');
      }
      const profile = SshConnectionProfileSchema.parse({
        ...current,
        label: command.label,
        hostAlias: command.hostAlias,
        version: current.version + 1,
        updatedAt: new Date(this.now()).toISOString(),
      });
      if (!(await this.storage.updateSshConnection(profile, command.expectedVersion))) {
        throw await this.classifyWriteMiss(command.connectionId);
      }
      return copy(profile);
    });
  }

  removeConnection(input: RemoveSshConnectionInput): Promise<{ removed: true }> {
    return this.mutate(async () => {
      const command = RemoveSshConnectionInputSchema.parse(input);
      const current = await this.readRequiredConnection(command.connectionId);
      if (current.version !== command.expectedVersion) {
        throw new SshConnectionServiceError('ssh_connection_version_conflict');
      }
      const removed = await this.storage.removeSshConnection(
        command.connectionId,
        command.expectedVersion,
      );
      if (!removed) throw await this.classifyWriteMiss(command.connectionId);
      this.cancelWhere((entry) => entry.connectionId === command.connectionId);
      return { removed: true };
    });
  }

  async testConnection(input: TestSshConnectionInput): Promise<SshConnectionTestResult> {
    const command = TestSshConnectionInputSchema.parse(input);
    const connection = await this.requireConnection(command.connectionId);
    try {
      await this.runner.testConnection(connection.hostAlias, 10);
      return { connectionId: connection.id, reachable: true, code: 'ready' };
    } catch (error) {
      const kind = error instanceof SshCommandRunnerError ? error.kind : 'connection_failed';
      const code =
        kind === 'unknown_host_key'
          ? 'unknown_host_key'
          : kind === 'authentication_failed'
            ? 'authentication_failed'
            : kind === 'timed_out'
              ? 'timed_out'
              : 'connection_failed';
      return { connectionId: connection.id, reachable: false, code };
    }
  }

  /** Main-process-only tool entry point. There is intentionally no renderer execute IPC. */
  async requestExecution(input: SshAgentCommand, signal?: AbortSignal): Promise<SshCommandResult> {
    if (this.shuttingDown) throw new SshConnectionServiceError('ssh_unavailable');
    if (signal?.aborted) throw new SshConnectionServiceError('ssh_cancelled');
    const parsed = SshAgentCommandSchema.safeParse(input);
    if (!parsed.success) throw new SshConnectionServiceError('ssh_command_not_allowed');
    const command = parsed.data;
    if (!isAllowedReadOnlyCommand(command)) {
      throw new SshConnectionServiceError('ssh_command_not_allowed');
    }
    const profile = await this.requireConnection(command.connectionId);
    if (this.shuttingDown) throw new SshConnectionServiceError('ssh_unavailable');
    if (signal?.aborted) throw new SshConnectionServiceError('ssh_cancelled');
    if (
      this.pendingApprovals.size >= SSH_MAX_PENDING_APPROVALS ||
      [...this.pendingApprovals.values()].filter((pending) => sameTurn(pending.command, command))
        .length >= SSH_MAX_PENDING_APPROVALS_PER_TURN
    ) {
      throw new SshConnectionServiceError('ssh_capacity_exceeded');
    }
    const requestedAt = this.now();
    const approvalId = randomUUID();
    const request = {
      schemaVersion: 1 as const,
      id: approvalId,
      projectId: command.projectId,
      sessionId: command.sessionId,
      attemptId: command.attemptId,
      turnId: command.turnId,
      toolCallId: command.toolCallId,
      connectionId: profile.id,
      connectionLabel: profile.label,
      hostAlias: profile.hostAlias,
      commandPreview: commandPreview(command),
      requestedAt: new Date(requestedAt).toISOString(),
      expiresAt: new Date(requestedAt + this.approvalTtlMs).toISOString(),
    } satisfies SshApprovalRequest;

    let pending: PendingApproval | undefined;
    const cancellation = linkedCancellation(signal, () => {
      if (pending && this.rejectPending(pending, 'cancelled', 'ssh_cancelled')) return;
      const active = this.activeExecutions.get(approvalId);
      if (active) this.cancelActive(active);
    });
    return new Promise<SshCommandResult>((resolve, reject) => {
      const timer = setTimeout(() => this.expireApproval(approvalId), this.approvalTtlMs);
      timer.unref?.();
      pending = {
        request,
        profile,
        command,
        timer,
        cancellation,
        settlement: singleSettlement(resolve, reject),
      };
      this.pendingApprovals.set(approvalId, pending);
      if (cancellation.controller.signal.aborted) {
        this.rejectPending(pending, 'cancelled', 'ssh_cancelled');
        return;
      }
      this.emitSshEvent({ type: 'approval.requested', request: copy(request) });
    });
  }

  /** Alias retained for the project-agent adapter's descriptive method name. */
  runAgentCommand(input: SshAgentCommand, signal?: AbortSignal) {
    return this.requestExecution(input, signal);
  }

  resolveApproval(input: ResolveSshApprovalInput): { outcome: 'allowed' | 'denied' } {
    const command = ResolveSshApprovalInputSchema.parse(input);
    const pending = this.pendingApprovals.get(command.approvalId);
    if (!pending) throw new SshConnectionServiceError('ssh_approval_not_found');
    if (this.now() >= Date.parse(pending.request.expiresAt)) {
      this.rejectPending(pending, 'expired', 'ssh_approval_expired');
      throw new SshConnectionServiceError('ssh_approval_expired');
    }
    if (command.decision === 'deny') {
      this.rejectPending(pending, 'denied', 'ssh_approval_denied');
      return { outcome: 'denied' };
    }
    if (
      this.activeExecutions.size >= SSH_MAX_ACTIVE_EXECUTIONS ||
      [...this.activeExecutions.values()].filter((active) => sameTurn(active, pending.command))
        .length >= SSH_MAX_ACTIVE_EXECUTIONS_PER_TURN
    ) {
      this.rejectPending(pending, 'cancelled', 'ssh_capacity_exceeded');
      throw new SshConnectionServiceError('ssh_capacity_exceeded');
    }
    this.startApproved(pending);
    return { outcome: 'allowed' };
  }

  cancelApproval(approvalId: string) {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return false;
    this.rejectPending(pending, 'cancelled', 'ssh_approval_cancelled');
    return true;
  }

  cancelSession(projectId: string, sessionId: string) {
    return this.cancelWhere(
      (entry) => entry.projectId === projectId && entry.sessionId === sessionId,
    );
  }

  cancelProject(projectId: string) {
    return this.cancelWhere((entry) => entry.projectId === projectId);
  }

  cancelAttempt(projectId: string, sessionId: string, attemptId: string) {
    return this.cancelWhere(
      (entry) =>
        entry.projectId === projectId &&
        entry.sessionId === sessionId &&
        entry.attemptId === attemptId,
    );
  }

  cancelExecution(binding: SshExecutionBinding) {
    return this.cancelWhere(
      (entry) =>
        entry.projectId === binding.projectId &&
        entry.sessionId === binding.sessionId &&
        entry.attemptId === binding.attemptId &&
        entry.turnId === binding.turnId &&
        entry.toolCallId === binding.toolCallId,
    );
  }

  shutdown() {
    this.shuttingDown = true;
    return this.cancelWhere(() => true);
  }

  private async requireConnection(connectionId: string) {
    await this.mutationTail;
    return this.readRequiredConnection(connectionId);
  }

  private async readRequiredConnection(connectionId: string) {
    const profile = SshConnectionProfileSchema.array()
      .parse(copy(await this.storage.listSshConnections()))
      .find((entry) => entry.id === connectionId);
    if (!profile) throw new SshConnectionServiceError('ssh_connection_not_found');
    return profile;
  }

  private async classifyWriteMiss(connectionId: string) {
    return new SshConnectionServiceError(
      SshConnectionProfileSchema.array()
        .parse(copy(await this.storage.listSshConnections()))
        .some((entry) => entry.id === connectionId)
        ? 'ssh_connection_version_conflict'
        : 'ssh_connection_not_found',
    );
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private expireApproval(approvalId: string) {
    const pending = this.pendingApprovals.get(approvalId);
    if (pending) this.rejectPending(pending, 'expired', 'ssh_approval_expired');
  }

  private rejectPending(
    pending: PendingApproval,
    outcome: 'denied' | 'expired' | 'cancelled',
    code: Exclude<SshIpcErrorCode, 'invalid_ssh_input'>,
  ) {
    if (!this.pendingApprovals.delete(pending.request.id)) return false;
    clearTimeout(pending.timer);
    pending.cancellation.detach();
    pending.cancellation.controller.abort();
    this.emitSshEvent({
      type: 'approval.resolved',
      approvalId: pending.request.id,
      outcome,
    });
    pending.settlement.reject(new SshConnectionServiceError(code));
    return true;
  }

  private startApproved(pending: PendingApproval) {
    if (!this.pendingApprovals.delete(pending.request.id)) return;
    clearTimeout(pending.timer);
    const active: ActiveExecution = {
      approvalId: pending.request.id,
      projectId: pending.command.projectId,
      sessionId: pending.command.sessionId,
      attemptId: pending.command.attemptId,
      turnId: pending.command.turnId,
      toolCallId: pending.command.toolCallId,
      connectionId: pending.command.connectionId,
      cancellation: pending.cancellation,
      settlement: pending.settlement,
    };
    this.activeExecutions.set(active.approvalId, active);
    this.emitSshEvent({
      type: 'approval.resolved',
      approvalId: pending.request.id,
      outcome: 'allowed',
    });

    void Promise.resolve(this.storage.listSshConnections())
      .then((connections) => {
        this.throwIfCancelled(active);
        const profile = SshConnectionProfileSchema.array()
          .parse(copy(connections))
          .find((entry) => entry.id === pending.profile.id);
        if (
          !profile ||
          profile.version !== pending.profile.version ||
          profile.hostAlias !== pending.profile.hostAlias ||
          profile.label !== pending.profile.label
        ) {
          throw new SshConnectionServiceError('ssh_connection_version_conflict');
        }
        this.throwIfCancelled(active);
        return this.runner.execute(profile.hostAlias, pending.command, {
          signal: active.cancellation.controller.signal,
          maxOutputCharacters: SSH_AGENT_TOOL_MAX_OUTPUT_CHARACTERS,
          failOnOutputLimit: false,
        });
      })
      .then((result) => {
        this.throwIfCancelled(active);
        active.settlement.resolve(
          boundedCommandResult(pending.profile.label, pending.command, result),
        );
      })
      .catch((error: unknown) => {
        active.settlement.reject(
          active.cancellation.controller.signal.aborted
            ? new SshConnectionServiceError('ssh_cancelled')
            : error instanceof SshConnectionServiceError
              ? error
              : executionError(error),
        );
      })
      .finally(() => {
        active.cancellation.detach();
        this.activeExecutions.delete(active.approvalId);
      });
  }

  private throwIfCancelled(active: ActiveExecution) {
    if (active.cancellation.controller.signal.aborted) {
      throw new SshConnectionServiceError('ssh_cancelled');
    }
  }

  private cancelActive(active: ActiveExecution) {
    active.cancellation.detach();
    active.settlement.reject(new SshConnectionServiceError('ssh_cancelled'));
  }

  private cancelWhere(
    predicate: (entry: {
      projectId: string;
      sessionId: string;
      attemptId: string;
      turnId: string;
      toolCallId: string;
      connectionId: string;
    }) => boolean,
  ) {
    let cancelled = 0;
    for (const pending of [...this.pendingApprovals.values()]) {
      if (!predicate(pending.command)) continue;
      this.rejectPending(pending, 'cancelled', 'ssh_approval_cancelled');
      cancelled += 1;
    }
    for (const active of this.activeExecutions.values()) {
      if (!predicate(active)) continue;
      active.cancellation.controller.abort();
      cancelled += 1;
    }
    return cancelled;
  }

  private emitSshEvent(event: SshEvent) {
    for (const listener of this.rawListeners('event')) {
      try {
        listener.call(this, event);
      } catch {
        // One notification failure must not corrupt state or hide later listeners.
      }
    }
  }
}
