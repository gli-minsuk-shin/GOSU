import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { OverleafGitTransportError, parseOverleafGitRemote } from './overleaf-git-transport';

const MAX_TOKEN_LENGTH = 2_048;
const MAX_SEALED_CREDENTIAL_BYTES = 64 * 1024;
const MAX_RECONCILIATION_ENTRIES = 4_096;
const OWNED_CREDENTIAL_REFERENCE =
  /^overleaf-git:([0-9a-f]{24}):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const LEGACY_CANONICAL_CREDENTIAL_REFERENCE = /^overleaf-git:([0-9a-f]{24})$/u;
export const OVERLEAF_LEGACY_UNOWNED_CREDENTIAL_REF = 'overleaf-git:legacy-unowned';

export type SecureStringStorage = Readonly<{
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}>;

type CredentialStoreOptions = Readonly<{
  rootDirectory: () => string;
  encryption: SecureStringStorage;
}>;

export type OverleafGitCredentialStage = Readonly<{
  credentialRef: string;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}>;

function validToken(token: string) {
  return (
    token.length >= 1 &&
    token.length <= MAX_TOKEN_LENGTH &&
    ![...token].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 32 || (code >= 127 && code <= 159);
    })
  );
}

function parseCredentialRef(credentialRef: string) {
  const owned = OWNED_CREDENTIAL_REFERENCE.exec(credentialRef);
  if (owned) {
    return {
      workspaceId: owned[1]!,
      fileName: `${owned[1]}.${owned[2]}.bin`,
      owned: true,
    } as const;
  }
  const legacy = LEGACY_CANONICAL_CREDENTIAL_REFERENCE.exec(credentialRef);
  if (legacy) {
    return {
      workspaceId: legacy[1]!,
      fileName: `${legacy[1]}.bin`,
      owned: true,
    } as const;
  }
  if (credentialRef === OVERLEAF_LEGACY_UNOWNED_CREDENTIAL_REF) {
    return { workspaceId: null, fileName: null, owned: false } as const;
  }
  throw new Error('overleaf_credential_reference_invalid');
}

export function overleafCredentialWorkspaceId(credentialRef: string) {
  return parseCredentialRef(credentialRef).workspaceId;
}

function credentialRefFromPendingName(fileName: string) {
  const match =
    /^([0-9a-f]{24})\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.bin\.pending$/u.exec(
      fileName,
    );
  return match ? `overleaf-git:${match[1]}:${match[2]}` : null;
}

/**
 * Owns GOSU-private Overleaf credentials. Each link gets an immutable credential reference, so
 * staging a replacement can never overwrite another binding or another app's Git credential.
 * Electron safeStorage protects ciphertext with the OS secure-storage backend.
 */
export class OverleafGitCredentialStore {
  constructor(private readonly options: CredentialStoreOptions) {}

  async stage(remoteValue: string, token: string): Promise<OverleafGitCredentialStage> {
    const remote = parseOverleafGitRemote(remoteValue);
    if (!validToken(token)) throw new Error('overleaf_token_invalid');
    const credentialRef = `overleaf-git:${remote.workspaceId}:${randomUUID()}`;
    const paths = this.pathsForReference(credentialRef);
    await this.writePending(paths, token);
    let finalized = false;
    return {
      credentialRef,
      commit: async () => {
        if (finalized) return;
        finalized = true;
        await rm(paths.pending, { force: true }).catch(() => {
          throw new Error('overleaf_keychain_unavailable');
        });
      },
      rollback: async () => {
        if (finalized) return;
        finalized = true;
        await Promise.all([
          rm(paths.credential, { force: true }),
          rm(paths.pending, { force: true }),
        ]).catch(() => {
          throw new Error('overleaf_keychain_unavailable');
        });
      },
    };
  }

  async readByReference(credentialRef: string, expectedWorkspaceId: string): Promise<string> {
    const parsed = parseCredentialRef(credentialRef);
    if (
      !parsed.owned ||
      !parsed.fileName ||
      !/^[0-9a-f]{24}$/u.test(expectedWorkspaceId) ||
      parsed.workspaceId !== expectedWorkspaceId
    ) {
      throw new OverleafGitTransportError('overleaf_git_auth_required');
    }
    this.requireEncryption();
    let sealed: Buffer;
    try {
      sealed = await readFile(join(this.options.rootDirectory(), parsed.fileName));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new OverleafGitTransportError('overleaf_git_auth_required');
      }
      throw new Error('overleaf_keychain_unavailable', { cause: error });
    }
    if (sealed.length < 1 || sealed.length > MAX_SEALED_CREDENTIAL_BYTES) {
      throw new Error('overleaf_keychain_unavailable');
    }
    try {
      const token = this.options.encryption.decryptString(sealed);
      if (!validToken(token)) throw new Error('overleaf_keychain_unavailable');
      return token;
    } catch (error) {
      throw new Error('overleaf_keychain_unavailable', { cause: error });
    }
  }

  async eraseByReference(credentialRef: string): Promise<void> {
    const parsed = parseCredentialRef(credentialRef);
    if (!parsed.owned || !parsed.fileName) return;
    const root = this.options.rootDirectory();
    await Promise.all([
      rm(join(root, parsed.fileName), { force: true }),
      rm(join(root, `${parsed.fileName}.pending`), { force: true }),
    ]).catch(() => {
      throw new Error('overleaf_keychain_unavailable');
    });
  }

  /**
   * Completes crash-interrupted stages after the encrypted database opens. Referenced pending
   * credentials are committed; unreferenced ones and bounded temporary files are removed.
   */
  async reconcilePending(referencedCredentialRefs: readonly string[]) {
    const root = this.options.rootDirectory();
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error('overleaf_keychain_unavailable', { cause: error });
    }
    if (entries.length > MAX_RECONCILIATION_ENTRIES) {
      throw new Error('overleaf_keychain_unavailable');
    }
    const referenced = new Set(referencedCredentialRefs);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = join(root, entry.name);
      if (entry.name.endsWith('.tmp')) {
        await rm(path, { force: true });
        continue;
      }
      const credentialRef = credentialRefFromPendingName(entry.name);
      if (!credentialRef) continue;
      if (!referenced.has(credentialRef)) {
        const parsed = parseCredentialRef(credentialRef);
        await rm(join(root, parsed.fileName!), { force: true });
      }
      await rm(path, { force: true });
    }
  }

  private async writePending(
    paths: Readonly<{ credential: string; pending: string; temporary: string }>,
    token: string,
  ) {
    this.requireEncryption();
    let sealed: Buffer;
    try {
      sealed = this.options.encryption.encryptString(token);
    } catch {
      throw new Error('overleaf_keychain_unavailable');
    }
    if (sealed.length < 1 || sealed.length > MAX_SEALED_CREDENTIAL_BYTES) {
      throw new Error('overleaf_keychain_unavailable');
    }
    await mkdir(this.options.rootDirectory(), { recursive: true, mode: 0o700 });
    try {
      await writeFile(paths.pending, '', { flag: 'wx', mode: 0o600 });
      await writeFile(paths.temporary, sealed, { flag: 'wx', mode: 0o600 });
      await rename(paths.temporary, paths.credential);
    } catch {
      await Promise.all([
        rm(paths.pending, { force: true }),
        rm(paths.temporary, { force: true }),
        rm(paths.credential, { force: true }),
      ]).catch(() => undefined);
      throw new Error('overleaf_keychain_unavailable');
    }
  }

  private pathsForReference(credentialRef: string) {
    const parsed = parseCredentialRef(credentialRef);
    if (!parsed.owned || !parsed.fileName) throw new Error('overleaf_credential_reference_invalid');
    const credential = join(this.options.rootDirectory(), parsed.fileName);
    return {
      credential,
      pending: `${credential}.pending`,
      temporary: join(this.options.rootDirectory(), `.${parsed.fileName}.${randomUUID()}.tmp`),
    };
  }

  private requireEncryption() {
    if (!this.options.encryption.isEncryptionAvailable()) {
      throw new Error('overleaf_keychain_unavailable');
    }
  }
}
