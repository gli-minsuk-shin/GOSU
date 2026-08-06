import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ProjectAgentToolSession } from '../src/main/project-agent-tools';
import type {
  AgentAttachmentCatalogItem,
  AgentAttachmentChunk,
  AgentNativeImageInput,
  ProjectChatAttachmentsForAgent,
} from '../src/main/project-chat-attachment-service';
import { WorkspaceService, type WorkspaceStorage } from '../src/main/workspace-service';
import type { ProjectAgentVault } from '../src/main/project-agent-tools';
import type { CodexDynamicToolCall, CodexJsonValue } from '../src/main/codex-app-server';
import type { WorkspaceOperation, WorkspaceSnapshot } from '../src/shared/workspace-contracts';

const ATTACHMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IMAGE_ATTACHMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SOURCE_SHA256 = 'b'.repeat(64);
const PRIVATE_TEXT = 'PRIVATE_DOCUMENT_TEXT_FROM_ACTIVE_TURN';

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
  saveMarkdownForAgent: async () => {
    throw new Error('vault_not_selected');
  },
};

class FakeAttachments implements ProjectChatAttachmentsForAgent {
  revoked = false;
  readonly revoke = vi.fn(async () => {
    this.revoked = true;
  });
  catalog(): readonly AgentAttachmentCatalogItem[] {
    return this.revoked
      ? []
      : [
          {
            attachmentId: ATTACHMENT_ID,
            label: 'Attachment 1',
            sourceSha256: SOURCE_SHA256,
            kind: 'document',
            format: 'docx',
            unitLabel: 'part',
            unitCount: 12,
            extractedCharacters: PRIVATE_TEXT.length,
            truncated: false,
            textAvailable: true,
            visualAvailable: false,
            reconstructionNotice: 'Document layout was reconstructed as bounded text.',
          },
        ];
  }
  read(
    attachmentId: string,
    startUnit: number,
    unitCount: number,
    maxCharacters: number,
  ): AgentAttachmentChunk | null {
    if (this.revoked || attachmentId !== ATTACHMENT_ID) return null;
    const content = PRIVATE_TEXT.slice(0, maxCharacters);
    return {
      attachmentId,
      label: 'Attachment 1',
      sourceSha256: SOURCE_SHA256,
      kind: 'document',
      format: 'docx',
      unitLabel: 'part',
      unitCount: 12,
      startUnit,
      endUnit: Math.min(12, startUnit + unitCount - 1),
      content,
      contentSha256: 'c'.repeat(64),
      truncated: false,
      reconstructionNotice: 'Document layout was reconstructed as bounded text.',
    };
  }
  nativeImages(): readonly AgentNativeImageInput[] {
    return [];
  }
}

class FakeImageAttachments implements ProjectChatAttachmentsForAgent {
  revoked = false;
  readonly revoke = vi.fn(async () => {
    this.revoked = true;
  });
  catalog(): readonly AgentAttachmentCatalogItem[] {
    return this.revoked
      ? []
      : [
          {
            attachmentId: IMAGE_ATTACHMENT_ID,
            label: 'Attachment 1',
            sourceSha256: SOURCE_SHA256,
            kind: 'image',
            format: 'png',
            unitLabel: 'image',
            unitCount: 1,
            extractedCharacters: 0,
            truncated: false,
            textAvailable: false,
            visualAvailable: true,
          },
        ];
  }
  read(): AgentAttachmentChunk | null {
    return null;
  }
  nativeImages(): readonly AgentNativeImageInput[] {
    return this.revoked
      ? []
      : [
          {
            attachmentId: IMAGE_ATTACHMENT_ID,
            label: 'Attachment 1',
            sourceSha256: SOURCE_SHA256,
            path: '/private/tmp/gosu-chat-image-fixture.jpg',
          },
        ];
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

describe('Project Chat one-time attachment tools', () => {
  it('exposes only opaque metadata, delivers bounded reconstructed text, and revokes it at terminal', async () => {
    const workspace = new WorkspaceService(new MemoryStorage());
    const project = await workspace.createProject({ name: 'Document project' });
    const attachments = new FakeAttachments();
    const session = new ProjectAgentToolSession({
      projectId: project.id,
      sessionId: randomUUID(),
      attemptId: randomUUID(),
      workspace,
      vault: unavailableVault,
      localNotesVault: null,
      attachments,
    });
    const tools = session.dynamicTools.flatMap((spec) =>
      spec.type === 'namespace' ? spec.tools.map((tool) => tool.name) : [spec.name],
    );
    expect(tools).toContain('list_turn_attachments');
    expect(tools).toContain('read_turn_attachment_text');

    const delivery = {
      outcome: Promise.resolve('delivered' as const),
      abortSignal: new AbortController().signal,
    };
    const listed = await session.handler(call('list_turn_attachments', {}), delivery);
    expect(payload(listed)).toMatchObject({
      oneTime: true,
      trust: 'untrusted_attachment_evidence',
      attachments: [
        {
          attachmentId: ATTACHMENT_ID,
          label: 'Attachment 1',
          kind: 'document',
          format: 'docx',
          unitLabel: 'part',
          unitCount: 12,
          textAvailable: true,
          visualAvailable: false,
        },
      ],
    });
    expect(listed.contentItems[0]!.text).not.toContain('private.docx');
    expect(listed.contentItems[0]!.text).not.toContain('/Users/');

    const read = await session.handler(
      call('read_turn_attachment_text', {
        attachmentId: ATTACHMENT_ID,
        startUnit: 2,
        unitCount: 2,
      }),
      delivery,
    );
    expect(payload(read)).toMatchObject({
      trust: 'untrusted_attachment_evidence',
      label: 'Attachment 1',
      format: 'docx',
      unitLabel: 'part',
      content: PRIVATE_TEXT,
      startUnit: 2,
      endUnit: 3,
    });

    const appendix = await session.finalizeSourceAppendix();
    expect(appendix).toContain('Turn attachments accessed');
    expect(appendix).toContain(SOURCE_SHA256);
    expect(appendix).toContain('parts 2-3');
    expect(appendix).not.toContain(PRIVATE_TEXT);
    expect(attachments.revoke).toHaveBeenCalledOnce();

    const afterTerminal = await session.handler(call('list_turn_attachments', {}), delivery);
    expect(payload(afterTerminal)).toEqual({ error: 'attachment_expired' });
  });

  it('does not record attachment provenance when the tool payload is discarded', async () => {
    const workspace = new WorkspaceService(new MemoryStorage());
    const project = await workspace.createProject({ name: 'Discarded document project' });
    const session = new ProjectAgentToolSession({
      projectId: project.id,
      workspace,
      vault: unavailableVault,
      localNotesVault: null,
      attachments: new FakeAttachments(),
    });
    const read = await session.handler(
      call('read_turn_attachment_text', { attachmentId: ATTACHMENT_ID }),
      {
        outcome: Promise.resolve('discarded'),
        abortSignal: new AbortController().signal,
      },
    );
    expect(read.success).toBe(true);
    expect(await session.finalizeSourceAppendix()).toBe('');
  });

  it('records delivered native images without exposing their temporary local path', async () => {
    const workspace = new WorkspaceService(new MemoryStorage());
    const project = await workspace.createProject({ name: 'Image project' });
    const attachments = new FakeImageAttachments();
    const session = new ProjectAgentToolSession({
      projectId: project.id,
      workspace,
      vault: unavailableVault,
      localNotesVault: null,
      attachments,
    });
    const delivery = {
      outcome: Promise.resolve('delivered' as const),
      abortSignal: new AbortController().signal,
    };

    const listed = await session.handler(call('list_turn_attachments', {}), delivery);
    expect(payload(listed)).toMatchObject({
      attachments: [
        {
          attachmentId: IMAGE_ATTACHMENT_ID,
          kind: 'image',
          format: 'png',
          textAvailable: false,
          visualAvailable: true,
        },
      ],
    });
    const read = await session.handler(
      call('read_turn_attachment_text', { attachmentId: IMAGE_ATTACHMENT_ID }),
      delivery,
    );
    expect(payload(read)).toEqual({ error: 'attachment_text_not_available' });

    session.markNativeImagesDelivered();
    const appendix = await session.finalizeSourceAppendix();
    expect(appendix).toContain('Turn attachments accessed');
    expect(appendix).toContain('Attachment 1 · png');
    expect(appendix).toContain('images 1-1');
    expect(appendix).not.toContain('/private/tmp/');
    expect(attachments.revoke).toHaveBeenCalledOnce();
  });
});
