import type { ZodType } from 'zod';

import { LITERATURE_IPC_CHANNELS } from '../shared/literature-channels';
import {
  CancelLiteratureAiInputSchema,
  DeleteLiteratureRecordInputSchema,
  ListLiteratureInputSchema,
  LiteratureExportRequestSchema,
  LiteratureImportRequestSchema,
  LiteratureSearchInputSchema,
  OrganizeLiteratureInputSchema,
  UpdateLiteratureAnnotationsInputSchema,
  type LiteratureIpcResult,
} from '../shared/literature-contracts';
import { LiteratureAiServiceError, type LiteratureAiService } from './literature-ai-service';
import { LiteratureServiceError, type LiteratureService } from './literature-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerLiteratureIpc(
  register: RegisterHandler,
  service: LiteratureService,
  aiService: LiteratureAiService | null,
  reportUnexpected: (error: unknown) => void = () => undefined,
) {
  register(LITERATURE_IPC_CHANNELS.list, (input) =>
    withInput(
      input,
      ListLiteratureInputSchema,
      (command) => service.list(command),
      reportUnexpected,
    ),
  );
  register(LITERATURE_IPC_CHANNELS.search, (input) =>
    withInput(
      input,
      LiteratureSearchInputSchema,
      (command) => service.search(command),
      reportUnexpected,
    ),
  );
  register(LITERATURE_IPC_CHANNELS.updateAnnotations, (input) =>
    withInput(
      input,
      UpdateLiteratureAnnotationsInputSchema,
      (command) => service.updateAnnotations(command),
      reportUnexpected,
    ),
  );
  register(LITERATURE_IPC_CHANNELS.deleteRecord, (input) =>
    withInput(
      input,
      DeleteLiteratureRecordInputSchema,
      (command) => service.deleteRecord(command),
      reportUnexpected,
    ),
  );
  register(LITERATURE_IPC_CHANNELS.importRecords, (input) =>
    withInput(
      input,
      LiteratureImportRequestSchema,
      (command) => service.importRecords(command),
      reportUnexpected,
    ),
  );
  register(LITERATURE_IPC_CHANNELS.exportRecords, (input) =>
    withInput(
      input,
      LiteratureExportRequestSchema,
      (command) => service.exportRecords(command),
      reportUnexpected,
    ),
  );
  register(LITERATURE_IPC_CHANNELS.organize, (input) =>
    withInput(
      input,
      OrganizeLiteratureInputSchema,
      (command) => {
        if (!aiService) throw new LiteratureAiServiceError('literature_ai_unavailable');
        return aiService.organize(command);
      },
      reportUnexpected,
    ),
  );
  register(LITERATURE_IPC_CHANNELS.cancelOrganize, (input) =>
    withInput(
      input,
      CancelLiteratureAiInputSchema,
      (command) => {
        if (!aiService) throw new LiteratureAiServiceError('literature_ai_unavailable');
        return aiService.cancel(command);
      },
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
    return Promise.resolve<LiteratureIpcResult<TOutput>>({
      ok: false,
      error: { code: 'invalid_literature_input' },
    });
  }
  return safely(() => operation(parsed.data), reportUnexpected);
}

async function safely<T>(
  operation: () => Promise<T>,
  reportUnexpected: (error: unknown) => void,
): Promise<LiteratureIpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (error instanceof LiteratureServiceError || error instanceof LiteratureAiServiceError) {
      return { ok: false, error: { code: error.code } };
    }
    try {
      reportUnexpected(error);
    } catch {
      // Diagnostics must not turn a bounded literature response into a rejected invoke call.
    }
    return { ok: false, error: { code: 'literature_unavailable' } };
  }
}
