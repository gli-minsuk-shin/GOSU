import { mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectChatAttachmentService } from '../src/main/project-chat-attachment-service';
import type { ExtractedProjectChatPdf } from '../src/main/project-chat-pdf-extractor';
import { PROJECT_CHAT_MAX_PDF_BYTES } from '../src/shared/project-chat-attachment-contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_SESSION_ID = '33333333-3333-4333-8333-333333333333';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixtureDirectory() {
  const root = await mkdtemp(join(tmpdir(), 'gosu-pdf-attachment-'));
  directories.push(root);
  return root;
}

function extracted(text = 'Attached evidence'): ExtractedProjectChatPdf {
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

describe('ProjectChatAttachmentService', () => {
  it('stages a strict local PDF as an opaque, scoped, one-time capability', async () => {
    const root = await fixtureDirectory();
    const path = join(root, 'paper\nprivate.pdf');
    await writeFile(path, '%PDF-fixture');
    const validateScope = vi.fn(async () => undefined);
    const service = new ProjectChatAttachmentService({
      choosePdfFiles: async () => [path],
      extractPdf: async () => extracted(),
      validateScope,
    });

    const [descriptor] = await service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID });

    expect(validateScope).toHaveBeenCalledExactlyOnceWith(PROJECT_ID, SESSION_ID);
    expect(descriptor).toMatchObject({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      displayName: 'paper private.pdf',
      pageCount: 2,
      textAvailable: true,
    });
    expect(JSON.stringify(descriptor)).not.toContain(root);
    const claimed = service.claim(PROJECT_ID, SESSION_ID, [descriptor!.id]);
    expect(claimed.catalog()).toEqual([
      expect.objectContaining({
        attachmentId: descriptor!.id,
        label: 'PDF 1',
        pageCount: 2,
      }),
    ]);
    expect(JSON.stringify(claimed.catalog())).not.toContain('paper private.pdf');
    expect(claimed.read(descriptor!.id, 1, 1, 100)).toMatchObject({
      label: 'PDF 1',
      content: '--- page 1 ---\nAttached evidence',
    });
    expect(() => service.claim(PROJECT_ID, SESSION_ID, [descriptor!.id])).toThrow(
      'pdf_attachment_expired',
    );
    claimed.revoke();
    expect(claimed.catalog()).toEqual([]);
    service.dispose();
  });

  it('rejects scope forgery, symlinks, fake PDF magic, and oversized regular files', async () => {
    const root = await fixtureDirectory();
    const valid = join(root, 'valid.pdf');
    const link = join(root, 'link.pdf');
    const fake = join(root, 'fake.pdf');
    const oversized = join(root, 'oversized.pdf');
    await writeFile(valid, '%PDF-fixture');
    await symlink(valid, link);
    await writeFile(fake, 'not a pdf');
    await writeFile(oversized, '%PDF-');
    await truncate(oversized, PROJECT_CHAT_MAX_PDF_BYTES + 1);
    const extractPdf = vi.fn(async () => extracted());

    for (const [path, code] of [
      [link, 'pdf_attachment_invalid'],
      [fake, 'pdf_attachment_invalid'],
      [oversized, 'pdf_attachment_too_large'],
    ] as const) {
      const service = new ProjectChatAttachmentService({
        choosePdfFiles: async () => [path],
        extractPdf,
      });
      await expect(
        service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
      ).rejects.toThrow(code);
      service.dispose();
    }
    expect(extractPdf).not.toHaveBeenCalled();

    const service = new ProjectChatAttachmentService({
      choosePdfFiles: async () => [valid],
      extractPdf: async () => extracted(),
    });
    const [descriptor] = await service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID });
    expect(() => service.claim(PROJECT_ID, OTHER_SESSION_ID, [descriptor!.id])).toThrow(
      'pdf_attachment_scope_mismatch',
    );
    service.dispose();
  });

  it('fails closed when the active project/session cannot be validated', async () => {
    const root = await fixtureDirectory();
    const path = join(root, 'paper.pdf');
    await writeFile(path, '%PDF-fixture');
    const service = new ProjectChatAttachmentService({
      choosePdfFiles: async () => [path],
      extractPdf: async () => extracted(),
      validateScope: async () => {
        throw new Error('chat_session_not_found');
      },
    });

    await expect(
      service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
    ).rejects.toHaveProperty('code', 'pdf_attachment_scope_mismatch');
    service.dispose();
  });

  it('allows scoped cleanup after the project becomes inactive', async () => {
    const root = await fixtureDirectory();
    const path = join(root, 'paper.pdf');
    await writeFile(path, '%PDF-fixture');
    let active = true;
    const service = new ProjectChatAttachmentService({
      choosePdfFiles: async () => [path],
      extractPdf: async () => extracted(),
      validateScope: async () => {
        if (!active) throw new Error('project_archived');
      },
    });
    const [descriptor] = await service.choose({ projectId: PROJECT_ID, sessionId: SESSION_ID });
    active = false;

    await expect(
      service.release({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        attachmentId: descriptor!.id,
      }),
    ).resolves.toEqual({ released: true });
    expect(() => service.claim(PROJECT_ID, SESSION_ID, [descriptor!.id])).toThrow(
      'pdf_attachment_expired',
    );
    service.dispose();
  });
});
