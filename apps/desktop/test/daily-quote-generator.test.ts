import { defaultModelRouting } from '@gosu/contracts';
import { describe, expect, it } from 'vitest';

import { dailyQuoteGenerator } from '../src/main/daily-quote-generator';

describe('daily quote model', () => {
  it('runs only on the model that Settings → Agent assigns to lightweight tasks', () => {
    const unassigned = defaultModelRouting();
    expect(dailyQuoteGenerator(undefined)).toBeNull();
    expect(dailyQuoteGenerator(unassigned)).toBeNull();

    const assigned = {
      ...unassigned,
      lightweight: {
        providerId: 'claude-code' as const,
        modelId: 'claude-code:sonnet-5',
        reasoningOptionId: 'off',
      },
      usage: { ...unassigned.usage, lightweightTasks: 'lightweight' as const },
    };
    expect(dailyQuoteGenerator(assigned)).toBeTypeOf('function');
  });
});
