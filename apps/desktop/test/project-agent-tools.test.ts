import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  ProjectAgentToolSession,
  type ProjectAgentExperiments,
  type ProjectAgentLiterature,
  type ProjectAgentResearchNoteReceiptStorage,
  type ProjectAgentSsh,
  type ProjectAgentVault,
} from '../src/main/project-agent-tools';
import {
  prepareResearchNotesAgentMarkdown,
  type SaveResearchNoteForAgentInput,
} from '../src/main/research-notes-service';
import { WorkspaceService, type WorkspaceStorage } from '../src/main/workspace-service';
import type {
  CodexDynamicToolCall,
  CodexDynamicToolDelivery,
  CodexDynamicToolResult,
  CodexJsonValue,
} from '../src/main/codex-app-server';
import type { LocalNotesVaultGrant } from '../src/shared/project-chat-contracts';
import {
  EXPERIMENT_LOGGING_SYSTEM_FIELDS,
  type CreateExperimentRunInput,
  type ExperimentRun,
  type ExperimentWorkspaceSnapshot,
  type UpdateExperimentRunInput,
} from '../src/shared/experiment-workspace-contracts';
import type {
  LiteratureSearchInput,
  LiteratureSearchReceipt,
} from '../src/shared/literature-contracts';
import { resolveLiteratureSearchTags } from '../src/shared/literature-search-tags';
import type {
  SshAgentCommand,
  SshCommandResult,
  SshConnectionProfile,
  SshServerResourceSnapshot,
} from '../src/shared/ssh-contracts';
import type {
  GrantedRemoteWorkspace,
  SshWorkspaceAgentCommand,
  SshWorkspaceFileOperation,
} from '../src/shared/ssh-workspace-contracts';
import type { AgentVaultNoteChunk, AgentVaultNoteList } from '../src/shared/vault-contracts';
import type { WorkspaceOperation, WorkspaceSnapshot } from '../src/shared/workspace-contracts';

const PROJECT_TOOL_NAMESPACE = 'gosu_project';
const ACTIVE_VAULT_ID = 'a'.repeat(64);
const REPLACEMENT_VAULT_ID = 'b'.repeat(64);
const NOTE_ID = 'c'.repeat(64);
const NOTE_SHA256 = 'd'.repeat(64);
const NOTE_BODY = 'LOCAL_NOTE_BODY_MUST_NOT_ENTER_SOURCE_APPENDIX';
const RAW_NOTE_PATH = '/Users/researcher/private-vault/experiments/result.md';
const CHAT_SESSION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CHAT_ATTEMPT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SSH_CONNECTION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const SSH_GRANT_ID = 'abababab-abab-4bab-8bab-abababababab';
const LITERATURE_RUN_ID = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';

const objectiveFields = {
  goal: 'ALPHA_OBJECTIVE improve deterministic validation accuracy',
  primaryMetric: {
    key: 'accuracy',
    displayName: 'Validation accuracy',
    direction: 'maximize' as const,
    unit: 'ratio',
    aggregation: 'maximum' as const,
    evaluatorHash: 'evaluator:alpha123',
    datasetHash: 'dataset:alpha123',
    holdoutHash: 'holdout:alpha123',
    baseline: 0.8,
    target: 0.9,
  },
  guardrails: [{ metricKey: 'latency_ms', operator: 'lte' as const, threshold: 50 }],
  budget: {
    maxTrials: 10,
    maxConcurrentTrials: 2,
    maxWallTimeSeconds: 7_200,
    maxGpuHours: 4,
    maxFailures: 3,
  },
  stopPolicy: {
    stopWhenTargetReached: true,
    guardrailAction: 'pause' as const,
    maxConsecutiveNoImprovement: 5,
  },
};

class MemoryWorkspaceStorage implements WorkspaceStorage {
  state: WorkspaceSnapshot | null = null;
  readonly operations: WorkspaceOperation[] = [];

  load() {
    return this.state === null ? null : structuredClone(this.state);
  }

  commit(state: WorkspaceSnapshot, operation: WorkspaceOperation) {
    this.state = structuredClone(state);
    this.operations.push(structuredClone(operation));
  }

  pendingChanges() {
    return structuredClone(this.operations);
  }

  pendingSummary() {
    return {
      count: this.operations.length,
      latestWorkspaceRevision: this.operations.at(-1)?.workspaceRevision ?? null,
    };
  }
}

class FakeProjectVault implements ProjectAgentVault {
  activeVaultId: string | null = ACTIVE_VAULT_ID;
  readonly listForAgent = vi.fn(
    async (
      _projectId: string,
      expectedVaultId: string,
      _query?: string,
      _requestedLimit?: number,
    ): Promise<AgentVaultNoteList> => {
      this.assertGrant(expectedVaultId);
      return { notes: [{ noteId: NOTE_ID, title: 'Result study' }], truncated: false };
    },
  );
  readonly readForAgent = vi.fn(
    async (
      _projectId: string,
      expectedVaultId: string,
      noteId: string,
      requestedOffset = 0,
      requestedCharacters = 24_000,
    ): Promise<AgentVaultNoteChunk> => {
      this.assertGrant(expectedVaultId);
      if (noteId !== NOTE_ID) throw new Error('vault_note_not_found');
      const totalCharacters = 120_000;
      const content = 'n'.repeat(
        Math.max(0, Math.min(requestedCharacters, totalCharacters - requestedOffset)),
      );
      return {
        noteId,
        title: 'Result\n\tstudy',
        content,
        contentSha256: NOTE_SHA256,
        offset: requestedOffset,
        nextOffset:
          requestedOffset + content.length < totalCharacters
            ? requestedOffset + content.length
            : null,
        totalCharacters,
        truncated: requestedOffset + content.length < totalCharacters,
      };
    },
  );
  readonly saveMarkdownForAgent = vi.fn(
    async (projectId: string, expectedVaultId: string, input: SaveResearchNoteForAgentInput) => {
      this.assertGrant(expectedVaultId);
      const folders = {
        literature: 'Literature',
        papers: 'Papers',
        experiments: 'Experiments',
        'project-progress': 'Project Progress',
        'idea-development': 'Idea Development',
        lectures: 'Lecture Notes & Slides',
      } as const;
      const artifactId = createHash('sha256')
        .update(`${projectId}\0${expectedVaultId}\0${input.idempotencyKey}`, 'utf8')
        .digest('hex')
        .slice(0, 16);
      const storedContent = prepareResearchNotesAgentMarkdown(
        {
          id: projectId,
          name: 'Project Alpha',
          updatedAt: input.origin?.createdAt ?? '2026-01-01T00:00:00.000Z',
        },
        artifactId,
        input,
      );
      return {
        schemaVersion: 1 as const,
        projectId,
        category: input.category,
        path: `${folders[input.category]}/Saved artifact--${artifactId}.md`,
        created: true,
        contentSha256: createHash('sha256').update(storedContent, 'utf8').digest('hex'),
        artifactId,
      };
    },
  );

  descriptor(_projectId: string): LocalNotesVaultGrant | null {
    return this.activeVaultId ? { id: this.activeVaultId, name: 'Research Vault' } : null;
  }

  matchesGrant(_projectId: string, vaultId: string) {
    return this.activeVaultId === vaultId;
  }

  async validateGrant(_projectId: string, expectedVaultId: string) {
    this.assertGrant(expectedVaultId);
  }

  private assertGrant(expectedVaultId: string) {
    if (this.activeVaultId === null) throw new Error('vault_not_selected');
    if (this.activeVaultId !== expectedVaultId) throw new Error('vault_grant_stale');
  }
}

class FakeProjectSsh implements ProjectAgentSsh {
  grantVersion = 1;
  canonicalRoot = '/workspace';
  readonly connections: SshConnectionProfile[] = [
    {
      schemaVersion: 1,
      id: SSH_CONNECTION_ID,
      label: 'Training GPU',
      hostAlias: 'private-resolved-alias',
      directTarget: {
        host: 'sensitive-gpu.example.test',
        user: 'sensitive-remote-user',
        port: 4597,
        localForwards: [],
      },
      version: 1,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
  ];
  readonly listConnections = vi.fn(async () => structuredClone(this.connections));
  readonly readProjectResourceSnapshot = vi.fn(
    async (input: {
      projectId: string;
      connectionId: string;
    }): Promise<SshServerResourceSnapshot> => ({
      schemaVersion: 1,
      connectionId: input.connectionId,
      capturedAt: '2026-08-05T00:00:02.000Z',
      status: 'ready',
      cpu: {
        state: 'available',
        utilizationPercent: 37.5,
        logicalProcessorCount: 64,
      },
      memory: {
        state: 'available',
        usedBytes: 68_719_476_736,
        totalBytes: 137_438_953_472,
        utilizationPercent: 50,
      },
      gpu: {
        state: 'available',
        devices: [
          {
            index: 0,
            name: 'NVIDIA RTX 3080',
            utilizationPercent: 82,
            memoryUsedBytes: 8_589_934_592,
            memoryTotalBytes: 10_737_418_240,
            temperatureC: 71,
          },
        ],
      },
      issues: [],
    }),
  );
  readonly listWorkspaceGrants = vi.fn(
    async (projectId: string): Promise<readonly GrantedRemoteWorkspace[]> => [
      {
        grant: {
          schemaVersion: 1,
          id: SSH_GRANT_ID,
          projectId,
          connectionId: SSH_CONNECTION_ID,
          canonicalRoot: this.canonicalRoot,
          permissionMode: 'workspace',
          version: this.grantVersion,
          createdAt: '2026-08-05T00:00:00.000Z',
          updatedAt: '2026-08-05T00:00:00.000Z',
        },
        connection: this.connections[0]!,
      },
    ],
  );
  readonly runAgentCommand = vi.fn(async (_input: SshAgentCommand): Promise<SshCommandResult> => ({
    schemaVersion: 1,
    trust: 'untrusted_remote_output',
    connectionLabel: 'Training GPU',
    commandSha256: 'f'.repeat(64),
    exitCode: 0,
    stdout: 'GPU 0: ready',
    stderr: '',
    truncated: false,
    durationMs: 12,
  }));
  readonly runAgentWorkspaceCommand = vi.fn(
    async (_input: SshWorkspaceAgentCommand): Promise<SshCommandResult> => ({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: 'e'.repeat(64),
      exitCode: 0,
      stdout: 'GPU 0: ready',
      stderr: '',
      truncated: false,
      durationMs: 12,
    }),
  );
  readonly runAgentWorkspaceFileOperation = vi.fn(
    async (input: SshWorkspaceFileOperation): Promise<SshCommandResult> => {
      const stdout =
        input.action === 'list'
          ? JSON.stringify({
              schemaVersion: 1,
              action: 'list',
              entries: [{ relativePath: 'experiments/baseline.py', sizeBytes: 128 }],
              truncated: false,
            })
          : input.action === 'read'
            ? JSON.stringify({
                schemaVersion: 1,
                action: 'read',
                relativePath: input.relativePath,
                content: 'print("baseline")\n',
                contentSha256: '1'.repeat(64),
                offset: input.offset,
                nextOffset: null,
                totalCharacters: 18,
                truncated: false,
              })
            : JSON.stringify({
                schemaVersion: 1,
                action: 'write',
                relativePath: input.relativePath,
                created: input.expectedSha256 === null,
                previousSha256: input.expectedSha256,
                contentSha256: createHash('sha256').update(input.content, 'utf8').digest('hex'),
                sizeBytes: Buffer.byteLength(input.content, 'utf8'),
              });
      return {
        schemaVersion: 1,
        trust: 'untrusted_remote_output',
        connectionLabel: 'Training GPU',
        commandSha256: '9'.repeat(64),
        exitCode: 0,
        stdout,
        stderr: '',
        truncated: false,
        durationMs: 12,
      };
    },
  );
  readonly cancelSession = vi.fn(() => 1);
  readonly cancelProject = vi.fn(() => 1);
}

class FakeProjectLiterature implements ProjectAgentLiterature {
  readonly search = vi.fn(
    async (
      input: LiteratureSearchInput,
      _signal?: AbortSignal,
    ): Promise<LiteratureSearchReceipt> => {
      const completedAt = '2026-08-05T00:00:01.000Z';
      return {
        run: {
          schemaVersion: 1,
          id: LITERATURE_RUN_ID,
          projectId: input.projectId,
          provider: 'crossref',
          query: input.query,
          searchTags: resolveLiteratureSearchTags(input.query, input.searchTags),
          fromYear: input.fromYear ?? null,
          toYear: input.toYear ?? null,
          requestedLimit: input.limit ?? 25,
          status: 'complete',
          foundCount: 5,
          newCount: 3,
          updatedCount: 1,
          unchangedCount: 0,
          conflictCount: 1,
          conflicts: [
            {
              ordinal: 5,
              provider: 'crossref',
              providerRecordId: '10.1000/gosu.conflict',
              canonicalId: null,
              doi: '10.1000/gosu.conflict',
              fingerprint: 'c'.repeat(64),
              title: 'Ambiguous metadata fixture',
              authors: ['Ada Researcher'],
              publishedYear: 2026,
            },
          ],
          createdAt: '2026-08-05T00:00:00.000Z',
          completedAt,
        },
        foundCount: 5,
        coverage: {
          source: 'crossref',
          availableSignals: ['relevance'],
          degradationReasons: [
            'crossref-citation-lane-unavailable',
            'crossref-recent-lane-unavailable',
          ],
        },
        newCount: 3,
        updatedCount: 1,
        unchangedCount: 0,
        conflictCount: 1,
      };
    },
  );
}

class FakeProjectExperiments implements ProjectAgentExperiments {
  private readonly bindings = new Map<string, string>();
  private readonly executionIntents = new Map<
    string,
    {
      projectId: string;
      runId: string;
      workspaceGrantId: string;
      grantVersion: number;
      connectionId: string;
      connectionVersion: number;
      canonicalRoot: string;
      canonicalRootHash: string;
      policyVersion: number;
      executionPolicyHash: string;
      intentHash: string;
      workspaceSubdirectory: string | null;
      relativePath: string;
      createdAt: string;
    }
  >();
  private readonly logSources = new Map<string, unknown>();
  bindFailuresRemaining = 0;
  verifyingFailuresRemaining = 0;
  linkFailuresRemaining = 0;
  summaryFailuresRemaining = 0;
  comparableObjective: { id: string; version: number } | null = null;
  readonly linkRunLogSource = vi.fn(async (input) => {
    if (this.linkFailuresRemaining > 0) {
      this.linkFailuresRemaining -= 1;
      throw new Error('experiment_run_log_unavailable');
    }
    this.logSources.set(input.referenceId, structuredClone(input));
    return input;
  });
  readonly recordRunSummaryMetric = vi.fn(async (input) => {
    if (this.summaryFailuresRemaining > 0) {
      this.summaryFailuresRemaining -= 1;
      throw new Error('experiment_run_log_unavailable');
    }
    return input;
  });
  readonly snapshot: ExperimentWorkspaceSnapshot;

  constructor(readonly projectId: string) {
    this.snapshot = {
      schemaVersion: 1,
      projectId,
      loggingTemplate: {
        schemaVersion: 1,
        id: '11111111-aaaa-4111-8111-111111111111',
        projectId,
        version: 1,
        previousRevisionId: null,
        systemFields: EXPERIMENT_LOGGING_SYSTEM_FIELDS,
        customFields: [
          {
            key: 'step',
            label: 'Step',
            type: 'string',
            category: 'progress',
            requiredAt: ['progress'],
            unit: null,
          },
          {
            key: 'elapsed_seconds',
            label: 'Elapsed time',
            type: 'number',
            category: 'progress',
            requiredAt: ['progress', 'run-end'],
            unit: 's',
          },
        ],
        templateHash: '1'.repeat(64),
        createdAt: '2026-08-05T00:00:00.000Z',
      },
      ideas: [],
      metricPoints: [],
      runs: [],
    };
  }

  readonly list = vi.fn(async (input: { projectId: string }) => {
    if (input.projectId !== this.projectId) throw new Error('experiment_project_not_found');
    return structuredClone(this.snapshot);
  });

  readonly createRun = vi.fn(async (input: CreateExperimentRunInput): Promise<ExperimentRun> => {
    if (input.projectId !== this.projectId) throw new Error('experiment_project_not_found');
    const timestamp = '2026-08-05T00:00:01.000Z';
    const run: ExperimentRun = {
      schemaVersion: 1,
      id: randomUUID(),
      projectId: this.projectId,
      ideaId: input.ideaId,
      title: input.title,
      status: 'queued',
      mode: input.mode,
      serverLabel: input.serverLabel,
      trialId: input.trialId,
      objectiveId: input.mode === 'comparable' ? (this.comparableObjective?.id ?? null) : null,
      objectiveVersion:
        input.mode === 'comparable' ? (this.comparableObjective?.version ?? null) : null,
      loggingTemplate: {
        revisionId: this.snapshot.loggingTemplate.id,
        version: this.snapshot.loggingTemplate.version,
        systemFields: this.snapshot.loggingTemplate.systemFields,
        customFields: structuredClone(this.snapshot.loggingTemplate.customFields),
        templateHash: this.snapshot.loggingTemplate.templateHash,
      },
      progressCurrent: null,
      progressTotal: null,
      currentStep: null,
      latestMetric: null,
      logReference: null,
      processExitCode: null,
      processDurationMs: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
      version: 1,
    };
    (this.snapshot.runs as ExperimentRun[]).push(run);
    return structuredClone(run);
  });

  readonly updateRun = vi.fn(async (input: UpdateExperimentRunInput): Promise<ExperimentRun> => {
    if (input.projectId !== this.projectId) throw new Error('experiment_project_not_found');
    if (input.status === 'verifying' && this.verifyingFailuresRemaining > 0) {
      this.verifyingFailuresRemaining -= 1;
      throw new Error('experiment_run_conflict');
    }
    const index = this.snapshot.runs.findIndex((run) => run.id === input.runId);
    if (index < 0) throw new Error('experiment_run_not_found');
    const current = this.snapshot.runs[index]!;
    if (current.version !== input.expectedVersion) throw new Error('experiment_run_conflict');
    const timestamp = `2026-08-05T00:00:0${Math.min(9, current.version + 1)}.000Z`;
    const status = input.status ?? current.status;
    const terminal = ['succeeded', 'failed', 'cancelled', 'lost'].includes(status);
    const next: ExperimentRun = {
      ...current,
      status,
      progressCurrent:
        input.progressCurrent === undefined ? current.progressCurrent : input.progressCurrent,
      progressTotal:
        input.progressTotal === undefined ? current.progressTotal : input.progressTotal,
      currentStep: input.currentStep === undefined ? current.currentStep : input.currentStep,
      latestMetric:
        input.latestMetric === undefined
          ? current.latestMetric
          : input.latestMetric === null
            ? null
            : { ...input.latestMetric, recordedAt: timestamp },
      logReference: input.logReference === undefined ? current.logReference : input.logReference,
      processExitCode:
        input.processExitCode === undefined ? current.processExitCode : input.processExitCode,
      processDurationMs:
        input.processDurationMs === undefined ? current.processDurationMs : input.processDurationMs,
      startedAt:
        status === 'running' || status === 'verifying' || terminal
          ? (current.startedAt ?? timestamp)
          : current.startedAt,
      completedAt: terminal ? (current.completedAt ?? timestamp) : null,
      updatedAt: timestamp,
      version: current.version + 1,
    };
    (this.snapshot.runs as ExperimentRun[])[index] = next;
    return structuredClone(next);
  });

  readonly bindRunExecution = vi.fn(
    async (input: { projectId: string; runId: string; workspaceGrantId: string }) => {
      if (input.projectId !== this.projectId) throw new Error('experiment_project_not_found');
      if (!this.snapshot.runs.some((run) => run.id === input.runId)) {
        throw new Error('experiment_run_not_found');
      }
      if (this.bindFailuresRemaining > 0) {
        this.bindFailuresRemaining -= 1;
        throw new Error('experiment_run_conflict');
      }
      const existing = this.bindings.get(input.runId);
      if (existing && existing !== input.workspaceGrantId) {
        throw new Error('experiment_run_conflict');
      }
      this.bindings.set(input.runId, input.workspaceGrantId);
      return input;
    },
  );

  readonly getRunExecutionBinding = vi.fn(async (input: { projectId: string; runId: string }) => {
    if (input.projectId !== this.projectId) throw new Error('experiment_project_not_found');
    const workspaceGrantId = this.bindings.get(input.runId);
    return workspaceGrantId ? { ...input, workspaceGrantId } : null;
  });

  readonly stageRunExecutionIntent = vi.fn(
    async (input: {
      projectId: string;
      runId: string;
      workspaceGrantId: string;
      grantVersion: number;
      connectionId: string;
      connectionVersion: number;
      canonicalRoot: string;
      canonicalRootHash: string;
      policyVersion: number;
      executionPolicyHash: string;
      intentHash: string;
      workspaceSubdirectory: string | null;
      relativePath: string;
    }) => {
      if (input.projectId !== this.projectId) throw new Error('experiment_project_not_found');
      const existing = this.executionIntents.get(input.runId);
      if (existing) {
        const exact =
          existing.projectId === input.projectId &&
          existing.workspaceGrantId === input.workspaceGrantId &&
          existing.grantVersion === input.grantVersion &&
          existing.connectionId === input.connectionId &&
          existing.connectionVersion === input.connectionVersion &&
          existing.canonicalRoot === input.canonicalRoot &&
          existing.canonicalRootHash === input.canonicalRootHash &&
          existing.policyVersion === input.policyVersion &&
          existing.executionPolicyHash === input.executionPolicyHash &&
          existing.intentHash === input.intentHash &&
          existing.workspaceSubdirectory === input.workspaceSubdirectory &&
          existing.relativePath === input.relativePath;
        if (!exact) throw new Error('experiment_run_conflict');
        return structuredClone(existing);
      }
      const intent = {
        ...input,
        createdAt: '2026-08-05T00:00:01.500Z',
      };
      this.executionIntents.set(input.runId, intent);
      return structuredClone(intent);
    },
  );

  readonly getRunExecutionIntent = vi.fn(async (input: { projectId: string; runId: string }) => {
    if (input.projectId !== this.projectId) throw new Error('experiment_project_not_found');
    const intent = this.executionIntents.get(input.runId);
    return intent ? structuredClone(intent) : null;
  });

  readonly getRunLogSource = vi.fn(
    async (input: { projectId: string; runId: string; referenceId: string }) => {
      if (input.projectId !== this.projectId) throw new Error('experiment_project_not_found');
      return this.logSources.get(input.referenceId) ?? null;
    },
  );

  cancelExternally(runId: string) {
    const index = this.snapshot.runs.findIndex((run) => run.id === runId);
    const current = this.snapshot.runs[index]!;
    (this.snapshot.runs as ExperimentRun[])[index] = {
      ...current,
      status: 'cancelled',
      completedAt: '2026-08-05T00:00:09.000Z',
      updatedAt: '2026-08-05T00:00:09.000Z',
      version: current.version + 1,
    };
  }
}

async function workspaceFixture() {
  const workspace = new WorkspaceService(new MemoryWorkspaceStorage());
  const projectAlpha = await workspace.createProject({ name: 'Project Alpha' });
  const projectBeta = await workspace.createProject({ name: 'Project Beta' });
  const configuredAlpha = await workspace.updateBoardSettings({
    projectId: projectAlpha.id,
    expectedVersion: projectAlpha.version,
    board: {
      title: 'Alpha research flow',
      columnLabels: {
        backlog: 'Alpha ideas',
        planned: 'Alpha planned',
        in_progress: 'Alpha running',
        review: 'Alpha review',
        done: 'Alpha done',
      },
      columnOrder: ['backlog', 'planned', 'in_progress', 'review', 'done'],
      wipLimits: {
        backlog: 4,
        planned: 3,
        in_progress: 2,
        review: 1,
        done: null,
      },
    },
  });
  await workspace.createTask({
    projectId: projectAlpha.id,
    title: 'ALPHA_VISIBLE_TASK',
    status: 'in_progress',
  });
  await workspace.createTask({
    projectId: projectBeta.id,
    title: 'BETA_CROSS_PROJECT_SECRET',
    status: 'review',
  });
  await workspace.saveObjective({
    projectId: projectAlpha.id,
    expectedEntityVersion: 0,
    ...objectiveFields,
  });
  await workspace.saveObjective({
    projectId: projectBeta.id,
    expectedEntityVersion: 0,
    ...objectiveFields,
    goal: 'BETA_CROSS_PROJECT_OBJECTIVE',
    primaryMetric: {
      ...objectiveFields.primaryMetric,
      key: 'beta_secret_metric',
      displayName: 'Beta secret metric',
    },
  });
  return { workspace, projectAlpha: configuredAlpha, projectBeta };
}

function toolCall(
  tool: string,
  arguments_: CodexJsonValue,
  namespace: string | null = PROJECT_TOOL_NAMESPACE,
): CodexDynamicToolCall {
  return {
    threadId: 'thread-project-agent-tools',
    turnId: 'turn-project-agent-tools',
    callId: randomUUID(),
    namespace,
    tool,
    arguments: arguments_,
  };
}

function resultPayload(result: CodexDynamicToolResult): Record<string, unknown> {
  expect(result.contentItems).toHaveLength(1);
  return JSON.parse(result.contentItems[0]!.text) as Record<string, unknown>;
}

function delivery(
  outcome: CodexDynamicToolDelivery['outcome'] = Promise.resolve('delivered'),
): CodexDynamicToolDelivery {
  return { outcome, abortSignal: new AbortController().signal };
}

function delivered(): CodexDynamicToolDelivery {
  return delivery();
}

function invokeTool(session: ProjectAgentToolSession, call: CodexDynamicToolCall) {
  return session.handler(call, delivered());
}

function validExploratoryExperimentJsonl(run: ExperimentRun, step = 'fit') {
  const base = {
    schema_version: 1,
    template_version: run.loggingTemplate.version,
    objective_version: null,
    run_id: run.id,
    trial_id: run.trialId,
    server_label: run.serverLabel,
  };
  return [
    {
      ...base,
      occurred_at: '2026-08-05T00:00:02.000Z',
      event_type: 'run-start',
      sequence: 1,
      status: 'running',
    },
    {
      ...base,
      occurred_at: '2026-08-05T00:00:03.000Z',
      event_type: 'progress',
      sequence: 2,
      status: 'running',
      step,
      elapsed_seconds: 1,
    },
    {
      ...base,
      occurred_at: '2026-08-05T00:00:04.000Z',
      event_type: 'run-end',
      sequence: 3,
      status: 'succeeded',
      elapsed_seconds: 2,
    },
  ]
    .map((record) => JSON.stringify(record))
    .join('\n');
}

function validComparableExperimentJsonl(run: ExperimentRun, metricValue: number) {
  const base = {
    schema_version: 1,
    template_version: run.loggingTemplate.version,
    objective_version: run.objectiveVersion,
    run_id: run.id,
    trial_id: run.trialId,
    server_label: run.serverLabel,
  };
  return [
    {
      ...base,
      occurred_at: '2026-08-05T00:00:02.000Z',
      event_type: 'run-start',
      sequence: 1,
      status: 'running',
    },
    {
      ...base,
      occurred_at: '2026-08-05T00:00:03.000Z',
      event_type: 'progress',
      sequence: 2,
      status: 'running',
      step: 'fit',
      elapsed_seconds: 1,
    },
    {
      ...base,
      occurred_at: '2026-08-05T00:00:04.000Z',
      event_type: 'run-end',
      sequence: 3,
      status: 'succeeded',
      elapsed_seconds: 2,
    },
    {
      ...base,
      occurred_at: '2026-08-05T00:00:05.000Z',
      event_type: 'summary',
      sequence: 4,
      status: 'succeeded',
      accuracy: metricValue,
    },
  ]
    .map((record) => JSON.stringify(record))
    .join('\n');
}

function experimentLogReadResult(relativePath: string, content: string): SshCommandResult {
  return {
    schemaVersion: 1,
    trust: 'untrusted_remote_output',
    connectionLabel: 'Training GPU',
    commandSha256: '9'.repeat(64),
    exitCode: 0,
    stdout: JSON.stringify({
      schemaVersion: 1,
      action: 'read',
      relativePath,
      content,
      contentSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
      offset: 0,
      nextOffset: null,
      totalCharacters: [...content].length,
      truncated: false,
    }),
    stderr: '',
    truncated: false,
    durationMs: 3,
  };
}

const experimentCoveragePlan = [
  { lifecycle: 'progress' as const, fields: ['step', 'elapsed_seconds'] },
  { lifecycle: 'run-end' as const, fields: ['elapsed_seconds'] },
];

function authorizedSession(
  workspace: WorkspaceService,
  projectId: string,
  vault = new FakeProjectVault(),
  ssh = new FakeProjectSsh(),
  literature = new FakeProjectLiterature(),
  experiments?: ProjectAgentExperiments,
) {
  return {
    session: new ProjectAgentToolSession({
      projectId,
      sessionId: CHAT_SESSION_ID,
      attemptId: CHAT_ATTEMPT_ID,
      workspace,
      vault,
      localNotesVault: {
        id: ACTIVE_VAULT_ID,
        name: 'Research Vault',
        allowAgentMarkdownCreate: true,
      },
      literature,
      ssh,
      ...(experiments ? { experiments } : {}),
    }),
    vault,
    literature,
    ssh,
  };
}

describe('ProjectAgentToolSession', () => {
  it('binds Board and Objective reads to the active project', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session } = authorizedSession(workspace, projectAlpha.id);

    const boardResult = await invokeTool(session, toolCall('read_workspace', { section: 'board' }));
    const boardPayload = resultPayload(boardResult);
    const serializedBoard = JSON.stringify(boardPayload);
    expect(boardResult.success).toBe(true);
    expect(boardPayload).toMatchObject({
      schemaVersion: 1,
      board: {
        title: 'Alpha research flow',
        taskCount: 1,
        tasks: [{ title: 'ALPHA_VISIBLE_TASK', statusLabel: 'Alpha running' }],
      },
    });
    expect(serializedBoard).not.toContain('BETA_CROSS_PROJECT_SECRET');

    const objectiveResult = await invokeTool(
      session,
      toolCall('read_workspace', { section: 'objective' }),
    );
    const objectivePayload = resultPayload(objectiveResult);
    const serializedObjective = JSON.stringify(objectivePayload);
    expect(objectiveResult.success).toBe(true);
    expect(objectivePayload).toMatchObject({
      schemaVersion: 1,
      objective: {
        goal: objectiveFields.goal,
        primaryMetric: { key: 'accuracy' },
      },
    });
    expect(serializedObjective).not.toContain('BETA_CROSS_PROJECT_OBJECTIVE');
    expect(serializedObjective).not.toContain('beta_secret_metric');
  });

  it('rejects attempts to select another project or an undeclared namespace', async () => {
    const { workspace, projectAlpha, projectBeta } = await workspaceFixture();
    const { session } = authorizedSession(workspace, projectAlpha.id);

    const forgedProject = await invokeTool(
      session,
      toolCall('read_workspace', { section: 'board', projectId: projectBeta.id }),
    );
    expect(forgedProject.success).toBe(false);
    expect(resultPayload(forgedProject)).toEqual({ error: 'invalid_tool_arguments' });

    const wrongNamespace = await invokeTool(
      session,
      toolCall('read_workspace', { section: 'board' }, 'another_project'),
    );
    expect(wrongNamespace.success).toBe(false);
    expect(resultPayload(wrongNamespace)).toEqual({ error: 'tool_not_allowed' });
  });

  it('revokes every project-bound read after the project is archived', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, vault, literature, ssh } = authorizedSession(workspace, projectAlpha.id);
    await workspace.setProjectArchived({
      projectId: projectAlpha.id,
      expectedVersion: projectAlpha.version,
      archived: true,
    });

    for (const call of [
      toolCall('read_workspace', { section: 'summary' }),
      toolCall('list_local_notes', {}),
      toolCall('read_local_note', { noteId: NOTE_ID }),
      toolCall('search_literature', { query: 'tabular foundation models' }),
      toolCall('list_ssh_workspaces', {}),
      toolCall('read_ssh_workspace_resources', { grantId: SSH_GRANT_ID }),
      toolCall('list_ssh_workspace_files', { grantId: SSH_GRANT_ID }),
      toolCall('read_ssh_workspace_file', {
        grantId: SSH_GRANT_ID,
        relativePath: 'experiments/baseline.py',
      }),
      toolCall('write_ssh_workspace_file', {
        grantId: SSH_GRANT_ID,
        relativePath: 'experiments/new.py',
        content: 'print("new")\n',
        expectedSha256: null,
      }),
      toolCall('run_ssh_workspace_command', {
        grantId: SSH_GRANT_ID,
        command: '/usr/bin/git',
        args: ['status'],
      }),
    ]) {
      const result = await invokeTool(session, call);
      expect(result.success).toBe(false);
      expect(resultPayload(result)).toEqual({ error: 'project_archived' });
    }
    expect(vault.listForAgent).not.toHaveBeenCalled();
    expect(vault.readForAgent).not.toHaveBeenCalled();
    expect(vault.saveMarkdownForAgent).not.toHaveBeenCalled();
    expect(literature.search).not.toHaveBeenCalled();
    expect(ssh.listWorkspaceGrants).not.toHaveBeenCalled();
    expect(ssh.runAgentWorkspaceCommand).not.toHaveBeenCalled();
    expect(ssh.runAgentWorkspaceFileOperation).not.toHaveBeenCalled();
  });

  it('lists and reads only explicitly granted Local Notes through opaque IDs', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, vault } = authorizedSession(workspace, projectAlpha.id);

    const declaredTools = session.dynamicTools.flatMap((spec) =>
      spec.type === 'namespace' ? spec.tools.map((tool) => tool.name) : [spec.name],
    );
    expect(declaredTools).toEqual([
      'read_workspace',
      'list_local_notes',
      'read_local_note',
      'search_literature',
      'list_ssh_workspaces',
      'read_ssh_workspace_resources',
      'list_ssh_workspace_files',
      'read_ssh_workspace_file',
      'write_ssh_workspace_file',
      'run_ssh_workspace_command',
    ]);
    const declaredCatalog = JSON.stringify(session.dynamicTools);
    expect(declaredCatalog).toContain('searchTags');
    expect(declaredCatalog).toContain('workflow provenance labels');
    expect(declaredCatalog).toContain('provider-supplied subjects');
    expect(declaredCatalog).toContain('read-only Git inspection');
    expect(declaredCatalog).toContain('create_experiment_run');
    expect(declaredCatalog).toContain('not a hard remote sandbox or unattended Runner');
    expect(declaredCatalog).toContain('expectedSha256');
    expect(declaredCatalog).toContain('hash-check');
    expect(declaredCatalog).toContain('delete, rename, chmod, binary/large-file access');

    const listed = await invokeTool(
      session,
      toolCall('list_local_notes', { query: 'result', limit: 7 }),
    );
    expect(listed.success).toBe(true);
    expect(resultPayload(listed)).toEqual({
      schemaVersion: 1,
      notes: [{ noteId: NOTE_ID, title: 'Result study' }],
      truncated: false,
    });
    expect(vault.listForAgent).toHaveBeenCalledWith(projectAlpha.id, ACTIVE_VAULT_ID, 'result', 7);
    expect(JSON.stringify(resultPayload(listed))).not.toContain(RAW_NOTE_PATH);

    const read = await invokeTool(
      session,
      toolCall('read_local_note', { noteId: NOTE_ID, offset: 4, maxCharacters: 32 }),
    );
    const readPayload = resultPayload(read);
    expect(read.success).toBe(true);
    expect(readPayload).toMatchObject({
      schemaVersion: 1,
      trust: 'untrusted_local_research_note',
      noteId: NOTE_ID,
      title: 'Result\n\tstudy',
      content: 'n'.repeat(32),
      contentSha256: NOTE_SHA256,
      offset: 4,
      sessionCharactersRemaining: 96_000 - 32,
    });
    expect(vault.readForAgent).toHaveBeenCalledWith(
      projectAlpha.id,
      ACTIVE_VAULT_ID,
      NOTE_ID,
      4,
      32,
    );
    expect(JSON.stringify(readPayload)).not.toContain(RAW_NOTE_PATH);
  });

  it('persists one structured response artifact and appends only an authoritative receipt', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, vault } = authorizedSession(workspace, projectAlpha.id);
    const content = '# Evaluation plan\n\nCompare three seeded trials.\n';

    await session.persistResponseResearchNote(
      {
        disposition: 'save',
        category: 'experiments',
        title: 'Evaluation plan',
        content,
      },
      true,
      {
        sessionName: 'Evaluation branch',
        creatorId: 'gpt-fixture',
        creatorName: 'GOSU Project Chat',
        relatedDocuments: ['Experiments/Experiment Log.md'],
        relatedPapers: ['https://doi.org/10.1000/fixture'],
        provenance: { invocation_id: 'fixture-invocation' },
      },
    );

    expect(vault.saveMarkdownForAgent).toHaveBeenCalledExactlyOnceWith(
      projectAlpha.id,
      ACTIVE_VAULT_ID,
      expect.objectContaining({
        category: 'experiments',
        title: 'Evaluation plan',
        content,
        idempotencyKey: expect.stringMatching(/^[0-9a-f]{64}$/u),
        origin: expect.objectContaining({
          createdAt: expect.any(String),
          sessionId: CHAT_SESSION_ID,
          sessionName: 'Evaluation branch',
          creatorId: 'gpt-fixture',
          creatorName: 'GOSU Project Chat',
          relatedDocuments: ['Experiments/Experiment Log.md'],
          relatedPapers: ['https://doi.org/10.1000/fixture'],
          provenance: expect.objectContaining({
            attempt_id: CHAT_ATTEMPT_ID,
            invocation_id: 'fixture-invocation',
          }),
        }),
      }),
    );
    const saved = await vault.saveMarkdownForAgent.mock.results[0]!.value;
    const appendix = await session.finalizeSourceAppendix();
    expect(appendix).toContain('Research Notes saved');
    expect(appendix).toMatch(/Research Notes\/Experiments\/Saved artifact--[0-9a-f]{16}\.md/u);
    expect(appendix).toContain(saved.contentSha256);
    expect(appendix).not.toContain(content);
    expect(appendix).not.toContain('/Users/');
  });

  it('stages body-free metadata before writing and promotes a late verified save after timeout', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const vault = new FakeProjectVault();
    const originalSave = vault.saveMarkdownForAgent.getMockImplementation()!;
    const events: string[] = [];
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    vault.saveMarkdownForAgent.mockImplementationOnce(async (...arguments_) => {
      events.push('write');
      await saveGate;
      return originalSave(...arguments_);
    });
    const receipts: ProjectAgentResearchNoteReceiptStorage = {
      stageResearchNoteSave: vi.fn(async (receipt) => {
        events.push('stage');
        expect(JSON.stringify(receipt)).not.toContain('PRIVATE_MARKDOWN_BODY');
        expect(JSON.stringify(receipt)).not.toContain('Private title');
      }),
      markResearchNoteSaveUncertain: vi.fn(async () => {
        events.push('uncertain');
      }),
      confirmResearchNoteSave: vi.fn(async () => {
        events.push('confirmed');
      }),
    };
    const session = new ProjectAgentToolSession({
      projectId: projectAlpha.id,
      sessionId: CHAT_SESSION_ID,
      attemptId: CHAT_ATTEMPT_ID,
      workspace,
      vault,
      localNotesVault: {
        id: ACTIVE_VAULT_ID,
        name: 'Research Vault',
        allowAgentMarkdownCreate: true,
      },
      researchNoteReceipts: receipts,
      researchNoteSaveTimeoutMs: 5,
    });

    await session.persistResponseResearchNote({
      disposition: 'save',
      category: 'project-progress',
      title: 'Private title',
      content: '# PRIVATE_MARKDOWN_BODY\n',
    });

    expect(events.slice(0, 3)).toEqual(['stage', 'write', 'uncertain']);
    expect(receipts.stageResearchNoteSave).toHaveBeenCalledTimes(1);
    expect(receipts.confirmResearchNoteSave).not.toHaveBeenCalled();
    const sealedAppendix = await session.finalizeSourceAppendix();
    expect(sealedAppendix).toContain('Research Notes save confirmation pending');
    expect(sealedAppendix).toContain('no saved path is claimed yet');
    expect(sealedAppendix).not.toContain('Research Notes saved');

    releaseSave();
    await vi.waitFor(() => expect(receipts.confirmResearchNoteSave).toHaveBeenCalledTimes(1));
    expect(events.at(-1)).toBe('confirmed');
    expect(await session.finalizeSourceAppendix()).toBe(sealedAppendix);
  });

  it('does not write for disposition none or without explicit Markdown-create consent', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const vault = new FakeProjectVault();
    const noGrant = new ProjectAgentToolSession({
      projectId: projectAlpha.id,
      sessionId: CHAT_SESSION_ID,
      attemptId: CHAT_ATTEMPT_ID,
      workspace,
      vault,
      localNotesVault: null,
    });
    await noGrant.persistResponseResearchNote({ disposition: 'none' });
    expect(await noGrant.finalizeSourceAppendix()).toBe('');

    const legacy = new ProjectAgentToolSession({
      projectId: projectAlpha.id,
      sessionId: CHAT_SESSION_ID,
      attemptId: CHAT_ATTEMPT_ID,
      workspace,
      vault,
      localNotesVault: { id: ACTIVE_VAULT_ID, name: 'Legacy read grant' },
    });
    expect((await invokeTool(legacy, toolCall('list_local_notes', {}))).success).toBe(true);
    await legacy.persistResponseResearchNote({
      disposition: 'save',
      category: 'project-progress',
      title: 'Must opt in',
      content: '# Must opt in\n',
    });

    expect(vault.saveMarkdownForAgent).not.toHaveBeenCalled();
    expect(await legacy.finalizeSourceAppendix()).toContain(
      'existing Research Notes grant is read-only',
    );
  });

  it('rejects a mismatched save receipt as commit-uncertain', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const vault = new FakeProjectVault();
    vault.saveMarkdownForAgent.mockResolvedValueOnce({
      schemaVersion: 1,
      projectId: projectAlpha.id,
      category: 'papers',
      path: 'Papers/Wrong--0123456789abcdef.md',
      created: true,
      contentSha256: 'a'.repeat(64),
      artifactId: '0123456789abcdef',
    });
    const { session } = authorizedSession(workspace, projectAlpha.id, vault);

    await session.persistResponseResearchNote({
      disposition: 'save',
      category: 'experiments',
      title: 'Expected experiment',
      content: '# Expected experiment\n',
    });

    const appendix = await session.finalizeSourceAppendix();
    expect(appendix).toContain('Research Notes save confirmation pending');
    expect(appendix).toContain('no saved path is claimed yet');
    expect(appendix).not.toContain('Research Notes saved');
  });

  it('injects the active project into bounded Crossref searches and returns persisted counts', async () => {
    const { workspace, projectAlpha, projectBeta } = await workspaceFixture();
    const { session, literature } = authorizedSession(workspace, projectAlpha.id);
    const controller = new AbortController();
    const call = toolCall('search_literature', {
      query: 'tabular foundation models',
      searchTags: {
        topics: ['Tabular learning'],
        keywords: ['foundation models', 'TabPFN'],
      },
      fromYear: 2022,
      toYear: 2026,
      limit: 12,
    });

    const result = await session.handler(call, {
      outcome: Promise.resolve('delivered'),
      abortSignal: controller.signal,
    });

    expect(result.success).toBe(true);
    expect(resultPayload(result)).toEqual({
      schemaVersion: 1,
      provider: 'crossref',
      policyId: 'crossref-basic',
      policyVersion: 1,
      metadataOnly: true,
      persisted: true,
      runId: LITERATURE_RUN_ID,
      query: 'tabular foundation models',
      searchTags: {
        topics: ['Tabular learning'],
        keywords: ['foundation models', 'TabPFN'],
      },
      foundCount: 5,
      retrievedCount: 5,
      selectedCount: 5,
      tierCounts: { core: 0, rising: 0, broad: 0 },
      coverage: {
        source: 'crossref',
        availableSignals: ['relevance'],
        degradationReasons: [
          'crossref-citation-lane-unavailable',
          'crossref-recent-lane-unavailable',
        ],
      },
      newCount: 3,
      updatedCount: 1,
      unchangedCount: 0,
      conflictCount: 1,
      conflicts: [
        {
          ordinal: 5,
          canonicalId: null,
          doi: '10.1000/gosu.conflict',
          providerRecordId: '10.1000/gosu.conflict',
          title: 'Ambiguous metadata fixture',
        },
      ],
      omittedConflictCount: 0,
    });
    expect(literature.search).toHaveBeenCalledExactlyOnceWith(
      {
        projectId: projectAlpha.id,
        query: 'tabular foundation models',
        searchTags: {
          topics: ['Tabular learning'],
          keywords: ['foundation models', 'TabPFN'],
        },
        fromYear: 2022,
        toYear: 2026,
        limit: 12,
      },
      expect.any(AbortSignal),
    );
    expect(JSON.stringify(resultPayload(result))).not.toContain(projectBeta.id);

    const forged = await invokeTool(
      session,
      toolCall('search_literature', {
        projectId: projectBeta.id,
        query: 'cross-project request',
      }),
    );
    expect(forged.success).toBe(false);
    expect(resultPayload(forged)).toEqual({ error: 'invalid_tool_arguments' });
    expect(literature.search).toHaveBeenCalledOnce();
  });

  it('bounds conflict disclosure after a successful maximum-size Literature search', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const literature = new FakeProjectLiterature();
    const completedAt = '2026-08-05T00:00:01.000Z';
    const conflicts = Array.from({ length: 3 }, (_, index) => ({
      ordinal: index + 1,
      provider: 'crossref' as const,
      providerRecordId: `crossref-${index}-${'p'.repeat(2_000)}`,
      canonicalId: null,
      doi: `10.1000/${'d'.repeat(490)}${index}`,
      fingerprint: `${index}`.repeat(64),
      title: `${index}:${'t'.repeat(1_998)}`,
      authors: ['Ada Researcher'],
      publishedYear: 2026,
    }));
    literature.search.mockResolvedValueOnce({
      run: {
        schemaVersion: 1,
        id: LITERATURE_RUN_ID,
        projectId: projectAlpha.id,
        provider: 'crossref',
        query: 'maximum conflict preview',
        fromYear: null,
        toYear: null,
        requestedLimit: 50,
        status: 'complete',
        foundCount: 50,
        newCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        conflictCount: 50,
        conflicts,
        createdAt: '2026-08-05T00:00:00.000Z',
        completedAt,
      },
      foundCount: 50,
      newCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      conflictCount: 50,
    });
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      new FakeProjectSsh(),
      literature,
    );

    const result = await invokeTool(
      session,
      toolCall('search_literature', { query: 'maximum conflict preview', limit: 50 }),
    );
    const payload = resultPayload(result) as {
      conflicts: unknown[];
      omittedConflictCount: number;
    };

    expect(result.success).toBe(true);
    expect(payload.conflicts).toHaveLength(3);
    expect(payload.omittedConflictCount).toBe(47);
    expect(JSON.stringify(payload).length).toBeLessThan(48_000);
  });

  it('validates Literature search bounds and revokes an in-flight search with the turn', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const literature = new FakeProjectLiterature();
    let observedSignal: AbortSignal | undefined;
    literature.search.mockImplementationOnce(
      (_input, signal) =>
        new Promise<LiteratureSearchReceipt>((_resolve, reject) => {
          observedSignal = signal;
          signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        }),
    );
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      new FakeProjectSsh(),
      literature,
    );

    for (const arguments_ of [
      { query: '' },
      { query: 'x', fromYear: 2027, toYear: 2026 },
      { query: 'x', limit: 1 },
      { query: 'x', limit: 2 },
      { query: 'x', limit: 51 },
      { query: 'x', searchTags: { topics: Array.from({ length: 13 }, (_, index) => `t${index}`) } },
      {
        query: 'x',
        searchTags: { keywords: Array.from({ length: 25 }, (_, index) => `k${index}`) },
      },
      { query: 'x', searchTags: { topics: ['t'.repeat(121)] } },
      { query: 'x', searchTags: { topics: ['topic'], source: 'provider' } },
      { query: 'x', provider: 'another-origin' },
    ]) {
      const invalid = await invokeTool(session, toolCall('search_literature', arguments_));
      expect(resultPayload(invalid)).toEqual({ error: 'invalid_tool_arguments' });
    }
    expect(literature.search).not.toHaveBeenCalled();

    const pending = invokeTool(
      session,
      toolCall('search_literature', { query: 'cancel this literature search' }),
    );
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    session.revokeLiteratureCapability();
    await expect(pending).resolves.toMatchObject({ success: false });
    expect(resultPayload(await pending)).toEqual({ error: 'literature_search_cancelled' });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('lists only opaque SSH IDs and labels, never aliases or resolved connection data', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, ssh } = authorizedSession(workspace, projectAlpha.id);

    const listed = await invokeTool(session, toolCall('list_ssh_workspaces', {}));
    const serialized = listed.contentItems[0]!.text;

    expect(listed.success).toBe(true);
    expect(resultPayload(listed)).toEqual({
      schemaVersion: 1,
      setupState: 'ready',
      registeredConnectionCount: 1,
      workspaces: [
        {
          grantId: SSH_GRANT_ID,
          connectionLabel: 'Training GPU',
          permissionMode: 'workspace',
          trustedAccess: false,
        },
      ],
    });
    expect(ssh.listWorkspaceGrants).toHaveBeenCalledExactlyOnceWith(projectAlpha.id);
    expect(ssh.listConnections).toHaveBeenCalledOnce();
    expect(serialized).not.toContain('private-resolved-alias');
    expect(serialized).not.toContain('hostAlias');
    expect(serialized).not.toContain('sensitive-gpu.example.test');
    expect(serialized).not.toContain('sensitive-remote-user');
    expect(serialized).not.toContain('directTarget');
  });

  it('distinguishes a missing project grant from having no registered SSH connection', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, ssh } = authorizedSession(workspace, projectAlpha.id);
    ssh.listWorkspaceGrants.mockResolvedValue([]);

    const grantRequired = await invokeTool(session, toolCall('list_ssh_workspaces', {}));
    const grantRequiredText = grantRequired.contentItems[0]!.text;

    expect(grantRequired.success).toBe(true);
    expect(resultPayload(grantRequired)).toEqual({
      schemaVersion: 1,
      setupState: 'workspace_grant_required',
      registeredConnectionCount: 1,
      workspaces: [],
    });
    expect(grantRequiredText).not.toContain('Training GPU');
    expect(grantRequiredText).not.toContain('private-resolved-alias');
    expect(grantRequiredText).not.toContain('hostAlias');
    expect(grantRequiredText).not.toContain('sensitive-gpu.example.test');
    expect(grantRequiredText).not.toContain('sensitive-remote-user');
    expect(grantRequiredText).not.toContain('directTarget');

    ssh.connections.splice(0);
    const registrationRequired = await invokeTool(session, toolCall('list_ssh_workspaces', {}));

    expect(registrationRequired.success).toBe(true);
    expect(resultPayload(registrationRequired)).toEqual({
      schemaVersion: 1,
      setupState: 'no_registered_connections',
      registeredConnectionCount: 0,
      workspaces: [],
    });
    expect(ssh.listWorkspaceGrants).toHaveBeenCalledTimes(2);
    expect(ssh.listConnections).toHaveBeenCalledTimes(2);

    const denied = await invokeTool(
      session,
      toolCall('run_ssh_workspace_command', {
        grantId: SSH_GRANT_ID,
        command: '/usr/bin/git',
        args: ['status'],
      }),
    );
    expect(denied.success).toBe(false);
    expect(resultPayload(denied)).toEqual({ error: 'ssh_workspace_grant_not_found' });
    expect(ssh.runAgentWorkspaceCommand).not.toHaveBeenCalled();
  });

  it('reads only normalized resource telemetry for a currently granted SSH workspace', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, ssh } = authorizedSession(workspace, projectAlpha.id);

    const result = await invokeTool(
      session,
      toolCall('read_ssh_workspace_resources', { grantId: SSH_GRANT_ID }),
    );
    const payload = resultPayload(result);
    const serialized = result.contentItems[0]!.text;

    expect(result.success).toBe(true);
    expect(payload).toEqual({
      schemaVersion: 1,
      trust: 'untrusted_remote_telemetry',
      connectionLabel: 'Training GPU',
      permissionMode: 'workspace',
      capturedAt: '2026-08-05T00:00:02.000Z',
      status: 'ready',
      cpu: {
        state: 'available',
        utilizationPercent: 37.5,
        logicalProcessorCount: 64,
      },
      memory: {
        state: 'available',
        usedBytes: 68_719_476_736,
        totalBytes: 137_438_953_472,
        utilizationPercent: 50,
      },
      gpu: {
        state: 'available',
        devices: [
          {
            index: 0,
            name: 'NVIDIA RTX 3080',
            utilizationPercent: 82,
            memoryUsedBytes: 8_589_934_592,
            memoryTotalBytes: 10_737_418_240,
            temperatureC: 71,
          },
        ],
      },
      issues: [],
    });
    expect(ssh.readProjectResourceSnapshot).toHaveBeenCalledExactlyOnceWith({
      projectId: projectAlpha.id,
      connectionId: SSH_CONNECTION_ID,
    });
    expect(ssh.listWorkspaceGrants).toHaveBeenCalledTimes(2);
    expect(serialized).not.toContain(SSH_CONNECTION_ID);
    expect(serialized).not.toContain(SSH_GRANT_ID);
    expect(serialized).not.toContain('/workspace');
    expect(serialized).not.toContain('private-resolved-alias');
    expect(serialized).not.toContain('sensitive-gpu.example.test');
    expect(serialized).not.toContain('sensitive-remote-user');
    expect(serialized).not.toContain('nvidia-smi');
    expect(serialized).not.toContain('stdout');
  });

  it('withholds a completed resource snapshot when its project grant is revoked mid-read', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, ssh } = authorizedSession(workspace, projectAlpha.id);
    ssh.listWorkspaceGrants
      .mockResolvedValueOnce(await ssh.listWorkspaceGrants(projectAlpha.id))
      .mockResolvedValueOnce([]);

    const result = await invokeTool(
      session,
      toolCall('read_ssh_workspace_resources', { grantId: SSH_GRANT_ID }),
    );

    expect(result.success).toBe(false);
    expect(resultPayload(result)).toEqual({ error: 'ssh_workspace_grant_not_found' });
    expect(ssh.readProjectResourceSnapshot).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('NVIDIA RTX 3080');
  });

  it('injects the active project and session into approved SSH tool requests', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, ssh } = authorizedSession(workspace, projectAlpha.id);

    const call = toolCall('run_ssh_workspace_command', {
      grantId: SSH_GRANT_ID,
      command: '/usr/bin/git',
      args: ['status', '--short'],
      workspaceSubdirectory: 'packages/app',
      timeoutSeconds: 20,
    });
    const result = await invokeTool(session, call);

    expect(result.success).toBe(true);
    expect(resultPayload(result)).toMatchObject({
      connectionLabel: 'Training GPU',
      stdout: 'GPU 0: ready',
    });
    expect(ssh.runAgentWorkspaceCommand).toHaveBeenCalledExactlyOnceWith(
      {
        projectId: projectAlpha.id,
        sessionId: CHAT_SESSION_ID,
        attemptId: CHAT_ATTEMPT_ID,
        turnId: call.turnId,
        toolCallId: call.callId,
        connectionId: SSH_CONNECTION_ID,
        grantId: SSH_GRANT_ID,
        command: '/usr/bin/git',
        args: ['status', '--short'],
        workspaceSubdirectory: 'packages/app',
        timeoutSeconds: 20,
      },
      expect.any(AbortSignal),
    );

    const forged = await invokeTool(
      session,
      toolCall('run_ssh_workspace_command', {
        projectId: randomUUID(),
        sessionId: randomUUID(),
        grantId: SSH_GRANT_ID,
        command: '/usr/bin/git',
        args: ['status'],
      }),
    );
    expect(forged.success).toBe(false);
    expect(resultPayload(forged)).toEqual({ error: 'invalid_tool_arguments' });
    expect(ssh.runAgentWorkspaceCommand).toHaveBeenCalledOnce();
  });

  it('performs typed approved remote file work without exposing SSH helper internals', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, ssh } = authorizedSession(workspace, projectAlpha.id);

    const listCall = toolCall('list_ssh_workspace_files', {
      grantId: SSH_GRANT_ID,
      workspaceSubdirectory: 'packages/app',
      maxEntries: 25,
    });
    const listed = await invokeTool(session, listCall);
    expect(listed.success).toBe(true);
    expect(resultPayload(listed)).toEqual({
      schemaVersion: 1,
      action: 'list',
      entries: [{ relativePath: 'experiments/baseline.py', sizeBytes: 128 }],
      truncated: false,
    });
    expect(ssh.runAgentWorkspaceFileOperation).toHaveBeenNthCalledWith(
      1,
      {
        projectId: projectAlpha.id,
        sessionId: CHAT_SESSION_ID,
        attemptId: CHAT_ATTEMPT_ID,
        turnId: listCall.turnId,
        toolCallId: listCall.callId,
        connectionId: SSH_CONNECTION_ID,
        grantId: SSH_GRANT_ID,
        workspaceSubdirectory: 'packages/app',
        action: 'list',
        maxEntries: 25,
      },
      expect.any(AbortSignal),
    );

    const readCall = toolCall('read_ssh_workspace_file', {
      grantId: SSH_GRANT_ID,
      workspaceSubdirectory: 'packages/app',
      relativePath: 'experiments/baseline.py',
      offset: 0,
      maxCharacters: 1_024,
    });
    const read = await invokeTool(session, readCall);
    expect(read.success).toBe(true);
    expect(resultPayload(read)).toEqual({
      schemaVersion: 1,
      action: 'read',
      relativePath: 'experiments/baseline.py',
      content: 'print("baseline")\n',
      contentSha256: '1'.repeat(64),
      offset: 0,
      nextOffset: null,
      totalCharacters: 18,
      truncated: false,
    });
    expect(ssh.runAgentWorkspaceFileOperation).toHaveBeenNthCalledWith(
      2,
      {
        projectId: projectAlpha.id,
        sessionId: CHAT_SESSION_ID,
        attemptId: CHAT_ATTEMPT_ID,
        turnId: readCall.turnId,
        toolCallId: readCall.callId,
        connectionId: SSH_CONNECTION_ID,
        grantId: SSH_GRANT_ID,
        workspaceSubdirectory: 'packages/app',
        action: 'read',
        relativePath: 'experiments/baseline.py',
        offset: 0,
        maxCharacters: 1_024,
      },
      expect.any(AbortSignal),
    );

    const writeCall = toolCall('write_ssh_workspace_file', {
      grantId: SSH_GRANT_ID,
      workspaceSubdirectory: 'packages/app',
      relativePath: 'experiments/baseline.py',
      content: 'print("improved")\n',
      expectedSha256: '1'.repeat(64),
    });
    const written = await invokeTool(session, writeCall);
    expect(written.success).toBe(true);
    expect(resultPayload(written)).toEqual({
      schemaVersion: 1,
      action: 'write',
      relativePath: 'experiments/baseline.py',
      created: false,
      previousSha256: '1'.repeat(64),
      contentSha256: createHash('sha256').update('print("improved")\n', 'utf8').digest('hex'),
      sizeBytes: 18,
    });
    expect(ssh.runAgentWorkspaceFileOperation).toHaveBeenNthCalledWith(
      3,
      {
        projectId: projectAlpha.id,
        sessionId: CHAT_SESSION_ID,
        attemptId: CHAT_ATTEMPT_ID,
        turnId: writeCall.turnId,
        toolCallId: writeCall.callId,
        connectionId: SSH_CONNECTION_ID,
        grantId: SSH_GRANT_ID,
        workspaceSubdirectory: 'packages/app',
        action: 'write',
        relativePath: 'experiments/baseline.py',
        content: 'print("improved")\n',
        expectedSha256: '1'.repeat(64),
      },
      expect.any(AbortSignal),
    );

    const serialized = [listed, read, written]
      .flatMap((result) => result.contentItems)
      .map((item) => item.text)
      .join('\n');
    expect(serialized).not.toContain('commandSha256');
    expect(serialized).not.toContain('connectionLabel');
    expect(serialized).not.toContain('stdout');
    expect(serialized).not.toContain('/workspace');
    expect(serialized).not.toContain('sensitive-gpu.example.test');
  });

  it('fails closed on malformed remote file helper results and maps only known errors', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, ssh } = authorizedSession(workspace, projectAlpha.id);
    const baseResult: SshCommandResult = {
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: '9'.repeat(64),
      exitCode: 0,
      stdout: '',
      stderr: '',
      truncated: false,
      durationMs: 12,
    };
    ssh.runAgentWorkspaceFileOperation
      .mockResolvedValueOnce({
        ...baseResult,
        exitCode: 127,
        stderr: '/usr/bin/python3: not found',
      })
      .mockResolvedValueOnce({ ...baseResult, exitCode: 1, stdout: '{}' })
      .mockResolvedValueOnce({ ...baseResult, stderr: 'unexpected helper warning', stdout: '{}' })
      .mockResolvedValueOnce({ ...baseResult, truncated: true, stdout: '{}' })
      .mockResolvedValueOnce({ ...baseResult, stdout: '{not-json' })
      .mockResolvedValueOnce({
        ...baseResult,
        exitCode: 1,
        stdout: JSON.stringify({
          schemaVersion: 1,
          action: 'read',
          error: 'ssh_workspace_file_conflict',
        }),
      })
      .mockResolvedValueOnce({
        ...baseResult,
        stdout: JSON.stringify({ schemaVersion: 1, action: 'read', error: 'invented_error' }),
      })
      .mockResolvedValueOnce({
        ...baseResult,
        stdout: JSON.stringify({
          schemaVersion: 1,
          action: 'read',
          relativePath: 'experiments/baseline.py',
          content: 'safe',
          contentSha256: '1'.repeat(64),
          offset: 0,
          nextOffset: null,
          totalCharacters: 4,
          truncated: false,
          helperCommand: '/usr/bin/python3 -c sensitive-wrapper',
        }),
      });

    for (const expectedError of [
      'ssh_workspace_file_helper_unavailable',
      'ssh_workspace_file_invalid',
      'ssh_workspace_file_invalid',
      'ssh_workspace_file_invalid',
      'ssh_workspace_file_invalid',
      'ssh_workspace_file_conflict',
      'ssh_workspace_file_invalid',
      'ssh_workspace_file_invalid',
    ]) {
      const result = await invokeTool(
        session,
        toolCall('read_ssh_workspace_file', {
          grantId: SSH_GRANT_ID,
          relativePath: 'experiments/baseline.py',
        }),
      );
      expect(result.success).toBe(false);
      expect(resultPayload(result)).toEqual({ error: expectedError });
    }

    ssh.runAgentWorkspaceFileOperation
      .mockResolvedValueOnce({
        ...baseResult,
        stdout: JSON.stringify({
          schemaVersion: 1,
          action: 'list',
          entries: [
            { relativePath: 'duplicate.py', sizeBytes: 1 },
            { relativePath: 'duplicate.py', sizeBytes: 1 },
          ],
          truncated: false,
        }),
      })
      .mockResolvedValueOnce({
        ...baseResult,
        stdout: JSON.stringify({
          schemaVersion: 1,
          action: 'read',
          relativePath: 'different.py',
          content: 'safe',
          contentSha256: '1'.repeat(64),
          offset: 0,
          nextOffset: null,
          totalCharacters: 4,
          truncated: false,
        }),
      })
      .mockResolvedValueOnce({
        ...baseResult,
        stdout: JSON.stringify({
          schemaVersion: 1,
          action: 'write',
          relativePath: 'experiments/new.py',
          created: true,
          previousSha256: null,
          contentSha256: '3'.repeat(64),
          sizeBytes: 13,
        }),
      });

    const inconsistent = [
      toolCall('list_ssh_workspace_files', { grantId: SSH_GRANT_ID }),
      toolCall('read_ssh_workspace_file', {
        grantId: SSH_GRANT_ID,
        relativePath: 'experiments/baseline.py',
      }),
      toolCall('write_ssh_workspace_file', {
        grantId: SSH_GRANT_ID,
        relativePath: 'experiments/new.py',
        content: 'print("new")\n',
        expectedSha256: null,
      }),
    ];
    for (const call of inconsistent) {
      const result = await invokeTool(session, call);
      expect(result.success).toBe(false);
      expect(resultPayload(result)).toEqual({ error: 'ssh_workspace_file_invalid' });
    }
  });

  it('requires workspace permission for every typed remote file operation', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, ssh } = authorizedSession(workspace, projectAlpha.id);
    const granted = await ssh.listWorkspaceGrants(projectAlpha.id);
    ssh.listWorkspaceGrants.mockResolvedValue([
      {
        grant: { ...granted[0]!.grant, permissionMode: 'diagnostics' },
        connection: granted[0]!.connection,
      },
    ]);

    for (const call of [
      toolCall('list_ssh_workspace_files', { grantId: SSH_GRANT_ID }),
      toolCall('read_ssh_workspace_file', {
        grantId: SSH_GRANT_ID,
        relativePath: 'experiments/baseline.py',
      }),
      toolCall('write_ssh_workspace_file', {
        grantId: SSH_GRANT_ID,
        relativePath: 'experiments/new.py',
        content: 'print("new")\n',
        expectedSha256: null,
      }),
    ]) {
      const result = await invokeTool(session, call);
      expect(result.success).toBe(false);
      expect(resultPayload(result)).toEqual({ error: 'ssh_workspace_file_not_allowed' });
    }
    expect(ssh.runAgentWorkspaceFileOperation).not.toHaveBeenCalled();
  });

  it('revokes current and future SSH calls without revoking project read tools', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, ssh } = authorizedSession(workspace, projectAlpha.id);

    session.revokeSshCapability();
    const listed = await invokeTool(session, toolCall('list_ssh_workspaces', {}));
    const resources = await invokeTool(
      session,
      toolCall('read_ssh_workspace_resources', { grantId: SSH_GRANT_ID }),
    );
    const files = await invokeTool(
      session,
      toolCall('list_ssh_workspace_files', { grantId: SSH_GRANT_ID }),
    );
    const file = await invokeTool(
      session,
      toolCall('read_ssh_workspace_file', {
        grantId: SSH_GRANT_ID,
        relativePath: 'experiments/baseline.py',
      }),
    );
    const write = await invokeTool(
      session,
      toolCall('write_ssh_workspace_file', {
        grantId: SSH_GRANT_ID,
        relativePath: 'experiments/new.py',
        content: 'print("new")\n',
        expectedSha256: null,
      }),
    );
    const executed = await invokeTool(
      session,
      toolCall('run_ssh_workspace_command', {
        grantId: SSH_GRANT_ID,
        command: '/usr/bin/git',
        args: ['status'],
      }),
    );
    const workspaceResult = await invokeTool(
      session,
      toolCall('read_workspace', { section: 'summary' }),
    );

    expect(resultPayload(listed)).toEqual({ error: 'ssh_cancelled' });
    expect(resultPayload(resources)).toEqual({ error: 'ssh_cancelled' });
    expect(resultPayload(files)).toEqual({ error: 'ssh_cancelled' });
    expect(resultPayload(file)).toEqual({ error: 'ssh_cancelled' });
    expect(resultPayload(write)).toEqual({ error: 'ssh_cancelled' });
    expect(resultPayload(executed)).toEqual({ error: 'ssh_cancelled' });
    expect(workspaceResult.success).toBe(true);
    expect(ssh.cancelSession).toHaveBeenCalledExactlyOnceWith(projectAlpha.id, CHAT_SESSION_ID);
    expect(ssh.listWorkspaceGrants).not.toHaveBeenCalled();
    expect(ssh.readProjectResourceSnapshot).not.toHaveBeenCalled();
    expect(ssh.runAgentWorkspaceCommand).not.toHaveBeenCalled();
    expect(ssh.runAgentWorkspaceFileOperation).not.toHaveBeenCalled();
  });

  it('does not declare read tools without a grant and rejects a grant that becomes stale', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const vault = new FakeProjectVault();
    const noGrant = new ProjectAgentToolSession({
      projectId: projectAlpha.id,
      sessionId: CHAT_SESSION_ID,
      attemptId: CHAT_ATTEMPT_ID,
      workspace,
      vault,
      localNotesVault: null,
      literature: new FakeProjectLiterature(),
      ssh: new FakeProjectSsh(),
    });
    const noGrantTools = noGrant.dynamicTools.flatMap((spec) =>
      spec.type === 'namespace' ? spec.tools.map((tool) => tool.name) : [spec.name],
    );
    expect(noGrantTools).toEqual([
      'read_workspace',
      'search_literature',
      'list_ssh_workspaces',
      'read_ssh_workspace_resources',
      'list_ssh_workspace_files',
      'read_ssh_workspace_file',
      'write_ssh_workspace_file',
      'run_ssh_workspace_command',
    ]);
    const unauthorized = await invokeTool(noGrant, toolCall('list_local_notes', {}));
    expect(unauthorized.success).toBe(false);
    expect(resultPayload(unauthorized)).toEqual({ error: 'local_notes_not_authorized' });
    await noGrant.persistResponseResearchNote({
      disposition: 'save',
      category: 'project-progress',
      title: 'Plan',
      content: '# Plan\n',
    });
    expect(await noGrant.finalizeSourceAppendix()).toContain('not authorized for Project Chat');

    const stale = authorizedSession(workspace, projectAlpha.id, vault).session;
    vault.activeVaultId = REPLACEMENT_VAULT_ID;
    const staleRead = await invokeTool(stale, toolCall('read_local_note', { noteId: NOTE_ID }));
    expect(staleRead.success).toBe(false);
    expect(resultPayload(staleRead)).toEqual({ error: 'local_notes_authorization_stale' });
    await stale.persistResponseResearchNote({
      disposition: 'save',
      category: 'experiments',
      title: 'Trial',
      content: '# Trial\n',
    });
    expect(vault.readForAgent).not.toHaveBeenCalled();
    expect(vault.saveMarkdownForAgent).not.toHaveBeenCalled();
  });

  it('strictly validates every tool argument and never accepts a raw path', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, vault, ssh } = authorizedSession(workspace, projectAlpha.id);
    const invalidCalls: Array<[string, CodexJsonValue]> = [
      ['read_workspace', { section: 'board', extra: true }],
      ['read_workspace', { section: 'notes' }],
      ['list_local_notes', { query: 'x', path: RAW_NOTE_PATH }],
      ['list_local_notes', { limit: 101 }],
      ['read_local_note', { noteId: '../result.md' }],
      ['read_local_note', { noteId: NOTE_ID, path: RAW_NOTE_PATH }],
      ['read_local_note', { noteId: NOTE_ID, offset: -1 }],
      ['read_local_note', { noteId: NOTE_ID, maxCharacters: 24_001 }],
      ['search_literature', { query: 'x', fromYear: 2027, toYear: 2026 }],
      ['search_literature', { query: 'x', projectId: randomUUID() }],
      ['read_ssh_workspace_resources', { grantId: 'not-a-grant-id' }],
      ['read_ssh_workspace_resources', { grantId: SSH_GRANT_ID, connectionId: SSH_CONNECTION_ID }],
      ['list_ssh_workspace_files', { grantId: SSH_GRANT_ID, maxEntries: 201 }],
      ['list_ssh_workspace_files', { grantId: SSH_GRANT_ID, workspaceSubdirectory: '../private' }],
      ['list_ssh_workspace_files', { grantId: SSH_GRANT_ID, connectionId: SSH_CONNECTION_ID }],
      ['read_ssh_workspace_file', { grantId: SSH_GRANT_ID, relativePath: '/etc/passwd' }],
      ['read_ssh_workspace_file', { grantId: SSH_GRANT_ID, relativePath: '../private.txt' }],
      [
        'read_ssh_workspace_file',
        { grantId: SSH_GRANT_ID, relativePath: 'result.txt', offset: -1 },
      ],
      [
        'read_ssh_workspace_file',
        { grantId: SSH_GRANT_ID, relativePath: 'result.txt', maxCharacters: 16_001 },
      ],
      [
        'write_ssh_workspace_file',
        { grantId: SSH_GRANT_ID, relativePath: 'result.txt', content: 'missing CAS' },
      ],
      [
        'write_ssh_workspace_file',
        {
          grantId: SSH_GRANT_ID,
          relativePath: 'result.txt',
          content: 'bad hash',
          expectedSha256: 'not-a-hash',
        },
      ],
      [
        'write_ssh_workspace_file',
        {
          grantId: SSH_GRANT_ID,
          relativePath: 'result.txt',
          content: 'x'.repeat(24_001),
          expectedSha256: null,
        },
      ],
      [
        'write_ssh_workspace_file',
        {
          grantId: SSH_GRANT_ID,
          relativePath: 'result.txt',
          content: 'NUL\u0000content',
          expectedSha256: null,
        },
      ],
    ];

    for (const [tool, arguments_] of invalidCalls) {
      const result = await invokeTool(session, toolCall(tool, arguments_));
      expect(result.success, `${tool}: ${JSON.stringify(arguments_)}`).toBe(false);
      expect(resultPayload(result)).toEqual({ error: 'invalid_tool_arguments' });
    }
    expect(vault.listForAgent).not.toHaveBeenCalled();
    expect(vault.readForAgent).not.toHaveBeenCalled();
    expect(ssh.runAgentWorkspaceFileOperation).not.toHaveBeenCalled();
  });

  it('enforces a cumulative 96,000-character Local Notes budget per turn session', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, vault } = authorizedSession(workspace, projectAlpha.id);

    for (const [index, remaining] of [72_000, 48_000, 24_000, 0].entries()) {
      const result = await invokeTool(
        session,
        toolCall('read_local_note', {
          noteId: NOTE_ID,
          offset: index * 24_000,
          maxCharacters: 24_000,
        }),
      );
      expect(result.success).toBe(true);
      expect(resultPayload(result)).toMatchObject({
        content: 'n'.repeat(24_000),
        sessionCharactersRemaining: remaining,
      });
    }

    const exhausted = await invokeTool(
      session,
      toolCall('read_local_note', {
        noteId: NOTE_ID,
        offset: 96_000,
        maxCharacters: 1,
      }),
    );
    expect(exhausted.success).toBe(false);
    expect(resultPayload(exhausted)).toEqual({ error: 'local_notes_turn_budget_exhausted' });
    expect(vault.readForAgent).toHaveBeenCalledTimes(4);
  });

  it('reserves the cumulative Local Notes budget across concurrent reads', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, vault } = authorizedSession(workspace, projectAlpha.id);

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        invokeTool(
          session,
          toolCall('read_local_note', {
            noteId: NOTE_ID,
            offset: index * 24_000,
            maxCharacters: 24_000,
          }),
        ),
      ),
    );
    const delivered = results.reduce((total, result) => {
      if (!result.success) return total;
      const content = resultPayload(result).content;
      return total + (typeof content === 'string' ? content.length : 0);
    }, 0);

    expect(delivered).toBe(96_000);
    expect(results.filter((result) => result.success)).toHaveLength(4);
    expect(results.filter((result) => !result.success)).toHaveLength(4);
    expect(vault.readForAgent).toHaveBeenCalledTimes(4);
  });

  it('bounds highly escaped note results by serialized characters', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const vault = new FakeProjectVault();
    vault.readForAgent.mockImplementationOnce(async () => {
      const content = '\u0000"\\\n'.repeat(6_000);
      return {
        noteId: NOTE_ID,
        title: 'Escaped evidence',
        content,
        contentSha256: NOTE_SHA256,
        offset: 0,
        nextOffset: null,
        totalCharacters: content.length,
        truncated: false,
      };
    });
    const { session } = authorizedSession(workspace, projectAlpha.id, vault);

    const result = await invokeTool(
      session,
      toolCall('read_local_note', { noteId: NOTE_ID, maxCharacters: 24_000 }),
    );
    const payload = resultPayload(result);

    expect(result.success).toBe(true);
    expect(result.contentItems[0]!.text.length).toBeLessThanOrEqual(48_000);
    expect(typeof payload.content === 'string' ? payload.content.length : 0).toBeLessThan(24_000);
    expect(payload.truncated).toBe(true);
  });

  it('shrinks a large Board result instead of failing the tool call', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    for (let index = 0; index < 200; index += 1) {
      await workspace.createTask({
        projectId: projectAlpha.id,
        title: `Large task ${index} ${'t'.repeat(180)}`,
        status: 'backlog',
        description: `Evidence ${index} ${'d'.repeat(490)}`,
      });
    }
    const { session } = authorizedSession(workspace, projectAlpha.id);

    const result = await invokeTool(session, toolCall('read_workspace', { section: 'board' }));
    const payload = resultPayload(result);
    const board = payload.board as { taskCount: number; truncated: boolean; tasks: unknown[] };

    expect(result.success).toBe(true);
    expect(result.contentItems[0]!.text.length).toBeLessThanOrEqual(48_000);
    expect(board.taskCount).toBe(201);
    expect(board.truncated).toBe(true);
    expect(board.tasks.length).toBeLessThan(200);
  });

  it('never exposes a repository URL with embedded credentials to the agent', async () => {
    const storage = new MemoryWorkspaceStorage();
    const workspace = new WorkspaceService(storage);
    const project = await workspace.createProject({ name: 'Credential boundary' });
    storage.state = {
      ...(await workspace.snapshot()),
      projects: [
        {
          ...project,
          // Legacy snapshots were permissive. New commands reject this shape at the boundary.
          repository: 'https://researcher:secret-token@github.com/lab/private.git',
        },
      ],
    };
    const { session } = authorizedSession(workspace, project.id);

    const result = await invokeTool(session, toolCall('read_workspace', { section: 'summary' }));
    const serialized = result.contentItems[0]!.text;

    expect(result.success).toBe(true);
    expect(resultPayload(result)).toMatchObject({ project: { repository: null } });
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('researcher:');
  });

  it('appends only bounded source metadata, never Local Note content or paths', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session } = authorizedSession(workspace, projectAlpha.id);

    const read = await invokeTool(
      session,
      toolCall('read_local_note', { noteId: NOTE_ID, maxCharacters: NOTE_BODY.length }),
    );
    expect(read.success).toBe(true);

    const appendix = await session.finalizeSourceAppendix();
    expect(appendix).toContain('Research Notes accessed');
    expect(appendix).toContain('Result  study');
    expect(appendix).toContain(NOTE_SHA256);
    expect(appendix).toContain(NOTE_ID.slice(0, 12));
    expect(appendix).toContain('excerpted');
    expect(appendix).not.toContain(NOTE_BODY);
    expect(appendix).not.toContain('n'.repeat(NOTE_BODY.length));
    expect(appendix).not.toContain(RAW_NOTE_PATH);
    expect(appendix).not.toContain('/Users/');
    expect(appendix).not.toContain('offset');
    expect(appendix).not.toContain('totalCharacters');
  });

  it('marks a tail-only Local Notes read as excerpted', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session } = authorizedSession(workspace, projectAlpha.id);

    const read = await invokeTool(
      session,
      toolCall('read_local_note', {
        noteId: NOTE_ID,
        offset: 119_990,
        maxCharacters: 10,
      }),
    );

    expect(read.success).toBe(true);
    expect(resultPayload(read)).toMatchObject({ nextOffset: null, truncated: false });
    expect(await session.finalizeSourceAppendix()).toContain('excerpted');
  });

  it('seals provenance after a discarded call so a late note result cannot add a source', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const vault = new FakeProjectVault();
    let resolveRead!: (note: AgentVaultNoteChunk) => void;
    vault.readForAgent.mockImplementationOnce(
      () =>
        new Promise<AgentVaultNoteChunk>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const { session } = authorizedSession(workspace, projectAlpha.id, vault);
    const revokeTransport = vi.fn();
    session.bindTransportRevoker(revokeTransport);
    let discard!: () => void;
    const outcome = new Promise<'discarded'>((resolve) => {
      discard = () => resolve('discarded');
    });
    const read = session.handler(
      toolCall('read_local_note', { noteId: NOTE_ID }),
      delivery(outcome),
    );
    await vi.waitFor(() => expect(vault.readForAgent).toHaveBeenCalledOnce());

    discard();
    expect(await session.finalizeSourceAppendix()).toBe('');
    expect(revokeTransport).toHaveBeenCalledOnce();
    resolveRead({
      noteId: NOTE_ID,
      title: 'Late evidence',
      content: NOTE_BODY,
      contentSha256: NOTE_SHA256,
      offset: 0,
      nextOffset: null,
      totalCharacters: NOTE_BODY.length,
      truncated: false,
    });
    await expect(read).resolves.toMatchObject({ success: true });
    expect(await session.finalizeSourceAppendix()).toBe('');
  });

  it('records a write-in-progress revocation as accessed with delivery unconfirmed', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session } = authorizedSession(workspace, projectAlpha.id);
    await invokeTool(session, toolCall('read_local_note', { noteId: NOTE_ID }));

    let resolveOutcome!: (outcome: 'delivered' | 'uncertain') => void;
    const outcome = new Promise<'delivered' | 'uncertain'>((resolve) => {
      resolveOutcome = resolve;
    });
    session.bindTransportRevoker(() => resolveOutcome('uncertain'));
    const pendingRead = await session.handler(
      toolCall('read_local_note', { noteId: NOTE_ID, offset: 24_000 }),
      delivery(outcome),
    );
    expect(pendingRead.success).toBe(true);

    const appendix = await session.finalizeSourceAppendix();
    expect(appendix).toContain('Research Notes accessed');
    expect(appendix).toContain(NOTE_SHA256);
    expect(appendix).toContain('delivery unconfirmed');
    expect(appendix.match(new RegExp(NOTE_SHA256, 'gu'))).toHaveLength(1);

    resolveOutcome('delivered');
    await Promise.resolve();
    expect(await session.finalizeSourceAppendix()).toBe(appendix);
  });

  it('preserves separate source receipts for two observed hashes of the same note', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const vault = new FakeProjectVault();
    const secondHash = 'e'.repeat(64);
    vault.readForAgent
      .mockImplementationOnce(async () => ({
        noteId: NOTE_ID,
        title: 'Versioned evidence',
        content: 'first',
        contentSha256: NOTE_SHA256,
        offset: 0,
        nextOffset: null,
        totalCharacters: 5,
        truncated: false,
      }))
      .mockImplementationOnce(async () => ({
        noteId: NOTE_ID,
        title: 'Versioned evidence',
        content: 'second',
        contentSha256: secondHash,
        offset: 0,
        nextOffset: null,
        totalCharacters: 6,
        truncated: false,
      }));
    const { session } = authorizedSession(workspace, projectAlpha.id, vault);

    await invokeTool(session, toolCall('read_local_note', { noteId: NOTE_ID }));
    await invokeTool(session, toolCall('read_local_note', { noteId: NOTE_ID }));
    const appendix = await session.finalizeSourceAppendix();

    expect(appendix).toContain(NOTE_SHA256);
    expect(appendix).toContain(secondHash);
    expect(appendix.match(/Versioned evidence/gu)).toHaveLength(2);
  });

  it.each([
    ['/usr/bin/python3', ['experiments/train.py']],
    ['/usr/bin/python', ['-u', 'experiments/train.py']],
  ])(
    'rejects the generic SSH experiment bypass for %s before requesting approval',
    async (command, args) => {
      const { workspace, projectAlpha } = await workspaceFixture();
      const { session, ssh } = authorizedSession(workspace, projectAlpha.id);

      const result = await invokeTool(
        session,
        toolCall('run_ssh_workspace_command', {
          grantId: SSH_GRANT_ID,
          command,
          args,
          timeoutSeconds: 120,
        }),
      );

      expect(result.success).toBe(false);
      expect(resultPayload(result)).toEqual({ error: 'experiment_tracking_required' });
      expect(ssh.runAgentWorkspaceCommand).not.toHaveBeenCalled();
    },
  );

  it('keeps a created run queued when binding is transient and binds it on execution retry', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const ssh = new FakeProjectSsh();
    const experiments = new FakeProjectExperiments(projectAlpha.id);
    experiments.bindFailuresRemaining = 1;
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      ssh,
      new FakeProjectLiterature(),
      experiments,
    );

    const created = await invokeTool(
      session,
      toolCall('create_experiment_run', {
        grantId: SSH_GRANT_ID,
        title: 'Retryable binding',
        mode: 'exploratory',
      }),
    );
    const createdPayload = resultPayload(created);
    const run = createdPayload.run as ExperimentRun;
    expect(createdPayload).toMatchObject({
      persisted: true,
      workspaceBound: false,
      bindingPending: true,
      run: { status: 'queued' },
    });

    const stdout = validExploratoryExperimentJsonl(run);
    ssh.runAgentWorkspaceCommand.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: 'e'.repeat(64),
      exitCode: 0,
      stdout,
      stderr: '',
      truncated: false,
      durationMs: 17,
    });
    ssh.runAgentWorkspaceFileOperation.mockResolvedValueOnce(
      experimentLogReadResult('logs/binding-retry.jsonl', stdout),
    );

    const executed = await invokeTool(
      session,
      toolCall('execute_experiment_run', {
        runId: run.id,
        grantId: SSH_GRANT_ID,
        command: '/usr/bin/python3',
        args: ['experiments/train.py'],
        timeoutSeconds: 120,
        logPath: 'logs/binding-retry.jsonl',
        coveragePlan: experimentCoveragePlan,
      }),
    );

    expect(resultPayload(executed)).toMatchObject({
      process: { outcome: 'succeeded', exitCode: 0, durationMs: 17 },
      run: { status: 'succeeded' },
    });
    expect(experiments.bindRunExecution).toHaveBeenCalledTimes(2);
    expect(ssh.runAgentWorkspaceCommand).toHaveBeenCalledTimes(1);
  });

  it('retries only exact log verification after a successful process', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const ssh = new FakeProjectSsh();
    const experiments = new FakeProjectExperiments(projectAlpha.id);
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      ssh,
      new FakeProjectLiterature(),
      experiments,
    );
    const run = resultPayload(
      await invokeTool(
        session,
        toolCall('create_experiment_run', {
          grantId: SSH_GRANT_ID,
          title: 'Verification replay',
          mode: 'exploratory',
        }),
      ),
    ).run as ExperimentRun;
    const stdout = validExploratoryExperimentJsonl(run, 'verify-once');
    ssh.runAgentWorkspaceCommand.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: 'e'.repeat(64),
      exitCode: 0,
      stdout,
      stderr: '',
      truncated: false,
      durationMs: 23,
    });
    ssh.runAgentWorkspaceFileOperation
      .mockRejectedValueOnce(new Error('ssh_approval_expired'))
      .mockResolvedValueOnce(experimentLogReadResult('logs/verify-retry.jsonl', stdout));
    const executeArguments = {
      runId: run.id,
      grantId: SSH_GRANT_ID,
      command: '/usr/bin/python3',
      args: ['experiments/train.py'],
      timeoutSeconds: 120,
      logPath: 'logs/verify-retry.jsonl',
      coveragePlan: experimentCoveragePlan,
    } as const;

    const pending = await invokeTool(session, toolCall('execute_experiment_run', executeArguments));
    expect(resultPayload(pending)).toMatchObject({
      replayed: false,
      verificationPending: true,
      retryableError: 'ssh_approval_expired',
      process: { outcome: 'verifying', exitCode: 0, durationMs: 23 },
      logValidation: { state: 'pending', missingFields: [] },
      run: {
        status: 'verifying',
        processExitCode: 0,
        processDurationMs: 23,
      },
    });

    const verified = await invokeTool(
      session,
      toolCall('execute_experiment_run', executeArguments),
    );
    expect(resultPayload(verified)).toMatchObject({
      replayed: true,
      verificationPending: false,
      process: { outcome: 'succeeded', exitCode: 0, durationMs: 23 },
      logValidation: { state: 'valid', missingFields: [] },
      run: { status: 'succeeded' },
    });
    expect(ssh.runAgentWorkspaceCommand).toHaveBeenCalledTimes(1);
    expect(ssh.runAgentWorkspaceFileOperation).toHaveBeenCalledTimes(2);
  });

  it('does not read a log or rerun after a crash before the process receipt reaches verifying', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const ssh = new FakeProjectSsh();
    const experiments = new FakeProjectExperiments(projectAlpha.id);
    experiments.verifyingFailuresRemaining = 3;
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      ssh,
      new FakeProjectLiterature(),
      experiments,
    );
    const run = resultPayload(
      await invokeTool(
        session,
        toolCall('create_experiment_run', {
          grantId: SSH_GRANT_ID,
          title: 'Receipt staging crash',
          mode: 'exploratory',
        }),
      ),
    ).run as ExperimentRun;
    const stdout = validExploratoryExperimentJsonl(run);
    ssh.runAgentWorkspaceCommand.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: 'e'.repeat(64),
      exitCode: 0,
      stdout,
      stderr: '',
      truncated: false,
      durationMs: 19,
    });
    const executeArguments = {
      runId: run.id,
      grantId: SSH_GRANT_ID,
      command: '/usr/bin/python3',
      args: ['experiments/train.py'],
      timeoutSeconds: 120,
      logPath: 'logs/staging-crash.jsonl',
      coveragePlan: experimentCoveragePlan,
    } as const;

    const failedStage = await invokeTool(
      session,
      toolCall('execute_experiment_run', executeArguments),
    );
    expect(resultPayload(failedStage)).toEqual({ error: 'experiment_run_conflict' });
    expect(experiments.snapshot.runs.find((candidate) => candidate.id === run.id)?.status).toBe(
      'running',
    );
    expect(ssh.runAgentWorkspaceCommand).toHaveBeenCalledTimes(1);
    expect(ssh.runAgentWorkspaceFileOperation).not.toHaveBeenCalled();

    const replay = await invokeTool(session, toolCall('execute_experiment_run', executeArguments));
    expect(resultPayload(replay)).toMatchObject({
      replayed: true,
      executionPending: true,
      run: { status: 'running' },
    });
    expect(ssh.runAgentWorkspaceCommand).toHaveBeenCalledTimes(1);
    expect(ssh.runAgentWorkspaceFileOperation).not.toHaveBeenCalled();
  });

  it('binds replay to the exact current grant, connection, root, and execution policy authority', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const ssh = new FakeProjectSsh();
    const experiments = new FakeProjectExperiments(projectAlpha.id);
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      ssh,
      new FakeProjectLiterature(),
      experiments,
    );
    const run = resultPayload(
      await invokeTool(
        session,
        toolCall('create_experiment_run', {
          grantId: SSH_GRANT_ID,
          title: 'Authority-bound verification',
          mode: 'exploratory',
        }),
      ),
    ).run as ExperimentRun;
    const stdout = validExploratoryExperimentJsonl(run);
    ssh.runAgentWorkspaceCommand.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: 'e'.repeat(64),
      exitCode: 0,
      stdout,
      stderr: '',
      truncated: false,
      durationMs: 29,
    });
    ssh.runAgentWorkspaceFileOperation.mockRejectedValueOnce(new Error('ssh_approval_expired'));
    const executeArguments = {
      runId: run.id,
      grantId: SSH_GRANT_ID,
      command: '/usr/bin/python3',
      args: ['experiments/train.py'],
      timeoutSeconds: 120,
      logPath: 'logs/authority.jsonl',
      coveragePlan: experimentCoveragePlan,
    } as const;

    const pending = await invokeTool(session, toolCall('execute_experiment_run', executeArguments));
    expect(resultPayload(pending)).toMatchObject({
      verificationPending: true,
      run: { status: 'verifying' },
    });
    expect(experiments.stageRunExecutionIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceGrantId: SSH_GRANT_ID,
        grantVersion: 1,
        connectionId: SSH_CONNECTION_ID,
        connectionVersion: 1,
        canonicalRoot: '/workspace',
        canonicalRootHash: createHash('sha256').update('/workspace', 'utf8').digest('hex'),
        policyVersion: 1,
        executionPolicyHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    );
    expect(pending.contentItems[0]!.text).not.toContain('/workspace');

    ssh.grantVersion = 2;
    const authorityDrift = await invokeTool(
      session,
      toolCall('execute_experiment_run', executeArguments),
    );
    expect(resultPayload(authorityDrift)).toEqual({
      error: 'experiment_run_intent_mismatch',
    });
    expect(ssh.runAgentWorkspaceCommand).toHaveBeenCalledTimes(1);
    expect(ssh.runAgentWorkspaceFileOperation).toHaveBeenCalledTimes(1);
  });

  it('durably enters verifying before validating a nonzero-exit process log', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const ssh = new FakeProjectSsh();
    const experiments = new FakeProjectExperiments(projectAlpha.id);
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      ssh,
      new FakeProjectLiterature(),
      experiments,
    );
    const run = resultPayload(
      await invokeTool(
        session,
        toolCall('create_experiment_run', {
          grantId: SSH_GRANT_ID,
          title: 'Failed process log',
          mode: 'exploratory',
        }),
      ),
    ).run as ExperimentRun;
    const stdout = validExploratoryExperimentJsonl(run).replaceAll(
      '"status":"succeeded"',
      '"status":"failed"',
    );
    ssh.runAgentWorkspaceCommand.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: 'e'.repeat(64),
      exitCode: 7,
      stdout,
      stderr: 'bounded failure detail',
      truncated: false,
      durationMs: 37,
    });
    ssh.runAgentWorkspaceFileOperation.mockImplementationOnce(async () => {
      expect(experiments.snapshot.runs.find((candidate) => candidate.id === run.id)).toMatchObject({
        status: 'verifying',
        processExitCode: 7,
        processDurationMs: 37,
      });
      return experimentLogReadResult('logs/process-failed.jsonl', stdout);
    });

    const result = await invokeTool(
      session,
      toolCall('execute_experiment_run', {
        runId: run.id,
        grantId: SSH_GRANT_ID,
        command: '/usr/bin/python3',
        args: ['experiments/train.py'],
        timeoutSeconds: 120,
        logPath: 'logs/process-failed.jsonl',
        coveragePlan: experimentCoveragePlan,
      }),
    );

    expect(resultPayload(result)).toMatchObject({
      process: { outcome: 'failed', exitCode: 7, durationMs: 37 },
      logValidation: { state: 'valid' },
      logSourceLinked: true,
      run: { status: 'failed' },
    });
    expect(experiments.updateRun.mock.calls.map(([input]) => input.status).filter(Boolean)).toEqual(
      ['running', 'verifying', 'failed'],
    );
  });

  it('rejects changed verification and terminal replays against the staged intent', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const ssh = new FakeProjectSsh();
    const experiments = new FakeProjectExperiments(projectAlpha.id);
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      ssh,
      new FakeProjectLiterature(),
      experiments,
    );
    const run = resultPayload(
      await invokeTool(
        session,
        toolCall('create_experiment_run', {
          grantId: SSH_GRANT_ID,
          title: 'Immutable execution intent',
          mode: 'exploratory',
        }),
      ),
    ).run as ExperimentRun;
    const stdout = validExploratoryExperimentJsonl(run);
    ssh.runAgentWorkspaceCommand.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: 'e'.repeat(64),
      exitCode: 0,
      stdout,
      stderr: '',
      truncated: false,
      durationMs: 31,
    });
    ssh.runAgentWorkspaceFileOperation
      .mockRejectedValueOnce(new Error('ssh_connection_failed'))
      .mockResolvedValueOnce(experimentLogReadResult('logs/intent.jsonl', stdout));
    const exactArguments = {
      runId: run.id,
      grantId: SSH_GRANT_ID,
      command: '/usr/bin/python3',
      args: ['experiments/train.py'],
      timeoutSeconds: 120,
      logPath: 'logs/intent.jsonl',
      coveragePlan: experimentCoveragePlan,
    } as const;

    await invokeTool(session, toolCall('execute_experiment_run', exactArguments));
    const changedVerification = await invokeTool(
      session,
      toolCall('execute_experiment_run', {
        ...exactArguments,
        args: ['experiments/train.py', '--seed', '2'],
      }),
    );
    expect(resultPayload(changedVerification)).toEqual({
      error: 'experiment_run_intent_mismatch',
    });
    expect(ssh.runAgentWorkspaceCommand).toHaveBeenCalledTimes(1);
    expect(ssh.runAgentWorkspaceFileOperation).toHaveBeenCalledTimes(1);

    const verified = await invokeTool(session, toolCall('execute_experiment_run', exactArguments));
    expect(resultPayload(verified)).toMatchObject({ run: { status: 'succeeded' } });
    const terminalReplay = await invokeTool(
      session,
      toolCall('execute_experiment_run', exactArguments),
    );
    expect(resultPayload(terminalReplay)).toMatchObject({
      replayed: true,
      verificationPending: false,
      run: { status: 'succeeded' },
    });
    const changedTerminal = await invokeTool(
      session,
      toolCall('execute_experiment_run', {
        ...exactArguments,
        logPath: 'logs/changed-after-success.jsonl',
      }),
    );
    expect(resultPayload(changedTerminal)).toEqual({ error: 'experiment_run_intent_mismatch' });
    expect(ssh.runAgentWorkspaceCommand).toHaveBeenCalledTimes(1);
    expect(ssh.runAgentWorkspaceFileOperation).toHaveBeenCalledTimes(2);
  });

  it('recovers missing terminal log-source and summary projections without rerunning the process', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const workspaceSnapshot = await workspace.snapshot();
    const draftObjective = workspaceSnapshot.objectives.find(
      (candidate) => candidate.projectId === projectAlpha.id,
    )!;
    const lockedObjective = await workspace.lockObjective({
      projectId: projectAlpha.id,
      expectedEntityVersion: draftObjective.entityVersion,
    });
    const ssh = new FakeProjectSsh();
    const experiments = new FakeProjectExperiments(projectAlpha.id);
    experiments.comparableObjective = {
      id: lockedObjective.id,
      version: lockedObjective.objectiveVersion,
    };
    const ideaId = '12121212-1212-4121-8121-121212121212';
    experiments.snapshot.ideas.push({
      schemaVersion: 1,
      id: ideaId,
      projectId: projectAlpha.id,
      parentIdeaId: null,
      title: 'Comparable recovery idea',
      hypothesis: 'The tracked change improves accuracy.',
      phase: 'validation',
      outcome: 'planned',
      resultSummary: '',
      version: 1,
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
      completedAt: null,
    });
    experiments.linkFailuresRemaining = 1;
    experiments.summaryFailuresRemaining = 1;
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      ssh,
      new FakeProjectLiterature(),
      experiments,
    );
    const run = resultPayload(
      await invokeTool(
        session,
        toolCall('create_experiment_run', {
          grantId: SSH_GRANT_ID,
          title: 'Terminal projection recovery',
          mode: 'comparable',
          ideaId,
        }),
      ),
    ).run as ExperimentRun;
    const stdout = validComparableExperimentJsonl(run, 0.91);
    ssh.runAgentWorkspaceCommand.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: 'e'.repeat(64),
      exitCode: 0,
      stdout,
      stderr: '',
      truncated: false,
      durationMs: 43,
    });
    ssh.runAgentWorkspaceFileOperation.mockResolvedValue(
      experimentLogReadResult('logs/projection-recovery.jsonl', stdout),
    );
    const executeArguments = {
      runId: run.id,
      grantId: SSH_GRANT_ID,
      command: '/usr/bin/python3',
      args: ['experiments/train.py'],
      timeoutSeconds: 120,
      logPath: 'logs/projection-recovery.jsonl',
      coveragePlan: experimentCoveragePlan,
    } as const;

    const sourceCrash = await invokeTool(
      session,
      toolCall('execute_experiment_run', executeArguments),
    );
    expect(resultPayload(sourceCrash)).toEqual({ error: 'experiment_run_log_unavailable' });
    expect(experiments.snapshot.runs.find((candidate) => candidate.id === run.id)).toMatchObject({
      status: 'succeeded',
      processExitCode: 0,
      processDurationMs: 43,
    });
    expect(ssh.runAgentWorkspaceCommand).toHaveBeenCalledTimes(1);
    expect(experiments.recordRunSummaryMetric).not.toHaveBeenCalled();

    const metricCrash = await invokeTool(
      session,
      toolCall('execute_experiment_run', executeArguments),
    );
    expect(resultPayload(metricCrash)).toEqual({ error: 'experiment_run_log_unavailable' });
    expect(ssh.runAgentWorkspaceCommand).toHaveBeenCalledTimes(1);
    expect(experiments.linkRunLogSource).toHaveBeenCalledTimes(2);
    expect(experiments.recordRunSummaryMetric).toHaveBeenCalledTimes(1);

    const recovered = await invokeTool(
      session,
      toolCall('execute_experiment_run', executeArguments),
    );
    expect(resultPayload(recovered)).toMatchObject({
      replayed: true,
      reconciliationPending: false,
      logSourceLinked: true,
      summaryMetricRecorded: true,
      process: { outcome: 'succeeded', exitCode: 0, durationMs: 43 },
      run: { status: 'succeeded' },
    });
    expect(ssh.runAgentWorkspaceCommand).toHaveBeenCalledTimes(1);
    expect(ssh.runAgentWorkspaceFileOperation).toHaveBeenCalledTimes(2);
    expect(experiments.recordRunSummaryMetric).toHaveBeenCalledTimes(2);
  });

  it('fails safely without verification when SSH returns no process exit code', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const ssh = new FakeProjectSsh();
    const experiments = new FakeProjectExperiments(projectAlpha.id);
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      ssh,
      new FakeProjectLiterature(),
      experiments,
    );
    const run = resultPayload(
      await invokeTool(
        session,
        toolCall('create_experiment_run', {
          grantId: SSH_GRANT_ID,
          title: 'Unknown process outcome',
          mode: 'exploratory',
        }),
      ),
    ).run as ExperimentRun;
    ssh.runAgentWorkspaceCommand.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: 'e'.repeat(64),
      exitCode: null,
      stdout: validExploratoryExperimentJsonl(run),
      stderr: '',
      truncated: false,
      durationMs: 41,
    });

    const result = await invokeTool(
      session,
      toolCall('execute_experiment_run', {
        runId: run.id,
        grantId: SSH_GRANT_ID,
        command: '/usr/bin/python3',
        args: ['experiments/train.py'],
        timeoutSeconds: 120,
        logPath: 'logs/unknown-exit.jsonl',
        coveragePlan: experimentCoveragePlan,
      }),
    );

    expect(resultPayload(result)).toMatchObject({
      process: { outcome: 'failed', exitCode: null, durationMs: null },
      run: { status: 'failed', processExitCode: null, processDurationMs: null },
    });
    expect(ssh.runAgentWorkspaceFileOperation).not.toHaveBeenCalled();
  });

  it('tracks an exploratory run against an immutable template and returns no raw remote data', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const ssh = new FakeProjectSsh();
    const experiments = new FakeProjectExperiments(projectAlpha.id);
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      ssh,
      new FakeProjectLiterature(),
      experiments,
    );

    const setup = await invokeTool(session, toolCall('read_experiment_setup', {}));
    expect(resultPayload(setup)).toMatchObject({
      exploratoryRunRequirements: { targetThresholdRequired: false },
      comparableRunRequirements: { targetThresholdRequired: false },
      loggingTemplate: { version: 1 },
    });
    const created = await invokeTool(
      session,
      toolCall('create_experiment_run', {
        grantId: SSH_GRANT_ID,
        title: 'Tracked exploratory baseline',
        mode: 'exploratory',
      }),
    );
    const createdRun = resultPayload(created).run as ExperimentRun;
    expect(createdRun.loggingTemplate.version).toBe(1);

    experiments.snapshot.loggingTemplate.version = 2;
    experiments.snapshot.loggingTemplate.customFields.push({
      key: 'newer_field',
      label: 'Newer field',
      type: 'boolean',
      category: 'note',
      requiredAt: ['summary'],
      unit: null,
    });
    const base = {
      schema_version: 1,
      template_version: 1,
      objective_version: null,
      run_id: createdRun.id,
      trial_id: createdRun.trialId,
      server_label: 'Training GPU',
    };
    const rawSentinel = 'RAW_REMOTE_VALUE_MUST_NOT_LEAK';
    const stdout = [
      {
        ...base,
        occurred_at: '2026-08-05T00:00:02.000Z',
        event_type: 'run-start',
        sequence: 1,
        status: 'running',
      },
      {
        ...base,
        occurred_at: '2026-08-05T00:00:03.000Z',
        event_type: 'progress',
        sequence: 2,
        status: 'running',
        step: rawSentinel,
        elapsed_seconds: 2.5,
      },
      {
        ...base,
        occurred_at: '2026-08-05T00:00:04.000Z',
        event_type: 'run-end',
        sequence: 3,
        status: 'succeeded',
        elapsed_seconds: 4,
      },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n');
    ssh.runAgentWorkspaceCommand.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: 'e'.repeat(64),
      exitCode: 0,
      stdout,
      stderr: 'PRIVATE_STDERR',
      truncated: false,
      durationMs: 42,
    });
    ssh.runAgentWorkspaceFileOperation.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: '9'.repeat(64),
      exitCode: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        action: 'read',
        relativePath: 'private/results/trial.jsonl',
        content: stdout,
        contentSha256: createHash('sha256').update(stdout, 'utf8').digest('hex'),
        offset: 0,
        nextOffset: null,
        totalCharacters: [...stdout].length,
        truncated: false,
      }),
      stderr: '',
      truncated: false,
      durationMs: 5,
    });
    const executed = await invokeTool(
      session,
      toolCall('execute_experiment_run', {
        runId: createdRun.id,
        grantId: SSH_GRANT_ID,
        command: '/usr/bin/python3',
        args: ['experiments/train.py'],
        timeoutSeconds: 120,
        logPath: 'private/results/trial.jsonl',
        coveragePlan: [
          { lifecycle: 'progress', fields: ['step', 'elapsed_seconds'] },
          { lifecycle: 'run-end', fields: ['elapsed_seconds'] },
        ],
      }),
    );
    const serialized = executed.contentItems[0]!.text;

    expect(executed.success).toBe(true);
    expect(resultPayload(executed)).toMatchObject({
      process: { outcome: 'succeeded', exitCode: 0, durationMs: 42 },
      logValidation: { state: 'valid', missingFields: [] },
      run: {
        status: 'succeeded',
        progressCurrent: null,
        loggingTemplate: { version: 1 },
      },
    });
    expect(serialized).not.toContain(rawSentinel);
    expect(serialized).not.toContain('PRIVATE_STDERR');
    expect(serialized).not.toContain('private/results/trial.jsonl');
    expect(serialized).not.toContain('/workspace');
    expect(serialized).not.toContain('sensitive-gpu.example.test');
    expect(experiments.linkRunLogSource).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: projectAlpha.id,
        runId: createdRun.id,
        workspaceGrantId: SSH_GRANT_ID,
        relativePath: 'private/results/trial.jsonl',
      }),
    );
    expect(ssh.runAgentWorkspaceFileOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'read',
        projectId: projectAlpha.id,
        grantId: SSH_GRANT_ID,
        relativePath: 'private/results/trial.jsonl',
        offset: 0,
        maxCharacters: 16_000,
      }),
      expect.any(AbortSignal),
    );
  });

  it('rejects a JSONL path whose typed remote read does not match stdout', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const ssh = new FakeProjectSsh();
    const experiments = new FakeProjectExperiments(projectAlpha.id);
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      ssh,
      new FakeProjectLiterature(),
      experiments,
    );
    const run = resultPayload(
      await invokeTool(
        session,
        toolCall('create_experiment_run', {
          grantId: SSH_GRANT_ID,
          title: 'Mismatched remote log',
          mode: 'exploratory',
        }),
      ),
    ).run as ExperimentRun;
    const base = {
      schema_version: 1,
      template_version: 1,
      objective_version: null,
      run_id: run.id,
      trial_id: run.trialId,
      server_label: 'Training GPU',
    };
    const stdout = [
      {
        ...base,
        occurred_at: '2026-08-05T00:00:02.000Z',
        event_type: 'run-start',
        sequence: 1,
        status: 'running',
      },
      {
        ...base,
        occurred_at: '2026-08-05T00:00:03.000Z',
        event_type: 'progress',
        sequence: 2,
        status: 'running',
        step: 'fit',
        elapsed_seconds: 1,
      },
      {
        ...base,
        occurred_at: '2026-08-05T00:00:04.000Z',
        event_type: 'run-end',
        sequence: 3,
        status: 'succeeded',
        elapsed_seconds: 2,
      },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n');
    ssh.runAgentWorkspaceCommand.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: 'e'.repeat(64),
      exitCode: 0,
      stdout,
      stderr: '',
      truncated: false,
      durationMs: 12,
    });
    const mismatched = `${stdout}\n{\"tampered\":true}`;
    ssh.runAgentWorkspaceFileOperation.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: '9'.repeat(64),
      exitCode: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        action: 'read',
        relativePath: 'logs/mismatch.jsonl',
        content: mismatched,
        contentSha256: createHash('sha256').update(mismatched, 'utf8').digest('hex'),
        offset: 0,
        nextOffset: null,
        totalCharacters: [...mismatched].length,
        truncated: false,
      }),
      stderr: '',
      truncated: false,
      durationMs: 3,
    });

    const result = await invokeTool(
      session,
      toolCall('execute_experiment_run', {
        runId: run.id,
        grantId: SSH_GRANT_ID,
        command: '/usr/bin/python3',
        args: ['experiments/train.py'],
        timeoutSeconds: 120,
        logPath: 'logs/mismatch.jsonl',
        coveragePlan: [
          { lifecycle: 'progress', fields: ['step', 'elapsed_seconds'] },
          { lifecycle: 'run-end', fields: ['elapsed_seconds'] },
        ],
      }),
    );

    expect(resultPayload(result)).toMatchObject({
      process: { outcome: 'failed', exitCode: 0 },
      logValidation: { state: 'invalid', missingFields: [] },
      run: { status: 'failed' },
    });
    expect(experiments.linkRunLogSource).not.toHaveBeenCalled();
    expect(experiments.recordRunSummaryMetric).not.toHaveBeenCalled();
    expect(result.contentItems[0]!.text).not.toContain('tampered');
    expect(result.contentItems[0]!.text).not.toContain('logs/mismatch.jsonl');
  });

  it('fails a zero-exit run whose required logging fields are incomplete', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const ssh = new FakeProjectSsh();
    const experiments = new FakeProjectExperiments(projectAlpha.id);
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      ssh,
      new FakeProjectLiterature(),
      experiments,
    );
    const created = resultPayload(
      await invokeTool(
        session,
        toolCall('create_experiment_run', {
          grantId: SSH_GRANT_ID,
          title: 'Incomplete log run',
          mode: 'exploratory',
        }),
      ),
    ).run as ExperimentRun;
    const base = {
      schema_version: 1,
      template_version: 1,
      objective_version: null,
      run_id: created.id,
      trial_id: created.trialId,
      server_label: 'Training GPU',
    };
    const incompleteJsonl = [
      {
        ...base,
        occurred_at: '2026-08-05T00:00:02.000Z',
        event_type: 'run-start',
        sequence: 1,
        status: 'running',
      },
      {
        ...base,
        occurred_at: '2026-08-05T00:00:03.000Z',
        event_type: 'progress',
        sequence: 2,
        status: 'running',
        step: 'fit',
      },
      {
        ...base,
        occurred_at: '2026-08-05T00:00:04.000Z',
        event_type: 'run-end',
        sequence: 3,
        status: 'succeeded',
      },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n');
    ssh.runAgentWorkspaceCommand.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: 'e'.repeat(64),
      exitCode: 0,
      stdout: incompleteJsonl,
      stderr: '',
      truncated: false,
      durationMs: 12,
    });
    ssh.runAgentWorkspaceFileOperation.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: '9'.repeat(64),
      exitCode: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        action: 'read',
        relativePath: 'logs/incomplete.jsonl',
        content: incompleteJsonl,
        contentSha256: createHash('sha256').update(incompleteJsonl, 'utf8').digest('hex'),
        offset: 0,
        nextOffset: null,
        totalCharacters: [...incompleteJsonl].length,
        truncated: false,
      }),
      stderr: '',
      truncated: false,
      durationMs: 12,
    });

    const result = await invokeTool(
      session,
      toolCall('execute_experiment_run', {
        runId: created.id,
        grantId: SSH_GRANT_ID,
        command: '/usr/bin/python3',
        args: ['experiments/train.py'],
        timeoutSeconds: 120,
        logPath: 'logs/incomplete.jsonl',
        coveragePlan: [
          { lifecycle: 'progress', fields: ['step', 'elapsed_seconds'] },
          { lifecycle: 'run-end', fields: ['elapsed_seconds'] },
        ],
      }),
    );

    expect(resultPayload(result)).toMatchObject({
      process: { outcome: 'failed', exitCode: 0 },
      logValidation: { state: 'incomplete', missingFields: ['elapsed_seconds'] },
      run: { status: 'failed' },
    });
    expect(experiments.linkRunLogSource).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: projectAlpha.id,
        runId: created.id,
        workspaceGrantId: SSH_GRANT_ID,
        relativePath: 'logs/incomplete.jsonl',
      }),
    );
    expect(experiments.recordRunSummaryMetric).not.toHaveBeenCalled();
  });

  it('requires a lifecycle field on every progress record', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const ssh = new FakeProjectSsh();
    const experiments = new FakeProjectExperiments(projectAlpha.id);
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      ssh,
      new FakeProjectLiterature(),
      experiments,
    );
    const run = resultPayload(
      await invokeTool(
        session,
        toolCall('create_experiment_run', {
          grantId: SSH_GRANT_ID,
          title: 'Every progress record is complete',
          mode: 'exploratory',
        }),
      ),
    ).run as ExperimentRun;
    const base = {
      schema_version: 1,
      template_version: run.loggingTemplate.version,
      objective_version: null,
      run_id: run.id,
      trial_id: run.trialId,
      server_label: run.serverLabel,
    };
    const stdout = [
      {
        ...base,
        occurred_at: '2026-08-05T00:00:02.000Z',
        event_type: 'run-start',
        sequence: 1,
        status: 'running',
      },
      {
        ...base,
        occurred_at: '2026-08-05T00:00:03.000Z',
        event_type: 'progress',
        sequence: 2,
        status: 'running',
        step: 'prepare',
        elapsed_seconds: 1,
      },
      {
        ...base,
        occurred_at: '2026-08-05T00:00:04.000Z',
        event_type: 'progress',
        sequence: 3,
        status: 'running',
        step: 'fit',
      },
      {
        ...base,
        occurred_at: '2026-08-05T00:00:05.000Z',
        event_type: 'run-end',
        sequence: 4,
        status: 'succeeded',
        elapsed_seconds: 3,
      },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n');
    ssh.runAgentWorkspaceCommand.mockResolvedValueOnce({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: 'e'.repeat(64),
      exitCode: 0,
      stdout,
      stderr: '',
      truncated: false,
      durationMs: 13,
    });
    ssh.runAgentWorkspaceFileOperation.mockResolvedValueOnce(
      experimentLogReadResult('logs/multi-progress-incomplete.jsonl', stdout),
    );

    const result = await invokeTool(
      session,
      toolCall('execute_experiment_run', {
        runId: run.id,
        grantId: SSH_GRANT_ID,
        command: '/usr/bin/python3',
        args: ['experiments/train.py'],
        timeoutSeconds: 120,
        logPath: 'logs/multi-progress-incomplete.jsonl',
        coveragePlan: experimentCoveragePlan,
      }),
    );

    expect(resultPayload(result)).toMatchObject({
      process: { outcome: 'failed', exitCode: 0 },
      logValidation: { state: 'incomplete', missingFields: ['elapsed_seconds'] },
      run: { status: 'failed', progressCurrent: null },
    });
    expect(experiments.recordRunSummaryMetric).not.toHaveBeenCalled();
  });

  it('preserves an external cancellation that races a completed SSH process', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const ssh = new FakeProjectSsh();
    const experiments = new FakeProjectExperiments(projectAlpha.id);
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      ssh,
      new FakeProjectLiterature(),
      experiments,
    );
    const created = resultPayload(
      await invokeTool(
        session,
        toolCall('create_experiment_run', {
          grantId: SSH_GRANT_ID,
          title: 'Cancellation race',
          mode: 'exploratory',
        }),
      ),
    ).run as ExperimentRun;
    let release!: (result: SshCommandResult) => void;
    ssh.runAgentWorkspaceCommand.mockImplementationOnce(
      () =>
        new Promise<SshCommandResult>((resolve) => {
          release = resolve;
        }),
    );
    const executing = invokeTool(
      session,
      toolCall('execute_experiment_run', {
        runId: created.id,
        grantId: SSH_GRANT_ID,
        command: '/usr/bin/python3',
        args: ['experiments/train.py'],
        timeoutSeconds: 120,
        logPath: 'logs/race.jsonl',
        coveragePlan: [
          { lifecycle: 'progress', fields: ['step', 'elapsed_seconds'] },
          { lifecycle: 'run-end', fields: ['elapsed_seconds'] },
        ],
      }),
    );
    await vi.waitFor(() =>
      expect(experiments.updateRun).toHaveBeenCalledWith(
        expect.objectContaining({ runId: created.id, status: 'running' }),
      ),
    );
    experiments.cancelExternally(created.id);
    release({
      schemaVersion: 1,
      trust: 'untrusted_remote_output',
      connectionLabel: 'Training GPU',
      commandSha256: 'e'.repeat(64),
      exitCode: 0,
      stdout: '{}',
      stderr: '',
      truncated: false,
      durationMs: 9,
    });

    const result = await executing;
    expect(resultPayload(result)).toMatchObject({
      process: { outcome: 'cancelled' },
      run: { status: 'cancelled' },
    });
    expect(experiments.linkRunLogSource).not.toHaveBeenCalled();
  });

  it('filters a foreign-project run from the project-bound experiment catalog', async () => {
    const { workspace, projectAlpha, projectBeta } = await workspaceFixture();
    const experiments = new FakeProjectExperiments(projectAlpha.id);
    const foreign: ExperimentRun = {
      ...(await experiments.createRun({
        projectId: projectAlpha.id,
        ideaId: null,
        title: 'Injected foreign run',
        mode: 'exploratory',
        serverLabel: 'Training GPU',
        trialId: 'foreign-trial',
      })),
      projectId: projectBeta.id,
    };
    (experiments.snapshot.runs as ExperimentRun[])[0] = foreign;
    const { session } = authorizedSession(
      workspace,
      projectAlpha.id,
      new FakeProjectVault(),
      new FakeProjectSsh(),
      new FakeProjectLiterature(),
      experiments,
    );

    const listed = await invokeTool(session, toolCall('list_experiment_runs', {}));
    expect(resultPayload(listed)).toEqual({ schemaVersion: 1, runs: [], totalMatching: 0 });
    const executed = await invokeTool(
      session,
      toolCall('execute_experiment_run', {
        runId: foreign.id,
        grantId: SSH_GRANT_ID,
        command: '/usr/bin/python3',
        args: ['experiments/train.py'],
        timeoutSeconds: 120,
        logPath: 'logs/foreign.jsonl',
        coveragePlan: [],
      }),
    );
    expect(resultPayload(executed)).toEqual({ error: 'experiment_run_not_found' });
  });
});
