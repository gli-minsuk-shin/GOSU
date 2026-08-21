import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  LectureDocumentFeaturesEditor,
  LectureStructureEditor,
  addLectureStructureSection,
  gosuLectureStructureTemplate,
  lectureStructureEditorValidation,
  moveLectureStructureSection,
  removeLectureStructureSection,
  sourceListSectionTitlesInLectureStructure,
  updateLectureStructureSection,
} from '../src/renderer/src/lecture-structure-editor';
import {
  DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES,
  DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE,
  GOSU_LECTURE_STUDIO_STRUCTURE_TEMPLATE,
  LECTURE_STUDIO_MAX_STRUCTURE_SECTIONS,
  LECTURE_STUDIO_SOURCE_LIST_SECTION_TITLES,
  type LectureStudioStructureTemplate,
} from '../src/shared/lecture-studio-contracts';

function render(
  value: LectureStudioStructureTemplate,
  disabled = false,
  allowedSourceListSectionTitles: readonly string[] = [],
) {
  return renderToStaticMarkup(
    <LectureStructureEditor
      value={value}
      onChange={vi.fn()}
      disabled={disabled}
      idPrefix="fixture-structure"
      contextCopy="Fixture scope copy."
      onReset={vi.fn()}
      allowedSourceListSectionTitles={allowedSourceListSectionTitles}
    />,
  );
}

describe('Lecture structure editor', () => {
  it('offers an adaptive source-led content mode without hidden document locks', () => {
    const html = render(DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE);

    expect(html).toContain('Fixture scope copy.');
    expect(html).toContain('checked="" value="adaptive"');
    expect(html).toContain('Custom outline');
    expect(html).toContain('Source-led structure');
    expect(html).not.toContain('Locked');
    expect(html).toContain('Revert changes');
  });

  it('renders three adjustable native document checkboxes with accessible help', () => {
    const html = renderToStaticMarkup(
      <LectureDocumentFeaturesEditor
        value={DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES}
        onChange={vi.fn()}
        idPrefix="fixture-document-features"
      />,
    );

    expect(html).toContain(
      '<fieldset class="lecture-document-features" aria-describedby="fixture-document-features-description">',
    );
    expect(html).toContain('<legend>Document elements</legend>');
    expect(html.match(/type="checkbox"/gu)).toHaveLength(3);
    expect(html.match(/checked=""/gu)).toHaveLength(3);
    expect(html).toContain('Show a title page in slides');
    expect(html).toContain('Show source markers in notes and slides');
    expect(html).toContain('Add a Sources used list to notes');
    expect(html).toContain('Hidden markers still retain the revision&#x27;s evidence record.');
    expect(html).toContain('aria-describedby="fixture-document-features-evidence-labels-help"');
    expect(html).not.toContain('Locked');

    const disabledHtml = renderToStaticMarkup(
      <LectureDocumentFeaturesEditor
        value={DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES}
        onChange={vi.fn()}
        idPrefix="disabled-document-features"
        disabled
      />,
    );
    expect(disabledHtml).toContain('<fieldset class="lecture-document-features" disabled=""');
  });

  it('renders an ordered custom outline with explicit coverage and accessible actions', () => {
    const html = render(gosuLectureStructureTemplate());

    expect(html).toContain('6 sections');
    expect(html).toContain('Overview and learning goals');
    expect(html).toContain('Background, definitions, and notation');
    expect(html).toContain('Notes &amp; slides');
    expect(html).toContain('Notes only');
    expect(html).toContain('Load GOSU outline');
    expect(html).toContain('＋ Add section');
    expect(html).toContain('aria-label="Move Overview and learning goals up"');
    expect(html).toContain('aria-label="Move Overview and learning goals down"');
    expect(html).toContain('aria-label="Remove Overview and learning goals"');
    expect(html).toContain('role="group" aria-label="Actions for Overview and learning goals"');
  });

  it('returns independent GOSU drafts and applies add, edit, move, and remove operations', () => {
    const first = gosuLectureStructureTemplate();
    const second = gosuLectureStructureTemplate();
    expect(first).toEqual(GOSU_LECTURE_STUDIO_STRUCTURE_TEMPLATE);
    expect(first).not.toBe(second);
    if (first.mode !== 'custom' || second.mode !== 'custom') throw new Error('expected custom');
    expect(first.sections).not.toBe(second.sections);
    expect(first.sections[0]).not.toBe(second.sections[0]);

    const added = addLectureStructureSection(first);
    expect(added.mode).toBe('custom');
    if (added.mode !== 'custom') throw new Error('expected custom');
    expect(added.sections.at(-1)).toEqual({
      title: 'New section',
      coverage: 'notes-and-slides',
    });

    const edited = updateLectureStructureSection(added, added.sections.length - 1, {
      title: 'Technical appendix',
      coverage: 'notes-only',
    });
    if (edited.mode !== 'custom') throw new Error('expected custom');
    expect(edited.sections.at(-1)).toEqual({
      title: 'Technical appendix',
      coverage: 'notes-only',
    });

    const moved = moveLectureStructureSection(edited, edited.sections.length - 1, 0);
    if (moved.mode !== 'custom') throw new Error('expected custom');
    expect(moved.sections[0]?.title).toBe('Technical appendix');

    const removed = removeLectureStructureSection(moved, 0);
    expect(removed).toEqual(first);
  });

  it('keeps mutations inside the contract bounds', () => {
    let maximum = gosuLectureStructureTemplate();
    while (
      maximum.mode === 'custom' &&
      maximum.sections.length < LECTURE_STUDIO_MAX_STRUCTURE_SECTIONS
    ) {
      maximum = addLectureStructureSection(maximum);
    }
    expect(addLectureStructureSection(maximum)).toBe(maximum);

    const one: LectureStudioStructureTemplate = {
      mode: 'custom',
      sections: [{ title: 'Only section', coverage: 'notes-and-slides' }],
    };
    expect(removeLectureStructureSection(one, 0)).toBe(one);
    expect(moveLectureStructureSection(one, 0, 2)).toBe(one);
    expect(
      updateLectureStructureSection(DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE, 0, {
        title: 'Ignored',
      }),
    ).toBe(DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE);
  });

  it('shows bounded, nontechnical validation for duplicates, reserved names, and notes-only flows', () => {
    const invalid: LectureStudioStructureTemplate = {
      mode: 'custom',
      sections: [
        { title: 'Sources used', coverage: 'notes-only' },
        { title: 'Sources used', coverage: 'notes-only' },
      ],
    };
    const validation = lectureStructureEditorValidation(invalid);
    expect(validation.valid).toBe(false);
    expect(validation.messages).toContain(
      'Source lists are controlled by Document elements. Choose a content topic instead.',
    );
    expect(validation.messages).toContain('Use a different name for each section.');
    expect(validation.messages).toContain(
      'At least one section must appear in both notes and slides.',
    );

    const html = render(invalid);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Check the content flow');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="fixture-structure-section-0-issue"');
    expect(validation.sectionMessages[0]).toContain('Use a different name for each section.');
    expect(validation.coverageInvalid).toBe(true);
    expect(html).toContain('aria-describedby="fixture-structure-validation"');
  });

  it('rejects every source-list alias while grandfathering only exact normalized saved titles', () => {
    for (const title of LECTURE_STUDIO_SOURCE_LIST_SECTION_TITLES) {
      const structure: LectureStudioStructureTemplate = {
        mode: 'custom',
        sections: [{ title, coverage: 'notes-and-slides' }],
      };
      const validation = lectureStructureEditorValidation(structure);
      expect(validation.valid, title).toBe(false);
      expect(validation.sectionMessages[0], title).toContain(
        'Source lists are controlled by Document elements. Choose a content topic instead.',
      );
    }

    const saved: LectureStudioStructureTemplate = {
      mode: 'custom',
      sections: [{ title: ' References ', coverage: 'notes-and-slides' }],
    };
    expect(sourceListSectionTitlesInLectureStructure(saved)).toEqual(['references']);
    expect(lectureStructureEditorValidation(saved, ['references']).valid).toBe(true);
    expect(render(saved, false, ['references'])).not.toContain('Check the content flow');

    const historicalCollapsedLookalike: LectureStudioStructureTemplate = {
      mode: 'custom',
      sections: [{ title: 'Sources   used', coverage: 'notes-and-slides' }],
    };
    expect(sourceListSectionTitlesInLectureStructure(historicalCollapsedLookalike)).toEqual([
      'sources used',
    ]);
    expect(
      lectureStructureEditorValidation(historicalCollapsedLookalike, ['sources used']).valid,
    ).toBe(true);
    expect(
      lectureStructureEditorValidation(
        {
          mode: 'custom',
          sections: [{ title: '  SOURCES USED  ', coverage: 'notes-and-slides' }],
        },
        ['sources used'],
      ).valid,
    ).toBe(false);

    const introduced: LectureStudioStructureTemplate = {
      mode: 'custom',
      sections: [{ title: 'Bibliography', coverage: 'notes-and-slides' }],
    };
    expect(lectureStructureEditorValidation(introduced, ['references']).valid).toBe(false);
  });

  it('disables every editor action while its owner is saving or generating', () => {
    const html = render(gosuLectureStructureTemplate(), true);

    expect(html).toContain('<fieldset class="lecture-structure-mode" disabled=""');
    expect(html).toContain('class="secondary-button" disabled=""');
    expect(html).toContain('class="lecture-structure-add-section" disabled=""');
    expect(html).toContain('class="ghost-button" disabled=""');
  });

  it('can disable only the owner-provided reset action while the editor remains available', () => {
    const html = renderToStaticMarkup(
      <LectureStructureEditor
        value={DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE}
        onChange={vi.fn()}
        onReset={vi.fn()}
        resetDisabled
        idPrefix="reset-disabled-fixture"
      />,
    );

    expect(html).toContain('class="ghost-button" disabled=""');
    expect(html).not.toContain('<fieldset class="lecture-structure-mode" disabled=""');
  });

  it('collapses rows and document choices without horizontal overflow at constrained widths', () => {
    const styles = readFileSync(
      new URL('../src/renderer/src/lecture-structure-editor.css', import.meta.url),
      'utf8',
    );

    expect(styles).toMatch(/container:\s*lecture-structure-editor \/ inline-size/u);
    expect(styles).toMatch(/container:\s*lecture-document-features \/ inline-size/u);
    expect(styles).toMatch(
      /@container lecture-document-features \(max-width: 720px\)[\s\S]*?\.lecture-document-features > div\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u,
    );
    expect(styles).toMatch(
      /@container lecture-structure-editor \(max-width: 480px\)[\s\S]*?\.lecture-structure-mode\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u,
    );
    expect(styles).toContain('min-width: 0;');
  });
});
