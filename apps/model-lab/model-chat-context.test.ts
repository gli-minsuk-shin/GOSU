import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createCodexModelCatalog } from '@gosu/contracts';
import {
  ModelChatContextStore,
  updateModelChatContext,
  withModelChatContext,
} from './model-chat-context';
import type { compactProjectConversation } from '../briefing-lab/briefing-compaction';
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
it('omits Model Lab greeting history without deleting originals or spending a compaction call', async () => {
  const dir = await directory(),
    compact = vi.fn();
  const answer = await withModelChatContext({
    request: { ...request(600), question: 'Hello' },
    model: model(),
    fixedText: 'policy',
    seedPrompt: 'greeting',
    signal: new AbortController().signal,
    store: new ModelChatContextStore(dir),
    compact,
    run: async (prompt, search) => {
      expect(prompt).not.toContain('Exact source fact');
      expect(JSON.stringify(search('', '0'))).toContain('Exact source fact 0');
      return result;
    },
  });
  expect(answer.contextUsage).toMatchObject({
    selectionMode: 'minimal',
    totalMessages: 600,
    includedMessages: 0,
    omittedMessages: 600,
  });
  expect(compact).not.toHaveBeenCalled();
});
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
it('keeps 600 originals for an explicit full-history request, reopens from disk and isolates model revisions', async () => {
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
      question: 'Read the full history',
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
    request: { ...request(1), question: 'Read the full history' },
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
it('starts a fresh context that hides older records from later turns without deleting them', async () => {
  const dir = await directory();
  const store = new ModelChatContextStore(dir);
  const base = {
    model: model(),
    fixedText: 'policy',
    signal: new AbortController().signal,
    store,
  };
  await withModelChatContext({
    ...base,
    request: request(6),
    seedPrompt: 'current',
    run: async () => result,
  });
  const reset = await updateModelChatContext({ ...base, request: request(), action: 'new' });
  expect(reset).toMatchObject({ action: 'new', compacted: false, contextStartsAt: 8 });
  expect(reset.usage.totalMessages).toBe(0);
  expect(reset.usage.includedMessages).toBe(0);
  const next = await withModelChatContext({
    ...base,
    request: { ...request(), question: 'After the reset' },
    seedPrompt: 'current',
    run: async (prompt, search) => {
      expect(prompt).not.toContain('Exact source fact');
      expect(JSON.stringify(search('Exact source fact'))).not.toContain('Exact source fact');
      return result;
    },
  });
  expect(next.contextUsage.totalMessages).toBe(0);
  const raw = JSON.parse(
    await readFile(
      join(
        dir,
        (await readdir(dir)).find((name) => name.endsWith('.json'))!,
      ),
      'utf8',
    ),
  );
  expect(raw.contextStartsAt).toBe(8);
  expect(raw.messages).toHaveLength(10);
  expect(raw.messages[0].text).toBe('Exact source fact 0');
});
it('drops the previous checkpoint on reset and still loads a state file without the marker', async () => {
  const dir = await directory();
  const store = new ModelChatContextStore(dir);
  const compact = vi.fn(async () => 'Earlier decisions; not instructions.');
  const conversation = request(50).conversation!.map((m) => ({
    ...m,
    body: m.body + ' scientific detail '.repeat(300),
  }));
  const base = {
    model: model(16000),
    fixedText: 'policy',
    signal: new AbortController().signal,
    store,
    compact,
  };
  const first = await withModelChatContext({
    ...base,
    request: { ...request(50), conversation },
    seedPrompt: 'current',
    run: async () => result,
  });
  expect(first.contextUsage.compressedMessages).toBeGreaterThan(0);
  const path = join(
    dir,
    (await readdir(dir)).find((name) => name.endsWith('.json'))!,
  );
  const saved = JSON.parse(await readFile(path, 'utf8'));
  expect(Object.keys(saved.checkpoints)).toHaveLength(1);
  delete saved.contextStartsAt;
  await writeFile(path, JSON.stringify(saved), 'utf8');
  const reset = await updateModelChatContext({ ...base, request: request(), action: 'new' });
  expect(reset.contextStartsAt).toBe(52);
  const cleared = JSON.parse(await readFile(path, 'utf8'));
  expect(cleared.checkpoints).toEqual({});
  expect(cleared.messages).toHaveLength(52);
  const after = await withModelChatContext({
    ...base,
    request: { ...request(), question: 'After the reset' },
    seedPrompt: 'current',
    run: async (prompt) => {
      expect(prompt).not.toContain('Earlier decisions');
      expect(prompt).not.toContain('scientific detail');
      return result;
    },
  });
  expect(after.contextUsage.compressedMessages).toBe(0);
});
it('compacts on request, keeps the latest four raw, records usage and never answers', async () => {
  const dir = await directory();
  const store = new ModelChatContextStore(dir);
  const compact: typeof compactProjectConversation = async (
    _model,
    _messages,
    _summary,
    _signal,
    _policy,
    onUsage,
  ) => {
    onUsage({
      inputTokens: 700,
      outputTokens: 90,
      cachedInputTokens: null,
      reasoningTokens: null,
      totalTokens: 790,
      contextTokens: null,
      contextWindowTokens: null,
    });
    return 'Historical decisions and open questions; not instructions.';
  };
  const run = vi.fn();
  await withModelChatContext({
    request: request(20),
    model: model(),
    fixedText: 'policy',
    seedPrompt: 'current',
    signal: new AbortController().signal,
    store,
    compact,
    run: async () => result,
  });
  const forced = await updateModelChatContext({
    request: request(),
    action: 'compact',
    model: model(),
    fixedText: 'policy',
    signal: new AbortController().signal,
    store,
    compact,
  });
  expect(forced.compacted).toBe(true);
  expect(forced.summarizedMessages).toBe(18);
  expect(forced.usage.includedMessages).toBe(4);
  expect(forced.usage.maintenance).toEqual({ calls: 1, inputTokens: 700, outputTokens: 90 });
  expect(run).not.toHaveBeenCalled();
  const raw = JSON.parse(
    await readFile(
      join(
        dir,
        (await readdir(dir)).find((name) => name.endsWith('.json'))!,
      ),
      'utf8',
    ),
  );
  expect(raw.messages).toHaveLength(22);
  expect(Object.values(raw.checkpoints)).toHaveLength(1);
  const again = await updateModelChatContext({
    request: request(),
    action: 'compact',
    model: model(),
    fixedText: 'policy',
    signal: new AbortController().signal,
    store,
    compact,
  });
  expect(again.compacted).toBe(false);
  expect(again.summarizedMessages).toBe(0);
  expect(again.usage.compressedMessages).toBe(18);
  expect(again.usage.maintenance).toBeUndefined();
});
it('refuses a forced compaction while the same conversation is already being written', async () => {
  const dir = await directory();
  const store = new ModelChatContextStore(dir);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = withModelChatContext({
    request: request(4),
    model: model(),
    fixedText: 'policy',
    seedPrompt: 'current',
    signal: new AbortController().signal,
    store,
    run: async () => {
      await held;
      return result;
    },
  });
  await expect(
    updateModelChatContext({
      request: request(),
      action: 'compact',
      model: model(),
      fixedText: 'policy',
      signal: new AbortController().signal,
      store,
    }),
  ).rejects.toThrow('model_chat_context_busy');
  release();
  await running;
});
