import { describe, expect, it } from 'vitest';

import {
  SshWorkspaceLoadGuard,
  sshWorkspacesForProject,
} from '../src/renderer/src/ssh-workspace-load-guard';

describe('SSH workspace project load guard', () => {
  it('rejects a late project response after navigation', () => {
    const guard = new SshWorkspaceLoadGuard();
    guard.activate('project-a');
    const projectA = guard.begin('project-a');
    guard.activate('project-b');
    const projectB = guard.begin('project-b');

    expect(guard.accepts(projectA)).toBe(false);
    expect(guard.accepts(projectB)).toBe(true);
  });

  it('rejects older concurrent loads and offscreen refreshes', () => {
    const guard = new SshWorkspaceLoadGuard();
    guard.activate('project-b');
    const older = guard.begin('project-b');
    const newer = guard.begin('project-b');

    expect(guard.begin('project-a')).toBeNull();
    expect(guard.accepts(older)).toBe(false);
    expect(guard.accepts(newer)).toBe(true);
  });

  it('never renders grants from the previously selected project', () => {
    const projectA = '11111111-1111-4111-8111-111111111111';
    const projectB = '22222222-2222-4222-8222-222222222222';
    const workspaces = [
      {
        grant: { projectId: projectA },
      },
      {
        grant: { projectId: projectB },
      },
    ];

    expect(sshWorkspacesForProject(workspaces, projectB)).toEqual([workspaces[1]]);
    expect(sshWorkspacesForProject(workspaces, null)).toEqual([]);
  });
});
