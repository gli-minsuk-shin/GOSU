import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  LECTURE_STUDIO_CANDIDATE_PAGE_MAX,
  LECTURE_STUDIO_IPC_ERROR_CODES,
  LectureSourceCandidatesSchema,
  LectureSourceManifestSchema,
  LectureSourceSelectionSchema,
  CreateLectureStudioInputSchema,
  EmptyLectureStudioTrashInputSchema,
  ExportLectureStudioArtifactInputSchema,
  LectureStudioDetailSchema,
  LectureStudioListSnapshotSchema,
  LectureStudioSchema,
  LectureStudioSummarySchema,
  ListLectureCandidatesInputSchema,
  OpenLectureStudioArtifactInputSchema,
  RevealLectureStudioArtifactInputSchema,
  UpdateLectureStudioGenerationBriefInputSchema,
  buildLectureStudioTrashTargets,
} from '../src/shared/lecture-studio-contracts';

const timestamp = '2026-08-06T00:00:00.000Z';

function studioFixture() {
  const projectId = randomUUID();
  return LectureStudioSchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    title: 'Cross-project research lecture',
    kind: 'talk',
    durationMinutes: 20,
    outputProjectId: projectId,
    sourceProjectIds: [projectId],
    sourceSelection: {
      literature: [{ projectId, recordId: randomUUID() }],
      experiments: [],
    },
    status: 'draft',
    activeAttemptId: null,
    currentRevision: 0,
    version: 1,
    lastErrorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

describe('Lecture Studio list and detail contracts', () => {
  it('keeps the list payload to summaries without source selections or Markdown history', () => {
    const studio = studioFixture();
    const summary = LectureStudioSummarySchema.parse({
      schemaVersion: studio.schemaVersion,
      id: studio.id,
      title: studio.title,
      kind: studio.kind,
      durationMinutes: studio.durationMinutes,
      outputProjectId: studio.outputProjectId,
      status: studio.status,
      activeAttemptId: studio.activeAttemptId,
      currentRevision: studio.currentRevision,
      version: studio.version,
      lastErrorCode: studio.lastErrorCode,
      createdAt: studio.createdAt,
      updatedAt: studio.updatedAt,
    });

    const snapshot = LectureStudioListSnapshotSchema.parse({
      schemaVersion: 1,
      studios: [summary],
    });

    expect(snapshot.studios).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain('sourceSelection');
    expect(JSON.stringify(snapshot)).not.toContain('messages');
    expect(JSON.stringify(snapshot)).not.toContain('revisions');
  });

  it('scopes every detailed message to the requested studio', () => {
    const studio = studioFixture();
    expect(() =>
      LectureStudioDetailSchema.parse({
        schemaVersion: 1,
        studio,
        messages: [
          {
            schemaVersion: 1,
            id: randomUUID(),
            studioId: randomUUID(),
            role: 'user',
            status: 'complete',
            content: 'Revise the introduction.',
            attemptId: null,
            revision: null,
            invocation: null,
            createdAt: timestamp,
            completedAt: timestamp,
          },
        ],
        revisions: [],
      }),
    ).toThrow();
  });
});

describe('Lecture Studio Trash purge contracts', () => {
  it('builds one canonical target fence from the exact displayed trashed summaries', () => {
    const first = { ...studioFixture(), id: randomUUID(), version: 4, trashedAt: timestamp };
    const second = { ...studioFixture(), id: randomUUID(), version: 2, trashedAt: timestamp };
    const active = { ...studioFixture(), id: randomUUID(), version: 1 };
    const targets = buildLectureStudioTrashTargets([second, active, first]);

    expect(targets).toEqual(
      [first, second]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((studio) => ({
          studioId: studio.id,
          expectedVersion: studio.version,
          trashedAt: studio.trashedAt,
        })),
    );
    expect(
      EmptyLectureStudioTrashInputSchema.parse({
        idempotencyKey: randomUUID(),
        confirmation: 'EMPTY LECTURE TRASH',
        targets,
      }).targets,
    ).toEqual(targets);
  });

  it('rejects omitted, duplicate, unsorted, unbounded, or extended purge targets', () => {
    const left = randomUUID();
    const right = randomUUID();
    const [first, second] = [left, right].sort();
    const target = { studioId: first!, expectedVersion: 1, trashedAt: timestamp };
    const base = {
      idempotencyKey: randomUUID(),
      confirmation: 'EMPTY LECTURE TRASH',
    } as const;

    expect(EmptyLectureStudioTrashInputSchema.safeParse(base).success).toBe(false);
    expect(
      EmptyLectureStudioTrashInputSchema.safeParse({ ...base, targets: [target, target] }).success,
    ).toBe(false);
    expect(
      EmptyLectureStudioTrashInputSchema.safeParse({
        ...base,
        targets: [{ studioId: second!, expectedVersion: 1, trashedAt: timestamp }, target],
      }).success,
    ).toBe(false);
    expect(
      EmptyLectureStudioTrashInputSchema.safeParse({
        ...base,
        targets: [{ ...target, localPath: '/tmp/unsafe' }],
      }).success,
    ).toBe(false);
    expect(
      EmptyLectureStudioTrashInputSchema.safeParse({
        ...base,
        targets: Array.from({ length: 1_001 }, (_, index) => ({
          studioId: `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
          expectedVersion: 1,
          trashedAt: timestamp,
        })),
      }).success,
    ).toBe(false);
  });
});

describe('Lecture Studio candidate pagination contracts', () => {
  it('applies deterministic bounded defaults without weakening selected-source contracts', () => {
    const parsed = ListLectureCandidatesInputSchema.parse({ projectIds: [randomUUID()] });
    expect(parsed).toMatchObject({
      literatureOffset: 0,
      literatureLimit: LECTURE_STUDIO_CANDIDATE_PAGE_MAX,
      experimentOffset: 0,
      experimentLimit: LECTURE_STUDIO_CANDIDATE_PAGE_MAX,
      metricPointLimit: 20,
      includeUnreviewed: false,
    });
  });

  it('rejects inconsistent page metadata before it crosses IPC', () => {
    expect(() =>
      LectureSourceCandidatesSchema.parse({
        schemaVersion: 1,
        projects: [
          {
            projectId: randomUUID(),
            projectName: 'Project',
            literatureRecords: [],
            literaturePage: { offset: 0, limit: 10, total: 11, hasMore: false },
            experiments: [],
            experimentPage: { offset: 0, limit: 10, total: 0, hasMore: false },
            manuscripts: [],
          },
        ],
      }),
    ).toThrow();
  });

  it('normalizes legacy selections while accepting manuscript-only sources', () => {
    const projectId = randomUUID();
    expect(
      LectureSourceSelectionSchema.parse({
        literature: [{ projectId, recordId: randomUUID() }],
        experiments: [],
      }).manuscripts,
    ).toEqual([]);
    const manuscriptId = randomUUID();
    const manuscriptOnly = CreateLectureStudioInputSchema.parse({
      title: 'Manuscript lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: projectId,
      sourceProjectIds: [projectId],
      sourceSelection: {
        literature: [],
        experiments: [],
        manuscripts: [{ projectId, manuscriptId }],
      },
    });
    expect(manuscriptOnly.sourceSelection).toEqual({
      literature: [],
      experiments: [],
      manuscripts: [{ projectId, manuscriptId }],
      externalSources: null,
    });
    expect(manuscriptOnly.generationBrief).toEqual({
      notesTargetPages: null,
      slidesTargetPages: null,
      detailLevel: 'standard',
      customInstructions: '',
    });

    const directed = CreateLectureStudioInputSchema.parse({
      ...manuscriptOnly,
      generationBrief: {
        notesTargetPages: 14,
        slidesTargetPages: 24,
        detailLevel: 'exhaustive',
        customInstructions: 'Compare assumptions and end with open questions.',
      },
    });
    expect(directed.generationBrief).toMatchObject({
      notesTargetPages: 14,
      slidesTargetPages: 24,
      detailLevel: 'exhaustive',
    });
    expect(() =>
      CreateLectureStudioInputSchema.parse({
        ...manuscriptOnly,
        generationBrief: {
          notesTargetPages: null,
          slidesTargetPages: null,
          detailLevel: 'standard',
          customInstructions: '\\'.repeat(6_001),
        },
      }),
    ).toThrow();
    expect(() =>
      CreateLectureStudioInputSchema.parse({
        ...manuscriptOnly,
        generationBrief: {
          notesTargetPages: null,
          slidesTargetPages: 1,
          detailLevel: 'standard',
          customInstructions: '',
        },
      }),
    ).toThrow();
    expect(() =>
      CreateLectureStudioInputSchema.parse({
        ...manuscriptOnly,
        generationBrief: {
          notesTargetPages: null,
          slidesTargetPages: null,
          detailLevel: 'standard',
          customInstructions: `unsafe${String.fromCharCode(0)}instruction`,
        },
      }),
    ).toThrow();
  });

  it('requires an exact version-fenced full generation brief update', () => {
    const command = {
      studioId: randomUUID(),
      expectedVersion: 4,
      generationBrief: {
        notesTargetPages: 20,
        slidesTargetPages: 30,
        detailLevel: 'detailed' as const,
        customInstructions: 'Keep the proofs rigorous.',
      },
    };
    expect(UpdateLectureStudioGenerationBriefInputSchema.parse(command)).toEqual(command);
    expect(
      UpdateLectureStudioGenerationBriefInputSchema.safeParse({
        studioId: command.studioId,
        expectedVersion: command.expectedVersion,
        generationBrief: { detailLevel: 'concise' },
      }).success,
    ).toBe(false);
    expect(
      UpdateLectureStudioGenerationBriefInputSchema.safeParse({
        ...command,
        sourceSelection: { literature: [], experiments: [] },
      }).success,
    ).toBe(false);
    expect(
      UpdateLectureStudioGenerationBriefInputSchema.safeParse({
        ...command,
        expectedVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      UpdateLectureStudioGenerationBriefInputSchema.safeParse({
        ...command,
        generationBrief: {
          ...command.generationBrief,
          customInstructions: `unsafe${String.fromCharCode(0)}instruction`,
        },
      }).success,
    ).toBe(false);
  });

  it('preserves v1/v2 manifests and validates frozen external-source v3 provenance', () => {
    const projectId = randomUUID();
    const manuscriptId = randomUUID();
    const checkpointId = randomUUID();
    const v1 = LectureSourceManifestSchema.parse({
      schemaVersion: 1,
      selectedProjectIds: [projectId],
      literature: [
        {
          sourceLabel: 'P1',
          projectId,
          projectName: 'Project',
          recordId: randomUUID(),
          recordVersion: 1,
          annotationVersion: 0,
          title: 'Legacy paper',
          authors: [],
          containerTitle: null,
          publishedYear: null,
          doi: null,
          citationKey: null,
          reviewStatus: 'included',
          topics: [],
          metadataSummary: '',
          metadataOnly: true,
        },
      ],
      experiments: [],
    });
    expect(v1.schemaVersion).toBe(1);

    const v2 = LectureSourceManifestSchema.parse({
      schemaVersion: 2,
      selectedProjectIds: [projectId],
      literature: [],
      experiments: [],
      manuscripts: [
        {
          sourceLabel: 'M1',
          projectId,
          projectName: 'Project',
          manuscriptId,
          manuscriptVersion: 2,
          title: 'Captured manuscript',
          rootDocument: 'main.tex',
          checkpointId,
          providerId: 'overleaf_git',
          providerRevision: 'provider-revision',
          revisionEnvelopeDigest: `sha256:${'a'.repeat(64)}`,
          observedAt: timestamp,
          files: [
            {
              relativePath: 'main.tex',
              contentSha256: 'b'.repeat(64),
              totalCharacters: 181_796,
              contentComplete: false,
              extractionPolicyVersion: 1,
              content: '\\documentclass{article}',
            },
            {
              relativePath: 'references.bib',
              contentSha256: 'c'.repeat(64),
              totalCharacters: 0,
              contentComplete: true,
              extractionPolicyVersion: 1,
              content: '',
            },
          ],
          contentKind: 'captured_latex',
          metadataOnly: false,
        },
      ],
    });
    expect(v2).toMatchObject({
      schemaVersion: 2,
      manuscripts: [
        {
          sourceLabel: 'M1',
          files: [
            { totalCharacters: 181_796, contentComplete: false },
            { totalCharacters: 0, contentComplete: true },
          ],
        },
      ],
    });

    const externalSourceId = randomUUID();
    const studioId = randomUUID();
    const externalContent = '# Exact imported source\n\nEvidence for [F1].';
    const externalBytes = Buffer.from(externalContent, 'utf8');
    const v3 = LectureSourceManifestSchema.parse({
      schemaVersion: 3,
      selectedProjectIds: [projectId],
      literature: [],
      experiments: [],
      manuscripts: [],
      externalSources: [
        {
          schemaVersion: 1,
          id: externalSourceId,
          projectId,
          studioId,
          displayName: 'supporting-notes.md',
          kind: 'markdown',
          mediaType: 'text/markdown',
          byteSize: externalBytes.byteLength,
          sourceSha256: createHash('sha256').update(externalBytes).digest('hex'),
          extraction: {
            policyVersion: 1,
            characterBudget: 40_000,
            unitLabel: 'part',
            unitCount: 1,
            content: externalContent,
            contentSha256: createHash('sha256').update(externalContent, 'utf8').digest('hex'),
            extractedCharacters: externalContent.length,
            truncated: false,
            textAvailable: true,
            reconstructionNotice: 'Exact UTF-8 Markdown text imported by GOSU.',
          },
          importedAt: timestamp,
          sourceLabel: 'F1',
        },
      ],
    });
    expect(v3).toMatchObject({
      schemaVersion: 3,
      externalSources: [
        {
          id: externalSourceId,
          studioId,
          sourceLabel: 'F1',
          extraction: { policyVersion: 1, content: externalContent },
        },
      ],
    });
    if (v3.schemaVersion !== 3) throw new Error('expected_v3_manifest');
    expect(() =>
      LectureSourceManifestSchema.parse({
        ...v3,
        externalSources: [
          {
            ...v3.externalSources[0],
            sourceLabel: 'F13',
          },
        ],
      }),
    ).toThrow();
  });

  it('keeps unavailable manuscripts visible without claiming a checkpoint', () => {
    const projectId = randomUUID();
    const manuscript = {
      schemaVersion: 1 as const,
      id: randomUUID(),
      projectId,
      title: 'Needs capture',
      rootDocument: 'main.tex',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    expect(
      LectureSourceCandidatesSchema.parse({
        schemaVersion: 1,
        projects: [
          {
            projectId,
            projectName: 'Project',
            literatureRecords: [],
            literaturePage: { offset: 0, limit: 10, total: 0, hasMore: false },
            experiments: [],
            experimentPage: { offset: 0, limit: 10, total: 0, hasMore: false },
            manuscripts: [
              {
                manuscript,
                availability: 'capture_required',
                checkpointId: null,
                providerRevision: null,
                observedAt: null,
              },
            ],
          },
        ],
      }).projects[0]?.manuscripts[0]?.availability,
    ).toBe('capture_required');
  });
});

describe('Lecture Studio artifact action contracts', () => {
  it('requires an exact revision and artifact hash without accepting local paths or payloads', () => {
    const binding = {
      studioId: randomUUID(),
      revisionId: randomUUID(),
      revision: 2,
      kind: 'lecture-notes' as const,
      artifactContentSha256: 'a'.repeat(64),
    };

    expect(
      ExportLectureStudioArtifactInputSchema.parse({ ...binding, format: 'markdown' }),
    ).toEqual({
      ...binding,
      format: 'markdown',
    });
    expect(ExportLectureStudioArtifactInputSchema.parse({ ...binding, format: 'latex' })).toEqual({
      ...binding,
      format: 'latex',
    });
    expect(OpenLectureStudioArtifactInputSchema.parse({ ...binding, format: 'pdf' })).toEqual({
      ...binding,
      format: 'pdf',
    });
    expect(RevealLectureStudioArtifactInputSchema.parse(binding)).toEqual(binding);
    expect(() =>
      ExportLectureStudioArtifactInputSchema.parse({
        ...binding,
        format: 'markdown',
        path: '/Users/researcher/private.md',
      }),
    ).toThrow();
    expect(() =>
      OpenLectureStudioArtifactInputSchema.parse({
        ...binding,
        format: 'pdf',
        pdfBase64: 'renderer-controlled',
      }),
    ).toThrow();
    expect(() =>
      RevealLectureStudioArtifactInputSchema.parse({
        ...binding,
        artifactContentSha256: 'short',
      }),
    ).toThrow();
  });
});

describe('Lecture Studio failure contracts', () => {
  it('exposes a stable typed capacity error across IPC', () => {
    expect(LECTURE_STUDIO_IPC_ERROR_CODES).toContain('lecture_capacity_reached');
  });

  it('exposes safe structured Codex terminal errors across IPC', () => {
    expect(LECTURE_STUDIO_IPC_ERROR_CODES).toContain('lecture_auth_required');
    expect(LECTURE_STUDIO_IPC_ERROR_CODES).toContain('lecture_usage_limit_exceeded');
    expect(LECTURE_STUDIO_IPC_ERROR_CODES).toContain('lecture_generation_interrupted');
  });

  it('exposes only bounded lecture response validation categories across IPC', () => {
    expect(LECTURE_STUDIO_IPC_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'lecture_invalid_response_json',
        'lecture_invalid_response_schema',
        'lecture_invalid_latex_grammar',
        'lecture_invalid_citation_mapping',
        'lecture_invalid_slide_count',
      ]),
    );
  });
});
