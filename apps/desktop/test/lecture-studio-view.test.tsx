import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type {
  LectureSourceCandidates,
  LectureStudio,
  LectureStudioAttempt,
  LectureStudioDetail,
  LectureGenerationProgressEvent,
  LectureStudioMessage,
  LectureStudioRevision,
} from '../src/shared/lecture-studio-contracts';
import type { StagedLectureExternalSourceCard } from '../src/shared/lecture-external-source-contracts';
import {
  LECTURE_STUDIO_MAX_ATTACHMENTS,
  type LectureStudioAttachmentCard,
} from '../src/shared/lecture-studio-attachment-contracts';
import {
  activeLectureSourceProjects,
  appendLectureGenerationProgress,
  cacheLectureManualEditSession,
  cachedLectureManualEditSession,
  canEditLectureStudioRevision,
  currentLectureStudioRevision,
  discardCachedLectureManualEditSession,
  formatLectureGenerationElapsed,
  isCurrentLectureGenerationProgress,
  isSameActiveLectureStudioSelection,
  lastLectureMessageId,
  lectureGenerationBriefDraftIsValidForEditor,
  lectureManuscriptAvailabilityLabel,
  lectureStudioAttachmentsAfterReleaseFailure,
  lectureStudioAttachmentsAfterSend,
  lectureArtifactActionLabels,
  lectureErrorCodeMessage,
  LectureGenerationAttemptDetails,
  LectureStudioView,
  lectureOutputProjectName,
  lectureExternalSourceCard,
  lectureGenerationAttemptSummary,
  lectureFigureAssetView,
  lectureFigurePreviewDataUrl,
  lectureFigureReferenceCount,
  lectureFigureSourceToken,
  lectureFigureUsageInDrafts,
  lectureManualEditCacheHasDirtySession,
  lectureOverleafSourceCard,
  lectureStudioMessages,
  lectureStudioStatusLabel,
  lectureSourceHasFigureReferences,
  latestCachedLectureManualEditStudioId,
  mergeLectureCandidatePages,
  mergeLectureComposerFigureFiles,
  mergeLectureStudioAttachments,
  resolveLectureEditDocumentFeatures,
  slideTargetAfterDocumentFeaturesChange,
  shouldAcceptLectureAttachmentPickerResult,
  shouldDiscardLectureStudioAttachments,
  shouldClearLectureGenerationProgress,
  toggleLectureProjectSelection,
  toggleLectureSourceSelection,
  type LectureStudioViewAdapter,
  type LectureManualEditCacheEntry,
} from '../src/renderer/src/lecture-studio-view';
import { VolatileLectureStudioDrafts } from '../src/renderer/src/lecture-studio-session-state';
import type { ProjectRecord } from '../src/shared/workspace-contracts';

const defaultModel = {
  modelId: 'provider-default',
  displayName: 'Provider default',
  isDefault: true,
  reasoningOptions: [{ id: 'high', label: 'high', isDefault: true }],
};

const project: ProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Research Alpha',
  slug: 'research-alpha',
  version: 1,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

function lectureAttachment(index: number): LectureStudioAttachmentCard {
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString().padStart(12, '0')}`,
    displayName: `reference-${index}.tex`,
    format: 'latex',
    byteSize: 1_024,
    sha256: index.toString(16).padStart(64, '0'),
    unitLabel: 'part',
    unitCount: 1,
    extractedCharacters: 900,
    truncated: false,
    textAvailable: true,
    reconstructionNotice: 'Exact UTF-8 source text.',
    expiresAt: '2026-08-16T10:00:00.000Z',
  };
}

const adapter: LectureStudioViewAdapter = {
  list: vi.fn(),
  detail: vi.fn(),
  candidates: vi.fn(),
  stageExternalSources: vi.fn(),
  removeStagedExternalSource: vi.fn(),
  discardExternalSourceSet: vi.fn(),
  importOverleaf: vi.fn(),
  chooseAttachments: vi.fn(),
  releaseAttachment: vi.fn(),
  create: vi.fn(),
  updateGenerationBrief: vi.fn(),
  editDraft: vi.fn(),
  saveManualRevision: vi.fn(),
  listFigures: vi.fn(),
  chooseFigures: vi.fn(),
  stageDroppedFigures: vi.fn(),
  removeFigure: vi.fn(),
  previewFigure: vi.fn(),
  generate: vi.fn(),
  send: vi.fn(),
  cancel: vi.fn(),
  trash: vi.fn(),
  restore: vi.fn(),
  emptyTrash: vi.fn(),
  compilePdf: vi.fn(),
  exportArtifact: vi.fn(),
  openArtifact: vi.fn(),
  revealArtifact: vi.fn(),
  onEvent: vi.fn(() => () => undefined),
};

describe('LectureStudioView', () => {
  it('keeps explicit stop controls on both Lecture generation surfaces', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('Stop generation');
    expect(source).toContain('aria-label="Stop the current Lecture Assistant response"');
    expect(source).toContain('Stop response');
  });

  it('snapshots the Settings model default only for a missing Studio scope', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('loadLectureStudioModelSelectionState(window.localStorage, studioId)');
    expect(source).toContain("if (loaded.status !== 'missing') return loaded.selection;");
    expect(source).toContain(
      'saveLectureStudioModelSelection(window.localStorage, studioId, defaultModelSelection)',
    );
    expect(source).toContain('useState<LectureStudioModelSelection>(defaultModelSelection);');
  });

  it('presents a workspace-level studio instead of a project-scoped lecture tab', () => {
    const html = renderToStaticMarkup(
      <LectureStudioView
        projects={[project]}
        adapter={adapter}
        draftStore={new VolatileLectureStudioDrafts()}
        models={[defaultModel]}
        modelsLoading={false}
        codexAuthenticationRequired={false}
        onRefreshModels={() => undefined}
        onOpenCodexSignIn={() => undefined}
        overleafPersonalTokenState="configured"
        onOpenOverleafSettings={() => undefined}
        layout={{ schemaVersion: 1, studioRailCollapsed: false, chatCollapsed: false }}
        onLayoutChange={() => undefined}
      />,
    );

    expect(html).not.toContain('Workspace / Lecture studio');
    expect(html).not.toContain('Combine captured manuscripts, reviewed paper metadata');
    expect(html).toContain('＋ New');
    expect(html).toContain('STUDIOS');
    expect(html).toContain('Hide lecture sessions');
    expect(html).toContain('aria-controls="lecture-studio-sessions"');
  });

  it('keeps source, document, and lecture-chat panes independently scrollable', () => {
    const styles = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.css', import.meta.url),
      'utf8',
    );

    expect(styles).toMatch(/\.lecture-source-projects\s*\{[^}]*overflow:\s*auto;/su);
    expect(styles).toMatch(/\.lecture-preview-document\s*\{[^}]*overflow:\s*auto;/su);
    expect(styles).toMatch(/\.lecture-chat-messages\s*\{[^}]*overflow:\s*auto;/su);
    expect(styles).toMatch(/@media \(max-width: 920px\)/u);
    expect(styles).not.toMatch(/@media \(max-width: 1360px\)/u);
    expect(styles).toMatch(/\.lecture-studio-layout\.chat-collapsed/u);
    expect(styles).toMatch(/\.lecture-studio-layout\.studio-rail-collapsed/u);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/u);
  });

  it('selects only the current revision and messages of the active lecture', () => {
    const studio = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      currentRevision: 2,
    } as LectureStudio;
    const current = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      studioId: studio.id,
      revision: 2,
    } as LectureStudioRevision;
    const older = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      studioId: studio.id,
      revision: 1,
    } as LectureStudioRevision;
    const selectedMessage = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      studioId: studio.id,
    } as LectureStudioMessage;
    const detail = {
      studio,
      revisions: [older, current],
      messages: [selectedMessage],
    } as LectureStudioDetail;

    expect(currentLectureStudioRevision(detail, studio)).toBe(current);
    expect(lectureStudioMessages(detail, studio.id)).toEqual([selectedMessage]);
    expect(lectureStudioMessages(detail, null)).toEqual([]);
  });

  it('preserves a legacy revision with Sources used omitted during an unrelated option save', () => {
    const legacyStudio = { generationBrief: {} } as const;
    const omittedRevision = {
      schemaVersion: 3,
      lectureNotesLatex:
        '\\documentclass{article}\n\\begin{document}\n\\section{Overview}\nBody.\n\\end{document}\n',
      generationBriefSnapshot: {},
    } as const;

    const resolved = resolveLectureEditDocumentFeatures(legacyStudio, omittedRevision);
    expect(resolved).toEqual({
      includeSlideTitlePage: true,
      showInlineEvidenceLabels: true,
      includeSourcesUsedSection: false,
    });
    expect({ detailLevel: 'detailed', documentFeatures: resolved }.documentFeatures).toEqual(
      resolved,
    );

    expect(
      resolveLectureEditDocumentFeatures(legacyStudio, {
        ...omittedRevision,
        generationBriefSnapshot: {
          documentFeatures: {
            includeSlideTitlePage: false,
            showInlineEvidenceLabels: false,
            includeSourcesUsedSection: true,
          },
        },
      }),
    ).toEqual({
      includeSlideTitlePage: false,
      showInlineEvidenceLabels: false,
      includeSourcesUsedSection: true,
    });

    expect(
      resolveLectureEditDocumentFeatures(
        {
          generationBrief: {
            documentFeatures: {
              includeSlideTitlePage: true,
              showInlineEvidenceLabels: false,
              includeSourcesUsedSection: false,
            },
          },
        },
        {
          ...omittedRevision,
          generationBriefSnapshot: {
            documentFeatures: {
              includeSlideTitlePage: false,
              showInlineEvidenceLabels: true,
              includeSourcesUsedSection: true,
            },
          },
        },
      ),
    ).toEqual({
      includeSlideTitlePage: true,
      showInlineEvidenceLabels: false,
      includeSourcesUsedSection: false,
    });

    expect(
      resolveLectureEditDocumentFeatures(legacyStudio, {
        schemaVersion: 2,
        lectureNotesLatex: '\\section{Overview}\nBody.\n\\section*{Sources used}\n[P1] Paper',
      }).includeSourcesUsedSection,
    ).toBe(true);
    expect(
      resolveLectureEditDocumentFeatures(legacyStudio, {
        schemaVersion: 1,
        lectureNotesMarkdown: '# Overview\nBody without a Sources used heading.',
      }),
    ).toEqual({
      includeSlideTitlePage: true,
      showInlineEvidenceLabels: true,
      includeSourcesUsedSection: true,
    });

    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    expect(source.match(/resolveLectureEditDocumentFeatures\(studio, revision\)/gu)).toHaveLength(
      2,
    );
    expect(source).toContain('documentFeatures,');
    expect(source).not.toContain('MARKDOWN_SOURCES_USED_HEADING');
  });

  it('preserves one content page when a title page is enabled for a one-page slide target', () => {
    const withoutTitle = {
      includeSlideTitlePage: false,
      showInlineEvidenceLabels: true,
      includeSourcesUsedSection: true,
    } as const;
    const withTitle = { ...withoutTitle, includeSlideTitlePage: true } as const;

    expect(slideTargetAfterDocumentFeaturesChange('1', withoutTitle, withTitle)).toBe('2');
    expect(slideTargetAfterDocumentFeaturesChange('', withoutTitle, withTitle)).toBe('');
    expect(slideTargetAfterDocumentFeaturesChange('2', withoutTitle, withTitle)).toBe('2');
    expect(
      slideTargetAfterDocumentFeaturesChange('1', withTitle, {
        ...withTitle,
        showInlineEvidenceLabels: false,
      }),
    ).toBe('1');

    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    expect(source.match(/const nextDocumentFeatures =/gu)).toHaveLength(5);
    expect(source.match(/slideTargetAfterDocumentFeaturesChange\(/gu)).toHaveLength(8);
  });

  it('blocks new source-list aliases while preserving the exact normalized alias saved by a Studio', () => {
    const generationBrief = {
      notesTargetPages: null,
      slidesTargetPages: null,
      detailLevel: 'standard',
      structure: {
        mode: 'custom',
        sections: [{ title: ' References ', coverage: 'notes-and-slides' }],
      },
      documentFeatures: {
        includeSlideTitlePage: true,
        showInlineEvidenceLabels: true,
        includeSourcesUsedSection: false,
      },
      customInstructions: '',
    } as const;

    expect(lectureGenerationBriefDraftIsValidForEditor(generationBrief)).toBe(false);
    expect(lectureGenerationBriefDraftIsValidForEditor(generationBrief, ['references'])).toBe(true);
    const historicalCollapsedLookalike = {
      ...generationBrief,
      structure: {
        mode: 'custom',
        sections: [{ title: 'Sources   used', coverage: 'notes-and-slides' }],
      },
    } as const;
    expect(
      lectureGenerationBriefDraftIsValidForEditor(historicalCollapsedLookalike, ['sources used']),
    ).toBe(true);
    expect(
      lectureGenerationBriefDraftIsValidForEditor(
        {
          ...historicalCollapsedLookalike,
          structure: {
            mode: 'custom',
            sections: [{ title: 'Sources used', coverage: 'notes-and-slides' }],
          },
        },
        ['sources used'],
      ),
    ).toBe(false);
    expect(
      lectureGenerationBriefDraftIsValidForEditor(
        {
          ...generationBrief,
          structure: {
            mode: 'custom',
            sections: [{ title: 'Bibliography', coverage: 'notes-and-slides' }],
          },
        },
        ['references'],
      ),
    ).toBe(false);

    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('lectureGenerationBriefDraftIsValidForEditor(generationBriefDraft)');
    expect(source).toContain(
      'sourceListSectionTitlesInLectureStructure(studio.generationBrief.structure)',
    );
    expect(source).toContain('allowedSourceListSectionTitles={allowedSourceListSectionTitles}');
    expect(source).toContain(
      'This saved default needs attention in Settings → Lecture defaults before creating a',
    );
  });

  it('keeps archived output project names available without making them creation candidates', () => {
    const archivedProject = {
      ...project,
      name: 'Archived Evidence Project',
      archivedAt: '2026-08-07T00:00:00.000Z',
    };

    expect(lectureOutputProjectName([archivedProject], archivedProject.id)).toBe(
      'Archived Evidence Project',
    );
    expect(activeLectureSourceProjects([project, archivedProject])).toEqual([project]);
  });

  it('provides readable status text in addition to the visual status dot', () => {
    expect(lectureStudioStatusLabel('draft')).toBe('Draft');
    expect(lectureStudioStatusLabel('generating')).toBe('Generating');
    expect(lectureStudioStatusLabel('ready')).toBe('Ready');
    expect(lectureStudioStatusLabel('failed')).toBe('Failed');

    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain(
      '<span className="sr-only">Status: {lectureStudioStatusLabel(studio.status)}. </span>',
    );
  });

  it('keeps a bounded ordered generation activity view and resets it per attempt', () => {
    const event = (
      attemptId: string,
      sequence: number,
      phase: LectureGenerationProgressEvent['phase'],
    ): LectureGenerationProgressEvent => ({
      schemaVersion: 1,
      type: 'lecture.generation.progress',
      studioId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      attemptId,
      phase,
      sequence,
      startedAt: '2026-08-15T00:00:00.000Z',
      occurredAt: `2026-08-15T00:00:${sequence.toString().padStart(2, '0')}.000Z`,
    });
    const firstAttempt = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const secondAttempt = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    let progress = appendLectureGenerationProgress(
      undefined,
      event(firstAttempt, 1, 'preparing_sources'),
    );
    progress = appendLectureGenerationProgress(progress, event(firstAttempt, 2, 'model_active'));
    progress = appendLectureGenerationProgress(progress, event(firstAttempt, 3, 'model_active'));

    expect(progress.events.map(({ sequence }) => sequence)).toEqual([1, 3]);
    expect(
      appendLectureGenerationProgress(progress, event(firstAttempt, 2, 'saving_revision')),
    ).toBe(progress);
    progress = appendLectureGenerationProgress(
      progress,
      event(secondAttempt, 1, 'preparing_sources'),
    );
    expect(progress).toMatchObject({ attemptId: secondAttempt, events: [{ sequence: 1 }] });
    const latePriorAttempt = {
      ...event(firstAttempt, 4, 'saving_revision'),
      startedAt: '2026-08-14T23:59:59.000Z',
    };
    expect(appendLectureGenerationProgress(progress, latePriorAttempt)).toBe(progress);
    expect(isCurrentLectureGenerationProgress(latePriorAttempt, secondAttempt)).toBe(false);
    expect(
      isCurrentLectureGenerationProgress(event(secondAttempt, 2, 'starting_model'), secondAttempt),
    ).toBe(true);
    expect(
      isCurrentLectureGenerationProgress(event(secondAttempt, 2, 'starting_model'), null),
    ).toBe(false);
    expect(
      shouldClearLectureGenerationProgress(progress, {
        schemaVersion: 1,
        type: 'lecture.studio.changed',
        studioId: event(firstAttempt, 1, 'preparing_sources').studioId,
        status: 'generating',
        activeAttemptId: firstAttempt,
        version: 3,
        occurredAt: '2026-08-15T00:01:00.000Z',
      }),
    ).toBe(true);
    expect(
      formatLectureGenerationElapsed(
        '2026-08-15T00:00:00.000Z',
        Date.parse('2026-08-15T00:02:05.000Z'),
      ),
    ).toBe('2m 05s');
  });

  it('keeps generation logging above non-shrinking document controls', () => {
    const css = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.css', import.meta.url),
      'utf8',
    );

    for (const selector of [
      '.lecture-preview-toolbar',
      '.lecture-preview-tabs',
      '.lecture-artifact-actions',
    ]) {
      const escapedSelector = selector.replaceAll('.', '\\.');
      const rule = css.match(new RegExp(`${escapedSelector} \\{([^}]*)\\}`, 'u'));
      expect(rule?.[1], selector).toContain('flex: 0 0 auto;');
    }
    expect(css).toMatch(/\.lecture-preview-document\s*\{[^}]*min-height:\s*0;/su);
  });

  it('offers a reversible PDF-only focus mode that removes surrounding Studio chrome', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    const css = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.css', import.meta.url),
      'utf8',
    );

    expect(source).toContain("pdfFocusMode ? 'Exit focus' : 'Focus PDF'");
    expect(source).toContain('aria-pressed={pdfFocusMode}');
    expect(source).toContain("if (event.key !== 'Escape') return;");
    expect(css).toMatch(
      /\.lecture-studio-layout\.pdf-focused[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/su,
    );
    expect(css).toMatch(/\.lecture-studio-layout\.pdf-focused > \.lecture-studio-rail/su);
    expect(css).toMatch(/\.lecture-preview\.pdf-focused > \.lecture-preview-toolbar/su);
    expect(css).toMatch(
      /\.lecture-preview\.pdf-focused > \.lecture-preview-document\.pdf\s*\{[^}]*padding:\s*0;/su,
    );
  });

  it('maps bounded generation validation categories to actionable messages', () => {
    expect(lectureErrorCodeMessage('lecture_invalid_response_json')).toContain(
      'after one automatic correction',
    );
    expect(lectureErrorCodeMessage('lecture_invalid_response_schema')).toContain(
      'incomplete lecture draft',
    );
    expect(lectureErrorCodeMessage('lecture_invalid_latex_grammar')).toContain('unsupported LaTeX');
    expect(lectureErrorCodeMessage('lecture_invalid_citation_mapping')).toContain(
      'wrong Sources used visibility',
    );
    expect(lectureErrorCodeMessage('lecture_invalid_slide_count')).toContain(
      'Adjust the slide target or retry',
    );
  });

  it('projects persisted validation attempts into fixed, content-free generation details', () => {
    const attempt = {
      schemaVersion: 1,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      studioId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'failed',
      requestedModelId: 'private-requested-model-id',
      resolvedModelId: 'private-resolved-model-id',
      providerId: 'private-provider-id',
      catalogVersion: 'private-catalog-version',
      reasoningOptionId: 'high',
      phases: [
        {
          phase: 'preparing_sources',
          sequence: 1,
          occurredAt: '2026-08-15T00:00:01.000Z',
        },
        {
          phase: 'correcting_output',
          sequence: 2,
          occurredAt: '2026-08-15T00:01:30.000Z',
        },
      ],
      validations: [
        {
          pass: 'initial',
          category: 'latex_grammar',
          diagnostics: [
            {
              document: 'lecture-notes',
              reason: 'unsupported_command',
              tokenCount: 3,
              token: '\\privateSourceMacro',
            },
            {
              document: 'slides',
              reason: 'control_character',
              tokenCount: 1,
            },
          ],
          recordedAt: '2026-08-15T00:01:00.000Z',
        },
        {
          pass: 'correction',
          category: 'latex_grammar',
          diagnostics: [
            {
              document: 'lecture-notes',
              reason: 'ambiguous_json_backslash_escape',
              tokenCount: 2,
            },
          ],
          recordedAt: '2026-08-15T00:02:00.000Z',
        },
      ],
      terminalCode: 'lecture_invalid_latex_grammar',
      startedAt: '2026-08-15T00:00:00.000Z',
      completedAt: '2026-08-15T00:02:05.000Z',
    } as unknown as LectureStudioAttempt;

    const summary = lectureGenerationAttemptSummary(attempt);
    expect(summary).toMatchObject({
      outcome: 'Failed',
      elapsed: '2m 05s',
      model: 'Selected model',
      reasoning: 'High',
      phases: [
        { label: 'Resolving frozen project sources', occurredAt: '2026-08-15T00:00:01.000Z' },
        {
          label: 'Running the one bounded automatic correction',
          occurredAt: '2026-08-15T00:01:30.000Z',
        },
      ],
      validations: [
        {
          pass: 'Initial check',
          category: 'LaTeX compatibility',
          diagnostics: [
            { document: 'Notes', reason: 'Unsupported LaTeX command', tokenCount: 3 },
            { document: 'Slides', reason: 'Invalid hidden character', tokenCount: 1 },
          ],
        },
        {
          pass: 'Correction check',
          category: 'LaTeX compatibility',
          diagnostics: [{ document: 'Notes', reason: 'Ambiguous LaTeX backslash', tokenCount: 2 }],
        },
      ],
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('private-requested-model-id');
    expect(serialized).not.toContain('private-resolved-model-id');
    expect(serialized).not.toContain('private-provider-id');
    expect(serialized).not.toContain('privateSourceMacro');

    const html = renderToStaticMarkup(<LectureGenerationAttemptDetails attempt={attempt} />);
    expect(html).toContain('<summary>Generation details</summary>');
    expect(html).toContain('aria-label="Generation activity"');
    expect(html).toContain('aria-label="Validation checks"');
    expect(html).toContain('3 flagged items');
    expect(html).not.toContain('private-requested-model-id');
    expect(html).not.toContain('private-resolved-model-id');
    expect(html).not.toContain('private-provider-id');
    expect(html).not.toContain('privateSourceMacro');
  });

  it('renders terminal attempt codes as fixed recovery copy without exposing raw codes', () => {
    const attempt = (terminalCode: LectureStudioAttempt['terminalCode']) =>
      ({
        schemaVersion: 1,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        studioId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        status: 'failed',
        requestedModelId: null,
        resolvedModelId: null,
        providerId: null,
        catalogVersion: null,
        reasoningOptionId: null,
        phases: [],
        validations: [],
        terminalCode,
        startedAt: '2026-08-15T00:00:00.000Z',
        completedAt: '2026-08-15T00:00:12.000Z',
      }) as LectureStudioAttempt;

    expect(lectureGenerationAttemptSummary(attempt('lecture_generation_timed_out'))).toMatchObject({
      elapsed: '12s',
      model: 'Automatic selection',
      reasoning: 'Provider default',
      terminal: expect.stringContaining('30-minute safety limit'),
    });
    expect(lectureGenerationAttemptSummary(attempt('lecture_pdf_compile_failed')).terminal).toBe(
      'The local LaTeX compiler could not build this revision. The saved LaTeX is unchanged.',
    );

    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('lastAttempt={detail?.lastAttempt ?? null}');
    expect(source).toContain('<summary>Generation details</summary>');
    expect(source).toContain('!lastAttempt && <code>{studio.lastErrorCode}</code>');
  });

  it('merges project-scoped source pages without dropping already loaded records', () => {
    const page = (records: Array<{ id: string }>, offset: number, total: number) =>
      ({
        schemaVersion: 1,
        projects: [
          {
            projectId: project.id,
            projectName: project.name,
            literatureRecords: records,
            literaturePage: {
              offset,
              limit: records.length,
              total,
              hasMore: offset + records.length < total,
            },
            experiments: [],
            experimentPage: { offset: 0, limit: 100, total: 0, hasMore: false },
            manuscripts: [],
          },
        ],
      }) as LectureSourceCandidates;

    const initial = mergeLectureCandidatePages(
      null,
      page([{ id: 'paper-1' }, { id: 'paper-2' }], 0, 3),
    );
    const merged = mergeLectureCandidatePages(initial, page([{ id: 'paper-3' }], 2, 3));

    expect(merged.projects[0]?.literatureRecords.map(({ id }) => id)).toEqual([
      'paper-1',
      'paper-2',
      'paper-3',
    ]);
    expect(merged.projects[0]?.literaturePage).toMatchObject({
      nextOffset: 3,
      total: 3,
      hasMore: false,
    });
    expect(merged.projects[0]?.literaturePage).not.toHaveProperty('offset');
    expect(merged.projects[0]?.literaturePage).not.toHaveProperty('limit');
  });

  it('caps project and source selection before invalid create payloads reach IPC', () => {
    const twelveProjects = Array.from({ length: 12 }, (_, index) => `project-${index}`);
    const rejectedProject = toggleLectureProjectSelection(twelveProjects, 'project-12');
    expect(rejectedProject.projectIds).toEqual(twelveProjects);
    expect(rejectedProject.error).toContain('at most 12 projects');

    const oneHundredSources = new Set(
      Array.from({ length: 100 }, (_, index) => `project:source-${index}`),
    );
    const rejectedSource = toggleLectureSourceSelection(oneHundredSources, 'project:source-100', 0);
    expect(rejectedSource.sourceIds.size).toBe(100);
    expect(rejectedSource.error).toContain('at most 100 sources in total');

    const removedSource = toggleLectureSourceSelection(oneHundredSources, 'project:source-0', 0);
    expect(removedSource.sourceIds.size).toBe(99);
    expect(removedSource.error).toBeNull();
  });

  it('uses the last message identity so a rolling recent-50 window still detects change', () => {
    const before = Array.from(
      { length: 50 },
      (_, index) => ({ id: `message-${index}` }) as LectureStudioMessage,
    );
    const after = [...before.slice(1), { id: 'message-50' } as LectureStudioMessage];

    expect(before).toHaveLength(after.length);
    expect(lastLectureMessageId(before)).toBe('message-49');
    expect(lastLectureMessageId(after)).toBe('message-50');
  });

  it('bounds attachment picker results and rejects results from a stale Studio scope', () => {
    const existing = [lectureAttachment(0), lectureAttachment(1)];
    const selected = [
      lectureAttachment(1),
      lectureAttachment(2),
      lectureAttachment(2),
      lectureAttachment(3),
      lectureAttachment(4),
      lectureAttachment(5),
    ];
    const merged = mergeLectureStudioAttachments(existing, selected);

    expect(merged.attachments).toHaveLength(LECTURE_STUDIO_MAX_ATTACHMENTS);
    expect(merged.attachments.map(({ id }) => id)).toEqual(
      [0, 1, 2, 3, 4].map((index) => lectureAttachment(index).id),
    );
    expect(merged.rejected.map(({ id }) => id)).toEqual([lectureAttachment(5).id]);
    expect(
      shouldAcceptLectureAttachmentPickerResult(true, 'studio-a', 'studio-a', 4, 4, 3, 3, true),
    ).toBe(true);
    expect(
      shouldAcceptLectureAttachmentPickerResult(true, 'studio-a', 'studio-b', 4, 4, 3, 3, true),
    ).toBe(false);
    expect(
      shouldAcceptLectureAttachmentPickerResult(true, 'studio-a', 'studio-a', 4, 5, 3, 3, true),
    ).toBe(false);
    expect(
      shouldAcceptLectureAttachmentPickerResult(false, 'studio-a', 'studio-a', 4, 4, 3, 3, true),
    ).toBe(false);
    expect(
      shouldAcceptLectureAttachmentPickerResult(true, 'studio-a', 'studio-a', 4, 4, 2, 3, true),
    ).toBe(false);
    expect(
      shouldAcceptLectureAttachmentPickerResult(true, 'studio-a', 'studio-a', 4, 4, 3, 3, false),
    ).toBe(false);
  });

  it('keeps a failed edit retryable when a prior revision remains available', () => {
    const base = {
      currentRevision: 2,
      activeAttemptId: null,
    } as const;
    expect(canEditLectureStudioRevision({ ...base, status: 'ready' })).toBe(true);
    expect(canEditLectureStudioRevision({ ...base, status: 'failed' })).toBe(true);
    expect(
      canEditLectureStudioRevision({ status: 'failed', currentRevision: 0, activeAttemptId: null }),
    ).toBe(false);
    expect(
      canEditLectureStudioRevision({
        ...base,
        status: 'generating',
        activeAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    ).toBe(false);
  });

  it('clears consumed attachments only after an accepted edit and preserves them on failure', () => {
    const attachments = [lectureAttachment(0), lectureAttachment(1)];
    const sent = new Set([attachments[0]!.id]);

    expect(lectureStudioAttachmentsAfterSend(attachments, sent, false)).toBe(attachments);
    expect(lectureStudioAttachmentsAfterSend(attachments, sent, true)).toEqual([attachments[1]]);

    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('aria-label="Attach lecture reference files"');
    expect(source).toContain('Attach up to 5 LaTeX, Markdown, or PDF files to this edit');
    expect(source).toContain('aria-label={`Remove ${attachment.displayName}`}');
    expect(source).toContain('aria-label="Attached references"');
    expect(source).toContain('retained with the successful revision’s source');
    expect(source).toContain('const succeeded = await onSend(message, [...sentAttachmentIds]);');
    expect(source).toContain('if (succeeded) {');
    expect(source).not.toContain('if (!succeeded) setAttachments([])');
  });

  it('restores an optimistically removed attachment when Main release fails non-terminally', () => {
    const removed = lectureAttachment(0);
    const remaining = [lectureAttachment(1)];

    expect(
      lectureStudioAttachmentsAfterReleaseFailure(
        remaining,
        removed,
        0,
        new Error('lecture_external_source_scope_mismatch'),
      ).map(({ id }) => id),
    ).toEqual([removed.id, remaining[0]!.id]);
    expect(
      lectureStudioAttachmentsAfterReleaseFailure(
        remaining,
        removed,
        0,
        new Error(
          "Error invoking remote method 'lecture-studio:release-attachment': lecture_external_source_expired",
        ),
      ),
    ).toBe(remaining);
    expect(
      shouldDiscardLectureStudioAttachments(new Error('lecture_external_source_expired')),
    ).toBe(true);
    expect(
      shouldDiscardLectureStudioAttachments(new Error('lecture_external_source_corrupt')),
    ).toBe(true);
    expect(
      shouldDiscardLectureStudioAttachments(new Error('lecture_external_source_scope_mismatch')),
    ).toBe(false);
    expect(
      lectureStudioAttachmentsAfterReleaseFailure(
        remaining,
        removed,
        0,
        new Error('lecture_external_source_corrupt'),
      ),
    ).toBe(remaining);
    expect(
      lectureStudioAttachmentsAfterReleaseFailure(
        remaining,
        removed,
        0,
        new Error('lecture_external_source_not_found'),
      ),
    ).toBe(remaining);

    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('attachmentStudioIdRef.current === releaseStudioId');
    expect(source).toContain('lectureStudioAttachmentsAfterReleaseFailure(');
  });

  it('explains why uncaptured manuscript candidates cannot be selected', () => {
    expect(lectureManuscriptAvailabilityLabel('ready')).toBe('Captured checkpoint ready');
    expect(lectureManuscriptAvailabilityLabel('capture_required')).toBe(
      'Capture a checkpoint in Manuscript first',
    );
    expect(lectureManuscriptAvailabilityLabel('unconnected')).toBe(
      'Connect this manuscript before using it',
    );

    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('<h4>Captured manuscripts</h4>');
    expect(source).toContain('disabled={!ready}');
    expect(source).toContain("toggleSource('manuscript', key)");
  });

  it('discloses the bounded chat history and reviewed-metadata evidence boundary', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('the {LECTURE_STUDIO_RECENT_MESSAGE_WINDOW} most recent messages');
    expect(source).toContain('Reviewed paper metadata');
    expect(source).toContain('full text is verified');
  });

  it('blocks generation and revision chat behind the same Codex sign-in recovery action', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('codexAuthenticationRequired={codexAuthenticationRequired}');
    expect(source).toContain('Sign in to Codex before editing this revision.');
    expect(source).toContain("? 'Sign in to Codex before editing this revision…'");
    expect(source).toContain('!chatEditable');
    expect(source).toContain('codexAuthenticationRequired ||');
    expect(source).toContain('selectionUnavailable');
  });

  it('offers persisted page, detail, and custom generation guidance before synthesis', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('Lecture-note pages');
    expect(source).toContain('Slide pages');
    expect(source).toContain('Additional instructions');
    expect(source).toContain('const generationBriefDraft = {');
    expect(source).toContain('detailLevel,');
    expect(source).toContain('documentFeatures,');
    expect(source).toContain('Edit options');
    expect(source).toContain('Changes apply to the next generation, retry, and chat edit only.');
    expect(source).toContain('adapter.updateGenerationBrief');
    expect(source).toContain('expectedVersion: selectedStudio.version');
    expect(source).toContain('Existing revisions were left unchanged.');
    expect(source).toContain('if (!editingGenerationBrief && !savingGenerationBrief)');
  });

  it('copies the Settings structure once into a new Studio and shows that scope before creation', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    const desktopSource = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );

    expect(desktopSource).toContain('defaultStructure={preferences.defaultLectureStructure}');
    expect(desktopSource).toContain(
      'defaultDocumentFeatures={preferences.defaultLectureDocumentFeatures}',
    );
    expect(desktopSource).toContain(
      'documentFeaturesByProjectId={preferences.lectureDocumentFeaturesByProjectId}',
    );
    expect(source).toMatch(
      /const \[structure\] = useState<LectureStudioStructureTemplate>\(\(\) =>\s*structuredClone\(defaultStructure\),?\s*\);/u,
    );
    expect(source).toContain('generationBrief: generationBriefDraft');
    expect(source).toContain('Adaptive to the selected sources');
    expect(source).toContain('`${structure.sections.length} custom sections`');
    expect(source).toContain(
      'Copied from Settings → Lecture defaults when this Studio is created.',
    );
  });

  it('hydrates and saves complete existing-Studio options without changing prior revisions', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toMatch(
      /const \[structure, setStructure\] = useState<LectureStudioStructureTemplate>\(\(\) =>\s*structuredClone\(studio\.generationBrief\.structure\),?\s*\);/u,
    );
    expect(source).toContain('setStructure(structuredClone(studio.generationBrief.structure));');
    expect(source).toContain(
      'lectureGenerationBriefDraftIsValidForEditor(\n    generationBriefDraft,\n    allowedSourceListSectionTitles,',
    );
    expect(source).toContain('onUpdateGenerationBrief(generationBriefDraft)');
    expect(source).toContain('onReset={() => setStructure(structuredClone(defaultStructure))}');
    expect(source).toContain('resetLabel="Load Settings default"');
    expect(source).toContain(
      'This Studio keeps its own structure. Saving changes affects the next generation, retry, and chat edit only.',
    );
    expect(source).toContain("savingGenerationBrief || busy || studio.status === 'generating'");
    expect(source).toContain('disabled={generationOptionsDisabled}');
    expect(source).toContain('disabled={!generationBriefDraftValid || generationOptionsDisabled}');
    expect(source).toContain('Generation options updated. Existing revisions were left unchanged.');

    const resetHandler = source.match(
      /onReset=\{\(\) => setStructure\(structuredClone\(defaultStructure\)\)\}/u,
    )?.[0];
    expect(resetHandler).toBeDefined();
    expect(resetHandler).not.toContain('adapter');
  });

  it('resolves project document defaults and preserves explicit Studio customization', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    const styles = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.css', import.meta.url),
      'utf8',
    );

    expect(source).toContain('resolveLectureDocumentFeaturesForProject');
    expect(source).toContain('documentFeaturesForProject(projects[0].id)');
    expect(source).toContain('if (!documentFeaturesCustomized)');
    expect(source).toContain('setDocumentFeaturesCustomized(true)');
    expect(source).toContain('Custom for this Studio');
    expect(source).toContain('Load project defaults');
    expect(source).toContain('Load workspace defaults');
    expect(source).toContain(
      'Hidden source markers still retain the revision’s frozen evidence record.',
    );
    expect(source).toContain('min={documentFeatures.includeSlideTitlePage ? 2 : 1}');
    expect(source).not.toContain('<em>Locked</em>');
    expect(styles).toMatch(
      /@container lecture-workspace \(max-width: 620px\)[\s\S]*?\.lecture-generation-document-feature-status\s*\{[\s\S]*?flex-direction:\s*column;/u,
    );
  });

  it('maps external files and Overleaf checkpoints to safe renderer cards', () => {
    const staged = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      displayName: 'analysis.tex',
      kind: 'latex',
      byteSize: 2_048,
      extraction: {
        textAvailable: true,
        truncated: false,
        unitLabel: 'part',
        unitCount: 1,
        extractedCharacters: 1_200,
        reconstructionNotice: 'Exact UTF-8 source text.',
      },
    } as StagedLectureExternalSourceCard;
    expect(lectureExternalSourceCard(staged)).toEqual({
      id: staged.id,
      displayName: 'analysis.tex',
      kind: 'latex',
      byteSize: 2_048,
      textAvailable: true,
      truncated: false,
      unitLabel: 'part',
      unitCount: 1,
      extractedCharacters: 1_200,
      reconstructionNotice: 'Exact UTF-8 source text.',
    });

    const receipt = {
      manuscriptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      candidate: {
        manuscript: { title: 'Shared proof', rootDocument: 'paper/main.tex' },
        providerRevision: 'private-provider-revision',
        observedAt: '2026-08-14T00:00:00.000Z',
      },
    } as Parameters<typeof lectureOverleafSourceCard>[0];
    expect(lectureOverleafSourceCard(receipt)).toEqual({
      manuscriptId: receipt.manuscriptId,
      title: 'Shared proof',
      rootDocument: 'paper/main.tex',
      providerRevision: 'private-provider-revision',
      observedAt: '2026-08-14T00:00:00.000Z',
    });
  });

  it('offers local file and Overleaf evidence in the creation workflow', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('<LectureExternalSourcePicker');
    expect(source).toContain('adapter.stageExternalSources');
    expect(source).toContain('adapter.removeStagedExternalSource');
    expect(source).toContain('.discardExternalSourceSet');
    expect(source).toContain('adapter.importOverleaf');
    expect(source).toContain('externalSources: null');
  });

  it('uses compact accessible icons for revision artifact actions', () => {
    expect(lectureArtifactActionLabels('notes')).toEqual({
      export: 'Export LaTeX',
      open: 'Open LaTeX in default app',
      reveal: 'Show LaTeX in Finder',
    });
    expect(lectureArtifactActionLabels('slides-pdf')).toEqual({
      export: 'Export PDF',
      open: 'Open PDF in default app',
      reveal: 'Show PDF in Finder',
    });
    expect(lectureArtifactActionLabels('notes', 'markdown')).toEqual({
      export: 'Export Markdown',
      open: 'Open Markdown in default app',
      reveal: 'Show Markdown in Finder',
    });
    expect(lectureArtifactActionLabels('notes', 'latex', true)).toEqual({
      export: 'Export LaTeX bundle',
      open: 'Open LaTeX in default app',
      reveal: 'Show LaTeX bundle in Finder',
    });
    expect(lectureArtifactActionLabels('notes-pdf', 'latex', true)).toEqual({
      export: 'Export PDF',
      open: 'Open PDF in default app',
      reveal: 'Show PDF in Finder',
    });
    expect(
      lectureSourceHasFigureReferences(
        '\\section{Plot}\n\\gosuimage{aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa}',
      ),
    ).toBe(true);
    expect(lectureSourceHasFigureReferences('\\section{Plot}\nNo attached figure.')).toBe(false);

    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    const styles = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.css', import.meta.url),
      'utf8',
    );
    expect(source).toContain('aria-label={artifactActionLabels.export}');
    expect(source).toContain('title={artifactActionLabels.export}');
    expect(source).toContain('aria-label={artifactActionLabels.open}');
    expect(source).toContain('title={artifactActionLabels.open}');
    expect(source).toContain('aria-label={artifactActionLabels.reveal}');
    expect(source).toContain('title={artifactActionLabels.reveal}');
    expect(source).toContain('adapter.revealArtifact({ ...input, format: format! })');
    expect(source).toContain('<LectureArtifactActionIcon kind="export" />');
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain('focusable="false"');
    expect(styles).toMatch(
      /\.lecture-artifact-action-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/su,
    );
  });

  it('maps opaque Figure-library assets to exact source tokens and renderer-safe previews', () => {
    const figure = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      studioId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      displayName: 'sampling distribution.png',
      fileName: 'Figure-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
      mediaType: 'image/jpeg',
      sourceFormat: 'png',
      byteSize: 2_048,
      width: 1_200,
      height: 800,
      sha256: 'a'.repeat(64),
      origin: 'user',
      createdAt: '2026-08-20T00:00:00.000Z',
    } as const;
    const token = lectureFigureSourceToken(figure.id);
    const drafts = {
      'lecture-notes': `${token}\n${token}`,
      slides: `\\begin{frame}{Figure}\n${token}\n\\end{frame}`,
    } as const;
    const preview = {
      schemaVersion: 1,
      figure,
      jpegBase64: '/9j/2Q==',
    } as const;

    expect(token).toBe('\\gosuimage{aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa}');
    expect(lectureFigureUsageInDrafts(figure.id, drafts)).toEqual(['lecture-notes', 'slides']);
    expect(lectureFigureReferenceCount(figure.id, drafts)).toBe(3);
    expect(lectureFigurePreviewDataUrl(preview)).toBe('data:image/jpeg;base64,/9j/2Q==');
    expect(lectureFigureAssetView(figure, drafts, lectureFigurePreviewDataUrl(preview))).toEqual(
      expect.objectContaining({
        id: figure.id,
        thumbnailDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
        usedIn: ['lecture-notes', 'slides'],
        referenceCount: 3,
      }),
    );
  });

  it('keeps a dirty direct-edit session in the renderer cache and guards app close after unmount', () => {
    const studioId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const listeners = new Map<
      string,
      (event: { preventDefault: () => void; returnValue: string }) => void
    >();
    const rendererWindow = {
      addEventListener: vi.fn(
        (
          type: string,
          listener: (event: { preventDefault: () => void; returnValue: string }) => void,
        ) => listeners.set(type, listener),
      ),
      removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    };
    vi.stubGlobal('window', rendererWindow);
    const entry: LectureManualEditCacheEntry = {
      session: {
        studioVersion: 4,
        baseRevisionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        baseRevision: 2,
        baseSources: { 'lecture-notes': 'notes', slides: 'slides' },
        drafts: { 'lecture-notes': 'notes changed', slides: 'slides' },
        figures: [],
      },
      activeDocument: 'slides',
      selections: {
        'lecture-notes': { start: 2, end: 2 },
        slides: { start: 4, end: 4 },
      },
      figureDrawerOpen: true,
    };

    try {
      discardCachedLectureManualEditSession(studioId);
      cacheLectureManualEditSession(studioId, entry);
      expect(lectureManualEditCacheHasDirtySession()).toBe(true);
      expect(latestCachedLectureManualEditStudioId()).toBe(studioId);
      expect(cachedLectureManualEditSession(studioId)).toEqual(entry);
      expect(rendererWindow.addEventListener).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function),
      );

      const preventDefault = vi.fn();
      const unloadEvent = { preventDefault, returnValue: 'untouched' };
      listeners.get('beforeunload')?.(unloadEvent);
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(unloadEvent.returnValue).toBe('');
      expect(isSameActiveLectureStudioSelection(studioId, studioId, false)).toBe(true);
      expect(isSameActiveLectureStudioSelection(studioId, studioId, true)).toBe(false);

      discardCachedLectureManualEditSession(studioId);
      expect(cachedLectureManualEditSession(studioId)).toBeNull();
      expect(rendererWindow.removeEventListener).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function),
      );
    } finally {
      discardCachedLectureManualEditSession(studioId);
      vi.unstubAllGlobals();
    }
  });

  it('caps first-revision raster files without metadata-deduping distinct Files', () => {
    const raster = (name: string, type = 'image/png') =>
      ({ name, type, size: 128, lastModified: 1 }) as File;
    const sameMetadataA = raster('plot.png');
    const sameMetadataB = raster('plot.png');
    const merged = mergeLectureComposerFigureFiles(
      [],
      [
        sameMetadataA,
        sameMetadataB,
        raster('two.jpg', 'image/jpeg'),
        raster('three.webp', 'image/webp'),
        raster('four.gif', 'image/gif'),
        raster('over-limit.bmp', 'image/bmp'),
        raster('not-raster.svg', 'image/svg+xml'),
      ],
    );

    expect(merged.files).toEqual([
      sameMetadataA,
      sameMetadataB,
      expect.objectContaining({ name: 'two.jpg' }),
      expect.objectContaining({ name: 'three.webp' }),
      expect.objectContaining({ name: 'four.gif' }),
    ]);
    expect(merged.rejectedCount).toBe(1);
    expect(merged.limitCount).toBe(1);
  });

  it('stages safe composer Files before first generation and keeps failed r0 recoverable', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    const styles = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.css', import.meta.url),
      'utf8',
    );

    expect(source).toContain('{ studioId: studio.id, expectedVersion: studio.version }');
    expect(source).toContain('studio = receipt.studio;');
    expect(source).toContain('await onCreated(studio, initialModelSelection, false);');
    expect(source).toContain('await onCreated(studio, initialModelSelection, true);');
    expect(source).toContain(
      'if (generateInitialRevision) await runGeneration(studio, initialSelection);',
    );
    expect(source).toContain('canManagePreGenerationFigures');
    expect(source).toContain('canInsert={false}');
    expect(source).toContain('setPreGenerationStudioVersion(receipt.studio.version)');
    expect(source).toContain('(canManagePreGenerationFigures && figureOperationsBusy)');
    expect(source).not.toContain('URL.createObjectURL');
    expect(source).not.toContain('webkitRelativePath');
    expect(source).not.toMatch(/\.path\b/u);
    expect(styles).toMatch(/\.lecture-composer-figure-list\s*\{/u);
    expect(styles).toMatch(/\.lecture-preview-empty\.pre-generation\s*\{/u);
  });

  it('integrates paired CAS source saves and path-free Finder drops through the Renderer bridge', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    const desktopSource = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );
    const styles = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.css', import.meta.url),
      'utf8',
    );

    expect(source).toContain('<LectureSourceEditor');
    expect(source).toContain('<LectureFigureLibrary');
    expect(source).toContain('baseRevisionId: edit.baseRevisionId');
    expect(source).toContain("lectureNotesLatexBody: edit.drafts['lecture-notes']");
    expect(source).toContain('slidesLatexBody: edit.drafts.slides');
    expect(source).toContain('const receipt = await adapter.stageDroppedFigures(input, files);');
    expect(source).toContain('studioVersion: receipt.studio.version');
    expect(source).toContain('onFigureLibraryChanged={async (receipt) =>');
    expect(source).toContain('await onFigureLibraryChanged(receipt);');
    expect(source).toContain('expectedVersion: edit.studioVersion');
    expect(source).toContain('Direct source editing is active. Save or cancel it');
    expect(source).toContain('setManualIssue({');
    expect(source).not.toContain('className="lecture-preview-receipts"');
    expect(styles).toMatch(
      /\.lecture-preview\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/su,
    );
    expect(styles).toMatch(/\.lecture-preview-document\s*\{[^}]*flex:\s*1 1 auto;/su);
    expect(desktopSource).toContain('window.gosu.lectureStudio.stageDroppedFigures(input, files)');
    expect(desktopSource).not.toContain('stageDroppedFigures(input, files.map');
    expect(styles).toMatch(
      /@container lecture-workspace \(max-width: 1250px\)[\s\S]*?\.lecture-manual-edit-workspace\.figures-open/u,
    );
  });

  it('offers a recoverable Trash action for each lecture session', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('Move to Trash');
    expect(source).not.toContain('Move to Lecture Trash');
    expect(source).toContain(
      'Saved Research Notes and exported LaTeX/PDF files will stay on disk.',
    );
    expect(source).toContain('await adapter.trash({ studioId: studio.id');
    expect(source.indexOf('await adapter.trash({ studioId: studio.id')).toBeLessThan(
      source.indexOf('discardCachedLectureManualEditSession(studio.id)'),
    );
  });
});
