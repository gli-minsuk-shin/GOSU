import { createHash, randomUUID } from 'node:crypto';
import { constants, rmSync } from 'node:fs';
import { chmod, mkdtemp, open, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

import {
  ChooseProjectChatAttachmentsInputSchema,
  PROJECT_CHAT_MAX_ATTACHMENTS,
  PROJECT_CHAT_MAX_ATTACHMENT_BYTES,
  PROJECT_CHAT_MAX_ATTACHMENT_EXTRACTED_CHARACTERS,
  PROJECT_CHAT_MAX_TOTAL_ATTACHMENT_BYTES,
  ProjectChatAttachmentSchema,
  ReleaseProjectChatAttachmentInputSchema,
  type ChooseProjectChatAttachmentsInput,
  type ProjectChatAttachment,
  type ProjectChatAttachmentFormat,
  type ProjectChatAttachmentKind,
  type ProjectChatAttachmentUnitLabel,
  type ReleaseProjectChatAttachmentInput,
} from '../shared/project-chat-attachment-contracts';
import {
  extractProjectChatDocument,
  ProjectChatDocumentExtractionError,
  type ExtractedAttachmentUnit,
  type ExtractedProjectChatDocument,
  type ProjectChatDocumentFormat,
} from './project-chat-document-extractor';
import {
  normalizeProjectChatImage,
  ProjectChatImageExtractionError,
  type NormalizedProjectChatImage,
  type ProjectChatImageFormat,
} from './project-chat-image-extractor';
import {
  extractProjectChatPdf,
  ProjectChatPdfExtractionError,
  type ExtractedProjectChatPdf,
} from './project-chat-pdf-extractor';

const ATTACHMENT_TTL_MS = 15 * 60 * 1_000;
const MAX_LIVE_ATTACHMENT_CAPABILITIES = 25;
const MAX_LIVE_NORMALIZED_IMAGES = 20;

type AttachmentFormatDefinition = Readonly<{
  format: ProjectChatAttachmentFormat;
  kind: ProjectChatAttachmentKind;
  mediaType: string;
}>;

const FORMAT_BY_EXTENSION: Readonly<Record<string, AttachmentFormatDefinition>> = {
  '.pdf': { format: 'pdf', kind: 'document', mediaType: 'application/pdf' },
  '.docx': {
    format: 'docx',
    kind: 'document',
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '.pptx': {
    format: 'pptx',
    kind: 'presentation',
    mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  '.hwpx': { format: 'hwpx', kind: 'document', mediaType: 'application/hwp+zip' },
  '.txt': { format: 'text', kind: 'document', mediaType: 'text/plain' },
  '.md': { format: 'markdown', kind: 'document', mediaType: 'text/markdown' },
  '.markdown': { format: 'markdown', kind: 'document', mediaType: 'text/markdown' },
  '.csv': { format: 'csv', kind: 'document', mediaType: 'text/csv' },
  '.json': { format: 'json', kind: 'document', mediaType: 'application/json' },
  '.tex': { format: 'latex', kind: 'document', mediaType: 'application/x-tex' },
  '.png': { format: 'png', kind: 'image', mediaType: 'image/png' },
  '.jpg': { format: 'jpeg', kind: 'image', mediaType: 'image/jpeg' },
  '.jpeg': { format: 'jpeg', kind: 'image', mediaType: 'image/jpeg' },
  '.gif': { format: 'gif', kind: 'image', mediaType: 'image/gif' },
  '.webp': { format: 'webp', kind: 'image', mediaType: 'image/webp' },
  '.tif': { format: 'tiff', kind: 'image', mediaType: 'image/tiff' },
  '.tiff': { format: 'tiff', kind: 'image', mediaType: 'image/tiff' },
  '.bmp': { format: 'bmp', kind: 'image', mediaType: 'image/bmp' },
  '.avif': { format: 'avif', kind: 'image', mediaType: 'image/avif' },
};

function safeDisplayName(path: string) {
  const singleLine = [...basename(path)]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || (code >= 127 && code <= 159) ? ' ' : character;
    })
    .join('');
  return singleLine.replace(/\s+/gu, ' ').trim().slice(0, 255) || 'Attached file';
}

export type ProjectChatAttachmentErrorCode =
  | 'attachment_invalid'
  | 'attachment_unsupported'
  | 'attachment_too_large'
  | 'attachment_total_too_large'
  | 'attachment_too_many'
  | 'attachment_encrypted'
  | 'attachment_archive_limit'
  | 'attachment_extraction_failed'
  | 'attachment_expired'
  | 'attachment_scope_mismatch'
  | 'attachment_capacity_exhausted'
  | 'attachment_model_modality_unsupported';

export class ProjectChatAttachmentError extends Error {
  constructor(readonly code: ProjectChatAttachmentErrorCode) {
    super(code);
    this.name = 'ProjectChatAttachmentError';
  }
}

export type AgentAttachmentCatalogItem = Readonly<{
  attachmentId: string;
  label: string;
  sourceSha256: string;
  kind: ProjectChatAttachmentKind;
  format: ProjectChatAttachmentFormat;
  unitLabel: ProjectChatAttachmentUnitLabel;
  unitCount: number;
  extractedCharacters: number;
  truncated: boolean;
  textAvailable: boolean;
  visualAvailable: boolean;
  reconstructionNotice?: string;
}>;

export type AgentAttachmentChunk = Readonly<{
  attachmentId: string;
  label: string;
  sourceSha256: string;
  kind: ProjectChatAttachmentKind;
  format: ProjectChatAttachmentFormat;
  unitLabel: ProjectChatAttachmentUnitLabel;
  unitCount: number;
  startUnit: number;
  endUnit: number;
  content: string;
  contentSha256: string;
  truncated: boolean;
  reconstructionNotice?: string;
}>;

export type AgentNativeImageInput = Readonly<{
  attachmentId: string;
  label: string;
  sourceSha256: string;
  path: string;
}>;

export interface ProjectChatAttachmentsForAgent {
  catalog(): readonly AgentAttachmentCatalogItem[];
  read(
    attachmentId: string,
    startUnit: number,
    unitCount: number,
    maxCharacters: number,
  ): AgentAttachmentChunk | null;
  nativeImages(): readonly AgentNativeImageInput[];
  revoke(): Promise<void>;
}

export interface ProjectChatAttachmentClaimer {
  validate?(projectId: string, sessionId: string, attachmentIds: readonly string[]): void;
  claim(
    projectId: string,
    sessionId: string,
    attachmentIds: readonly string[],
  ): ProjectChatAttachmentsForAgent;
  release?(input: ReleaseProjectChatAttachmentInput): Promise<{ released: true }>;
}

type EphemeralImage = Readonly<{
  path: string;
  directory: string;
}>;

type StagedAttachment = {
  descriptor: ProjectChatAttachment;
  units: readonly ExtractedAttachmentUnit[];
  ephemeralImage?: EphemeralImage;
  timer: NodeJS.Timeout;
};

type ExtractedAttachmentText = Readonly<{
  unitLabel: Exclude<ProjectChatAttachmentUnitLabel, 'image'>;
  unitCount: number;
  units: readonly ExtractedAttachmentUnit[];
  extractedCharacters: number;
  truncated: boolean;
  textAvailable: boolean;
  reconstructionNotice: string;
}>;

class ClaimedProjectChatAttachments implements ProjectChatAttachmentsForAgent {
  private readonly records = new Map<
    string,
    Readonly<{
      descriptor: ProjectChatAttachment;
      label: string;
      units: readonly ExtractedAttachmentUnit[];
      ephemeralImage?: EphemeralImage;
    }>
  >();
  private revoked = false;

  constructor(
    records: readonly StagedAttachment[],
    private readonly cleanupImage: (image: EphemeralImage) => Promise<void>,
    private readonly releaseCapacity: (attachmentCount: number) => void,
  ) {
    for (const [index, record] of records.entries()) {
      this.records.set(record.descriptor.id, {
        descriptor: record.descriptor,
        label: `Attachment ${index + 1}`,
        units: record.units,
        ...(record.ephemeralImage ? { ephemeralImage: record.ephemeralImage } : {}),
      });
    }
  }

  catalog() {
    if (this.revoked) return [];
    return [...this.records.values()].map(({ descriptor, label }) => ({
      attachmentId: descriptor.id,
      label,
      sourceSha256: descriptor.sha256,
      kind: descriptor.kind,
      format: descriptor.format,
      unitLabel: descriptor.unitLabel,
      unitCount: descriptor.unitCount,
      extractedCharacters: descriptor.extractedCharacters,
      truncated: descriptor.truncated,
      textAvailable: descriptor.textAvailable,
      visualAvailable: descriptor.visualAvailable,
      ...(descriptor.reconstructionNotice
        ? { reconstructionNotice: descriptor.reconstructionNotice }
        : {}),
    }));
  }

  read(attachmentId: string, startUnit: number, unitCount: number, maxCharacters: number) {
    if (this.revoked) return null;
    const record = this.records.get(attachmentId);
    if (!record || !record.descriptor.textAvailable || startUnit > record.descriptor.unitCount) {
      return null;
    }
    const endUnit = Math.min(record.descriptor.unitCount, startUnit + unitCount - 1);
    const selectedUnits = record.units.filter(
      (unit) => unit.unitNumber >= startUnit && unit.unitNumber <= endUnit,
    );
    const fullContent = selectedUnits
      .map((unit) => `--- ${record.descriptor.unitLabel} ${unit.unitNumber} ---\n${unit.text}`)
      .join('\n\n');
    const content = fullContent.slice(0, maxCharacters);
    const extractedThroughUnit = record.units.at(-1)?.unitNumber ?? 0;
    return {
      attachmentId,
      label: record.label,
      sourceSha256: record.descriptor.sha256,
      kind: record.descriptor.kind,
      format: record.descriptor.format,
      unitLabel: record.descriptor.unitLabel,
      unitCount: record.descriptor.unitCount,
      startUnit,
      endUnit,
      content,
      contentSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
      truncated:
        content.length < fullContent.length ||
        record.descriptor.truncated ||
        endUnit > extractedThroughUnit,
      ...(record.descriptor.reconstructionNotice
        ? { reconstructionNotice: record.descriptor.reconstructionNotice }
        : {}),
    };
  }

  nativeImages() {
    if (this.revoked) return [];
    return [...this.records.values()].flatMap((record) =>
      record.ephemeralImage
        ? [
            {
              attachmentId: record.descriptor.id,
              label: record.label,
              sourceSha256: record.descriptor.sha256,
              path: record.ephemeralImage.path,
            },
          ]
        : [],
    );
  }

  async revoke() {
    if (this.revoked) return;
    this.revoked = true;
    const attachmentCount = this.records.size;
    const images = [...this.records.values()].flatMap((record) =>
      record.ephemeralImage ? [record.ephemeralImage] : [],
    );
    this.records.clear();
    try {
      await Promise.all(images.map((image) => this.cleanupImage(image)));
    } finally {
      this.releaseCapacity(attachmentCount);
    }
  }
}

async function readBoundedAttachment(path: string) {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const status = await handle.stat();
    if (!status.isFile() || status.size <= 0 || status.size > PROJECT_CHAT_MAX_ATTACHMENT_BYTES) {
      throw new ProjectChatAttachmentError(
        status.size > PROJECT_CHAT_MAX_ATTACHMENT_BYTES
          ? 'attachment_too_large'
          : 'attachment_invalid',
      );
    }
    const bytes = Buffer.allocUnsafe(status.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset !== bytes.length) throw new ProjectChatAttachmentError('attachment_invalid');
    const extra = Buffer.allocUnsafe(1);
    if ((await handle.read(extra, 0, 1, offset)).bytesRead !== 0) {
      throw new ProjectChatAttachmentError('attachment_too_large');
    }
    return bytes;
  } catch (error) {
    if (error instanceof ProjectChatAttachmentError) throw error;
    throw new ProjectChatAttachmentError('attachment_invalid');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function definitionForPath(path: string) {
  return FORMAT_BY_EXTENSION[extname(path).toLocaleLowerCase()] ?? null;
}

function mapPdfExtractionError(code: ProjectChatPdfExtractionError['code']) {
  if (code === 'pdf_attachment_encrypted') return 'attachment_encrypted' as const;
  if (code === 'pdf_attachment_page_limit') return 'attachment_too_large' as const;
  if (code === 'pdf_attachment_invalid') return 'attachment_invalid' as const;
  return 'attachment_extraction_failed' as const;
}

async function stageNormalizedImage(image: NormalizedProjectChatImage) {
  const directory = await mkdtemp(join(tmpdir(), 'gosu-chat-image-'));
  try {
    await chmod(directory, 0o700);
    const path = join(directory, `${randomUUID()}.jpg`);
    await writeFile(path, image.bytes, { flag: 'wx', mode: 0o600 });
    return { path, directory } as const;
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function pdfAsDocument(extracted: ExtractedProjectChatPdf): ExtractedAttachmentText {
  return {
    unitLabel: 'page',
    unitCount: extracted.pageCount,
    units: extracted.pages.map((page) => ({ unitNumber: page.pageNumber, text: page.text })),
    extractedCharacters: extracted.extractedCharacters,
    truncated: extracted.truncated,
    textAvailable: extracted.textAvailable,
    reconstructionNotice:
      'Selectable PDF text; figures, scans, and page layout are not reconstructed.',
  };
}

function isDocumentFormat(
  format: ProjectChatAttachmentFormat,
): format is Exclude<ProjectChatDocumentFormat, 'ppt'> {
  return ['docx', 'pptx', 'hwpx', 'text', 'markdown', 'csv', 'json', 'latex'].includes(format);
}

function isImageFormat(format: ProjectChatAttachmentFormat): format is ProjectChatImageFormat {
  return ['png', 'jpeg', 'gif', 'webp', 'tiff', 'bmp', 'avif'].includes(format);
}

export class ProjectChatAttachmentService {
  private readonly staged = new Map<string, StagedAttachment>();
  private readonly ephemeralImageDirectories = new Set<string>();
  private claimedAttachmentCount = 0;
  private pendingAttachmentReservations = 0;
  private pendingImageReservations = 0;

  constructor(
    private readonly dependencies: {
      chooseFiles: () => Promise<readonly string[]>;
      extractPdf?: (bytes: Uint8Array, maxCharacters: number) => Promise<ExtractedProjectChatPdf>;
      extractDocument?: (
        format: ProjectChatDocumentFormat,
        bytes: Uint8Array,
        maxCharacters: number,
      ) => Promise<ExtractedProjectChatDocument>;
      normalizeImage?: (
        format: ProjectChatImageFormat,
        bytes: Uint8Array,
      ) => Promise<NormalizedProjectChatImage>;
      stageImage?: (image: NormalizedProjectChatImage) => Promise<EphemeralImage>;
      validateScope?: (projectId: string, sessionId: string) => Promise<void>;
      now?: () => number;
    },
  ) {}

  async choose(input: ChooseProjectChatAttachmentsInput) {
    const command = ChooseProjectChatAttachmentsInputSchema.parse(input);
    try {
      await this.dependencies.validateScope?.(command.projectId, command.sessionId);
    } catch {
      throw new ProjectChatAttachmentError('attachment_scope_mismatch');
    }
    const paths = await this.dependencies.chooseFiles();
    if (paths.length === 0) return [];
    if (paths.length > PROJECT_CHAT_MAX_ATTACHMENTS) {
      throw new ProjectChatAttachmentError('attachment_too_many');
    }
    if (new Set(paths).size !== paths.length) {
      throw new ProjectChatAttachmentError('attachment_invalid');
    }
    const selections = paths.map((path) => {
      const definition = definitionForPath(path);
      if (!definition) throw new ProjectChatAttachmentError('attachment_unsupported');
      return { path, definition } as const;
    });
    const imageSelectionCount = selections.filter(({ definition }) =>
      isImageFormat(definition.format),
    ).length;
    if (
      this.staged.size +
        this.claimedAttachmentCount +
        this.pendingAttachmentReservations +
        selections.length >
        MAX_LIVE_ATTACHMENT_CAPABILITIES ||
      this.ephemeralImageDirectories.size + this.pendingImageReservations + imageSelectionCount >
        MAX_LIVE_NORMALIZED_IMAGES
    ) {
      throw new ProjectChatAttachmentError('attachment_capacity_exhausted');
    }
    this.pendingAttachmentReservations += selections.length;
    this.pendingImageReservations += imageSelectionCount;
    try {
      const textSelectionCount = selections.length - imageSelectionCount;
      const perFileCharacterBudget = Math.floor(
        PROJECT_CHAT_MAX_ATTACHMENT_EXTRACTED_CHARACTERS / Math.max(1, textSelectionCount),
      );
      const prepared: Array<{
        descriptor: ProjectChatAttachment;
        units: readonly ExtractedAttachmentUnit[];
        ephemeralImage?: EphemeralImage;
      }> = [];
      try {
        const files = [] as Array<{
          path: string;
          definition: AttachmentFormatDefinition;
          bytes: Buffer;
        }>;
        let totalBytes = 0;
        for (const { path, definition } of selections) {
          const bytes = await readBoundedAttachment(path);
          totalBytes += bytes.byteLength;
          if (totalBytes > PROJECT_CHAT_MAX_TOTAL_ATTACHMENT_BYTES) {
            throw new ProjectChatAttachmentError('attachment_total_too_large');
          }
          files.push({ path, definition, bytes });
        }

        for (const { path, definition, bytes } of files) {
          const now = this.dependencies.now?.() ?? Date.now();
          if (isImageFormat(definition.format)) {
            const image = await (this.dependencies.normalizeImage ?? normalizeProjectChatImage)(
              definition.format,
              new Uint8Array(bytes),
            );
            const ephemeralImage = await (this.dependencies.stageImage ?? stageNormalizedImage)(
              image,
            );
            this.ephemeralImageDirectories.add(ephemeralImage.directory);
            const descriptor = ProjectChatAttachmentSchema.parse({
              id: randomUUID(),
              projectId: command.projectId,
              sessionId: command.sessionId,
              kind: 'image',
              format: definition.format,
              mediaType: definition.mediaType,
              displayName: safeDisplayName(path),
              byteSize: bytes.byteLength,
              sha256: createHash('sha256').update(bytes).digest('hex'),
              unitLabel: 'image',
              unitCount: 1,
              extractedCharacters: 0,
              truncated: image.sourceFrameCount > 1,
              textAvailable: false,
              visualAvailable: true,
              reconstructionNotice:
                image.sourceFrameCount > 1
                  ? 'The first frame is shown; animation and source metadata are omitted.'
                  : 'A metadata-free normalized image is shown to the selected multimodal model.',
              imageWidth: image.width,
              imageHeight: image.height,
              expiresAt: new Date(now + ATTACHMENT_TTL_MS).toISOString(),
            });
            prepared.push({ descriptor, units: [], ephemeralImage });
            continue;
          }

          let extracted: ExtractedAttachmentText;
          if (definition.format === 'pdf') {
            extracted = pdfAsDocument(
              await (this.dependencies.extractPdf ?? extractProjectChatPdf)(
                new Uint8Array(bytes),
                perFileCharacterBudget,
              ),
            );
          } else if (isDocumentFormat(definition.format)) {
            extracted = await (this.dependencies.extractDocument ?? extractProjectChatDocument)(
              definition.format,
              new Uint8Array(bytes),
              perFileCharacterBudget,
            );
          } else {
            throw new ProjectChatAttachmentError('attachment_unsupported');
          }
          const descriptor = ProjectChatAttachmentSchema.parse({
            id: randomUUID(),
            projectId: command.projectId,
            sessionId: command.sessionId,
            kind: definition.kind,
            format: definition.format,
            mediaType: definition.mediaType,
            displayName: safeDisplayName(path),
            byteSize: bytes.byteLength,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            unitLabel: extracted.unitLabel,
            unitCount: extracted.unitCount,
            extractedCharacters: extracted.extractedCharacters,
            truncated: extracted.truncated,
            textAvailable: extracted.textAvailable,
            visualAvailable: false,
            reconstructionNotice: extracted.reconstructionNotice,
            expiresAt: new Date(now + ATTACHMENT_TTL_MS).toISOString(),
          });
          prepared.push({ descriptor, units: extracted.units });
        }
      } catch (error) {
        await Promise.all(
          prepared.map((item) =>
            item.ephemeralImage
              ? this.cleanupEphemeralImage(item.ephemeralImage).catch(() => undefined)
              : Promise.resolve(),
          ),
        );
        if (error instanceof ProjectChatAttachmentError) throw error;
        if (error instanceof ProjectChatPdfExtractionError) {
          throw new ProjectChatAttachmentError(mapPdfExtractionError(error.code));
        }
        if (
          error instanceof ProjectChatDocumentExtractionError ||
          error instanceof ProjectChatImageExtractionError
        ) {
          throw new ProjectChatAttachmentError(error.code);
        }
        throw new ProjectChatAttachmentError('attachment_extraction_failed');
      }
      for (const item of prepared) {
        const timer = setTimeout(() => {
          const current = this.staged.get(item.descriptor.id);
          if (current?.descriptor !== item.descriptor) return;
          this.staged.delete(item.descriptor.id);
          if (current.ephemeralImage) {
            void this.cleanupEphemeralImage(current.ephemeralImage).catch(() => undefined);
          }
        }, ATTACHMENT_TTL_MS);
        timer.unref?.();
        this.staged.set(item.descriptor.id, { ...item, timer });
      }
      return prepared.map((item) => structuredClone(item.descriptor));
    } finally {
      this.pendingAttachmentReservations -= selections.length;
      this.pendingImageReservations -= imageSelectionCount;
    }
  }

  async release(input: ReleaseProjectChatAttachmentInput) {
    const command = ReleaseProjectChatAttachmentInputSchema.parse(input);
    const record = this.staged.get(command.attachmentId);
    if (
      record &&
      (record.descriptor.projectId !== command.projectId ||
        record.descriptor.sessionId !== command.sessionId)
    ) {
      throw new ProjectChatAttachmentError('attachment_scope_mismatch');
    }
    if (record) {
      clearTimeout(record.timer);
      this.staged.delete(command.attachmentId);
      if (record.ephemeralImage) {
        await this.cleanupEphemeralImage(record.ephemeralImage);
      }
    }
    return { released: true } as const;
  }

  claim(projectId: string, sessionId: string, attachmentIds: readonly string[]) {
    const records = this.validateRecords(projectId, sessionId, attachmentIds);
    for (const record of records) {
      clearTimeout(record.timer);
      this.staged.delete(record.descriptor.id);
    }
    this.claimedAttachmentCount += records.length;
    return new ClaimedProjectChatAttachments(
      records,
      (image) => this.cleanupEphemeralImage(image),
      (attachmentCount) => {
        this.claimedAttachmentCount = Math.max(0, this.claimedAttachmentCount - attachmentCount);
      },
    );
  }

  validate(projectId: string, sessionId: string, attachmentIds: readonly string[]) {
    this.validateRecords(projectId, sessionId, attachmentIds);
  }

  private validateRecords(projectId: string, sessionId: string, attachmentIds: readonly string[]) {
    if (attachmentIds.length > PROJECT_CHAT_MAX_ATTACHMENTS) {
      throw new ProjectChatAttachmentError('attachment_too_many');
    }
    if (new Set(attachmentIds).size !== attachmentIds.length) {
      throw new ProjectChatAttachmentError('attachment_invalid');
    }
    const now = this.dependencies.now?.() ?? Date.now();
    const records = attachmentIds.map((attachmentId) => {
      const record = this.staged.get(attachmentId);
      if (!record || Date.parse(record.descriptor.expiresAt) <= now) {
        throw new ProjectChatAttachmentError('attachment_expired');
      }
      if (record.descriptor.projectId !== projectId || record.descriptor.sessionId !== sessionId) {
        throw new ProjectChatAttachmentError('attachment_scope_mismatch');
      }
      return record;
    });
    if (
      records.reduce((total, record) => total + record.descriptor.byteSize, 0) >
      PROJECT_CHAT_MAX_TOTAL_ATTACHMENT_BYTES
    ) {
      throw new ProjectChatAttachmentError('attachment_total_too_large');
    }
    return records;
  }

  async dispose() {
    for (const record of this.staged.values()) {
      clearTimeout(record.timer);
    }
    this.staged.clear();
    await Promise.all(
      [...this.ephemeralImageDirectories].map(async (directory) => {
        await rm(directory, { recursive: true, force: true });
        this.ephemeralImageDirectories.delete(directory);
      }),
    );
  }

  disposeImmediately() {
    for (const record of this.staged.values()) clearTimeout(record.timer);
    this.staged.clear();
    for (const directory of this.ephemeralImageDirectories) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        // Keep application shutdown progressing. The age-bounded startup sweep handles leftovers.
      } finally {
        this.ephemeralImageDirectories.delete(directory);
      }
    }
  }

  private async cleanupEphemeralImage(image: EphemeralImage) {
    await rm(image.directory, { recursive: true, force: true });
    this.ephemeralImageDirectories.delete(image.directory);
  }
}
