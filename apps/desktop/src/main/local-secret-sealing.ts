import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const MAGIC = Buffer.from('GOSU-SEAL-v2:');
const AAD = Buffer.from('gosu.local-secret-sealing.v2');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_MIGRATED_BYTES = 64 * 1024;

export type SecretStringStorage = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(sealed: Buffer): string;
};

export function isPromptFreeSealed(sealed: Buffer) {
  return sealed.length > MAGIC.length && sealed.subarray(0, MAGIC.length).equals(MAGIC);
}

/**
 * Drop-in replacement for Electron safeStorage for small GOSU secrets (Overleaf tokens, the lecture
 * manifest key). Like the database key (local-database-key.ts), secrets are sealed with a key derived
 * from the Briefing system key, which the Keychain helper reads without prompts; safeStorage asks
 * for the login password after every update of this locally signed app. Legacy safeStorage
 * ciphertext stays readable and is re-sealed once by migrateFiles. Without the helper, every call
 * falls through to safeStorage, as before.
 */
export class PromptFreeSecretSealing implements SecretStringStorage {
  private key: Buffer | null = null;

  constructor(private readonly legacy: SecretStringStorage) {}

  async load(systemKey: () => Promise<Buffer>) {
    try {
      const system = await systemKey();
      if (system.length === 32) {
        this.key = Buffer.from(hkdfSync('sha256', system, 'gosu.local-secret-sealing', 'v2', 32));
      }
      system.fill(0);
    } catch {
      this.key = null;
    }
    return this.key !== null;
  }

  isEncryptionAvailable() {
    return this.key !== null || this.legacy.isEncryptionAvailable();
  }

  encryptString(value: string) {
    if (!this.key) return this.legacy.encryptString(value);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(AAD);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), data]);
  }

  decryptString(sealed: Buffer) {
    if (!isPromptFreeSealed(sealed)) return this.legacy.decryptString(sealed);
    // A prompt-free secret never silently falls back to safeStorage: it would only prompt and fail.
    if (!this.key) throw new Error('local_secret_key_unavailable');
    const body = sealed.subarray(MAGIC.length);
    if (body.length < IV_BYTES + TAG_BYTES) throw new Error('local_secret_invalid');
    const decipher = createDecipheriv('aes-256-gcm', this.key, body.subarray(0, IV_BYTES));
    decipher.setAAD(AAD);
    decipher.setAuthTag(body.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(body.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Re-seals legacy safeStorage files in place so later reads need no Keychain prompt. Runs once at
   * startup; a file that cannot be read or written is left untouched and still works the old way.
   */
  async migrateFiles(paths: readonly string[]) {
    if (!this.key) return 0;
    let migrated = 0;
    for (const path of paths) {
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) continue;
        if (stat.size > MAX_MIGRATED_BYTES) continue;
        const sealed = await readFile(path);
        if (isPromptFreeSealed(sealed)) continue;
        const resealed = this.encryptString(this.legacy.decryptString(sealed));
        const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, resealed, { flag: 'wx', mode: 0o600 });
          await rename(temporary, path);
          migrated += 1;
        } finally {
          await rm(temporary, { force: true }).catch(() => undefined);
        }
      } catch {
        // Keep the legacy file; it still opens through safeStorage.
      }
    }
    return migrated;
  }
}
