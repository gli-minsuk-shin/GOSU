import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { createCodexModelCatalog } from '@gosu/contracts';
import {
  MODEL_COPILOT_CONTEXT_ENDPOINT,
  createModelCopilotMiddleware,
  handleModelChatContextRequest,
} from './model-copilot-server';
import { ModelChatContextStore } from './model-chat-context';
import { residualClassifier } from './src/sample-models';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const catalog = async () =>
  createCodexModelCatalog([
    {
      id: 'test-model',
      model: 'test-model',
      displayName: 'Test',
      isDefault: true,
      contextWindowTokens: 1000000,
      defaultReasoningEffort: 'high',
      supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
    },
  ]);
const identity = {
  projectModels: [residualClassifier],
  activeModelId: residualClassifier.id,
  selectedModuleId: residualClassifier.modules[0]!.id,
  probe: 'healthy',
  checkpointIndex: 0,
  conversationRevision: 4,
  conversation: [
    { role: 'user', body: 'Earlier question', createdAt: '2026-09-14T00:00:00.000Z' },
    { role: 'assistant', body: 'Earlier answer', createdAt: '2026-09-14T00:00:01.000Z' },
  ],
};

it('validates the context command like the answer route and reports the new context usage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'model-chat-context-route-'));
  dirs.push(dir);
  const store = new ModelChatContextStore(dir);
  const signal = new AbortController().signal;
  const call = (payload: unknown) =>
    handleModelChatContextRequest(payload, signal, { catalog, store });
  expect(await call(null)).toMatchObject({ status: 400 });
  expect(await call([{ ...identity, action: 'new' }])).toMatchObject({ status: 400 });
  expect((await call({ ...identity, action: 'reset' })).body).toEqual({
    error: 'model_copilot_context_unavailable',
    detail: 'model_copilot_context_request_invalid',
  });
  expect((await call({ ...identity, action: 'new', conversation: 'nope' })).body).toMatchObject({
    detail: 'model_copilot_context_request_invalid',
  });
  expect((await call({ ...identity, action: 'new', conversationRevision: -1 })).status).toBe(503);
  expect((await call({ ...identity, action: 'new', activeModelId: 'missing' })).body).toMatchObject(
    { detail: 'model_copilot_active_model_missing' },
  );
  const reset = await call({ ...identity, action: 'new' });
  expect(reset.status).toBe(200);
  expect(reset.body).toMatchObject({
    action: 'new',
    compacted: false,
    contextStartsAt: 2,
    totalMessages: 2,
  });
  expect((reset.body as { usage: { totalMessages: number } }).usage.totalMessages).toBe(0);
  const compacted = await call({ ...identity, action: 'compact' });
  expect(compacted.body).toMatchObject({ action: 'compact', compacted: false });
});

it('serves the context route over HTTP and refuses other methods', async () => {
  const middleware = createModelCopilotMiddleware();
  const send = async (method: string, body: unknown) => {
    const request = Object.assign(Readable.from([JSON.stringify(body)]), {
      method,
      url: MODEL_COPILOT_CONTEXT_ENDPOINT,
      headers: { host: '127.0.0.1:4317', 'content-type': 'application/json' },
    }) as unknown as IncomingMessage;
    let payload = '';
    const response = {
      statusCode: 0,
      writableEnded: false,
      setHeader: () => undefined,
      once: () => undefined,
      end: (text?: string) => {
        payload = text ?? '';
      },
    };
    await middleware(request, response as unknown as ServerResponse, () => {
      throw new Error('unexpected_route');
    });
    return { status: response.statusCode, body: payload ? (JSON.parse(payload) as unknown) : null };
  };
  expect(await send('GET', {})).toMatchObject({
    status: 405,
    body: { error: 'method_not_allowed' },
  });
  expect(await send('POST', { ...identity, action: 'sneak' })).toEqual({
    status: 400,
    body: {
      error: 'model_copilot_context_unavailable',
      detail: 'model_copilot_context_request_invalid',
    },
  });
});
