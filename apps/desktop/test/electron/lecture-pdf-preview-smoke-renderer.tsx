import { createRoot } from 'react-dom/client';

import '../../src/renderer/src/styles.css';
import '../../src/renderer/src/lecture-studio-view.css';
import '../../src/renderer/src/pdf-preview.css';
import './lecture-pdf-preview-smoke.css';
import type { PdfPreviewDocument } from '../../src/shared/pdf-preview-contracts';

type LecturePdfPreviewSmokeState = {
  workerUrls: string[];
  securityViolations: string[];
  windowErrors: string[];
};

declare global {
  interface Window {
    __gosuLecturePdfPreviewSmoke: LecturePdfPreviewSmokeState;
  }
}

window.__gosuLecturePdfPreviewSmoke = {
  workerUrls: [],
  securityViolations: [],
  windowErrors: [],
};

window.addEventListener('securitypolicyviolation', (event) => {
  window.__gosuLecturePdfPreviewSmoke.securityViolations.push(
    `${event.violatedDirective}:${event.blockedURI}`,
  );
});
window.addEventListener('error', (event) => {
  window.__gosuLecturePdfPreviewSmoke.windowErrors.push(event.message || 'renderer_window_error');
});
window.addEventListener('unhandledrejection', (event) => {
  window.__gosuLecturePdfPreviewSmoke.windowErrors.push(
    String(event.reason ?? 'unhandled_rejection'),
  );
});

const nativeWorker = window.Worker;
const instrumentedWorker = new Proxy(nativeWorker, {
  construct(target, argumentsList) {
    window.__gosuLecturePdfPreviewSmoke.workerUrls.push(String(argumentsList[0]));
    return Reflect.construct(target, argumentsList) as Worker;
  },
});
Object.defineProperty(window, 'Worker', {
  configurable: true,
  value: instrumentedWorker,
  writable: true,
});

function buildPdfFixture() {
  const streams = [
    [
      '1 1 1 rg',
      '0 0 220 520 re f',
      '0 0 0 rg',
      '20 20 80 80 re f',
      '0 0 1 rg',
      '110 330 70 70 re f',
      '',
    ].join('\n'),
    [
      '1 1 1 rg',
      '0 0 220 520 re f',
      '0 0.75 0 rg',
      '20 220 100 100 re f',
      '1 0.55 0 rg',
      '130 80 60 60 re f',
      '',
    ].join('\n'),
    [
      '1 1 1 rg',
      '0 0 220 520 re f',
      '1 0 0 rg',
      '30 300 120 120 re f',
      '0.75 0 0.75 rg',
      '130 80 60 60 re f',
      '',
    ].join('\n'),
  ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 220 520] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${new TextEncoder().encode(streams[0]).byteLength} >>\nstream\n${streams[0]}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 220 520] /Resources << >> /Contents 6 0 R >>',
    `<< /Length ${new TextEncoder().encode(streams[1]).byteLength} >>\nstream\n${streams[1]}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 220 520] /Resources << >> /Contents 8 0 R >>',
    `<< /Length ${new TextEncoder().encode(streams[2]).byteLength} >>\nstream\n${streams[2]}endstream`,
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
  if (!root) throw new Error('missing_lecture_pdf_preview_smoke_root');
  const pdf = buildPdfFixture();
  const previewDocument: PdfPreviewDocument = {
    schemaVersion: 1,
    artifactId: '11111111-1111-4111-8111-111111111111',
    title: 'Lecture notes',
    fileName: 'lecture-notes.pdf',
    compilerDisplayName: 'MacTeX latexmk · XeLaTeX',
    sourceDescription: 'Lecture Studio revision 3',
    pdfSha256: `sha256:${'b'.repeat(64)}`,
    sizeBytes: pdf.byteLength,
    compiledAt: '2026-08-13T00:00:00.000Z',
    pdfBase64: encodeBase64(pdf),
  };
  const { PdfPreview } = await import('../../src/renderer/src/pdf-preview');
  createRoot(root).render(
    <main className="lecture-preview-document pdf lecture-pdf-preview-smoke-shell">
      <PdfPreview document={previewDocument} className="lecture-studio-pdf-preview" />
    </main>,
  );
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'pdf_preview_fixture_bootstrap_failed';
  window.__gosuLecturePdfPreviewSmoke.windowErrors.push(message);
  document.body.dataset.fixtureError = message;
});
