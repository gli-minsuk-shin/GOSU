import { createRoot } from 'react-dom/client';

import '../../src/renderer/src/styles.css';
import type { ManuscriptPdfPreview as ManuscriptPdfPreviewValue } from '../../src/shared/manuscript-workspace-contracts';

type PdfPreviewSmokeState = {
  workerUrls: string[];
  securityViolations: string[];
  windowErrors: string[];
};

declare global {
  interface Window {
    __gosuPdfPreviewSmoke: PdfPreviewSmokeState;
  }
}

window.__gosuPdfPreviewSmoke = {
  workerUrls: [],
  securityViolations: [],
  windowErrors: [],
};

window.addEventListener('securitypolicyviolation', (event) => {
  window.__gosuPdfPreviewSmoke.securityViolations.push(
    `${event.violatedDirective}:${event.blockedURI}`,
  );
});
window.addEventListener('error', (event) => {
  window.__gosuPdfPreviewSmoke.windowErrors.push(event.message || 'renderer_window_error');
});
window.addEventListener('unhandledrejection', (event) => {
  window.__gosuPdfPreviewSmoke.windowErrors.push(String(event.reason ?? 'unhandled_rejection'));
});

const nativeWorker = window.Worker;
const instrumentedWorker = new Proxy(nativeWorker, {
  construct(target, argumentsList) {
    window.__gosuPdfPreviewSmoke.workerUrls.push(String(argumentsList[0]));
    return Reflect.construct(target, argumentsList) as Worker;
  },
});
Object.defineProperty(window, 'Worker', {
  configurable: true,
  value: instrumentedWorker,
  writable: true,
});

function buildPdfFixture() {
  const stream = [
    '1 1 1 rg',
    '0 0 220 220 re f',
    '0 0 0 rg',
    '20 20 80 80 re f',
    '0 0 1 rg',
    '110 110 70 70 re f',
    '',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 220 220] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${new TextEncoder().encode(stream).byteLength} >>\nstream\n${stream}endstream`,
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(new TextEncoder().encode(source).byteLength);
    source += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(source).byteLength;
  source += `xref\n0 ${objects.length + 1}\n`;
  source += '0000000000 65535 f \n';
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  source += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}

function encodeBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return window.btoa(binary);
}

async function bootstrap() {
  const root = document.querySelector('#root');
  if (!root) throw new Error('missing_manuscript_pdf_preview_smoke_root');
  const pdf = buildPdfFixture();
  const preview: ManuscriptPdfPreviewValue = {
    schemaVersion: 1,
    artifactId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    manuscriptId: '33333333-3333-4333-8333-333333333333',
    checkpointId: '44444444-4444-4444-8444-444444444444',
    providerRevision: 'a'.repeat(40),
    rootDocument: 'main.tex',
    providerAhead: false,
    compiler: {
      kind: 'latexmk',
      displayName: 'MacTeX latexmk',
      version: '4.86',
      engine: 'pdflatex',
      engineDisplayName: 'pdfLaTeX',
    },
    pdfSha256: 'b'.repeat(64),
    sizeBytes: pdf.byteLength,
    compiledAt: '2026-08-12T00:00:00.000Z',
    pdfBase64: encodeBase64(pdf),
  };
  const { ManuscriptPdfPreview } = await import('../../src/renderer/src/manuscript-pdf-preview');
  createRoot(root).render(
    <main>
      <ManuscriptPdfPreview preview={preview} />
    </main>,
  );
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'pdf_preview_fixture_bootstrap_failed';
  window.__gosuPdfPreviewSmoke.windowErrors.push(message);
  document.body.dataset.fixtureError = message;
});
