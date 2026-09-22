import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
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

  it('keeps a saved grant when macOS gives the same folder a new inode', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'gosu-vault-identity-'));
    temporaryDirectories.push(parent);
    const root = join(parent, 'Obsidian Vault');
    await mkdir(root);
    await writeFile(join(root, 'evidence.md'), '# Evidence');
    const first = await choose(new VaultAccess(), root);

    // iCloud evicting and re-materializing the folder, a remount, or a restore from a backup all
    // give the same path a new device and inode. The grant must survive every one of them.
    const moved = join(parent, 'Obsidian Vault.old');
    await rename(root, moved);
    await mkdir(root);
    await writeFile(join(root, 'evidence.md'), '# Evidence');
    const access = new VaultAccess();
    const again = await choose(access, root);

    expect(again!.id).toBe(first!.id);
    expect(access.matchesGrant(first!.id)).toBe(true);
  });

  it('still recognizes a grant saved under the identity used before 0.58.147', async () => {
    const root = await temporaryVault('legacy-grant');
    const canonical = await realpath(root);
    const reader = await VaultReader.open(canonical);
    const { createHash } = await import('node:crypto');
    const legacyId = createHash('sha256')
      .update(`${reader.root}\0${reader.identityKey()}`)
      .digest('hex');
    const access = new VaultAccess();
    const selected = await choose(access, root);

    expect(selected!.id).not.toBe(legacyId);
    expect(access.matchesGrant(legacyId)).toBe(true);
    expect(access.matchesGrant('0'.repeat(64))).toBe(false);
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

  it('reconnects the saved vault on demand, once at a time, and says why it could not', async () => {
    const root = await temporaryVault('saved');
    const loadRoot = vi.fn(async () => root);
    const access = new VaultAccess({ loadRoot, saveRoot: vi.fn() });
    // Startup and a project opened at the same moment share one reconnect.
    const [first, second] = await Promise.all([access.restore(), access.restore()]);
    expect(first?.root).toBe(await realpath(root));
    expect(second).toEqual(first);
    expect(loadRoot).toHaveBeenCalledOnce();
    expect(access.current()?.root).toBe(await realpath(root));
    expect(access.restoreError()).toBeNull();
    // Once connected, asking again does not reopen anything.
    await access.restore();
    expect(loadRoot).toHaveBeenCalledOnce();

    // A saved vault that is gone is reported as such, the setting is not forgotten, and the next
    // request reconnects without restarting the app.
    const moved = await temporaryVault('moved');
    const away = `${moved}-away`;
    const later = new VaultAccess({ loadRoot: async () => moved, saveRoot: vi.fn() });
    await rename(moved, away);
    await expect(later.restore()).rejects.toMatchObject({ code: 'ENOENT' });
    expect(later.current()).toBeNull();
    expect(later.restoreError()).toBe('missing');
    await rename(away, moved);
    await expect(later.restore()).resolves.toMatchObject({ root: await realpath(moved) });
    expect(later.restoreError()).toBeNull();
    // Nothing saved is not a failure: that is the first-time "choose a vault" case.
    const fresh = new VaultAccess({ loadRoot: async () => null, saveRoot: vi.fn() });
    await expect(fresh.restore()).resolves.toBeNull();
    expect(fresh.restoreError()).toBeNull();
  });

  it('never replaces a vault the user chose while the saved one was still reconnecting', async () => {
    const saved = await temporaryVault('saved');
    const chosen = await temporaryVault('chosen');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const access = new VaultAccess({
      loadRoot: async () => {
        await gate;
        return saved;
      },
      saveRoot: vi.fn(),
    });
    const restoring = access.restore();
    await choose(access, chosen);
    release();
    await expect(restoring).resolves.toMatchObject({ root: await realpath(chosen) });
    expect(access.current()?.root).toBe(await realpath(chosen));
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
