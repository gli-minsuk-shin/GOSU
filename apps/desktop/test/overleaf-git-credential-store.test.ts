import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OVERLEAF_LEGACY_UNOWNED_CREDENTIAL_REF,
  OverleafGitCredentialStore,
  type SecureStringStorage,
} from '../src/main/overleaf-git-credential-store';

const REMOTE = 'https://git.overleaf.com/0123456789abcdef01234567';
const WORKSPACE_ID = '0123456789abcdef01234567';

function encryptionFixture(): SecureStringStorage {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`sealed:${value}`, 'utf8'),
    decryptString: (value) => {
      const serialized = value.toString('utf8');
      if (!serialized.startsWith('sealed:')) throw new Error('invalid_ciphertext');
      return serialized.slice('sealed:'.length);
    },
  };
}

describe('Overleaf Git credential store', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'gosu-overleaf-credentials-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('stores only app-private encrypted bytes and can read the token back', async () => {
    const encryption = encryptionFixture();
    const store = new OverleafGitCredentialStore({
      rootDirectory: () => directory,
      encryption,
    });
    const token = 'private-overleaf-token';

    const stage = await store.stage(REMOTE, token);
    const credentialId = stage.credentialRef.split(':').at(-1)!;

    const ciphertextPath = join(directory, `0123456789abcdef01234567.${credentialId}.bin`);
    const ciphertext = await readFile(ciphertextPath);
    expect(ciphertext.toString('utf8')).toBe(`sealed:${token}`);
    expect(await store.readByReference(stage.credentialRef, WORKSPACE_ID)).toBe(token);
    await expect(access(`${ciphertextPath}.pending`)).resolves.toBeUndefined();
    await stage.commit();
    await expect(access(`${ciphertextPath}.pending`)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.stringify(store)).not.toContain(token);
  });

  it('mints immutable workspace credentials from the one personal token without exposing it', async () => {
    const store = new OverleafGitCredentialStore({
      rootDirectory: () => directory,
      encryption: encryptionFixture(),
    });

    expect(await store.personalTokenStatus()).toBe('not_configured');
    await expect(store.stageFromPersonal(REMOTE)).rejects.toMatchObject({
      code: 'overleaf_git_auth_required',
    });

    await store.savePersonalToken('first-personal-token');
    expect(await store.personalTokenStatus()).toBe('configured');
    const first = await store.stageFromPersonal(REMOTE);
    await first.commit();

    await store.savePersonalToken('replacement-personal-token');
    const second = await store.stageFromPersonal(REMOTE);
    await second.commit();
    expect(await store.readByReference(first.credentialRef, WORKSPACE_ID)).toBe(
      'first-personal-token',
    );
    expect(await store.readByReference(second.credentialRef, WORKSPACE_ID)).toBe(
      'replacement-personal-token',
    );

    await store.removePersonalToken();
    expect(await store.personalTokenStatus()).toBe('not_configured');
    await expect(store.stageFromPersonal(REMOTE)).rejects.toMatchObject({
      code: 'overleaf_git_auth_required',
    });
    expect(await store.readByReference(first.credentialRef, WORKSPACE_ID)).toBe(
      'first-personal-token',
    );
  });

  it('serializes personal-token status, save, and remove operations', async () => {
    const store = new OverleafGitCredentialStore({
      rootDirectory: () => directory,
      encryption: encryptionFixture(),
    });

    const firstSave = store.savePersonalToken('first-serialized-token');
    const observed = store.personalTokenStatus();
    const removed = store.removePersonalToken();
    const finalSave = store.savePersonalToken('final-serialized-token');
    await expect(observed).resolves.toBe('configured');
    await Promise.all([firstSave, removed, finalSave]);

    const staged = await store.stageFromPersonal(REMOTE);
    expect(await store.readByReference(staged.credentialRef, WORKSPACE_ID)).toBe(
      'final-serialized-token',
    );
  });

  it('preserves the old personal token when an atomic replacement cannot be encrypted', async () => {
    const encryption = encryptionFixture();
    const store = new OverleafGitCredentialStore({
      rootDirectory: () => directory,
      encryption: {
        ...encryption,
        encryptString: (value) => {
          if (value === 'replacement-that-fails') throw new Error('fixture_encrypt_failure');
          return encryption.encryptString(value);
        },
      },
    });
    await store.savePersonalToken('preserved-personal-token');

    await expect(store.savePersonalToken('replacement-that-fails')).rejects.toThrow(
      'overleaf_keychain_unavailable',
    );
    const staged = await store.stageFromPersonal(REMOTE);
    expect(await store.readByReference(staged.credentialRef, WORKSPACE_ID)).toBe(
      'preserved-personal-token',
    );
  });

  it('fails closed on corrupt, oversized, symlink, and non-regular personal token files', async () => {
    const store = new OverleafGitCredentialStore({
      rootDirectory: () => directory,
      encryption: encryptionFixture(),
    });
    const personalPath = join(directory, 'personal-token.bin');

    await writeFile(personalPath, 'corrupt-ciphertext');
    await expect(store.personalTokenStatus()).rejects.toThrow('overleaf_keychain_unavailable');
    await rm(personalPath, { force: true });

    await writeFile(personalPath, Buffer.alloc(64 * 1024 + 1, 1));
    await expect(store.personalTokenStatus()).rejects.toThrow('overleaf_keychain_unavailable');
    await rm(personalPath, { force: true });

    const target = join(directory, 'outside-token.bin');
    await writeFile(target, 'sealed:symlink-token');
    await symlink(target, personalPath);
    await expect(store.personalTokenStatus()).rejects.toThrow('overleaf_keychain_unavailable');
    await expect(store.savePersonalToken('must-not-follow-symlink')).rejects.toThrow(
      'overleaf_keychain_unavailable',
    );
    await rm(personalPath, { force: true });

    await mkdir(personalPath);
    await expect(store.personalTokenStatus()).rejects.toThrow('overleaf_keychain_unavailable');
    await expect(store.savePersonalToken('must-not-replace-directory')).rejects.toThrow(
      'overleaf_keychain_unavailable',
    );
  });

  it('reconciles personal-token temporary files without deleting the configured token', async () => {
    const store = new OverleafGitCredentialStore({
      rootDirectory: () => directory,
      encryption: encryptionFixture(),
    });
    await store.savePersonalToken('reconciled-personal-token');
    await writeFile(join(directory, '.personal-token.bin.crash.tmp'), 'partial');

    await store.reconcilePending([]);

    expect(await store.personalTokenStatus()).toBe('configured');
    expect(await readdir(directory)).toContain('personal-token.bin');
    expect(await readdir(directory)).not.toContain('.personal-token.bin.crash.tmp');
  });

  it('never overwrites an existing binding credential when a replacement stage rolls back', async () => {
    const store = new OverleafGitCredentialStore({
      rootDirectory: () => directory,
      encryption: encryptionFixture(),
    });
    const previous = await store.stage(REMOTE, 'previous-fixture-token');
    await previous.commit();

    const replacement = await store.stage(REMOTE, 'replacement-fixture-token');
    expect(await store.readByReference(replacement.credentialRef, WORKSPACE_ID)).toBe(
      'replacement-fixture-token',
    );
    await replacement.rollback();

    expect(await store.readByReference(previous.credentialRef, WORKSPACE_ID)).toBe(
      'previous-fixture-token',
    );
    await expect(
      store.readByReference(replacement.credentialRef, WORKSPACE_ID),
    ).rejects.toMatchObject({ code: 'overleaf_git_auth_required' });
  });

  it('erases only the exact GOSU-owned workspace file and safely acknowledges legacy unowned rows', async () => {
    const store = new OverleafGitCredentialStore({
      rootDirectory: () => directory,
      encryption: encryptionFixture(),
    });
    const first = await store.stage(REMOTE, 'first-fixture-token');
    const second = await store.stage(REMOTE, 'second-fixture-token');
    await Promise.all([first.commit(), second.commit()]);

    await store.eraseByReference(OVERLEAF_LEGACY_UNOWNED_CREDENTIAL_REF);
    await store.eraseByReference(first.credentialRef);
    expect(await store.readByReference(second.credentialRef, WORKSPACE_ID)).toBe(
      'second-fixture-token',
    );
    await expect(store.readByReference(first.credentialRef, WORKSPACE_ID)).rejects.toMatchObject({
      code: 'overleaf_git_auth_required',
    });
  });

  it('recovers referenced pending stages and removes unreferenced crash orphans', async () => {
    const store = new OverleafGitCredentialStore({
      rootDirectory: () => directory,
      encryption: encryptionFixture(),
    });
    const referenced = await store.stage(REMOTE, 'referenced-fixture-token');
    const orphan = await store.stage(REMOTE, 'orphan-fixture-token');

    await store.reconcilePending([referenced.credentialRef]);

    expect(await store.readByReference(referenced.credentialRef, WORKSPACE_ID)).toBe(
      'referenced-fixture-token',
    );
    await expect(store.readByReference(orphan.credentialRef, WORKSPACE_ID)).rejects.toMatchObject({
      code: 'overleaf_git_auth_required',
    });
  });

  it('never releases a credential to a different Overleaf workspace', async () => {
    const store = new OverleafGitCredentialStore({
      rootDirectory: () => directory,
      encryption: encryptionFixture(),
    });
    const stage = await store.stage(REMOTE, 'workspace-bound-token');
    await stage.commit();

    await expect(
      store.readByReference(stage.credentialRef, '111111111111111111111111'),
    ).rejects.toMatchObject({ code: 'overleaf_git_auth_required' });
  });

  it('rejects unsafe tokens, embedded credential URLs, and unavailable encryption', async () => {
    const encryptString = vi.fn((value: string) => Buffer.from(value));
    const store = new OverleafGitCredentialStore({
      rootDirectory: () => directory,
      encryption: {
        isEncryptionAvailable: () => false,
        encryptString,
        decryptString: (value) => value.toString('utf8'),
      },
    });

    await expect(store.stage(REMOTE, 'bad token')).rejects.toThrow('overleaf_token_invalid');
    await expect(
      store.stage('https://git:secret@git.overleaf.com/0123456789abcdef01234567', 'valid-token'),
    ).rejects.toThrow('overleaf_git_url_invalid');
    await expect(store.stage(REMOTE, 'valid-token')).rejects.toThrow(
      'overleaf_keychain_unavailable',
    );
    expect(encryptString).not.toHaveBeenCalled();
  });
});
