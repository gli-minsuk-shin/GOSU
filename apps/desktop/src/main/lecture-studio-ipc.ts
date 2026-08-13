import type { ZodType } from 'zod';

import { LECTURE_STUDIO_IPC_CHANNELS } from '../shared/lecture-studio-channels';
import {
  CancelLectureStudioInputSchema,
  CompileLectureStudioPdfInputSchema,
  CreateLectureStudioInputSchema,
  ExportLectureStudioArtifactInputSchema,
  GenerateLectureStudioInputSchema,
  ListLectureCandidatesInputSchema,
  ListLectureStudiosInputSchema,
  LectureStudioDetailInputSchema,
  OpenLectureStudioArtifactInputSchema,
  RevealLectureStudioArtifactInputSchema,
  SendLectureStudioMessageInputSchema,
  type LectureStudioIpcResult,
} from '../shared/lecture-studio-contracts';
import { LectureStudioServiceError, type LectureStudioService } from './lecture-studio-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerLectureStudioIpc(
  register: RegisterHandler,
  service: LectureStudioService,
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
  register(LECTURE_STUDIO_IPC_CHANNELS.create, (input) =>
    withInput(
      input,
      CreateLectureStudioInputSchema,
      (command) => service.create(command),
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
    try {
      reportUnexpected(error);
    } catch {
      // Diagnostics must not turn a bounded IPC result into a rejected invoke call.
    }
    return { ok: false, error: { code: 'lecture_unavailable' } };
  }
}
