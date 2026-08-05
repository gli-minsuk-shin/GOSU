import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ProjectAgentToolSession } from '../src/main/project-agent-tools';
import type {
  AgentPdfAttachmentChunk,
  AgentPdfAttachmentCatalogItem,
  ProjectChatPdfAttachmentsForAgent,
} from '../src/main/project-chat-attachment-service';
import { WorkspaceService, type WorkspaceStorage } from '../src/main/workspace-service';
import type { ProjectAgentVault } from '../src/main/project-agent-tools';
import type { CodexDynamicToolCall, CodexJsonValue } from '../src/main/codex-app-server';
import type { WorkspaceOperation, WorkspaceSnapshot } from '../src/shared/workspace-contracts';

const ATTACHMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE_SHA256 = 'b'.repeat(64);
const PRIVATE_TEXT = 'PRIVATE_PDF_TEXT_FROM_ACTIVE_TURN';

class MemoryStorage implements WorkspaceStorage {
  state: WorkspaceSnapshot | null = null;
  load() {
    return this.state ? structuredClone(this.state) : null;
  }
  commit(state: WorkspaceSnapshot, _operation: WorkspaceOperation) {
    this.state = structuredClone(state);
  }
  pendingChanges() {
    return [];
  }
  pendingSummary() {
    return { count: 0, latestWorkspaceRevision: null };
  }
}

const unavailableVault: ProjectAgentVault = {
  descriptor: () => null,
  matchesGrant: () => false,
  validateGrant: async () => undefined,
  listForAgent: async () => ({ notes: [], truncated: false }),
  readForAgent: async () => {
    throw new Error('vault_not_selected');
  },
};

class FakePdfAttachments implements ProjectChatPdfAttachmentsForAgent {
  revoked = false;
  readonly revoke = vi.fn(() => {
    this.revoked = true;
  });
  catalog(): readonly AgentPdfAttachmentCatalogItem[] {
    return this.revoked
      ? []
      : [
          {
            attachmentId: ATTACHMENT_ID,
            label: 'PDF 1',
            sourceSha256: SOURCE_SHA256,
            pageCount: 12,
            extractedCharacters: PRIVATE_TEXT.length,
            truncated: false,
            textAvailable: true,
          },
        ];
  }
  read(
    attachmentId: string,
    startPage: number,
    pageCount: number,
    maxCharacters: number,
  ): AgentPdfAttachmentChunk | null {
    if (this.revoked || attachmentId !== ATTACHMENT_ID) return null;
    const content = PRIVATE_TEXT.slice(0, maxCharacters);
    return {
      attachmentId,
      label: 'PDF 1',
      sourceSha256: SOURCE_SHA256,
      pageCount: 12,
      startPage,
      endPage: Math.min(12, startPage + pageCount - 1),
      content,
      contentSha256: 'c'.repeat(64),
      truncated: false,
    };
  }
}

function call(tool: string, arguments_: CodexJsonValue): CodexDynamicToolCall {
  return {
    threadId: 'thread-pdf',
    turnId: 'turn-pdf',
    callId: randomUUID(),
    namespace: 'gosu_project',
    tool,
    arguments: arguments_,
  };
}

function payload(result: Awaited<ReturnType<ProjectAgentToolSession['handler']>>) {
  return JSON.parse(result.contentItems[0]!.text) as Record<string, unknown>;
}

describe('Project Chat one-time PDF tools', () => {
  it('exposes only opaque PDF metadata, delivers bounded text, and revokes it at terminal', async () => {
    const workspace = new WorkspaceService(new MemoryStorage());
    const project = await workspace.createProject({ name: 'PDF project' });
    const pdfAttachments = new FakePdfAttachments();
    const session = new ProjectAgentToolSession({
      projectId: project.id,
      sessionId: randomUUID(),
      attemptId: randomUUID(),
      workspace,
      vault: unavailableVault,
      localNotesVault: null,
      pdfAttachments,
    });
    const tools = session.dynamicTools.flatMap((spec) =>
      spec.type === 'namespace' ? spec.tools.map((tool) => tool.name) : [spec.name],
    );
    expect(tools).toContain('list_pdf_attachments');
    expect(tools).toContain('read_pdf_attachment');

    const delivery = {
      outcome: Promise.resolve('delivered' as const),
      abortSignal: new AbortController().signal,
    };
    const listed = await session.handler(call('list_pdf_attachments', {}), delivery);
    expect(payload(listed)).toMatchObject({
      oneTime: true,
      attachments: [{ attachmentId: ATTACHMENT_ID, label: 'PDF 1', pageCount: 12 }],
    });
    expect(listed.contentItems[0]!.text).not.toContain('private.pdf');
    expect(listed.contentItems[0]!.text).not.toContain('/Users/');

    const read = await session.handler(
      call('read_pdf_attachment', { attachmentId: ATTACHMENT_ID, startPage: 2, pageCount: 2 }),
      delivery,
    );
    expect(payload(read)).toMatchObject({
      trust: 'untrusted_pdf_evidence',
      label: 'PDF 1',
      content: PRIVATE_TEXT,
      startPage: 2,
      endPage: 3,
    });

    const appendix = await session.finalizeSourceAppendix();
    expect(appendix).toContain('PDF attachments accessed');
    expect(appendix).toContain(SOURCE_SHA256);
    expect(appendix).toContain('pages 2-3');
    expect(appendix).not.toContain(PRIVATE_TEXT);
    expect(pdfAttachments.revoke).toHaveBeenCalledOnce();

    const afterTerminal = await session.handler(call('list_pdf_attachments', {}), delivery);
    expect(payload(afterTerminal)).toEqual({ error: 'pdf_attachment_expired' });
  });

  it('does not record PDF provenance when the tool payload is discarded', async () => {
    const workspace = new WorkspaceService(new MemoryStorage());
    const project = await workspace.createProject({ name: 'Discarded PDF project' });
    const session = new ProjectAgentToolSession({
      projectId: project.id,
      workspace,
      vault: unavailableVault,
      localNotesVault: null,
      pdfAttachments: new FakePdfAttachments(),
    });
    const read = await session.handler(
      call('read_pdf_attachment', { attachmentId: ATTACHMENT_ID }),
      {
        outcome: Promise.resolve('discarded'),
        abortSignal: new AbortController().signal,
      },
    );
    expect(read.success).toBe(true);
    expect(await session.finalizeSourceAppendix()).toBe('');
  });
});
