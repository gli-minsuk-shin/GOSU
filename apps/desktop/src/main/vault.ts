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
}>;

type MaybePromise<T> = T | Promise<T>;

export type VaultRootStorage = Readonly<{
  loadRoot(): MaybePromise<string | null>;
  saveRoot(root: string): MaybePromise<void>;
}>;

export class VaultAccess {
  private state?: VaultState;

  constructor(private readonly storage?: VaultRootStorage) {}

  async choose(window: BrowserWindow) {
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose an Obsidian folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return this.connect(result.filePaths[0]);
  }

  async restore() {
    const root = await this.storage?.loadRoot();
    if (!root) return null;
    return this.connect(root, false);
  }

  async connect(root: string, persist = true) {
    const reader = await VaultReader.open(root);
    const files = await reader.listDocuments();
    const selection: VaultSelection = {
      id: sha256(`${reader.root}\0${reader.identityKey()}`),
      name: basename(reader.root).slice(0, 256) || 'Obsidian Vault',
      root: reader.root,
      files,
    };
    if (persist) await this.storage?.saveRoot(reader.root);
    this.state = { reader, selection };
    return structuredClone(selection);
  }

  current() {
    return this.state ? structuredClone(this.state.selection) : null;
  }

  descriptor() {
    const state = this.state;
    return state ? { id: state.selection.id, name: state.selection.name } : null;
  }

  matchesGrant(vaultId: string) {
    return this.state?.selection.id === vaultId;
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
    if (state.selection.id !== expectedVaultId) throw new Error('vault_grant_stale');
    return state;
  }

  private assertCurrent(expectedState: VaultState) {
    if (this.state !== expectedState) throw new Error('vault_grant_stale');
  }
}
