import { describe, expect, it } from 'vitest';

import { ProjectChatLoadGuard } from '../src/renderer/src/project-chat-load-guard';

describe('ProjectChatLoadGuard', () => {
  it('rejects a stale snapshot that resolves after a turn event', () => {
    const guard = new ProjectChatLoadGuard();
    const request = guard.begin('project-a');

    guard.observeEvent('project-a');

    expect(guard.canApply(request)).toBe(false);
    expect(guard.isLatestRequest(request)).toBe(true);
  });

  it('allows only the latest response for one project without affecting another project', () => {
    const guard = new ProjectChatLoadGuard();
    const older = guard.begin('project-a');
    const otherProject = guard.begin('project-b');
    const newer = guard.begin('project-a');

    expect(guard.canApply(older)).toBe(false);
    expect(guard.canApply(newer)).toBe(true);
    expect(guard.canApply(otherProject)).toBe(true);
  });
});
