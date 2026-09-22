import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LEGACY_LOCAL_DATABASE_KEY_FILE,
  LOCAL_DATABASE_KEY_FILE,
  openLocalDatabaseWithWrappedKey,
  resolveLocalDatabaseKey,
} from '../src/main/local-database-key';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(systemKey: Buffer | Error = Buffer.alloc(32, 7)) {
  const userData = mkdtempSync(join(tmpdir(), 'gosu-db-key-'));
  dirs.push(userData);
  // Stands in for Electron safeStorage; every decrypt is a macOS password prompt in the real app.
  const legacy = {
    isEncryptionAvailable: vi.fn(() => true),
    decryptString: vi.fn((sealed: Buffer) => sealed.toString('utf8').replace(/^sealed:/, '')),
    encryptString: vi.fn((plain: string) => Buffer.from(`sealed:${plain}`)),
  };
  const options = {
    userData,
    systemKey: vi.fn(async () => {
      if (systemKey instanceof Error) throw systemKey;
      return Buffer.from(systemKey);
    }),
    legacy,
  };
  const writeLegacy = (key: Buffer) =>
    writeFileSync(join(userData, LEGACY_LOCAL_DATABASE_KEY_FILE), `sealed:${key.toString('hex')}`);
  return { userData, legacy, options, writeLegacy };
}

describe('prompt-free local database key', () => {
  it('migrates the legacy key once, then opens without touching safeStorage again', async () => {
    const f = fixture();
    const original = Buffer.alloc(32, 3);
    f.writeLegacy(original);
    const first = await resolveLocalDatabaseKey(f.options);
    expect(first.source).toBe('migrated');
    expect(first.key.equals(original)).toBe(true);
    expect(f.legacy.decryptString).toHaveBeenCalledOnce();
    // Nothing is persisted until the database actually opened with that key.
    expect(existsSync(join(f.userData, LOCAL_DATABASE_KEY_FILE))).toBe(false);
    first.commit();
    expect(readFileSync(join(f.userData, LOCAL_DATABASE_KEY_FILE), 'utf8')).not.toContain(
      original.toString('hex'),
    );
    f.legacy.decryptString.mockClear();
    const next = await resolveLocalDatabaseKey(f.options);
    expect(next.source).toBe('wrapped');
    expect(next.key.equals(original)).toBe(true);
    expect(f.legacy.decryptString).not.toHaveBeenCalled();
    // The legacy file stays so an older build can still open the database.
    expect(existsSync(join(f.userData, LEGACY_LOCAL_DATABASE_KEY_FILE))).toBe(true);
  });

  it('creates a wrapped key for a new installation without safeStorage', async () => {
    const f = fixture();
    const created = await resolveLocalDatabaseKey(f.options);
    expect(created.source).toBe('created');
    expect(created.key).toHaveLength(32);
    expect(f.legacy.encryptString).not.toHaveBeenCalled();
    expect((await resolveLocalDatabaseKey(f.options)).key.equals(created.key)).toBe(true);
  });

  it('falls back to the legacy key when the Keychain helper is unavailable', async () => {
    const f = fixture(new Error('briefing_memory_keychain_unavailable'));
    const original = Buffer.alloc(32, 9);
    f.writeLegacy(original);
    const resolved = await resolveLocalDatabaseKey(f.options);
    expect(resolved.source).toBe('legacy');
    expect(resolved.key.equals(original)).toBe(true);
    resolved.commit();
    expect(existsSync(join(f.userData, LOCAL_DATABASE_KEY_FILE))).toBe(false);
  });

  it('re-migrates a damaged wrapped key but never replaces one it cannot read', async () => {
    const f = fixture();
    const original = Buffer.alloc(32, 5);
    writeFileSync(
      join(f.userData, LOCAL_DATABASE_KEY_FILE),
      '{"version":2,"iv":"x","tag":"y","data":"z"}',
    );
    f.writeLegacy(original);
    const recovered = await resolveLocalDatabaseKey(f.options);
    expect(recovered.source).toBe('migrated');
    expect(recovered.key.equals(original)).toBe(true);

    const lonely = fixture();
    const damaged = '{"version":2,"iv":"x","tag":"y","data":"z"}';
    writeFileSync(join(lonely.userData, LOCAL_DATABASE_KEY_FILE), damaged);
    await expect(resolveLocalDatabaseKey(lonely.options)).rejects.toThrow(
      'invalid_local_database_key',
    );
    expect(readFileSync(join(lonely.userData, LOCAL_DATABASE_KEY_FILE), 'utf8')).toBe(damaged);
  });

  it('does not persist a migrated key when the database fails to open, and retries a wrapped key from legacy', async () => {
    const f = fixture();
    const original = Buffer.alloc(32, 4);
    f.writeLegacy(original);
    const failing = {
      openWithKey: vi.fn(() => {
        throw new Error('file is not a database');
      }),
    };
    await expect(openLocalDatabaseWithWrappedKey(failing, f.options)).rejects.toThrow(
      'file is not a database',
    );
    expect(existsSync(join(f.userData, LOCAL_DATABASE_KEY_FILE))).toBe(false);

    // A stale wrapped key from another key: the database rejects it, legacy is migrated again.
    const other = fixture();
    await resolveLocalDatabaseKey(other.options); // creates an unrelated wrapped key
    other.writeLegacy(original);
    const opened: Buffer[] = [];
    const database = {
      openWithKey: vi.fn((key: Buffer) => {
        if (!key.equals(original)) throw new Error('file is not a database');
        opened.push(Buffer.from(key));
      }),
    };
    await expect(openLocalDatabaseWithWrappedKey(database, other.options)).resolves.toBe(
      'migrated',
    );
    expect(opened).toHaveLength(1);
    expect((await resolveLocalDatabaseKey(other.options)).key.equals(original)).toBe(true);
  });
});
