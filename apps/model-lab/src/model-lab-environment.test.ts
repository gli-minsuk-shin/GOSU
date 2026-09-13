import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createHostedModelLabStorage,
  parseModelLabHostConfiguration,
  scopedModelLabUrl,
} from './model-lab-environment';
import { loadModelLabChats, saveModelLabChats } from './model-lab-chat-storage';

const id = '11111111-1111-4111-8111-111111111111';
it('restores validated context accounting without inventing missing counters or losing the message', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const contextUsage = {
    windowTokens: 1000000,
    windowSource: 'provider' as const,
    estimatedInputTokens: 1200,
    outputReserveTokens: 120000,
    toolReserveTokens: 128000,
    totalMessages: 300,
    includedMessages: 300,
    compressedMessages: 0,
    omittedMessages: 0,
    native: {
      inputTokens: 1200,
      outputTokens: 30,
      totalTokens: 1230,
      cachedInputTokens: null,
      reasoningTokens: null,
      contextTokens: 1230,
      contextWindowTokens: 828400,
    },
  };
  const message = {
    id: 'reply',
    modelId: 'model',
    modelVersion: '1',
    createdAt: '2026-09-14T00:00:00.000Z',
    role: 'assistant' as const,
    body: 'Original answer',
    contextUsage,
  };
  saveModelLabChats(storage, { a: { draft: '', attachments: [], messages: [message] } }, {});
  expect(loadModelLabChats(storage).a?.messages[0]?.contextUsage).toEqual(contextUsage);
  expect(
    loadModelLabChats(storage).a?.messages[0]?.contextUsage?.native?.cachedInputTokens,
  ).toBeNull();
});
const host = {
  projectId: id,
  projectName: 'Project A',
  basePath: `/s/${'a'.repeat(64)}/${id}/`,
  storage: { 'gosu.model-lab.test': 'A' },
};
describe('project Model Lab environment', () => {
  it('keeps desktop Copilot beside the graph only in embedded project workspaces', () => {
    const css = readFileSync(new URL('./model-lab-embedded.css', import.meta.url), 'utf8');
    expect(css).toContain('@media (min-width: 901px) and (max-width: 1200px)');
    expect(css).toContain('.model-lab-shell[data-project-id]:not(.model-lab-shell--focus)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 7px');
    const app = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    expect(app).toContain('useState(Boolean(host))');
    expect(app).toContain("host ? '(max-width: 900px)' : '(max-width: 1200px)'");
  });
  it('uses the protected per-project API prefix and rejects routes leaving it', () => {
    expect(parseModelLabHostConfiguration(JSON.stringify(host))).toEqual(host);
    expect(scopedModelLabUrl('/api/model-builder', host)).toBe(`${host.basePath}api/model-builder`);
    expect(scopedModelLabUrl('/api/model-builder', null)).toBe('/api/model-builder');
    expect(() => scopedModelLabUrl('https://example.com/api', host)).toThrow();
    expect(() => scopedModelLabUrl('/api/../other', host)).toThrow();
    expect(() =>
      parseModelLabHostConfiguration(JSON.stringify({ ...host, projectId: 'other' })),
    ).toThrow();
  });
  it('keeps synchronous UI reads isolated while serializing durable project writes', async () => {
    const write = vi.fn(async () => {});
    const statuses = vi.fn();
    const a = createHostedModelLabStorage(host, write, statuses);
    const b = createHostedModelLabStorage(
      { ...host, storage: {} },
      vi.fn(async () => {}),
      vi.fn(),
    );
    a.setItem('gosu.model-lab.test', 'changed');
    a.setItem('gosu.model-lab.test', 'changed');
    expect(a.getItem('gosu.model-lab.test')).toBe('changed');
    expect(b.getItem('gosu.model-lab.test')).toBeNull();
    await a.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(statuses).toHaveBeenLastCalledWith('saved');
  });
  it('persists conversation and drafts without persisting attached source bytes', async () => {
    const storage = createHostedModelLabStorage(
      { ...host, storage: {} },
      vi.fn(async () => {}),
      vi.fn(),
    );
    saveModelLabChats(
      storage,
      {
        a: {
          draft: 'old',
          messages: [
            {
              id: 'm',
              modelId: 'model',
              modelVersion: '1',
              createdAt: '2026-09-07',
              role: 'user',
              body: 'hello',
            },
          ],
          attachments: [],
        },
      },
      { a: 'new draft' },
    );
    expect(loadModelLabChats(storage).a?.draft).toBe('new draft');
    expect(loadModelLabChats(storage).a?.messages[0]?.body).toBe('hello');
    await storage.flush();
  });
  it('surfaces a failed disk save instead of reporting success', async () => {
    const status = vi.fn();
    const storage = createHostedModelLabStorage(
      host,
      async () => {
        throw new Error('disk');
      },
      status,
    );
    storage.setItem('gosu.model-lab.test', 'new');
    await expect(storage.flush()).rejects.toThrow('disk');
    expect(status).toHaveBeenLastCalledWith('failed');
  });
  it('retries unsaved values and does not hide a failed save behind another successful key', async () => {
    const status = vi.fn();
    let fail = true;
    const storage = createHostedModelLabStorage(
      host,
      async (key) => {
        if (fail && key.endsWith('.test')) throw new Error('disk');
      },
      status,
    );
    storage.setItem('gosu.model-lab.test', 'changed');
    await expect(storage.flush()).rejects.toThrow();
    storage.setItem('gosu.model-lab.other', 'okay');
    await expect(storage.flush()).rejects.toThrow('Project Model Lab save failed');
    expect(status).toHaveBeenLastCalledWith('failed');
    fail = false;
    storage.retry();
    await storage.flush();
    expect(status).toHaveBeenLastCalledWith('saved');
  });
});
