import { afterEach, expect, it, vi } from 'vitest';
import { createRoutineClient } from './routine-client';

afterEach(() => vi.unstubAllGlobals());
it('parses split NDJSON frames and ignores heartbeats; passes cancellation and capability', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    '{"type":"pro',
    'gress","progress":{"stage":"checking","detail":"검증"}}\n{"type":"heartbeat"}\n',
    '{"type":"result","result":{"answer":"done","proposal":null}}\n',
  ];
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('{"token":"capability"}'))
    .mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        }),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  const progress = vi.fn();
  const result = await createRoutineClient().run(
    {
      prompt: 'create',
      providerId: 'codex',
      modelId: 'live',
      reasoning: null,
      history: [],
      previousProposal: null,
    },
    signal,
    progress,
  );
  expect(result.answer).toBe('done');
  expect(progress).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[1]![1]).toMatchObject({
    signal,
    headers: { 'X-Gosu-Routine-Token': 'capability' },
  });
});
it('rejects a stream that ends without a result', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response('{"token":"capability"}'))
      .mockResolvedValueOnce(new Response('{"type":"heartbeat"}\n')),
  );
  await expect(
    createRoutineClient().run(
      {
        prompt: 'create',
        providerId: 'codex',
        modelId: 'live',
        reasoning: null,
        history: [],
        previousProposal: null,
      },
      new AbortController().signal,
      vi.fn(),
    ),
  ).rejects.toThrow('routine_result_missing');
});
