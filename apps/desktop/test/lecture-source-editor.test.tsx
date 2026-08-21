import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  LectureSourceEditor,
  insertLectureSourceAtSelection,
  isLectureSourceFileDrag,
  isLectureSourceSaveShortcut,
  lectureSourceDirtyDocuments,
  lectureSourceOffsetForPosition,
  type LectureSourceDrafts,
} from '../src/renderer/src/lecture-source-editor';

const baseSources: LectureSourceDrafts = {
  'lecture-notes': '\\section{Notes}\nSaved notes.',
  slides: '\\begin{frame}{Saved}\nSaved slide.\n\\end{frame}',
};

describe('LectureSourceEditor', () => {
  it('tracks dirty notes and slides independently in one controlled session', () => {
    expect(lectureSourceDirtyDocuments(baseSources, baseSources)).toEqual([]);
    expect(
      lectureSourceDirtyDocuments(baseSources, {
        ...baseSources,
        'lecture-notes': `${baseSources['lecture-notes']}\nEdited.`,
      }),
    ).toEqual(['lecture-notes']);
    expect(
      lectureSourceDirtyDocuments(baseSources, {
        'lecture-notes': 'Edited notes.',
        slides: 'Edited slides.',
      }),
    ).toEqual(['lecture-notes', 'slides']);
  });

  it('recognizes only the standard save shortcut and resolves line positions safely', () => {
    expect(
      isLectureSourceSaveShortcut({
        key: 's',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isLectureSourceSaveShortcut({
        key: 'S',
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isLectureSourceSaveShortcut({
        key: 's',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe(false);
    expect(lectureSourceOffsetForPosition('abc\ndef\nghi', 2, 2)).toBe(5);
    expect(lectureSourceOffsetForPosition('abc\ndef', 99, 99)).toBe(7);
    expect(isLectureSourceFileDrag(['Files', 'text/uri-list'])).toBe(true);
    expect(isLectureSourceFileDrag(['text/plain'])).toBe(false);
    expect(
      insertLectureSourceAtSelection('beforeafter', '\\gosuimage{figure}', { start: 6, end: 6 }),
    ).toEqual({
      source: 'before\\gosuimage{figure}after',
      selection: { start: 24, end: 24 },
    });

    const source = readFileSync(
      new URL('../src/renderer/src/lecture-source-editor.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('onDragOver={blockFileDrag}');
    expect(source).toContain('onDrop={blockFileDrop}');
    expect(source).toContain("event.dataTransfer.dropEffect = 'none';");
    expect(source).not.toMatch(/\.path\b/u);
  });

  it('renders complete tab semantics, dirty state, revision-safe actions, and an editor label', () => {
    const html = renderToStaticMarkup(
      <LectureSourceEditor
        idPrefix="fixture-source"
        revision={5}
        baseSources={baseSources}
        drafts={{ ...baseSources, 'lecture-notes': `${baseSources['lecture-notes']}\nEdited.` }}
        activeDocument="lecture-notes"
        onActiveDocumentChange={vi.fn()}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain('Edit revision 5');
    expect(html).toContain('Saving creates revision 6. Earlier revisions stay unchanged.');
    expect(html).toContain('Save as revision 6');
    expect(html).toContain('PDFs are validated and compiled on save.');
    expect(html).not.toContain('Preview draft PDF');
    expect(html).toContain('role="tablist" aria-label="LaTeX documents"');
    expect(html).toContain('id="fixture-source-tab-lecture-notes"');
    expect(html).toContain('aria-controls="fixture-source-panel"');
    expect(html).toContain('aria-label="Lecture notes, unsaved changes"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('role="tabpanel" aria-labelledby="fixture-source-tab-lecture-notes"');
    expect(html).toContain('Lecture notes LaTeX for revision 5');
    expect(html).toContain('Unsaved changes in Lecture notes.');
    expect(html).toContain('⌘S or Ctrl+S saves a new revision. Tab moves focus.');
  });

  it('exposes a focused, line-addressable validation issue without discarding the draft', () => {
    const html = renderToStaticMarkup(
      <LectureSourceEditor
        idPrefix="issue-source"
        revision={8}
        baseSources={baseSources}
        drafts={{ ...baseSources, slides: 'invalid but retained' }}
        activeDocument="slides"
        onActiveDocumentChange={vi.fn()}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        issue={{
          document: 'slides',
          message: 'Use an attached figure asset.',
          line: 12,
          column: 4,
        }}
      />,
    );

    expect(html).toContain('role="alert" tabindex="-1"');
    expect(html).toContain('Use an attached figure asset.');
    expect(html).toContain('Slides · line 12, column 4');
    expect(html).toContain('Go to line');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('invalid but retained');
  });

  it('has container-aware and narrow viewport layouts', () => {
    const styles = readFileSync(
      new URL('../src/renderer/src/lecture-source-editor.css', import.meta.url),
      'utf8',
    );
    expect(styles).toMatch(/@container lecture-workspace \(max-width: 700px\)/u);
    expect(styles).toMatch(/@media \(max-width: 600px\)/u);
    expect(styles).toMatch(/\.lecture-source-editor-tabs\s*\{[^}]*overflow-x:\s*auto;/su);
    expect(styles).toMatch(
      /\.lecture-source-editor\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/su,
    );
    expect(styles).toMatch(/\.lecture-source-editor-panel\s*\{[^}]*flex:\s*1 1 auto;/su);
    expect(styles).toMatch(/\.lecture-source-editor-panel textarea\s*\{[^}]*height:\s*100%;/su);
    expect(styles).not.toMatch(/grid-template-rows:\s*auto auto auto minmax\(320px, 1fr\)/u);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/u);
  });
});
