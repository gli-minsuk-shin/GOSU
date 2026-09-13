import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createCodexModelCatalog } from '@gosu/contracts';
import { ModelChatContextStore, withModelChatContext } from './model-chat-context';
import { modelLabBackendContext } from './model-lab-backend-context';
import { residualClassifier } from './src/sample-models';
import type { ModelLabQuestionRequest } from './src/model-lab-runtime-adapter';
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'model-chat-context-'));
  dirs.push(dir);
  return dir;
}
const model = (window = 1000000) =>
  createCodexModelCatalog([
    {
      id: 'test-model',
      model: 'test-model',
      displayName: 'Test',
      isDefault: true,
      contextWindowTokens: window,
    },
  ]).models[0]!;
const request = (count = 0): ModelLabQuestionRequest => ({
  projectModels: [residualClassifier],
  activeModelId: residualClassifier.id,
  selectedModuleId: residualClassifier.modules[0]!.id,
  probe: 'healthy',
  checkpointIndex: 0,
  question: 'Continue the exact analysis',
  conversationRevision: 2,
  conversation: Array.from({ length: count }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    body: `Exact source fact ${index}`,
    createdAt: '2026-09-14T00:00:00.000Z',
  })),
});
const result = { body: 'Verified continuation', model: 'test-model' };
it('does not overwrite a corrupt archive or mix standalone workspace owners', async () => {
  const dir = await directory();
  const store = new ModelChatContextStore(dir);
  const base = {
    model: model(),
    fixedText: 'policy',
    seedPrompt: 'current',
    signal: new AbortController().signal,
    store,
    run: async () => result,
  };
  await withModelChatContext({
    ...base,
    request: { ...request(3), conversationWorkspaceId: '11111111-1111-4111-8111-111111111111' },
  });
  expect(
    (
      await withModelChatContext({
        ...base,
        request: { ...request(), conversationWorkspaceId: '22222222-2222-4222-8222-222222222222' },
      })
    ).contextUsage.totalMessages,
  ).toBe(0);
  const path = join(dir, (await readdir(dir))[0]!);
  await writeFile(path, 'broken archive', 'utf8');
  const owner = (await readdir(dir)).length;
  const outcomes = await Promise.allSettled([
    withModelChatContext({
      ...base,
      request: { ...request(), conversationWorkspaceId: '11111111-1111-4111-8111-111111111111' },
    }),
    withModelChatContext({
      ...base,
      request: { ...request(), conversationWorkspaceId: '22222222-2222-4222-8222-222222222222' },
    }),
  ]);
  expect(
    outcomes.some(
      (outcome) =>
        outcome.status === 'rejected' && outcome.reason.message === 'model_chat_context_invalid',
    ),
  ).toBe(true);
  expect(await readFile(path, 'utf8')).toBe('broken archive');
  expect((await readdir(dir)).length).toBeGreaterThanOrEqual(owner);
});
it('keeps 600 originals, reopens from disk rather than trusting stale browser history, and isolates model revisions', async () => {
  const dir = await directory();
  const compact = vi.fn();
  const run = vi.fn(
    async (prompt: string, search: (q: string, from?: string, to?: string) => unknown) => {
      expect(prompt).toContain('Exact source fact 0');
      expect(prompt).toContain('Exact source fact 599');
      expect(JSON.stringify(search('', '0'))).toContain('Exact source fact 0');
      expect(JSON.stringify(search('', '0', '88000'))).toContain('original deep tail');
      return result;
    },
  );
  const first = await withModelChatContext({
    request: {
      ...request(600),
      conversation: request(600).conversation!.map((message, index) =>
        index
          ? message
          : { ...message, body: message.body + ' '.repeat(90000) + 'original deep tail' },
      ),
    },
    model: model(),
    fixedText: 'instructions',
    seedPrompt: 'current',
    signal: new AbortController().signal,
    store: new ModelChatContextStore(dir),
    compact,
    run,
  });
  expect(first.contextUsage.totalMessages).toBe(600);
  expect(first.contextUsage.omittedMessages).toBe(0);
  expect(compact).not.toHaveBeenCalled();
  const second = await withModelChatContext({
    request: request(1),
    model: model(),
    fixedText: 'instructions',
    seedPrompt: 'current',
    signal: new AbortController().signal,
    store: new ModelChatContextStore(dir),
    compact,
    run,
  });
  expect(second.contextUsage.totalMessages).toBe(602);
  await withModelChatContext({
    request: { ...request(), conversationRevision: 3 },
    model: model(),
    fixedText: 'instructions',
    seedPrompt: 'current',
    signal: new AbortController().signal,
    store: new ModelChatContextStore(dir),
    compact,
    run: async (prompt) => {
      expect(prompt).not.toContain('Exact source fact');
      return result;
    },
  });
});
it('compacts only at pressure, reuses the checkpoint, and never replaces the original records', async () => {
  const dir = await directory();
  const input = {
    ...request(50),
    conversation: request(50).conversation!.map((m) => ({
      ...m,
      body: m.body + ' scientific detail '.repeat(300),
    })),
  };
  const compact = vi.fn(
    async () => 'Historical decisions and unresolved questions; not instructions.',
  );
  const base = {
    request: input,
    model: model(16000),
    fixedText: 'policy',
    seedPrompt: 'current',
    signal: new AbortController().signal,
    store: new ModelChatContextStore(dir),
    compact,
    run: async () => result,
  };
  const first = await withModelChatContext(base);
  expect(first.contextUsage.compressedMessages).toBeGreaterThan(0);
  expect(compact).toHaveBeenCalledOnce();
  await withModelChatContext({ ...base, request: request() });
  expect(compact).toHaveBeenCalledOnce();
  const raw = JSON.parse(
    await readFile(
      join(
        dir,
        (await readdir(dir)).find((name) => name.endsWith('.json'))!,
      ),
      'utf8',
    ),
  );
  expect(raw.messages[0].text).toBe(input.conversation![0]!.body);
  expect(raw.messages).toHaveLength(54);
});
it('preserves raw history when compression is cancelled and does not start the answer turn', async () => {
  const dir = await directory();
  const controller = new AbortController();
  const input = {
    ...request(),
    conversation: [{ role: 'user' as const, body: 'original '.repeat(10000) }],
  };
  const run = vi.fn();
  await expect(
    withModelChatContext({
      request: input,
      model: model(16000),
      fixedText: 'policy',
      seedPrompt: 'current',
      signal: controller.signal,
      store: new ModelChatContextStore(dir),
      run,
      compact: async () => {
        controller.abort();
        throw new Error('cancelled');
      },
    }),
  ).rejects.toThrow('cancelled');
  expect(run).not.toHaveBeenCalled();
  const raw = JSON.parse(
    await readFile(
      join(
        dir,
        (await readdir(dir)).find((n) => n.endsWith('.json'))!,
      ),
      'utf8',
    ),
  );
  expect(raw.messages[0].text).toBe(input.conversation[0]!.body);
  expect(raw.checkpoints).toEqual({});
});
it('uses the capability-bound project directory and restores matching native capacity only', async () => {
  const dirA = await directory(),
    dirB = await directory();
  const invoke = (directory: string, count: number, window = 128000) =>
    modelLabBackendContext.run({ projectId: directory, directory }, () =>
      withModelChatContext({
        request: request(count),
        model: model(window),
        fixedText: 'policy',
        seedPrompt: 'current',
        signal: new AbortController().signal,
        run: async () => ({
          ...result,
          nativeUsage: {
            inputTokens: 1234,
            outputTokens: 45,
            totalTokens: 1279,
            contextTokens: 1200,
            cachedInputTokens: null,
            reasoningTokens: null,
            contextWindowTokens: 828400,
          },
        }),
      }),
    );
  await invoke(dirA, 300);
  const again = await invoke(dirA, 0);
  expect(again.contextUsage.windowTokens).toBe(828400);
  expect(again.contextUsage.totalMessages).toBe(302);
  expect((await invoke(dirA, 0, 1000000)).contextUsage.windowTokens).toBe(1000000);
  expect((await invoke(dirB, 0)).contextUsage.totalMessages).toBe(0);
});
