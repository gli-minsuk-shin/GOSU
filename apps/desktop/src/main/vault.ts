import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';

import { dialog, type BrowserWindow } from 'electron';

import type {
  AgentVaultNoteChunk,
  AgentVaultNoteList,
  ReadVaultAttachmentInput,
  VaultSelection,
} from '../shared/vault-contracts';
import { VaultReader } from './vault-reader';

const MAX_AGENT_NOTE_LIST = 100;
const MAX_AGENT_NOTE_CHARACTERS = 24_000;

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function displayTitle(path: string) {
  const extension = extname(path);
  return basename(path, extension).slice(0, 256) || 'Untitled note';
}

type VaultState = Readonly<{
  reader: VaultReader;
  selection: VaultSelection;
  /** The identity this vault had before 0.58.147, so grants saved then still match. */
  legacyId: string;
}>;

type MaybePromise<T> = T | Promise<T>;

export type VaultRootStorage = Readonly<{
  loadRoot(): MaybePromise<string | null>;
  saveRoot(root: string): MaybePromise<void>;
}>;

/** Why the saved vault could not be reopened, so the screen can say it instead of looking unset. */
export type VaultRestoreFailure = 'missing' | 'permission_denied' | 'unreadable';

function vaultRestoreFailure(error: unknown): VaultRestoreFailure {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing';
  if (error instanceof Error && error.message === 'vault_directory_required') return 'missing';
  if (code === 'EPERM' || code === 'EACCES') return 'permission_denied';
  return 'unreadable';
}

export class VaultAccess {
  private state?: VaultState;
  private restoring: Promise<VaultSelection | null> | undefined;
  private restoreFailure: VaultRestoreFailure | null = null;

  constructor(private readonly storage?: VaultRootStorage) {}

  async choose(window: BrowserWindow) {
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose an Obsidian folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return this.connect(result.filePaths[0]);
  }

  /**
   * Reconnects the saved vault. It runs at startup and again whenever something needs the vault
   * and it is not connected yet, so a slow startup or one failed attempt does not leave every
   * project looking as if no vault had ever been chosen. Concurrent callers share one attempt,
   * and a vault the user chose meanwhile is never replaced by the saved one.
   */
  async restore(): Promise<VaultSelection | null> {
    if (this.state) return structuredClone(this.state.selection);
    if (this.restoring) return this.restoring;
    const attempt = (async () => {
      const root = await this.storage?.loadRoot();
      if (!root) {
        this.restoreFailure = null;
        return null;
      }
      try {
        const opened = await this.open(root);
        this.state ??= opened;
        this.restoreFailure = null;
        return structuredClone(this.state.selection);
      } catch (error) {
        this.restoreFailure = vaultRestoreFailure(error);
        throw error;
      }
    })();
    this.restoring = attempt;
    try {
      return await attempt;
    } finally {
      if (this.restoring === attempt) this.restoring = undefined;
    }
  }

  /** Set while a saved vault exists but the last attempt to reopen it failed. */
  restoreError() {
    return this.state ? null : this.restoreFailure;
  }

  private async open(root: string): Promise<VaultState> {
    const reader = await VaultReader.open(root);
    const files = await reader.listDocuments();
    const selection: VaultSelection = {
      // The canonical path alone. Before 0.58.147 this also hashed the root's device and inode,
      // which macOS changes on its own: iCloud evicting and re-materializing Documents, a volume
      // remounting, a restore from a backup. Every one of those silently invalidated a saved
      // Research Notes grant and asked the user to authorize the same folder again. The device
      // and inode are still captured and re-checked during a read, which is what they are for:
      // noticing that the directory was swapped while GOSU was working in it.
      id: sha256(reader.root),
      name: basename(reader.root).slice(0, 256) || 'Obsidian Vault',
      root: reader.root,
      files,
    };
    return { reader, selection, legacyId: sha256(`${reader.root}\0${reader.identityKey()}`) };
  }

  async connect(root: string, persist = true) {
    const opened = await this.open(root);
    if (persist) await this.storage?.saveRoot(opened.reader.root);
    this.state = opened;
    this.restoreFailure = null;
    return structuredClone(opened.selection);
  }

  current() {
    return this.state ? structuredClone(this.state.selection) : null;
  }

  descriptor() {
    const state = this.state;
    return state ? { id: state.selection.id, name: state.selection.name } : null;
  }

  /** A grant saved before 0.58.147 keeps working while the root is still the same object. */
  matchesGrant(vaultId: string) {
    return this.state?.selection.id === vaultId || this.state?.legacyId === vaultId;
  }

  async validateGrant(expectedVaultId: string) {
    const state = this.requireGrant(expectedVaultId);
    await state.reader.validateRoot();
    this.assertCurrent(state);
  }

  async listMarkdown(signal?: AbortSignal) {
    return this.listDocuments(signal);
  }

  async listDocuments(signal?: AbortSignal) {
    const state = this.state;
    if (!state) return [];
    const files = await state.reader.listDocuments(signal);
    this.assertCurrent(state);
    return files;
  }

  async listForAgent(
    expectedVaultId: string,
    query = '',
    requestedLimit = 50,
  ): Promise<AgentVaultNoteList> {
    const state = this.requireGrant(expectedVaultId);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const limit = Math.max(1, Math.min(Math.trunc(requestedLimit), MAX_AGENT_NOTE_LIST));
    const files = await state.reader.listDocuments();
    this.assertCurrent(state);
    const matches = files
      .map((path) => ({
        noteId: sha256(`${expectedVaultId}\0${path}`),
        title: displayTitle(path),
      }))
      .filter(
        (note) =>
          normalizedQuery === '' || note.title.toLocaleLowerCase().includes(normalizedQuery),
      );
    return { notes: matches.slice(0, limit), truncated: matches.length > limit };
  }

  async readForAgent(
    expectedVaultId: string,
    noteId: string,
    requestedOffset = 0,
    requestedCharacters = MAX_AGENT_NOTE_CHARACTERS,
  ): Promise<AgentVaultNoteChunk> {
    const state = this.requireGrant(expectedVaultId);
    const files = await state.reader.listDocuments();
    this.assertCurrent(state);
    const path = files.find((candidate) => sha256(`${expectedVaultId}\0${candidate}`) === noteId);
    if (!path) throw new Error('vault_note_not_found');
    const note = await state.reader.readDocument(path);
    this.assertCurrent(state);
    const offset = Math.max(0, Math.min(Math.trunc(requestedOffset), note.content.length));
    const maxCharacters = Math.max(
      1,
      Math.min(Math.trunc(requestedCharacters), MAX_AGENT_NOTE_CHARACTERS),
    );
    const content = note.content.slice(offset, offset + maxCharacters);
    const nextOffset =
      offset + content.length < note.content.length ? offset + content.length : null;
    return {
      noteId,
      title: displayTitle(path),
      content,
      contentSha256: sha256(note.content),
      offset,
      nextOffset,
      totalCharacters: note.content.length,
      truncated: nextOffset !== null,
    };
  }

  async readMarkdown(relativePath: string, signal?: AbortSignal) {
    return this.readDocument(relativePath, signal);
  }

  async readDocument(relativePath: string, signal?: AbortSignal) {
    const state = this.requireState();
    const note = await state.reader.readDocument(relativePath, signal);
    this.assertCurrent(state);
    return note;
  }

  async readAttachment(input: ReadVaultAttachmentInput) {
    const state = this.requireState();
    const attachment = await state.reader.readAttachment(input.notePath, input.source);
    this.assertCurrent(state);
    return attachment;
  }

  private requireState() {
    if (!this.state) throw new Error('vault_not_selected');
    return this.state;
  }

  private requireGrant(expectedVaultId: string) {
    const state = this.requireState();
    // The same rule as `matchesGrant`, on purpose. Until 0.58.151 this compared only the current
    // id, so a grant saved under the previous formula passed the check the UI ran and failed every
    // read behind it.
    if (state.selection.id !== expectedVaultId && state.legacyId !== expectedVaultId)
      throw new Error('vault_grant_stale');
    return state;
  }

  private assertCurrent(expectedState: VaultState) {
    if (this.state !== expectedState) throw new Error('vault_grant_stale');
  }
}
