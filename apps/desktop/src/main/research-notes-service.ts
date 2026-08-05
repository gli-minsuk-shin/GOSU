import { createHash, randomBytes } from 'node:crypto';
import { basename, posix } from 'node:path';

import type { BrowserWindow } from 'electron';
import { z } from 'zod';

import type { LiteratureRecord } from '../shared/literature-contracts';
import type { LocalNotesVaultGrant } from '../shared/project-chat-contracts';
import {
  CreateResearchPaperNoteInputSchema,
  RESEARCH_NOTES_DEFAULT_FOLDERS,
  ReadResearchNoteAttachmentInputSchema,
  ReadResearchNoteInputSchema,
  ResearchNotesProjectInputSchema,
  ResearchNotesWorkspaceSchema,
  ResearchPaperNoteReceiptSchema,
  type CreateResearchPaperNoteInput,
  type ReadResearchNoteAttachmentInput,
  type ReadResearchNoteInput,
  type ResearchNotesAttentionCode,
  type ResearchNotesIpcErrorCode,
  type ResearchNotesProjectInput,
  type ResearchNotesWorkspace,
} from '../shared/research-notes-contracts';
import type { AgentVaultNoteChunk, AgentVaultNoteList } from '../shared/vault-contracts';
import type { ProjectRecord } from '../shared/workspace-contracts';
import {
  safeResearchNotesFolderName,
  ResearchNotesManagedFiles,
} from './research-notes-managed-files';
import {
  researchPaperNoteFileName,
  serializeLiteratureReviewMarkdown,
  serializePaperNoteMarkdown,
} from './research-notes-markdown';
import type { VaultAccess } from './vault';
import type { WorkspaceService } from './workspace-service';

const MAX_AGENT_NOTE_LIST = 100;
const MAX_AGENT_NOTE_CHARACTERS = 24_000;

export const ResearchNotesProjectLinkSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().uuid(),
    bindingId: z.string().regex(/^[0-9a-f]{64}$/u),
    vaultId: z.string().regex(/^[0-9a-f]{64}$/u),
    vaultName: z.string().trim().min(1).max(256),
    projectName: z.string().trim().min(1).max(120),
    folderName: z.string().trim().min(1).max(200),
    desiredFolderName: z.string().trim().min(1).max(200),
    status: z.enum(['ready', 'rename-pending']),
    attentionCode: z
      .enum([
        'folder_name_conflict',
        'folder_missing',
        'folder_ownership_changed',
        'vault_unavailable',
      ])
      .nullable(),
    lastLiteratureSyncAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ResearchNotesProjectLink = z.infer<typeof ResearchNotesProjectLinkSchema>;
type MaybePromise<T> = T | Promise<T>;

export type ResearchNotesStorage = Readonly<{
  loadProjectLink(projectId: string): ResearchNotesProjectLink | null;
  saveProjectLink(link: ResearchNotesProjectLink): void;
}>;

export type ResearchNotesLiteratureStorage = Readonly<{
  listLiteratureRecords(projectId: string): MaybePromise<readonly LiteratureRecord[]>;
  getLiteratureRecordsByIds(
    projectId: string,
    recordIds: readonly string[],
  ): MaybePromise<readonly LiteratureRecord[]>;
}>;

export class ResearchNotesServiceError extends Error {
  constructor(readonly code: Exclude<ResearchNotesIpcErrorCode, 'invalid_research_notes_input'>) {
    super(code);
    this.name = 'ResearchNotesServiceError';
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeProjectPath(path: string) {
  if (path.includes('\0') || path.includes('\\') || posix.isAbsolute(path)) {
    throw new ResearchNotesServiceError('research_notes_note_not_found');
  }
  const normalized = posix.normalize(path);
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized !== path
  ) {
    throw new ResearchNotesServiceError('research_notes_note_not_found');
  }
  return normalized;
}

function scopedAttachmentSource(notePath: string, rawSource: string) {
  const sourceWithoutSuffix = rawSource.split('#', 1)[0]!.split('?', 1)[0]!.trim();
  if (
    sourceWithoutSuffix === '' ||
    sourceWithoutSuffix.includes('\0') ||
    /^[a-z][a-z\d+.-]*:/iu.test(sourceWithoutSuffix) ||
    sourceWithoutSuffix.startsWith('//')
  ) {
    throw new ResearchNotesServiceError('research_notes_note_not_found');
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(sourceWithoutSuffix);
  } catch {
    throw new ResearchNotesServiceError('research_notes_note_not_found');
  }
  const projectTarget = decoded.startsWith('/')
    ? posix.normalize(decoded.slice(1))
    : posix.normalize(posix.join(posix.dirname(notePath), decoded));
  safeProjectPath(projectTarget);
  return {
    projectTarget,
    sourceFromNote: posix.relative(posix.dirname(notePath), projectTarget),
  };
}

function noteTitle(path: string) {
  return basename(path, '.md').slice(0, 256) || 'Untitled note';
}

function initialTemplates(project: ProjectRecord) {
  const frontmatter = (kind: string) =>
    `---\ngosu_schema_version: 1\ngosu_document_kind: ${JSON.stringify(kind)}\ngosu_project_id: ${JSON.stringify(project.id)}\n---\n`;
  return {
    'Experiments/Experiment Log.md': `${frontmatter('experiment-log')}\n# Experiment Log\n\n`,
    'Project Progress/Project Progress.md': `${frontmatter('project-progress')}\n# Project Progress\n\n`,
    'Idea Development/Idea Development.md': `${frontmatter('idea-development')}\n# Idea Development\n\n`,
    'Papers/Papers Index.md': `${frontmatter('papers-index')}\n# Papers\n\nPaper notes created from the Literature tab appear in this folder.\n`,
  } as const;
}

export class ResearchNotesService {
  constructor(
    private readonly dependencies: Readonly<{
      storage: ResearchNotesStorage;
      literature: ResearchNotesLiteratureStorage;
      workspace: WorkspaceService;
      vault: VaultAccess;
      now?: () => Date;
    }>,
  ) {}

  descriptor(projectId: string): LocalNotesVaultGrant | null {
    const link = this.dependencies.storage.loadProjectLink(projectId);
    if (!link || link.status !== 'ready' || !this.dependencies.vault.matchesGrant(link.vaultId)) {
      return null;
    }
    return { id: link.bindingId, name: 'Research Notes' };
  }

  matchesGrant(projectId: string, bindingId: string) {
    const link = this.dependencies.storage.loadProjectLink(projectId);
    return Boolean(
      link &&
      link.status === 'ready' &&
      link.bindingId === bindingId &&
      this.dependencies.vault.matchesGrant(link.vaultId),
    );
  }

  async validateGrant(projectId: string, expectedBindingId: string) {
    const { link } = await this.requireReadyLink(projectId, expectedBindingId);
    await this.dependencies.vault.validateGrant(link.vaultId);
    await this.assertOwnership(link);
  }

  async current(input: ResearchNotesProjectInput): Promise<ResearchNotesWorkspace | null> {
    const command = ResearchNotesProjectInputSchema.parse(input);
    const project = await this.requireActiveProject(command.projectId);
    if (!this.dependencies.vault.current()) return null;
    const ensured = await this.ensureProject(project);
    await this.syncLiterature(project.id).catch(() => undefined);
    return this.workspaceView(project, ensured.link);
  }

  async chooseVault(
    input: ResearchNotesProjectInput,
    window: BrowserWindow,
  ): Promise<ResearchNotesWorkspace | null> {
    const command = ResearchNotesProjectInputSchema.parse(input);
    const project = await this.requireActiveProject(command.projectId);
    const selection = await this.dependencies.vault.choose(window);
    if (!selection) return this.current(command);
    const ensured = await this.ensureProject(project, true);
    await this.syncLiterature(project.id).catch(() => undefined);
    return this.workspaceView(project, ensured.link);
  }

  async read(input: ReadResearchNoteInput) {
    const command = ReadResearchNoteInputSchema.parse(input);
    const project = await this.requireActiveProject(command.projectId);
    const { link } = await this.ensureProject(project);
    await this.assertOwnership(link);
    const path = safeProjectPath(command.path);
    try {
      const note = await this.dependencies.vault.readMarkdown(`${this.relativeRoot(link)}/${path}`);
      return { path, content: note.content };
    } catch (error) {
      if (error instanceof ResearchNotesServiceError) throw error;
      throw new ResearchNotesServiceError('research_notes_note_not_found');
    }
  }

  async readAttachment(input: ReadResearchNoteAttachmentInput) {
    const command = ReadResearchNoteAttachmentInputSchema.parse(input);
    const project = await this.requireActiveProject(command.projectId);
    const { link } = await this.ensureProject(project);
    await this.assertOwnership(link);
    const notePath = safeProjectPath(command.notePath);
    const source = scopedAttachmentSource(notePath, command.source);
    try {
      const attachment = await this.dependencies.vault.readAttachment({
        notePath: `${this.relativeRoot(link)}/${notePath}`,
        source: source.sourceFromNote,
      });
      return { ...attachment, path: source.projectTarget };
    } catch (error) {
      if (error instanceof ResearchNotesServiceError) throw error;
      throw new ResearchNotesServiceError('research_notes_note_not_found');
    }
  }

  async listForAgent(
    projectId: string,
    expectedBindingId: string,
    query = '',
    requestedLimit = 50,
  ): Promise<AgentVaultNoteList> {
    const { link } = await this.requireReadyLink(projectId, expectedBindingId);
    await this.assertOwnership(link);
    const files = await this.projectFiles(link);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const limit = Math.max(1, Math.min(Math.trunc(requestedLimit), MAX_AGENT_NOTE_LIST));
    const matches = files
      .map((path) => ({
        noteId: sha256(`${link.bindingId}\0${path}`),
        title: noteTitle(path),
      }))
      .filter(
        (note) =>
          normalizedQuery === '' || note.title.toLocaleLowerCase().includes(normalizedQuery),
      );
    return { notes: matches.slice(0, limit), truncated: matches.length > limit };
  }

  async readForAgent(
    projectId: string,
    expectedBindingId: string,
    noteId: string,
    requestedOffset = 0,
    requestedCharacters = MAX_AGENT_NOTE_CHARACTERS,
  ): Promise<AgentVaultNoteChunk> {
    const { link } = await this.requireReadyLink(projectId, expectedBindingId);
    await this.assertOwnership(link);
    const files = await this.projectFiles(link);
    const path = files.find((candidate) => sha256(`${link.bindingId}\0${candidate}`) === noteId);
    if (!path) throw new Error('vault_note_not_found');
    const note = await this.dependencies.vault.readMarkdown(`${this.relativeRoot(link)}/${path}`);
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
      title: noteTitle(path),
      content,
      contentSha256: sha256(note.content),
      offset,
      nextOffset,
      totalCharacters: note.content.length,
      truncated: nextOffset !== null,
    };
  }

  async syncLiterature(projectId: string) {
    const project = await this.requireActiveProject(projectId);
    const current = this.dependencies.vault.current();
    const existing = this.dependencies.storage.loadProjectLink(projectId);
    if (!current || !existing || existing.vaultId !== current.id) return null;
    const { link } = await this.ensureProject(project);
    if (link.status !== 'ready') return null;
    const records = await this.dependencies.literature.listLiteratureRecords(projectId);
    const writer = new ResearchNotesManagedFiles(current.root);
    await this.assertOwnership(link);
    await writer.writeManagedMarkdown(
      link.folderName,
      'Literature/Literature Review.md',
      serializeLiteratureReviewMarkdown(project, records),
      this.ownership(link),
    );
    await this.dependencies.vault.validateGrant(link.vaultId);
    const syncedAt = this.now().toISOString();
    const updated = ResearchNotesProjectLinkSchema.parse({
      ...link,
      lastLiteratureSyncAt: syncedAt,
      updatedAt: syncedAt,
    });
    this.dependencies.storage.saveProjectLink(updated);
    return syncedAt;
  }

  async createPaperNote(input: CreateResearchPaperNoteInput) {
    const command = CreateResearchPaperNoteInputSchema.parse(input);
    const project = await this.requireActiveProject(command.projectId);
    const [record] = await this.dependencies.literature.getLiteratureRecordsByIds(project.id, [
      command.recordId,
    ]);
    if (!record) throw new ResearchNotesServiceError('research_notes_record_not_found');
    const { link } = await this.ensureProject(project);
    if (link.status !== 'ready') {
      throw new ResearchNotesServiceError('research_notes_folder_unavailable');
    }
    await this.assertOwnership(link);
    const selection = this.requireVault(link.vaultId);
    const writer = new ResearchNotesManagedFiles(selection.root);
    const path = `Papers/${researchPaperNoteFileName(record)}`;
    const created = await writer.createUserMarkdown(
      link.folderName,
      path,
      serializePaperNoteMarkdown(project, record),
      this.ownership(link),
    );
    await this.dependencies.vault.validateGrant(link.vaultId);
    return ResearchPaperNoteReceiptSchema.parse({
      schemaVersion: 1,
      projectId: project.id,
      recordId: record.id,
      path,
      created,
    });
  }

  async syncReviewedPaper(record: LiteratureRecord) {
    return this.createPaperNote({ projectId: record.projectId, recordId: record.id });
  }

  async projectRenamed(project: ProjectRecord) {
    const link = this.dependencies.storage.loadProjectLink(project.id);
    if (!link) return;
    await this.reconcileName(project, link).catch(() => undefined);
  }

  private async workspaceView(
    project: ProjectRecord,
    inputLink: ResearchNotesProjectLink,
  ): Promise<ResearchNotesWorkspace> {
    const link = await this.reconcileName(project, inputLink).catch(() =>
      this.dependencies.storage.loadProjectLink(project.id),
    );
    if (!link) throw new ResearchNotesServiceError('research_notes_folder_unavailable');
    const files = await this.projectFiles(link).catch(() => []);
    return ResearchNotesWorkspaceSchema.parse({
      schemaVersion: 1,
      projectId: project.id,
      projectName: project.name,
      bindingId: link.bindingId,
      vaultId: link.vaultId,
      vaultName: link.vaultName,
      displayRoot: `${link.vaultName}/GOSU/${link.folderName}`,
      files,
      folders: [...RESEARCH_NOTES_DEFAULT_FOLDERS],
      status: link.status,
      attentionCode: link.attentionCode,
      lastLiteratureSyncAt: link.lastLiteratureSyncAt,
    });
  }

  private async ensureProject(project: ProjectRecord, replaceVault = false) {
    const selection = this.dependencies.vault.current();
    if (!selection) throw new ResearchNotesServiceError('research_notes_vault_not_selected');
    let link = this.dependencies.storage.loadProjectLink(project.id);
    if (link && link.vaultId === selection.id) {
      link = await this.reconcileName(project, link).catch(() =>
        this.dependencies.storage.loadProjectLink(project.id),
      );
      if (!link) throw new ResearchNotesServiceError('research_notes_folder_unavailable');
      return { link, created: false } as const;
    }
    if (replaceVault || link?.vaultId !== selection.id) link = null;

    const writer = new ResearchNotesManagedFiles(selection.root);
    await this.dependencies.vault.validateGrant(selection.id);
    const desired = safeResearchNotesFolderName(project.name);
    let folderName = desired;
    const desiredKind = await writer.folderKind(desired);
    if (desiredKind !== 'missing') {
      const marker = desiredKind === 'directory' ? await writer.readOwnership(desired) : null;
      if (marker?.projectId === project.id && marker.vaultId === selection.id) {
        folderName = desired;
        link = ResearchNotesProjectLinkSchema.parse({
          schemaVersion: 1,
          projectId: project.id,
          bindingId: marker.bindingId,
          vaultId: selection.id,
          vaultName: selection.name,
          projectName: project.name,
          folderName,
          desiredFolderName: folderName,
          status: 'ready',
          attentionCode: null,
          lastLiteratureSyncAt: null,
          createdAt: this.now().toISOString(),
          updatedAt: this.now().toISOString(),
        });
      } else {
        folderName = `${desired}--${project.id.slice(0, 8)}`;
        if ((await writer.folderKind(folderName)) !== 'missing') {
          throw new ResearchNotesServiceError('research_notes_folder_conflict');
        }
      }
    }
    const timestamp = this.now().toISOString();
    link ??= ResearchNotesProjectLinkSchema.parse({
      schemaVersion: 1,
      projectId: project.id,
      bindingId: randomBytes(32).toString('hex'),
      vaultId: selection.id,
      vaultName: selection.name,
      projectName: project.name,
      folderName,
      desiredFolderName: folderName,
      status: 'ready',
      attentionCode: null,
      lastLiteratureSyncAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await writer.createProjectWorkspace(
      link.folderName,
      this.ownership(link),
      RESEARCH_NOTES_DEFAULT_FOLDERS,
      initialTemplates(project),
    );
    await this.dependencies.vault.validateGrant(selection.id);
    this.dependencies.storage.saveProjectLink(link);
    return { link, created: true } as const;
  }

  private async reconcileName(project: ProjectRecord, link: ResearchNotesProjectLink) {
    const desired = safeResearchNotesFolderName(project.name);
    if (link.projectName === project.name && link.status === 'ready') {
      return link;
    }
    const pendingAt = this.now().toISOString();
    const pending = ResearchNotesProjectLinkSchema.parse({
      ...link,
      projectName: project.name,
      desiredFolderName: desired,
      status: 'rename-pending',
      attentionCode: null,
      updatedAt: pendingAt,
    });
    this.dependencies.storage.saveProjectLink(pending);
    try {
      const selection = this.requireVault(link.vaultId);
      const writer = new ResearchNotesManagedFiles(selection.root);
      await this.dependencies.vault.validateGrant(link.vaultId);
      await writer.renameProjectWorkspace(pending.folderName, desired, this.ownership(pending));
      await this.dependencies.vault.validateGrant(link.vaultId);
      const ready = ResearchNotesProjectLinkSchema.parse({
        ...pending,
        folderName: desired,
        desiredFolderName: desired,
        status: 'ready',
        attentionCode: null,
        updatedAt: this.now().toISOString(),
      });
      this.dependencies.storage.saveProjectLink(ready);
      return ready;
    } catch (error) {
      const attentionCode = renameAttention(error);
      const failed = ResearchNotesProjectLinkSchema.parse({
        ...pending,
        attentionCode,
        updatedAt: this.now().toISOString(),
      });
      this.dependencies.storage.saveProjectLink(failed);
      throw error;
    }
  }

  private async projectFiles(link: ResearchNotesProjectLink) {
    this.requireVault(link.vaultId);
    const prefix = `${this.relativeRoot(link)}/`;
    const files = await this.dependencies.vault.listMarkdown();
    return files.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
  }

  private async requireReadyLink(projectId: string, expectedBindingId: string) {
    const project = await this.requireActiveProject(projectId);
    const link = this.dependencies.storage.loadProjectLink(projectId);
    if (!link || link.bindingId !== expectedBindingId || link.status !== 'ready') {
      throw new Error('vault_grant_stale');
    }
    this.requireVault(link.vaultId);
    return { project, link };
  }

  private async assertOwnership(link: ResearchNotesProjectLink) {
    const selection = this.requireVault(link.vaultId);
    await this.dependencies.vault.validateGrant(link.vaultId);
    const writer = new ResearchNotesManagedFiles(selection.root);
    const marker = await writer.readOwnership(link.folderName);
    await this.dependencies.vault.validateGrant(link.vaultId);
    const ownership = this.ownership(link);
    if (
      !marker ||
      marker.projectId !== ownership.projectId ||
      marker.bindingId !== ownership.bindingId ||
      marker.vaultId !== ownership.vaultId
    ) {
      throw new ResearchNotesServiceError('research_notes_folder_unavailable');
    }
  }

  private ownership(link: ResearchNotesProjectLink) {
    return {
      schemaVersion: 1 as const,
      projectId: link.projectId,
      bindingId: link.bindingId,
      vaultId: link.vaultId,
      projectName: link.projectName,
    };
  }

  private relativeRoot(link: ResearchNotesProjectLink) {
    return `GOSU/${link.folderName}`;
  }

  private requireVault(expectedVaultId: string) {
    const selection = this.dependencies.vault.current();
    if (!selection) throw new ResearchNotesServiceError('research_notes_vault_not_selected');
    if (selection.id !== expectedVaultId) {
      throw new ResearchNotesServiceError('research_notes_vault_changed');
    }
    return selection;
  }

  private async requireActiveProject(projectId: string) {
    const snapshot = await this.dependencies.workspace.snapshot();
    const project = snapshot.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new ResearchNotesServiceError('research_notes_project_not_found');
    if (project.archivedAt || project.trashedAt) {
      throw new ResearchNotesServiceError('research_notes_project_unavailable');
    }
    return project;
  }

  private now() {
    return this.dependencies.now?.() ?? new Date();
  }
}

function renameAttention(error: unknown): ResearchNotesAttentionCode {
  const code = error instanceof Error ? error.message : '';
  if (code === 'research_notes_folder_conflict') return 'folder_name_conflict';
  if (code === 'research_notes_folder_ownership_changed') return 'folder_ownership_changed';
  if (code === 'research_notes_folder_unavailable') return 'folder_missing';
  return 'vault_unavailable';
}
