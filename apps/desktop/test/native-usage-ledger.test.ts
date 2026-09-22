import { it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeUsageLedger, GLOBAL_USAGE_OWNER } from '../src/main/native-usage-ledger';
import {
  configureNativeUsageObserver,
  observeNativeUsage,
  withNativeUsageScope,
  type NativeUsageObservation,
} from '../../briefing-lab/native-usage-observer';
const event: NativeUsageObservation = {
  workloadKind: 'briefing_assistant',
  projectId: null,
  invocation: {
    schemaVersion: 1,
    invocationId: 'unique-call',
    providerId: 'codex',
    requestedModelId: 'requested',
    resolvedModelId: 'actual-model',
    catalogVersion: 'test',
    reasoningOptionId: null,
    startedAt: '2026-09-14T00:00:00Z',
  },
  completedAt: '2026-09-14T00:00:01Z',
  successful: true,
  usage: {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    cachedInputTokens: 80,
    reasoningTokens: 5,
    contextTokens: 120,
    contextWindowTokens: 1000000,
  },
};
it('persists actual model/workload usage, deduplicates retries and keeps missing usage unknown independently of chats', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gosu-usage-test-'));
  try {
    const path = join(dir, 'ledger.json'),
      store = new NativeUsageLedger(path);
    await Promise.all([store.record(event), store.record(event)]);
    await store.record({
      ...event,
      invocation: { ...event.invocation, invocationId: 'unreported' },
      usage: undefined,
      successful: false,
    });
    const rows = await new NativeUsageLedger(path).rows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      resolvedModelId: 'actual-model',
      projectId: GLOBAL_USAGE_OWNER,
      inputTokens: 100,
      cachedReadTokens: 80,
      workloadKind: 'briefing_assistant',
    });
    expect(rows[1]).toMatchObject({ coverage: 'unavailable', cachedReadTokens: null });
    expect(await readFile(path, 'utf8')).not.toContain('prompt');
    expect(() =>
      store.record({
        ...event,
        invocation: { ...event.invocation, invocationId: 'invalid' },
        usage: { ...event.usage!, totalTokens: 999 },
      }),
    ).toThrow();
    expect(await store.rows()).toHaveLength(2);
    await writeFile(path, 'invalid');
    await expect(new NativeUsageLedger(path).rows()).rejects.toThrow('usage_ledger_unreadable');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('keeps assistant and project compaction attribution isolated across concurrent asynchronous calls', async () => {
  const received: NativeUsageObservation[] = [];
  configureNativeUsageObserver(async (e) => {
    received.push(e);
  });
  try {
    await Promise.all([
      withNativeUsageScope({ workloadKind: 'briefing_assistant', projectId: null }, async () => {
        await Promise.resolve();
        await observeNativeUsage(event);
      }),
      withNativeUsageScope(
        { workloadKind: 'context_compaction', projectId: '22222222-2222-4222-8222-222222222222' },
        async () => {
          await Promise.resolve();
          await observeNativeUsage({
            invocation: event.invocation,
            usage: event.usage,
            completedAt: event.completedAt,
            successful: true,
          });
        },
      ),
    ]);
    expect(received.map((e) => e.workloadKind).sort()).toEqual([
      'briefing_assistant',
      'context_compaction',
    ]);
    expect(received.find((e) => e.workloadKind === 'context_compaction')?.projectId).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
  } finally {
    configureNativeUsageObserver(undefined);
  }
});
