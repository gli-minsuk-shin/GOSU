import { access, mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProjectChatDocumentExtractionError,
  type ExtractedProjectChatDocument,
  type ProjectChatDocumentFormat,
} from '../src/main/project-chat-document-extractor';
import type {
  NormalizedProjectChatImage,
  ProjectChatImageFormat,
} from '../src/main/project-chat-image-extractor';
import { ProjectChatAttachmentService } from '../src/main/project-chat-attachment-service';
import {
  ProjectChatPdfExtractionError,
  type ExtractedProjectChatPdf,
} from '../src/main/project-chat-pdf-extractor';
import {
  PROJECT_CHAT_MAX_ATTACHMENTS,
  PROJECT_CHAT_MAX_ATTACHMENT_BYTES,
  type ProjectChatAttachment,
} from '../src/shared/project-chat-attachment-contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_SESSION_ID = '33333333-3333-4333-8333-333333333333';
const MISSING_ATTACHMENT_ID = '44444444-4444-4444-8444-444444444444';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixtureDirectory() {
  const root = await mkdtemp(join(tmpdir(), 'gosu-attachment-test-'));
  directories.push(root);
  return root;
}

function extractedPdf(text = 'Attached evidence'): ExtractedProjectChatPdf {
  return {
    pageCount: 2,
    pages: [
      { pageNumber: 1, text },
      { pageNumber: 2, text: 'Second page' },
    ],
    extractedCharacters: text.length + 'Second page'.length,
    truncated: false,
    textAvailable: true,
  };
}

function extractedDocument(
  format: ProjectChatDocumentFormat = 'text',
): ExtractedProjectChatDocument {
  return {
    format,
    unitLabel: 'part',
    unitCount: 2,
    units: [
      { unitNumber: 1, text: 'Private research notes' },
      { unitNumber: 2, text: 'Second section' },
    ],
    extractedCharacters: 'Private research notes'.length + 'Second section'.length,
    truncated: false,
    textAvailable: true,
    reconstructionNotice: 'Fixture reconstruction notice.',
  };
}

function normalizedImage(sourceFormat: ProjectChatImageFormat = 'png'): NormalizedProjectChatImage {
  return {
    format: 'jpeg',
    bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
    width: 640,
    height: 480,
    sourceFormat,
    sourceFrameCount: 1,
  };
}

describe('ProjectChatAttachmentService', () => {
  it('stages mixed documents and images as opaque, scoped, one-time capabilities', async () => {
    const root = await fixtureDirectory();
    const documentPath = join(root, 'notes\nprivate.txt');
    const imagePath = join(root, 'microscopy-private.png');
    await writeFile(documentPath, 'document fixture');
    await writeFile(imagePath, 'image fixture');
    const validateScope = vi.fn(async () => undefined);
    const extractDocument = vi.fn(async (format: ProjectChatDocumentFormat) =>
      extractedDocument(format),
    );
    const normalizeImage = vi.fn(async (format: ProjectChatImageFormat) => normalizedImage(format));
    const service = new ProjectChatAttachmentService({
      chooseFiles: async () => [documentPath, imagePath],
      extractDocument,
      normalizeImage,
      validateScope,
      now: () => Date.parse('2026-08-05T00:00:00.000Z'),
    });

    const descriptors = await service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID });
    const [document, image] = descriptors;
    expect(validateScope).toHaveBeenCalledExactlyOnceWith(PROJECT_ID, SESSION_ID);
    expect(extractDocument).toHaveBeenCalledWith('text', expect.any(Uint8Array), 60_000);
    expect(normalizeImage).toHaveBeenCalledWith('png', expect.any(Uint8Array));
    expect(document).toMatchObject({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      kind: 'document',
      format: 'text',
      mediaType: 'text/plain',
      displayName: 'notes private.txt',
      unitLabel: 'part',
      unitCount: 2,
      textAvailable: true,
      visualAvailable: false,
    });
    expect(image).toMatchObject({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      kind: 'image',
      format: 'png',
      mediaType: 'image/png',
      displayName: 'microscopy-private.png',
      unitLabel: 'image',
      unitCount: 1,
      textAvailable: false,
      visualAvailable: true,
      imageWidth: 640,
      imageHeight: 480,
    });
    expect(JSON.stringify(descriptors)).not.toContain(root);

    expect(() =>
      service.claim(PROJECT_ID, SESSION_ID, [document!.id, MISSING_ATTACHMENT_ID]),
    ).toThrow('attachment_expired');

    const claimed = service.claim(PROJECT_ID, SESSION_ID, [document!.id, image!.id]);
    const nativeImagePath = claimed.nativeImages()[0]?.path;
    try {
      expect(claimed.catalog()).toEqual([
        expect.objectContaining({
          attachmentId: document!.id,
          label: 'Attachment 1',
          kind: 'document',
          format: 'text',
          unitLabel: 'part',
          unitCount: 2,
          textAvailable: true,
          visualAvailable: false,
        }),
        expect.objectContaining({
          attachmentId: image!.id,
          label: 'Attachment 2',
          kind: 'image',
          format: 'png',
          unitLabel: 'image',
          unitCount: 1,
          textAvailable: false,
          visualAvailable: true,
        }),
      ]);
      expect(JSON.stringify(claimed.catalog())).not.toContain('notes private.txt');
      expect(JSON.stringify(claimed.catalog())).not.toContain('microscopy-private.png');
      expect(JSON.stringify(claimed.catalog())).not.toContain(root);
      expect(claimed.read(document!.id, 1, 1, 100)).toMatchObject({
        label: 'Attachment 1',
        kind: 'document',
        format: 'text',
        startUnit: 1,
        endUnit: 1,
        content: '--- part 1 ---\nPrivate research notes',
      });
      expect(claimed.read(image!.id, 1, 1, 100)).toBeNull();
      expect(claimed.nativeImages()).toEqual([
        expect.objectContaining({
          attachmentId: image!.id,
          label: 'Attachment 2',
          path: expect.stringMatching(/gosu-chat-image-.+\.jpg$/u),
        }),
      ]);
      expect(nativeImagePath).not.toBe(imagePath);
      await expect(access(nativeImagePath!)).resolves.toBeUndefined();
      expect(() => service.claim(PROJECT_ID, SESSION_ID, [document!.id])).toThrow(
        'attachment_expired',
      );
    } finally {
      await claimed.revoke();
      await service.dispose();
    }

    expect(claimed.catalog()).toEqual([]);
    expect(claimed.read(document!.id, 1, 1, 100)).toBeNull();
    expect(claimed.nativeImages()).toEqual([]);
    await expect(access(nativeImagePath!)).rejects.toHaveProperty('code', 'ENOENT');
  });

  it('rejects unsupported, linked, malformed, oversized, and excessive selections', async () => {
    const root = await fixtureDirectory();
    const valid = join(root, 'valid.pdf');
    const link = join(root, 'linked.pdf');
    const malformed = join(root, 'malformed.pdf');
    const oversized = join(root, 'oversized.pdf');
    const unsupported = join(root, 'payload.exe');
    const legacyPowerPoint = join(root, 'legacy.ppt');
    await writeFile(valid, '%PDF-fixture');
    await symlink(valid, link);
    await writeFile(malformed, 'not a pdf');
    await writeFile(oversized, '%PDF-');
    await truncate(oversized, PROJECT_CHAT_MAX_ATTACHMENT_BYTES + 1);
    await writeFile(unsupported, 'unsupported');
    await writeFile(legacyPowerPoint, 'legacy binary presentation fixture');

    const cases = [
      { path: link, code: 'attachment_invalid' },
      { path: oversized, code: 'attachment_too_large' },
      { path: unsupported, code: 'attachment_unsupported' },
      { path: legacyPowerPoint, code: 'attachment_unsupported' },
    ] as const;
    for (const testCase of cases) {
      const extractPdf = vi.fn(async () => extractedPdf());
      const service = new ProjectChatAttachmentService({
        chooseFiles: async () => [testCase.path],
        extractPdf,
      });
      await expect(
        service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
      ).rejects.toHaveProperty('code', testCase.code);
      expect(extractPdf).not.toHaveBeenCalled();
      await service.dispose();
    }

    const malformedService = new ProjectChatAttachmentService({
      chooseFiles: async () => [malformed],
      extractPdf: async () => {
        throw new ProjectChatPdfExtractionError('pdf_attachment_invalid');
      },
    });
    await expect(
      malformedService.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
    ).rejects.toHaveProperty('code', 'attachment_invalid');
    await malformedService.dispose();

    const excessiveService = new ProjectChatAttachmentService({
      chooseFiles: async () =>
        Array.from({ length: PROJECT_CHAT_MAX_ATTACHMENTS + 1 }, () => valid),
      extractPdf: async () => extractedPdf(),
    });
    await expect(
      excessiveService.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
    ).rejects.toHaveProperty('code', 'attachment_too_many');
    await excessiveService.dispose();
  });

  it('does not consume a capability when release scope is forged', async () => {
    const root = await fixtureDirectory();
    const path = join(root, 'paper.pdf');
    await writeFile(path, '%PDF-fixture');
    const service = new ProjectChatAttachmentService({
      chooseFiles: async () => [path],
      extractPdf: async () => extractedPdf(),
    });
    const [descriptor] = await service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID });

    await expect(
      service.release({
        projectId: PROJECT_ID,
        sessionId: OTHER_SESSION_ID,
        attachmentId: descriptor!.id,
      }),
    ).rejects.toHaveProperty('code', 'attachment_scope_mismatch');
    const claimed = service.claim(PROJECT_ID, SESSION_ID, [descriptor!.id]);
    await claimed.revoke();
    await service.dispose();
  });

  it('fails closed before opening the picker when the active scope cannot be validated', async () => {
    const chooseFiles = vi.fn(async () => []);
    const service = new ProjectChatAttachmentService({
      chooseFiles,
      validateScope: async () => {
        throw new Error('chat_session_not_found');
      },
    });

    await expect(
      service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
    ).rejects.toHaveProperty('code', 'attachment_scope_mismatch');
    expect(chooseFiles).not.toHaveBeenCalled();
    await service.dispose();
  });

  it('removes normalized image state atomically when a later document fails', async () => {
    const root = await fixtureDirectory();
    const imagePath = join(root, 'first.png');
    const documentPath = join(root, 'second.docx');
    const normalizedDirectory = join(root, 'normalized-image');
    const normalizedPath = join(normalizedDirectory, 'normalized.jpg');
    await writeFile(imagePath, 'image fixture');
    await writeFile(documentPath, 'document fixture');
    await mkdir(normalizedDirectory);
    await writeFile(normalizedPath, 'normalized fixture');
    const service = new ProjectChatAttachmentService({
      chooseFiles: async () => [imagePath, documentPath],
      normalizeImage: async () => normalizedImage(),
      stageImage: async () => ({ path: normalizedPath, directory: normalizedDirectory }),
      extractDocument: async () => {
        throw new ProjectChatDocumentExtractionError('attachment_archive_limit');
      },
    });

    await expect(service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID })).rejects.toEqual(
      expect.objectContaining({
        name: 'ProjectChatAttachmentError',
        code: 'attachment_archive_limit',
        message: 'attachment_archive_limit',
      }),
    );
    await expect(access(normalizedDirectory)).rejects.toHaveProperty('code', 'ENOENT');
    await service.dispose();
  });

  it('enforces the 50 MiB total again when separately staged files are claimed together', async () => {
    const root = await fixtureDirectory();
    const paths = [join(root, 'one.pdf'), join(root, 'two.pdf'), join(root, 'three.pdf')];
    for (const path of paths) {
      await writeFile(path, '%PDF-fixture');
      await truncate(path, 17 * 1024 * 1024);
    }
    let selectedPath = paths[0]!;
    const service = new ProjectChatAttachmentService({
      chooseFiles: async () => [selectedPath],
      extractPdf: async () => extractedPdf(),
    });
    const descriptors: ProjectChatAttachment[] = [];
    for (const path of paths) {
      selectedPath = path;
      descriptors.push(...(await service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID })));
    }

    expect(() =>
      service.claim(
        PROJECT_ID,
        SESSION_ID,
        descriptors.map((descriptor) => descriptor.id),
      ),
    ).toThrow('attachment_total_too_large');

    const partial = service.claim(
      PROJECT_ID,
      SESSION_ID,
      descriptors.slice(0, 2).map((descriptor) => descriptor.id),
    );
    await partial.revoke();
    await service.release({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      attachmentId: descriptors[2]!.id,
    });
    await service.dispose();
  });

  it('bounds pending and claimed capabilities across repeated picker calls', async () => {
    const root = await fixtureDirectory();
    const paths = Array.from({ length: PROJECT_CHAT_MAX_ATTACHMENTS }, (_, index) =>
      join(root, `note-${index}.txt`),
    );
    await Promise.all(paths.map((path) => writeFile(path, 'bounded fixture')));
    const service = new ProjectChatAttachmentService({
      chooseFiles: async () => paths,
      extractDocument: async (format) => extractedDocument(format),
    });
    const batches: ProjectChatAttachment[][] = [];
    for (let index = 0; index < 5; index += 1) {
      batches.push([...(await service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID }))]);
    }

    await expect(
      service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
    ).rejects.toHaveProperty('code', 'attachment_capacity_exhausted');

    const claimed = service.claim(
      PROJECT_ID,
      SESSION_ID,
      batches[0]!.map((attachment) => attachment.id),
    );
    await expect(
      service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
    ).rejects.toHaveProperty('code', 'attachment_capacity_exhausted');

    await claimed.revoke();
    await expect(
      service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
    ).resolves.toHaveLength(PROJECT_CHAT_MAX_ATTACHMENTS);
    await service.dispose();
  });

  it('bounds live normalized-image directories independently of document slots', async () => {
    const root = await fixtureDirectory();
    const imagePath = join(root, 'bounded.png');
    await writeFile(imagePath, 'image fixture');
    let stagedImageCount = 0;
    const service = new ProjectChatAttachmentService({
      chooseFiles: async () => [imagePath],
      normalizeImage: async () => normalizedImage(),
      stageImage: async (image) => {
        const directory = join(root, `normalized-${stagedImageCount++}`);
        const path = join(directory, 'image.jpg');
        await mkdir(directory);
        await writeFile(path, image.bytes);
        return { path, directory };
      },
    });
    for (let index = 0; index < 20; index += 1) {
      await service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID });
    }

    await expect(
      service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
    ).rejects.toHaveProperty('code', 'attachment_capacity_exhausted');
    expect(stagedImageCount).toBe(20);
    await service.dispose();
  });

  it('removes claimed normalized images synchronously during app shutdown', async () => {
    const root = await fixtureDirectory();
    const imagePath = join(root, 'shutdown.png');
    await writeFile(imagePath, 'image fixture');
    const service = new ProjectChatAttachmentService({
      chooseFiles: async () => [imagePath],
      normalizeImage: async () => normalizedImage(),
    });
    const [descriptor] = await service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID });
    const claimed = service.claim(PROJECT_ID, SESSION_ID, [descriptor!.id]);
    const normalizedPath = claimed.nativeImages()[0]!.path;

    service.disposeImmediately();

    await expect(access(normalizedPath)).rejects.toHaveProperty('code', 'ENOENT');
    await claimed.revoke();
  });

  it('allows scoped cleanup after project validation changes and honors expiry', async () => {
    const root = await fixtureDirectory();
    const imagePath = join(root, 'figure.png');
    await writeFile(imagePath, 'image fixture');
    let active = true;
    let now = Date.parse('2026-08-05T00:00:00.000Z');
    const stagedPaths: string[] = [];
    const service = new ProjectChatAttachmentService({
      chooseFiles: async () => [imagePath],
      normalizeImage: async () => normalizedImage(),
      stageImage: async (image) => {
        const directory = join(root, `normalized-${stagedPaths.length}`);
        const path = join(directory, 'image.jpg');
        await mkdir(directory);
        await writeFile(path, image.bytes);
        stagedPaths.push(path);
        return { path, directory };
      },
      validateScope: async () => {
        if (!active) throw new Error('project_archived');
      },
      now: () => now,
    });
    const [releasedDescriptor] = await service.choose({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    const claimedBeforeRelease = service.claim(PROJECT_ID, SESSION_ID, [releasedDescriptor!.id]);
    const normalizedPath = claimedBeforeRelease.nativeImages()[0]!.path;
    expect(normalizedPath).toBe(stagedPaths[0]);
    await claimedBeforeRelease.revoke();
    await expect(access(normalizedPath)).rejects.toHaveProperty('code', 'ENOENT');

    const [expiredDescriptor] = await service.choose({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    active = false;
    await expect(
      service.release({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        attachmentId: expiredDescriptor!.id,
      }),
    ).resolves.toEqual({ released: true });
    await expect(access(stagedPaths[1]!)).rejects.toHaveProperty('code', 'ENOENT');
    expect(() => service.claim(PROJECT_ID, SESSION_ID, [expiredDescriptor!.id])).toThrow(
      'attachment_expired',
    );

    active = true;
    const [ttlDescriptor] = await service.choose({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    now += 15 * 60 * 1_000;
    expect(() => service.claim(PROJECT_ID, SESSION_ID, [ttlDescriptor!.id])).toThrow(
      'attachment_expired',
    );
    await expect(access(stagedPaths[2]!)).resolves.toBeUndefined();
    await service.dispose();
    await expect(access(stagedPaths[2]!)).rejects.toHaveProperty('code', 'ENOENT');
  });
});
