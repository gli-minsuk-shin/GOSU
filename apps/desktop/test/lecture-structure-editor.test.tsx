import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  LectureStructureEditor,
  addLectureStructureSection,
  gosuLectureStructureTemplate,
  lectureStructureEditorValidation,
  moveLectureStructureSection,
  removeLectureStructureSection,
  updateLectureStructureSection,
} from '../src/renderer/src/lecture-structure-editor';
import {
  DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE,
  GOSU_LECTURE_STUDIO_STRUCTURE_TEMPLATE,
  LECTURE_STUDIO_MAX_STRUCTURE_SECTIONS,
  type LectureStudioStructureTemplate,
} from '../src/shared/lecture-studio-contracts';

function render(value: LectureStudioStructureTemplate, disabled = false) {
  return renderToStaticMarkup(
    <LectureStructureEditor
      value={value}
      onChange={vi.fn()}
      disabled={disabled}
      idPrefix="fixture-structure"
      contextCopy="Fixture scope copy."
      onReset={vi.fn()}
    />,
  );
}

describe('Lecture structure editor', () => {
  it('offers an adaptive source-led mode with document defaults and safeguards', () => {
    const html = render(DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE);

    expect(html).toContain('Fixture scope copy.');
    expect(html).toContain('checked="" value="adaptive"');
    expect(html).toContain('Custom outline');
    expect(html).toContain('Source-led structure');
    expect(html).toContain('aria-label="Document defaults and safeguards"');
    expect(html).toContain('Title slide');
    expect(html).toContain('Evidence citations');
    expect(html).toContain('Sources used');
    expect(html.match(/<em>Locked<\/em>/gu)).toHaveLength(2);
    expect(html).toContain('<em>Default</em>');
    expect(html).toContain('removable by an explicit Assistant request');
    expect(html).toContain('Revert changes');
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
      'Title slide and Sources used are document-level items, not custom content sections.',
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

  it('collapses rows and system items without horizontal overflow at constrained widths', () => {
    const styles = readFileSync(
      new URL('../src/renderer/src/lecture-structure-editor.css', import.meta.url),
      'utf8',
    );

    expect(styles).toMatch(/container:\s*lecture-structure-editor \/ inline-size/u);
    expect(styles).toMatch(
      /@container lecture-structure-editor \(max-width: 720px\)[\s\S]*?\.lecture-structure-system-items ul\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u,
    );
    expect(styles).toMatch(
      /@container lecture-structure-editor \(max-width: 480px\)[\s\S]*?\.lecture-structure-mode\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u,
    );
    expect(styles).toContain('min-width: 0;');
  });
});
