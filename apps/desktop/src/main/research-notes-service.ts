import { createHash, randomBytes } from 'node:crypto';
import { basename, posix } from 'node:path';

import type { BrowserWindow } from 'electron';
import { z } from 'zod';

import type { LiteratureRecord } from '../shared/literature-contracts';
import type {
  LectureStudioArtifact,
  PendingLectureRevisionArtifacts,
} from '../shared/lecture-studio-contracts';
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
  RESEARCH_NOTES_MAX_USER_MARKDOWN_BYTES,
  RESEARCH_NOTES_MAX_PENDING_BUNDLE_SCAN,
  safeResearchNotesFolderName,
  ResearchNotesManagedFiles,
  type ResearchNotesMarkdownBundleFile,
  type ResearchNotesPendingMarkdownBundle,
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
const MAX_AGENT_MARKDOWN_CHARACTERS = 1_000_000;
const MAX_AGENT_MARKDOWN_TITLE_BYTES = 180;
const AGENT_MARKDOWN_ARTIFACT_ID_CHARACTERS = 16;
const MAX_PENDING_LECTURE_PROJECT_SCAN = 32;
const LECTURE_NOTES_FILE_NAME = 'Lecture Notes.md';
const LECTURE_SLIDES_FILE_NAME = 'Slides.md';

export function researchNotesAgentMarkdownArtifactId(
  projectId: string,
  bindingId: string,
  idempotencyKey: string,
) {
  return sha256(`${projectId}\0${bindingId}\0${idempotencyKey}`).slice(
    0,
    AGENT_MARKDOWN_ARTIFACT_ID_CHARACTERS,
  );
}

export const ResearchNotesAgentMarkdownCategorySchema = z.enum([
  'literature',
  'papers',
  'experiments',
  'project-progress',
  'idea-development',
  'lectures',
]);

export type ResearchNotesAgentMarkdownCategory = z.infer<
  typeof ResearchNotesAgentMarkdownCategorySchema
>;

export const SaveResearchNoteForAgentInputSchema = z
  .object({
    category: ResearchNotesAgentMarkdownCategorySchema,
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !value.includes('\0'), 'title_contains_nul'),
    content: z
      .string()
      .min(1)
      .max(MAX_AGENT_MARKDOWN_CHARACTERS)
      .refine((value) => !value.includes('\0'), 'content_contains_nul')
      .refine(
        (value) => Buffer.byteLength(value, 'utf8') <= RESEARCH_NOTES_MAX_USER_MARKDOWN_BYTES,
        'content_exceeds_markdown_byte_limit',
      ),
    idempotencyKey: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .refine((value) => !value.includes('\0'), 'idempotency_key_contains_nul'),
  })
  .strict();

export type SaveResearchNoteForAgentInput = z.input<typeof SaveResearchNoteForAgentInputSchema>;

export const ResearchNotesAgentMarkdownReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().uuid(),
    category: ResearchNotesAgentMarkdownCategorySchema,
    path: z.string().trim().min(1).max(1_000),
    created: z.boolean(),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    artifactId: z.string().regex(/^[0-9a-f]{16}$/u),
  })
  .strict()
  .superRefine((receipt, context) => {
    let path: string;
    try {
      path = safeProjectPath(receipt.path);
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'path_must_be_project_relative',
      });
      return;
    }
    const expectedPrefix = `${RESEARCH_NOTES_AGENT_CATEGORY_FOLDERS[receipt.category]}/`;
    if (!path.startsWith(expectedPrefix) || !path.endsWith('.md')) {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'path_must_match_category_folder',
      });
    }
  });

export type ResearchNotesAgentMarkdownReceipt = z.infer<
  typeof ResearchNotesAgentMarkdownReceiptSchema
>;

export const RecoverResearchNoteForAgentInputSchema = z
  .object({
    category: ResearchNotesAgentMarkdownCategorySchema,
    artifactId: z.string().regex(/^[0-9a-f]{16}$/u),
    expectedContentSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

export type RecoverResearchNoteForAgentInput = z.infer<
  typeof RecoverResearchNoteForAgentInputSchema
>;

export type SaveLectureRevisionArtifactsInput = Readonly<{
  outputProjectId: string;
  studioId: string;
  studioTitle: string;
  revision: number;
  attemptId: string;
  sourceManifestSha256: string;
  lectureNotesMarkdown: string;
  slidesMarkdown: string;
  createdAt: string;
}>;

const RESEARCH_NOTES_AGENT_CATEGORY_FOLDERS = {
  literature: 'Literature',
  papers: 'Papers',
  experiments: 'Experiments',
  'project-progress': 'Project Progress',
  'idea-development': 'Idea Development',
  lectures: 'Lecture Notes & Slides',
} as const satisfies Record<
  ResearchNotesAgentMarkdownCategory,
  (typeof RESEARCH_NOTES_DEFAULT_FOLDERS)[number]
>;

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

function safeAgentMarkdownFileStem(title: string) {
  const normalized = title
    .normalize('NFKC')
    .replace(/\.md$/iu, '')
    .replace(/[\p{C}/\\:<>?"*|#^`_$~!(){}]/gu, ' ')
    .replaceAll('[', ' ')
    .replaceAll(']', ' ')
    .replace(/\s+/gu, ' ')
    .replace(/^[. ]+|[. ]+$/gu, '')
    .trim();
  const fallback = normalized || 'Research Note';
  let result = '';
  for (const character of fallback) {
    if (Buffer.byteLength(result + character, 'utf8') > MAX_AGENT_MARKDOWN_TITLE_BYTES) break;
    result += character;
  }
  return result || 'Research Note';
}

function lectureRevisionBundleId(input: SaveLectureRevisionArtifactsInput, bindingId: string) {
  return sha256(
    [
      input.outputProjectId,
      bindingId,
      input.studioId,
      String(input.revision),
      input.sourceManifestSha256,
    ].join('\0'),
  );
}

function pendingRevisionJournal(
  pending: PendingLectureRevisionArtifacts,
): ResearchNotesPendingMarkdownBundle {
  const relativeBundlePath = safeProjectPath(pending.relativeBundlePath);
  const notes = pending.artifacts.find((artifact) => artifact.kind === 'lecture-notes');
  const slides = pending.artifacts.find((artifact) => artifact.kind === 'slides');
  if (
    !notes ||
    !slides ||
    notes.relativePath !== `${relativeBundlePath}/${LECTURE_NOTES_FILE_NAME}` ||
    slides.relativePath !== `${relativeBundlePath}/${LECTURE_SLIDES_FILE_NAME}`
  ) {
    throw new ResearchNotesServiceError('research_notes_folder_conflict');
  }
  return {
    schemaVersion: 1,
    kind: 'lecture-revision',
    projectId: pending.outputProjectId,
    bindingId: pending.bindingId,
    vaultId: pending.vaultId,
    bundleId: pending.bundleId,
    studioId: pending.studioId,
    revision: pending.revision,
    attemptId: pending.attemptId,
    sourceManifestSha256: pending.sourceManifestSha256,
    files: [
      { name: LECTURE_NOTES_FILE_NAME, contentSha256: notes.contentSha256 },
      { name: LECTURE_SLIDES_FILE_NAME, contentSha256: slides.contentSha256 },
    ],
  };
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
  private pendingLectureProjectScanCursor = 0;

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

  async saveMarkdownForAgent(
    projectId: string,
    expectedBindingId: string,
    input: SaveResearchNoteForAgentInput,
  ): Promise<ResearchNotesAgentMarkdownReceipt> {
    const command = SaveResearchNoteForAgentInputSchema.parse(input);
    const { project, link } = await this.requireReadyLink(projectId, expectedBindingId);
    await this.assertOwnership(link);
    const selection = this.requireVault(link.vaultId);
    const artifactId = researchNotesAgentMarkdownArtifactId(
      project.id,
      link.bindingId,
      command.idempotencyKey,
    );
    const folder = RESEARCH_NOTES_AGENT_CATEGORY_FOLDERS[command.category];
    const path = `${folder}/${safeAgentMarkdownFileStem(command.title)}--${artifactId}.md`;
    const matchingArtifactPaths = (await this.projectFiles(link)).filter((candidate) =>
      candidate.endsWith(`--${artifactId}.md`),
    );
    if (
      matchingArtifactPaths.length > 1 ||
      (matchingArtifactPaths[0] !== undefined && matchingArtifactPaths[0] !== path)
    ) {
      throw new ResearchNotesServiceError('research_notes_folder_conflict');
    }
    const writer = new ResearchNotesManagedFiles(selection.root);
    let created: boolean;
    try {
      created = await writer.createUserMarkdown(
        link.folderName,
        path,
        command.content,
        this.ownership(link),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        if (
          error instanceof Error &&
          (error.message === 'research_notes_vault_changed' ||
            error.message === 'research_notes_folder_ownership_changed')
        ) {
          throw new ResearchNotesServiceError('research_notes_save_commit_uncertain');
        }
        throw error;
      }
      created = false;
    }
    if (!created) {
      const existing = await this.dependencies.vault.readMarkdown(
        `${this.relativeRoot(link)}/${path}`,
      );
      if (existing.content !== command.content) {
        throw new ResearchNotesServiceError('research_notes_folder_conflict');
      }
    }
    try {
      await this.confirmAgentMarkdownWrite(project.id, expectedBindingId, link);
      const verified = await this.dependencies.vault.readMarkdown(
        `${this.relativeRoot(link)}/${path}`,
      );
      if (verified.content !== command.content) {
        throw new ResearchNotesServiceError('research_notes_save_commit_uncertain');
      }
      await this.confirmAgentMarkdownWrite(project.id, expectedBindingId, link);
    } catch {
      throw new ResearchNotesServiceError('research_notes_save_commit_uncertain');
    }
    return ResearchNotesAgentMarkdownReceiptSchema.parse({
      schemaVersion: 1,
      projectId: project.id,
      category: command.category,
      path,
      created,
      contentSha256: sha256(command.content),
      artifactId,
    });
  }

  async saveRevisionArtifacts(
    input: SaveLectureRevisionArtifactsInput,
  ): Promise<readonly [LectureStudioArtifact, LectureStudioArtifact]> {
    const descriptor = this.descriptor(input.outputProjectId);
    if (!descriptor) {
      throw new ResearchNotesServiceError('research_notes_vault_not_selected');
    }
    const { link } = await this.requireReadyLink(input.outputProjectId, descriptor.id);
    await this.assertOwnership(link);
    const selection = this.requireVault(link.vaultId);
    const bundle = this.lectureRevisionBundle(input, link);
    const writer = new ResearchNotesManagedFiles(selection.root);
    await writer.createUserMarkdownBundle(
      link.folderName,
      bundle.relativeBundlePath,
      bundle.files,
      bundle.journal,
      this.ownership(link),
    );
    await this.confirmAgentMarkdownWrite(input.outputProjectId, descriptor.id, link);
    return bundle.artifacts;
  }

  async assertRevisionDestination(outputProjectId: string) {
    const descriptor = this.descriptor(outputProjectId);
    if (!descriptor) {
      throw new ResearchNotesServiceError('research_notes_vault_not_selected');
    }
    const { link } = await this.requireReadyLink(outputProjectId, descriptor.id);
    await this.assertOwnership(link);
    const selection = this.requireVault(link.vaultId);
    await new ResearchNotesManagedFiles(selection.root).assertUserMarkdownBundleDestination(
      link.folderName,
      'Lecture Notes & Slides',
      this.ownership(link),
    );
    await this.confirmAgentMarkdownWrite(outputProjectId, descriptor.id, link);
  }

  async listPendingRevisionArtifacts(
    requestedLimit = RESEARCH_NOTES_MAX_PENDING_BUNDLE_SCAN,
  ): Promise<readonly PendingLectureRevisionArtifacts[]> {
    const selection = this.dependencies.vault.current();
    if (!selection) return [];
    const limit = Math.max(
      1,
      Math.min(Math.trunc(requestedLimit), RESEARCH_NOTES_MAX_PENDING_BUNDLE_SCAN),
    );
    const snapshot = await this.dependencies.workspace.snapshot();
    const pending: PendingLectureRevisionArtifacts[] = [];
    const projects = snapshot.projects;
    const projectCount = Math.min(projects.length, MAX_PENDING_LECTURE_PROJECT_SCAN);
    const start =
      projects.length === 0 ? 0 : this.pendingLectureProjectScanCursor % projects.length;
    for (let offset = 0; offset < projectCount; offset += 1) {
      const project = projects[(start + offset) % projects.length]!;
      if (pending.length >= limit) break;
      const link = this.dependencies.storage.loadProjectLink(project.id);
      if (
        !link ||
        link.status !== 'ready' ||
        link.vaultId !== selection.id ||
        !this.dependencies.vault.matchesGrant(link.vaultId)
      ) {
        continue;
      }
      try {
        await this.assertOwnership(link);
        const entries = await new ResearchNotesManagedFiles(
          selection.root,
        ).listPendingUserMarkdownBundles(
          link.folderName,
          'Lecture Notes & Slides',
          this.ownership(link),
          limit - pending.length,
        );
        for (const entry of entries) {
          const notes = entry.journal.files.find((file) => file.name === LECTURE_NOTES_FILE_NAME);
          const slides = entry.journal.files.find((file) => file.name === LECTURE_SLIDES_FILE_NAME);
          if (!notes || !slides) continue;
          pending.push({
            outputProjectId: entry.journal.projectId,
            bindingId: entry.journal.bindingId,
            vaultId: entry.journal.vaultId,
            bundleId: entry.journal.bundleId,
            relativeBundlePath: entry.relativeBundlePath,
            studioId: entry.journal.studioId,
            revision: entry.journal.revision,
            attemptId: entry.journal.attemptId,
            sourceManifestSha256: entry.journal.sourceManifestSha256,
            artifacts: [
              {
                kind: 'lecture-notes',
                relativePath: `${entry.relativeBundlePath}/${LECTURE_NOTES_FILE_NAME}`,
                contentSha256: notes.contentSha256,
              },
              {
                kind: 'slides',
                relativePath: `${entry.relativeBundlePath}/${LECTURE_SLIDES_FILE_NAME}`,
                contentSha256: slides.contentSha256,
              },
            ],
          });
        }
      } catch {
        // Recovery is best effort per project; never let one unavailable folder block another.
      }
    }
    if (projects.length > 0) {
      this.pendingLectureProjectScanCursor = (start + projectCount) % projects.length;
    }
    return pending;
  }

  async confirmPendingRevisionArtifacts(pending: PendingLectureRevisionArtifacts) {
    const link = await this.requirePendingRevisionLink(pending);
    const selection = this.requireVault(link.vaultId);
    await new ResearchNotesManagedFiles(selection.root).confirmUserMarkdownBundle(
      link.folderName,
      pending.relativeBundlePath,
      pendingRevisionJournal(pending),
      this.ownership(link),
    );
    await this.assertOwnership(link);
  }

  async rollbackPendingRevisionArtifacts(pending: PendingLectureRevisionArtifacts) {
    const link = await this.requirePendingRevisionLink(pending);
    const selection = this.requireVault(link.vaultId);
    await new ResearchNotesManagedFiles(selection.root).rollbackUserMarkdownBundle(
      link.folderName,
      pending.relativeBundlePath,
      pendingRevisionJournal(pending),
      this.ownership(link),
    );
    await this.assertOwnership(link);
  }

  async confirmRevisionArtifacts(input: SaveLectureRevisionArtifactsInput) {
    const descriptor = this.descriptor(input.outputProjectId);
    if (!descriptor) {
      throw new ResearchNotesServiceError('research_notes_vault_not_selected');
    }
    const { link } = await this.requireReadyLink(input.outputProjectId, descriptor.id);
    await this.assertOwnership(link);
    const selection = this.requireVault(link.vaultId);
    const bundle = this.lectureRevisionBundle(input, link);
    await new ResearchNotesManagedFiles(selection.root).confirmUserMarkdownBundle(
      link.folderName,
      bundle.relativeBundlePath,
      bundle.journal,
      this.ownership(link),
    );
    await this.confirmAgentMarkdownWrite(input.outputProjectId, descriptor.id, link);
  }

  async rollbackRevisionArtifacts(input: SaveLectureRevisionArtifactsInput) {
    const descriptor = this.descriptor(input.outputProjectId);
    if (!descriptor) {
      throw new ResearchNotesServiceError('research_notes_vault_not_selected');
    }
    const { link } = await this.requireReadyLink(input.outputProjectId, descriptor.id);
    await this.assertOwnership(link);
    const selection = this.requireVault(link.vaultId);
    const bundle = this.lectureRevisionBundle(input, link);
    await new ResearchNotesManagedFiles(selection.root).rollbackUserMarkdownBundle(
      link.folderName,
      bundle.relativeBundlePath,
      bundle.journal,
      this.ownership(link),
    );
    await this.confirmAgentMarkdownWrite(input.outputProjectId, descriptor.id, link);
  }

  async recoverMarkdownForAgent(
    projectId: string,
    expectedBindingId: string,
    input: RecoverResearchNoteForAgentInput,
  ): Promise<ResearchNotesAgentMarkdownReceipt | null> {
    const command = RecoverResearchNoteForAgentInputSchema.parse(input);
    const { project, link } = await this.requireReadyLink(projectId, expectedBindingId);
    await this.assertOwnership(link);
    const suffix = `--${command.artifactId}.md`;
    const matches = (await this.projectFiles(link)).filter((candidate) =>
      candidate.endsWith(suffix),
    );
    if (matches.length === 0) return null;
    if (matches.length !== 1) {
      throw new ResearchNotesServiceError('research_notes_save_commit_uncertain');
    }
    const path = matches[0]!;
    const expectedPrefix = `${RESEARCH_NOTES_AGENT_CATEGORY_FOLDERS[command.category]}/`;
    if (!path.startsWith(expectedPrefix)) {
      throw new ResearchNotesServiceError('research_notes_save_commit_uncertain');
    }
    const note = await this.dependencies.vault.readMarkdown(`${this.relativeRoot(link)}/${path}`);
    if (sha256(note.content) !== command.expectedContentSha256) {
      throw new ResearchNotesServiceError('research_notes_save_commit_uncertain');
    }
    await this.confirmAgentMarkdownWrite(project.id, expectedBindingId, link);
    return ResearchNotesAgentMarkdownReceiptSchema.parse({
      schemaVersion: 1,
      projectId: project.id,
      category: command.category,
      path,
      created: false,
      contentSha256: command.expectedContentSha256,
      artifactId: command.artifactId,
    });
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

  private lectureRevisionBundle(
    input: SaveLectureRevisionArtifactsInput,
    link: ResearchNotesProjectLink,
  ) {
    if (
      !Number.isInteger(input.revision) ||
      input.revision < 1 ||
      !/^[0-9a-f]{64}$/u.test(input.sourceManifestSha256) ||
      !/^\S+$/u.test(input.attemptId)
    ) {
      throw new ResearchNotesServiceError('research_notes_folder_conflict');
    }
    const wrap = (kind: 'lecture-notes' | 'slides', markdown: string) => {
      const body = markdown.trim();
      if (!body) throw new ResearchNotesServiceError('research_notes_folder_conflict');
      return `---\ngosu_schema_version: 1\ngosu_document_kind: ${JSON.stringify(kind)}\ngosu_lecture_studio_id: ${JSON.stringify(input.studioId)}\ngosu_lecture_revision: ${input.revision}\ngosu_source_manifest_sha256: ${JSON.stringify(input.sourceManifestSha256)}\ngosu_generated_at: ${JSON.stringify(input.createdAt)}\n---\n\n${body}\n`;
    };
    const notesContent = wrap('lecture-notes', input.lectureNotesMarkdown);
    const slidesContent = wrap('slides', input.slidesMarkdown);
    const bundleId = lectureRevisionBundleId(input, link.bindingId);
    const revisionLabel = String(input.revision).padStart(4, '0');
    const folderName = `${safeAgentMarkdownFileStem(input.studioTitle)}--r${revisionLabel}--${bundleId.slice(0, AGENT_MARKDOWN_ARTIFACT_ID_CHARACTERS)}`;
    const relativeBundlePath = safeProjectPath(`Lecture Notes & Slides/${folderName}`);
    const files: readonly ResearchNotesMarkdownBundleFile[] = [
      { name: LECTURE_NOTES_FILE_NAME, content: notesContent },
      { name: LECTURE_SLIDES_FILE_NAME, content: slidesContent },
    ];
    const journal: ResearchNotesPendingMarkdownBundle = {
      schemaVersion: 1,
      kind: 'lecture-revision',
      projectId: input.outputProjectId,
      bindingId: link.bindingId,
      vaultId: link.vaultId,
      bundleId,
      studioId: input.studioId,
      revision: input.revision,
      attemptId: input.attemptId,
      sourceManifestSha256: input.sourceManifestSha256,
      files: files.map((file) => ({ name: file.name, contentSha256: sha256(file.content) })),
    };
    const artifacts: readonly [LectureStudioArtifact, LectureStudioArtifact] = [
      {
        kind: 'lecture-notes',
        relativePath: `${relativeBundlePath}/${LECTURE_NOTES_FILE_NAME}`,
        contentSha256: sha256(notesContent),
        savedAt: input.createdAt,
      },
      {
        kind: 'slides',
        relativePath: `${relativeBundlePath}/${LECTURE_SLIDES_FILE_NAME}`,
        contentSha256: sha256(slidesContent),
        savedAt: input.createdAt,
      },
    ];
    return { relativeBundlePath, files, journal, artifacts };
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

  private async requirePendingRevisionLink(pending: PendingLectureRevisionArtifacts) {
    const link = this.dependencies.storage.loadProjectLink(pending.outputProjectId);
    if (
      !link ||
      link.status !== 'ready' ||
      link.bindingId !== pending.bindingId ||
      link.vaultId !== pending.vaultId
    ) {
      throw new ResearchNotesServiceError('research_notes_folder_unavailable');
    }
    this.requireVault(link.vaultId);
    await this.assertOwnership(link);
    return link;
  }

  private async confirmAgentMarkdownWrite(
    projectId: string,
    expectedBindingId: string,
    expectedLink: ResearchNotesProjectLink,
  ) {
    const project = await this.requireActiveProject(projectId);
    const currentLink = this.dependencies.storage.loadProjectLink(projectId);
    if (
      !currentLink ||
      currentLink.status !== 'ready' ||
      currentLink.projectId !== project.id ||
      currentLink.projectName !== project.name ||
      currentLink.bindingId !== expectedBindingId ||
      currentLink.bindingId !== expectedLink.bindingId ||
      currentLink.vaultId !== expectedLink.vaultId ||
      currentLink.folderName !== expectedLink.folderName
    ) {
      throw new ResearchNotesServiceError('research_notes_save_commit_uncertain');
    }
    this.requireVault(currentLink.vaultId);
    await this.assertOwnership(currentLink);
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
