import { createHash, randomUUID } from 'node:crypto';

import {
  ExperimentRunLogChunkSchema,
  ReadExperimentRunLogInputSchema,
  type ExperimentRunLogChunk,
  type ReadExperimentRunLogInput,
} from '../shared/experiment-workspace-contracts';
import { SSH_WORKSPACE_FILE_READ_MAX_CHARACTERS } from '../shared/ssh-workspace-contracts';
import { parseSshWorkspaceFileOutput } from './ssh-workspace-files';
import {
  ExperimentWorkspaceServiceError,
  type ExperimentWorkspaceService,
} from './experiment-workspace-service';
import { SshConnectionServiceError, type SshConnectionService } from './ssh-connection-service';

type ExperimentRunLogServiceOptions = Readonly<{
  experiments: ExperimentWorkspaceService;
  ssh: Pick<SshConnectionService, 'listWorkspaceGrants' | 'runAgentWorkspaceFileOperation'>;
  now?: () => Date;
}>;

function expectedSha256(contentHash: string) {
  return contentHash.startsWith('sha256:') ? contentHash.slice('sha256:'.length) : contentHash;
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Reads an already-validated JSONL log from its project-scoped remote workspace on demand.
 * Raw content exists only in the returned IPC value and is never written to GOSU storage.
 */
export class ExperimentRunLogService {
  private readonly experiments: ExperimentWorkspaceService;
  private readonly ssh: ExperimentRunLogServiceOptions['ssh'];
  private readonly now: () => Date;

  constructor(options: ExperimentRunLogServiceOptions) {
    this.experiments = options.experiments;
    this.ssh = options.ssh;
    this.now = options.now ?? (() => new Date());
  }

  async read(input: ReadExperimentRunLogInput): Promise<ExperimentRunLogChunk> {
    const command = ReadExperimentRunLogInputSchema.parse(input);
    const snapshot = await this.experiments.list({ projectId: command.projectId });
    const run = snapshot.runs.find(
      (candidate) => candidate.id === command.runId && candidate.projectId === command.projectId,
    );
    if (!run) throw new ExperimentWorkspaceServiceError('experiment_run_not_found');
    const reference = run.logReference;
    if (!reference || reference.referenceId !== command.referenceId) {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_source_invalid');
    }
    const source = await this.experiments.getRunLogSource({
      projectId: command.projectId,
      runId: command.runId,
      referenceId: command.referenceId,
    });
    if (!source) {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_unavailable');
    }
    const workspaces = await this.ssh.listWorkspaceGrants(command.projectId);
    const workspace = workspaces.find(({ grant }) => grant.id === source.workspaceGrantId);
    if (!workspace || workspace.grant.permissionMode !== 'workspace') {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_unavailable');
    }
    // Experiment view has no chat session approval scope. Requiring the explicit per-grant trusted
    // switch prevents a hidden or auto-denied Allow-once prompt while preserving the existing audit.
    if (!workspace.grant.trustedAccess) {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_access_required');
    }

    let result: Awaited<ReturnType<SshConnectionService['runAgentWorkspaceFileOperation']>>;
    try {
      result = await this.ssh.runAgentWorkspaceFileOperation({
        projectId: command.projectId,
        sessionId: randomUUID(),
        attemptId: randomUUID(),
        turnId: `experiment-log-read:${command.runId}`,
        toolCallId: randomUUID(),
        connectionId: workspace.connection.id,
        grantId: workspace.grant.id,
        ...(source.workspaceSubdirectory === null
          ? {}
          : { workspaceSubdirectory: source.workspaceSubdirectory }),
        action: 'read',
        relativePath: source.relativePath,
        // A page cannot be authenticated independently with only the stored full-file digest.
        // Always fetch the bounded complete file, verify it locally, and paginate afterwards.
        offset: 0,
        maxCharacters: SSH_WORKSPACE_FILE_READ_MAX_CHARACTERS,
      });
    } catch (error) {
      if (error instanceof SshConnectionServiceError) {
        throw new ExperimentWorkspaceServiceError('experiment_run_log_unavailable');
      }
      throw error;
    }
    if (result.exitCode !== 0 || result.stderr !== '' || result.truncated) {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_unavailable');
    }
    let output: ReturnType<typeof parseSshWorkspaceFileOutput>;
    try {
      output = parseSshWorkspaceFileOutput(result.stdout);
    } catch {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_unavailable');
    }
    if ('error' in output || output.action !== 'read') {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_unavailable');
    }
    const characters = [...output.content];
    const localSha256 = sha256(output.content);
    if (
      output.relativePath !== source.relativePath ||
      output.offset !== 0 ||
      output.truncated ||
      output.nextOffset !== null ||
      output.totalCharacters !== characters.length ||
      Buffer.byteLength(output.content, 'utf8') !== reference.sizeBytes ||
      output.contentSha256 !== localSha256 ||
      localSha256 !== expectedSha256(reference.contentHash)
    ) {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_changed');
    }

    const offset = command.offset ?? 0;
    if (offset > characters.length) {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_unavailable');
    }
    const maximum = command.maxCharacters ?? SSH_WORKSPACE_FILE_READ_MAX_CHARACTERS;
    const end = Math.min(characters.length, offset + maximum);
    const truncated = end < characters.length;

    try {
      return ExperimentRunLogChunkSchema.parse({
        schemaVersion: 1,
        runId: run.id,
        referenceId: reference.referenceId,
        displayName: reference.displayName,
        contentHash: reference.contentHash,
        content: characters.slice(offset, end).join(''),
        offset,
        nextOffset: truncated ? end : null,
        totalCharacters: characters.length,
        truncated,
        validationState: reference.validationState,
        missingFields: reference.missingFields,
        loadedAt: this.now().toISOString(),
      });
    } catch {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_unavailable');
    }
  }
}
