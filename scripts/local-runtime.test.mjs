import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLocalSyncBaseUrl, probeSync, syncHealthUrl, waitForSync } from './local-runtime.mjs';

test('accepts only credential-free loopback base URLs', () => {
  assert.equal(parseLocalSyncBaseUrl('http://127.0.0.1:4100').origin, 'http://127.0.0.1:4100');
  assert.equal(parseLocalSyncBaseUrl('http://localhost:4000/').origin, 'http://localhost:4000');
  assert.throws(() => parseLocalSyncBaseUrl('http://localhost'), /explicit port/);
  assert.throws(() => parseLocalSyncBaseUrl('https://127.0.0.1:4000'), /only accepts/);
  assert.throws(() => parseLocalSyncBaseUrl('http://example.com:4000'), /only connects/);
  assert.throws(() => parseLocalSyncBaseUrl('http://user:secret@127.0.0.1:4000'), /credentials/);
  assert.throws(
    () => parseLocalSyncBaseUrl('http://127.0.0.1:4000/api'),
    /must not contain a path/,
  );
});

test('builds the versioned readiness URL', () => {
  assert.equal(syncHealthUrl('http://127.0.0.1:4000'), 'http://127.0.0.1:4000/v1/health/ready');
});

test('recognizes only a ready GOSU Sync response', async () => {
  const ready = await probeSync('http://127.0.0.1:4000/v1/health/ready', {
    fetchImpl: async () =>
      new Response(JSON.stringify({ service: 'gosu-sync-api', status: 'ready' }), {
        status: 200,
      }),
  });
  assert.deepEqual(ready, { kind: 'ready', detail: 'ready' });

  const occupied = await probeSync('http://127.0.0.1:4000/v1/health/ready', {
    fetchImpl: async () => new Response(JSON.stringify({ service: 'other' }), { status: 200 }),
  });
  assert.equal(occupied.kind, 'occupied');

  const wrong404 = await probeSync('http://127.0.0.1:4000/v1/health/ready', {
    fetchImpl: async () => new Response(JSON.stringify({ statusCode: 404 }), { status: 404 }),
  });
  assert.equal(wrong404.kind, 'occupied');
});

test('retries readiness without accepting an unrelated service', async () => {
  let attempts = 0;
  const result = await waitForSync('http://127.0.0.1:4000/v1/health/ready', {
    intervalMs: 0,
    timeoutMs: 200,
    fetchImpl: async () => {
      attempts += 1;
      return new Response(
        JSON.stringify(
          attempts === 1
            ? { service: 'gosu-sync-api', status: 'starting' }
            : { service: 'gosu-sync-api', status: 'ready', persistence: 'memory-development' },
        ),
        { status: 200 },
      );
    },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(result, { kind: 'ready', detail: 'memory-development' });
});

test('cancels readiness retries when supervised startup stops', async () => {
  const controller = new AbortController();
  await assert.rejects(
    waitForSync('http://127.0.0.1:4000/v1/health/ready', {
      intervalMs: 10_000,
      timeoutMs: 20_000,
      signal: controller.signal,
      onAttempt: () => controller.abort(),
      fetchImpl: async () =>
        new Response(JSON.stringify({ service: 'gosu-sync-api', status: 'starting' }), {
          status: 503,
        }),
    }),
    /startup cancelled/,
  );
});

test('cancels an in-flight Sync probe when supervised startup stops', async () => {
  const controller = new AbortController();
  let observedSignal;
  const pending = probeSync('http://127.0.0.1:4000/v1/health/ready', {
    fetchImpl: async (_url, init) => {
      observedSignal = init.signal;
      await new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    },
    signal: controller.signal,
    timeoutMs: 10_000,
  });

  controller.abort();

  await expectUnavailable(pending);
  assert.equal(observedSignal.aborted, true);
});

async function expectUnavailable(resultPromise) {
  const result = await resultPromise;
  assert.equal(result.kind, 'unavailable');
}
