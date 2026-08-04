import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { LITERATURE_MAX_TRANSFER_BYTES } from '../shared/literature-contracts';

export const MAX_LITERATURE_TRANSFER_BYTES = LITERATURE_MAX_TRANSFER_BYTES;

async function closeQuietly(handle: FileHandle | undefined) {
  await handle?.close().catch(() => undefined);
}

export async function readBoundedLiteratureFile(path: string) {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const status = await handle.stat();
    if (!status.isFile()) throw new Error('literature_import_invalid');
    if (status.size > MAX_LITERATURE_TRANSFER_BYTES) {
      throw new Error('literature_import_too_large');
    }
    const content = await handle.readFile({ encoding: 'utf8' });
    if (Buffer.byteLength(content, 'utf8') > MAX_LITERATURE_TRANSFER_BYTES) {
      throw new Error('literature_import_too_large');
    }
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error('literature_import_invalid', { cause: error });
    }
    throw error;
  } finally {
    await closeQuietly(handle);
  }
}

export async function writeAtomicLiteratureFile(path: string, content: string) {
  if (Buffer.byteLength(content, 'utf8') > MAX_LITERATURE_TRANSFER_BYTES) {
    throw new Error('literature_export_too_large');
  }
  const temporaryPath = join(dirname(path), `.gosu-literature-${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  let committed = false;
  try {
    handle = await open(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
    const status = await handle.stat();
    if (!status.isFile()) throw new Error('literature_export_invalid');
    await handle.chmod(0o600);
    await handle.writeFile(content, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;

    try {
      const target = await lstat(path);
      if (target.isSymbolicLink() || !target.isFile()) {
        throw new Error('literature_export_invalid');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    // The temporary file lives beside the chosen destination, so rename is atomic and never
    // follows a destination symlink even if that directory entry changes after the lstat above.
    await rename(temporaryPath, path);
    committed = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error('literature_export_invalid', { cause: error });
    }
    throw error;
  } finally {
    await closeQuietly(handle);
    if (!committed) await unlink(temporaryPath).catch(() => undefined);
  }
}
