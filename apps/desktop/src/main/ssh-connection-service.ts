import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  SSH_AGENT_TOOL_MAX_OUTPUT_CHARACTERS,
  CreateSshConnectionInputSchema,
  ImportSshCommandInputSchema,
  ListProjectSshResourceSnapshotsInputSchema,
  ReadProjectSshResourceSnapshotInputSchema,
  ReadSshResourceSnapshotInputSchema,
  RemoveSshConnectionInputSchema,
  ResolveSshApprovalInputSchema,
  SshAgentCommandSchema,
  SshCommandResultSchema,
  SshConnectionProfileSchema,
  TestSshConnectionInputSchema,
  UpdateSshConnectionInputSchema,
  type CreateSshConnectionInput,
  type ImportSshCommandInput,
  type ListProjectSshResourceSnapshotsInput,
  type ReadProjectSshResourceSnapshotInput,
  type ReadSshResourceSnapshotInput,
  type RemoveSshConnectionInput,
  type ResolveSshApprovalInput,
  type SshAgentCommand,
  type SshApprovalRequest,
  type SshCommandResult,
  type SshConnectionProfile,
  type SshConnectionTestResult,
  type SshEvent,
  type SshServerResourceSnapshot,
  type TestSshConnectionInput,
  type UpdateSshConnectionInput,
} from '../shared/ssh-contracts';
import type { SshIpcErrorCode } from '../shared/ssh-ipc-result';
import {
  CreateRemoteWorkspaceGrantInputSchema,
  GrantedRemoteWorkspaceSchema,
  RemoteWorkspaceGrantSchema,
  RemoveRemoteWorkspaceGrantInputSchema,
  SshWorkspaceAgentCommandSchema,
  UpdateRemoteWorkspaceGrantInputSchema,
  type CreateRemoteWorkspaceGrantInput,
  type GrantedRemoteWorkspace,
  type RemoteWorkspaceGrant,
  type RemoveRemoteWorkspaceGrantInput,
  type SshWorkspaceAgentCommand,
  type SshWorkspaceOperationClass,
  type UpdateRemoteWorkspaceGrantInput,
} from '../shared/ssh-workspace-contracts';
import {
  SshCommandRunnerError,
  buildRemoteCommand,
  type SshCommandRunner,
  type SshProcessResult,
} from './ssh-command-runner';
import { SshCommandImportError, parseSshConnectionCommand } from './ssh-command-import';
import { SshResourceCaptureInvalidatedError, SshResourceMonitor } from './ssh-resource-monitor';
import {
  classifyWorkspaceCommand,
  hardenWorkspaceCommand,
  resolveWorkspaceWorkingDirectory,
} from './ssh-workspace-policy';

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
  listSshWorkspaceGrants(projectId: string): MaybePromise<readonly RemoteWorkspaceGrant[]>;
  createSshWorkspaceGrant(grant: RemoteWorkspaceGrant): MaybePromise<boolean>;
  updateSshWorkspaceGrant(
    grant: RemoteWorkspaceGrant,
    expectedVersion: number,
  ): MaybePromise<boolean>;
  removeSshWorkspaceGrant(
    projectId: string,
    grantId: string,
    expectedVersion: number,
  ): MaybePromise<boolean>;
}

export class SshConnectionServiceError extends Error {
  constructor(readonly code: SshIpcErrorCode) {
    super(code);
    this.name = 'SshConnectionServiceError';
  }
}

type PendingApproval = Readonly<{
  request: SshApprovalRequest;
  profile: SshConnectionProfile;
  command: SshAgentCommand;
  workspaceBinding?: WorkspaceExecutionBinding;
  timer: NodeJS.Timeout;
  cancellation: ExecutionCancellation;
  settlement: ExecutionSettlement;
}>;

type WorkspaceExecutionBinding = Readonly<{
  grant: RemoteWorkspaceGrant;
  operation: SshWorkspaceOperationClass;
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
const MAX_WORKSPACE_GRANTS_PER_PROJECT = 32;
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
const ROOT_DIAGNOSTIC_EXECUTABLES = new Set([
  'date',
  'df',
  'free',
  'hostname',
  'id',
  'iostat',
  'lsblk',
  'lscpu',
  'nvidia-smi',
  'pwd',
  'true',
  'uname',
  'uptime',
  'vmstat',
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

function isAllowedRootDiagnosticCommand(command: SshAgentCommand) {
  const basename = systemExecutableBasename(command.command);
  return basename !== null && ROOT_DIAGNOSTIC_EXECUTABLES.has(basename);
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

function availableImportedLabel(connections: readonly SshConnectionProfile[], baseLabel: string) {
  const labels = new Set(connections.map((connection) => connection.label));
  if (!labels.has(baseLabel)) return baseLabel;
  for (let suffix = 2; suffix <= MAX_CONNECTIONS + 1; suffix += 1) {
    const candidate = `${baseLabel} ${suffix}`;
    if (!labels.has(candidate)) return candidate;
  }
  throw new SshConnectionServiceError('ssh_connection_limit_reached');
}

function connectionTargetDisplay(profile: SshConnectionProfile) {
  if (!profile.directTarget) return profile.hostAlias;
  const host = profile.directTarget.host.includes(':')
    ? `[${profile.directTarget.host}]`
    : profile.directTarget.host;
  return `${profile.directTarget.user ? `${profile.directTarget.user}@` : ''}${host}${profile.directTarget.port ? `:${profile.directTarget.port}` : ''}`;
}

function connectionPrivilegeClass(profile: SshConnectionProfile) {
  if (!profile.directTarget || !profile.directTarget.user) return 'unknown' as const;
  return profile.directTarget.user === 'root' ? ('root' as const) : ('standard' as const);
}

export type SshConnectionServiceOptions = Readonly<{
  approvalTimeoutMs?: number;
  now?: () => Date;
  resourceSnapshotTtlMs?: number;
  resourceSampleDelayMs?: number;
  resourceDelay?: (milliseconds: number) => Promise<void>;
}>;

export class SshConnectionService extends EventEmitter {
  private readonly storage: SshConnectionStorage;
  private readonly runner: SshCommandRunner;
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly activeExecutions = new Map<string, ActiveExecution>();
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly approvalTtlMs: number;
  private readonly now: () => number;
  private readonly resourceMonitor: SshResourceMonitor;
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
    this.resourceMonitor = new SshResourceMonitor(runner, {
      ...(options.resourceSnapshotTtlMs === undefined
        ? {}
        : { cacheTtlMs: options.resourceSnapshotTtlMs }),
      ...(options.resourceSampleDelayMs === undefined
        ? {}
        : { sampleDelayMs: options.resourceSampleDelayMs }),
      ...(options.resourceDelay === undefined ? {} : { delay: options.resourceDelay }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  async listConnections(): Promise<readonly SshConnectionProfile[]> {
    await this.mutationTail;
    return SshConnectionProfileSchema.array()
      .parse(copy(await this.storage.listSshConnections()))
      .sort(compareConnections);
  }

  async listWorkspaceGrants(projectId: string): Promise<readonly GrantedRemoteWorkspace[]> {
    await this.mutationTail;
    const grants = RemoteWorkspaceGrantSchema.array().parse(
      copy(await this.storage.listSshWorkspaceGrants(projectId)),
    );
    const connections = SshConnectionProfileSchema.array().parse(
      copy(await this.storage.listSshConnections()),
    );
    const byId = new Map(connections.map((connection) => [connection.id, connection]));
    return grants
      .filter((grant) => grant.projectId === projectId && byId.has(grant.connectionId))
      .map((grant) =>
        GrantedRemoteWorkspaceSchema.parse({
          grant,
          connection: byId.get(grant.connectionId),
        }),
      )
      .sort(
        (left, right) =>
          left.connection.label.localeCompare(right.connection.label) ||
          left.grant.id.localeCompare(right.grant.id),
      );
  }

  async readResourceSnapshot(
    input: ReadSshResourceSnapshotInput,
  ): Promise<SshServerResourceSnapshot> {
    const command = ReadSshResourceSnapshotInputSchema.parse(input);
    const connection = await this.requireConnection(command.connectionId);
    return this.readBoundedResourceSnapshot(connection, command.force === true);
  }

  async listProjectResourceSnapshots(
    input: ListProjectSshResourceSnapshotsInput,
  ): Promise<readonly SshServerResourceSnapshot[]> {
    const command = ListProjectSshResourceSnapshotsInputSchema.parse(input);
    const workspaces = await this.listWorkspaceGrants(command.projectId);
    const snapshots: SshServerResourceSnapshot[] = [];
    for (let offset = 0; offset < workspaces.length; offset += 4) {
      const batch = workspaces.slice(offset, offset + 4);
      snapshots.push(
        ...(await Promise.all(
          batch.map(({ connection }) =>
            this.readBoundedResourceSnapshot(connection, command.force === true),
          ),
        )),
      );
    }
    return snapshots;
  }

  async readProjectResourceSnapshot(
    input: ReadProjectSshResourceSnapshotInput,
  ): Promise<SshServerResourceSnapshot> {
    const command = ReadProjectSshResourceSnapshotInputSchema.parse(input);
    const workspace = (await this.listWorkspaceGrants(command.projectId)).find(
      ({ connection }) => connection.id === command.connectionId,
    );
    if (!workspace) throw new SshConnectionServiceError('ssh_workspace_grant_not_found');
    return this.readBoundedResourceSnapshot(workspace.connection, command.force === true);
  }

  createWorkspaceGrant(input: CreateRemoteWorkspaceGrantInput): Promise<RemoteWorkspaceGrant> {
    return this.mutate(async () => {
      const command = CreateRemoteWorkspaceGrantInputSchema.parse(input);
      const connection = await this.readRequiredConnection(command.connectionId);
      if (command.permissionMode === 'workspace' && !connection.directTarget) {
        throw new SshConnectionServiceError('ssh_workspace_command_not_allowed');
      }
      const existing = RemoteWorkspaceGrantSchema.array().parse(
        copy(await this.storage.listSshWorkspaceGrants(command.projectId)),
      );
      if (existing.length >= MAX_WORKSPACE_GRANTS_PER_PROJECT) {
        throw new SshConnectionServiceError('ssh_workspace_grant_limit_reached');
      }
      if (existing.some((grant) => grant.connectionId === command.connectionId)) {
        throw new SshConnectionServiceError('ssh_workspace_grant_conflict');
      }
      const now = new Date(this.now()).toISOString();
      const grant = RemoteWorkspaceGrantSchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        projectId: command.projectId,
        connectionId: command.connectionId,
        canonicalRoot: command.canonicalRoot,
        permissionMode: command.permissionMode,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      if (!(await this.storage.createSshWorkspaceGrant(grant))) {
        throw new SshConnectionServiceError('ssh_workspace_grant_conflict');
      }
      return copy(grant);
    });
  }

  updateWorkspaceGrant(input: UpdateRemoteWorkspaceGrantInput): Promise<RemoteWorkspaceGrant> {
    return this.mutate(async () => {
      const command = UpdateRemoteWorkspaceGrantInputSchema.parse(input);
      const current = await this.readRequiredWorkspaceGrant(command.projectId, command.grantId);
      if (current.version !== command.expectedVersion) {
        throw new SshConnectionServiceError('ssh_workspace_grant_conflict');
      }
      const connection = await this.readRequiredConnection(current.connectionId);
      if (command.permissionMode === 'workspace' && !connection.directTarget) {
        throw new SshConnectionServiceError('ssh_workspace_command_not_allowed');
      }
      const grant = RemoteWorkspaceGrantSchema.parse({
        ...current,
        canonicalRoot: command.canonicalRoot,
        permissionMode: command.permissionMode,
        version: current.version + 1,
        updatedAt: new Date(this.now()).toISOString(),
      });
      if (!(await this.storage.updateSshWorkspaceGrant(grant, command.expectedVersion))) {
        throw new SshConnectionServiceError('ssh_workspace_grant_conflict');
      }
      this.cancelProject(command.projectId);
      return copy(grant);
    });
  }

  removeWorkspaceGrant(input: RemoveRemoteWorkspaceGrantInput): Promise<{ removed: true }> {
    return this.mutate(async () => {
      const command = RemoveRemoteWorkspaceGrantInputSchema.parse(input);
      const current = await this.readRequiredWorkspaceGrant(command.projectId, command.grantId);
      if (current.version !== command.expectedVersion) {
        throw new SshConnectionServiceError('ssh_workspace_grant_conflict');
      }
      if (
        !(await this.storage.removeSshWorkspaceGrant(
          command.projectId,
          command.grantId,
          command.expectedVersion,
        ))
      ) {
        throw new SshConnectionServiceError('ssh_workspace_grant_conflict');
      }
      this.cancelProject(command.projectId);
      return { removed: true };
    });
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
        directTarget: null,
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

  importCommand(input: ImportSshCommandInput): Promise<SshConnectionProfile> {
    return this.mutate(async () => {
      const command = ImportSshCommandInputSchema.parse(input);
      let imported: ReturnType<typeof parseSshConnectionCommand>;
      try {
        imported = parseSshConnectionCommand(command.command);
      } catch (error) {
        if (error instanceof SshCommandImportError) {
          throw new SshConnectionServiceError('ssh_import_invalid_command');
        }
        throw error;
      }
      const existing = SshConnectionProfileSchema.array().parse(
        copy(await this.storage.listSshConnections()),
      );
      const matching = existing.find(
        (profile) =>
          profile.directTarget !== null &&
          profile.directTarget !== undefined &&
          JSON.stringify(profile.directTarget) === JSON.stringify(imported.target),
      );
      const label =
        command.label ?? matching?.label ?? availableImportedLabel(existing, imported.defaultLabel);
      const now = new Date(this.now()).toISOString();
      if (matching) {
        if (matching.label === label) {
          return copy(matching);
        }
        const updated = SshConnectionProfileSchema.parse({
          ...matching,
          label,
          version: matching.version + 1,
          updatedAt: now,
        });
        if (!(await this.storage.updateSshConnection(updated, matching.version))) {
          throw await this.classifyWriteMiss(matching.id);
        }
        this.resourceMonitor.invalidate(matching.id);
        return copy(updated);
      }
      if (existing.length >= MAX_CONNECTIONS) {
        throw new SshConnectionServiceError('ssh_connection_limit_reached');
      }
      const profile = SshConnectionProfileSchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        label,
        hostAlias: imported.hostAlias,
        directTarget: imported.target,
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
      this.resourceMonitor.invalidate(command.connectionId);
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
      this.resourceMonitor.invalidate(command.connectionId);
      return { removed: true };
    });
  }

  async testConnection(input: TestSshConnectionInput): Promise<SshConnectionTestResult> {
    const command = TestSshConnectionInputSchema.parse(input);
    const connection = await this.requireConnection(command.connectionId);
    try {
      await this.runner.testConnection(
        connection.hostAlias,
        10,
        {},
        connection.directTarget ?? undefined,
      );
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
    if (profile.directTarget?.user === 'root' && !isAllowedRootDiagnosticCommand(command)) {
      throw new SshConnectionServiceError('ssh_command_not_allowed');
    }
    return this.requestApprovedExecution(command, profile, signal);
  }

  async requestWorkspaceExecution(
    input: SshWorkspaceAgentCommand,
    signal?: AbortSignal,
  ): Promise<SshCommandResult> {
    if (this.shuttingDown) throw new SshConnectionServiceError('ssh_unavailable');
    if (signal?.aborted) throw new SshConnectionServiceError('ssh_cancelled');
    const parsed = SshWorkspaceAgentCommandSchema.safeParse(input);
    if (!parsed.success) {
      throw new SshConnectionServiceError('ssh_workspace_command_not_allowed');
    }
    const workspaceCommand = parsed.data;
    if (workspaceCommand.args.length > 20) {
      throw new SshConnectionServiceError('ssh_workspace_command_not_allowed');
    }
    const grant = await this.readRequiredWorkspaceGrant(
      workspaceCommand.projectId,
      workspaceCommand.grantId,
    );
    if (grant.connectionId !== workspaceCommand.connectionId) {
      throw new SshConnectionServiceError('ssh_workspace_grant_not_found');
    }
    const operation = classifyWorkspaceCommand(workspaceCommand, grant);
    const workingDirectory = resolveWorkspaceWorkingDirectory(
      grant.canonicalRoot,
      workspaceCommand.workspaceSubdirectory,
    );
    if (!operation || !workingDirectory) {
      throw new SshConnectionServiceError('ssh_workspace_command_not_allowed');
    }
    const hardenedCommand = hardenWorkspaceCommand(workspaceCommand);
    const command = SshAgentCommandSchema.parse({
      projectId: hardenedCommand.projectId,
      sessionId: hardenedCommand.sessionId,
      attemptId: hardenedCommand.attemptId,
      turnId: hardenedCommand.turnId,
      toolCallId: hardenedCommand.toolCallId,
      connectionId: hardenedCommand.connectionId,
      command: hardenedCommand.command,
      args: hardenedCommand.args,
      workingDirectory,
      timeoutSeconds: hardenedCommand.timeoutSeconds,
    });
    const profile = await this.requireConnection(command.connectionId);
    return this.requestApprovedExecution(command, profile, signal, { grant, operation });
  }

  private requestApprovedExecution(
    command: SshAgentCommand,
    profile: SshConnectionProfile,
    signal?: AbortSignal,
    workspaceBinding?: WorkspaceExecutionBinding,
  ): Promise<SshCommandResult> {
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
      targetDisplay: connectionTargetDisplay(profile),
      rootLogin: profile.directTarget?.user === 'root',
      privilegeClass: connectionPrivilegeClass(profile),
      executionMode: workspaceBinding ? ('remote_workspace' as const) : ('diagnostic' as const),
      connectionVersion: profile.version,
      workspaceGrantId: workspaceBinding?.grant.id,
      workspaceGrantVersion: workspaceBinding?.grant.version,
      workspaceRoot: workspaceBinding?.grant.canonicalRoot,
      workspaceWorkingDirectory: workspaceBinding ? command.workingDirectory : undefined,
      workspaceOperation: workspaceBinding?.operation,
      commandSha256: hashCommand(command),
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
      const pendingEntry: PendingApproval = {
        request,
        profile,
        command,
        ...(workspaceBinding ? { workspaceBinding } : {}),
        timer,
        cancellation,
        settlement: singleSettlement(resolve, reject),
      };
      pending = pendingEntry;
      this.pendingApprovals.set(approvalId, pendingEntry);
      if (cancellation.controller.signal.aborted) {
        this.rejectPending(pendingEntry, 'cancelled', 'ssh_cancelled');
        return;
      }
      this.emitSshEvent({ type: 'approval.requested', request: copy(request) });
    });
  }

  /** Alias retained for the project-agent adapter's descriptive method name. */
  runAgentCommand(input: SshAgentCommand, signal?: AbortSignal) {
    return this.requestExecution(input, signal);
  }

  runAgentWorkspaceCommand(input: SshWorkspaceAgentCommand, signal?: AbortSignal) {
    return this.requestWorkspaceExecution(input, signal);
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
    this.resourceMonitor.invalidate();
    return this.cancelWhere(() => true);
  }

  private async requireConnection(connectionId: string) {
    await this.mutationTail;
    return this.readRequiredConnection(connectionId);
  }

  private async readBoundedResourceSnapshot(
    connection: SshConnectionProfile,
    force: boolean,
  ): Promise<SshServerResourceSnapshot> {
    try {
      return await this.resourceMonitor.read(connection, force ? { force: true } : {});
    } catch (error) {
      if (error instanceof SshResourceCaptureInvalidatedError) {
        throw new SshConnectionServiceError('ssh_unavailable');
      }
      throw error;
    }
  }

  private async readRequiredConnection(connectionId: string) {
    const profile = SshConnectionProfileSchema.array()
      .parse(copy(await this.storage.listSshConnections()))
      .find((entry) => entry.id === connectionId);
    if (!profile) throw new SshConnectionServiceError('ssh_connection_not_found');
    return profile;
  }

  private async readRequiredWorkspaceGrant(projectId: string, grantId: string) {
    const grant = RemoteWorkspaceGrantSchema.array()
      .parse(copy(await this.storage.listSshWorkspaceGrants(projectId)))
      .find((entry) => entry.id === grantId && entry.projectId === projectId);
    if (!grant) throw new SshConnectionServiceError('ssh_workspace_grant_not_found');
    return grant;
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

    // Queue the final state check behind any already-started profile/grant mutation. Starting the
    // transport inside the same serialized operation also prevents a later mutation from committing
    // between this check and the runner invocation.
    void this.mutate(async () => {
      this.throwIfCancelled(active);
      const [connections, grants] = await Promise.all([
        Promise.resolve(this.storage.listSshConnections()),
        pending.workspaceBinding
          ? Promise.resolve(this.storage.listSshWorkspaceGrants(pending.command.projectId))
          : Promise.resolve([]),
      ]);
      this.throwIfCancelled(active);
      const profile = SshConnectionProfileSchema.array()
        .parse(copy(connections))
        .find((entry) => entry.id === pending.profile.id);
      if (
        !profile ||
        profile.version !== pending.profile.version ||
        profile.hostAlias !== pending.profile.hostAlias ||
        profile.label !== pending.profile.label ||
        JSON.stringify(profile.directTarget ?? null) !==
          JSON.stringify(pending.profile.directTarget ?? null)
      ) {
        throw new SshConnectionServiceError('ssh_connection_version_conflict');
      }
      if (pending.workspaceBinding) {
        const grant = RemoteWorkspaceGrantSchema.array()
          .parse(copy(grants))
          .find((entry) => entry.id === pending.workspaceBinding!.grant.id);
        if (
          !grant ||
          grant.projectId !== pending.command.projectId ||
          grant.connectionId !== pending.command.connectionId ||
          grant.version !== pending.workspaceBinding.grant.version ||
          grant.canonicalRoot !== pending.workspaceBinding.grant.canonicalRoot ||
          grant.permissionMode !== pending.workspaceBinding.grant.permissionMode
        ) {
          throw new SshConnectionServiceError('ssh_workspace_grant_conflict');
        }
      }
      this.throwIfCancelled(active);
      const execution = this.runner.execute(
        profile.hostAlias,
        pending.command,
        {
          signal: active.cancellation.controller.signal,
          maxOutputCharacters: SSH_AGENT_TOOL_MAX_OUTPUT_CHARACTERS,
          failOnOutputLimit: false,
        },
        profile.directTarget ?? undefined,
      );
      return { execution };
    })
      .then(({ execution }) => execution)
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
