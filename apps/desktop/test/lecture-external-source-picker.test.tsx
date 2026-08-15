import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  formatLectureSourceBytes,
  LectureExternalSourcePicker,
  lectureExternalSourceStatus,
  type LectureExternalSourceCard,
} from '../src/renderer/src/lecture-external-source-picker';

const source: LectureExternalSourceCard = {
  id: 'source-1',
  displayName: 'proof-notes.tex',
  kind: 'latex',
  byteSize: 2_048,
  textAvailable: true,
  truncated: false,
  unitLabel: 'part',
  unitCount: 1,
  extractedCharacters: 1_234,
  reconstructionNotice: 'Exact UTF-8 source text.',
};

describe('LectureExternalSourcePicker', () => {
  it('formats bounded source metadata without exposing local paths', () => {
    expect(formatLectureSourceBytes(900)).toBe('900 B');
    expect(formatLectureSourceBytes(2_048)).toBe('2.0 KB');
    expect(formatLectureSourceBytes(2 * 1_024 * 1_024)).toBe('2.0 MB');
    expect(lectureExternalSourceStatus(source)).toBe('Ready');
    expect(lectureExternalSourceStatus({ ...source, truncated: true })).toBe('Ready · excerpted');
    expect(lectureExternalSourceStatus({ ...source, textAvailable: false })).toBe(
      'Needs attention',
    );
  });

  it('shows compact file and Overleaf source cards with accessible removal controls', () => {
    const html = renderToStaticMarkup(
      <LectureExternalSourcePicker
        fileSources={[source]}
        overleafSources={[
          {
            manuscriptId: 'manuscript-1',
            title: 'Shared paper',
            rootDocument: 'paper/main.tex',
            providerRevision: 'abc123',
            observedAt: '2026-08-14T00:00:00.000Z',
          },
        ]}
        busy={false}
        outputProjectName="Research Alpha"
        overleafPersonalTokenState="configured"
        onOpenOverleafSettings={vi.fn()}
        onChooseFiles={vi.fn()}
        onRemoveFile={vi.fn()}
        onImportOverleaf={vi.fn()}
        onRemoveOverleaf={vi.fn()}
      />,
    );

    expect(html).toContain('Add your own sources');
    expect(html).toContain('LaTeX (.tex), Markdown (.md), or PDF (.pdf)');
    expect(html).toContain('proof-notes.tex');
    expect(html).toContain('Exact Git checkpoint');
    expect(html).toContain('aria-label="Remove proof-notes.tex"');
    expect(html).toContain('aria-label="Remove Shared paper"');
    expect(html).not.toContain('/Users/');
    expect(html).not.toContain('abc123');
  });

  it('keeps source cards compact and responsive', () => {
    const styles = readFileSync(
      new URL('../src/renderer/src/lecture-external-source-picker.css', import.meta.url),
      'utf8',
    );
    expect(styles).toMatch(
      /\.lecture-external-source-card\s*\{[^}]*grid-template-columns:\s*42px minmax\(0, 1fr\) auto 30px;/su,
    );
    expect(styles).toMatch(/@container lecture-workspace \(max-width: 720px\)/u);
    expect(styles).toMatch(/\.lecture-overleaf-source-grid\s*\{[^}]*grid-template-columns:/su);
  });

  it('keeps the Overleaf capture form and import draft token-free', () => {
    const componentSource = readFileSync(
      new URL('../src/renderer/src/lecture-external-source-picker.tsx', import.meta.url),
      'utf8',
    );

    expect(componentSource).not.toContain('accessToken');
    expect(componentSource).not.toContain('Personal Git token');
    expect(componentSource).toContain('Uses the token saved in Overleaf Settings');
    expect(componentSource).toContain('OpenOverleafSettings');
  });
});
