import { LectureStudioServiceError, type LectureStudioService } from './lecture-studio-service';
import type { ManuscriptWorkspaceService } from './manuscript-workspace-service';
import { ProjectChatServiceError, type ProjectChatService } from './project-chat-service';
import { SshConnectionServiceError, type SshConnectionService } from './ssh-connection-service';
import { WorkspaceServiceError } from './workspace-service';

export class ProjectTrashLifecycle {
  constructor(
    private readonly projectChat: Pick<ProjectChatService, 'runWhenProjectsIdle'>,
    private readonly ssh: Pick<SshConnectionService, 'runWhenProjectsIdle'>,
    private readonly lecture: Pick<LectureStudioService, 'runWhenProjectsIdle'>,
    private readonly manuscripts: Pick<
      ManuscriptWorkspaceService,
      'runWhenProjectsIdle' | 'reconcileArtifactPurgeQueue'
    >,
  ) {}

  async runWhenProjectInactivationIdle<T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await this.projectChat.runWhenProjectsIdle([projectId], () =>
        this.ssh.runWhenProjectsIdle([projectId], () =>
          this.manuscripts.runWhenProjectsIdle([projectId], operation),
        ),
      );
    } catch (error) {
      // Preserve the existing bounded archive/Trash response for an active chat turn.
      if (error instanceof ProjectChatServiceError && error.code === 'chat_busy') throw error;
      if (error instanceof SshConnectionServiceError && error.code === 'ssh_unavailable') {
        throw new WorkspaceServiceError('trash_busy');
      }
      throw error;
    }
  }

  async runWhenProjectTrashIdle<T>(
    projectIds: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await this.projectChat.runWhenProjectsIdle(projectIds, () =>
        this.ssh.runWhenProjectsIdle(projectIds, () =>
          this.lecture.runWhenProjectsIdle(projectIds, () =>
            this.manuscripts.runWhenProjectsIdle(projectIds, operation),
          ),
        ),
      );
      await this.manuscripts.reconcileArtifactPurgeQueue().catch(() => undefined);
      return result;
    } catch (error) {
      if (
        (error instanceof ProjectChatServiceError && error.code === 'chat_busy') ||
        (error instanceof SshConnectionServiceError && error.code === 'ssh_unavailable') ||
        (error instanceof LectureStudioServiceError && error.code === 'lecture_busy')
      ) {
        throw new WorkspaceServiceError('trash_busy');
      }
      throw error;
    }
  }
}
