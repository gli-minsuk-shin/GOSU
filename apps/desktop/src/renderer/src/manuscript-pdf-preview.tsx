import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

import type { ManuscriptPdfPreview as ManuscriptPdfPreviewValue } from '../../shared/manuscript-workspace-contracts';

export const MANUSCRIPT_PDF_MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
export const MANUSCRIPT_PDF_MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
export const MANUSCRIPT_PDF_MAX_CANVAS_DIMENSION = 8_192;

function decodeBase64(value: string) {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function boundedManuscriptPdfCanvasDimensions(
  viewportWidth: number,
  viewportHeight: number,
  requestedPixelRatio: number,
) {
  const cssWidth = Math.ceil(viewportWidth);
  const cssHeight = Math.ceil(viewportHeight);
  const pixelRatio = Math.min(Math.max(requestedPixelRatio, 1), 2);
  const pixelWidth = Math.ceil(viewportWidth * pixelRatio);
  const pixelHeight = Math.ceil(viewportHeight * pixelRatio);
  const pixelCount = pixelWidth * pixelHeight;
  if (
    !Number.isSafeInteger(cssWidth) ||
    !Number.isSafeInteger(cssHeight) ||
    !Number.isSafeInteger(pixelWidth) ||
    !Number.isSafeInteger(pixelHeight) ||
    !Number.isSafeInteger(pixelCount) ||
    cssWidth < 1 ||
    cssHeight < 1 ||
    pixelWidth < 1 ||
    pixelHeight < 1 ||
    pixelWidth > MANUSCRIPT_PDF_MAX_CANVAS_DIMENSION ||
    pixelHeight > MANUSCRIPT_PDF_MAX_CANVAS_DIMENSION ||
    pixelCount > MANUSCRIPT_PDF_MAX_CANVAS_PIXELS
  ) {
    throw new Error('manuscript_pdf_page_too_large');
  }
  return { cssWidth, cssHeight, pixelWidth, pixelHeight, pixelRatio } as const;
}

export function ManuscriptPdfPreview({ preview }: { preview: ManuscriptPdfPreviewValue }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setLoading(true);
    setError(null);
    setPageNumber(1);
    setDocument(null);
    void import('pdfjs-dist/legacy/build/pdf.mjs')
      .then((pdfjs) => {
        if (cancelled) return null;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = pdfjs.getDocument({
          data: decodeBase64(preview.pdfBase64),
          useSystemFonts: true,
          maxImageSize: MANUSCRIPT_PDF_MAX_IMAGE_PIXELS,
          stopAtErrors: true,
        });
        return loadingTask.promise;
      })
      .then((next) => {
        if (!next) return;
        if (cancelled) return;
        setDocument(next);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setError('The locally compiled PDF could not be rendered safely.');
        }
      });
    return () => {
      cancelled = true;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [preview.artifactId, preview.pdfBase64]);

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { cancel(): void; promise: Promise<unknown> } | null = null;
    setError(null);
    void document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled || !canvasRef.current) return;
        const viewport = page.getViewport({ scale });
        const dimensions = boundedManuscriptPdfCanvasDimensions(
          viewport.width,
          viewport.height,
          window.devicePixelRatio || 1,
        );
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('canvas_unavailable');
        canvas.width = dimensions.pixelWidth;
        canvas.height = dimensions.pixelHeight;
        canvas.style.width = `${dimensions.cssWidth}px`;
        canvas.style.height = `${dimensions.cssHeight}px`;
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform:
            dimensions.pixelRatio === 1
              ? undefined
              : [dimensions.pixelRatio, 0, 0, dimensions.pixelRatio, 0, 0],
        });
        return renderTask.promise;
      })
      .catch((renderError) => {
        if (
          !cancelled &&
          !(renderError instanceof Error && renderError.name === 'RenderingCancelledException')
        ) {
          setError('This PDF page could not be rendered.');
        }
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, scale]);

  return (
    <section className="manuscript-pdf-preview" aria-label="Compiled manuscript PDF preview">
      <header>
        <div>
          <strong>Compiled PDF</strong>
          <span>
            Local {preview.compiler.engineDisplayName} via {preview.compiler.displayName} ·{' '}
            {preview.rootDocument} · revision {preview.providerRevision.slice(0, 12)}
          </span>
        </div>
        {preview.providerAhead && <b>Overleaf has a newer observed revision</b>}
        <div className="manuscript-pdf-controls">
          <button
            type="button"
            className="ghost-button"
            disabled={!document || pageNumber <= 1}
            onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
          >
            Previous
          </button>
          <span>{document ? `${pageNumber} / ${document.numPages}` : 'Loading'}</span>
          <button
            type="button"
            className="ghost-button"
            disabled={!document || pageNumber >= document.numPages}
            onClick={() =>
              setPageNumber((current) => Math.min(document?.numPages ?? current, current + 1))
            }
          >
            Next
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={!document || scale <= 0.6}
            onClick={() => setScale((current) => Math.max(0.6, current - 0.15))}
          >
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="ghost-button"
            disabled={!document || scale >= 2}
            onClick={() => setScale((current) => Math.min(2, current + 0.15))}
          >
            ＋
          </button>
        </div>
      </header>
      <div className="manuscript-pdf-canvas-wrap" aria-busy={loading}>
        {loading && <span>Rendering the compiled PDF…</span>}
        {error && <span role="alert">{error}</span>}
        <canvas ref={canvasRef} hidden={loading || Boolean(error)} />
      </div>
    </section>
  );
}
