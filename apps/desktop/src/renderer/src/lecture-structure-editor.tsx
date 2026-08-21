import { useEffect, useId, useRef } from 'react';

import {
  DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE,
  GOSU_LECTURE_STUDIO_STRUCTURE_TEMPLATE,
  LECTURE_STUDIO_MAX_STRUCTURE_SECTIONS,
  LECTURE_STUDIO_MAX_STRUCTURE_SECTION_TITLE,
  LECTURE_STUDIO_SOURCE_LIST_SECTION_TITLES,
  LectureStudioStructureTemplateSchema,
  normalizeLectureStudioDocumentSectionTitle,
  type LectureStudioDocumentFeatures,
  type LectureStudioStructureCoverage,
  type LectureStudioStructureSection,
  type LectureStudioStructureTemplate,
} from '../../shared/lecture-studio-contracts';
import './lecture-structure-editor.css';

type LectureStructureEditorProps = Readonly<{
  value: LectureStudioStructureTemplate;
  onChange: (value: LectureStudioStructureTemplate) => void;
  disabled?: boolean;
  contextCopy?: string;
  heading?: string;
  idPrefix?: string;
  onReset?: (() => void) | undefined;
  resetDisabled?: boolean;
  resetLabel?: string;
  allowedSourceListSectionTitles?: readonly string[];
}>;

type LectureDocumentFeaturesEditorProps = Readonly<{
  value: LectureStudioDocumentFeatures;
  onChange: (value: LectureStudioDocumentFeatures) => void;
  disabled?: boolean;
  heading?: string;
  contextCopy?: string;
  idPrefix?: string;
}>;

export type LectureStructureEditorValidation = Readonly<{
  valid: boolean;
  messages: readonly string[];
  sectionMessages: readonly (readonly string[])[];
  coverageInvalid: boolean;
}>;

const SOURCE_LIST_SECTION_TITLE_SET = new Set(
  LECTURE_STUDIO_SOURCE_LIST_SECTION_TITLES.map((title) =>
    normalizeLectureStudioDocumentSectionTitle(title),
  ),
);
const SOURCE_LIST_SECTION_ISSUE =
  'Source lists are controlled by Document elements. Choose a content topic instead.';

function isCanonicalSourcesUsedLiteral(value: string) {
  return value.normalize('NFC').trim().toLowerCase() === 'sources used';
}

function customTemplate(
  sections: readonly LectureStudioStructureSection[],
): LectureStudioStructureTemplate {
  return {
    mode: 'custom',
    sections: sections.map((section) => ({ ...section })),
  };
}

export function gosuLectureStructureTemplate(): LectureStudioStructureTemplate {
  return customTemplate(GOSU_LECTURE_STUDIO_STRUCTURE_TEMPLATE.sections);
}

function newSectionTitle(sections: readonly LectureStudioStructureSection[]) {
  const titles = new Set(sections.map((section) => section.title.trim().toLocaleLowerCase()));
  let suffix = 1;
  while (titles.has(suffix === 1 ? 'new section' : `new section ${suffix}`)) suffix += 1;
  return suffix === 1 ? 'New section' : `New section ${suffix}`;
}

export function addLectureStructureSection(
  value: LectureStudioStructureTemplate,
): LectureStudioStructureTemplate {
  const sections = value.mode === 'custom' ? value.sections : [];
  if (sections.length >= LECTURE_STUDIO_MAX_STRUCTURE_SECTIONS) return value;
  return customTemplate([
    ...sections,
    { title: newSectionTitle(sections), coverage: 'notes-and-slides' },
  ]);
}

export function updateLectureStructureSection(
  value: LectureStudioStructureTemplate,
  index: number,
  update: Partial<LectureStudioStructureSection>,
): LectureStudioStructureTemplate {
  if (value.mode !== 'custom' || index < 0 || index >= value.sections.length) return value;
  return customTemplate(
    value.sections.map((section, sectionIndex) =>
      sectionIndex === index ? { ...section, ...update } : section,
    ),
  );
}

export function moveLectureStructureSection(
  value: LectureStudioStructureTemplate,
  from: number,
  to: number,
): LectureStudioStructureTemplate {
  if (
    value.mode !== 'custom' ||
    from < 0 ||
    from >= value.sections.length ||
    to < 0 ||
    to >= value.sections.length ||
    from === to
  ) {
    return value;
  }
  const sections = value.sections.map((section) => ({ ...section }));
  const [section] = sections.splice(from, 1);
  if (!section) return value;
  sections.splice(to, 0, section);
  return customTemplate(sections);
}

export function removeLectureStructureSection(
  value: LectureStudioStructureTemplate,
  index: number,
): LectureStudioStructureTemplate {
  if (
    value.mode !== 'custom' ||
    value.sections.length <= 1 ||
    index < 0 ||
    index >= value.sections.length
  ) {
    return value;
  }
  return customTemplate(value.sections.filter((_, sectionIndex) => sectionIndex !== index));
}

function friendlySectionIssue(section: LectureStudioStructureSection | undefined) {
  const title = section?.title ?? '';
  const normalized = normalizeLectureStudioDocumentSectionTitle(title);
  if (normalized.length === 0) return 'Enter a section name.';
  if (title.trim().length > LECTURE_STUDIO_MAX_STRUCTURE_SECTION_TITLE) {
    return `Keep section names within ${LECTURE_STUDIO_MAX_STRUCTURE_SECTION_TITLE} characters.`;
  }
  if (SOURCE_LIST_SECTION_TITLE_SET.has(normalized)) {
    return SOURCE_LIST_SECTION_ISSUE;
  }
  if (['title', 'title slide'].includes(normalized)) {
    return 'The title page is controlled by Document elements, not the custom content flow.';
  }
  return 'Use a plain-text section name without brackets, braces, or LaTeX commands.';
}

function friendlyGlobalIssue(message: string) {
  if (message === 'Structure section names must be unique') {
    return 'Use a different name for each section.';
  }
  if (message === 'At least one section must be covered in both notes and slides') {
    return 'At least one section must appear in both notes and slides.';
  }
  return 'Review the highlighted content-flow section before saving.';
}

export function lectureStructureEditorValidation(
  value: LectureStudioStructureTemplate,
  allowedSourceListSectionTitles: readonly string[] = [],
): LectureStructureEditorValidation {
  const allowedSourceListTitleSet = new Set(
    allowedSourceListSectionTitles.map((title) =>
      normalizeLectureStudioDocumentSectionTitle(title),
    ),
  );
  const parsed = LectureStudioStructureTemplateSchema.safeParse(value);
  const sectionMessages: string[][] = value.mode === 'custom' ? value.sections.map(() => []) : [];
  const messages: string[] = [];
  let valid = true;
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const sectionIndex = typeof issue.path[1] === 'number' ? issue.path[1] : null;
      const section =
        sectionIndex === null || value.mode !== 'custom' ? undefined : value.sections[sectionIndex];
      const normalizedTitle = normalizeLectureStudioDocumentSectionTitle(section?.title ?? '');
      const grandfatheredSourceListIssue =
        sectionIndex !== null &&
        SOURCE_LIST_SECTION_TITLE_SET.has(normalizedTitle) &&
        allowedSourceListTitleSet.has(normalizedTitle) &&
        !isCanonicalSourcesUsedLiteral(section?.title ?? '') &&
        issue.message === 'Document-level items cannot be added to the custom content flow';
      if (grandfatheredSourceListIssue) continue;

      valid = false;
      const message =
        sectionIndex === null ? friendlyGlobalIssue(issue.message) : friendlySectionIssue(section);
      if (!messages.includes(message)) messages.push(message);
      if (sectionIndex !== null && sectionMessages[sectionIndex]) {
        const rowMessages = sectionMessages[sectionIndex];
        if (!rowMessages.includes(message)) rowMessages.push(message);
      }
    }
  }

  if (value.mode === 'custom') {
    const indexesByTitle = new Map<string, number[]>();
    for (const [index, section] of value.sections.entries()) {
      const title = normalizeLectureStudioDocumentSectionTitle(section.title);
      if (
        SOURCE_LIST_SECTION_TITLE_SET.has(title) &&
        (!allowedSourceListTitleSet.has(title) || isCanonicalSourcesUsedLiteral(section.title))
      ) {
        valid = false;
        if (!messages.includes(SOURCE_LIST_SECTION_ISSUE)) {
          messages.push(SOURCE_LIST_SECTION_ISSUE);
        }
        if (!sectionMessages[index]?.includes(SOURCE_LIST_SECTION_ISSUE)) {
          sectionMessages[index]?.push(SOURCE_LIST_SECTION_ISSUE);
        }
      }
      const indexes = indexesByTitle.get(title) ?? [];
      indexes.push(index);
      indexesByTitle.set(title, indexes);
    }
    const duplicateMessage = 'Use a different name for each section.';
    for (const indexes of indexesByTitle.values()) {
      if (indexes.length < 2) continue;
      for (const index of indexes) {
        if (!sectionMessages[index]?.includes(duplicateMessage)) {
          sectionMessages[index]?.push(duplicateMessage);
        }
      }
    }
  }

  return {
    valid,
    messages,
    sectionMessages,
    coverageInvalid:
      value.mode === 'custom' &&
      !value.sections.some((section) => section.coverage === 'notes-and-slides'),
  };
}

export function sourceListSectionTitlesInLectureStructure(
  value: LectureStudioStructureTemplate,
): readonly string[] {
  if (value.mode !== 'custom') return [];
  return [
    ...new Set(
      value.sections
        .map((section) => normalizeLectureStudioDocumentSectionTitle(section.title))
        .filter((title) => SOURCE_LIST_SECTION_TITLE_SET.has(title)),
    ),
  ];
}

function sectionDisplayName(section: LectureStudioStructureSection, index: number) {
  return section.title.trim() || `section ${index + 1}`;
}

export function LectureStructureEditor({
  value,
  onChange,
  disabled = false,
  contextCopy = 'Choose a shared content flow. Slides follow the notes in a shorter, evidence-linked form.',
  heading = 'Content flow',
  idPrefix,
  onReset,
  resetDisabled = false,
  resetLabel = 'Revert changes',
  allowedSourceListSectionTitles = [],
}: LectureStructureEditorProps) {
  const generatedId = useId().replaceAll(':', '');
  const fieldId = idPrefix ?? `lecture-structure-${generatedId}`;
  const validation = lectureStructureEditorValidation(value, allowedSourceListSectionTitles);
  const sections = value.mode === 'custom' ? value.sections : [];
  const rowKeyCounter = useRef(0);
  const rowKeys = useRef<string[]>([]);
  const pendingFocusRowKey = useRef<string | null>(null);
  if (rowKeys.current.length > sections.length) {
    rowKeys.current = rowKeys.current.slice(0, sections.length);
  }
  while (rowKeys.current.length < sections.length) {
    rowKeys.current.push(String(rowKeyCounter.current++));
  }

  useEffect(() => {
    const rowKey = pendingFocusRowKey.current;
    if (rowKey === null) return;
    pendingFocusRowKey.current = null;
    document.getElementById(`${fieldId}-section-${rowKey}-title`)?.focus();
  }, [fieldId, sections]);

  const selectMode = (mode: LectureStudioStructureTemplate['mode']) => {
    if (disabled || mode === value.mode) return;
    rowKeys.current = [];
    pendingFocusRowKey.current = null;
    onChange(
      mode === 'adaptive'
        ? { ...DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE }
        : gosuLectureStructureTemplate(),
    );
  };

  return (
    <section className="lecture-structure-editor" aria-labelledby={`${fieldId}-heading`}>
      <header className="lecture-structure-editor-heading">
        <div>
          <h3 id={`${fieldId}-heading`}>{heading}</h3>
          <p>{contextCopy}</p>
        </div>
        <span className="lecture-structure-editor-status" role="status" aria-live="polite">
          {value.mode === 'adaptive'
            ? 'Adaptive'
            : `${sections.length} section${sections.length === 1 ? '' : 's'}`}
        </span>
      </header>

      <fieldset className="lecture-structure-mode" disabled={disabled}>
        <legend>Structure mode</legend>
        <label className={value.mode === 'adaptive' ? 'selected' : ''}>
          <input
            type="radio"
            name={`${fieldId}-mode`}
            value="adaptive"
            checked={value.mode === 'adaptive'}
            onChange={() => selectMode('adaptive')}
          />
          <span>
            <strong>Adaptive</strong>
            <small>Let GOSU choose section names and order from the selected sources.</small>
          </span>
        </label>
        <label className={value.mode === 'custom' ? 'selected' : ''}>
          <input
            type="radio"
            name={`${fieldId}-mode`}
            value="custom"
            checked={value.mode === 'custom'}
            onChange={() => selectMode('custom')}
          />
          <span>
            <strong>Custom outline</strong>
            <small>Choose the section order and whether each section also appears in slides.</small>
          </span>
        </label>
      </fieldset>

      {value.mode === 'adaptive' ? (
        <div className="lecture-structure-adaptive-note">
          <strong>Source-led structure</strong>
          <span>GOSU adapts the outline to the available evidence.</span>
        </div>
      ) : (
        <div className="lecture-structure-custom-editor">
          <div className="lecture-structure-custom-toolbar">
            <div>
              <strong>Custom sections</strong>
              <span>
                {sections.length} / {LECTURE_STUDIO_MAX_STRUCTURE_SECTIONS}
              </span>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={() => {
                rowKeys.current = [];
                pendingFocusRowKey.current = null;
                onChange(gosuLectureStructureTemplate());
              }}
            >
              Load GOSU outline
            </button>
          </div>

          {!validation.valid && (
            <div className="lecture-structure-validation" id={`${fieldId}-validation`} role="alert">
              <strong>Check the content flow</strong>
              <ul>
                {validation.messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          <ol className="lecture-structure-sections">
            {sections.map((section, index) => {
              const rowKey = rowKeys.current[index] ?? String(index);
              const sectionId = `${fieldId}-section-${rowKey}`;
              const sectionMessages = validation.sectionMessages[index] ?? [];
              const displayName = sectionDisplayName(section, index);
              return (
                <li className={sectionMessages.length > 0 ? 'invalid' : ''} key={rowKey}>
                  <span className="lecture-structure-section-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <label htmlFor={`${sectionId}-title`}>
                    Section name
                    <input
                      id={`${sectionId}-title`}
                      value={section.title}
                      maxLength={LECTURE_STUDIO_MAX_STRUCTURE_SECTION_TITLE}
                      disabled={disabled}
                      aria-invalid={sectionMessages.length > 0 || undefined}
                      aria-describedby={
                        sectionMessages.length > 0 ? `${sectionId}-issue` : undefined
                      }
                      onChange={(event) =>
                        onChange(
                          updateLectureStructureSection(value, index, {
                            title: event.target.value,
                          }),
                        )
                      }
                    />
                    {sectionMessages.length > 0 && (
                      <small id={`${sectionId}-issue`} className="lecture-structure-section-issue">
                        {sectionMessages.join(' ')}
                      </small>
                    )}
                  </label>
                  <label htmlFor={`${sectionId}-coverage`}>
                    Cover in
                    <select
                      id={`${sectionId}-coverage`}
                      value={section.coverage}
                      disabled={disabled}
                      aria-invalid={validation.coverageInvalid || undefined}
                      aria-describedby={
                        validation.coverageInvalid ? `${fieldId}-validation` : undefined
                      }
                      onChange={(event) =>
                        onChange(
                          updateLectureStructureSection(value, index, {
                            coverage: event.target.value as LectureStudioStructureCoverage,
                          }),
                        )
                      }
                    >
                      <option value="notes-and-slides">Notes &amp; slides</option>
                      <option value="notes-only">Notes only</option>
                    </select>
                  </label>
                  <div
                    className="lecture-structure-section-actions"
                    role="group"
                    aria-label={`Actions for ${displayName}`}
                  >
                    <button
                      type="button"
                      disabled={disabled || index === 0}
                      aria-label={`Move ${displayName} up`}
                      title="Move section up"
                      onClick={() => {
                        const nextKeys = [...rowKeys.current];
                        const [movedKey] = nextKeys.splice(index, 1);
                        if (movedKey !== undefined) nextKeys.splice(index - 1, 0, movedKey);
                        rowKeys.current = nextKeys;
                        onChange(moveLectureStructureSection(value, index, index - 1));
                      }}
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      disabled={disabled || index === sections.length - 1}
                      aria-label={`Move ${displayName} down`}
                      title="Move section down"
                      onClick={() => {
                        const nextKeys = [...rowKeys.current];
                        const [movedKey] = nextKeys.splice(index, 1);
                        if (movedKey !== undefined) nextKeys.splice(index + 1, 0, movedKey);
                        rowKeys.current = nextKeys;
                        onChange(moveLectureStructureSection(value, index, index + 1));
                      }}
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                    <button
                      type="button"
                      className="lecture-structure-remove-section"
                      disabled={disabled || sections.length <= 1}
                      aria-label={`Remove ${displayName}`}
                      title="Remove section"
                      onClick={() => {
                        const nextKeys = [...rowKeys.current];
                        nextKeys.splice(index, 1);
                        pendingFocusRowKey.current =
                          nextKeys[Math.min(index, nextKeys.length - 1)] ?? null;
                        rowKeys.current = nextKeys;
                        onChange(removeLectureStructureSection(value, index));
                      }}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>

          <button
            type="button"
            className="lecture-structure-add-section"
            disabled={disabled || sections.length >= LECTURE_STUDIO_MAX_STRUCTURE_SECTIONS}
            onClick={() => {
              const rowKey = String(rowKeyCounter.current++);
              rowKeys.current = [...rowKeys.current, rowKey];
              pendingFocusRowKey.current = rowKey;
              onChange(addLectureStructureSection(value));
            }}
          >
            ＋ Add section
          </button>
        </div>
      )}

      {onReset && (
        <div className="lecture-structure-editor-actions">
          <button
            type="button"
            className="ghost-button"
            disabled={disabled || resetDisabled}
            onClick={onReset}
          >
            {resetLabel}
          </button>
        </div>
      )}
    </section>
  );
}

export function LectureDocumentFeaturesEditor({
  value,
  onChange,
  disabled = false,
  heading = 'Document elements',
  contextCopy = 'Choose what appears in the generated notes and slides.',
  idPrefix,
}: LectureDocumentFeaturesEditorProps) {
  const generatedId = useId().replaceAll(':', '');
  const fieldId = idPrefix ?? `lecture-document-features-${generatedId}`;
  const update = <Key extends keyof LectureStudioDocumentFeatures>(
    key: Key,
    checked: LectureStudioDocumentFeatures[Key],
  ) => onChange({ ...value, [key]: checked });

  return (
    <fieldset
      className="lecture-document-features"
      disabled={disabled}
      aria-describedby={`${fieldId}-description`}
    >
      <legend>{heading}</legend>
      <p id={`${fieldId}-description`}>{contextCopy}</p>
      <div>
        <label htmlFor={`${fieldId}-title-page`}>
          <input
            id={`${fieldId}-title-page`}
            type="checkbox"
            checked={value.includeSlideTitlePage}
            aria-describedby={`${fieldId}-title-page-help`}
            onChange={(event) => update('includeSlideTitlePage', event.target.checked)}
          />
          <span>
            <strong>Show a title page in slides</strong>
            <small id={`${fieldId}-title-page-help`}>Counts toward the slide-page target.</small>
          </span>
        </label>
        <label htmlFor={`${fieldId}-evidence-labels`}>
          <input
            id={`${fieldId}-evidence-labels`}
            type="checkbox"
            checked={value.showInlineEvidenceLabels}
            aria-describedby={`${fieldId}-evidence-labels-help`}
            onChange={(event) => update('showInlineEvidenceLabels', event.target.checked)}
          />
          <span>
            <strong>Show source markers in notes and slides</strong>
            <small id={`${fieldId}-evidence-labels-help`}>
              Adds labels such as [P1] beside supported claims. Hidden markers still retain the
              revision&apos;s evidence record.
            </small>
          </span>
        </label>
        <label htmlFor={`${fieldId}-sources-used`}>
          <input
            id={`${fieldId}-sources-used`}
            type="checkbox"
            checked={value.includeSourcesUsedSection}
            aria-describedby={`${fieldId}-sources-used-help`}
            onChange={(event) => update('includeSourcesUsedSection', event.target.checked)}
          />
          <span>
            <strong>Add a Sources used list to notes</strong>
            <small id={`${fieldId}-sources-used-help`}>
              Adds the source list at the end of the notes.
            </small>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
