import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCAL_DATABASE_KEY_FILE = 'local-key.v2.json';
export const LEGACY_LOCAL_DATABASE_KEY_FILE = 'local-key.bin';
const AAD = Buffer.from('gosu.local-database-key.v2');

export type LegacyKeyEncryption = {
  isEncryptionAvailable(): boolean;
  decryptString(sealed: Buffer): string;
  encryptString(plain: string): Buffer;
};

export type LocalDatabaseKeyResolution = {
  key: Buffer;
  /** Where the key came from, for a one-line startup log and tests. */
  source: 'wrapped' | 'migrated' | 'created' | 'legacy';
  /** Called once the database opened with this key; a migrated key is only persisted then. */
  commit(): void;
};

/**
 * GOSU is signed with a local certificate that has no Apple Team ID, so macOS binds Keychain
 * "Always Allow" for Electron safeStorage to one build and asks for the login password again after
 * every update. The database key is instead wrapped with a key derived from the Briefing system key,
 * which a small helper outside the app bundle reads from the Keychain without prompts. The legacy
 * safeStorage file is read only once to migrate and is kept, so an older build can still open the
 * database. Any failure of the helper falls back to the legacy path rather than locking data away.
 */
export async function resolveLocalDatabaseKey(options: {
  userData: string;
  systemKey: () => Promise<Buffer>;
  legacy: LegacyKeyEncryption;
  /** Retry after the wrapped key failed to open the database: migrate again from the legacy key. */
  ignoreWrapped?: boolean;
}): Promise<LocalDatabaseKeyResolution> {
  const wrappedPath = join(options.userData, LOCAL_DATABASE_KEY_FILE);
  const legacyPath = join(options.userData, LEGACY_LOCAL_DATABASE_KEY_FILE);
  let wrapping: Buffer | null = null;
  try {
    const system = await options.systemKey();
    if (system.length === 32) wrapping = deriveWrappingKey(system);
    system.fill(0);
  } catch {
    wrapping = null;
  }
  if (wrapping && !options.ignoreWrapped && existsSync(wrappedPath)) {
    try {
      const key = unwrap(readFileSync(wrappedPath, 'utf8'), wrapping);
      wrapping.fill(0);
      return { key, source: 'wrapped', commit: () => undefined };
    } catch {
      // A damaged or foreign wrapped key must not hide the legacy key; migrate again below.
    }
  }
  if (existsSync(legacyPath)) {
    const key = readLegacyKey(legacyPath, options.legacy);
    if (!wrapping) return { key, source: 'legacy', commit: () => undefined };
    const sealed = wrap(key, wrapping);
    wrapping.fill(0);
    return {
      key,
      source: 'migrated',
      commit: () => writeAtomically(wrappedPath, sealed),
    };
  }
  // A wrapped key that exists but cannot be read, with no legacy key left, must never be replaced:
  // a new key would make the existing database permanently unreadable.
  if (existsSync(wrappedPath)) {
    wrapping?.fill(0);
    throw new Error('invalid_local_database_key');
  }
  const key = randomBytes(32);
  if (!wrapping) {
    if (!options.legacy.isEncryptionAvailable())
      throw new Error('secure_local_storage_unavailable');
    writeFileSync(legacyPath, options.legacy.encryptString(key.toString('hex')), { mode: 0o600 });
    return { key, source: 'legacy', commit: () => undefined };
  }
  const sealed = wrap(key, wrapping);
  wrapping.fill(0);
  writeAtomically(wrappedPath, sealed);
  return { key, source: 'created', commit: () => undefined };
}

function deriveWrappingKey(system: Buffer) {
  return Buffer.from(hkdfSync('sha256', system, 'gosu.local-database-key', 'v2', 32));
}

function readLegacyKey(path: string, legacy: LegacyKeyEncryption) {
  if (!legacy.isEncryptionAvailable()) throw new Error('secure_local_storage_unavailable');
  const decrypted = legacy.decryptString(readFileSync(path)).trim();
  const key = decrypted.length > 0 ? Buffer.from(decrypted, 'hex') : Buffer.alloc(0);
  if (key.length !== 32) {
    key.fill(0);
    throw new Error('invalid_local_database_key');
  }
  return key;
}

function wrap(key: Buffer, wrapping: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', wrapping, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(key), cipher.final()]);
  return JSON.stringify({
    version: 2,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
}

function unwrap(raw: string, wrapping: Buffer) {
  const value = JSON.parse(raw) as {
    version?: unknown;
    iv?: unknown;
    tag?: unknown;
    data?: unknown;
  };
  if (
    value.version !== 2 ||
    typeof value.iv !== 'string' ||
    typeof value.tag !== 'string' ||
    typeof value.data !== 'string'
  )
    throw new Error('invalid_local_database_key');
  const decipher = createDecipheriv('aes-256-gcm', wrapping, Buffer.from(value.iv, 'base64'));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const key = Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]);
  if (key.length !== 32) {
    key.fill(0);
    throw new Error('invalid_local_database_key');
  }
  return key;
}

function writeAtomically(path: string, contents: string) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * Opens the database with the prompt-free wrapped key. If a wrapped key opens nothing (it should
 * not happen, but a stale file must not lock data away), the legacy key is migrated again.
 */
export async function openLocalDatabaseWithWrappedKey(
  database: { openWithKey(key: Buffer): void },
  options: Parameters<typeof resolveLocalDatabaseKey>[0],
) {
  const first = await resolveLocalDatabaseKey(options);
  try {
    database.openWithKey(first.key);
    first.commit();
    return first.source;
  } catch (error) {
    if (first.source !== 'wrapped') throw error;
    const retry = await resolveLocalDatabaseKey({ ...options, ignoreWrapped: true });
    database.openWithKey(retry.key);
    retry.commit();
    return retry.source;
  }
}
