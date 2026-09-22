import { USAGE_LIMIT_IPC_CHANNELS } from '../shared/usage-limit-contracts';
import type { UsageLimitService } from './usage-limit-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

/** Read, "refresh now" and the two settings. Nothing here takes a provider, a path or a command. */
export function registerUsageLimitIpc(
  register: RegisterHandler,
  service: Pick<UsageLimitService, 'status' | 'refresh' | 'configure'>,
) {
  register(USAGE_LIMIT_IPC_CHANNELS.status, () => service.status());
  register(USAGE_LIMIT_IPC_CHANNELS.refresh, () => service.refresh(true));
  register(USAGE_LIMIT_IPC_CHANNELS.configure, (input) => service.configure(input));
}
