import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ExperimentRunLogService } from '../src/main/experiment-run-log-service';
import type {
  ExperimentWorkspaceServiceError,
  ExperimentWorkspaceService,
} from '../src/main/experiment-workspace-service';
import type { SshConnectionService } from '../src/main/ssh-connection-service';
import {
  EXPERIMENT_LOGGING_SYSTEM_FIELDS,
  ExperimentLoggingTemplateSchema,
  ExperimentRunSchema,
  ExperimentWorkspaceSnapshotSchema,
} from '../src/shared/experiment-workspace-contracts';

const projectId = randomUUID();
const runId = randomUUID();
const referenceId = randomUUID();
const grantId = randomUUID();
const connectionId = randomUUID();
const content = '{"event_type":"summary"}\n';
const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');

const template = ExperimentLoggingTemplateSchema.parse({
  schemaVersion: 1,
  id: randomUUID(),
  projectId,
  version: 1,
  previousRevisionId: null,
  systemFields: EXPERIMENT_LOGGING_SYSTEM_FIELDS,
  customFields: [],
  templateHash: 'a'.repeat(64),
  createdAt: '2026-08-11T00:00:00.000Z',
});

const run = ExperimentRunSchema.parse({
  schemaVersion: 1,
  id: runId,
  projectId,
  ideaId: null,
  title: 'Exploratory baseline',
  status: 'succeeded',
  mode: 'exploratory',
  serverLabel: 'GPU server',
  trialId: 'trial-1',
  objectiveId: null,
  objectiveVersion: null,
  loggingTemplate: {
    revisionId: template.id,
    version: template.version,
    systemFields: template.systemFields,
    customFields: template.customFields,
    templateHash: template.templateHash,
  },
  progressCurrent: null,
  progressTotal: null,
  currentStep: 'Completed',
  latestMetric: null,
  logReference: {
    referenceId,
    displayName: 'Exploratory baseline JSONL log',
    contentHash,
    sizeBytes: Buffer.byteLength(content),
    validationState: 'valid',
    missingFields: [],
  },
  processExitCode: 0,
  processDurationMs: 60_000,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:01:00.000Z',
  startedAt: '2026-08-11T00:00:00.000Z',
  completedAt: '2026-08-11T00:01:00.000Z',
  version: 2,
});

function fixture(
  options: {
    trusted?: boolean;
    returnedContent?: string;
    returnedHash?: string;
    returnedOffset?: number;
    returnedPath?: string;
    returnedTruncated?: boolean;
    storedHash?: string;
  } = {},
) {
  const fixtureRun = {
    ...run,
    logReference: {
      ...run.logReference!,
      contentHash: options.storedHash ?? contentHash,
    },
  };
  const snapshot = ExperimentWorkspaceSnapshotSchema.parse({
    schemaVersion: 1,
    projectId,
    loggingTemplate: template,
    ideas: [],
    metricPoints: [],
    runs: [fixtureRun],
  });
  const experiments = {
    list: vi.fn(async () => snapshot),
    getRunLogSource: vi.fn(async () => ({
      referenceId,
      projectId,
      runId,
      workspaceGrantId: grantId,
      workspaceSubdirectory: 'outputs',
      relativePath: 'logs/run.jsonl',
    })),
  } as unknown as ExperimentWorkspaceService;
  const returnedContent = options.returnedContent ?? content;
  const returnedOffset = options.returnedOffset ?? 0;
  const returnedTruncated = options.returnedTruncated ?? false;
  const returnedCharacters = [...returnedContent].length;
  const returnedTotalCharacters = returnedTruncated
    ? returnedOffset + returnedCharacters + 1
    : returnedOffset + returnedCharacters;
  const runAgentWorkspaceFileOperation = vi.fn(
    async (_operation: Parameters<SshConnectionService['runAgentWorkspaceFileOperation']>[0]) => ({
      schemaVersion: 1 as const,
      trust: 'untrusted_remote_output' as const,
      connectionLabel: 'GPU server',
      commandSha256: 'b'.repeat(64),
      exitCode: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        action: 'read',
        relativePath: options.returnedPath ?? 'logs/run.jsonl',
        content: returnedContent,
        contentSha256: options.returnedHash ?? contentHash,
        offset: returnedOffset,
        nextOffset: returnedTruncated ? returnedOffset + returnedCharacters : null,
        totalCharacters: returnedTotalCharacters,
        truncated: returnedTruncated,
      }),
      stderr: '',
      truncated: false,
      durationMs: 4,
    }),
  );
  const ssh = {
    listWorkspaceGrants: vi.fn(async () => [
      {
        grant: {
          id: grantId,
          projectId,
          connectionId,
          permissionMode: 'workspace',
          trustedAccess: options.trusted === false ? null : { enabled: true },
        },
        connection: { id: connectionId, label: 'GPU server' },
      },
    ]),
    runAgentWorkspaceFileOperation,
  } as unknown as Pick<
    SshConnectionService,
    'listWorkspaceGrants' | 'runAgentWorkspaceFileOperation'
  >;
  return {
    service: new ExperimentRunLogService({
      experiments,
      ssh,
      now: () => new Date('2026-08-11T00:02:00.000Z'),
    }),
    experiments,
    runAgentWorkspaceFileOperation,
  };
}

describe('ExperimentRunLogService', () => {
  it('reads the exact hashed remote JSONL chunk without exposing its path', async () => {
    const { service, runAgentWorkspaceFileOperation } = fixture();

    const result = await service.read({ projectId, runId, referenceId });

    expect(result).toMatchObject({
      schemaVersion: 1,
      runId,
      referenceId,
      content,
      contentHash,
      offset: 0,
      nextOffset: null,
      truncated: false,
      loadedAt: '2026-08-11T00:02:00.000Z',
    });
    expect(result).not.toHaveProperty('relativePath');
    expect(result).not.toHaveProperty('workspaceGrantId');
    expect(runAgentWorkspaceFileOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        connectionId,
        grantId,
        action: 'read',
        workspaceSubdirectory: 'outputs',
        relativePath: 'logs/run.jsonl',
      }),
    );
  });

  it('requires the explicit trusted-workspace switch outside Project Chat', async () => {
    const { service, runAgentWorkspaceFileOperation } = fixture({ trusted: false });

    await expect(service.read({ projectId, runId, referenceId })).rejects.toMatchObject({
      code: 'experiment_run_log_access_required',
    } satisfies Partial<ExperimentWorkspaceServiceError>);
    expect(runAgentWorkspaceFileOperation).not.toHaveBeenCalled();
  });

  it('refuses a server log whose full-content hash changed after validation', async () => {
    const { service } = fixture({ returnedHash: 'c'.repeat(64) });

    await expect(service.read({ projectId, runId, referenceId })).rejects.toMatchObject({
      code: 'experiment_run_log_changed',
    } satisfies Partial<ExperimentWorkspaceServiceError>);
  });

  it('locally hashes returned content instead of trusting a forged remote digest', async () => {
    const forgedContent = '{"event_type":"failure"}\n';
    expect(Buffer.byteLength(forgedContent)).toBe(Buffer.byteLength(content));
    const { service } = fixture({
      returnedContent: forgedContent,
      returnedHash: contentHash,
    });

    await expect(service.read({ projectId, runId, referenceId })).rejects.toMatchObject({
      code: 'experiment_run_log_changed',
    } satisfies Partial<ExperimentWorkspaceServiceError>);
  });

  it('accepts a stored digest with an explicit sha256 algorithm prefix', async () => {
    const { service } = fixture({ storedHash: `sha256:${contentHash}` });

    await expect(service.read({ projectId, runId, referenceId })).resolves.toMatchObject({
      content,
      contentHash: `sha256:${contentHash}`,
    });
  });

  it.each([
    ['wrong offset', { returnedOffset: 1 }],
    ['wrong path', { returnedPath: 'logs/other.jsonl' }],
    ['truncated file', { returnedContent: content.slice(0, -1), returnedTruncated: true }],
  ] as const)(
    'refuses a %s response even when the remote reports the stored hash',
    async (_case, options) => {
      const { service } = fixture({ ...options, returnedHash: contentHash });

      await expect(service.read({ projectId, runId, referenceId })).rejects.toMatchObject({
        code: 'experiment_run_log_changed',
      } satisfies Partial<ExperimentWorkspaceServiceError>);
    },
  );

  it('fetches the complete file for every request and paginates only after local verification', async () => {
    const { service, runAgentWorkspaceFileOperation } = fixture();

    const first = await service.read({
      projectId,
      runId,
      referenceId,
      maxCharacters: 5,
    });
    const second = await service.read({
      projectId,
      runId,
      referenceId,
      offset: first.nextOffset!,
      maxCharacters: 5,
    });

    expect(first).toMatchObject({
      content: [...content].slice(0, 5).join(''),
      offset: 0,
      nextOffset: 5,
      totalCharacters: [...content].length,
      truncated: true,
    });
    expect(second).toMatchObject({
      content: [...content].slice(5, 10).join(''),
      offset: 5,
      nextOffset: 10,
      totalCharacters: [...content].length,
      truncated: true,
    });
    expect(runAgentWorkspaceFileOperation).toHaveBeenCalledTimes(2);
    for (const [operation] of runAgentWorkspaceFileOperation.mock.calls) {
      expect(operation).toMatchObject({
        offset: 0,
        maxCharacters: 16_000,
      });
    }
  });

  it('does not allow a caller to substitute a different opaque reference', async () => {
    const { service, experiments, runAgentWorkspaceFileOperation } = fixture();

    await expect(
      service.read({ projectId, runId, referenceId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'experiment_run_log_source_invalid' });
    expect(experiments.getRunLogSource).not.toHaveBeenCalled();
    expect(runAgentWorkspaceFileOperation).not.toHaveBeenCalled();
  });
});
