import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ChooseLectureStudioAttachmentsInputSchema,
  LECTURE_STUDIO_MAX_ATTACHMENTS,
  LectureStudioAttachmentCardSchema,
  LectureStudioAttachmentIdsSchema,
  ReleaseLectureStudioAttachmentInputSchema,
} from '../src/shared/lecture-studio-attachment-contracts';
import {
  LectureSourceManifestSchema,
  LectureStudioMessageSchema,
} from '../src/shared/lecture-studio-contracts';

const STUDIO_ID = randomUUID();

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    displayName: 'reference.tex',
    format: 'latex',
    byteSize: 1_024,
    sha256: 'a'.repeat(64),
    unitLabel: 'part',
    unitCount: 1,
    extractedCharacters: 900,
    truncated: false,
    textAvailable: true,
    reconstructionNotice: 'Exact UTF-8 source text.',
    expiresAt: '2026-08-16T10:00:00.000Z',
    ...overrides,
  };
}

describe('Lecture Studio attachment contracts', () => {
  it('exposes renderer-safe LaTeX, Markdown, and PDF metadata without paths or bodies', () => {
    expect(LectureStudioAttachmentCardSchema.parse(card())).not.toHaveProperty('path');
    expect(
      LectureStudioAttachmentCardSchema.parse(
        card({
          displayName: 'paper.pdf',
          format: 'pdf',
          unitLabel: 'page',
          unitCount: 12,
        }),
      ),
    ).toMatchObject({ format: 'pdf', unitLabel: 'page' });
    expect(
      LectureStudioAttachmentCardSchema.parse(
        card({ displayName: 'notes.md', format: 'markdown' }),
      ),
    ).toMatchObject({ format: 'markdown' });

    expect(() =>
      LectureStudioAttachmentCardSchema.parse(card({ path: '/private/paper.tex' })),
    ).toThrow();
    expect(() => LectureStudioAttachmentCardSchema.parse(card({ studioId: STUDIO_ID }))).toThrow();
    expect(() =>
      LectureStudioAttachmentCardSchema.parse(card({ content: 'private body' })),
    ).toThrow();
    expect(() => LectureStudioAttachmentCardSchema.parse(card({ format: 'docx' }))).toThrow();
  });

  it('binds attachment picker and release commands to one Studio', () => {
    expect(ChooseLectureStudioAttachmentsInputSchema.parse({ studioId: STUDIO_ID })).toEqual({
      studioId: STUDIO_ID,
    });
    const attachmentId = randomUUID();
    expect(
      ReleaseLectureStudioAttachmentInputSchema.parse({ studioId: STUDIO_ID, attachmentId }),
    ).toEqual({ studioId: STUDIO_ID, attachmentId });
    expect(() =>
      ChooseLectureStudioAttachmentsInputSchema.parse({
        studioId: STUDIO_ID,
        projectId: randomUUID(),
      }),
    ).toThrow();
  });

  it('accepts at most five unique attachment IDs', () => {
    const ids = Array.from({ length: LECTURE_STUDIO_MAX_ATTACHMENTS }, () => randomUUID());
    expect(LectureStudioAttachmentIdsSchema.parse(ids)).toEqual(ids);
    expect(() => LectureStudioAttachmentIdsSchema.parse([...ids, randomUUID()])).toThrow();
    expect(() => LectureStudioAttachmentIdsSchema.parse([ids[0], ids[0]])).toThrow();
  });

  it('requires PDF page units and truthful extracted-text metadata', () => {
    expect(() =>
      LectureStudioAttachmentCardSchema.parse(card({ format: 'pdf', unitLabel: 'part' })),
    ).toThrow();
    expect(() =>
      LectureStudioAttachmentCardSchema.parse(
        card({ textAvailable: false, extractedCharacters: 100 }),
      ),
    ).toThrow();
    expect(() =>
      LectureStudioAttachmentCardSchema.parse(
        card({ textAvailable: true, extractedCharacters: 0 }),
      ),
    ).toThrow();
    expect(() =>
      LectureStudioAttachmentCardSchema.parse(
        card({ textAvailable: false, extractedCharacters: 0 }),
      ),
    ).toThrow();
  });

  it('accepts only unique attachment receipts on user messages', () => {
    const attachment = card();
    const message = {
      schemaVersion: 1,
      id: randomUUID(),
      studioId: STUDIO_ID,
      role: 'user',
      status: 'complete',
      content: 'Use the attached reference.',
      attemptId: randomUUID(),
      revision: null,
      invocation: null,
      attachments: [attachment],
      createdAt: '2026-08-16T00:00:00.000Z',
      completedAt: '2026-08-16T00:00:00.000Z',
    } as const;
    expect(LectureStudioMessageSchema.parse(message).attachments).toHaveLength(1);
    expect(() =>
      LectureStudioMessageSchema.parse({ ...message, attachments: [attachment, attachment] }),
    ).toThrow();
    expect(() => LectureStudioMessageSchema.parse({ ...message, role: 'assistant' })).toThrow();
  });

  it('validates canonical ordered A labels in a frozen v4 source manifest', () => {
    const content = 'Bounded attachment evidence.';
    const attachmentId = randomUUID();
    const attachment = {
      sourceLabel: 'A1',
      attachmentId,
      projectId: randomUUID(),
      studioId: STUDIO_ID,
      displayName: 'reference.md',
      format: 'markdown',
      byteSize: content.length,
      sourceSha256: 'a'.repeat(64),
      unitLabel: 'part',
      unitCount: 1,
      content,
      contentSha256: 'b'.repeat(64),
      extractedCharacters: content.length,
      truncated: false,
      reconstructionNotice: 'Exact UTF-8 source text.',
      capturedAt: '2026-08-16T00:00:00.000Z',
    } as const;
    const manifest = {
      schemaVersion: 4,
      selectedProjectIds: [attachment.projectId],
      literature: [],
      experiments: [],
      manuscripts: [],
      externalSources: [],
      turnAttachments: [attachment],
    } as const;
    expect(LectureSourceManifestSchema.parse(manifest)).toMatchObject({
      schemaVersion: 4,
      turnAttachments: [{ sourceLabel: 'A1', attachmentId }],
    });
    expect(() =>
      LectureSourceManifestSchema.parse({
        ...manifest,
        turnAttachments: [{ ...attachment, sourceLabel: 'A2' }],
      }),
    ).toThrow();
    expect(() =>
      LectureSourceManifestSchema.parse({
        ...manifest,
        turnAttachments: [{ ...attachment, projectId: randomUUID() }],
      }),
    ).toThrow();
  });
});
