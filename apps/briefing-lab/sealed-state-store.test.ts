import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { SealedStateStore } from './sealed-state-store';

type State = { revision: number; items: string[] };
const directories: string[] = [];

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'gosu-sealed-'));
  directories.push(dir);
  const open = () =>
    new SealedStateStore<State>(
      dir,
      {
        file: 'state.enc.json',
        version: 1,
        aad: 'gosu-sealed-test',
        empty: () => ({ revision: 0, items: [] }),
        parse: (value) => {
          const v = value as State;
          if (typeof v?.revision !== 'number' || !Array.isArray(v.items)) throw new Error('shape');
          return { revision: v.revision, items: [...v.items] };
        },
        maxBytes: 4_000,
      },
      async () => Buffer.alloc(32, 9),
    );
  return { dir, file: join(dir, 'state.enc.json'), open };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

it('observes a write from another instance instead of reusing its own committed copy', async () => {
  const { open } = await fixture();
  const first = open();
  const second = open();
  await first.mutate((s) => void s.items.push('from-first'));
  await second.mutate((s) => void s.items.push('from-second'));
  await first.mutate((s) => void s.items.push('first-again'));
  expect((await open().read()).items).toEqual(['from-first', 'from-second', 'first-again']);
  expect((await first.read()).revision).toBe(3);
});

it('returns a fresh validated object so a failed mutation cannot corrupt the next read', async () => {
  const { open } = await fixture();
  const store = open();
  await store.mutate((s) => void s.items.push('kept'));
  await expect(
    store.mutate((s) => {
      s.items.push('discarded');
      throw new Error('change rejected');
    }),
  ).rejects.toThrow('change rejected');
  expect((await store.read()).items).toEqual(['kept']);
});

it('rejects tampered ciphertext after its own write, even when mtime is restored', async () => {
  const { file, open } = await fixture();
  const store = open();
  await store.mutate((s) => void s.items.push('secret'));
  const before = await stat(file);
  const envelope = JSON.parse(await readFile(file, 'utf8')) as { ciphertext: string };
  const bytes = Buffer.from(envelope.ciphertext, 'base64');
  bytes[0] = bytes[0]! ^ 0xff;
  envelope.ciphertext = bytes.toString('base64');
  await writeFile(file, JSON.stringify(envelope));
  await utimes(file, before.atime, before.mtime);
  await expect(store.read()).rejects.toThrow('briefing_memory_unreadable');
  await expect(store.mutate((s) => void s.items.push('x'))).rejects.toThrow(
    'briefing_memory_unreadable',
  );
});

it('leaves no temporary files after commits or a rejected oversized write', async () => {
  const { dir, open } = await fixture();
  const store = open();
  for (let i = 0; i < 5; i++) await store.mutate((s) => void s.items.push(`item-${i}`));
  await expect(store.mutate((s) => void s.items.push('x'.repeat(8_000)))).rejects.toThrow(
    'briefing_memory_limit',
  );
  expect(await readdir(dir)).toEqual(['state.enc.json']);
  expect((await open().read()).items).toHaveLength(5);
  expect((await stat(join(dir, 'state.enc.json'))).mode & 0o777).toBe(0o600);
});

it('does not commit a mutation vetoed after its temporary file was written', async () => {
  const { dir, open } = await fixture();
  const store = open();
  await store.mutate((s) => void s.items.push('before'));
  let calls = 0;
  await expect(
    store.mutate(
      (s) => void s.items.push('vetoed'),
      undefined,
      () => {
        // The second check runs after the encrypted temporary file exists, just before rename.
        if (++calls === 2) throw new Error('settings_changed');
      },
    ),
  ).rejects.toThrow('settings_changed');
  expect(calls).toBe(2);
  expect(await readdir(dir)).toEqual(['state.enc.json']);
  expect((await open().read()).items).toEqual(['before']);
  expect((await store.read()).items).toEqual(['before']);
});
