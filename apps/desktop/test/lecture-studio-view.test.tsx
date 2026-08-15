import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type {
  LectureSourceCandidates,
  LectureStudio,
  LectureStudioDetail,
  LectureGenerationProgressEvent,
  LectureStudioMessage,
  LectureStudioRevision,
} from '../src/shared/lecture-studio-contracts';
import type { StagedLectureExternalSourceCard } from '../src/shared/lecture-external-source-contracts';
import {
  activeLectureSourceProjects,
  appendLectureGenerationProgress,
  currentLectureStudioRevision,
  formatLectureGenerationElapsed,
  isCurrentLectureGenerationProgress,
  lastLectureMessageId,
  lectureManuscriptAvailabilityLabel,
  lectureArtifactActionLabels,
  lectureErrorCodeMessage,
  LectureStudioView,
  lectureOutputProjectName,
  lectureExternalSourceCard,
  lectureOverleafSourceCard,
  lectureStudioMessages,
  lectureStudioStatusLabel,
  mergeLectureCandidatePages,
  shouldClearLectureGenerationProgress,
  toggleLectureProjectSelection,
  toggleLectureSourceSelection,
  type LectureStudioViewAdapter,
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

const adapter: LectureStudioViewAdapter = {
  list: vi.fn(),
  detail: vi.fn(),
  candidates: vi.fn(),
  stageExternalSources: vi.fn(),
  removeStagedExternalSource: vi.fn(),
  discardExternalSourceSet: vi.fn(),
  importOverleaf: vi.fn(),
  create: vi.fn(),
  updateGenerationBrief: vi.fn(),
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

  it('maps bounded generation validation categories to actionable messages', () => {
    expect(lectureErrorCodeMessage('lecture_invalid_response_json')).toContain(
      'after one automatic correction',
    );
    expect(lectureErrorCodeMessage('lecture_invalid_response_schema')).toContain(
      'incomplete lecture draft',
    );
    expect(lectureErrorCodeMessage('lecture_invalid_latex_grammar')).toContain('unsupported LaTeX');
    expect(lectureErrorCodeMessage('lecture_invalid_citation_mapping')).toContain(
      'missing or unknown source labels',
    );
    expect(lectureErrorCodeMessage('lecture_invalid_slide_count')).toContain(
      'Adjust the slide target or retry',
    );
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
    expect(source).toContain(
      "busy || codexAuthenticationRequired || studio.status !== 'ready' || selectionUnavailable",
    );
  });

  it('offers persisted page, detail, and custom generation guidance before synthesis', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('Lecture-note pages');
    expect(source).toContain('Slide pages');
    expect(source).toContain('Additional instructions');
    expect(source).toContain('generationBrief: {');
    expect(source).toContain('detailLevel,');
    expect(source).toContain('Edit options');
    expect(source).toContain('Changes apply to the next generation, retry, and chat edit only.');
    expect(source).toContain('adapter.updateGenerationBrief');
    expect(source).toContain('expectedVersion: selectedStudio.version');
    expect(source).toContain('Existing revisions were left unchanged.');
    expect(source).toContain('if (!editingGenerationBrief && !savingGenerationBrief)');
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
      reveal: 'Show saved folder',
    });
    expect(lectureArtifactActionLabels('slides-pdf')).toEqual({
      export: 'Export PDF',
      open: 'Open PDF in default app',
      reveal: 'Show saved folder',
    });

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
    expect(source).toContain('<LectureArtifactActionIcon kind="export" />');
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain('focusable="false"');
    expect(styles).toMatch(
      /\.lecture-artifact-action-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/su,
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
  });
});
