import {
  ChooseProjectChatPdfAttachmentsInputSchema,
  ReleaseProjectChatPdfAttachmentInputSchema,
} from '../shared/project-chat-attachment-contracts';
import { PROJECT_CHAT_ATTACHMENT_IPC_CHANNELS } from '../shared/project-chat-attachment-channels';
import type { ProjectChatIpcResult } from '../shared/project-chat-ipc-result';
import {
  ProjectChatPdfAttachmentError,
  type ProjectChatAttachmentService,
} from './project-chat-attachment-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerProjectChatAttachmentIpc(
  register: RegisterHandler,
  service: ProjectChatAttachmentService,
  reportUnexpected: (error: unknown) => void = () => undefined,
) {
  register(PROJECT_CHAT_ATTACHMENT_IPC_CHANNELS.choose, (input) => {
    const parsed = ChooseProjectChatPdfAttachmentsInputSchema.safeParse(input);
    return parsed.success
      ? safely(() => service.choose(parsed.data), reportUnexpected)
      : invalidInput();
  });
  register(PROJECT_CHAT_ATTACHMENT_IPC_CHANNELS.release, (input) => {
    const parsed = ReleaseProjectChatPdfAttachmentInputSchema.safeParse(input);
    return parsed.success
      ? safely(() => service.release(parsed.data), reportUnexpected)
      : invalidInput();
  });
}

function invalidInput<T>(): Promise<ProjectChatIpcResult<T>> {
  return Promise.resolve({ ok: false, error: { code: 'invalid_chat_input' } });
}

async function safely<T>(
  operation: () => T | Promise<T>,
  reportUnexpected: (error: unknown) => void,
): Promise<ProjectChatIpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (error instanceof ProjectChatPdfAttachmentError) {
      return { ok: false, error: { code: error.code } };
    }
    try {
      reportUnexpected(error);
    } catch {
      // Diagnostics must not change a bounded attachment IPC response.
    }
    return { ok: false, error: { code: 'chat_unavailable' } };
  }
}
