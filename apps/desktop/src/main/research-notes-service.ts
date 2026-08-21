import { createHash, randomBytes } from 'node:crypto';
import { basename, join, posix } from 'node:path';

import type { BrowserWindow } from 'electron';
import { z } from 'zod';

import type { ModelInvocation } from '@gosu/contracts';

import type { LiteratureRecord } from '../shared/literature-contracts';
import type {
  LectureStudioArtifact,
  LectureStudioFigureAsset,
  PendingLectureRevisionArtifacts,
} from '../shared/lecture-studio-contracts';
import {
  LECTURE_STUDIO_MAX_FIGURE_BYTES,
  LECTURE_STUDIO_MAX_FIGURES,
  LectureStudioFigureAssetSchema,
} from '../shared/lecture-studio-contracts';
import type { LocalNotesVaultGrant } from '../shared/project-chat-contracts';
import {
  ResearchNotesProvenanceValueSchema,
  ResearchNotesRelatedDocumentSchema,
  ResearchNotesRelatedPaperSchema,
} from '../shared/research-notes-document-contracts';
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
  type ResearchNotesPendingBundleFileV2,
  type ResearchNotesPendingMarkdownBundle,
} from './research-notes-managed-files';
import {
  researchPaperNoteFileName,
  serializeLiteratureReviewMarkdown,
  serializePaperNoteMarkdown,
} from './research-notes-markdown';
import {
  extractResearchNotesCreatedAt,
  serializeResearchNotesDocument,
  uniqueResearchNotesValues,
} from './research-notes-document';
import type { VaultAccess } from './vault';
import type { WorkspaceService } from './workspace-service';

const MAX_AGENT_NOTE_LIST = 100;
const MAX_AGENT_NOTE_CHARACTERS = 24_000;
const MAX_AGENT_MARKDOWN_CHARACTERS = 1_000_000;
const MAX_AGENT_MARKDOWN_TITLE_BYTES = 180;
const AGENT_MARKDOWN_ARTIFACT_ID_CHARACTERS = 16;
const MAX_PENDING_LECTURE_PROJECT_SCAN = 32;
const LECTURE_MARKDOWN_FILE_NAMES = {
  notes: 'Lecture Notes.md',
  slides: 'Slides.md',
} as const;
const LECTURE_LATEX_FILE_NAMES = {
  notes: 'Lecture Notes.tex',
  slides: 'Slides.tex',
} as const;

type LectureDocumentFormat = 'markdown' | 'latex';

function lectureFileNames(documentFormat: LectureDocumentFormat) {
  return documentFormat === 'latex' ? LECTURE_LATEX_FILE_NAMES : LECTURE_MARKDOWN_FILE_NAMES;
}

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

export const ResearchNotesAgentMarkdownOriginSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    sessionId: z.string().uuid().nullable(),
    sessionName: z.string().trim().min(1).max(256).nullable(),
    creatorId: z.string().trim().min(1).max(512).nullable(),
    creatorName: z.string().trim().min(1).max(256).nullable(),
    relatedDocuments: z.array(ResearchNotesRelatedDocumentSchema).max(128).default([]),
    relatedPapers: z.array(ResearchNotesRelatedPaperSchema).max(128).default([]),
    provenance: z
      .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u), ResearchNotesProvenanceValueSchema)
      .refine((value) => Object.keys(value).length <= 48, 'provenance_too_large')
      .default({}),
  })
  .strict()
  .refine((value) => (value.sessionId === null) === (value.sessionName === null), {
    path: ['sessionId'],
    message: 'session_id_and_name_must_be_provided_together',
  });

export type ResearchNotesAgentMarkdownOrigin = z.input<
  typeof ResearchNotesAgentMarkdownOriginSchema
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
      .refine((value) => !/^\s*---(?:\r?\n|$)/u.test(value), 'content_contains_frontmatter')
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
    origin: ResearchNotesAgentMarkdownOriginSchema.optional(),
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
  generationBriefSha256?: string;
  authoringPolicyVersion?: number;
  authoringPolicySha256?: string;
  documentFormat?: LectureDocumentFormat;
  lectureNotesMarkdown?: string;
  slidesMarkdown?: string;
  lectureNotesLatex?: string;
  slidesLatex?: string;
  createdAt: string;
  invocation?: ModelInvocation;
  relatedDocuments?: readonly string[];
  relatedPapers?: readonly string[];
  figureAssets?: readonly Readonly<{
    asset: LectureStudioFigureAsset;
    bytes: Uint8Array;
  }>[];
}>;

/** Main-process-only capability for one exact, already committed Lecture artifact. */
export type ResolvedLectureRevisionArtifact = Readonly<{
  absolutePath: string;
  relativePath: string;
  fileName: string;
  content: string;
  contentSha256: string;
}>;

export type ResolvedLectureRevisionFigure = Readonly<{
  absolutePath: string;
  relativePath: string;
  fileName: string;
  bytes: Buffer;
  contentSha256: string;
  byteSize: number;
}>;

type PendingLectureRevisionArtifactsWithFigures = PendingLectureRevisionArtifacts &
  Readonly<{
    figureAssets?: readonly LectureStudioFigureAsset[];
    bundleFiles?: readonly ResearchNotesPendingBundleFileV2[];
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

function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

export function prepareResearchNotesAgentMarkdown(
  project: Pick<ProjectRecord, 'id' | 'name' | 'updatedAt'>,
  artifactId: string,
  input: SaveResearchNoteForAgentInput,
) {
  if (!/^[0-9a-f]{16}$/u.test(artifactId)) {
    throw new ResearchNotesServiceError('research_notes_folder_conflict');
  }
  const command = SaveResearchNoteForAgentInputSchema.parse(input);
  const origin = command.origin;
  const createdAt = origin?.createdAt ?? project.updatedAt;
  return serializeResearchNotesDocument({
    envelope: {
      schemaVersion: 2,
      documentId: `project-chat:${artifactId}`,
      kind: 'project-chat-artifact',
      managed: false,
      createdAt,
      modifiedAt: createdAt,
      tags: ['project-chat', command.category],
      projectId: project.id,
      projectName: project.name,
      origin: 'project-chat',
      originSessionId: origin?.sessionId ?? null,
      originSessionName: origin?.sessionName ?? null,
      creatorId: origin?.creatorId ?? 'gosu-system',
      creatorName: origin?.creatorName ?? 'GOSU Project Chat',
      relatedDocuments: origin?.relatedDocuments ?? [],
      relatedPapers: origin?.relatedPapers ?? [],
      provenance: {
        ...(origin?.provenance ?? {}),
        artifact_id: artifactId,
        idempotency_key_sha256: sha256(command.idempotencyKey),
        source_body_sha256: sha256(command.content),
      },
    },
    properties: { research_note_category: command.category },
    body: command.content,
  });
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

function lectureRevisionBundleId(
  input: SaveLectureRevisionArtifactsInput,
  bindingId: string,
  figures: readonly LectureStudioFigureAsset[] = [],
) {
  const identity = [
    input.outputProjectId,
    bindingId,
    input.studioId,
    String(input.revision),
    input.sourceManifestSha256,
  ];
  if (input.generationBriefSha256 !== undefined) {
    identity.push(
      input.generationBriefSha256,
      String(input.authoringPolicyVersion),
      input.authoringPolicySha256!,
    );
  }
  if (figures.length > 0) {
    identity.push(
      'figure-manifest-v1',
      sha256(
        JSON.stringify(
          figures.map((figure) => ({
            id: figure.id,
            fileName: figure.fileName,
            sha256: figure.sha256,
            byteSize: figure.byteSize,
            width: figure.width,
            height: figure.height,
          })),
        ),
      ),
    );
  }
  return sha256(identity.join('\0'));
}

function pendingRevisionJournal(
  pending: PendingLectureRevisionArtifacts,
): ResearchNotesPendingMarkdownBundle {
  const pendingWithFigures = pending as PendingLectureRevisionArtifactsWithFigures;
  const relativeBundlePath = safeProjectPath(pending.relativeBundlePath);
  const notesFileName = basename(
    pending.artifacts.find((artifact) => artifact.kind === 'lecture-notes')?.relativePath ?? '',
  );
  const documentFormat: LectureDocumentFormat = notesFileName.endsWith('.tex')
    ? 'latex'
    : 'markdown';
  const fileNames = lectureFileNames(documentFormat);
  const notes = pending.artifacts.find((artifact) => artifact.kind === 'lecture-notes');
  const slides = pending.artifacts.find((artifact) => artifact.kind === 'slides');
  if (
    !notes ||
    !slides ||
    notes.relativePath !== `${relativeBundlePath}/${fileNames.notes}` ||
    slides.relativePath !== `${relativeBundlePath}/${fileNames.slides}`
  ) {
    throw new ResearchNotesServiceError('research_notes_folder_conflict');
  }
  const common = {
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
    ...(pending.generationBriefSha256
      ? {
          generationBriefSha256: pending.generationBriefSha256,
          authoringPolicyVersion: pending.authoringPolicyVersion,
          authoringPolicySha256: pending.authoringPolicySha256,
        }
      : {}),
  } as const;
  const figureAssets = pendingWithFigures.figureAssets ?? [];
  if (figureAssets.length > 0) {
    const bundleFiles = pendingWithFigures.bundleFiles;
    if (
      documentFormat !== 'latex' ||
      !bundleFiles ||
      bundleFiles.length !== 2 + figureAssets.length ||
      bundleFiles.find((file) => file.name === fileNames.notes)?.contentSha256 !==
        notes.contentSha256 ||
      bundleFiles.find((file) => file.name === fileNames.slides)?.contentSha256 !==
        slides.contentSha256
    ) {
      throw new ResearchNotesServiceError('research_notes_folder_conflict');
    }
    return {
      ...common,
      schemaVersion: 2,
      documentFormat: 'latex',
      figureAssets,
      files: bundleFiles,
    };
  }
  return {
    ...common,
    ...(documentFormat === 'latex' ? { documentFormat } : {}),
    files: [
      { name: fileNames.notes, contentSha256: notes.contentSha256 },
      { name: fileNames.slides, contentSha256: slides.contentSha256 },
    ],
  };
}

function initialTemplate(project: ProjectRecord, kind: string, createdAt: string, body: string) {
  return serializeResearchNotesDocument({
    envelope: {
      schemaVersion: 2,
      documentId: `project-workspace:${kind}:${project.id}`,
      kind,
      managed: false,
      createdAt,
      modifiedAt: createdAt,
      tags: [kind],
      projectId: project.id,
      projectName: project.name,
      origin: 'project-workspace',
      originSessionId: null,
      originSessionName: null,
      creatorId: 'gosu-system',
      creatorName: 'GOSU',
      relatedDocuments: [],
      relatedPapers: [],
      provenance: { source: 'project-workspace-bootstrap' },
    },
    body,
  });
}

function initialTemplates(project: ProjectRecord, createdAt: string) {
  return {
    'Experiments/Experiment Log.md': initialTemplate(
      project,
      'experiment-log',
      createdAt,
      '# Experiment Log\n',
    ),
    'Project Progress/Project Progress.md': initialTemplate(
      project,
      'project-progress',
      createdAt,
      '# Project Progress\n',
    ),
    'Idea Development/Idea Development.md': initialTemplate(
      project,
      'idea-development',
      createdAt,
      '# Idea Development\n',
    ),
    'Papers/Papers Index.md': initialTemplate(
      project,
      'papers-index',
      createdAt,
      '# Papers\n\nPaper notes created from the Literature tab appear in this folder.\n',
    ),
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

  /**
   * Read-only workspace inspection for local search and other background readers. Unlike
   * `current`, this never creates, renames, repairs, or synchronizes project Markdown.
   */
  async inspectReadyWorkspace(
    input: ResearchNotesProjectInput,
    signal?: AbortSignal,
  ): Promise<ResearchNotesWorkspace | null> {
    signal?.throwIfAborted();
    const command = ResearchNotesProjectInputSchema.parse(input);
    const ready = await this.readOnlyReadyLink(command.projectId);
    if (!ready) return null;
    const { project, link } = ready;
    const files = await this.projectFiles(link, signal);
    signal?.throwIfAborted();
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

  async readReadyMarkdown(input: ReadResearchNoteInput, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const command = ReadResearchNoteInputSchema.parse(input);
    const ready = await this.readOnlyReadyLink(command.projectId);
    if (!ready) throw new ResearchNotesServiceError('research_notes_folder_unavailable');
    const path = safeProjectPath(command.path);
    try {
      const note = await this.dependencies.vault.readDocument(
        `${this.relativeRoot(ready.link)}/${path}`,
        signal,
      );
      signal?.throwIfAborted();
      await this.dependencies.vault.validateGrant(ready.link.vaultId);
      return { path, content: note.content };
    } catch (error) {
      if (error instanceof ResearchNotesServiceError) throw error;
      throw new ResearchNotesServiceError('research_notes_note_not_found');
    }
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
      const note = await this.dependencies.vault.readDocument(`${this.relativeRoot(link)}/${path}`);
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
    const note = await this.dependencies.vault.readDocument(`${this.relativeRoot(link)}/${path}`);
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
    const content = prepareResearchNotesAgentMarkdown(project, artifactId, command);
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
        content,
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
      if (existing.content !== content) {
        throw new ResearchNotesServiceError('research_notes_folder_conflict');
      }
    }
    try {
      await this.confirmAgentMarkdownWrite(project.id, expectedBindingId, link);
      const verified = await this.dependencies.vault.readMarkdown(
        `${this.relativeRoot(link)}/${path}`,
      );
      if (verified.content !== content) {
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
      contentSha256: sha256(content),
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
    const { project, link } = await this.requireReadyLink(input.outputProjectId, descriptor.id);
    await this.assertOwnership(link);
    const selection = this.requireVault(link.vaultId);
    const bundle = this.lectureRevisionBundle(input, project, link);
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

  async resolveLectureRevisionArtifact(
    outputProjectId: string,
    artifact: LectureStudioArtifact,
  ): Promise<ResolvedLectureRevisionArtifact> {
    const ready = await this.readOnlyReadyLink(outputProjectId);
    if (!ready) {
      throw new ResearchNotesServiceError('research_notes_folder_unavailable');
    }
    const path = safeProjectPath(artifact.relativePath);
    try {
      const note = await this.dependencies.vault.readDocument(
        `${this.relativeRoot(ready.link)}/${path}`,
      );
      await this.dependencies.vault.validateGrant(ready.link.vaultId);
      await this.assertOwnership(ready.link);
      const contentSha256 = sha256(note.content);
      if (contentSha256 !== artifact.contentSha256) {
        throw new ResearchNotesServiceError('research_notes_folder_conflict');
      }
      const selection = this.requireVault(ready.link.vaultId);
      return {
        absolutePath: join(selection.root, this.relativeRoot(ready.link), path),
        relativePath: path,
        fileName: basename(path),
        content: note.content,
        contentSha256,
      };
    } catch (error) {
      if (error instanceof ResearchNotesServiceError) throw error;
      throw new ResearchNotesServiceError('research_notes_note_not_found');
    }
  }

  async resolveLectureRevisionFigure(
    outputProjectId: string,
    artifact: LectureStudioArtifact,
    rawAsset: LectureStudioFigureAsset,
  ): Promise<ResolvedLectureRevisionFigure> {
    const ready = await this.readOnlyReadyLink(outputProjectId);
    if (!ready) {
      throw new ResearchNotesServiceError('research_notes_folder_unavailable');
    }
    let asset: LectureStudioFigureAsset;
    try {
      asset = LectureStudioFigureAssetSchema.parse(structuredClone(rawAsset));
    } catch {
      throw new ResearchNotesServiceError('research_notes_folder_conflict');
    }
    const artifactPath = safeProjectPath(artifact.relativePath);
    const relativeBundlePath = posix.dirname(artifactPath);
    if (
      relativeBundlePath === '.' ||
      !['Lecture Notes.tex', 'Slides.tex'].includes(posix.basename(artifactPath))
    ) {
      throw new ResearchNotesServiceError('research_notes_folder_conflict');
    }
    try {
      const selection = this.requireVault(ready.link.vaultId);
      const resolved = await new ResearchNotesManagedFiles(selection.root).readUserBundleFigure(
        ready.link.folderName,
        relativeBundlePath,
        asset,
        this.ownership(ready.link),
      );
      await this.dependencies.vault.validateGrant(ready.link.vaultId);
      await this.assertOwnership(ready.link);
      return {
        absolutePath: resolved.absolutePath,
        relativePath: `${relativeBundlePath}/${asset.fileName}`,
        fileName: asset.fileName,
        bytes: resolved.bytes,
        contentSha256: asset.sha256,
        byteSize: asset.byteSize,
      };
    } catch (error) {
      if (error instanceof ResearchNotesServiceError) throw error;
      throw new ResearchNotesServiceError('research_notes_folder_conflict');
    }
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
          const documentFormat = entry.journal.documentFormat ?? 'markdown';
          const fileNames = lectureFileNames(documentFormat);
          const textFiles =
            entry.journal.schemaVersion === 2
              ? entry.journal.files.filter((file) => file.encoding === 'utf8')
              : entry.journal.files;
          const notes = textFiles.find((file) => file.name === fileNames.notes);
          const slides = textFiles.find((file) => file.name === fileNames.slides);
          if (!notes || !slides) continue;
          const recovered: PendingLectureRevisionArtifactsWithFigures = {
            outputProjectId: entry.journal.projectId,
            bindingId: entry.journal.bindingId,
            vaultId: entry.journal.vaultId,
            bundleId: entry.journal.bundleId,
            relativeBundlePath: entry.relativeBundlePath,
            studioId: entry.journal.studioId,
            revision: entry.journal.revision,
            attemptId: entry.journal.attemptId,
            sourceManifestSha256: entry.journal.sourceManifestSha256,
            ...(entry.journal.generationBriefSha256
              ? {
                  generationBriefSha256: entry.journal.generationBriefSha256,
                  authoringPolicyVersion: entry.journal.authoringPolicyVersion,
                  authoringPolicySha256: entry.journal.authoringPolicySha256,
                }
              : {}),
            artifacts: [
              {
                kind: 'lecture-notes',
                relativePath: `${entry.relativeBundlePath}/${fileNames.notes}`,
                contentSha256: notes.contentSha256,
              },
              {
                kind: 'slides',
                relativePath: `${entry.relativeBundlePath}/${fileNames.slides}`,
                contentSha256: slides.contentSha256,
              },
            ],
            figureAssets: entry.journal.schemaVersion === 2 ? entry.journal.figureAssets : [],
            ...(entry.journal.schemaVersion === 2 ? { bundleFiles: entry.journal.files } : {}),
          };
          pending.push(recovered);
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
    const { project, link } = await this.requireReadyLink(input.outputProjectId, descriptor.id);
    await this.assertOwnership(link);
    const selection = this.requireVault(link.vaultId);
    const bundle = this.lectureRevisionBundle(input, project, link);
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
    const { project, link } = await this.requireReadyLink(input.outputProjectId, descriptor.id);
    await this.assertOwnership(link);
    const selection = this.requireVault(link.vaultId);
    const bundle = this.lectureRevisionBundle(input, project, link);
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
    const relativePath = 'Literature/Literature Review.md';
    let createdAt = link.createdAt;
    if ((await this.projectFiles(link)).includes(relativePath)) {
      try {
        const existingReview = await this.dependencies.vault.readMarkdown(
          `${this.relativeRoot(link)}/${relativePath}`,
        );
        createdAt = extractResearchNotesCreatedAt(existingReview.content) ?? createdAt;
      } catch {
        // The managed writer performs the authoritative ownership and destination checks below.
      }
    }
    const syncedAt = this.now().toISOString();
    const modifiedAt = Date.parse(syncedAt) < Date.parse(createdAt) ? createdAt : syncedAt;
    await writer.writeManagedMarkdown(
      link.folderName,
      relativePath,
      serializeLiteratureReviewMarkdown(project, records, { createdAt, modifiedAt }),
      this.ownership(link),
    );
    await this.dependencies.vault.validateGrant(link.vaultId);
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
    const createdAt = this.now().toISOString();
    const created = await writer.createUserMarkdown(
      link.folderName,
      path,
      serializePaperNoteMarkdown(project, record, { createdAt, modifiedAt: createdAt }),
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
      initialTemplates(project, link.createdAt),
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

  private async projectFiles(link: ResearchNotesProjectLink, signal?: AbortSignal) {
    signal?.throwIfAborted();
    this.requireVault(link.vaultId);
    const prefix = `${this.relativeRoot(link)}/`;
    const files = await this.dependencies.vault.listDocuments(signal);
    signal?.throwIfAborted();
    return files.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
  }

  private lectureRevisionBundle(
    input: SaveLectureRevisionArtifactsInput,
    project: ProjectRecord,
    link: ResearchNotesProjectLink,
  ) {
    const documentFormat = input.documentFormat ?? 'markdown';
    const figureRecords = (input.figureAssets ?? []).map((record) => {
      let asset: LectureStudioFigureAsset;
      try {
        asset = LectureStudioFigureAssetSchema.parse(structuredClone(record.asset));
      } catch {
        throw new ResearchNotesServiceError('research_notes_folder_conflict');
      }
      const bytes = Buffer.from(record.bytes);
      if (
        asset.studioId !== input.studioId ||
        bytes.byteLength !== asset.byteSize ||
        bytes.byteLength < 5 ||
        bytes.byteLength > LECTURE_STUDIO_MAX_FIGURE_BYTES ||
        sha256(bytes) !== asset.sha256 ||
        bytes[0] !== 0xff ||
        bytes[1] !== 0xd8 ||
        bytes[2] !== 0xff ||
        bytes.at(-2) !== 0xff ||
        bytes.at(-1) !== 0xd9
      ) {
        throw new ResearchNotesServiceError('research_notes_folder_conflict');
      }
      return { asset, bytes } as const;
    });
    if (
      figureRecords.length > LECTURE_STUDIO_MAX_FIGURES ||
      new Set(figureRecords.map(({ asset }) => asset.id)).size !== figureRecords.length ||
      new Set(figureRecords.map(({ asset }) => asset.fileName)).size !== figureRecords.length ||
      new Set(figureRecords.map(({ asset }) => asset.sha256)).size !== figureRecords.length ||
      (figureRecords.length > 0 && documentFormat !== 'latex')
    ) {
      throw new ResearchNotesServiceError('research_notes_folder_conflict');
    }
    const generationProvenance = [
      input.generationBriefSha256,
      input.authoringPolicyVersion,
      input.authoringPolicySha256,
    ];
    const generationProvenanceCount = generationProvenance.filter(
      (value) => value !== undefined,
    ).length;
    if (
      !Number.isInteger(input.revision) ||
      input.revision < 1 ||
      !/^[0-9a-f]{64}$/u.test(input.sourceManifestSha256) ||
      (generationProvenanceCount !== 0 &&
        generationProvenanceCount !== generationProvenance.length) ||
      (input.generationBriefSha256 !== undefined &&
        !/^[0-9a-f]{64}$/u.test(input.generationBriefSha256)) ||
      (input.authoringPolicyVersion !== undefined &&
        (!Number.isSafeInteger(input.authoringPolicyVersion) ||
          input.authoringPolicyVersion < 1)) ||
      (input.authoringPolicySha256 !== undefined &&
        !/^[0-9a-f]{64}$/u.test(input.authoringPolicySha256)) ||
      !/^\S+$/u.test(input.attemptId)
    ) {
      throw new ResearchNotesServiceError('research_notes_folder_conflict');
    }
    const fileNames = lectureFileNames(documentFormat);
    const rawNotes =
      documentFormat === 'latex' ? input.lectureNotesLatex : input.lectureNotesMarkdown;
    const rawSlides = documentFormat === 'latex' ? input.slidesLatex : input.slidesMarkdown;
    const wrapMarkdown = (kind: 'lecture-notes' | 'slides', markdown: string | undefined) => {
      const body = markdown?.trim() ?? '';
      if (!body) throw new ResearchNotesServiceError('research_notes_folder_conflict');
      const invocation = input.invocation;
      return serializeResearchNotesDocument({
        envelope: {
          schemaVersion: 2,
          documentId: `lecture-studio:${input.studioId}:revision:${input.revision}:${kind}`,
          kind,
          managed: false,
          createdAt: input.createdAt,
          modifiedAt: input.createdAt,
          tags: ['lecture-studio', kind],
          projectId: project.id,
          projectName: project.name,
          origin: 'lecture-studio',
          originSessionId: null,
          originSessionName: null,
          creatorId: invocation?.resolvedModelId ?? 'gosu-system',
          creatorName: invocation ? 'GOSU Lecture Studio' : 'GOSU',
          relatedDocuments: uniqueResearchNotesValues(input.relatedDocuments ?? []),
          relatedPapers: uniqueResearchNotesValues(input.relatedPapers ?? []),
          provenance: {
            source: 'lecture-studio',
            studio_id: input.studioId,
            revision: input.revision,
            attempt_id: input.attemptId,
            source_manifest_sha256: input.sourceManifestSha256,
            ...(input.generationBriefSha256
              ? {
                  generation_brief_sha256: input.generationBriefSha256,
                  authoring_policy_version: input.authoringPolicyVersion,
                  authoring_policy_sha256: input.authoringPolicySha256,
                }
              : {}),
            invocation_id: invocation?.invocationId ?? null,
            provider_id: invocation?.providerId ?? null,
            requested_model_id: invocation?.requestedModelId ?? null,
            resolved_model_id: invocation?.resolvedModelId ?? null,
            catalog_version: invocation?.catalogVersion ?? null,
            reasoning_option_id: invocation?.reasoningOptionId ?? null,
          },
        },
        properties: {
          gosu_lecture_studio_id: input.studioId,
          gosu_lecture_revision: input.revision,
          gosu_source_manifest_sha256: input.sourceManifestSha256,
          ...(input.generationBriefSha256
            ? {
                gosu_generation_brief_sha256: input.generationBriefSha256,
                gosu_authoring_policy_version: input.authoringPolicyVersion,
                gosu_authoring_policy_sha256: input.authoringPolicySha256,
              }
            : {}),
          gosu_generated_at: input.createdAt,
        },
        body,
      });
    };
    const exactLatex = (latex: string | undefined) => {
      if (!latex?.trim()) throw new ResearchNotesServiceError('research_notes_folder_conflict');
      return latex;
    };
    const notesContent =
      documentFormat === 'latex' ? exactLatex(rawNotes) : wrapMarkdown('lecture-notes', rawNotes);
    const slidesContent =
      documentFormat === 'latex' ? exactLatex(rawSlides) : wrapMarkdown('slides', rawSlides);
    const figureAssets = figureRecords.map(({ asset }) => asset);
    const bundleId = lectureRevisionBundleId(input, link.bindingId, figureAssets);
    const revisionLabel = String(input.revision).padStart(4, '0');
    const folderName = `${safeAgentMarkdownFileStem(input.studioTitle)}--r${revisionLabel}--${bundleId.slice(0, AGENT_MARKDOWN_ARTIFACT_ID_CHARACTERS)}`;
    const relativeBundlePath = safeProjectPath(`Lecture Notes & Slides/${folderName}`);
    const files: readonly ResearchNotesMarkdownBundleFile[] = [
      { name: fileNames.notes, content: notesContent },
      { name: fileNames.slides, content: slidesContent },
      ...figureRecords.map(({ asset, bytes }) => ({ name: asset.fileName, content: bytes })),
    ];
    const commonJournal = {
      kind: 'lecture-revision',
      projectId: input.outputProjectId,
      bindingId: link.bindingId,
      vaultId: link.vaultId,
      bundleId,
      studioId: input.studioId,
      revision: input.revision,
      attemptId: input.attemptId,
      sourceManifestSha256: input.sourceManifestSha256,
      ...(input.generationBriefSha256
        ? {
            generationBriefSha256: input.generationBriefSha256,
            authoringPolicyVersion: input.authoringPolicyVersion!,
            authoringPolicySha256: input.authoringPolicySha256!,
          }
        : {}),
    } as const;
    const journal: ResearchNotesPendingMarkdownBundle =
      figureAssets.length > 0
        ? {
            schemaVersion: 2,
            ...commonJournal,
            documentFormat: 'latex',
            figureAssets,
            files: files.map((file) => ({
              name: file.name,
              contentSha256: sha256(file.content),
              byteSize:
                typeof file.content === 'string'
                  ? Buffer.byteLength(file.content, 'utf8')
                  : file.content.byteLength,
              encoding: typeof file.content === 'string' ? 'utf8' : 'binary',
            })),
          }
        : {
            schemaVersion: 1,
            ...commonJournal,
            ...(documentFormat === 'latex' ? { documentFormat } : {}),
            files: files.map((file) => ({
              name: file.name,
              contentSha256: sha256(file.content),
            })),
          };
    const artifacts: readonly [LectureStudioArtifact, LectureStudioArtifact] = [
      {
        kind: 'lecture-notes',
        relativePath: `${relativeBundlePath}/${fileNames.notes}`,
        contentSha256: sha256(notesContent),
        savedAt: input.createdAt,
      },
      {
        kind: 'slides',
        relativePath: `${relativeBundlePath}/${fileNames.slides}`,
        contentSha256: sha256(slidesContent),
        savedAt: input.createdAt,
      },
    ];
    return { relativeBundlePath, files, journal, artifacts, figureAssets };
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

  private async readOnlyReadyLink(projectId: string) {
    const project = await this.requireSearchableProject(projectId);
    const selection = this.dependencies.vault.current();
    if (!selection) return null;
    const link = this.dependencies.storage.loadProjectLink(project.id);
    if (
      !link ||
      link.projectId !== project.id ||
      link.status !== 'ready' ||
      link.vaultId !== selection.id
    ) {
      return null;
    }
    await this.assertOwnership(link);
    return { project, link } as const;
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

  private async requireSearchableProject(projectId: string) {
    const snapshot = await this.dependencies.workspace.snapshot();
    const project = snapshot.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new ResearchNotesServiceError('research_notes_project_not_found');
    if (project.trashedAt) {
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
