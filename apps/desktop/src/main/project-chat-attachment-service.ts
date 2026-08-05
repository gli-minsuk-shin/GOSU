import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import {
  ChooseProjectChatPdfAttachmentsInputSchema,
  PROJECT_CHAT_MAX_PDF_ATTACHMENTS,
  PROJECT_CHAT_MAX_PDF_BYTES,
  PROJECT_CHAT_MAX_PDF_EXTRACTED_CHARACTERS,
  ProjectChatPdfAttachmentSchema,
  ReleaseProjectChatPdfAttachmentInputSchema,
  type ChooseProjectChatPdfAttachmentsInput,
  type ProjectChatPdfAttachment,
  type ReleaseProjectChatPdfAttachmentInput,
} from '../shared/project-chat-attachment-contracts';
import {
  extractProjectChatPdf,
  ProjectChatPdfExtractionError,
  type ExtractedPdfPage,
  type ExtractedProjectChatPdf,
} from './project-chat-pdf-extractor';

const ATTACHMENT_TTL_MS = 15 * 60 * 1_000;
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

function safeDisplayName(path: string) {
  const singleLine = [...basename(path)]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || (code >= 127 && code <= 159) ? ' ' : character;
    })
    .join('');
  return singleLine.replace(/\s+/gu, ' ').trim().slice(0, 255) || 'Attached PDF';
}

export type ProjectChatPdfAttachmentErrorCode =
  | 'pdf_attachment_invalid'
  | 'pdf_attachment_too_large'
  | 'pdf_attachment_too_many'
  | 'pdf_attachment_encrypted'
  | 'pdf_attachment_page_limit'
  | 'pdf_attachment_extraction_failed'
  | 'pdf_attachment_expired'
  | 'pdf_attachment_scope_mismatch';

export class ProjectChatPdfAttachmentError extends Error {
  constructor(readonly code: ProjectChatPdfAttachmentErrorCode) {
    super(code);
    this.name = 'ProjectChatPdfAttachmentError';
  }
}

export type AgentPdfAttachmentCatalogItem = Readonly<{
  attachmentId: string;
  label: string;
  sourceSha256: string;
  pageCount: number;
  extractedCharacters: number;
  truncated: boolean;
  textAvailable: boolean;
}>;

export type AgentPdfAttachmentChunk = Readonly<{
  attachmentId: string;
  label: string;
  sourceSha256: string;
  pageCount: number;
  startPage: number;
  endPage: number;
  content: string;
  contentSha256: string;
  truncated: boolean;
}>;

export interface ProjectChatPdfAttachmentsForAgent {
  catalog(): readonly AgentPdfAttachmentCatalogItem[];
  read(
    attachmentId: string,
    startPage: number,
    pageCount: number,
    maxCharacters: number,
  ): AgentPdfAttachmentChunk | null;
  revoke(): void;
}

export interface ProjectChatPdfAttachmentClaimer {
  claim(
    projectId: string,
    sessionId: string,
    attachmentIds: readonly string[],
  ): ProjectChatPdfAttachmentsForAgent;
}

type StagedAttachment = {
  descriptor: ProjectChatPdfAttachment;
  pages: readonly ExtractedPdfPage[];
  timer: NodeJS.Timeout;
};

class ClaimedProjectChatPdfAttachments implements ProjectChatPdfAttachmentsForAgent {
  private readonly records = new Map<
    string,
    Readonly<{
      descriptor: ProjectChatPdfAttachment;
      label: string;
      pages: readonly ExtractedPdfPage[];
    }>
  >();

  constructor(records: readonly StagedAttachment[]) {
    for (const [index, record] of records.entries()) {
      this.records.set(record.descriptor.id, {
        descriptor: record.descriptor,
        label: `PDF ${index + 1}`,
        pages: record.pages,
      });
    }
  }

  catalog() {
    return [...this.records.values()].map(({ descriptor, label }) => ({
      attachmentId: descriptor.id,
      label,
      sourceSha256: descriptor.sha256,
      pageCount: descriptor.pageCount,
      extractedCharacters: descriptor.extractedCharacters,
      truncated: descriptor.truncated,
      textAvailable: descriptor.textAvailable,
    }));
  }

  read(attachmentId: string, startPage: number, pageCount: number, maxCharacters: number) {
    const record = this.records.get(attachmentId);
    if (!record || startPage > record.descriptor.pageCount) return null;
    const endPage = Math.min(record.descriptor.pageCount, startPage + pageCount - 1);
    const selectedPages = record.pages.filter(
      (page) => page.pageNumber >= startPage && page.pageNumber <= endPage,
    );
    const fullContent = selectedPages
      .map((page) => `--- page ${page.pageNumber} ---\n${page.text}`)
      .join('\n\n');
    const content = fullContent.slice(0, maxCharacters);
    const extractedThroughPage = record.pages.at(-1)?.pageNumber ?? 0;
    return {
      attachmentId,
      label: record.label,
      sourceSha256: record.descriptor.sha256,
      pageCount: record.descriptor.pageCount,
      startPage,
      endPage,
      content,
      contentSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
      truncated:
        content.length < fullContent.length ||
        record.descriptor.truncated ||
        endPage > extractedThroughPage,
    };
  }

  revoke() {
    this.records.clear();
  }
}

async function readBoundedPdf(path: string) {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const status = await handle.stat();
    if (
      !status.isFile() ||
      status.size < PDF_MAGIC.length ||
      status.size > PROJECT_CHAT_MAX_PDF_BYTES
    ) {
      throw new ProjectChatPdfAttachmentError(
        status.size > PROJECT_CHAT_MAX_PDF_BYTES
          ? 'pdf_attachment_too_large'
          : 'pdf_attachment_invalid',
      );
    }
    const bytes = Buffer.allocUnsafe(status.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset !== bytes.length) throw new ProjectChatPdfAttachmentError('pdf_attachment_invalid');
    const extra = Buffer.allocUnsafe(1);
    if ((await handle.read(extra, 0, 1, offset)).bytesRead !== 0) {
      throw new ProjectChatPdfAttachmentError('pdf_attachment_too_large');
    }
    if (!bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      throw new ProjectChatPdfAttachmentError('pdf_attachment_invalid');
    }
    return bytes;
  } catch (error) {
    if (error instanceof ProjectChatPdfAttachmentError) throw error;
    throw new ProjectChatPdfAttachmentError('pdf_attachment_invalid');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export class ProjectChatAttachmentService {
  private readonly staged = new Map<string, StagedAttachment>();

  constructor(
    private readonly dependencies: {
      choosePdfFiles: () => Promise<readonly string[]>;
      extractPdf?: (bytes: Uint8Array, maxCharacters: number) => Promise<ExtractedProjectChatPdf>;
      validateScope?: (projectId: string, sessionId: string) => Promise<void>;
      now?: () => number;
    },
  ) {}

  async choose(input: ChooseProjectChatPdfAttachmentsInput) {
    const command = ChooseProjectChatPdfAttachmentsInputSchema.parse(input);
    try {
      await this.dependencies.validateScope?.(command.projectId, command.sessionId);
    } catch {
      throw new ProjectChatPdfAttachmentError('pdf_attachment_scope_mismatch');
    }
    const paths = await this.dependencies.choosePdfFiles();
    if (paths.length === 0) return [];
    if (paths.length > PROJECT_CHAT_MAX_PDF_ATTACHMENTS) {
      throw new ProjectChatPdfAttachmentError('pdf_attachment_too_many');
    }
    const perFileCharacterBudget = Math.floor(
      PROJECT_CHAT_MAX_PDF_EXTRACTED_CHARACTERS / paths.length,
    );
    const prepared: Array<{
      descriptor: ProjectChatPdfAttachment;
      pages: readonly ExtractedPdfPage[];
    }> = [];
    try {
      for (const path of paths) {
        if (extname(path).toLocaleLowerCase() !== '.pdf') {
          throw new ProjectChatPdfAttachmentError('pdf_attachment_invalid');
        }
        const bytes = await readBoundedPdf(path);
        const extracted = await (this.dependencies.extractPdf ?? extractProjectChatPdf)(
          new Uint8Array(bytes),
          perFileCharacterBudget,
        );
        const now = this.dependencies.now?.() ?? Date.now();
        const descriptor = ProjectChatPdfAttachmentSchema.parse({
          id: randomUUID(),
          projectId: command.projectId,
          sessionId: command.sessionId,
          kind: 'pdf',
          displayName: safeDisplayName(path),
          byteSize: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          pageCount: extracted.pageCount,
          extractedCharacters: extracted.extractedCharacters,
          truncated: extracted.truncated,
          textAvailable: extracted.textAvailable,
          expiresAt: new Date(now + ATTACHMENT_TTL_MS).toISOString(),
        });
        prepared.push({ descriptor, pages: extracted.pages });
      }
    } catch (error) {
      if (error instanceof ProjectChatPdfAttachmentError) throw error;
      if (error instanceof ProjectChatPdfExtractionError) {
        throw new ProjectChatPdfAttachmentError(error.code);
      }
      throw new ProjectChatPdfAttachmentError('pdf_attachment_extraction_failed');
    }
    for (const item of prepared) {
      const timer = setTimeout(() => {
        const current = this.staged.get(item.descriptor.id);
        if (current?.descriptor === item.descriptor) this.staged.delete(item.descriptor.id);
      }, ATTACHMENT_TTL_MS);
      timer.unref?.();
      this.staged.set(item.descriptor.id, { ...item, timer });
    }
    return prepared.map((item) => structuredClone(item.descriptor));
  }

  async release(input: ReleaseProjectChatPdfAttachmentInput) {
    const command = ReleaseProjectChatPdfAttachmentInputSchema.parse(input);
    const record = this.staged.get(command.attachmentId);
    if (
      record &&
      (record.descriptor.projectId !== command.projectId ||
        record.descriptor.sessionId !== command.sessionId)
    ) {
      throw new ProjectChatPdfAttachmentError('pdf_attachment_scope_mismatch');
    }
    if (record) {
      clearTimeout(record.timer);
      this.staged.delete(command.attachmentId);
    }
    return { released: true } as const;
  }

  claim(projectId: string, sessionId: string, attachmentIds: readonly string[]) {
    if (attachmentIds.length > PROJECT_CHAT_MAX_PDF_ATTACHMENTS) {
      throw new ProjectChatPdfAttachmentError('pdf_attachment_too_many');
    }
    if (new Set(attachmentIds).size !== attachmentIds.length) {
      throw new ProjectChatPdfAttachmentError('pdf_attachment_invalid');
    }
    const now = this.dependencies.now?.() ?? Date.now();
    const records = attachmentIds.map((attachmentId) => {
      const record = this.staged.get(attachmentId);
      if (!record || Date.parse(record.descriptor.expiresAt) <= now) {
        throw new ProjectChatPdfAttachmentError('pdf_attachment_expired');
      }
      if (record.descriptor.projectId !== projectId || record.descriptor.sessionId !== sessionId) {
        throw new ProjectChatPdfAttachmentError('pdf_attachment_scope_mismatch');
      }
      return record;
    });
    for (const record of records) {
      clearTimeout(record.timer);
      this.staged.delete(record.descriptor.id);
    }
    return new ClaimedProjectChatPdfAttachments(records);
  }

  dispose() {
    for (const record of this.staged.values()) clearTimeout(record.timer);
    this.staged.clear();
  }
}
