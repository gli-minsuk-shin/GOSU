import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { systemBriefingKey } from './briefing-system-key';
/** Single-host serialized, authenticated, atomic state; never falls back to plaintext. */
export class SealedStateStore<S extends { revision: number }> {
  private queue: Promise<unknown> = Promise.resolve();
  private key: Promise<Buffer> | undefined;
  constructor(
    readonly directory: string,
    private readonly options: {
      file: string;
      version: number;
      aad: string;
      empty: () => S;
      parse: (value: unknown) => S;
      maxBytes?: number;
    },
    private readonly keyProvider = systemBriefingKey,
  ) {}
  private cryptoKey() {
    if (!this.key)
      this.key = this.keyProvider(this.directory).catch((error) => {
        this.key = undefined;
        throw error;
      });
    return this.key;
  }
  private async readUnlocked(): Promise<S> {
    try {
      const dir = await lstat(this.directory);
      if (!dir.isDirectory() || dir.isSymbolicLink())
        throw new Error('briefing_memory_path_unsafe');
      const stat = await lstat(join(this.directory, this.options.file));
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > (this.options.maxBytes ?? 32_000_000)
      )
        throw new Error('briefing_memory_path_unsafe');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.options.empty();
      throw error;
    }
    try {
      const e = JSON.parse(await readFile(join(this.directory, this.options.file), 'utf8')) as {
        version: number;
        iv: string;
        tag: string;
        ciphertext: string;
      };
      if (e.version !== this.options.version) throw new Error('version');
      const d = createDecipheriv(
        'aes-256-gcm',
        await this.cryptoKey(),
        Buffer.from(e.iv, 'base64'),
      );
      d.setAAD(Buffer.from(this.options.aad));
      d.setAuthTag(Buffer.from(e.tag, 'base64'));
      return this.options.parse(
        JSON.parse(
          Buffer.concat([d.update(Buffer.from(e.ciphertext, 'base64')), d.final()]).toString(
            'utf8',
          ),
        ),
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('briefing_memory_keychain'))
        throw error;
      throw new Error('briefing_memory_unreadable', { cause: error });
    }
  }
  async read() {
    await this.queue;
    return this.readUnlocked();
  }
  mutate<T>(fn: (state: S) => T, signal?: AbortSignal, beforeCommit?: () => void): Promise<T> {
    const pending = this.queue.then(async () => {
      if (signal?.aborted) throw new Error('source_cancelled');
      beforeCommit?.();
      const state = await this.readUnlocked(),
        result = fn(state);
      state.revision++;
      this.options.parse(state);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const dir = await lstat(this.directory);
      if (!dir.isDirectory() || dir.isSymbolicLink())
        throw new Error('briefing_memory_path_unsafe');
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', await this.cryptoKey(), iv);
      c.setAAD(Buffer.from(this.options.aad));
      const payload = JSON.stringify({
        version: this.options.version,
        iv: iv.toString('base64'),
        tag: '',
        ciphertext: Buffer.concat([c.update(JSON.stringify(state), 'utf8'), c.final()]).toString(
          'base64',
        ),
      });
      const e = JSON.parse(payload);
      e.tag = c.getAuthTag().toString('base64');
      const encoded = JSON.stringify(e);
      if (Buffer.byteLength(encoded) > (this.options.maxBytes ?? 32_000_000))
        throw new Error('briefing_memory_limit');
      const temporary = join(this.directory, `state-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, encoded, { mode: 0o600, flag: 'wx' });
        if (signal?.aborted) throw new Error('source_cancelled');
        beforeCommit?.();
        await rename(temporary, join(this.directory, this.options.file));
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      return result;
    });
    this.queue = pending.catch(() => undefined);
    return pending;
  }
}
