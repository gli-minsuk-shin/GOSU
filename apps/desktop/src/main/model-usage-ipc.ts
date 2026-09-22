import { MODEL_PRICE_IPC_CHANNELS } from '../shared/model-price-contracts';
import { MODEL_USAGE_IPC_CHANNELS } from '../shared/model-usage-channels';
import { ModelUsageAnalyticsQuerySchema } from '../shared/model-usage-contracts';
import type { ModelPriceCatalogStore } from './model-price-catalog';
import type { ModelUsageService } from './model-usage-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerModelUsageIpc(
  register: RegisterHandler,
  service: ModelUsageService,
  prices?: Pick<ModelPriceCatalogStore, 'status' | 'refresh'>,
) {
  register(MODEL_USAGE_IPC_CHANNELS.query, (input) => {
    const parsed = ModelUsageAnalyticsQuerySchema.safeParse(input);
    if (!parsed.success) throw new Error('invalid_model_usage_query');
    return service.query(parsed.data);
  });
  if (!prices) return;
  // The price list is public data; neither call takes input from the page.
  register(MODEL_PRICE_IPC_CHANNELS.status, () => prices.status());
  register(MODEL_PRICE_IPC_CHANNELS.refresh, () => prices.refresh());
}
