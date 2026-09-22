import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelPriceCatalogStore } from '../src/main/model-price-catalog';
import { MODEL_PRICE_SOURCE_URL } from '../src/shared/model-price-contracts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const list = (input = 2e-7) => ({
  'gpt-5.6-luna': {
    litellm_provider: 'openai',
    mode: 'responses',
    input_cost_per_token: input,
    output_cost_per_token: 1.6e-6,
  },
});
const response = (status: number, body: unknown, etag: string | null = '"v1"') => ({
  status,
  headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? etag : null) },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
type PriceFetch = NonNullable<ConstructorParameters<typeof ModelPriceCatalogStore>[1]>;
async function fixture(fetchPrices: PriceFetch) {
  const dir = await mkdtemp(join(tmpdir(), 'gosu-model-prices-'));
  dirs.push(dir);
  let now = Date.parse('2026-09-21T12:00:00Z');
  const make = () => new ModelPriceCatalogStore(dir, fetchPrices, () => now);
  return { dir, make, store: make(), advance: (ms: number) => (now += ms) };
}

describe('price list refresh', () => {
  it('fetches one fixed public URL with no user data, keeps a private file, and survives a restart', async () => {
    const fetchPrices = vi.fn<PriceFetch>(async () => response(200, list()));
    const f = await fixture(fetchPrices);
    expect(await f.store.stale()).toBe(true);
    const status = await f.store.refresh();
    expect(status).toMatchObject({ lastError: null, lastAttemptAt: '2026-09-21T12:00:00.000Z' });
    expect(status.catalog?.models['gpt-5.6-luna']?.inputPerToken).toBe(2e-7);
    expect(status.catalog).toMatchObject({ etag: '"v1"', sourceUrl: MODEL_PRICE_SOURCE_URL });
    expect(fetchPrices).toHaveBeenCalledTimes(1);
    const [url, init] = fetchPrices.mock.calls[0]!;
    expect(url).toBe(MODEL_PRICE_SOURCE_URL);
    expect(init.headers).toEqual({ accept: 'application/json' });
    expect((await stat(join(f.dir, 'model-prices.v1.json'))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(f.dir, 'model-prices.v1.json'), 'utf8')).toContain('gpt-5.6-luna');
    const restarted = f.make();
    expect((await restarted.status()).catalog?.models['gpt-5.6-luna']).toBeDefined();
    expect(await restarted.stale()).toBe(false);
  });

  it('picks up a changed price a day later without a release, and confirms an unchanged list by its tag', async () => {
    const fetchPrices = vi
      .fn()
      .mockResolvedValueOnce(response(200, list(2e-7), '"v1"'))
      .mockResolvedValueOnce(response(304, '', '"v1"'))
      .mockResolvedValueOnce(response(200, list(3e-7), '"v2"'));
    const f = await fixture(fetchPrices);
    await f.store.refresh();
    f.advance(24 * 60 * 60_000);
    expect(await f.store.stale()).toBe(true);
    const unchanged = await f.store.refresh();
    expect(fetchPrices.mock.calls[1]![1].headers).toMatchObject({ 'if-none-match': '"v1"' });
    expect(unchanged.catalog).toMatchObject({
      fetchedAt: '2026-09-22T12:00:00.000Z',
      etag: '"v1"',
    });
    expect(await f.store.stale()).toBe(false);
    f.advance(24 * 60 * 60_000);
    const changed = await f.store.refresh();
    expect(changed.catalog?.models['gpt-5.6-luna']?.inputPerToken).toBe(3e-7);
    expect(changed.catalog?.etag).toBe('"v2"');
  });

  it.each([
    ['model_prices_network', async () => Promise.reject(new Error('offline'))],
    ['model_prices_http', async () => response(503, 'unavailable')],
    ['model_prices_invalid', async () => response(200, '<html>not json')],
    [
      'model_prices_empty',
      async () => response(200, { 'azure/gpt-5': { litellm_provider: 'azure' } }),
    ],
    ['model_prices_too_large', async () => response(200, 'x'.repeat(16_000_001))],
  ] as const)('keeps the last list and reports %s when a refresh fails', async (code, failing) => {
    const fetchPrices = vi
      .fn()
      .mockResolvedValueOnce(response(200, list()))
      .mockImplementationOnce(failing);
    const f = await fixture(fetchPrices);
    await f.store.refresh();
    f.advance(24 * 60 * 60_000);
    const status = await f.store.refresh();
    expect(status.lastError).toBe(code);
    expect(status.catalog?.models['gpt-5.6-luna']?.inputPerToken).toBe(2e-7);
    expect(status.catalog?.fetchedAt).toBe('2026-09-21T12:00:00.000Z');
    // Nothing of the failure text reaches the status: only the stable code.
    expect(JSON.stringify(status)).not.toContain('offline');
  });

  it('runs one request at a time and refreshes on start only when the list is stale', async () => {
    let release!: () => void;
    const fetchPrices = vi.fn(
      () =>
        new Promise<ReturnType<typeof response>>((resolve) => {
          release = () => resolve(response(200, list()));
        }),
    );
    const f = await fixture(fetchPrices);
    const first = f.store.refresh(),
      second = f.store.refresh();
    await vi.waitFor(() => expect(fetchPrices).toHaveBeenCalledTimes(1));
    release();
    expect(await first).toEqual(await second);
    const fresh = f.make();
    fresh.start();
    await fresh.status();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchPrices).toHaveBeenCalledTimes(1);
    fresh.close();
  });
});
