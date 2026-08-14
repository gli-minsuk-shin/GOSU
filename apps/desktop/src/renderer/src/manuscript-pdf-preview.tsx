import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

import type { ManuscriptPdfPreview as ManuscriptPdfPreviewValue } from '../../shared/manuscript-workspace-contracts';

export const MANUSCRIPT_PDF_MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
export const MANUSCRIPT_PDF_MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
export const MANUSCRIPT_PDF_MAX_CANVAS_DIMENSION = 8_192;
export const MANUSCRIPT_PDF_MAX_PAGES = 2_000;
export const MANUSCRIPT_PDF_RENDER_RADIUS = 1;

export type ManuscriptPdfArtifactActions = Readonly<{
  busy: boolean;
  status: string | null;
  onExport(): void;
  onOpen(): void;
  onReveal(): void;
}>;

export function manuscriptPdfArtifactActionLabels() {
  return {
    export: 'Export PDF',
    open: 'Open PDF in default app',
    reveal: 'Show in Finder',
  } as const;
}

function ManuscriptPdfArtifactActionIcon({ kind }: { kind: 'export' | 'open' | 'reveal' }) {
  const path =
    kind === 'export'
      ? 'M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4'
      : kind === 'open'
        ? 'M14 4h6v6m0-6-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5'
        : 'M3.5 7.5V6.75A1.75 1.75 0 0 1 5.25 5h3.5l2 2h8A1.75 1.75 0 0 1 20.5 8.75v8.5A1.75 1.75 0 0 1 18.75 19H5.25a1.75 1.75 0 0 1-1.75-1.75V7.5Z';
  return (
    <svg
      className="manuscript-pdf-artifact-action-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

type ManuscriptPdfPageBounds = Readonly<{
  pageNumber: number;
  top: number;
  bottom: number;
}>;

type ManuscriptPdfPageDimensions = Readonly<{
  cssWidth: number;
  cssHeight: number;
  scale: number;
}>;

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

export function resolveManuscriptPdfCurrentPage(
  viewportCenter: number,
  pages: readonly ManuscriptPdfPageBounds[],
) {
  let closestPage: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const page of pages) {
    const distance =
      viewportCenter < page.top
        ? page.top - viewportCenter
        : viewportCenter > page.bottom
          ? viewportCenter - page.bottom
          : 0;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestPage = page.pageNumber;
    }
  }
  return closestPage;
}

function estimatedPageDimensions(scale: number): ManuscriptPdfPageDimensions {
  return {
    cssWidth: Math.ceil(612 * scale),
    cssHeight: Math.ceil(792 * scale),
    scale,
  };
}

function ManuscriptPdfPageCanvas({
  pdfDocument,
  pageNumber,
  scale,
  onDimensions,
}: Readonly<{
  pdfDocument: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  onDimensions(pageNumber: number, dimensions: ManuscriptPdfPageDimensions): void;
}>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel(): void; promise: Promise<unknown> } | null = null;
    setState('loading');
    void pdfDocument
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled || !canvasRef.current) return;
        const viewport = page.getViewport({ scale });
        const dimensions = boundedManuscriptPdfCanvasDimensions(
          viewport.width,
          viewport.height,
          window.devicePixelRatio || 1,
        );
        onDimensions(pageNumber, {
          cssWidth: dimensions.cssWidth,
          cssHeight: dimensions.cssHeight,
          scale,
        });
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
      .then(() => {
        if (!cancelled) setState('ready');
      })
      .catch((renderError) => {
        if (
          !cancelled &&
          !(renderError instanceof Error && renderError.name === 'RenderingCancelledException')
        ) {
          setState('error');
        }
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [onDimensions, pageNumber, pdfDocument, scale]);

  return (
    <>
      {state === 'loading' && <span>Rendering page {pageNumber}…</span>}
      {state === 'error' && <span role="alert">Page {pageNumber} could not be rendered.</span>}
      <canvas ref={canvasRef} hidden={state !== 'ready'} aria-label={`PDF page ${pageNumber}`} />
    </>
  );
}

export function ManuscriptPdfPreview({
  preview,
  artifactActions,
}: {
  preview: ManuscriptPdfPreviewValue;
  artifactActions?: ManuscriptPdfArtifactActions;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLElement>());
  const scrollFrameRef = useRef<number | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageDimensions, setPageDimensions] = useState<Record<number, ManuscriptPdfPageDimensions>>(
    {},
  );
  const [scale, setScale] = useState(1.1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const artifactActionLabels = manuscriptPdfArtifactActionLabels();

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setLoading(true);
    setError(null);
    setPageNumber(1);
    setPageDimensions({});
    setPdfDocument(null);
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
        if (
          !Number.isSafeInteger(next.numPages) ||
          next.numPages < 1 ||
          next.numPages > MANUSCRIPT_PDF_MAX_PAGES
        ) {
          void loadingTask?.destroy();
          throw new Error('manuscript_pdf_page_count_invalid');
        }
        setPdfDocument(next);
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
    const scroll = scrollRef.current;
    if (!pdfDocument || !scroll) return;
    scroll.scrollTo({ left: 0, top: 0, behavior: 'auto' });
  }, [pdfDocument]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    },
    [],
  );

  const pages = useMemo(
    () =>
      pdfDocument ? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1) : [],
    [pdfDocument],
  );

  const rememberPageDimensions = useCallback(
    (nextPageNumber: number, dimensions: ManuscriptPdfPageDimensions) => {
      setPageDimensions((current) => {
        const existing = current[nextPageNumber];
        if (
          existing?.scale === dimensions.scale &&
          existing.cssWidth === dimensions.cssWidth &&
          existing.cssHeight === dimensions.cssHeight
        ) {
          return current;
        }
        return { ...current, [nextPageNumber]: dimensions };
      });
    },
    [],
  );

  const updateCurrentPageFromScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const scroll = scrollRef.current;
      if (!scroll) return;
      const scrollRect = scroll.getBoundingClientRect();
      const bounds = [...pageRefs.current.entries()].map(([nextPageNumber, element]) => {
        const rect = element.getBoundingClientRect();
        return { pageNumber: nextPageNumber, top: rect.top, bottom: rect.bottom };
      });
      const nextPageNumber = resolveManuscriptPdfCurrentPage(
        scrollRect.top + scroll.clientHeight / 2,
        bounds,
      );
      if (nextPageNumber !== null) {
        setPageNumber((current) => (current === nextPageNumber ? current : nextPageNumber));
      }
    });
  }, []);

  const goToPage = useCallback(
    (requestedPage: number) => {
      if (!pdfDocument) return;
      const nextPageNumber = Math.min(pdfDocument.numPages, Math.max(1, requestedPage));
      const scroll = scrollRef.current;
      const page = pageRefs.current.get(nextPageNumber);
      setPageNumber(nextPageNumber);
      if (!scroll || !page) return;
      const scrollRect = scroll.getBoundingClientRect();
      const pageRect = page.getBoundingClientRect();
      scroll.scrollTo({
        left: scroll.scrollLeft,
        top: Math.max(0, scroll.scrollTop + pageRect.top - scrollRect.top - 16),
        behavior: 'auto',
      });
    },
    [pdfDocument],
  );

  return (
    <section
      className="manuscript-pdf-preview"
      aria-label="Compiled manuscript PDF preview"
      data-current-page={pageNumber}
    >
      <header>
        <div>
          <strong>Compiled PDF</strong>
          <span>
            Local {preview.compiler.engineDisplayName} via {preview.compiler.displayName} ·{' '}
            {preview.rootDocument} · revision {preview.providerRevision.slice(0, 12)}
          </span>
        </div>
        {preview.providerAhead && <b>Overleaf has a newer observed revision</b>}
        {artifactActions && (
          <div className="manuscript-pdf-artifact-actions" aria-label="Manuscript PDF actions">
            <button
              type="button"
              className="ghost-button manuscript-pdf-artifact-action-button"
              aria-label={artifactActionLabels.export}
              title={artifactActionLabels.export}
              disabled={artifactActions.busy}
              onClick={artifactActions.onExport}
            >
              <ManuscriptPdfArtifactActionIcon kind="export" />
            </button>
            <button
              type="button"
              className="ghost-button manuscript-pdf-artifact-action-button"
              aria-label={artifactActionLabels.open}
              title={artifactActionLabels.open}
              disabled={artifactActions.busy}
              onClick={artifactActions.onOpen}
            >
              <ManuscriptPdfArtifactActionIcon kind="open" />
            </button>
            <button
              type="button"
              className="ghost-button manuscript-pdf-artifact-action-button"
              aria-label={artifactActionLabels.reveal}
              title={artifactActionLabels.reveal}
              disabled={artifactActions.busy}
              onClick={artifactActions.onReveal}
            >
              <ManuscriptPdfArtifactActionIcon kind="reveal" />
            </button>
            {artifactActions.status && <span role="status">{artifactActions.status}</span>}
          </div>
        )}
        <div className="manuscript-pdf-controls">
          <button
            type="button"
            className="ghost-button"
            aria-label="Previous PDF page"
            disabled={!pdfDocument || pageNumber <= 1}
            onClick={() => goToPage(pageNumber - 1)}
          >
            Previous
          </button>
          <span className="manuscript-pdf-page-counter" aria-live="polite">
            {pdfDocument ? `${pageNumber} / ${pdfDocument.numPages}` : 'Loading'}
          </span>
          <button
            type="button"
            className="ghost-button"
            aria-label="Next PDF page"
            disabled={!pdfDocument || pageNumber >= pdfDocument.numPages}
            onClick={() => goToPage(pageNumber + 1)}
          >
            Next
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={!pdfDocument || scale <= 0.6}
            onClick={() => setScale((current) => Math.max(0.6, current - 0.15))}
          >
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="ghost-button"
            disabled={!pdfDocument || scale >= 2}
            onClick={() => setScale((current) => Math.min(2, current + 0.15))}
          >
            ＋
          </button>
        </div>
      </header>
      <div
        ref={scrollRef}
        className="manuscript-pdf-canvas-wrap"
        aria-busy={loading}
        onScroll={updateCurrentPageFromScroll}
      >
        {loading && (
          <span className="manuscript-pdf-document-status">Rendering the compiled PDF…</span>
        )}
        {error && (
          <span className="manuscript-pdf-document-status" role="alert">
            {error}
          </span>
        )}
        {pdfDocument && (
          <div className="manuscript-pdf-pages">
            {pages.map((nextPageNumber) => {
              const recordedDimensions = pageDimensions[nextPageNumber];
              const dimensions =
                recordedDimensions?.scale === scale
                  ? recordedDimensions
                  : estimatedPageDimensions(scale);
              const shouldRender =
                Math.abs(nextPageNumber - pageNumber) <= MANUSCRIPT_PDF_RENDER_RADIUS;
              return (
                <article
                  key={nextPageNumber}
                  ref={(element) => {
                    if (element) pageRefs.current.set(nextPageNumber, element);
                    else pageRefs.current.delete(nextPageNumber);
                  }}
                  className="manuscript-pdf-page"
                  data-page-number={nextPageNumber}
                  aria-label={`Page ${nextPageNumber} of ${pdfDocument.numPages}`}
                  style={{ width: dimensions.cssWidth, height: dimensions.cssHeight }}
                >
                  {shouldRender ? (
                    <ManuscriptPdfPageCanvas
                      key={`${preview.artifactId}:${nextPageNumber}:${scale}`}
                      pdfDocument={pdfDocument}
                      pageNumber={nextPageNumber}
                      scale={scale}
                      onDimensions={rememberPageDimensions}
                    />
                  ) : (
                    <span>Page {nextPageNumber}</span>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
