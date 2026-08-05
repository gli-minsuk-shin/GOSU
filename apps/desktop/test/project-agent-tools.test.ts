import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  ProjectAgentToolSession,
  type ProjectAgentSsh,
  type ProjectAgentVault,
} from '../src/main/project-agent-tools';
import { WorkspaceService, type WorkspaceStorage } from '../src/main/workspace-service';
import type {
  CodexDynamicToolCall,
  CodexDynamicToolDelivery,
  CodexDynamicToolResult,
  CodexJsonValue,
} from '../src/main/codex-app-server';
import type { LocalNotesVaultGrant } from '../src/shared/project-chat-contracts';
import type {
  SshAgentCommand,
  SshCommandResult,
  SshConnectionProfile,
} from '../src/shared/ssh-contracts';
import type {
  GrantedRemoteWorkspace,
  SshWorkspaceAgentCommand,
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

  descriptor(): LocalNotesVaultGrant | null {
    return this.activeVaultId ? { id: this.activeVaultId, name: 'Research Vault' } : null;
  }

  matchesGrant(vaultId: string) {
    return this.activeVaultId === vaultId;
  }

  async validateGrant(expectedVaultId: string) {
    this.assertGrant(expectedVaultId);
  }

  private assertGrant(expectedVaultId: string) {
    if (this.activeVaultId === null) throw new Error('vault_not_selected');
    if (this.activeVaultId !== expectedVaultId) throw new Error('vault_grant_stale');
  }
}

class FakeProjectSsh implements ProjectAgentSsh {
  readonly connections: SshConnectionProfile[] = [
    {
      schemaVersion: 1,
      id: SSH_CONNECTION_ID,
      label: 'Training GPU',
      hostAlias: 'private-resolved-alias',
      version: 1,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
  ];
  readonly listConnections = vi.fn(async () => structuredClone(this.connections));
  readonly listWorkspaceGrants = vi.fn(
    async (projectId: string): Promise<readonly GrantedRemoteWorkspace[]> => [
      {
        grant: {
          schemaVersion: 1,
          id: SSH_GRANT_ID,
          projectId,
          connectionId: SSH_CONNECTION_ID,
          canonicalRoot: '/workspace',
          permissionMode: 'workspace',
          version: 1,
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
  readonly cancelSession = vi.fn(() => 1);
  readonly cancelProject = vi.fn(() => 1);
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

function authorizedSession(
  workspace: WorkspaceService,
  projectId: string,
  vault = new FakeProjectVault(),
  ssh = new FakeProjectSsh(),
) {
  return {
    session: new ProjectAgentToolSession({
      projectId,
      sessionId: CHAT_SESSION_ID,
      attemptId: CHAT_ATTEMPT_ID,
      workspace,
      vault,
      localNotesVault: { id: ACTIVE_VAULT_ID, name: 'Research Vault' },
      ssh,
    }),
    vault,
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
    const { session, vault, ssh } = authorizedSession(workspace, projectAlpha.id);
    await workspace.setProjectArchived({
      projectId: projectAlpha.id,
      expectedVersion: projectAlpha.version,
      archived: true,
    });

    for (const call of [
      toolCall('read_workspace', { section: 'summary' }),
      toolCall('list_local_notes', {}),
      toolCall('read_local_note', { noteId: NOTE_ID }),
      toolCall('list_ssh_workspaces', {}),
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
    expect(ssh.listWorkspaceGrants).not.toHaveBeenCalled();
    expect(ssh.runAgentWorkspaceCommand).not.toHaveBeenCalled();
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
      'list_ssh_workspaces',
      'run_ssh_workspace_command',
    ]);

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
    expect(vault.listForAgent).toHaveBeenCalledWith(ACTIVE_VAULT_ID, 'result', 7);
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
    expect(vault.readForAgent).toHaveBeenCalledWith(ACTIVE_VAULT_ID, NOTE_ID, 4, 32);
    expect(JSON.stringify(readPayload)).not.toContain(RAW_NOTE_PATH);
  });

  it('lists only opaque SSH IDs and labels, never aliases or resolved connection data', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, ssh } = authorizedSession(workspace, projectAlpha.id);

    const listed = await invokeTool(session, toolCall('list_ssh_workspaces', {}));
    const serialized = listed.contentItems[0]!.text;

    expect(listed.success).toBe(true);
    expect(resultPayload(listed)).toEqual({
      schemaVersion: 1,
      workspaces: [
        {
          grantId: SSH_GRANT_ID,
          connectionLabel: 'Training GPU',
          permissionMode: 'workspace',
        },
      ],
    });
    expect(ssh.listWorkspaceGrants).toHaveBeenCalledExactlyOnceWith(projectAlpha.id);
    expect(serialized).not.toContain('private-resolved-alias');
    expect(serialized).not.toContain('hostAlias');
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

  it('revokes current and future SSH calls without revoking project read tools', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, ssh } = authorizedSession(workspace, projectAlpha.id);

    session.revokeSshCapability();
    const listed = await invokeTool(session, toolCall('list_ssh_workspaces', {}));
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
    expect(resultPayload(executed)).toEqual({ error: 'ssh_cancelled' });
    expect(workspaceResult.success).toBe(true);
    expect(ssh.cancelSession).toHaveBeenCalledExactlyOnceWith(projectAlpha.id, CHAT_SESSION_ID);
    expect(ssh.listWorkspaceGrants).not.toHaveBeenCalled();
    expect(ssh.runAgentWorkspaceCommand).not.toHaveBeenCalled();
  });

  it('does not declare note tools without a grant and rejects a grant that becomes stale', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const vault = new FakeProjectVault();
    const noGrant = new ProjectAgentToolSession({
      projectId: projectAlpha.id,
      sessionId: CHAT_SESSION_ID,
      attemptId: CHAT_ATTEMPT_ID,
      workspace,
      vault,
      localNotesVault: null,
      ssh: new FakeProjectSsh(),
    });
    const noGrantTools = noGrant.dynamicTools.flatMap((spec) =>
      spec.type === 'namespace' ? spec.tools.map((tool) => tool.name) : [spec.name],
    );
    expect(noGrantTools).toEqual([
      'read_workspace',
      'list_ssh_workspaces',
      'run_ssh_workspace_command',
    ]);
    const unauthorized = await invokeTool(noGrant, toolCall('list_local_notes', {}));
    expect(unauthorized.success).toBe(false);
    expect(resultPayload(unauthorized)).toEqual({ error: 'local_notes_not_authorized' });

    const stale = authorizedSession(workspace, projectAlpha.id, vault).session;
    vault.activeVaultId = REPLACEMENT_VAULT_ID;
    const staleRead = await invokeTool(stale, toolCall('read_local_note', { noteId: NOTE_ID }));
    expect(staleRead.success).toBe(false);
    expect(resultPayload(staleRead)).toEqual({ error: 'local_notes_authorization_stale' });
    expect(vault.readForAgent).not.toHaveBeenCalled();
  });

  it('strictly validates every tool argument and never accepts a raw path', async () => {
    const { workspace, projectAlpha } = await workspaceFixture();
    const { session, vault } = authorizedSession(workspace, projectAlpha.id);
    const invalidCalls: Array<[string, CodexJsonValue]> = [
      ['read_workspace', { section: 'board', extra: true }],
      ['read_workspace', { section: 'notes' }],
      ['list_local_notes', { query: 'x', path: RAW_NOTE_PATH }],
      ['list_local_notes', { limit: 101 }],
      ['read_local_note', { noteId: '../result.md' }],
      ['read_local_note', { noteId: NOTE_ID, path: RAW_NOTE_PATH }],
      ['read_local_note', { noteId: NOTE_ID, offset: -1 }],
      ['read_local_note', { noteId: NOTE_ID, maxCharacters: 24_001 }],
    ];

    for (const [tool, arguments_] of invalidCalls) {
      const result = await invokeTool(session, toolCall(tool, arguments_));
      expect(result.success, `${tool}: ${JSON.stringify(arguments_)}`).toBe(false);
      expect(resultPayload(result)).toEqual({ error: 'invalid_tool_arguments' });
    }
    expect(vault.listForAgent).not.toHaveBeenCalled();
    expect(vault.readForAgent).not.toHaveBeenCalled();
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
    expect(appendix).toContain('Local Notes accessed');
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
    expect(appendix).toContain('Local Notes accessed');
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
});
