import { constants } from 'node:fs';
import { open, opendir, realpath, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

export type VaultLimits = {
  maxMarkdownBytes: number;
  maxFiles: number;
  maxDirectories: number;
  maxEntries: number;
  maxDepth: number;
};

export const DEFAULT_VAULT_LIMITS: Readonly<VaultLimits> = Object.freeze({
  maxMarkdownBytes: 2_000_000,
  maxFiles: 5_000,
  maxDirectories: 2_000,
  maxEntries: 20_000,
  maxDepth: 32,
});

type WalkState = {
  directories: number;
  entries: number;
  stopped: boolean;
};

function boundedLimits(overrides: Partial<VaultLimits>): Readonly<VaultLimits> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(DEFAULT_VAULT_LIMITS).map(([key, defaultValue]) => {
        const requested = overrides[key as keyof VaultLimits];
        return [
          key,
          typeof requested === 'number' && Number.isSafeInteger(requested) && requested > 0
            ? Math.min(requested, defaultValue)
            : defaultValue,
        ];
      }),
    ) as VaultLimits,
  );
}

function assertInsideVault(root: string, target: string) {
  const path = relative(root, target);
  if (path === '' || path === '..' || path.startsWith(`..${sep}`)) {
    throw new Error('vault_path_escape');
  }
  return path;
}

export class VaultReader {
  private constructor(
    readonly root: string,
    private readonly limits: Readonly<VaultLimits>,
  ) {}

  static async open(root: string, limitOverrides: Partial<VaultLimits> = {}) {
    return new VaultReader(await realpath(root), boundedLimits(limitOverrides));
  }

  async listMarkdown() {
    const results: string[] = [];
    const state: WalkState = { directories: 0, entries: 0, stopped: false };
    await this.walk(this.root, results, state, 0);
    return results.sort();
  }

  async readMarkdown(relativePath: string) {
    if (extname(relativePath).toLowerCase() !== '.md') throw new Error('markdown_only');

    const requestedTarget = resolve(this.root, relativePath);
    const target = await realpath(requestedTarget);
    const path = assertInsideVault(this.root, target);
    if (target !== requestedTarget) throw new Error('vault_symlink_not_allowed');

    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new Error('markdown_file_required');
      if (metadata.size > this.limits.maxMarkdownBytes) throw new Error('markdown_too_large');

      const bytes = Buffer.allocUnsafe(this.limits.maxMarkdownBytes + 1);
      let total = 0;
      while (total < bytes.length) {
        const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      if (total > this.limits.maxMarkdownBytes) throw new Error('markdown_too_large');

      return { path, content: bytes.subarray(0, total).toString('utf8') };
    } finally {
      await handle.close();
    }
  }

  private async walk(
    directory: string,
    results: string[],
    state: WalkState,
    depth: number,
  ): Promise<void> {
    if (
      state.stopped ||
      results.length >= this.limits.maxFiles ||
      state.directories >= this.limits.maxDirectories ||
      depth > this.limits.maxDepth
    ) {
      return;
    }
    state.directories += 1;

    const entries = await opendir(directory);
    for await (const entry of entries) {
      if (state.entries >= this.limits.maxEntries) {
        state.stopped = true;
        break;
      }
      state.entries += 1;
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;

      const full = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await this.walk(full, results, state, depth + 1);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        const metadata = await stat(full);
        if (metadata.size <= this.limits.maxMarkdownBytes) {
          results.push(relative(this.root, full));
        }
      }

      if (results.length >= this.limits.maxFiles || state.stopped) break;
    }
  }
}
