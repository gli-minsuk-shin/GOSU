import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MailDirectoryStore } from './mail-directory-store';

const dirs: string[] = [];
const key = async () => Buffer.alloc(32, 9);
async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'mail-directory-'));
  dirs.push(dir);
  return { dir, store: new MailDirectoryStore(dir, key) };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('saved Apple Mail mailbox locations', () => {
  it('keeps the locations sealed on disk and returns them to a new instance', async () => {
    const { dir, store: s } = await store();
    expect(await s.load()).toEqual([]);
    const entries = [
      { accountId: '6F7D3C1A-ACCOUNT', path: ['INBOX'] },
      { accountId: '6F7D3C1A-ACCOUNT', path: ['Labels', 'Private label'] },
    ];
    await s.save(entries);
    const raw = await readFile(join(dir, 'mail-directory.v1.enc.json'), 'utf8');
    expect(raw).not.toContain('6F7D3C1A');
    expect(raw).not.toContain('Private label');
    expect(await new MailDirectoryStore(dir, key).load()).toEqual(entries);
  });

  it('keeps only the newest locations within its bound and rejects malformed ones', async () => {
    const { store: s } = await store();
    const many = Array.from({ length: 70 }, (_, i) => ({ accountId: 'a', path: [`box-${i}`] }));
    await s.save(many);
    const kept = await s.load();
    expect(kept).toHaveLength(64);
    expect(kept.at(-1)).toEqual({ accountId: 'a', path: ['box-69'] });
    await expect(s.save([{ accountId: '', path: ['INBOX'] }])).rejects.toThrow();
    await expect(s.save([{ accountId: 'a', path: [] }])).rejects.toThrow();
    expect(await s.load()).toHaveLength(64);
  });
});
