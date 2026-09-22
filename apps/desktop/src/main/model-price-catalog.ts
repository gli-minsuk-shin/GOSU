import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  MODEL_PRICE_MAX_BYTES,
  MODEL_PRICE_REFRESH_INTERVAL_MS,
  MODEL_PRICE_SOURCE_URL,
  ModelPriceCatalogSchema,
  extractLitellmPrices,
  type ModelPriceCatalog,
  type ModelPriceStatus,
} from '../shared/model-price-contracts';

type PriceFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

const FETCH_TIMEOUT_MS = 30_000;

/**
 * The public price list, kept as a small file in the app's data folder and refreshed once a day.
 * The request is a plain GET of one fixed URL: nothing about the user, the models used or the
 * amounts goes out. A refresh that fails keeps the last list; a model missing from the list has no
 * price (the view says so) instead of a guessed one.
 */
export class ModelPriceCatalogStore {
  private catalog: ModelPriceCatalog | null = null;
  private lastAttemptAt: string | null = null;
  private lastError: ModelPriceStatus['lastError'] = null;
  private loaded: Promise<void> | undefined;
  private refreshing: Promise<ModelPriceStatus> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly directory: string,
    private readonly fetchPrices: PriceFetch = (url, init) => globalThis.fetch(url, init),
    private readonly clock = Date.now,
  ) {}

  private get file() {
    return join(this.directory, 'model-prices.v1.json');
  }

  private load() {
    return (this.loaded ??= (async () => {
      try {
        const parsed = ModelPriceCatalogSchema.safeParse(
          JSON.parse(await readFile(this.file, 'utf8')),
        );
        if (parsed.success) this.catalog = parsed.data;
      } catch {
        // No list yet, or an unreadable one: the next refresh writes a new file.
      }
    })());
  }

  async status(): Promise<ModelPriceStatus> {
    await this.load();
    return {
      catalog: this.catalog,
      lastAttemptAt: this.lastAttemptAt,
      lastError: this.lastError,
    };
  }

  /** True when there is no list or it is older than a day. */
  async stale() {
    await this.load();
    return (
      !this.catalog ||
      this.clock() - Date.parse(this.catalog.fetchedAt) >= MODEL_PRICE_REFRESH_INTERVAL_MS
    );
  }

  refresh(): Promise<ModelPriceStatus> {
    return (this.refreshing ??= this.refreshOnce().finally(() => {
      this.refreshing = undefined;
    }));
  }

  private async refreshOnce(): Promise<ModelPriceStatus> {
    await this.load();
    this.lastAttemptAt = new Date(this.clock()).toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      let response: Awaited<ReturnType<PriceFetch>>;
      try {
        response = await this.fetchPrices(MODEL_PRICE_SOURCE_URL, {
          headers: {
            accept: 'application/json',
            ...(this.catalog?.etag ? { 'if-none-match': this.catalog.etag } : {}),
          },
          signal: controller.signal,
        });
      } catch {
        return this.failed('model_prices_network');
      }
      if (response.status === 304 && this.catalog) {
        // Unchanged since the last fetch: the prices are confirmed current as of now.
        return this.store({ ...this.catalog, fetchedAt: this.lastAttemptAt });
      }
      if (response.status !== 200) return this.failed('model_prices_http');
      let text: string;
      try {
        text = await response.text();
      } catch {
        return this.failed('model_prices_network');
      }
      if (Buffer.byteLength(text) > MODEL_PRICE_MAX_BYTES)
        return this.failed('model_prices_too_large');
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return this.failed('model_prices_invalid');
      }
      const models = extractLitellmPrices(raw);
      if (Object.keys(models).length === 0) return this.failed('model_prices_empty');
      const parsed = ModelPriceCatalogSchema.safeParse({
        version: 1,
        sourceUrl: MODEL_PRICE_SOURCE_URL,
        fetchedAt: this.lastAttemptAt,
        etag: response.headers.get('etag')?.slice(0, 300) ?? null,
        models,
      });
      if (!parsed.success) return this.failed('model_prices_invalid');
      return this.store(parsed.data);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async store(catalog: ModelPriceCatalog): Promise<ModelPriceStatus> {
    const temporary = join(this.directory, `model-prices-${randomUUID()}.tmp`);
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(temporary, JSON.stringify(catalog), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.file);
    } catch {
      await unlink(temporary).catch(() => undefined);
      // The new list still serves this session.
      this.catalog = catalog;
      return this.failed('model_prices_storage');
    }
    this.catalog = catalog;
    this.lastError = null;
    return this.status();
  }

  private failed(code: NonNullable<ModelPriceStatus['lastError']>) {
    this.lastError = code;
    return this.status();
  }

  /** Refreshes now when the list is stale, then checks hourly so a day never passes unnoticed. */
  start() {
    if (this.timer) return;
    const check = () =>
      void this.stale()
        .then((stale) => (stale ? this.refresh() : undefined))
        .catch(() => undefined);
    check();
    this.timer = setInterval(check, 60 * 60_000);
    this.timer.unref?.();
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
