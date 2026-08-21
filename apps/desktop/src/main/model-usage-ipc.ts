import { MODEL_USAGE_IPC_CHANNELS } from '../shared/model-usage-channels';
import { ModelUsageAnalyticsQuerySchema } from '../shared/model-usage-contracts';
import type { ModelUsageService } from './model-usage-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerModelUsageIpc(register: RegisterHandler, service: ModelUsageService) {
  register(MODEL_USAGE_IPC_CHANNELS.query, (input) => {
    const parsed = ModelUsageAnalyticsQuerySchema.safeParse(input);
    if (!parsed.success) throw new Error('invalid_model_usage_query');
    return service.query(parsed.data);
  });
}
