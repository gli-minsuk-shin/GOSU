import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { VaultAccess } from '../src/main/vault';
import { VaultReader } from '../src/main/vault-reader';

const electron = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: { showOpenDialog: electron.showOpenDialog },
}));

const temporaryDirectories: string[] = [];

async function temporaryVault(name: string) {
  const parent = await mkdtemp(join(tmpdir(), 'gosu-vault-access-'));
  temporaryDirectories.push(parent);
  const root = join(parent, name);
  await mkdir(root);
  await writeFile(join(root, 'evidence.md'), '# Evidence');
  return root;
}

async function choose(access: VaultAccess, root: string) {
  electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [root] });
  return access.choose({} as never);
}

afterEach(async () => {
  vi.restoreAllMocks();
  electron.showOpenDialog.mockReset();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('VaultAccess atomic state', () => {
  it('returns an authoritative structured clone of the current selection', async () => {
    const access = new VaultAccess();
    expect(access.current()).toBeNull();

    const root = await temporaryVault('research-notes');
    const selected = await choose(access, root);
    expect(selected).toMatchObject({ name: 'research-notes', files: ['evidence.md'] });
    expect(access.current()).toEqual(selected);

    (selected!.files as string[]).push('renderer-only.md');
    expect(access.current()?.files).toEqual(['evidence.md']);
    expect(access.descriptor()).toEqual({ id: selected!.id, name: 'research-notes' });
    expect(access.matchesGrant(selected!.id)).toBe(true);
  });

  it('keeps the previous selection when opening or listing a replacement fails', async () => {
    const access = new VaultAccess();
    const firstRoot = await temporaryVault('first-notes');
    const failedRoot = await temporaryVault('failed-notes');
    const first = await choose(access, firstRoot);
    const failedCanonicalRoot = await realpath(failedRoot);
    const originalListDocuments = VaultReader.prototype.listDocuments;
    vi.spyOn(VaultReader.prototype, 'listDocuments').mockImplementation(async function (
      this: VaultReader,
    ) {
      if (this.root === failedCanonicalRoot) throw new Error('fixture_list_failed');
      return originalListDocuments.call(this);
    });

    await expect(choose(access, failedRoot)).rejects.toThrow('fixture_list_failed');
    expect(access.current()).toEqual(first);
    expect(access.matchesGrant(first!.id)).toBe(true);
  });

  it('revalidates the selected folder before a project grant is saved', async () => {
    const access = new VaultAccess();
    const root = await temporaryVault('removed-notes');
    const selected = await choose(access, root);

    await access.validateGrant(selected!.id);
    await rm(root, { recursive: true });

    await expect(access.validateGrant(selected!.id)).rejects.toThrow('vault_root_changed');
  });

  it('rejects an in-flight accessor when another selection becomes current', async () => {
    const access = new VaultAccess();
    const firstRoot = await temporaryVault('first-notes');
    const secondRoot = await temporaryVault('second-notes');
    const first = await choose(access, firstRoot);
    const firstCanonicalRoot = await realpath(firstRoot);
    const originalListDocuments = VaultReader.prototype.listDocuments;
    let releaseList!: () => void;
    let reportStarted!: () => void;
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const listStarted = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    vi.spyOn(VaultReader.prototype, 'listDocuments').mockImplementation(async function (
      this: VaultReader,
    ) {
      if (this.root === firstCanonicalRoot) {
        reportStarted();
        await listGate;
      }
      return originalListDocuments.call(this);
    });

    const staleRead = access.listForAgent(first!.id);
    const staleRejection = expect(staleRead).rejects.toThrow('vault_grant_stale');
    await listStarted;
    const second = await choose(access, secondRoot);
    releaseList();

    await staleRejection;
    expect(access.current()).toEqual(second);
    expect(access.matchesGrant(first!.id)).toBe(false);
  });
});
