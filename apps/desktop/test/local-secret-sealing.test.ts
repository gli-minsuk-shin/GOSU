import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PromptFreeSecretSealing, isPromptFreeSealed } from '../src/main/local-secret-sealing';
import { OverleafGitCredentialStore } from '../src/main/overleaf-git-credential-store';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gosu-secret-sealing-'));
  dirs.push(root);
  // Stands in for Electron safeStorage; every call is a macOS password prompt in the real app.
  const legacy = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`sealed:${value}`)),
    decryptString: vi.fn((sealed: Buffer) => {
      const text = sealed.toString('utf8');
      if (!text.startsWith('sealed:')) throw new Error('invalid_ciphertext');
      return text.slice('sealed:'.length);
    }),
  };
  return { root, legacy, sealing: new PromptFreeSecretSealing(legacy) };
}
const systemKey = async () => Buffer.alloc(32, 7);
const TOKEN = 'olp_synthetic_personal_token_0123456789';

describe('prompt-free secret sealing', () => {
  it('checks the migrated Overleaf personal token at launch without touching safeStorage', async () => {
    const f = fixture();
    const credentials = join(f.root, 'overleaf-git');
    // A token saved by an earlier build, sealed with safeStorage.
    await new OverleafGitCredentialStore({
      rootDirectory: () => credentials,
      encryption: f.legacy,
    }).savePersonalToken(TOKEN);
    const tokenPath = join(credentials, 'personal-token.bin');

    expect(await f.sealing.load(systemKey)).toBe(true);
    expect(await f.sealing.migrateFiles([tokenPath])).toBe(1);
    expect(isPromptFreeSealed(readFileSync(tokenPath))).toBe(true);
    expect(readFileSync(tokenPath).toString('utf8')).not.toContain(TOKEN);
    expect(readdirSync(credentials).filter((name) => name.endsWith('.tmp'))).toEqual([]);

    // The next launch: a fresh process loads the key and the renderer asks for the token status.
    f.legacy.decryptString.mockClear();
    f.legacy.isEncryptionAvailable.mockClear();
    const nextLaunch = new PromptFreeSecretSealing(f.legacy);
    await nextLaunch.load(systemKey);
    const store = new OverleafGitCredentialStore({
      rootDirectory: () => credentials,
      encryption: nextLaunch,
    });
    expect(await store.personalTokenStatus()).toBe('configured');
    expect(await nextLaunch.migrateFiles([tokenPath])).toBe(0);
    expect(f.legacy.decryptString).not.toHaveBeenCalled();
    expect(f.legacy.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it('seals new secrets prompt-free and keeps using safeStorage when the helper is unavailable', async () => {
    const f = fixture();
    await f.sealing.load(systemKey);
    const sealed = f.sealing.encryptString('secret');
    expect(isPromptFreeSealed(sealed)).toBe(true);
    expect(f.sealing.decryptString(sealed)).toBe('secret');
    expect(f.legacy.encryptString).not.toHaveBeenCalled();

    const offline = fixture();
    expect(
      await offline.sealing.load(async () => {
        throw new Error('briefing_memory_keychain_unavailable');
      }),
    ).toBe(false);
    const legacyPath = join(offline.root, 'personal-token.bin');
    writeFileSync(legacyPath, 'sealed:secret');
    expect(await offline.sealing.migrateFiles([legacyPath])).toBe(0);
    expect(readFileSync(legacyPath, 'utf8')).toBe('sealed:secret');
    expect(offline.sealing.decryptString(readFileSync(legacyPath))).toBe('secret');
    expect(offline.sealing.encryptString('new').toString('utf8')).toBe('sealed:new');
    // A prompt-free secret is never handed to safeStorage, which could only prompt and fail.
    expect(() => offline.sealing.decryptString(sealed)).toThrow('local_secret_key_unavailable');
  });

  it('is wired before the window opens, so no startup path hands safeStorage a secret', () => {
    const main = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8');
    expect(main).not.toContain('encryption: safeStorage');
    expect(main.match(/encryption: localSecrets/g)).toHaveLength(2);
    const load = main.indexOf('await localSecrets.load(');
    expect(load).toBeGreaterThan(0);
    expect(load).toBeLessThan(main.indexOf('await openLocalDatabaseWithWrappedKey('));
    expect(load).toBeLessThan(main.indexOf('    createWindow(trustedRenderer);'));
  });

  it('leaves an unreadable legacy file untouched and rejects a tampered sealed secret', async () => {
    const f = fixture();
    await f.sealing.load(systemKey);
    const broken = join(f.root, 'broken.bin');
    writeFileSync(broken, 'not-safe-storage');
    const missing = join(f.root, 'missing.bin');
    expect(await f.sealing.migrateFiles([broken, missing])).toBe(0);
    expect(readFileSync(broken, 'utf8')).toBe('not-safe-storage');

    const sealed = f.sealing.encryptString('secret');
    sealed.writeUInt8(sealed.readUInt8(sealed.length - 1) ^ 1, sealed.length - 1);
    expect(() => f.sealing.decryptString(sealed)).toThrow();
  });
});
