import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitBlobBatchError, createGitBlobBatchReader } from '../src/main/git-blob-batch-reader';

const objectId = 'a'.repeat(40);
const limits = {
  maxObjects: 2,
  maxObjectBytes: 16,
  maxTotalBytes: 24,
  timeoutMs: 1_000,
} as const;

describe('Git blob batch reader', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gosu-git-blob-reader-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('rejects non-object input and count, object, or aggregate limits before spawning Git', async () => {
    const reader = createGitBlobBatchReader(join(root, 'does-not-exist'));
    await expect(reader(root, [{ objectId: 'HEAD', expectedSize: 1 }], limits)).rejects.toEqual(
      expect.objectContaining<Partial<GitBlobBatchError>>({ kind: 'invalid' }),
    );
    await expect(
      reader(
        root,
        [
          { objectId, expectedSize: 1 },
          { objectId: 'b'.repeat(40), expectedSize: 1 },
          { objectId: 'c'.repeat(40), expectedSize: 1 },
        ],
        limits,
      ),
    ).rejects.toMatchObject({ kind: 'too_large' });
    await expect(reader(root, [{ objectId, expectedSize: 17 }], limits)).rejects.toMatchObject({
      kind: 'too_large',
    });
    await expect(
      reader(
        root,
        [
          { objectId, expectedSize: 13 },
          { objectId: 'b'.repeat(40), expectedSize: 13 },
        ],
        limits,
      ),
    ).rejects.toMatchObject({ kind: 'too_large' });
  });

  it.runIf(process.platform !== 'win32')(
    'kills the isolated process group when the fixed batch command times out',
    async () => {
      const executable = join(root, 'slow-git');
      const pidFile = join(root, 'pid');
      await writeFile(
        executable,
        `#!/bin/sh\nprintf '%s' "$$" > ${JSON.stringify(pidFile)}\nsleep 30\n`,
      );
      await chmod(executable, 0o700);
      const reader = createGitBlobBatchReader(executable);

      await expect(
        reader(root, [{ objectId, expectedSize: 1 }], { ...limits, timeoutMs: 500 }),
      ).rejects.toMatchObject({ kind: 'timeout' });

      const pid = Number(await readFile(pidFile, 'utf8'));
      expect(Number.isSafeInteger(pid)).toBe(true);
      let running = true;
      for (let attempt = 0; attempt < 20 && running; attempt += 1) {
        try {
          process.kill(pid, 0);
          await new Promise((resolve) => setTimeout(resolve, 10));
        } catch {
          running = false;
        }
      }
      expect(running).toBe(false);
    },
  );
});
