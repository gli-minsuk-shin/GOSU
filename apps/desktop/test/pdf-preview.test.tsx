import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { PdfPreviewDocument } from '../src/shared/pdf-preview-contracts';
import {
  boundedPdfCanvasDimensions,
  PdfPreview,
  resolvePdfCurrentPage,
} from '../src/renderer/src/pdf-preview';

const document: PdfPreviewDocument = {
  schemaVersion: 1,
  artifactId: '11111111-1111-4111-8111-111111111111',
  title: 'Lecture notes PDF',
  fileName: 'lecture-notes.pdf',
  compilerDisplayName: 'Local XeLaTeX',
  sourceDescription: 'Lecture revision 3',
  pdfSha256: `sha256:${'a'.repeat(64)}`,
  sizeBytes: 16,
  compiledAt: '2026-08-13T00:00:00.000Z',
  pdfBase64: Buffer.from('%PDF-1.7\n%%EOF').toString('base64'),
};

describe('neutral PDF preview', () => {
  it('renders metadata and never emits the PDF bytes into static markup', () => {
    const html = renderToStaticMarkup(<PdfPreview document={document} workspaceHeight />);

    expect(html).toContain('Lecture notes PDF');
    expect(html).toContain('Local XeLaTeX');
    expect(html).toContain('Lecture revision 3');
    expect(html).toContain('pdf-preview-workspace-height');
    expect(html).not.toContain(document.pdfBase64);
  });

  it('bounds canvas allocation and resolves the page nearest the viewport center', () => {
    expect(boundedPdfCanvasDimensions(612, 792, 2)).toEqual({
      cssWidth: 612,
      cssHeight: 792,
      pixelWidth: 1224,
      pixelHeight: 1584,
      pixelRatio: 2,
    });
    expect(() => boundedPdfCanvasDimensions(20_000, 20_000, 2)).toThrow(
      'pdf_preview_page_too_large',
    );
    expect(
      resolvePdfCurrentPage(920, [
        { pageNumber: 1, top: 0, bottom: 790 },
        { pageNumber: 2, top: 810, bottom: 1_600 },
      ]),
    ).toBe(2);
  });
});
