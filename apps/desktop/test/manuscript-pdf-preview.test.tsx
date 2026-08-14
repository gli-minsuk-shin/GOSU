import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  boundedManuscriptPdfCanvasDimensions,
  MANUSCRIPT_PDF_MAX_CANVAS_DIMENSION,
  MANUSCRIPT_PDF_MAX_CANVAS_PIXELS,
  MANUSCRIPT_PDF_MAX_IMAGE_PIXELS,
  MANUSCRIPT_PDF_MAX_PAGES,
  MANUSCRIPT_PDF_RENDER_RADIUS,
  ManuscriptPdfPreview,
  manuscriptPdfArtifactActionLabels,
  resolveManuscriptPdfCurrentPage,
} from '../src/renderer/src/manuscript-pdf-preview';
import type { ManuscriptPdfPreview as ManuscriptPdfPreviewValue } from '../src/shared/manuscript-workspace-contracts';

const preview: ManuscriptPdfPreviewValue = {
  schemaVersion: 1,
  artifactId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  manuscriptId: '33333333-3333-4333-8333-333333333333',
  checkpointId: '44444444-4444-4444-8444-444444444444',
  providerRevision: 'a'.repeat(40),
  rootDocument: 'main.tex',
  providerAhead: true,
  compiler: {
    kind: 'latexmk',
    displayName: 'MacTeX latexmk',
    version: '4.86',
    engine: 'xelatex',
    engineDisplayName: 'XeLaTeX',
  },
  pdfSha256: 'b'.repeat(64),
  sizeBytes: 1_024,
  compiledAt: '2026-08-12T00:00:00.000Z',
  pdfBase64: 'JVBERi0xLjQK',
};

describe('Manuscript PDF preview', () => {
  it('uses a canvas-only local viewer and labels checkpoint provenance truthfully', () => {
    const html = renderToStaticMarkup(
      <ManuscriptPdfPreview
        preview={preview}
        artifactActions={{
          busy: false,
          status: null,
          onExport: () => undefined,
          onOpen: () => undefined,
          onReveal: () => undefined,
        }}
      />,
    );

    expect(html).toContain('Compiled PDF');
    expect(html).toContain('MacTeX latexmk');
    expect(html).toContain('Local XeLaTeX via');
    expect(html).toContain('main.tex');
    expect(html).toContain('revision aaaaaaaaaaaa');
    expect(html).toContain('Overleaf has a newer observed revision');
    expect(html).toContain('manuscript-pdf-canvas-wrap');
    expect(html).toContain('Previous PDF page');
    expect(html).toContain('Next PDF page');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<object');
    expect(html).not.toContain(preview.pdfBase64);
    for (const label of Object.values(manuscriptPdfArtifactActionLabels())) {
      expect(html).toContain(`aria-label="${label}"`);
      expect(html).toContain(`title="${label}"`);
    }
    expect(html.match(/class="manuscript-pdf-artifact-action-icon"/gu)).toHaveLength(3);
    expect(html.match(/aria-hidden="true"/gu)).toHaveLength(3);
  });

  it('bounds decoded images and canvas allocation before rendering', () => {
    expect(MANUSCRIPT_PDF_MAX_IMAGE_PIXELS).toBe(16 * 1024 * 1024);
    expect(boundedManuscriptPdfCanvasDimensions(612, 792, 2)).toEqual({
      cssWidth: 612,
      cssHeight: 792,
      pixelWidth: 1_224,
      pixelHeight: 1_584,
      pixelRatio: 2,
    });
    expect(() =>
      boundedManuscriptPdfCanvasDimensions(MANUSCRIPT_PDF_MAX_CANVAS_DIMENSION + 1, 1, 1),
    ).toThrow('manuscript_pdf_page_too_large');
    expect(() =>
      boundedManuscriptPdfCanvasDimensions(MANUSCRIPT_PDF_MAX_CANVAS_PIXELS, 2, 1),
    ).toThrow('manuscript_pdf_page_too_large');
    expect(() => boundedManuscriptPdfCanvasDimensions(Number.POSITIVE_INFINITY, 1, 1)).toThrow(
      'manuscript_pdf_page_too_large',
    );
  });

  it('selects the page nearest the viewport center for continuous scrolling', () => {
    const pages = [
      { pageNumber: 1, top: 0, bottom: 500 },
      { pageNumber: 2, top: 518, bottom: 1_018 },
      { pageNumber: 3, top: 1_036, bottom: 1_536 },
    ];

    expect(resolveManuscriptPdfCurrentPage(250, pages)).toBe(1);
    expect(resolveManuscriptPdfCurrentPage(760, pages)).toBe(2);
    expect(resolveManuscriptPdfCurrentPage(1_300, pages)).toBe(3);
    expect(resolveManuscriptPdfCurrentPage(509, pages)).toBe(1);
    expect(resolveManuscriptPdfCurrentPage(510, pages)).toBe(2);
    expect(resolveManuscriptPdfCurrentPage(250, [])).toBeNull();
  });

  it('keeps document size and simultaneous page rendering bounded', () => {
    expect(MANUSCRIPT_PDF_MAX_PAGES).toBe(2_000);
    expect(MANUSCRIPT_PDF_RENDER_RADIUS).toBe(1);
  });
});
