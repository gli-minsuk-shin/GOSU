import { describe, expect, it, vi } from 'vitest';

import type { ModelInvocation } from '@gosu/contracts';

import type { LocalDatabase, StoredModelUsageRow } from '../src/main/local-database';
import { ModelUsageService } from '../src/main/model-usage-service';

const invocation: ModelInvocation = {
  schemaVersion: 1,
  invocationId: '11111111-1111-4111-8111-111111111111',
  providerId: 'codex',
  requestedModelId: null,
  resolvedModelId: 'gpt-5',
  catalogVersion: 'catalog-1',
  reasoningOptionId: null,
  startedAt: '2026-08-20T00:00:00.000Z',
};

function storageFixture(overrides: Record<string, unknown> = {}) {
  return {
    isReady: () => true,
    recordAttributedModelInvocation: vi.fn(),
    recordModelInvocation: vi.fn(),
    bindModelUsageAttribution: vi.fn(),
    recordCodexModelUsageTotal: vi.fn(),
    finishModelUsageTurn: vi.fn(),
    recordAcpModelUsage: vi.fn(),
    getModelUsageTrackingStartedAt: () => '2026-08-01T00:00:00.000Z',
    listStoredModelUsage: () => [],
    listStoredLectureUsageAttempts: () => [],
    ...overrides,
  } as unknown as LocalDatabase & {
    recordModelInvocation: ReturnType<typeof vi.fn>;
    recordAttributedModelInvocation: ReturnType<typeof vi.fn>;
    bindModelUsageAttribution: ReturnType<typeof vi.fn>;
    recordCodexModelUsageTotal: ReturnType<typeof vi.fn>;
    finishModelUsageTurn: ReturnType<typeof vi.fn>;
  };
}

function workspaceFixture() {
  return {
    snapshot: async () => ({
      projects: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Statistics' }],
    }),
  };
}
it('records input/output when optional cache counters are absent instead of dropping the whole native report', () => {
  const storage = storageFixture();
  const service = new ModelUsageService(storage, workspaceFixture());
  service.bindThread('thread', {
    workloadKind: 'project_chat',
    projectId: '22222222-2222-4222-8222-222222222222',
  });
  service.recordInvocation({ threadId: 'thread', turnId: 'turn', invocation });
  service.recordCodexNotification({
    method: 'thread/tokenUsage/updated',
    params: {
      threadId: 'thread',
      turnId: 'turn',
      tokenUsage: {
        total: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 80 },
      },
    },
  });
  expect(storage.recordCodexModelUsageTotal).toHaveBeenCalledWith(
    expect.objectContaining({
      totals: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cachedReadTokens: 80,
        cachedWriteTokens: null,
        reasoningOutputTokens: null,
      },
    }),
  );
});
it('combines assistant usage with project/model breakdowns without creating a phantom project or double counting', async () => {
  const storage = storageFixture({
    listStoredModelUsage: () => [
      storedUsageRow({ resolvedModelId: 'model-A', workloadKind: 'project_chat' }),
      storedUsageRow({
        invocationId: 'second',
        resolvedModelId: 'model-B',
        workloadKind: 'project_chat',
        inputTokens: 200,
        totalTokens: 220,
      }),
    ],
  });
  const assistant = storedUsageRow({
    invocationId: 'assistant',
    projectId: '00000000-0000-4000-8000-000000000000',
    workloadKind: 'briefing_assistant',
    resolvedModelId: 'model-A',
  });
  const service = new ModelUsageService(storage, workspaceFixture(), async () => [assistant]);
  const query = { period: 'day' as const, anchorDate: '2026-08-20', timeZone: 'UTC' };
  const result = await service.query(query);
  expect(result.totals.tokens.totalTokens).toBe(460);
  expect(result.byProject).toHaveLength(1);
  expect(result.byProjectModel).toHaveLength(2);
  expect(
    result.byWorkload.find((r) => r.workloadKind === 'briefing_assistant')?.tokens.totalTokens,
  ).toBe(120);
  const selected = await service.query({ ...query, workloadKind: 'briefing_assistant' });
  expect(selected.byProject).toEqual([]);
  expect(selected.byModel).toHaveLength(1);
  expect(selected.totals.tokens.totalTokens).toBe(120);
});
it('breaks every feature down by model, assistant usage included, so a feature can be priced', async () => {
  // A feature has no price of its own: the Usage screen sums the cost of the models that ran it.
  const storage = storageFixture({
    listStoredModelUsage: () => [
      storedUsageRow({ resolvedModelId: 'model-A', workloadKind: 'project_chat' }),
      storedUsageRow({
        invocationId: 'second',
        resolvedModelId: 'model-B',
        workloadKind: 'project_chat',
        inputTokens: 200,
        totalTokens: 220,
      }),
      storedUsageRow({
        invocationId: 'third',
        resolvedModelId: 'model-A',
        workloadKind: 'literature_organize',
      }),
    ],
  });
  // The AI assistant and the briefing summaries belong to no project; their cost must not vanish.
  const assistant = storedUsageRow({
    invocationId: 'assistant',
    projectId: '00000000-0000-4000-8000-000000000000',
    workloadKind: 'briefing_assistant',
    resolvedModelId: 'model-A',
  });
  const service = new ModelUsageService(storage, workspaceFixture(), async () => [assistant]);
  const query = { period: 'day' as const, anchorDate: '2026-08-20', timeZone: 'UTC' };
  const result = await service.query(query);
  const parts = result.byWorkloadModel!;
  expect(parts.map((p) => [p.workloadKind, p.resolvedModelId, p.tokens.totalTokens])).toEqual([
    ['project_chat', 'model-B', 220],
    ['project_chat', 'model-A', 120],
    ['literature_organize', 'model-A', 120],
    ['briefing_assistant', 'model-A', 120],
  ]);
  expect(result.byProjectModel!.some((p) => p.projectId.startsWith('00000000'))).toBe(false);
  // The parts add up to both marginals and to the total, in tokens and in turns.
  const sum = (rows: readonly { tokens: { totalTokens: number } }[]) =>
    rows.reduce((total, row) => total + row.tokens.totalTokens, 0);
  for (const model of result.byModel)
    expect(sum(parts.filter((p) => p.resolvedModelId === model.resolvedModelId))).toBe(
      model.tokens.totalTokens,
    );
  for (const workload of result.byWorkload)
    expect(sum(parts.filter((p) => p.workloadKind === workload.workloadKind))).toBe(
      workload.tokens.totalTokens,
    );
  expect(parts.reduce((turns, p) => turns + p.turnCount, 0)).toBe(result.totals.turnCount);
  // Every filter narrows the parts like the rest of the report.
  const feature = await service.query({ ...query, workloadKind: 'project_chat' });
  expect(feature.byWorkloadModel!.map((p) => p.resolvedModelId).sort()).toEqual([
    'model-A',
    'model-B',
  ]);
  const model = await service.query({
    ...query,
    modelId: 'model-B',
    connectionKey: 'codex:chatgpt',
  });
  expect(model.byWorkloadModel).toHaveLength(1);
  const project = await service.query({
    ...query,
    projectId: '22222222-2222-4222-8222-222222222222',
  });
  expect(project.byWorkloadModel!.some((p) => p.workloadKind === 'briefing_assistant')).toBe(false);
});

// 2026-09-22 user request: tabs for Briefing and paper summaries at the bottom of the Usage screen.
it('lists briefing and paper summary usage by local day and model, and nothing else there', async () => {
  const global = '00000000-0000-4000-8000-000000000000';
  const native = [
    storedUsageRow({
      invocationId: 'b1',
      projectId: global,
      workloadKind: 'briefing_summary',
      resolvedModelId: 'model-A',
      startedAt: '2026-08-18T16:00:00.000Z', // 19 August in Seoul
    }),
    storedUsageRow({
      invocationId: 'b2',
      projectId: global,
      workloadKind: 'briefing_summary',
      resolvedModelId: 'model-A',
      startedAt: '2026-08-19T01:00:00.000Z',
    }),
    storedUsageRow({
      invocationId: 'b3',
      projectId: global,
      workloadKind: 'briefing_summary',
      resolvedModelId: 'model-B',
      startedAt: '2026-08-19T02:00:00.000Z',
    }),
    storedUsageRow({
      invocationId: 'p1',
      projectId: global,
      workloadKind: 'paper_summary',
      resolvedModelId: 'model-A',
      startedAt: '2026-08-20T03:00:00.000Z',
    }),
    storedUsageRow({
      invocationId: 'a1',
      projectId: global,
      workloadKind: 'briefing_assistant',
      resolvedModelId: 'model-A',
      startedAt: '2026-08-20T03:00:00.000Z',
    }),
  ];
  const service = new ModelUsageService(
    storageFixture({ listStoredModelUsage: () => [] }),
    workspaceFixture(),
    async () => native,
  );
  const query = { period: 'week' as const, anchorDate: '2026-08-20', timeZone: 'Asia/Seoul' };
  const result = await service.query(query);
  expect(
    result.byDayWorkloadModel!.map((row) => [
      row.bucketKey,
      row.workloadKind,
      row.resolvedModelId,
      row.turnCount,
      row.tokens.totalTokens,
    ]),
  ).toEqual([
    // Newest day first; the assistant is not a detail tab and is left out.
    ['2026-08-20', 'paper_summary', 'model-A', 1, 120],
    ['2026-08-19', 'briefing_summary', 'model-A', 2, 240],
    ['2026-08-19', 'briefing_summary', 'model-B', 1, 120],
  ]);
  // The days of a feature add up to that feature's total in the same report.
  for (const kind of ['briefing_summary', 'paper_summary'] as const)
    expect(
      result
        .byDayWorkloadModel!.filter((row) => row.workloadKind === kind)
        .reduce((sum, row) => sum + row.tokens.totalTokens, 0),
    ).toBe(result.byWorkload.find((row) => row.workloadKind === kind)!.tokens.totalTokens);
  // Filters narrow it like the rest of the report.
  const filtered = await service.query({
    ...query,
    modelId: 'model-B',
    connectionKey: 'codex:chatgpt',
  });
  expect(filtered.byDayWorkloadModel!.map((row) => row.resolvedModelId)).toEqual(['model-B']);
});

function storedUsageRow(overrides: Partial<StoredModelUsageRow> = {}): StoredModelUsageRow {
  return {
    invocationId: invocation.invocationId,
    providerId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    resolvedModelId: 'gpt-5',
    startedAt: '2026-08-20T00:00:00.000Z',
    coverage: 'exact',
    terminalStatus: 'completed',
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    cachedReadTokens: 10,
    cachedWriteTokens: 2,
    reasoningOutputTokens: 5,
    workloadKind: 'literature_organize',
    projectId: '22222222-2222-4222-8222-222222222222',
    projectChatSessionId: null,
    projectChatAttemptId: null,
    lectureStudioId: null,
    lectureAttemptId: null,
    connectionKey: 'codex:chatgpt',
    connectionLabel: 'ChatGPT',
    upstreamProviderId: null,
    ...overrides,
  };
}

describe('ModelUsageService', () => {
  it('buffers an early cumulative Codex total and replays it after invocation binding', () => {
    const storage = storageFixture();
    const service = new ModelUsageService(storage, workspaceFixture());
    service.bindThread('thread-1', {
      workloadKind: 'project_chat',
      projectId: '22222222-2222-4222-8222-222222222222',
      projectChatSessionId: '33333333-3333-4333-8333-333333333333',
      projectChatAttemptId: '44444444-4444-4444-8444-444444444444',
    });
    service.recordCodexNotification({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        tokenUsage: {
          total: {
            inputTokens: 100,
            cachedInputTokens: 20,
            cacheWriteInputTokens: 5,
            outputTokens: 40,
            reasoningOutputTokens: 10,
            totalTokens: 140,
          },
          last: { inputTokens: 999, outputTokens: 999, totalTokens: 1_998 },
        },
      },
    });
    expect(storage.recordCodexModelUsageTotal).not.toHaveBeenCalled();

    service.recordInvocation({ threadId: 'thread-1', turnId: 'turn-1', invocation });

    expect(storage.recordCodexModelUsageTotal).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'codex',
        threadId: 'thread-1',
        turnId: 'turn-1',
        totals: {
          inputTokens: 100,
          cachedReadTokens: 20,
          cachedWriteTokens: 5,
          outputTokens: 40,
          reasoningOutputTokens: 10,
          totalTokens: 140,
        },
      }),
    );
  });

  it('ignores raw responses, ACP usage updates, last-only data, and incomplete Codex totals', () => {
    const storage = storageFixture();
    const service = new ModelUsageService(storage, workspaceFixture());
    service.recordCodexNotification({ method: 'rawResponse/completed', params: {} });
    service.recordCodexNotification({ method: 'usage_update', params: { inputTokens: 500 } });
    service.recordCodexNotification({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        tokenUsage: { total: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      },
    });
    expect(storage.recordCodexModelUsageTotal).not.toHaveBeenCalled();
  });

  it('snapshots only the trusted Codex connection category', () => {
    const storage = storageFixture();
    const service = new ModelUsageService(storage, workspaceFixture());
    service.observeCodexAccount({
      account: { type: 'chatgpt', email: 'private@example.test', planType: 'secret' },
    });
    service.bindThread('thread-1', {
      workloadKind: 'literature_organize',
      projectId: '22222222-2222-4222-8222-222222222222',
    });
    service.recordInvocation({ threadId: 'thread-1', turnId: 'turn-1', invocation });
    expect(storage.recordAttributedModelInvocation).toHaveBeenCalledWith(
      'thread-1',
      'turn-1',
      invocation,
      expect.any(Object),
      {
        connectionKey: 'codex:chatgpt',
        connectionLabel: 'ChatGPT',
        upstreamProviderId: null,
      },
    );
    expect(JSON.stringify(storage.recordAttributedModelInvocation.mock.calls)).not.toContain(
      'private',
    );
  });

  it.each([
    ['apikey', 'codex:api-key', 'OpenAI API'],
    ['bedrockApiKey', 'codex:amazon-bedrock', 'Amazon Bedrock'],
    ['chatgptAuthTokens', 'codex:chatgpt', 'ChatGPT'],
  ] as const)('maps the Codex %s auth mode to a verified connection', (authMode, key, label) => {
    const storage = storageFixture();
    const service = new ModelUsageService(storage, workspaceFixture());
    service.observeCodexAccount({ account: null, authMode });
    service.bindThread('thread-1', {
      workloadKind: 'literature_organize',
      projectId: '22222222-2222-4222-8222-222222222222',
    });
    service.recordInvocation({ threadId: 'thread-1', turnId: 'turn-1', invocation });

    expect(storage.recordAttributedModelInvocation).toHaveBeenCalledWith(
      'thread-1',
      'turn-1',
      invocation,
      expect.any(Object),
      expect.objectContaining({ connectionKey: key, connectionLabel: label }),
    );
  });

  it('isolates optional analytics storage failures from active model turns', () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const storage = storageFixture({
        recordAttributedModelInvocation: vi.fn(() => {
          throw new Error('sqlcipher_unavailable');
        }),
        recordAcpModelUsage: vi.fn(() => {
          throw new Error('sqlcipher_unavailable');
        }),
        finishModelUsageTurn: vi.fn(() => {
          throw new Error('sqlcipher_unavailable');
        }),
      });
      const service = new ModelUsageService(storage, workspaceFixture());
      service.bindThread('thread-1', {
        workloadKind: 'literature_organize',
        projectId: '22222222-2222-4222-8222-222222222222',
      });
      expect(() =>
        service.recordInvocation({ threadId: 'thread-1', turnId: 'turn-1', invocation }),
      ).not.toThrow();
      expect(() =>
        service.recordAcpPromptResult({
          threadId: 'hermes-thread',
          turnId: 'hermes-turn',
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            totalTokens: 12,
            cachedReadTokens: 1,
            cachedWriteTokens: 0,
            reasoningOutputTokens: 1,
          },
          stopReason: 'end_turn',
          successful: true,
        }),
      ).not.toThrow();
      expect(() =>
        service.recordAcpNotification({
          method: 'turn/completed',
          params: {
            threadId: 'hermes-thread',
            turn: { id: 'hermes-turn', status: 'completed' },
          },
        }),
      ).not.toThrow();
      expect(diagnostic).toHaveBeenCalledWith(
        '[GOSU] Model usage record-invocation collection failed.',
      );
      expect(diagnostic).toHaveBeenCalledWith(
        '[GOSU] Model usage acp-prompt-result collection failed.',
      );
      expect(diagnostic).toHaveBeenCalledWith(
        '[GOSU] Model usage acp-notification collection failed.',
      );
    } finally {
      diagnostic.mockRestore();
    }
  });

  it('attributes Claude Code subscription usage to its own provider row', () => {
    const storage = storageFixture();
    const service = new ModelUsageService(storage, workspaceFixture());

    service.recordAcpPromptResult({
      threadId: 'claude-code:thread:1',
      turnId: 'claude-code:turn:1',
      providerId: 'claude-code',
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        cachedReadTokens: 80,
        cachedWriteTokens: 20,
        reasoningOutputTokens: null,
      },
      stopReason: 'success',
      successful: true,
    });

    expect(storage.recordAcpModelUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'claude-code',
        threadId: 'claude-code:thread:1',
        turnId: 'claude-code:turn:1',
      }),
    );
  });

  it('keeps unavailable lecture generations visible while aggregating only known tokens', async () => {
    const projectId = '22222222-2222-4222-8222-222222222222';
    const studioId = '55555555-5555-4555-8555-555555555555';
    const attemptId = '66666666-6666-4666-8666-666666666666';
    const row: StoredModelUsageRow = {
      invocationId: invocation.invocationId,
      providerId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      resolvedModelId: 'gpt-5',
      startedAt: '2026-08-20T00:00:00.000Z',
      coverage: 'unavailable',
      terminalStatus: 'failed',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedReadTokens: null,
      cachedWriteTokens: null,
      reasoningOutputTokens: null,
      workloadKind: 'lecture_generation',
      projectId,
      projectChatSessionId: null,
      projectChatAttemptId: null,
      lectureStudioId: studioId,
      lectureAttemptId: attemptId,
      connectionKey: 'codex:chatgpt',
      connectionLabel: 'ChatGPT',
      upstreamProviderId: null,
    };
    const storage = storageFixture({
      listStoredModelUsage: () => [row],
      listStoredLectureUsageAttempts: () => [
        {
          studioId,
          studioTitle: 'Bootstrap',
          attemptId,
          projectId,
          status: 'failed',
          startedAt: row.startedAt,
          completedAt: '2026-08-20T00:01:00.000Z',
        },
      ],
    });
    const service = new ModelUsageService(storage, workspaceFixture());
    const report = await service.query({
      period: 'day',
      anchorDate: '2026-08-20',
      timeZone: 'UTC',
    });
    expect(report.totals).toMatchObject({
      turnCount: 1,
      unavailableTurnCount: 1,
      tokens: { totalTokens: 0 },
    });
    expect(report.lectureGenerations.items[0]).toMatchObject({
      coverage: 'unavailable',
      tokens: null,
      turnCount: 1,
    });
  });

  it('aggregates an initial lecture draft and correction as one generation', async () => {
    const projectId = '22222222-2222-4222-8222-222222222222';
    const studioId = '55555555-5555-4555-8555-555555555555';
    const attemptId = '66666666-6666-4666-8666-666666666666';
    const first = storedUsageRow({
      workloadKind: 'lecture_generation',
      projectId,
      lectureStudioId: studioId,
      lectureAttemptId: attemptId,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    });
    const correction = storedUsageRow({
      invocationId: '77777777-7777-4777-8777-777777777777',
      threadId: 'thread-2',
      turnId: 'turn-2',
      startedAt: '2026-08-20T00:01:00.000Z',
      workloadKind: 'lecture_generation',
      projectId,
      lectureStudioId: studioId,
      lectureAttemptId: attemptId,
      inputTokens: 60,
      outputTokens: 15,
      totalTokens: 75,
      cachedReadTokens: 6,
      cachedWriteTokens: 1,
      reasoningOutputTokens: 3,
    });
    const storage = storageFixture({
      listStoredModelUsage: () => [first, correction],
      listStoredLectureUsageAttempts: () => [
        {
          studioId,
          studioTitle: 'Bootstrap',
          attemptId,
          projectId,
          status: 'succeeded',
          startedAt: first.startedAt,
          completedAt: '2026-08-20T00:02:00.000Z',
        },
      ],
    });
    const report = await new ModelUsageService(storage, workspaceFixture()).query({
      period: 'day',
      anchorDate: '2026-08-20',
      timeZone: 'UTC',
    });
    expect(report.lectureGenerations.items).toHaveLength(1);
    expect(report.lectureGenerations.items[0]).toMatchObject({
      attemptId,
      coverage: 'exact',
      turnCount: 2,
      tokens: { inputTokens: 160, outputTokens: 35, totalTokens: 195 },
      byConnection: [
        expect.objectContaining({
          turnCount: 2,
          tokens: expect.objectContaining({
            inputTokens: 160,
            outputTokens: 35,
            totalTokens: 195,
          }),
        }),
      ],
    });
  });

  it('shows one row for the Codex account when older turns were recorded before the login was read', async () => {
    // Turns recorded before GOSU read the Codex login say only "Codex"; the same account was
    // later labelled "ChatGPT", and the user saw two rows for one login.
    const early = storedUsageRow({
      connectionKey: 'codex:unknown',
      connectionLabel: 'Codex',
      inputTokens: 400,
      outputTokens: 100,
      totalTokens: 500,
    });
    const later = storedUsageRow({
      invocationId: '77777777-7777-4777-8777-777777777777',
      threadId: 'thread-2',
      turnId: 'turn-2',
      inputTokens: 200,
      outputTokens: 50,
      totalTokens: 250,
    });
    const query = { period: 'day', anchorDate: '2026-08-20', timeZone: 'UTC' } as const;

    const merged = await new ModelUsageService(
      storageFixture({ listStoredModelUsage: () => [early, later] }),
      workspaceFixture(),
    ).query(query);

    expect(merged.byConnection).toEqual([
      expect.objectContaining({
        connectionKey: 'codex:chatgpt',
        connectionLabel: 'ChatGPT',
        tokens: expect.objectContaining({ totalTokens: 750 }),
      }),
    ]);
    // Drilling into the merged row keeps both turns, so the row and its detail agree.
    const drilled = await new ModelUsageService(
      storageFixture({ listStoredModelUsage: () => [early, later] }),
      workspaceFixture(),
    ).query({ ...query, connectionKey: 'codex:chatgpt' });
    expect(drilled.byConnection.map((row) => row.tokens.totalTokens)).toEqual([750]);

    // Two labelled Codex logins in the range: the unlabelled turns belong to neither for sure,
    // so they keep their own row instead of being guessed into one.
    const apiKey = storedUsageRow({
      invocationId: '88888888-8888-4888-8888-888888888888',
      threadId: 'thread-3',
      turnId: 'turn-3',
      connectionKey: 'codex:api-key',
      connectionLabel: 'OpenAI API',
      upstreamProviderId: 'openai',
      inputTokens: 40,
      outputTokens: 5,
      totalTokens: 45,
    });
    const ambiguous = await new ModelUsageService(
      storageFixture({ listStoredModelUsage: () => [early, later, apiKey] }),
      workspaceFixture(),
    ).query(query);
    expect(ambiguous.byConnection.map((row) => row.connectionLabel).sort()).toEqual([
      'ChatGPT',
      'Codex',
      'OpenAI API',
    ]);
  });

  it('keeps resolved model token totals separate even on the same connection', async () => {
    const sol = storedUsageRow({
      resolvedModelId: 'gpt-5.6-sol',
      inputTokens: 2_400,
      outputTokens: 600,
      totalTokens: 3_000,
    });
    const opus = storedUsageRow({
      invocationId: '77777777-7777-4777-8777-777777777777',
      threadId: 'thread-2',
      turnId: 'turn-2',
      resolvedModelId: 'claude-opus-5',
      inputTokens: 900,
      outputTokens: 450,
      totalTokens: 1_350,
    });
    const storage = storageFixture({ listStoredModelUsage: () => [sol, opus] });

    const report = await new ModelUsageService(storage, workspaceFixture()).query({
      period: 'day',
      anchorDate: '2026-08-20',
      timeZone: 'UTC',
    });

    expect(report.byModel).toEqual([
      expect.objectContaining({
        resolvedModelId: 'gpt-5.6-sol',
        tokens: expect.objectContaining({
          inputTokens: 2_400,
          outputTokens: 600,
          totalTokens: 3_000,
        }),
      }),
      expect.objectContaining({
        resolvedModelId: 'claude-opus-5',
        tokens: expect.objectContaining({
          inputTokens: 900,
          outputTokens: 450,
          totalTokens: 1_350,
        }),
      }),
    ]);
  });

  it('reports finalized draft usage as a partial lower bound while correction is running', async () => {
    const projectId = '22222222-2222-4222-8222-222222222222';
    const studioId = '55555555-5555-4555-8555-555555555555';
    const attemptId = '66666666-6666-4666-8666-666666666666';
    const first = storedUsageRow({
      workloadKind: 'lecture_generation',
      projectId,
      lectureStudioId: studioId,
      lectureAttemptId: attemptId,
    });
    const storage = storageFixture({
      listStoredModelUsage: () => [first],
      listStoredLectureUsageAttempts: () => [
        {
          studioId,
          studioTitle: 'Bootstrap correction',
          attemptId,
          projectId,
          status: 'running',
          startedAt: first.startedAt,
          completedAt: null,
        },
      ],
    });

    const report = await new ModelUsageService(storage, workspaceFixture()).query({
      period: 'day',
      anchorDate: '2026-08-20',
      timeZone: 'UTC',
    });

    expect(report.lectureGenerations.items[0]).toMatchObject({
      attemptId,
      status: 'running',
      coverage: 'partial',
      turnCount: 1,
      tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    });
  });

  it('starts a day at the first representable local instant when midnight is skipped', async () => {
    const report = await new ModelUsageService(storageFixture(), workspaceFixture()).query({
      period: 'day',
      anchorDate: '2025-09-07',
      timeZone: 'America/Santiago',
    });

    expect(report.range).toMatchObject({
      fromInclusive: '2025-09-07T04:00:00.000Z',
      toExclusive: '2025-09-08T03:00:00.000Z',
    });
    expect(report.series).toEqual([
      expect.objectContaining({
        bucketKey: '2025-09-07',
        fromInclusive: '2025-09-07T04:00:00.000Z',
        toExclusive: '2025-09-08T03:00:00.000Z',
      }),
    ]);
  });

  it('freezes Lecture pagination and clamps an offset beyond the snapshot total', async () => {
    const projectId = '22222222-2222-4222-8222-222222222222';
    const includedAttemptId = '66666666-6666-4666-8666-666666666666';
    const storage = storageFixture({
      listStoredLectureUsageAttempts: (
        _fromInclusive: string,
        _toExclusive: string,
        snapshotAt: string,
      ) =>
        [
          {
            studioId: '55555555-5555-4555-8555-555555555555',
            studioTitle: 'Newer than snapshot',
            attemptId: '77777777-7777-4777-8777-777777777777',
            projectId,
            status: 'running' as const,
            startedAt: '2026-08-20T00:02:00.000Z',
            completedAt: null,
          },
          {
            studioId: '88888888-8888-4888-8888-888888888888',
            studioTitle: 'Frozen page item',
            attemptId: includedAttemptId,
            projectId,
            status: 'running' as const,
            startedAt: '2026-08-20T00:00:00.000Z',
            completedAt: null,
          },
        ].filter((attempt) => Date.parse(attempt.startedAt) <= Date.parse(snapshotAt)),
    });

    const report = await new ModelUsageService(storage, workspaceFixture()).query({
      period: 'day',
      anchorDate: '2026-08-20',
      timeZone: 'UTC',
      lecturePage: {
        offset: 100,
        limit: 25,
        snapshotAt: '2026-08-20T00:01:00.000Z',
      },
    });

    expect(report.lectureGenerations).toMatchObject({
      total: 1,
      offset: 0,
      limit: 25,
      snapshotAt: '2026-08-20T00:01:00.000Z',
      items: [expect.objectContaining({ attemptId: includedAttemptId })],
    });
  });

  it('reconciles a cross-midnight lecture row with the totals range that owns the turn', async () => {
    const projectId = '22222222-2222-4222-8222-222222222222';
    const studioId = '55555555-5555-4555-8555-555555555555';
    const attemptId = '66666666-6666-4666-8666-666666666666';
    const row = storedUsageRow({
      startedAt: '2026-08-20T00:02:00.000Z',
      workloadKind: 'lecture_generation',
      projectId,
      lectureStudioId: studioId,
      lectureAttemptId: attemptId,
    });
    const storage = storageFixture({
      getModelUsageTrackingStartedAt: () => '2026-08-20T00:01:00.000Z',
      listStoredModelUsage: () => [row],
      listStoredLectureUsageAttempts: () => [
        {
          studioId,
          studioTitle: 'Across midnight',
          attemptId,
          projectId,
          status: 'succeeded',
          startedAt: '2026-08-19T23:59:00.000Z',
          completedAt: '2026-08-20T00:03:00.000Z',
        },
      ],
    });
    const report = await new ModelUsageService(storage, workspaceFixture()).query({
      period: 'day',
      anchorDate: '2026-08-20',
      timeZone: 'UTC',
    });
    expect(report.totals.tokens).toMatchObject({ totalTokens: 120 });
    expect(report.lectureGenerations.items).toEqual([
      expect.objectContaining({
        attemptId,
        coverage: 'exact',
        turnCount: 1,
        tokens: expect.objectContaining({ totalTokens: 120 }),
      }),
    ]);
  });
});
