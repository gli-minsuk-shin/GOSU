import { createHash } from 'node:crypto';
import type { AssistantProfile, BriefingWorkspaceStore } from './briefing-workspace-store';
import { briefingClientHash } from './briefing-client-context';
import type {
  ProjectChatAttachmentService,
  ProjectChatAttachmentsForAgent,
} from '../desktop/src/main/project-chat-attachment-service';
export const BRIEFING_ATTACHMENT_PROJECT = 'b13f1000-0000-4000-8000-000000000001';
/** Separate service instance and synthetic namespace: no Project Chat capability crosses over. */
export function briefingAttachmentScope(profile: AssistantProfile) {
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        profile.routineId,
        briefingClientHash(),
        profile.preferences,
        profile.live,
        profile.approvedScope,
      ]),
    )
    .digest('hex');
  return {
    projectId: BRIEFING_ATTACHMENT_PROJECT,
    sessionId: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
  };
}
export class BriefingAttachments {
  constructor(
    private workspace: BriefingWorkspaceStore,
    private service: ProjectChatAttachmentService,
  ) {}
  async profile(routineId: string) {
    const profile = await this.workspace.profile(routineId);
    if (!profile || !this.workspace.owns(profile)) throw new Error('assistant_client_required');
    return profile;
  }
  async choose(routineId: string, dropTicket?: string) {
    const profile = await this.profile(routineId),
      scope = briefingAttachmentScope(profile);
    const selected = dropTicket
      ? await this.service.redeemDrop(scope, routineId, dropTicket)
      : await this.service.choose(scope);
    try {
      if (JSON.stringify(await this.profile(routineId)) !== JSON.stringify(profile))
        throw new Error('assistant_settings_changed');
    } catch (error) {
      await Promise.all(
        selected.map((item) => this.service.release({ ...scope, attachmentId: item.id })),
      );
      throw error;
    }
    return selected;
  }
  async release(routineId: string, attachmentId: string) {
    return this.service.release({
      ...briefingAttachmentScope(await this.profile(routineId)),
      attachmentId,
    });
  }
  claim(profile: AssistantProfile, ids: string[]): ProjectChatAttachmentsForAgent {
    const scope = briefingAttachmentScope(profile);
    return this.service.claim(scope.projectId, scope.sessionId, ids);
  }
  validate(profile: AssistantProfile, ids: string[]) {
    const scope = briefingAttachmentScope(profile);
    return this.service.validate(scope.projectId, scope.sessionId, ids);
  }
}
