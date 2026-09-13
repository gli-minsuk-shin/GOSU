import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  ProjectAgentToolSession,
  type ProjectAgentExperiments,
  type ProjectAgentVault,
} from '../src/main/project-agent-tools';
import {
  EXPERIMENT_LOGGING_SYSTEM_FIELDS,
  type ExperimentWorkspaceSnapshot,
} from '../src/shared/experiment-workspace-contracts';
import type { CodexJsonValue, CodexDynamicToolCall } from '../src/main/codex-app-server';
import type { ResearchPlanSnapshot } from '../src/main/project-research-plan-service';
import type { ProjectResearchPlan } from '../src/shared/project-research-plan-contracts';
import { loggingTemplateHash } from '../src/main/experiment-workspace-service';
import { researchPlanFixture } from './project-research-plan-fixture';

async function fixture(canApply = true, connected = true) {
  const f = await researchPlanFixture();
  const template = {
    schemaVersion: 1 as const,
    id: randomUUID(),
    projectId: f.project.id,
    version: 1,
    previousRevisionId: null,
    systemFields: EXPERIMENT_LOGGING_SYSTEM_FIELDS,
    customFields: [],
    templateHash: loggingTemplateHash([]),
    createdAt: new Date().toISOString(),
  };
  f.storage.templates.set(f.project.id, template);
  const createRun = vi.fn(async () => {
    throw Error('Plan saving cannot execute experiments');
  });
  const experiments = {
    list: vi.fn(
      async () =>
        structuredClone({
          schemaVersion: 1,
          projectId: f.project.id,
          loggingTemplate: template,
          ideas: [],
          runs: [],
          metricPoints: [],
        }) as unknown as ExperimentWorkspaceSnapshot,
    ),
    createRun,
  } as unknown as ProjectAgentExperiments;
  const apply = vi.fn(
    async (
      plan: ProjectResearchPlan,
      snapshot: ResearchPlanSnapshot,
      _call: CodexDynamicToolCall,
      signal: AbortSignal,
    ) => f.service.apply({ ...f.input, plan, snapshot }, signal),
  );
  const session = new ProjectAgentToolSession({
    projectId: f.project.id,
    sessionId: f.input.sessionId,
    attemptId: f.input.attemptId,
    workspace: f.workspace,
    vault: { matchesGrant: () => false } as unknown as ProjectAgentVault,
    localNotesVault: null,
    experiments,
    ...(connected
      ? {
          researchPlans: {
            canApply,
            read: (ideaId?: string) => f.service.read(f.project.id, ideaId),
            apply,
          },
        }
      : {}),
  });
  const call = async (
    tool: string,
    args: unknown = {},
    signal = new AbortController().signal,
    namespace = 'gosu_project',
  ) => {
    const response = await session.handler(
      {
        threadId: 'fixture-thread',
        turnId: 'fixture-turn',
        callId: randomUUID(),
        namespace,
        tool,
        arguments: args as CodexJsonValue,
      },
      { abortSignal: signal, outcome: Promise.resolve('delivered') },
    );
    return {
      response,
      payload: JSON.parse(response.contentItems[0]!.text) as Record<string, unknown>,
    };
  };
  const read = async () =>
    ((await call('read_experiment_setup')).payload.researchPlan as { snapshotToken: string })
      .snapshotToken;
  return { ...f, session, call, read, apply, createRun };
}
it('registers write capability only when explicitly enabled, retaining read-only setup access', async () => {
  const absent = await fixture(true, false);
  expect(JSON.stringify(absent.session.dynamicTools)).not.toContain('apply_research_plan');
  const readonly = await fixture(false);
  expect(JSON.stringify(readonly.session.dynamicTools)).not.toContain(
    '"name":"apply_research_plan"',
  );
  expect((await readonly.call('read_experiment_setup')).response.success).toBe(true);
  expect((await readonly.call('apply_research_plan')).response.success).toBe(false);
  expect(readonly.apply).not.toHaveBeenCalled();
});
it('requires a server-issued same-session snapshot and rejects forged/cross-project arguments', async () => {
  const f = await fixture();
  expect(
    (await f.call('apply_research_plan', { snapshotToken: randomUUID(), plan: f.input.plan }))
      .response.success,
  ).toBe(false);
  const token = await f.read();
  for (const args of [
    { snapshotToken: token, plan: f.input.plan, projectId: randomUUID() },
    { snapshotToken: token, plan: { ...f.input.plan, projectId: randomUUID() } },
  ])
    expect((await f.call('apply_research_plan', args)).response.success).toBe(false);
  expect(
    (
      await f.call(
        'apply_research_plan',
        { snapshotToken: token, plan: f.input.plan },
        f.signal,
        'other_project',
      )
    ).response.success,
  ).toBe(false);
  expect(f.apply).not.toHaveBeenCalled();
});
it('saves the typed plan once, reports real linked records and never invokes a compute launcher', async () => {
  const f = await fixture();
  const snapshotToken = await f.read();
  const result = await f.call('apply_research_plan', { snapshotToken, plan: f.input.plan });
  expect(result.response.success).toBe(true);
  expect(result.payload.receipt).toMatchObject({
    projectId: f.project.id,
    sourceSessionId: f.input.sessionId,
    needsIdentity: true,
  });
  const again = await f.call('apply_research_plan', { snapshotToken, plan: f.input.plan });
  expect(again.payload.reused).toBe(true);
  expect(f.storage.bundles).toHaveLength(1);
  expect(f.createRun).not.toHaveBeenCalled();
  for (const section of ['goal', 'rules', 'logging', 'evaluator'])
    expect((await f.call('read_research_plan', { section })).response.success).toBe(true);
  expect(
    (await f.call('read_research_plan', { section: 'rules' })).payload.experimentRules,
  ).toEqual(f.input.plan.experimentRules);
});
it.each(['abort', 'terminal'] as const)('does not save after %s cancellation', async (kind) => {
  const f = await fixture();
  const snapshotToken = await f.read();
  if (kind === 'terminal') f.session.beginTerminal();
  const signal = kind === 'abort' ? AbortSignal.abort() : f.signal;
  expect(
    (await f.call('apply_research_plan', { snapshotToken, plan: f.input.plan }, signal)).response
      .success,
  ).toBe(false);
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.storage.bundles).toHaveLength(0);
});
it('reports stale plan snapshots without claiming success and bounds issued tokens', async () => {
  const f = await fixture();
  const old = await f.read();
  for (let i = 0; i < 4; i++) await f.read();
  expect(
    (await f.call('apply_research_plan', { snapshotToken: old, plan: f.input.plan })).response
      .success,
  ).toBe(false);
  const snapshotToken = await f.read();
  f.storage.templates.get(f.project.id)!.version = 2;
  const result = await f.call('apply_research_plan', { snapshotToken, plan: f.input.plan });
  expect(result.response.success).toBe(false);
  expect(JSON.stringify(result.payload)).toContain('research_plan_stale');
  expect(f.storage.bundles).toHaveLength(0);
});
it('binds the token to the setup actually displayed, not a later unseen revision', async () => {
  const f = await fixture();
  vi.spyOn(f.service, 'read').mockImplementationOnce(async () => {
    f.storage.templates.get(f.project.id)!.version = 2;
    return null;
  });
  const shown = await f.call('read_experiment_setup');
  expect((shown.payload.loggingTemplate as { version: number }).version).toBe(1);
  const context = shown.payload.researchPlan as { snapshotToken: string; loggingVersion: number };
  expect(context.loggingVersion).toBe(1);
  expect(
    (
      await f.call('apply_research_plan', {
        snapshotToken: context.snapshotToken,
        plan: f.input.plan,
      })
    ).response.success,
  ).toBe(false);
  expect(f.storage.bundles).toHaveLength(0);
});
it('revokes an in-flight plan write when the provider turn finishes', async () => {
  const f = await fixture(),
    snapshotToken = await f.read();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => {
      enter = r;
    }),
    wait = new Promise<void>((r) => {
      release = r;
    });
  const original = f.storage.getLatestExperimentLoggingTemplate.bind(f.storage);
  Object.assign(f.storage, {
    getLatestExperimentLoggingTemplate: async (projectId: string) => {
      enter();
      await wait;
      return original(projectId);
    },
  });
  const pending = f.call('apply_research_plan', { snapshotToken, plan: f.input.plan });
  await entered;
  f.session.beginTerminal();
  release();
  expect((await pending).response.success).toBe(false);
  expect(f.storage.bundles).toHaveLength(0);
});
it('reads an older idea’s original rules and goal rather than the latest plan', async () => {
  const f = await fixture();
  const first = await f.service.apply(
    { ...f.input, snapshot: await f.service.snapshot(f.project.id) },
    f.signal,
  );
  await f.service.apply(
    {
      ...f.input,
      attemptId: randomUUID(),
      snapshot: await f.service.snapshot(f.project.id),
      plan: { ...f.input.plan, experimentRules: ['Different new protocol rule'] },
    },
    f.signal,
  );
  const old = await f.call('read_research_plan', {
    section: 'rules',
    ideaId: first.receipt.ideaId,
  });
  expect(old.payload.experimentRules).toEqual(f.input.plan.experimentRules);
  const goal = await f.call('read_research_plan', {
    section: 'goal',
    ideaId: first.receipt.ideaId,
  });
  expect((goal.payload.boundObjective as { id: string }).id).toBe(first.receipt.objectiveId);
  expect(
    (await f.call('read_research_plan', { section: 'rules', ideaId: randomUUID() })).payload.plan,
  ).toBeNull();
});
