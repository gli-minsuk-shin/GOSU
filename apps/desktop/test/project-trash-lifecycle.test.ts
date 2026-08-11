import { describe, expect, it } from 'vitest';

import { LectureStudioServiceError } from '../src/main/lecture-studio-service';
import { ProjectTrashLifecycle } from '../src/main/project-trash-lifecycle';
import { SshConnectionServiceError } from '../src/main/ssh-connection-service';
import { WorkspaceServiceError } from '../src/main/workspace-service';

describe('ProjectTrashLifecycle', () => {
  it('holds Project Chat, SSH, and manuscript gates around one project inactivation', async () => {
    const trace: string[] = [];
    const gate = (name: string) => ({
      async runWhenProjectsIdle<T>(projectIds: readonly string[], operation: () => Promise<T>) {
        trace.push(`${name}:enter:${projectIds.join(',')}`);
        try {
          return await operation();
        } finally {
          trace.push(`${name}:exit`);
        }
      },
      async reconcileArtifactPurgeQueue(projectIds?: readonly string[]) {
        trace.push(`${name}:reconcile:${projectIds?.join(',') ?? 'all'}`);
        return 0;
      },
    });
    const lifecycle = new ProjectTrashLifecycle(
      gate('chat'),
      gate('ssh'),
      gate('lecture'),
      gate('manuscript'),
    );

    await expect(
      lifecycle.runWhenProjectInactivationIdle('project-a', async () => {
        trace.push('inactive');
        return 'done';
      }),
    ).resolves.toBe('done');
    expect(trace).toEqual([
      'chat:enter:project-a',
      'ssh:enter:project-a',
      'manuscript:enter:project-a',
      'inactive',
      'manuscript:exit',
      'ssh:exit',
      'chat:exit',
    ]);
  });

  it('fails closed when an SSH lifecycle operation already owns the project', async () => {
    const pass = {
      async runWhenProjectsIdle<T>(_projectIds: readonly string[], operation: () => Promise<T>) {
        return operation();
      },
      async reconcileArtifactPurgeQueue() {
        return 0;
      },
    };
    const sshBusy = {
      async runWhenProjectsIdle<T>(
        _projectIds: readonly string[],
        _operation: () => Promise<T>,
      ): Promise<T> {
        throw new SshConnectionServiceError('ssh_unavailable');
      },
    };
    const lifecycle = new ProjectTrashLifecycle(pass, sshBusy, pass, pass);

    await expect(
      lifecycle.runWhenProjectInactivationIdle('project-a', async () => 'unsafe'),
    ).rejects.toMatchObject({ code: 'trash_busy' });
  });

  it('holds Project Chat, SSH, and lecture gates around one operation', async () => {
    const trace: string[] = [];
    const gate = (name: string) => ({
      async runWhenProjectsIdle<T>(projectIds: readonly string[], operation: () => Promise<T>) {
        trace.push(`${name}:enter:${projectIds.join(',')}`);
        try {
          return await operation();
        } finally {
          trace.push(`${name}:exit`);
        }
      },
      async reconcileArtifactPurgeQueue(projectIds?: readonly string[]) {
        trace.push(`${name}:reconcile:${projectIds?.join(',') ?? 'all'}`);
        return 0;
      },
    });
    const lifecycle = new ProjectTrashLifecycle(
      gate('chat'),
      gate('ssh'),
      gate('lecture'),
      gate('manuscript'),
    );

    await expect(
      lifecycle.runWhenProjectTrashIdle(['project-b', 'project-a'], async () => {
        trace.push('purge');
        return 'done';
      }),
    ).resolves.toBe('done');
    expect(trace).toEqual([
      'chat:enter:project-b,project-a',
      'ssh:enter:project-b,project-a',
      'lecture:enter:project-b,project-a',
      'manuscript:enter:project-b,project-a',
      'purge',
      'manuscript:exit',
      'lecture:exit',
      'ssh:exit',
      'chat:exit',
      'manuscript:reconcile:all',
    ]);
  });

  it('fails closed with a bounded Trash error when lecture generation is active', async () => {
    const pass = {
      async runWhenProjectsIdle<T>(_projectIds: readonly string[], operation: () => Promise<T>) {
        return operation();
      },
      async reconcileArtifactPurgeQueue() {
        return 0;
      },
    };
    const lecture = {
      async runWhenProjectsIdle<T>(
        _projectIds: readonly string[],
        _operation: () => Promise<T>,
      ): Promise<T> {
        throw new LectureStudioServiceError('lecture_busy');
      },
    };
    const lifecycle = new ProjectTrashLifecycle(pass, pass, lecture, pass);

    const result = await lifecycle
      .runWhenProjectTrashIdle(['project-a'], async () => 'unsafe')
      .catch((error: unknown) => error);
    expect(result).toBeInstanceOf(WorkspaceServiceError);
    expect(result).toMatchObject({ code: 'trash_busy' });
  });
});
