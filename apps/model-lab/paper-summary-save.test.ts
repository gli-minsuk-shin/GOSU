import { expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createModelCopilotMiddleware } from './model-copilot-server';
it('requires same-origin POST and explicit confirmation for standalone or embedded Model Lab saves', async () => {
  const save = vi.fn(async () => ({
    id: 'x',
    savedAt: '2026-09-10T00:00:00Z',
    alreadySaved: false,
  }));
  const middleware = createModelCopilotMiddleware(undefined, undefined, undefined, undefined, {
    save,
  });
  async function request(origin: string, confirmed: boolean) {
    const req = Object.assign(
      Readable.from([
        JSON.stringify({
          candidate: {
            title: 'Paper',
            question: '이 논문 분석해줘',
            markdown: 'Synthetic paper analysis.',
            sourceUrls: [],
          },
          confirmed,
        }),
      ]),
      {
        method: 'POST',
        url: '/api/paper-summaries/save',
        headers: { host: '127.0.0.1:4317', origin, 'content-type': 'application/json' },
      },
    ) as IncomingMessage;
    const response = { statusCode: 0, setHeader: () => undefined, end: () => undefined };
    await middleware(req, response as unknown as ServerResponse, () => {
      throw new Error('unexpected_route');
    });
    return response.statusCode;
  }
  expect(await request('https://evil.example', true)).toBe(403);
  expect(await request('http://127.0.0.1:4317', false)).toBe(400);
  expect(save).not.toHaveBeenCalled();
  expect(await request('http://127.0.0.1:4317', true)).toBe(200);
  expect(save).toHaveBeenCalledOnce();
});
