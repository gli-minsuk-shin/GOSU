import type { ZodType } from 'zod';

import { OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS } from '../shared/overleaf-personal-token-channels';
import {
  OverleafPersonalTokenCommandSchema,
  SaveOverleafPersonalTokenInputSchema,
} from '../shared/overleaf-personal-token-contracts';
import type { OverleafPersonalTokenIpcResult } from '../shared/overleaf-personal-token-ipc-result';
import {
  OverleafPersonalTokenServiceError,
  type OverleafPersonalTokenService,
} from './overleaf-personal-token-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerOverleafPersonalTokenIpc(
  register: RegisterHandler,
  service: OverleafPersonalTokenService,
  reportUnexpected: (error: unknown) => void = () => undefined,
) {
  register(OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS.status, (input) =>
    withValidatedInput(
      input,
      OverleafPersonalTokenCommandSchema,
      (command) => service.status(command),
      reportUnexpected,
    ),
  );
  register(OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS.save, (input) =>
    withValidatedInput(
      input,
      SaveOverleafPersonalTokenInputSchema,
      (command) => service.save(command),
      reportUnexpected,
    ),
  );
  register(OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS.remove, (input) =>
    withValidatedInput(
      input,
      OverleafPersonalTokenCommandSchema,
      (command) => service.remove(command),
      reportUnexpected,
    ),
  );
}

async function withValidatedInput<TInput, TOutput>(
  input: unknown,
  schema: ZodType<TInput>,
  operation: (command: TInput) => Promise<TOutput>,
  reportUnexpected: (error: unknown) => void,
): Promise<OverleafPersonalTokenIpcResult<TOutput>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'invalid_overleaf_personal_token_input' } };
  }
  try {
    return { ok: true, value: await operation(parsed.data) };
  } catch (error) {
    if (error instanceof OverleafPersonalTokenServiceError) {
      return { ok: false, error: { code: error.code } };
    }
    try {
      // This endpoint handles a write-only secret. Never pass the original error, message, or
      // cause into diagnostics because a provider/store failure may echo the submitted token.
      reportUnexpected(new Error('overleaf_personal_token_unavailable'));
    } catch {
      // Diagnostics must never turn a bounded secret-store result into a rejected invoke call.
    }
    return { ok: false, error: { code: 'overleaf_personal_token_unavailable' } };
  }
}
