import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join } from 'node:path';
import { systemBriefingKey } from './briefing-system-key';

type FileIdentity = Readonly<{ ino: number; size: number; mtimeMs: number; ctimeMs: number }>;

function identityOf(stat: Stats): FileIdentity {
  return { ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

function sameIdentity(a: FileIdentity, b: FileIdentity) {
  return a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

/** Single-host serialized, authenticated, atomic state; never falls back to plaintext. */
export class SealedStateStore<S extends { revision: number }> {
  private queue: Promise<unknown> = Promise.resolve();
  private key: Promise<Buffer> | undefined;
  // Plaintext this instance last committed, bound to the exact file it wrote. Every commit
  // renames a new inode into place, and ctime cannot be set by a regular user, so any other
  // writer or tampering changes the identity and forces a full authenticated read.
  private committed: Readonly<{ identity: FileIdentity; plaintext: string }> | null = null;
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
    let stat: Stats;
    try {
      const dir = await lstat(this.directory);
      if (!dir.isDirectory() || dir.isSymbolicLink())
        throw new Error('briefing_memory_path_unsafe');
      stat = await lstat(join(this.directory, this.options.file));
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > (this.options.maxBytes ?? 32_000_000)
      )
        throw new Error('briefing_memory_path_unsafe');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.committed = null;
        return this.options.empty();
      }
      throw error;
    }
    const committed = this.committed;
    if (committed && sameIdentity(committed.identity, identityOf(stat))) {
      // Same bytes this instance authenticated and wrote; parse again so callers always get a
      // fresh, schema-validated object exactly as a disk read would produce.
      try {
        return this.options.parse(JSON.parse(committed.plaintext));
      } catch (error) {
        this.committed = null;
        throw new Error('briefing_memory_unreadable', { cause: error });
      }
    }
    this.committed = null;
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
  private async ensureDirectory() {
    try {
      const dir = await lstat(this.directory);
      if (!dir.isDirectory() || dir.isSymbolicLink())
        throw new Error('briefing_memory_path_unsafe');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const dir = await lstat(this.directory);
    if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error('briefing_memory_path_unsafe');
  }
  mutate<T>(fn: (state: S) => T, signal?: AbortSignal, beforeCommit?: () => void): Promise<T> {
    const pending = this.queue.then(async () => {
      if (signal?.aborted) throw new Error('source_cancelled');
      beforeCommit?.();
      const state = await this.readUnlocked(),
        result = fn(state);
      state.revision++;
      this.options.parse(state);
      await this.ensureDirectory();
      const plaintext = JSON.stringify(state);
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', await this.cryptoKey(), iv);
      c.setAAD(Buffer.from(this.options.aad));
      const ciphertext = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]).toString('base64');
      const encoded = JSON.stringify({
        version: this.options.version,
        iv: iv.toString('base64'),
        tag: c.getAuthTag().toString('base64'),
        ciphertext,
      });
      if (Buffer.byteLength(encoded) > (this.options.maxBytes ?? 32_000_000))
        throw new Error('briefing_memory_limit');
      const target = join(this.directory, this.options.file);
      const temporary = join(this.directory, `state-${randomUUID()}.tmp`);
      let renamed = false;
      this.committed = null;
      try {
        await writeFile(temporary, encoded, { mode: 0o600, flag: 'wx' });
        if (signal?.aborted) throw new Error('source_cancelled');
        beforeCommit?.();
        await rename(temporary, target);
        renamed = true;
      } finally {
        if (!renamed) await unlink(temporary).catch(() => undefined);
      }
      try {
        this.committed = { identity: identityOf(await lstat(target)), plaintext };
      } catch {
        this.committed = null;
      }
      return result;
    });
    this.queue = pending.catch(() => undefined);
    return pending;
  }
}
