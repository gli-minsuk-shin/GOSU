import { describe, expect, it } from 'vitest';

import { LectureStudioServiceError } from '../src/main/lecture-studio-service';
import { ProjectTrashLifecycle } from '../src/main/project-trash-lifecycle';
import { WorkspaceServiceError } from '../src/main/workspace-service';

describe('ProjectTrashLifecycle', () => {
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
    });
    const lifecycle = new ProjectTrashLifecycle(gate('chat'), gate('ssh'), gate('lecture'));

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
      'purge',
      'lecture:exit',
      'ssh:exit',
      'chat:exit',
    ]);
  });

  it('fails closed with a bounded Trash error when lecture generation is active', async () => {
    const pass = {
      async runWhenProjectsIdle<T>(_projectIds: readonly string[], operation: () => Promise<T>) {
        return operation();
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
    const lifecycle = new ProjectTrashLifecycle(pass, pass, lecture);

    const result = await lifecycle
      .runWhenProjectTrashIdle(['project-a'], async () => 'unsafe')
      .catch((error: unknown) => error);
    expect(result).toBeInstanceOf(WorkspaceServiceError);
    expect(result).toMatchObject({ code: 'trash_busy' });
  });
});
