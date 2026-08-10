import { constants } from 'node:fs';
import { open, opendir, realpath, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';

import type { VaultAttachment } from '../shared/vault-contracts';

export type VaultLimits = {
  maxMarkdownBytes: number;
  maxAttachmentBytes: number;
  maxFiles: number;
  maxDirectories: number;
  maxEntries: number;
  maxDepth: number;
};

export const DEFAULT_VAULT_LIMITS: Readonly<VaultLimits> = Object.freeze({
  maxMarkdownBytes: 2_000_000,
  maxAttachmentBytes: 8_000_000,
  maxFiles: 5_000,
  maxDirectories: 2_000,
  maxEntries: 20_000,
  maxDepth: 32,
});

const ATTACHMENT_MIME_TYPES = Object.freeze({
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
} as const);

type WalkState = {
  directories: number;
  entries: number;
  stopped: boolean;
};

type VaultRootIdentity = Readonly<{ dev: number; ino: number }>;

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
    private readonly rootIdentity: VaultRootIdentity,
  ) {}

  static async open(root: string, limitOverrides: Partial<VaultLimits> = {}) {
    const canonicalRoot = await realpath(root);
    const metadata = await stat(canonicalRoot);
    if (!metadata.isDirectory()) throw new Error('vault_directory_required');
    return new VaultReader(canonicalRoot, boundedLimits(limitOverrides), {
      dev: metadata.dev,
      ino: metadata.ino,
    });
  }

  identityKey() {
    return `${this.rootIdentity.dev}:${this.rootIdentity.ino}`;
  }

  async validateRoot() {
    await this.assertRootIdentity();
  }

  async listMarkdown(signal?: AbortSignal) {
    signal?.throwIfAborted();
    await this.assertRootIdentity();
    const results: string[] = [];
    const state: WalkState = { directories: 0, entries: 0, stopped: false };
    await this.walk(this.root, results, state, 0, signal);
    signal?.throwIfAborted();
    await this.assertRootIdentity();
    return results.sort();
  }

  async readMarkdown(relativePath: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    await this.assertRootIdentity();
    if (extname(relativePath).toLowerCase() !== '.md') throw new Error('markdown_only');

    const requestedTarget = resolve(this.root, relativePath);
    const target = await realpath(requestedTarget);
    const path = assertInsideVault(this.root, target);
    if (target !== requestedTarget) throw new Error('vault_symlink_not_allowed');

    const expectedMetadata = await stat(target);
    const bytes = await this.readBoundedFile(
      target,
      this.limits.maxMarkdownBytes,
      'markdown_file_required',
      'markdown_too_large',
      expectedMetadata,
      signal,
    );
    return { path, content: bytes.toString('utf8') };
  }

  async readAttachment(notePath: string, rawSource: string): Promise<VaultAttachment> {
    await this.assertRootIdentity();
    if (extname(notePath).toLowerCase() !== '.md') throw new Error('markdown_only');
    const noteTarget = resolve(this.root, notePath);
    const realNoteTarget = await realpath(noteTarget);
    assertInsideVault(this.root, realNoteTarget);
    if (realNoteTarget !== noteTarget) throw new Error('vault_symlink_not_allowed');

    const source = decodeAttachmentSource(rawSource);
    const requestedTarget = source.startsWith('/')
      ? resolve(this.root, `.${source}`)
      : resolve(dirname(noteTarget), source);
    const target = await realpath(requestedTarget);
    const path = assertInsideVault(this.root, target);
    if (target !== requestedTarget) throw new Error('vault_symlink_not_allowed');

    const extension = extname(path).toLowerCase() as keyof typeof ATTACHMENT_MIME_TYPES;
    const mimeType = ATTACHMENT_MIME_TYPES[extension];
    if (!mimeType) throw new Error('vault_attachment_type_not_allowed');
    const bytes = await this.readBoundedFile(
      target,
      this.limits.maxAttachmentBytes,
      'vault_attachment_file_required',
      'vault_attachment_too_large',
    );
    if (!hasExpectedImageSignature(extension, bytes)) {
      throw new Error('vault_attachment_content_mismatch');
    }
    return { path, mimeType, dataBase64: bytes.toString('base64') };
  }

  private async readBoundedFile(
    target: string,
    limit: number,
    fileError: string,
    sizeError: string,
    expectedMetadata?: Readonly<{ dev: number | bigint; ino: number | bigint }>,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new Error(fileError);
      if (
        expectedMetadata &&
        (metadata.dev !== expectedMetadata.dev || metadata.ino !== expectedMetadata.ino)
      ) {
        throw new Error('vault_file_changed_during_open');
      }
      await this.assertOpenedTarget(target, metadata);
      if (metadata.size > limit) throw new Error(sizeError);

      const bytes = Buffer.allocUnsafe(limit + 1);
      let total = 0;
      while (total < bytes.length) {
        signal?.throwIfAborted();
        const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      if (total > limit) throw new Error(sizeError);
      signal?.throwIfAborted();
      await this.assertOpenedTarget(target, metadata);
      return bytes.subarray(0, total);
    } finally {
      await handle.close();
    }
  }

  private async assertOpenedTarget(
    target: string,
    openedMetadata: Readonly<{ dev: number | bigint; ino: number | bigint }>,
  ) {
    await this.assertRootIdentity();
    try {
      const canonicalTarget = await realpath(target);
      assertInsideVault(this.root, canonicalTarget);
      if (canonicalTarget !== target) throw new Error('vault_file_changed_during_open');
      const currentMetadata = await stat(canonicalTarget);
      if (
        !currentMetadata.isFile() ||
        currentMetadata.dev !== openedMetadata.dev ||
        currentMetadata.ino !== openedMetadata.ino
      ) {
        throw new Error('vault_file_changed_during_open');
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'vault_root_changed') throw error;
      throw new Error('vault_file_changed_during_open', { cause: error });
    }
  }

  private async assertRootIdentity() {
    try {
      const canonicalRoot = await realpath(this.root);
      const metadata = await stat(canonicalRoot);
      if (
        canonicalRoot !== this.root ||
        !metadata.isDirectory() ||
        metadata.dev !== this.rootIdentity.dev ||
        metadata.ino !== this.rootIdentity.ino
      ) {
        throw new Error('vault_root_changed');
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'vault_root_changed') throw error;
      throw new Error('vault_root_changed', { cause: error });
    }
  }

  private async walk(
    directory: string,
    results: string[],
    state: WalkState,
    depth: number,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
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
      signal?.throwIfAborted();
      if (state.entries >= this.limits.maxEntries) {
        state.stopped = true;
        break;
      }
      state.entries += 1;
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;

      const full = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await this.walk(full, results, state, depth + 1, signal);
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

function decodeAttachmentSource(rawSource: string) {
  const withoutFragment = rawSource.split('#', 1)[0]!.split('?', 1)[0]!.trim();
  if (
    withoutFragment === '' ||
    withoutFragment.includes('\0') ||
    /^[a-z][a-z\d+.-]*:/i.test(withoutFragment) ||
    withoutFragment.startsWith('//')
  ) {
    throw new Error('vault_attachment_source_invalid');
  }
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    throw new Error('vault_attachment_source_invalid');
  }
}

function hasExpectedImageSignature(extension: keyof typeof ATTACHMENT_MIME_TYPES, bytes: Buffer) {
  switch (extension) {
    case '.png':
      return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case '.jpeg':
    case '.jpg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case '.gif':
      return (
        bytes.subarray(0, 6).toString('ascii') === 'GIF87a' ||
        bytes.subarray(0, 6).toString('ascii') === 'GIF89a'
      );
    case '.webp':
      return (
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    case '.avif': {
      if (bytes.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
      const brands = bytes.subarray(8, Math.min(bytes.length, 40)).toString('ascii');
      return brands.includes('avif') || brands.includes('avis');
    }
  }
}
