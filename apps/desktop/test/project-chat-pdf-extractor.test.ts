import { describe, expect, it } from 'vitest';

import {
  extractProjectChatPdf,
  ProjectChatPdfExtractionError,
} from '../src/main/project-chat-pdf-extractor';

function minimalPdf(text: string) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${text.length + 33} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, 'ascii'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'ascii');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'ascii'));
}

describe('extractProjectChatPdf', () => {
  it('extracts bounded page text from in-memory bytes without a URL', async () => {
    const result = await extractProjectChatPdf(minimalPdf('Tabular foundation evidence'), 60_000);

    expect(result).toMatchObject({ pageCount: 1, textAvailable: true, truncated: false });
    expect(result.pages[0]?.text).toContain('Tabular foundation evidence');
  });

  it('maps malformed bytes to a bounded invalid/extraction error', async () => {
    try {
      await extractProjectChatPdf(new Uint8Array(Buffer.from('%PDF-invalid')));
      expect.unreachable('Malformed PDF bytes must not be accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectChatPdfExtractionError);
      expect((error as ProjectChatPdfExtractionError).code).toMatch(
        /^pdf_attachment_(invalid|extraction_failed)$/u,
      );
    }
  });
});
