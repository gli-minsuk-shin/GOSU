import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBriefingMiddleware, trustedRoutineRequest } from './briefing-server';
import { LiveSourceService } from './live-source-service';
import { ASSISTANT_TURN_TIMEOUT_MS } from './briefing-tool-policy';

const close: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of close.splice(0)) await stop();
});
const safe = {
  Host: '127.0.0.1:4318',
  Origin: 'http://127.0.0.1:4318',
  'Sec-Fetch-Site': 'same-origin',
};
// Node's raw client preserves the Host under test (some fetch runtimes override it).
function fetch(
  url: string,
  options: { headers: Record<string, string>; method?: string; body?: string },
) {
  return new Promise<Response>((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: options.method ?? 'GET',
        headers: {
          ...options.headers,
          ...(options.body ? { 'Content-Length': String(Buffer.byteLength(options.body)) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode!,
              headers: { 'content-type': String(res.headers['content-type']) },
            }),
          ),
        );
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}
type Run = NonNullable<Parameters<typeof createBriefingMiddleware>[0]>['run'];
async function start() {
  const run = vi.fn<Run>(async (_request, _signal, progress) => {
    progress({ stage: 'checking', detail: '검증' });
    return {
      answer: 'Clarify',
      proposal: null,
      providerId: 'codex',
      model: 'live',
      reasoning: 'high',
      nextDates: [],
    };
  });
  const models = vi.fn(async () => []);
  const sources = new LiveSourceService();
  const sourceHandle = vi.spyOn(sources, 'handle').mockImplementation(async (_req, res) => {
    res.end(JSON.stringify({ ok: true }));
  });
  const service = createBriefingMiddleware({ models, run }, sources);
  const server = createServer(
    (req, res) =>
      void service.middleware(req, res, () => {
        res.statusCode = 404;
        res.end();
      }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  close.push(
    () =>
      new Promise<void>((resolve) => {
        service.close();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/briefing-agent`;
  const session = await fetch(`${base}/session`, { headers: safe });
  const { token } = (await session.json()) as { token: string };
  return {
    base,
    run,
    models,
    sourceHandle,
    headers: { ...safe, 'X-Gosu-Routine-Token': token, 'Content-Type': 'application/json' },
  };
}
describe('Briefing local capability boundary', () => {
  it('lets the chat native deadline finish before its HTTP deadline without widening other route budgets', async () => {
    const test = await start();
    const timer = vi.spyOn(globalThis, 'setTimeout');
    try {
      for (const [path, budget] of [
        ['/sources/assistant/chat', ASSISTANT_TURN_TIMEOUT_MS + 15_000],
        ['/sources/calendar/agenda', 200_000],
      ] as const) {
        timer.mockClear();
        expect(
          (
            await fetch(`${test.base}${path}`, {
              headers: test.headers,
              method: 'POST',
              body: '{}',
            })
          ).status,
        ).toBe(200);
        expect(timer.mock.calls.some((call) => call[1] === budget)).toBe(true);
      }
    } finally {
      timer.mockRestore();
    }
  });
  it('protects every live/mail route with the same origin and capability checks', async () => {
    const test = await start();
    expect(
      (
        await fetch(`${test.base}/sources/mail/accounts`, {
          headers: safe,
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(test.sourceHandle).not.toHaveBeenCalled();
    expect(
      (
        await fetch(`${test.base}/sources/mail/accounts`, {
          headers: { ...test.headers, Origin: 'https://evil.example' },
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(test.sourceHandle).not.toHaveBeenCalled();
    expect(
      (
        await fetch(`${test.base}/sources/mail/accounts`, {
          headers: test.headers,
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(200);
    expect(test.sourceHandle).toHaveBeenCalledOnce();
    expect(test.run).not.toHaveBeenCalled();
  });
  it('turns an expired native subscription into a relogin message, not a validation failure', async () => {
    const test = await start();
    test.run.mockRejectedValueOnce(new Error('claude_code_auth_required'));
    const response = await fetch(test.base, {
      method: 'POST',
      headers: test.headers,
      body: JSON.stringify({
        prompt: 'create',
        providerId: 'claude-code',
        modelId: 'claude-code:sonnet',
        reasoning: null,
        history: [],
        previousProposal: null,
      }),
    });
    const body = await response.text();
    expect(body).toContain('재로그인');
    expect(body).not.toContain('검증을 통과하지');
  });
  it.each([
    { host: 'evil.example:4318', origin: 'http://evil.example:4318' },
    { host: '127.0.0.1:4318', origin: 'https://evil.example' },
    { host: '127.0.0.1:4318' },
    { host: '127.0.0.1:4318', origin: 'http://127.0.0.1:4318', 'sec-fetch-site': 'cross-site' },
  ])('denies untrusted browser requests %j', (headers) =>
    expect(trustedRoutineRequest({ headers } as IncomingMessage)).toBe(false),
  );
  it('requires capability before any engine access, validates body and streams observable progress', async () => {
    const test = await start();
    expect((await fetch(`${test.base}/models`, { headers: safe })).status).toBe(403);
    expect(test.models).not.toHaveBeenCalled();
    expect((await fetch(`${test.base}/models`, { headers: test.headers })).status).toBe(200);
    expect(test.models).toHaveBeenCalledOnce();
    expect(
      (await fetch(test.base, { method: 'POST', headers: test.headers, body: '{}' })).status,
    ).toBe(400);
    expect(test.run).not.toHaveBeenCalled();
    const result = await fetch(test.base, {
      method: 'POST',
      headers: test.headers,
      body: JSON.stringify({
        prompt: 'brief me',
        providerId: 'codex',
        modelId: 'live',
        reasoning: 'high',
        history: [],
        previousProposal: null,
      }),
    });
    expect(result.headers.get('content-type')).toBe('application/x-ndjson');
    expect(
      (await result.text())
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line).type),
    ).toEqual(['progress', 'result']);
  });
  it('rejects oversized bodies before provider use', async () => {
    const test = await start();
    const result = await fetch(test.base, {
      method: 'POST',
      headers: test.headers,
      body: JSON.stringify({ prompt: 'x'.repeat(130000) }),
    });
    expect(result.status).toBe(413);
    expect(test.run).not.toHaveBeenCalled();
  });
});
