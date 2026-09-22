import { routedModel, type ModelRouting } from '@gosu/contracts';

import { assistantModel } from '../../../briefing-lab/briefing-assistant';
import { writeDailyQuote } from '../../../briefing-lab/daily-quote';
import { withNativeUsageScope } from '../../../briefing-lab/native-usage-observer';
import type { DailyQuoteGenerator } from './daily-quote-service';

/**
 * The quote is a "lightweight task": Settings → Agent alone decides its model. Without a model
 * there (or with a provider that cannot run such a job) no other model is used instead; the title
 * bar keeps its built-in line and says why.
 */
export function dailyQuoteGenerator(policy: ModelRouting | undefined): DailyQuoteGenerator | null {
  const model = policy ? routedModel(policy, 'lightweightTasks') : null;
  if (!model || (model.providerId !== 'codex' && model.providerId !== 'claude-code')) return null;
  const providerId = model.providerId;
  return async (input, signal) => {
    const resolved = await assistantModel({
      providerId,
      modelId: model.modelId,
      reasoning: model.reasoningOptionId,
    } as Parameters<typeof assistantModel>[0]);
    return withNativeUsageScope({ workloadKind: 'daily_quote', projectId: null }, () =>
      writeDailyQuote(
        input,
        { providerId, modelId: resolved.modelId, reasoning: model.reasoningOptionId },
        signal,
      ),
    );
  };
}
