import { expect, it, vi } from 'vitest';
import { BriefingAttachments, briefingAttachmentScope } from './briefing-attachments';
import { briefingClientContext } from './briefing-client-context';
import type { AssistantProfile, BriefingWorkspaceStore } from './briefing-workspace-store';
import type { ProjectChatAttachmentService } from '../desktop/src/main/project-chat-attachment-service';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
const profile = {
  routineId: 'r',
  live: defaultLiveSettings(),
  preferences: defaultAssistantPreferences(),
  approvedScope: null,
} as AssistantProfile;
it('binds attachments to owner, routine and settings, independently of Project Chat', () => {
  const a = briefingClientContext.run('a'.repeat(64), () => briefingAttachmentScope(profile));
  const b = briefingClientContext.run('b'.repeat(64), () => briefingAttachmentScope(profile));
  expect(a.sessionId).not.toBe(b.sessionId);
  expect(briefingAttachmentScope({ ...profile, routineId: 'other' }).sessionId).not.toBe(
    a.sessionId,
  );
  expect(a.projectId).toBe('b13f1000-0000-4000-8000-000000000001');
});
it('releases staged files if settings or ownership disappear while picker is open', async () => {
  const store = {
    profile: vi.fn().mockResolvedValueOnce(profile).mockResolvedValue(null),
    owns: () => true,
  };
  const service = {
    choose: vi.fn().mockResolvedValue([{ id: 'fixture' }]),
    release: vi.fn().mockResolvedValue(undefined),
  };
  const attachments = new BriefingAttachments(
    store as unknown as BriefingWorkspaceStore,
    service as unknown as ProjectChatAttachmentService,
  );
  await expect(attachments.choose('r')).rejects.toThrow('assistant_client_required');
  expect(service.release).toHaveBeenCalledWith(
    expect.objectContaining({ attachmentId: 'fixture' }),
  );
});
