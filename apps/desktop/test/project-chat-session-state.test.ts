import { describe, expect, it } from 'vitest';

import {
  activeSessionIdsForProject,
  projectChatSessionKey,
  resolveProjectChatSessionId,
  VolatileProjectChatDrafts,
} from '../src/renderer/src/project-chat-session-state';

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessions = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    projectId,
    title: 'Project chat',
    isDefault: true,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    projectId,
    title: 'Second chat',
    isDefault: false,
    createdAt: '2026-08-04T00:01:00.000Z',
    updatedAt: '2026-08-04T00:01:00.000Z',
  },
] as const;

describe('Project Chat session state', () => {
  it('preserves a valid selection and otherwise falls back to the default session', () => {
    expect(resolveProjectChatSessionId(sessions, sessions[1].id)).toBe(sessions[1].id);
    expect(resolveProjectChatSessionId(sessions, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')).toBe(
      sessions[0].id,
    );
    expect(resolveProjectChatSessionId([], null)).toBeNull();
  });

  it('keeps active turn state isolated by project and session', () => {
    const active = new Set([
      projectChatSessionKey(projectId, sessions[1].id),
      projectChatSessionKey('dddddddd-dddd-4ddd-8ddd-dddddddddddd', sessions[0].id),
    ]);
    expect(activeSessionIdsForProject(projectId, active, sessions)).toEqual(
      new Set([sessions[1].id]),
    );
  });

  it('keeps unsent drafts isolated while switching projects and sessions', () => {
    const drafts = new VolatileProjectChatDrafts();
    drafts.write(projectId, sessions[0].id, 'default-session draft');
    drafts.write(projectId, sessions[1].id, 'second-session draft');
    drafts.write('dddddddd-dddd-4ddd-8ddd-dddddddddddd', sessions[0].id, 'other project');

    expect(drafts.read(projectId, sessions[0].id)).toBe('default-session draft');
    expect(drafts.read(projectId, sessions[1].id)).toBe('second-session draft');
    expect(drafts.read('dddddddd-dddd-4ddd-8ddd-dddddddddddd', sessions[0].id)).toBe(
      'other project',
    );
    drafts.write(projectId, sessions[0].id, '');
    expect(drafts.read(projectId, sessions[0].id)).toBe('');
    expect(drafts.read(projectId, sessions[1].id)).toBe('second-session draft');
  });
});
