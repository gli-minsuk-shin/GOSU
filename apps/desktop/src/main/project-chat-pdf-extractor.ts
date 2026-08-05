import type { PDFDocumentLoadingTask, TextItem } from 'pdfjs-dist/types/src/display/api';

import {
  PROJECT_CHAT_MAX_PDF_EXTRACTED_CHARACTERS,
  PROJECT_CHAT_MAX_PDF_PAGES,
} from '../shared/project-chat-attachment-contracts';

export type ExtractedPdfPage = Readonly<{ pageNumber: number; text: string }>;

export type ExtractedProjectChatPdf = Readonly<{
  pageCount: number;
  pages: readonly ExtractedPdfPage[];
  extractedCharacters: number;
  truncated: boolean;
  textAvailable: boolean;
}>;

export class ProjectChatPdfExtractionError extends Error {
  constructor(
    readonly code:
      | 'pdf_attachment_encrypted'
      | 'pdf_attachment_page_limit'
      | 'pdf_attachment_invalid'
      | 'pdf_attachment_extraction_failed',
  ) {
    super(code);
    this.name = 'ProjectChatPdfExtractionError';
  }
}

function pageText(items: readonly unknown[]) {
  let text = '';
  for (const item of items) {
    if (!item || typeof item !== 'object' || !('str' in item)) continue;
    const candidate = item as TextItem;
    text += candidate.str;
    text += candidate.hasEOL ? '\n' : ' ';
  }
  return text
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
}

export async function extractProjectChatPdf(
  bytes: Uint8Array,
  maxCharacters = PROJECT_CHAT_MAX_PDF_EXTRACTED_CHARACTERS,
  timeoutMs = 15_000,
): Promise<ExtractedProjectChatPdf> {
  const boundedCharacters = Math.max(
    1,
    Math.min(Math.trunc(maxCharacters), PROJECT_CHAT_MAX_PDF_EXTRACTED_CHARACTERS),
  );
  let loadingTask: PDFDocumentLoadingTask | undefined;
  let timeout: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    loadingTask = pdfjs.getDocument({
      data: bytes.slice(),
      stopAtErrors: true,
      useWasm: false,
      useWorkerFetch: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      maxImageSize: 0,
      disableFontFace: true,
      enableXfa: false,
      verbosity: 0,
    });
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        void loadingTask?.destroy().catch(() => undefined);
        reject(new ProjectChatPdfExtractionError('pdf_attachment_extraction_failed'));
      }, timeoutMs);
      timeout.unref?.();
    });
    const document = await Promise.race([loadingTask.promise, timeoutPromise]);
    if (document.numPages < 1) {
      throw new ProjectChatPdfExtractionError('pdf_attachment_invalid');
    }
    if (document.numPages > PROJECT_CHAT_MAX_PDF_PAGES) {
      throw new ProjectChatPdfExtractionError('pdf_attachment_page_limit');
    }
    const pages: ExtractedPdfPage[] = [];
    let remaining = boundedCharacters;
    let sourceTruncated = false;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (timedOut) {
        throw new ProjectChatPdfExtractionError('pdf_attachment_extraction_failed');
      }
      if (remaining <= 0) {
        sourceTruncated = true;
        break;
      }
      const page = await Promise.race([document.getPage(pageNumber), timeoutPromise]);
      try {
        const content = await Promise.race([
          page.getTextContent({ includeMarkedContent: false, disableNormalization: false }),
          timeoutPromise,
        ]);
        const fullText = pageText(content.items);
        const text = fullText.slice(0, remaining);
        if (text.length < fullText.length) sourceTruncated = true;
        pages.push({ pageNumber, text });
        remaining -= text.length;
      } finally {
        page.cleanup();
      }
    }
    const extractedCharacters = pages.reduce((total, page) => total + page.text.length, 0);
    return {
      pageCount: document.numPages,
      pages,
      extractedCharacters,
      truncated: sourceTruncated || pages.length < document.numPages,
      textAvailable: pages.some((page) => page.text.trim().length > 0),
    };
  } catch (error) {
    if (error instanceof ProjectChatPdfExtractionError) throw error;
    const name = error instanceof Error ? error.name : '';
    if (name === 'PasswordException') {
      throw new ProjectChatPdfExtractionError('pdf_attachment_encrypted');
    }
    if (name === 'InvalidPDFException' || name === 'MissingPDFException') {
      throw new ProjectChatPdfExtractionError('pdf_attachment_invalid');
    }
    throw new ProjectChatPdfExtractionError('pdf_attachment_extraction_failed');
  } finally {
    if (timeout) clearTimeout(timeout);
    await loadingTask?.destroy().catch(() => undefined);
  }
}
