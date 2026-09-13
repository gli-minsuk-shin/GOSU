import { z } from 'zod';
import { briefingClientHash } from './briefing-client-context';
import type { BriefingAttachments } from './briefing-attachments';
import type { AssistantProfile, BriefingWorkspaceStore } from './briefing-workspace-store';
import { AssistantQueuedMessageSchema } from './src/assistant-queue-contract';

type Active = {
  owner: string | null;
  controller: AbortController;
  steer?: (message: string) => Promise<void>;
  steering: boolean;
};
const Request = z
  .object({
    routineId: z.string().max(128),
    id: z.string().uuid().optional(),
    revision: z.number().int().nonnegative().optional(),
    prompt: z.string().trim().min(1).max(6000).optional(),
    attachmentIds: AssistantQueuedMessageSchema.shape.attachmentIds.optional(),
    paperReference: AssistantQueuedMessageSchema.shape.paperReference,
  })
  .strict();
/** Exactly one local run per routine. Persisted claims are never replayed after an uncertain run. */
export class BriefingChatQueue {
  private active = new Map<string, Active>();
  constructor(
    private workspace: BriefingWorkspaceStore,
    private attachments: () => BriefingAttachments | undefined,
  ) {}
  begin(profile: AssistantProfile, parent: AbortSignal) {
    if (this.active.has(profile.routineId)) throw new Error('assistant_chat_busy');
    const run: Active = {
      owner: briefingClientHash(),
      controller: new AbortController(),
      steering: false,
    };
    this.active.set(profile.routineId, run);
    const abort = () => run.controller.abort();
    parent.addEventListener('abort', abort, { once: true });
    if (parent.aborted) abort();
    return {
      signal: run.controller.signal,
      onActiveTurn: (steer: Active['steer']) => {
        if (steer) run.steer = steer;
      },
      finish: () => {
        parent.removeEventListener('abort', abort);
        if (this.active.get(profile.routineId) === run) this.active.delete(profile.routineId);
      },
    };
  }
  async handle(path: string, body: unknown) {
    const input = Request.parse(body),
      profile = await this.workspace.profile(input.routineId);
    if (!profile || !this.workspace.owns(profile)) throw new Error('assistant_client_required');
    const active = this.active.get(profile.routineId);
    if (active && active.owner !== briefingClientHash())
      throw new Error('assistant_client_required');
    const files = this.attachments();
    if (path.endsWith('/list'))
      return {
        items: await this.workspace.chatQueue(profile, !!active),
        active: !!active,
        canSteer: !!active?.steer && !active.controller.signal.aborted,
        canAttach: !!files,
      };
    if (path.endsWith('/enqueue')) {
      if (!input.id || !input.prompt) throw new Error('assistant_queue_invalid');
      if (input.paperReference && input.paperReference.routineId !== profile.routineId)
        throw new Error('assistant_paper_scope_mismatch');
      if (input.attachmentIds?.length) {
        if (!files) throw new Error('assistant_attachments_unavailable');
        files.validate(profile, input.attachmentIds);
      }
      return this.workspace.enqueueChat(
        profile,
        input.id,
        input.prompt,
        input.attachmentIds ?? [],
        input.paperReference,
      );
    }
    if (path.endsWith('/claim'))
      return { item: active ? null : await this.workspace.claimChatQueue(profile) };
    if (path.endsWith('/stop')) {
      active?.controller.abort();
      return { stopped: !!active };
    }
    if (!input.id || input.revision === undefined) throw new Error('assistant_queue_invalid');
    if (path.endsWith('/steer')) {
      if (!active?.steer || active.controller.signal.aborted || active.steering)
        throw new Error('steer_provider_unsupported');
      active.steering = true;
      try {
        const item = (await this.workspace.chatQueue(profile, true)).find((q) => q.id === input.id);
        if (!item || item.state !== 'queued' || item.attachmentIds.length || item.paperReference)
          throw new Error('assistant_steer_text_only');
        // Remove with revision CAS before transmission: neither the pump nor an uncertain retry may duplicate it.
        await this.workspace.changeChatQueue(profile, input.id, input.revision, 'delete');
        await this.workspace.appendConversation(profile, {
          role: 'user',
          text: `[실행 중 보충 요청 · 전달 결과는 별도 확인]\n${item.prompt}`,
          createdAt: new Date().toISOString(),
        });
        await active.steer(item.prompt);
        return { accepted: true, prompt: item.prompt };
      } finally {
        active.steering = false;
      }
    }
    const action = path.endsWith('/edit')
      ? 'edit'
      : path.endsWith('/delete')
        ? 'delete'
        : path.endsWith('/next')
          ? 'next'
          : null;
    if (!action) throw new Error('assistant_queue_invalid');
    const item = await this.workspace.changeChatQueue(
      profile,
      input.id,
      input.revision,
      action,
      input.prompt,
    );
    if (action === 'delete' && files)
      await Promise.all(
        item.attachmentIds.map((attachmentId) =>
          files.release(profile.routineId, attachmentId).catch(() => undefined),
        ),
      );
    if (action === 'next') active?.controller.abort();
    return { updated: true };
  }
}
