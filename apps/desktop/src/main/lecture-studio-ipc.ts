import type { ZodType } from 'zod';

import { LECTURE_STUDIO_IPC_CHANNELS } from '../shared/lecture-studio-channels';
import {
  DiscardLectureExternalSourceSetInputSchema,
  RemoveStagedLectureExternalSourceInputSchema,
  StageLectureExternalSourcesInputSchema,
} from '../shared/lecture-external-source-contracts';
import { ImportLectureOverleafSourceInputSchema } from '../shared/lecture-overleaf-source-contracts';
import {
  CancelLectureStudioInputSchema,
  CompileLectureStudioPdfInputSchema,
  CreateLectureStudioInputSchema,
  EmptyLectureStudioTrashInputSchema,
  ExportLectureStudioArtifactInputSchema,
  GenerateLectureStudioInputSchema,
  ListLectureCandidatesInputSchema,
  ListLectureStudiosInputSchema,
  LectureStudioDetailInputSchema,
  LectureStudioVersionCommandSchema,
  OpenLectureStudioArtifactInputSchema,
  RevealLectureStudioArtifactInputSchema,
  SendLectureStudioMessageInputSchema,
  UpdateLectureStudioGenerationBriefInputSchema,
  type LectureStudioIpcErrorCode,
  type LectureStudioIpcResult,
} from '../shared/lecture-studio-contracts';
import { LectureStudioServiceError, type LectureStudioService } from './lecture-studio-service';
import {
  LectureExternalSourceError,
  type LectureExternalSourceService,
} from './lecture-external-source-service';
import {
  LectureOverleafSourceError,
  type LectureOverleafSourceService,
} from './lecture-overleaf-source-service';
import { ManuscriptWorkspaceServiceError } from './manuscript-workspace-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerLectureStudioIpc(
  register: RegisterHandler,
  service: LectureStudioService,
  externalSources: LectureExternalSourceService,
  overleafSources: LectureOverleafSourceService,
  reportUnexpected: (error: unknown) => void = () => undefined,
) {
  register(LECTURE_STUDIO_IPC_CHANNELS.list, (input) =>
    withInput(
      input,
      ListLectureStudiosInputSchema,
      (command) => service.list(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.detail, (input) =>
    withInput(
      input,
      LectureStudioDetailInputSchema,
      (command) => service.detail(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.candidates, (input) =>
    withInput(
      input,
      ListLectureCandidatesInputSchema,
      (command) => service.candidates(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.stageExternalSources, (input) =>
    withInput(
      input,
      StageLectureExternalSourcesInputSchema,
      (command) => externalSources.chooseAndStage(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.removeStagedExternalSource, (input) =>
    withInput(
      input,
      RemoveStagedLectureExternalSourceInputSchema,
      (command) => externalSources.removeStaged(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.discardExternalSourceSet, (input) =>
    withInput(
      input,
      DiscardLectureExternalSourceSetInputSchema,
      (command) => externalSources.discard(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.importOverleaf, (input) =>
    withInput(
      input,
      ImportLectureOverleafSourceInputSchema,
      (command) => overleafSources.importOverleaf(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.create, (input) =>
    withInput(
      input,
      CreateLectureStudioInputSchema,
      (command) => service.create(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.updateGenerationBrief, (input) =>
    withInput(
      input,
      UpdateLectureStudioGenerationBriefInputSchema,
      (command) => service.updateGenerationBrief(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.generate, (input) =>
    withInput(
      input,
      GenerateLectureStudioInputSchema,
      (command) => service.generate(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.send, (input) =>
    withInput(
      input,
      SendLectureStudioMessageInputSchema,
      (command) => service.send(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.cancel, (input) =>
    withInput(
      input,
      CancelLectureStudioInputSchema,
      (command) => service.cancel(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.trash, (input) =>
    withInput(
      input,
      LectureStudioVersionCommandSchema,
      (command) => service.trash(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.restore, (input) =>
    withInput(
      input,
      LectureStudioVersionCommandSchema,
      (command) => service.restore(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.emptyTrash, (input) =>
    withInput(
      input,
      EmptyLectureStudioTrashInputSchema,
      (command) => service.emptyTrash(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.compilePdf, (input) =>
    withInput(
      input,
      CompileLectureStudioPdfInputSchema,
      (command) => service.compilePdf(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.exportArtifact, (input) =>
    withInput(
      input,
      ExportLectureStudioArtifactInputSchema,
      (command) => service.exportArtifact(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.openArtifact, (input) =>
    withInput(
      input,
      OpenLectureStudioArtifactInputSchema,
      (command) => service.openArtifact(command),
      reportUnexpected,
    ),
  );
  register(LECTURE_STUDIO_IPC_CHANNELS.revealArtifact, (input) =>
    withInput(
      input,
      RevealLectureStudioArtifactInputSchema,
      (command) => service.revealArtifact(command),
      reportUnexpected,
    ),
  );
}

function withInput<TInput, TOutput>(
  input: unknown,
  schema: ZodType<TInput>,
  operation: (command: TInput) => Promise<TOutput>,
  reportUnexpected: (error: unknown) => void,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return Promise.resolve<LectureStudioIpcResult<TOutput>>({
      ok: false,
      error: { code: 'invalid_lecture_input' },
    });
  }
  return safely(() => operation(parsed.data), reportUnexpected);
}

async function safely<T>(
  operation: () => Promise<T>,
  reportUnexpected: (error: unknown) => void,
): Promise<LectureStudioIpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (error instanceof LectureStudioServiceError) {
      return { ok: false, error: { code: error.code } };
    }
    if (
      error instanceof LectureExternalSourceError ||
      error instanceof LectureOverleafSourceError
    ) {
      return { ok: false, error: { code: error.code } };
    }
    if (error instanceof ManuscriptWorkspaceServiceError) {
      const passthrough = new Set([
        'overleaf_git_auth_required',
        'overleaf_git_url_invalid',
        'overleaf_git_project_not_found',
        'overleaf_git_default_branch_missing',
        'overleaf_git_remote_rewritten',
        'overleaf_git_root_document_missing',
        'overleaf_git_checkpoint_too_large',
        'overleaf_keychain_unavailable',
        'overleaf_token_invalid',
      ]);
      return {
        ok: false,
        error: {
          code: passthrough.has(error.code)
            ? (error.code as LectureStudioIpcErrorCode)
            : 'lecture_overleaf_source_not_ready',
        },
      };
    }
    try {
      reportUnexpected(error);
    } catch {
      // Diagnostics must not turn a bounded IPC result into a rejected invoke call.
    }
    return { ok: false, error: { code: 'lecture_unavailable' } };
  }
}
