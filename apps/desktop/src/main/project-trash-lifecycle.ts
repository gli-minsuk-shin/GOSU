import { LectureStudioServiceError, type LectureStudioService } from './lecture-studio-service';
import { ProjectChatServiceError, type ProjectChatService } from './project-chat-service';
import { SshConnectionServiceError, type SshConnectionService } from './ssh-connection-service';
import { WorkspaceServiceError } from './workspace-service';

export class ProjectTrashLifecycle {
  constructor(
    private readonly projectChat: Pick<ProjectChatService, 'runWhenProjectsIdle'>,
    private readonly ssh: Pick<SshConnectionService, 'runWhenProjectsIdle'>,
    private readonly lecture: Pick<LectureStudioService, 'runWhenProjectsIdle'>,
  ) {}

  async runWhenProjectTrashIdle<T>(
    projectIds: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await this.projectChat.runWhenProjectsIdle(projectIds, () =>
        this.ssh.runWhenProjectsIdle(projectIds, () =>
          this.lecture.runWhenProjectsIdle(projectIds, operation),
        ),
      );
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
